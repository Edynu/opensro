/*
===========================================================================

copyTerrainLightmaps.mjs - the MAPT lightmap publisher

Each MAPT terrain sector embeds one DDS lightmap. Block sources (the
measured corpus is uniformly DXT1 512x512) ship as NTX1 .texture containers
- authored blocks plus a generated mip suffix, uploaded by the client as
GPU bc1 instead of a CPU decode to expanded RGBA8. A non-block surface
keeps the raw .dds and the client's legacy decode route.
===========================================================================
*/
import { rm } from "node:fs/promises";
import { publicPathToFile } from "../../shared/assetPaths.mjs";
import { exists, writePublicFile } from "../io.mjs";
import { publicRoot } from "../paths.mjs";
import { probeBlockDdsPayload, publishBlockTextureBytes } from "./blockTextures.mjs";

export function terrainLightmapPublicPath( area, sectorX, sectorY, block ) {
	return `/assets/world/${area}/terrain-lightmaps/${sectorY}-${sectorX}.${block ? "texture" : "dds"}`;
}

/*
================
publishTerrainLightmap

Publish the embedded payload and return its public path. The block
container replaces any raw .dds an earlier build wrote (and vice versa), so
the pack sweep can never resurface the superseded sibling.
================
*/
export async function publishTerrainLightmap( area, sectorX, sectorY, payload ) {
	const block = probeBlockDdsPayload( payload );
	const publicPath = terrainLightmapPublicPath( area, sectorX, sectorY, block );
	const target = publicPathToFile( publicPath, publicRoot );
	if ( block ) {
		await publishBlockTextureBytes( payload, target );
	} else {
		await writePublicFile( publicPath, payload );
	}
	const stale = block ? target.replace( /\.texture$/, ".dds" ) : target.replace( /\.dds$/, ".texture" );
	if ( await exists( stale ) ) await rm( stale );
	return publicPath;
}
