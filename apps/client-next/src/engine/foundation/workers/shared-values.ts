/*
===========================================================================

shared-values.ts - plain values written into shared memory for another thread

The character worker and its host (docs/CLIENT_WORKERS_PLAN.md 5.11)
exchange a frame's small values (step inputs, the renderer's facts,
commands, sounds, answers) through shared blocks, not messages. A block
holds tagged 64-bit words: numbers as they are, strings as shared-strings
ids, arrays and objects by their lengths and keys. One thread writes a
block while the other waits for it (the frame and output counters order
them), so a block has one writer at a time and needs no locks.

A writer may put string values inline instead (two UTF-16 units a word),
interning only object keys: a journal of free text (shared-journal.ts)
would otherwise grow its append-only string table for the session. A
reader reads either.

===========================================================================
*/
import type { createStringReader, createStringWriter } from "./shared-strings";

// Value tags.
const TAG_UNDEFINED = 0;
const TAG_NULL = 1;
const TAG_FALSE = 2;
const TAG_TRUE = 3;
const TAG_NUMBER = 4;
const TAG_STRING = 5;
const TAG_ARRAY = 6;
const TAG_OBJECT = 7;
const TAG_TYPED = 8;
const TAG_INLINE = 9;
/*
================
typedArrays

The typed arrays a value may hold, by their kind word.
================
*/
function typedArrays() {
	return [
		Float32Array,
		Float64Array,
		Int8Array,
		Uint8Array,
		Uint8ClampedArray,
		Int16Array,
		Uint16Array,
		Int32Array,
		Uint32Array
	] as const;
}
// Word 0 holds the words written after it.
const HEADER_WORDS = 1;
// A frame's values; a block grows to hold a larger one.
const INITIAL_BYTES = 65536;
const MAX_BYTES = 67108864;
// Nested deeper than this is not plain frame data.
const MAX_DEPTH = 32;
// The reader keeps its inline string scratch up to this many units.
const INLINE_KEEP = 4096;

/*
================
createSharedBlock
================
*/
export function createSharedBlock(): SharedArrayBuffer {
	return new SharedArrayBuffer( INITIAL_BYTES, { maxByteLength: MAX_BYTES } );
}

/*
================
createValueWriter

Writes one value a frame into block: begin, value, end. Or, for a log,
values anywhere: seek, values, position. inline writes string values in
place rather than interning them.
================
*/
export function createValueWriter(
	block: SharedArrayBuffer,
	strings: ReturnType<typeof createStringWriter>,
	inline = false
) {
	// Length-tracking: follows the block as it grows.
	const words = new Float64Array( block ), typed = typedArrays();
	let at = HEADER_WORDS;
	const room = ( count: number ) => {
		const bytes = (at + count) * 8;
		if ( bytes <= block.byteLength ) return;
		if ( bytes > block.maxByteLength ) throw Error( "Shared value block exceeds its budget" );
		block.grow( Math.min( block.maxByteLength, Math.max( bytes, block.byteLength * 2 ) ) );
	};
	const write = ( value: unknown, depth: number ) => {
		if ( depth > MAX_DEPTH ) throw Error( "Shared value nests too deep" );
		room( 3 );
		if ( value === undefined ) words[at++] = TAG_UNDEFINED;
		else if ( value === null ) words[at++] = TAG_NULL;
		else if ( value === false ) words[at++] = TAG_FALSE;
		else if ( value === true ) words[at++] = TAG_TRUE;
		else if ( typeof value === "number" ) {
			words[at++] = TAG_NUMBER;
			words[at++] = value;
		} else if ( typeof value === "string" && inline ) {
			room( 2 + (value.length + 1) / 2 );
			words[at++] = TAG_INLINE;
			words[at++] = value.length;
			for ( let i = 0; i < value.length; i += 2 ) {
				words[at++] = value.charCodeAt( i ) + (i + 1 < value.length ? value.charCodeAt( i + 1 ) * 65536 : 0);
			}
		} else if ( typeof value === "string" ) {
			words[at++] = TAG_STRING;
			words[at++] = strings.intern( value );
		} else if ( ArrayBuffer.isView( value ) && !(value instanceof DataView) ) {
			const kind = typed.findIndex( type => value instanceof type );
			if ( kind < 0 ) throw Error( "Shared value holds an unsupported typed array" );
			const items = value as unknown as ArrayLike<number>;
			room( 3 + items.length );
			words[at++] = TAG_TYPED;
			words[at++] = kind;
			words[at++] = items.length;
			// One native copy, converting each element to a word.
			words.set( items, at );
			at += items.length;
		} else if ( Array.isArray( value ) ) {
			words[at++] = TAG_ARRAY;
			words[at++] = value.length;
			for ( const item of value ) write( item, depth + 1 );
		} else if ( typeof value === "object" && Object.getPrototypeOf( value ) === Object.prototype ) {
			const record = value as Record<string, unknown>;
			let count = 0;
			for ( const key in record ) if ( Object.hasOwn( record, key ) ) count++;
			words[at++] = TAG_OBJECT;
			words[at++] = count;
			for ( const key in record ) {
				if ( !Object.hasOwn( record, key ) ) continue;
				room( 1 );
				words[at++] = strings.intern( key );
				write( record[key], depth + 1 );
			}
		} else throw Error( "Shared value is not plain data" );
	};
	return {
		begin() {
			at = HEADER_WORDS;
		},
		value( value: unknown ) {
			write( value, 0 );
		},
		// A bare number or string id, untagged, for a reader that knows the
		// layout (a frame's commands): no object is built to read it back.
		number( value: number ) {
			room( 1 );
			words[at++] = value;
		},
		text( value: string ) {
			room( 1 );
			words[at++] = strings.intern( value );
		},
		// A log's writes: values from at on, and where the last one ended.
		seek( position: number ) {
			at = position;
		},
		position: () => at,
		// Published by the frame counter that follows.
		end() {
			words[0] = at - HEADER_WORDS;
		}
	};
}

