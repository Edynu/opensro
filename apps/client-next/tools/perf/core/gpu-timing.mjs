/*
===========================================================================

gpu-timing.mjs - GPU execution time of every pass a page encodes

The renderer's own timer (renderer/device/timing.ts, ?gpu-timing=1) covers
the passes it names; water reflection, bloom, HDR, scene scaling and the
final presentation passes run untimed. This times them all from outside:
an init script asks the device for timestamp-query, writes timestamps
around every render and compute pass that carries none of its own,
resolves each encoder's timestamps in the submit that carries it (one
resolve command buffer appended after the page's own) and files every pass
under the animation frame it was encoded in. The page's passes, their
order and their contents are unchanged.

A frame's busy time is the sum of its passes. Copies and buffer writes
outside passes are not timed; they are small beside the passes. Chrome
rounds timestamps to 100 microseconds unless WebGPU developer features are
on, so openClient launches with GPU_TIMING_ARGS; the report says whether
the readings were rounded.

===========================================================================
*/

// Chrome switch that stops the 100 microsecond rounding of timestamps.
export const GPU_TIMING_ARGS = [ "--enable-webgpu-developer-features" ];

/*
================
installGpuTiming

Self-contained for page.addInitScript; installs before the page's code.
================
*/
export function installGpuTiming() {
	const target = globalThis;
	if ( !target.GPUAdapter || !target.GPUCommandEncoder ) return;
	// Passes one encoder may time, encoders in flight, and records kept.
	const MAX_PASSES = 128, SLOTS = 32, MAX_RECORDS = 100000, PASS_BYTES = 16;
	const state = target.__gpuTiming = {
		frame: 0,
		records: [],
		incomplete: {},
		timedPasses: 0,
		skippedPasses: 0,
		failed: 0,
		devices: 0,
		adapter: null,
		base: null
	};
	const devices = new WeakMap(), encoders = new WeakMap(), commandBuffers = new WeakMap(), queues = new WeakMap();
	/*
	================
	tick

	Registered first, so each frame's index advances before the page's own
	animation frame callback encodes it.
	================
	*/
	const tick = () => {
		state.frame++;
		target.requestAnimationFrame( tick );
	};
	target.requestAnimationFrame( tick );
	/*
	================
	setup
	================
	*/
	const setup = device => {
		devices.set(
			device,
			Array.from( { length: SLOTS }, () => ({
				free: true,
				passes: [],
				query: device.createQuerySet( { type: "timestamp", count: MAX_PASSES * 2 } ),
				resolve: device.createBuffer( {
					size: MAX_PASSES * PASS_BYTES,
					usage: target.GPUBufferUsage.QUERY_RESOLVE | target.GPUBufferUsage.COPY_SRC
				} ),
				read: device.createBuffer( {
					size: MAX_PASSES * PASS_BYTES,
					usage: target.GPUBufferUsage.COPY_DST | target.GPUBufferUsage.MAP_READ
				} )
			}) )
		);
		queues.set( device.queue, device );
		state.devices++;
	};
	const requestDevice = target.GPUAdapter.prototype.requestDevice;
	target.GPUAdapter.prototype.requestDevice = function( descriptor ) {
		if ( !this.features.has( "timestamp-query" ) ) return requestDevice.call( this, descriptor );
		state.adapter = {
			vendor: this.info?.vendor ?? "",
			architecture: this.info?.architecture ?? "",
			description: this.info?.description ?? ""
		};
		const requiredFeatures = [ ...(descriptor?.requiredFeatures ?? []) ];
		if ( !requiredFeatures.includes( "timestamp-query" ) ) requiredFeatures.push( "timestamp-query" );
		return requestDevice.call( this, { ...descriptor, requiredFeatures } ).then( device => {
			setup( device );
			return device;
		} );
	};
	const createCommandEncoder = target.GPUDevice.prototype.createCommandEncoder;
	target.GPUDevice.prototype.createCommandEncoder = function( ...args ) {
		const encoder = createCommandEncoder.apply( this, args );
		if ( devices.has( this ) ) encoders.set( encoder, { device: this, slot: null } );
		return encoder;
	};
	/*
	================
	claim

	Timestamp writes for one pass of an encoder, from the slot the encoder
	holds until its submit; none when every slot is in flight.
	================
	*/
	const claim = ( encoder, label ) => {
		const entry = encoders.get( encoder );
		if ( !entry ) return undefined;
		if ( !entry.slot ) {
			entry.slot = devices.get( entry.device ).find( slot => slot.free ) ?? null;
			if ( entry.slot ) {
				entry.slot.free = false;
				entry.slot.passes = [];
			}
		}
		if ( !entry.slot || entry.slot.passes.length === MAX_PASSES ) {
			state.skippedPasses++;
			state.incomplete[state.frame] = (state.incomplete[state.frame] ?? 0) + 1;
			return undefined;
		}
		const index = entry.slot.passes.length * 2;
		entry.slot.passes.push( { label, frame: state.frame } );
		state.timedPasses++;
		return { querySet: entry.slot.query, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1 };
	};
	for ( const name of [ "beginRenderPass", "beginComputePass" ] ) {
		const begin = target.GPUCommandEncoder.prototype[name];
		target.GPUCommandEncoder.prototype[name] = function( descriptor, ...rest ) {
			if ( descriptor?.timestampWrites ) return begin.call( this, descriptor, ...rest );
			const timestampWrites = claim( this, descriptor?.label || name );
			return begin.call( this, timestampWrites ? { ...descriptor, timestampWrites } : descriptor, ...rest );
		};
	}
	const finish = target.GPUCommandEncoder.prototype.finish;
	target.GPUCommandEncoder.prototype.finish = function( ...args ) {
		const commandBuffer = finish.apply( this, args );
		const slot = encoders.get( this )?.slot;
		if ( slot ) commandBuffers.set( commandBuffer, slot );
		return commandBuffer;
	};
	/*
	================
	read

	Files a submitted slot's passes once the GPU has written them, and frees
	the slot.
	================
	*/
	const read = slot => {
		const passes = slot.passes, bytes = passes.length * PASS_BYTES;
		slot.read.mapAsync( target.GPUMapMode.READ, 0, bytes ).then( () => {
			const values = new BigUint64Array( slot.read.getMappedRange( 0, bytes ) );
			for ( let i = 0; i < passes.length; i++ ) {
				const begin = values[i * 2], end = values[i * 2 + 1];
				if ( !begin || end < begin ) {
					state.failed++;
					state.incomplete[passes[i].frame] = (state.incomplete[passes[i].frame] ?? 0) + 1;
					continue;
				}
				state.base ??= begin;
				state.records.push( [
					passes[i].frame,
					passes[i].label,
					Number( begin - state.base ) / 1e6,
					Number( end - begin ) / 1e6
				] );
			}
			if ( state.records.length > MAX_RECORDS ) state.records.splice( 0, state.records.length - MAX_RECORDS );
			slot.read.unmap();
			slot.free = true;
		}, () => {
			state.failed++;
			slot.free = true;
		} );
	};
	const submit = target.GPUQueue.prototype.submit;
	target.GPUQueue.prototype.submit = function( buffers ) {
		const device = queues.get( this ), list = Array.from( buffers );
		const slots = device ? list.map( buffer => commandBuffers.get( buffer ) ).filter( Boolean ) : [];
		if ( !slots.length ) return submit.call( this, list );
		const encoder = createCommandEncoder.call( device );
		for ( const slot of slots ) {
			encoder.resolveQuerySet( slot.query, 0, slot.passes.length * 2, slot.resolve, 0 );
			encoder.copyBufferToBuffer( slot.resolve, 0, slot.read, 0, slot.passes.length * PASS_BYTES );
		}
		const result = submit.call( this, [ ...list, finish.call( encoder ) ] );
		for ( const slot of slots ) read( slot );
		return result;
	};
}

