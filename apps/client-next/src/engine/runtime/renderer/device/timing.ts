/*
===========================================================================

timing.ts - bounded, optional GPU pass measurements

Readback never delays frame submission. Busy slots drop measurements, not
frames. Disposal invalidates asynchronous completions. Ten detailed shadows
need twenty passes before the scene; the query budget includes those passes.

===========================================================================
*/
const TIMING_SLOTS = 3;
const MAX_TIMED_PASSES = 64;
const MAX_TIMING_SAMPLES = 240;
const QUERIES_PER_PASS = 2;
const PASS_BYTES = 16;
/*
================
createGpuTiming
================
*/
export function createGpuTiming( device: GPUDevice ) {
	const slots = Array.from( { length: TIMING_SLOTS }, () => ({
		phase: "free" as "free" | "recording" | "mapping",
		query: device.createQuerySet( { type: "timestamp", count: MAX_TIMED_PASSES * QUERIES_PER_PASS } ),
		resolve: device.createBuffer( {
			size: MAX_TIMED_PASSES * PASS_BYTES,
			usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
		} ),
		read: device.createBuffer( {
			size: MAX_TIMED_PASSES * PASS_BYTES,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
		} )
	}) );
	let disposed = false, skipped = 0, failed = 0, sequence = 0;
	let attempted = 0, completed = 0, omittedPasses = 0;
	const samples: { sequence: number; frameId?: number; passes: readonly { name: string; ms: number; }[]; }[] = [];
	return {
		/*
  ================
  begin
  ================
  */
		begin( frameId?: number ) {
			if ( disposed ) return undefined;
			attempted++;
			const slot = slots.find( s => s.phase === "free" );
			if ( !slot ) {
				skipped++;
				return undefined;
			}
			slot.phase = "recording";
			const names: string[] = [], id = ++sequence;
			let resolved = false, submitted = false;
			return {
				/*
    ================
    pass
    ================
    */
				pass( name: string ): GPURenderPassTimestampWrites | undefined {
					if ( disposed || resolved ) throw Error( "Stale GPU timing frame" );
					if ( names.length === MAX_TIMED_PASSES ) {
						omittedPasses++;
						return undefined;
					}
					const index = names.length * QUERIES_PER_PASS;
					names.push( name );
					return { querySet: slot.query, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1 };
				},
				/*
    ================
    resolve
    ================
    */
				resolve() {
					if ( disposed || resolved ) throw Error( "Stale GPU timing resolve" );
					resolved = true;
					return names.length ?
						{
							query: slot.query,
							count: names.length * QUERIES_PER_PASS,
							resolve: slot.resolve,
							read: slot.read
						} :
						undefined;
				},
				/*
    ================
    submitted
    ================
    */
				submitted() {
					if ( disposed || !resolved || submitted ) throw Error( "Invalid GPU timing submission" );
					submitted = true;
					if ( !names.length ) {
						slot.phase = "free";
						return;
					}
					slot.phase = "mapping";
					void slot.read.mapAsync( GPUMapMode.READ, 0, names.length * PASS_BYTES ).then( () => {
						if ( disposed ) return;
						const values = new BigUint64Array( slot.read.getMappedRange( 0, names.length * PASS_BYTES ) );
						const passes = names.map( ( name, i ) => ({
							name,
							ms: Number( values[i * QUERIES_PER_PASS + 1]! - values[i * QUERIES_PER_PASS]! ) / 1e6
						}) );
						slot.read.unmap();
						slot.phase = "free";
						if ( passes.some( p => p.ms < 0 || !Number.isFinite( p.ms ) ) ) {
							failed++;
							return;
						}
						completed++;
						samples.push( { sequence: id, frameId, passes } );
						if ( samples.length > MAX_TIMING_SAMPLES ) samples.shift();
					} ).catch( () => {
						if ( !disposed ) {
							failed++;
							slot.phase = "free";
						}
					} );
				}
			};
		},
		/*
  ================
  stats
  ================
  */
		stats() {
			return {
				supported: true,
				skipped,
				failed,
				attempted,
				completed,
				omittedPasses,
				samples: samples.map( s => ({ ...s, passes: s.passes.map( p => ({ ...p }) ) }) )
			};
		},
		/*
  ================
  dispose
  ================
  */
		dispose() {
			if ( disposed ) return;
			disposed = true;
			for ( const slot of slots ) {
				slot.query.destroy();
				slot.resolve.destroy();
				slot.read.destroy();
			}
			samples.length = 0;
		}
	};
}
