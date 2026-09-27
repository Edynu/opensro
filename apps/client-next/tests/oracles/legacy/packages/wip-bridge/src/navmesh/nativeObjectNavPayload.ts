/*
===========================================================================

Native Object Nav Payload

VERIFIER(objnav) 2026-07-07 - decoder made ASM-exact, please review.
Mirrors sub_4265b0 CRTNavMeshObj_ReadFromArchive + sub_426160
CRTNavMeshObj_ReadOutlineEdgeGrid byte-for-byte. What changed vs the first cut:

1. FLAGS: the nav flags word = BMS headerOffsets[11] (it lives in the BMS
   header, NOT inside the preserved offset-7 slice) now gates the optional
   bytes exactly like the native: flags&2 -> +1 byte per CELL (cell+0x8b),
   flags&1 -> +1 byte per EDGE (edge+0x38), flags&4 -> event-name section
   before the grid. The caller passes the owning SroWorldBmsMesh so the
   flags travel with the payload.
2. STRUCTURE: the 8-byte records are the native CELLS (walkable triangles,
   sub_45c110, 0x8c-stride runtime); the second 9-byte block is the SECOND
   EDGE GROUP - group 1 = OUTLINE edges (perimeter; the
   only ones the grid tail indexes), group 2 = INTERNAL edges (cell<->cell
   crossings). Both are sub_45bf10/0x3c-stride records; dstCell 0xffff =
   open edge. sub_45c240 links each edge into its cell(s).
3. GRID: native header is 20 bytes (f32 originX, f32 originZ, i32 countX,
   i32 countZ, u32 tileCount == countX*countZ), then per tile
   { u32 refCount, refCount x u16 outlineEdgeIndex }. The previous 24-byte
   header read swallowed tile 0's refCount and left the rest misaligned.
4. EXACTNESS: all indices are range-checked and the payload must
   exact-consume to EOF - any mismatch throws, and the runtime records the
   message as an unsupported-payload diagnostic (never a silent partial).

Cross-verified: all 291 preserved offset-7 payloads in the shipped region
bundles exact-consume with this grammar; every one has headerOffsets[11]
== 0 (no optional bytes / event names in current data - the flag paths are
for byte-exactness and future assets).

Winding note for the stepper port: the native cell builder receives the
vertex POINTERS in swapped arg order - sub_45c110(v[@4], v[@2], cell,
v[@0], mesh, ordinal, eventZoneWord) - i.e. (vertexC, vertexB, vertexA)
relative to the wire order stored here. Irrelevant for barycentric height
sampling, but it matters when porting the 45c110 side/normal precompute.

===========================================================================
*/

import type { SroWorldBmsMesh, SroWorldBmsNativePayload } from "@sro/runtime";

const VERTEX_WIRE_STRIDE = 13;	// f32 x,y,z + u8 boundaryDirection (sub_43ec80 input)
const CELL_WIRE_STRIDE = 8;	// u16 v0,v1,v2 + u16 eventZoneWord
const EDGE_WIRE_STRIDE = 9;	// u16 vA,vB + u16 srcCell,dstCell + u8 flag

/** flags & 2 -> each cell carries one extra trailing byte (cell+0x8b). */
const NAV_FLAG_CELL_EXTRA_BYTE = 2;
/** flags & 1 -> each edge carries one extra trailing byte (edge+0x38). */
const NAV_FLAG_EDGE_EXTRA_BYTE = 1;
/** flags & 4 -> the event-name string section is present. */
const NAV_FLAG_EVENT_NAMES = 4;

/** BMS header dword [11] = the nav-section flags word (see research.md). */
const NAV_FLAGS_HEADER_INDEX = 11;
const NAV_SECTION_HEADER_INDEX = 7;

export type NativeObjectNavCells = {
	readonly vertexA: Uint16Array;
	readonly vertexB: Uint16Array;
	readonly vertexC: Uint16Array;
	readonly eventZone: Uint16Array;
	/** Present only when navFlags & 2 (cell+0x8b in the native record). */
	readonly extras: Uint8Array | null;
};

