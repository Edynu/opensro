import { readFile } from "node:fs/promises";
import path from "node:path";
import { MAPM_TILES_PER_AXIS } from "../constants.mjs";
import { publishTerrainLightmap } from "../assets/copyTerrainLightmaps.mjs";
import { parseJmxMapTerrainTexture } from "../jmx/JMXVMAPT1001.mjs";
import { toGameRelative, toHex16 } from "../paths.mjs";

/**
 * Parse one native .t sector and publish its embedded DDS through the world
 * asset owner. The returned value deliberately excludes the non-enumerable
 * payload bytes: runtime JSON receives metadata and a public URL, never a
 * Buffer-shaped serialization accident.
 */
export async function readJmxMapTerrainTextureSector(
	sectorX,
	sectorY,
	sourceExtractedRoot,
	sourceGameRoot,
	area
) {
	assertSectorByte( sectorX, "sectorX" );
	assertSectorByte( sectorY, "sectorY" );
	if ( typeof area !== "string" || area.length === 0 ) {
		throw new TypeError( "area must be a non-empty world asset namespace" );
	}

	const sourcePath = path.join( sourceExtractedRoot, "Map_extracted", String( sectorY ), `${sectorX}.t` );
	const parsed = parseJmxMapTerrainTexture( await readFile( sourcePath ), sourcePath );
	const lightmapPublicPath = await publishTerrainLightmap( area, sectorX, sectorY, parsed.embeddedTexturePayload );

	return {
		sectorId: toHex16( (sectorY << 8) | sectorX ),
		sectorX,
		sectorY,
		sourcePath: toGameRelative( sourcePath, sourceGameRoot ),
		signature: parsed.signature,
		byteLength: parsed.byteLength,
		consumedBytes: parsed.consumedBytes,
		trailingByteLength: parsed.trailingByteLength,
		lightmapPublicPath,
		embeddedTexture: parsed.embeddedTexture,
		blockGrid: parsed.blockGrid,
		nativeLightByteCount: parsed.nativeLightByteCount,
		tilesPerBlockAxis: MAPM_TILES_PER_AXIS,
		blockCount: parsed.blocks.length,
		blocks: parsed.blocks
	};
}

function assertSectorByte( value, label ) {
	if ( !Number.isInteger( value ) || value < 0 || value > 0xff ) {
		throw new RangeError( `${label} must be an unsigned sector byte, received ${value}` );
	}
}
