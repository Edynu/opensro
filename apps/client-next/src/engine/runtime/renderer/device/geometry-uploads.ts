/*
===========================================================================

geometry-uploads.ts - CPU stream snapshots and their submission upload arena

Destinations and bindings stay owned by geometry. One queue write fills a
copy source; ordered copies precede the frame's compute and render commands.
Only CPU-owned streams enter here. Each submit consumes its snapshots before
the next queue write can reuse the source, including deferred frame submits.

A frame kernel's output table (frame-kernels.ts OUTPUT_TABLES, fixed-size
shared memory) is not snapshotted: its ranges are recorded, and the submit
writes each table's span into the copy source straight from shared memory,
one queue write a table, so the main thread copies none of it. The kernel
does not run over a range again before the submit (cloth-wearers.ts), and
the copies keep their order with every other write's.

===========================================================================
*/
import { destroyNow, type Retire } from "./retirement";

const INITIAL_UPLOAD_BYTES = 16384;
const DEFAULT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

/*
================
UploadCopy

Byte offsets preserve partial updates, overlap order and untouched GPU bytes.
================
*/
type UploadCopy = {
	buffer: GPUBuffer;
	offset: number;
	start: number;
	size: number;
	// An output table's span the copy reads, its start then in the table.
	span?: OutputSpan;
};

/*
================
OutputSpan

The bytes of one output table this submit's copies read, and where the
submit places them in the copy source.
================
*/
type OutputSpan = {
	source: ArrayBufferLike;
	low: number;
	high: number;
	at: number;
};

/*
================
createGeometryUploads
================
*/
export function createGeometryUploads( device: GPUDevice, retire: Retire = destroyNow ) {
	const limit = device.limits?.maxBufferSize ?? DEFAULT_MAX_BUFFER_BYTES;
	const copies: UploadCopy[] = [], spans: OutputSpan[] = [];
	let active = false, used = 0, spanned = 0, data = new Uint8Array( 0 );
	let staging: GPUBuffer | undefined, stagingBytes = 0;

	/*
	================
	submit

	The upload and frame command buffers share one submit. Reusing staging
	after this call is ordered after all readers by the GPU queue.
	================
	*/
	function submit( commands?: GPUCommandBuffer ) {
		if ( !used && !spans.length ) {
			if ( commands ) device.queue.submit( [ commands ] );
			return;
		}
		// The arena's bytes, then each output table's span.
		let total = used;
		for ( const span of spans ) {
			span.at = total;
			total += span.high - span.low;
		}
		if ( stagingBytes < total ) {
			// write and writeOutput submit before total passes the limit.
			let size = Math.min( limit, Math.max( INITIAL_UPLOAD_BYTES, data.byteLength ) );
			while ( size < total && size < limit ) size = Math.min( size * 2, limit );
			const next = device.createBuffer( {
				label: "geometry-upload-arena",
				size,
				usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
			} );
			if ( staging ) retire( staging );
			staging = next;
			stagingBytes = size;
		}
		if ( used ) device.queue.writeBuffer( staging!, 0, data.buffer as ArrayBuffer, 0, used );
		for ( const span of spans ) {
			device.queue.writeBuffer( staging!, span.at, span.source as ArrayBuffer, span.low, span.high - span.low );
		}
		const encoder = device.createCommandEncoder( { label: "geometry-uploads" } );
		for ( const copy of copies ) {
			const start = copy.span ? copy.span.at + copy.start - copy.span.low : copy.start;
			encoder.copyBufferToBuffer( staging!, start, copy.buffer, copy.offset, copy.size );
		}
		const uploads = encoder.finish();
		device.queue.submit( commands ? [ uploads, commands ] : [ uploads ] );
		used = spanned = 0;
		copies.length = spans.length = 0;
	}

	return {
		/*
		================
		beginFrame
		================
		*/
		beginFrame() {
			active = true;
		},
		/*
		================
		write

		Snapshot bytes immediately: packing scratch and caller views may change
		before submission. Byte copies also preserve floating-point bit patterns.
		================
		*/
		write( buffer: GPUBuffer, offset: number, source: Float32Array ) {
			const size = source.byteLength;
			if ( active && used + spanned + size > limit ) submit();
			if ( !active || !size || size > limit ) {
				device.queue.writeBuffer( buffer, offset, source.buffer as ArrayBuffer, source.byteOffset, size );
				return;
			}
			if ( data.byteLength < used + size ) {
				let capacity = Math.min( INITIAL_UPLOAD_BYTES, limit );
				while ( capacity < used + size ) capacity = Math.min( capacity * 2, limit );
				const next = new Uint8Array( capacity );
				next.set( data.subarray( 0, used ) );
				data = next;
			}
			data.set( new Uint8Array( source.buffer, source.byteOffset, size ), used );
			copies.push( { buffer, offset, start: used, size } );
			used += size;
		},
		/*
		================
		writeOutput

		A range of a frame kernel's output table (fixed-size shared memory),
		read at the submit, not copied now: its kernel does not write the range
		again before then. The table's span grows to cover it.
		================
		*/
		writeOutput( buffer: GPUBuffer, offset: number, source: Float32Array ) {
			const size = source.byteLength, low = source.byteOffset, high = low + size;
			if ( !active || !size || size > limit ) {
				device.queue.writeBuffer( buffer, offset, source.buffer as ArrayBuffer, low, size );
				return;
			}
			let span = spans.find( known => known.source === source.buffer );
			const widened = span ? Math.max( span.high, high ) - Math.min( span.low, low ) : size;
			if ( used + spanned - (span ? span.high - span.low : 0) + widened > limit ) {
				submit();
				span = undefined;
			}
			if ( !span ) {
				span = { source: source.buffer, low, high, at: 0 };
				spans.push( span );
			} else {
				spanned -= span.high - span.low;
				span.low = Math.min( span.low, low );
				span.high = Math.max( span.high, high );
			}
			spanned += span.high - span.low;
			copies.push( { buffer, offset, start: low, size, span } );
		},
		submit,
		/*
		================
		endFrame

		An abandoned frame still commits CPU updates, as queue.writeBuffer did.
		Flush while device retirement is open, including released destinations.
		================
		*/
		endFrame() {
			try {
				submit();
			} finally {
				active = false;
			}
		},
		/*
		================
		dispose
		================
		*/
		dispose() {
			copies.length = spans.length = 0;
			used = spanned = 0;
			active = false;
			data = new Uint8Array( 0 );
			if ( staging ) retire( staging );
			staging = undefined;
			stagingBytes = 0;
		}
	};
}