export type NativeObjectNavEdgeGroup = {
	readonly count: number;
	readonly vertexA: Uint16Array;
	readonly vertexB: Uint16Array;
	readonly srcCell: Uint16Array;
	/** 0xffff = open edge (no neighbor cell). */
	readonly dstCell: Uint16Array;
	readonly flags: Uint8Array;
	/** Present only when navFlags & 1 (edge+0x38 in the native record). */
	readonly extras: Uint8Array | null;
};

export type NativeObjectNavGrid = {
	readonly originX: number;
	readonly originZ: number;
	readonly countX: number;
	readonly countZ: number;
	/** Per tile: OUTLINE-edge indices (native resolves them to 0x3c-stride ptrs). */
	readonly tiles: readonly Uint16Array[];
};

export type NativeObjectNavMesh = {
	/** BMS headerOffsets[11] - the nav section's option flags. */
	readonly navFlags: number;
	readonly vertexCount: number;
	/** xyz triplets, object-local native units. */
	readonly vertices: Float32Array;
	/** Per-vertex boundary direction index (43EC80; loader cosine/negative-sine table). Legacy property name retained. */
	readonly vertexRegionLinks: Uint8Array;
	readonly cellCount: number;
	readonly cells: NativeObjectNavCells;
	/** Group 1: perimeter edges - the grid indexes ONLY these. */
	readonly outlineEdges: NativeObjectNavEdgeGroup;
	/** Group 2: internal cell<->cell edges. */
	readonly internalEdges: NativeObjectNavEdgeGroup;
	readonly eventNames: readonly string[];
	/**
	 * navObj+0x94: native sets it iff eventNames == ["event"|"EVENT"] (len 5)
	 * AND cellCount == 2 - the pass-through door marker the steppers consume.
	 */
	readonly passThrough: boolean;
	readonly grid: NativeObjectNavGrid;
	readonly byteLength: number;
};

/*
================
decodeNativeObjectNavPayload

Decode a preserved BMS offset-7 object-nav payload. `meshResource` is the
owning bundle mesh - its headerOffsets[11] is the flags word that gates the
optional record bytes (the preserved tail alone is ambiguous without it).
Throws loudly on any layout mismatch; callers surface the message as an
unsupported-payload diagnostic. Never falls back.
================
*/
export function decodeNativeObjectNavPayload(
	payload: SroWorldBmsNativePayload,
	meshResource: Pick<SroWorldBmsMesh, "byteLength" | "headerOffsets">
): NativeObjectNavMesh | null {
	if ( payload.kind !== "bms-offset7-post-payload-tail" ) {
		return null;
	}

	const	navOffset = meshResource.headerOffsets?.[NAV_SECTION_HEADER_INDEX] ?? 0;

	if ( !navOffset ) {
		return null;
	}
	if ( navOffset !== payload.byteOffset ) {
		throw new Error( `object nav offset mismatch ${payload.byteOffset}/${navOffset}` );
	}

	const	navFlags = meshResource.headerOffsets?.[NAV_FLAGS_HEADER_INDEX] ?? 0;
	const	bytes = base64ToBytes( payload.rawBase64 );
	const	sectionByteLength = nativeObjectNavSectionByteLength( payload, meshResource );

	if ( sectionByteLength > bytes.byteLength ) {
		throw new Error( `object nav payload truncated before section end ${bytes.byteLength}/${sectionByteLength}` );
	}
	return decodeNativeObjectNavPayloadBytes( bytes.subarray( 0, sectionByteLength ), navFlags );
}

/**
 * The mutable decode state over the preserved slice: the byte view and the
 * running wire offset. Explicit first argument to the readers below so they
 * are file-scope functions rather than captured closures.
 */
type NativeObjectNavCursor = {
	bytes: Uint8Array;
	view: DataView;
	offset: number;
};

