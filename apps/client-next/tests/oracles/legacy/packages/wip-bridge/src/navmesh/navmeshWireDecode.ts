/*
================================================================================
navmeshWireDecode

Byte-critical decoders for the extracted world bundle's NVM navmesh payloads:
base64 typed-array views (little-endian), edge-block and object edge-link
decoding, and the native manager+0x20c0 region-link compass table seed.
Nothing in here may drift by a single token - bundle bit parity depends on it.
================================================================================
*/

import type {
	SroWorldNavmeshEdgeBlock,
	SroWorldNavmeshObjectRecord
} from "@sro/runtime";
import type {
	NavVertRegionLinkPair
} from "@wip/functions/sub_43ec80_NavVert_ResolveRegionLinkByte/sub_43ec80_NavVert_ResolveRegionLinkByte";
import type {
	DecodedEdgeBlock,
	RuntimeObjectEdgeLink
} from "./navmeshRuntimeTypes";

/*
================
decodeEdgeBlock
================
*/
export function decodeEdgeBlock( source: SroWorldNavmeshEdgeBlock ): DecodedEdgeBlock {
	return {
		count: source.count,
		lines: base64ToFloat32Array( source.lines ),
		flags: base64ToBytes( source.flags ),
		assocDirections: base64ToBytes( source.assocDirections ),
		assocCells: base64ToUint16Array( source.assocCells ),
		assocRegions: source.assocRegions ? base64ToUint16Array( source.assocRegions ) : null
	};
}

/*
================
decodeObjectEdgeLinks
================
*/
export function decodeObjectEdgeLinks( record: SroWorldNavmeshObjectRecord ): RuntimeObjectEdgeLink[] {
	if ( record.linkEdgeCount <= 0 || !record.linkEdges ) return [];
	const bytes = base64ToBytes( record.linkEdges );
	const count = Math.min( record.linkEdgeCount, Math.floor( bytes.byteLength / 6 ) );
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const links: RuntimeObjectEdgeLink[] = [];
	for ( let i = 0; i < count; i += 1 ) {
		const offset = i * 6;
		links.push( {
			neighborObjectIndex: view.getUint16( offset, true ),
			neighborEdgeIndex: view.getUint16( offset + 2, true ),
			myEdgeIndex: view.getUint16( offset + 4, true )
		} );
	}
	return links;
}

/*
================
base64ToBytes
================
*/
export function base64ToBytes( base64: string ): Uint8Array {
	const binary = globalThis.atob( base64 );
	const bytes = new Uint8Array( binary.length );
	for ( let i = 0; i < binary.length; i += 1 ) {
		bytes[i] = binary.charCodeAt( i );
	}
	return bytes;
}

/*
================
base64ToFloat32Array
================
*/
export function base64ToFloat32Array( base64: string ): Float32Array {
	const bytes = base64ToBytes( base64 );
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const values = new Float32Array( bytes.byteLength / 4 );
	for ( let i = 0; i < values.length; i += 1 ) {
		values[i] = view.getFloat32( i * 4, true );
	}
	return values;
}

/*
================
base64ToUint16Array
================
*/
export function base64ToUint16Array( base64: string ): Uint16Array {
	const bytes = base64ToBytes( base64 );
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const values = new Uint16Array( bytes.byteLength / 2 );
	for ( let i = 0; i < values.length; i += 1 ) {
		values[i] = view.getUint16( i * 2, true );
	}
	return values;
}

/*
================
base64ToUint32Array
================
*/
export function base64ToUint32Array( base64: string ): Uint32Array {
	const bytes = base64ToBytes( base64 );
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const values = new Uint32Array( bytes.byteLength / 4 );
	for ( let i = 0; i < values.length; i += 1 ) {
		values[i] = view.getUint32( i * 4, true );
	}
	return values;
}

/**
 * ASM correction 2026-09-23: native loader+0x20c0 seed (43EC10,
 * original instruction reference: client-next/docs/evidence/native-vertex-direction-reference.json):
 * table[b] = (cosf(f32(b * step)), -sinf(f32(b * step))) - the BMS
 * regionLink byte is a COMPASS HEADING in 1/256-turn units. 0.0245436f is
 * the native's hand-truncated 2*pi/256 (float-exact 0.024543600156903267);
 * keep the truncated constant, NOT a computed 2*pi/256, for bit parity.
 */
const NATIVE_REGION_LINK_STEP_0245436 = Math.fround( 0.0245436 );

/*
================
normalizeNavVertRegionLinkTable20c0
================
*/
export function normalizeNavVertRegionLinkTable20c0(
	source: readonly NavVertRegionLinkPair[] | undefined
): readonly NavVertRegionLinkPair[] {
	return Array.from( { length: 256 }, ( _, index ) => {
		const pair = source?.[index];
		if ( pair ) {
			return { x0c: pair.x0c, z10: pair.z10 };
		}
		const angle = Math.fround( index * NATIVE_REGION_LINK_STEP_0245436 );
		return {
			x0c: Math.fround( Math.cos( angle ) ),
			z10: -Math.fround( Math.sin( angle ) )
		};
	} );
}
