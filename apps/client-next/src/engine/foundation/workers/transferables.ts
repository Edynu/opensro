/*
===========================================================================

transferables.ts - the buffers and bitmaps a posted value can hand over

A value posted between threads is copied unless its buffers and bitmaps
are listed for transfer, after which the sender can no longer read them.
The character worker and its host (docs/CLIENT_WORKERS_PLAN.md 5.11)
post models, clips and asset results; this finds what each one carries,
for the caller to list what it will not read again.

===========================================================================
*/

// Models nest primitives, geometry and cloth a few levels deep; a value
// deeper than this carries no buffer the threads post.
const MAX_DEPTH = 8;

/*
================
collectTransferables

The ArrayBuffers (directly or under a view) and ImageBitmaps under root
that accept admits, each once.
================
*/
export function collectTransferables(
	root: unknown,
	accept: ( value: ArrayBufferLike | ImageBitmap ) => boolean = () => true
): Transferable[] {
	const found = new Set<Transferable>();
	const visit = ( value: unknown, depth: number ) => {
		if ( depth > MAX_DEPTH || value === null || typeof value !== "object" ) return;
		if ( ArrayBuffer.isView( value ) ) {
			if ( value.buffer instanceof ArrayBuffer && accept( value.buffer ) ) found.add( value.buffer );
			return;
		}
		if ( value instanceof ArrayBuffer || typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap ) {
			if ( accept( value ) ) found.add( value );
			return;
		}
		for ( const child of Array.isArray( value ) ? value : Object.values( value ) ) visit( child, depth + 1 );
	};
	visit( root, 0 );
	return [ ...found ];
}