/*
================
NativeObjectNav_Ensure

Bounds check for the next wire read; throws the truncation diagnostic the
runtime records (never a silent partial).
================
*/
function NativeObjectNav_Ensure( cursor: NativeObjectNavCursor, byteLength: number, label: string ): void {
	if ( cursor.offset + byteLength > cursor.bytes.byteLength ) {
		throw new Error( `object nav payload truncated in ${label} at ${cursor.offset}/${cursor.bytes.byteLength}` );
	}
}

/*
================
NativeObjectNav_ReadU32
================
*/
function NativeObjectNav_ReadU32( cursor: NativeObjectNavCursor, label: string ): number {
	NativeObjectNav_Ensure( cursor, 4, label );

	const	value = cursor.view.getUint32( cursor.offset, true );

	cursor.offset += 4;
	return value;
}

/*
================
NativeObjectNav_ReadEdgeGroup

One edge group: { u16 vA,vB; u16 srcCell,dstCell; u8 flag } (+ u8 iff
navFlags&1) - 0x3c-stride runtime records (sub_45bf10; sub_45c240 links
the cells; dst 0xffff = none).
================
*/
function NativeObjectNav_ReadEdgeGroup(
	cursor: NativeObjectNavCursor,
	label: string,
	edgeStride: number,
	edgeExtra: boolean,
	vertexCount: number,
	cellCount: number
): NativeObjectNavEdgeGroup {
	const	count = NativeObjectNav_ReadU32( cursor, `${label} edge count` );

	NativeObjectNav_Ensure( cursor, count * edgeStride, `${label} edge records` );

	const	vertexA = new Uint16Array( count );
	const	vertexB = new Uint16Array( count );
	const	srcCell = new Uint16Array( count );
	const	dstCell = new Uint16Array( count );
	const	flags = new Uint8Array( count );
	const	extras = edgeExtra ? new Uint8Array( count ) : null;

	for ( let i = 0; i < count; i += 1 ) {
		const	base = cursor.offset + i * edgeStride;
		const	vA = cursor.view.getUint16( base, true );
		const	vB = cursor.view.getUint16( base + 2, true );
		const	src = cursor.view.getUint16( base + 4, true );
		const	dst = cursor.view.getUint16( base + 6, true );

		if ( vA >= vertexCount || vB >= vertexCount ) {
			throw new Error( `object nav ${label} edge ${i} vertex index out of range (${vA},${vB} / ${vertexCount})` );
		}
		if ( src >= cellCount || ( dst !== 0xffff && dst >= cellCount ) ) {
			throw new Error( `object nav ${label} edge ${i} cell index out of range (${src},${dst} / ${cellCount})` );
		}
		vertexA[i] = vA;
		vertexB[i] = vB;
		srcCell[i] = src;
		dstCell[i] = dst;
		flags[i] = cursor.view.getUint8( base + 8 );
		if ( extras ) {
			extras[i] = cursor.view.getUint8( base + 9 );
		}
	}
	cursor.offset += count * edgeStride;
	return { count, vertexA, vertexB, srcCell, dstCell, flags, extras };
}

