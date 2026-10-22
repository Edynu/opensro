/*
===========================================================================

shared-strings.ts - strings one thread interns and another reads by id

The character worker's tables (docs/CLIENT_WORKERS_PLAN.md 5.1, 5.11)
carry names (models, clips, bones) as integer ids, so no thread builds a
string per frame. The writer interns each string once into shared memory:
its UTF-16 units appended, its start and length indexed, then the count
published with Atomics. The reader decodes an id the first time it meets
it and keeps the string. One writer per table; any number of readers.

===========================================================================
*/

// The control words: strings published, units used.
const COUNT = 0;
const UNITS = 1;
const CONTROL_WORDS = 2;
// Units decoded per String.fromCharCode call: below the engine's argument limit.
const DECODE_CHUNK = 4096;
// The most units and strings one table holds: models are named by long
// assembly keys, a session interns a few thousand.
const MAX_UNITS = 67108864;
const MAX_STRINGS = 1048576;

/*
================
SharedStrings

The table's shared buffers, posted once to the reading thread.
================
*/
export interface SharedStrings {
	readonly control: SharedArrayBuffer;
	readonly index: SharedArrayBuffer;
	readonly units: SharedArrayBuffer;
}

/*
================
createSharedStrings
================
*/
export function createSharedStrings(): SharedStrings {
	return {
		control: new SharedArrayBuffer( CONTROL_WORDS * 4 ),
		index: new SharedArrayBuffer( 4096 * 8, { maxByteLength: MAX_STRINGS * 8 } ),
		units: new SharedArrayBuffer( 65536 * 2, { maxByteLength: MAX_UNITS * 2 } )
	};
}

/*
================
grown

Grow buffer to hold bytes, doubling, within its maximum.
================
*/
function grown( buffer: SharedArrayBuffer, bytes: number ) {
	if ( bytes <= buffer.byteLength ) return;
	if ( bytes > buffer.maxByteLength ) throw Error( "Shared string table exceeds its budget" );
	buffer.grow( Math.min( buffer.maxByteLength, Math.max( bytes, buffer.byteLength * 2 ) ) );
}

/*
================
createStringWriter

The writing thread's side: intern returns a string's id, the same id for
the same string for the table's life.
================
*/
export function createStringWriter( memory: SharedStrings ) {
	const control = new Int32Array( memory.control );
	// Length-tracking views: they follow the buffers as they grow.
	const index = new Int32Array( memory.index ), units = new Uint16Array( memory.units );
	const ids = new Map<string, number>();
	let count = 0, used = 0;
	return {
		/*
		================
		intern
		================
		*/
		intern( text: string ): number {
			let id = ids.get( text );
			if ( id !== undefined ) return id;
			grown( memory.units, (used + text.length) * 2 );
			grown( memory.index, (count + 1) * 8 );
			for ( let i = 0; i < text.length; i++ ) units[used + i] = text.charCodeAt( i );
			index[count * 2] = used;
			index[count * 2 + 1] = text.length;
			used += text.length;
			id = count++;
			ids.set( text, id );
			Atomics.store( control, UNITS, used );
			// Published last: a reader that sees the count sees the string.
			Atomics.store( control, COUNT, count );
			return id;
		}
	};
}

/*
================
createStringReader

The reading thread's side: text returns the string of an id the writer
published.
================
*/
export function createStringReader( memory: SharedStrings ) {
	const control = new Int32Array( memory.control );
	const index = new Int32Array( memory.index ), units = new Uint16Array( memory.units );
	const texts: string[] = [];
	return {
		/*
		================
		text
		================
		*/
		text( id: number ): string {
			// Only a decoded id short-circuits: a negative or fractional one
			// falls to the check.
			const known = texts[id];
			if ( known !== undefined ) return known;
			const count = Atomics.load( control, COUNT );
			if ( !Number.isInteger( id ) || id < 0 || id >= count ) throw Error( "Unknown shared string" );
			for ( let n = texts.length; n < count; n++ ) {
				const start = index[n * 2]!, length = index[n * 2 + 1]!;
				let text = "";
				for ( let at = 0; at < length; at += DECODE_CHUNK ) {
					const end = Math.min( length, at + DECODE_CHUNK );
					text += String.fromCharCode.apply(
						null,
						units.subarray( start + at, start + end ) as unknown as number[]
					);
				}
				texts.push( text );
			}
			return texts[id]!;
		}
	};
}