/*
================
createValueReader

Reads back the values a writer put in block, in order: begin, value...
================
*/
export function createValueReader( block: SharedArrayBuffer, strings: ReturnType<typeof createStringReader> ) {
	const words = new Float64Array( block ), typed = typedArrays();
	let at = HEADER_WORDS, end = HEADER_WORDS, units: number[] = [];
	const read = (): unknown => {
		if ( at >= end ) throw Error( "Shared value block overrun" );
		const tag = words[at++]!;
		switch ( tag ) {
			case TAG_UNDEFINED:
				return undefined;
			case TAG_NULL:
				return null;
			case TAG_FALSE:
				return false;
			case TAG_TRUE:
				return true;
			case TAG_NUMBER:
				return words[at++]!;
			case TAG_STRING:
				return strings.text( words[at++]! );
			case TAG_INLINE: {
				const length = words[at++]!;
				units.length = 0;
				for ( let i = 0; i < length; i += 2 ) {
					const pair = words[at++]!;
					units.push( pair % 65536 );
					if ( i + 1 < length ) units.push( Math.floor( pair / 65536 ) );
				}
				// Below the engine's argument limit a call at a time.
				let text = "";
				for ( let i = 0; i < units.length; i += INLINE_KEEP ) {
					text += String.fromCharCode.apply(
						null,
						units.length > INLINE_KEEP ? units.slice( i, i + INLINE_KEEP ) : units
					);
				}
				if ( units.length > INLINE_KEEP ) units = [];
				return text;
			}
			case TAG_TYPED: {
				const type = typed[words[at++]!];
				if ( !type ) break;
				const length = words[at++]!, value = new type( length );
				value.set( words.subarray( at, at + length ) );
				at += length;
				return value;
			}
			case TAG_ARRAY: {
				const length = words[at++]!, value: unknown[] = new Array( length );
				for ( let i = 0; i < length; i++ ) value[i] = read();
				return value;
			}
			case TAG_OBJECT: {
				const count = words[at++]!, value: Record<string, unknown> = {};
				for ( let i = 0; i < count; i++ ) {
					const key = strings.text( words[at++]! );
					value[key] = read();
				}
				return value;
			}
		}
		throw Error( "Invalid shared value tag" );
	};
	return {
		begin() {
			at = HEADER_WORDS;
			end = HEADER_WORDS + words[0]!;
		},
		value: read,
		number: () => words[at++]!,
		text: () => strings.text( words[at++]! ),
		more: () => at < end,
		// A log's reads: values from at on, to the block's end.
		seek( position: number ) {
			at = position;
			end = words.length;
		},
		position: () => at
	};
}