/*
================
decodeNativeObjectNavPayloadBytes
================
*/
export function decodeNativeObjectNavPayloadBytes( bytes: Uint8Array, navFlags: number ): NativeObjectNavMesh {
	const	cursor: NativeObjectNavCursor = {
		bytes,
		view: new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength ),
		offset: 0
	};

	// 1. Vertices: { f32 x,y,z; u8 boundaryDirection } - 13 bytes wire, 0x14-stride
	//    runtime records at navObj+0x14.
	const	vertexCount = NativeObjectNav_ReadU32( cursor, "vertex count" );

	NativeObjectNav_Ensure( cursor, vertexCount * VERTEX_WIRE_STRIDE, "vertex records" );

	const	vertices = new Float32Array( vertexCount * 3 );
	const	vertexRegionLinks = new Uint8Array( vertexCount );

	for ( let i = 0; i < vertexCount; i += 1 ) {
		const	base = cursor.offset + i * VERTEX_WIRE_STRIDE;

		vertices[i * 3] = cursor.view.getFloat32( base, true );
		vertices[i * 3 + 1] = cursor.view.getFloat32( base + 4, true );
		vertices[i * 3 + 2] = cursor.view.getFloat32( base + 8, true );
		vertexRegionLinks[i] = cursor.view.getUint8( base + 12 );
	}
	cursor.offset += vertexCount * VERTEX_WIRE_STRIDE;

	// 2. Cells: { u16 v0,v1,v2; u16 eventZoneWord } (+ u8 iff navFlags&2) -
	//    0x8c-stride runtime records at navObj+0x44 built by sub_45c110.
	const	cellExtra = ( navFlags & NAV_FLAG_CELL_EXTRA_BYTE ) !== 0;
	const	cellStride = CELL_WIRE_STRIDE + ( cellExtra ? 1 : 0 );
	const	cellCount = NativeObjectNav_ReadU32( cursor, "cell count" );

	NativeObjectNav_Ensure( cursor, cellCount * cellStride, "cell records" );

	const	cells: NativeObjectNavCells = {
		vertexA: new Uint16Array( cellCount ),
		vertexB: new Uint16Array( cellCount ),
		vertexC: new Uint16Array( cellCount ),
		eventZone: new Uint16Array( cellCount ),
		extras: cellExtra ? new Uint8Array( cellCount ) : null
	};

	for ( let i = 0; i < cellCount; i += 1 ) {
		const	base = cursor.offset + i * cellStride;
		const	v0 = cursor.view.getUint16( base, true );
		const	v1 = cursor.view.getUint16( base + 2, true );
		const	v2 = cursor.view.getUint16( base + 4, true );

		if ( v0 >= vertexCount || v1 >= vertexCount || v2 >= vertexCount ) {
			throw new Error( `object nav cell ${i} vertex index out of range (${v0},${v1},${v2} / ${vertexCount})` );
		}
		cells.vertexA[i] = v0;
		cells.vertexB[i] = v1;
		cells.vertexC[i] = v2;
		cells.eventZone[i] = cursor.view.getUint16( base + 6, true );
		if ( cells.extras ) {
			cells.extras[i] = cursor.view.getUint8( base + 8 );
		}
	}
	cursor.offset += cellCount * cellStride;

	// 3. Two edge groups: OUTLINE then INTERNAL (record grammar and native
	//    provenance in NativeObjectNav_ReadEdgeGroup's banner).
	const	edgeExtra = ( navFlags & NAV_FLAG_EDGE_EXTRA_BYTE ) !== 0;
	const	edgeStride = EDGE_WIRE_STRIDE + ( edgeExtra ? 1 : 0 );
	const	outlineEdges = NativeObjectNav_ReadEdgeGroup( cursor, "outline", edgeStride, edgeExtra, vertexCount, cellCount );
	const	internalEdges = NativeObjectNav_ReadEdgeGroup( cursor, "internal", edgeStride, edgeExtra, vertexCount, cellCount );

	// 4. Optional event-name strings (navFlags & 4): u32 count, then
	//    len-prefixed strings. The native pass-through rule reads them.
	const	eventNames: string[] = [];

	if ( ( navFlags & NAV_FLAG_EVENT_NAMES ) !== 0 ) {
		const	nameCount = NativeObjectNav_ReadU32( cursor, "event name count" );

		for ( let i = 0; i < nameCount; i += 1 ) {
			const	length = NativeObjectNav_ReadU32( cursor, "event name length" );

			NativeObjectNav_Ensure( cursor, length, "event name text" );

			let		text = "";

			for ( let c = 0; c < length; c += 1 ) {
				text += String.fromCharCode( cursor.bytes[cursor.offset + c] ?? 0 );
			}
			eventNames.push( text );
			cursor.offset += length;
		}
	}

	const	passThrough =
		eventNames.length === 1 && cellCount === 2 && ( eventNames[0] === "event" || eventNames[0] === "EVENT" );

	// 5. Outline-edge grid tail (sub_426160): f32 originX/Z, i32 countX/Z
	//    (~100-native-unit tiles, origin = vertex minima), u32 tileCount ==
	//    countX*countZ, then per tile { u32 refCount, refCount x u16
	//    outlineEdgeIndex }.
	NativeObjectNav_Ensure( cursor, 20, "grid header" );

	const	originX = cursor.view.getFloat32( cursor.offset, true );
	const	originZ = cursor.view.getFloat32( cursor.offset + 4, true );
	const	countX = cursor.view.getInt32( cursor.offset + 8, true );
	const	countZ = cursor.view.getInt32( cursor.offset + 12, true );
	const	tileCount = cursor.view.getUint32( cursor.offset + 16, true );

	cursor.offset += 20;
	if ( tileCount !== countX * countZ ) {
		throw new Error( `object nav grid tileCount ${tileCount} != countX*countZ ${countX * countZ}` );
	}

	const	tiles: Uint16Array[] = new Array( tileCount );

	for ( let t = 0; t < tileCount; t += 1 ) {
		const	refCount = NativeObjectNav_ReadU32( cursor, "grid tile ref count" );

		NativeObjectNav_Ensure( cursor, refCount * 2, "grid tile refs" );

		const	refs = new Uint16Array( refCount );

		for ( let r = 0; r < refCount; r += 1 ) {
			const	edgeIndex = cursor.view.getUint16( cursor.offset + r * 2, true );

			if ( edgeIndex >= outlineEdges.count ) {
				throw new Error( `object nav grid tile ${t} ref ${edgeIndex} >= outline edge count ${outlineEdges.count}` );
			}
			refs[r] = edgeIndex;
		}
		cursor.offset += refCount * 2;
		tiles[t] = refs;
	}

	// Exact-consume proof: the preserved slice ends at EOF; leftovers or an
	// overrun mean layout drift or an unknown flags combination.
	if ( cursor.offset !== bytes.byteLength ) {
		throw new Error(
			`object nav payload not exactly consumed (${cursor.offset}/${bytes.byteLength}, navFlags=0x${navFlags.toString( 16 )})`
		);
	}

	return {
		navFlags,
		vertexCount,
		vertices,
		vertexRegionLinks,
		cellCount,
		cells,
		outlineEdges,
		internalEdges,
		eventNames,
		passThrough,
		grid: { originX, originZ, countX, countZ, tiles },
		byteLength: cursor.offset
	};
}