/*
================
gpuTimingReport

GPU time per frame for the animation frames in [from, to): busy (the sum of
the frame's passes) and span (first pass start to last pass end), and the
passes by label. Frames with a pass left untimed (every timing slot in
flight, or a failed reading) are left out and counted.
Self-contained for page.evaluate.
================
*/
export function gpuTimingReport( [from, to] ) {
	const state = globalThis.__gpuTiming;
	if ( !state ) return null;
	const frames = new Map();
	let rounded = true, readings = 0;
	for ( const [frame, label, begin, ms] of state.records ) {
		if ( frame < from || frame >= to || state.incomplete[frame] ) continue;
		let row = frames.get( frame );
		if ( !row ) frames.set( frame, row = { busy: 0, first: Infinity, last: -Infinity, labels: {} } );
		row.busy += ms;
		row.first = Math.min( row.first, begin );
		row.last = Math.max( row.last, begin + ms );
		row.labels[label] = (row.labels[label] ?? 0) + ms;
		readings++;
		if ( Math.abs( ms * 10 - Math.round( ms * 10 ) ) > 1e-6 ) rounded = false;
	}
	const rows = [ ...frames.values() ];
	let untimed = 0;
	for ( let frame = from; frame < to; frame++ ) untimed += state.incomplete[frame] ?? 0;
	/*
	================
	spread
	================
	*/
	const spread = values => {
		const sorted = [ ...values ].sort( ( a, b ) => a - b );
		const at = q => sorted[Math.floor( (sorted.length - 1) * q )] ?? 0;
		return {
			mean: sorted.reduce( ( sum, value ) => sum + value, 0 ) / Math.max( 1, sorted.length ),
			p50: at( .5 ),
			p95: at( .95 ),
			max: sorted.at( -1 ) ?? 0
		};
	};
	const labels = {};
	for ( const row of rows ) {
		for ( const [label, ms] of Object.entries( row.labels ) ) labels[label] = (labels[label] ?? 0) + ms;
	}
	return {
		frames: rows.length,
		framesInWindow: Math.max( 0, to - from ),
		readings,
		rounded: readings > 0 && rounded,
		busy: spread( rows.map( row => row.busy ) ),
		span: spread( rows.map( row => row.last - row.first ) ),
		passes: Object.entries( labels )
			.map( ( [label, ms] ) => ({ label, ms: ms / Math.max( 1, rows.length ) }) )
			.sort( ( a, b ) => b.ms - a.ms ),
		untimedPasses: untimed,
		devices: state.devices,
		adapter: state.adapter
	};
}