/*
================
base64ToBytes
================
*/
function base64ToBytes( base64: string ): Uint8Array {
	const	binary = globalThis.atob( base64 );
	const	bytes = new Uint8Array( binary.length );

	for ( let i = 0; i < binary.length; i += 1 ) {
		bytes[i] = binary.charCodeAt( i );
	}
	return bytes;
}

/*
================
nativeObjectNavSectionByteLength

The preserved section's byte length: payload start to the nearest higher
header offset (skipping the flags word, which is not an offset) or the
mesh end, clamped to the preserved slice.
================
*/
function nativeObjectNavSectionByteLength(
	payload: SroWorldBmsNativePayload,
	meshResource: Pick<SroWorldBmsMesh, "byteLength" | "headerOffsets">
): number {
	let		sectionEnd = meshResource.byteLength;

	for ( let index = 0; index < meshResource.headerOffsets.length; index += 1 ) {
		if ( index === NAV_FLAGS_HEADER_INDEX ) {
			continue;
		}

		const	candidate = meshResource.headerOffsets[index] ?? 0;

		if ( candidate > payload.byteOffset && candidate < sectionEnd ) {
			sectionEnd = candidate;
		}
	}
	return Math.max( 0, Math.min( payload.byteLength, sectionEnd - payload.byteOffset ) );
}
