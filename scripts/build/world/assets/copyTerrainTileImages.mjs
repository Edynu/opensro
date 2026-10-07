/*
===========================================================================

copyTerrainTileImages.mjs - the terrain ground tile publisher

The shared tile catalog (Map_extracted/tile2d) used to ship as converted
PNGs: the client decoded each one and held it as expanded RGBA8 for the
lifetime of the world. Block sources (power-of-two DXT DDJs - the corpus
is 420 of 426 tiles at 512x512, authored DXT) now ship as NTX1 .texture
containers through the shared block publisher, like the world object
materials since 2026-10-05. Everything else keeps the converted PNG path
unchanged.

A global outdoor build visits thousands of sectors but only a small shared
tile catalog. Coalesce concurrent publishes and never republish the same
tile during one build process.
===========================================================================
*/
import { copyFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { toPublicImagePath } from "../../shared/assetPaths.mjs";
import { exists } from "../io.mjs";
import { imagePublicRoot, imageSourceRoot, normalizeAssetPath, toGameRelative } from "../paths.mjs";
import { probeBlockTextureFile, writeAuthoredBlockContainer } from "./blockTextures.mjs";

const terrainTilePublishJobs = new Map();

function tileDdjFileName( ddjFileName ) {
	return normalizeAssetPath( ddjFileName ).split( "/" ).at( -1 ) ?? "";
}

function tileDdjPath( ddjFileName, sourceExtractedRoot ) {
	return path.join( sourceExtractedRoot, "Map_extracted", "tile2d", tileDdjFileName( ddjFileName ) );
}

export async function resolveReferencedTerrainTiles( textureIds, tileCatalog, sourceExtractedRoot, sourceGameRoot ) {
	return Promise.all( textureIds.map( async ( textureId ) => {
		const entry = tileCatalog.entriesById[String( textureId )];
		if ( !entry ) {
			throw new Error( `Map_extracted/tile2d.ifo is missing terrain texture id ${textureId}` );
		}

		const ddjPath = tileDdjPath( entry.ddjFileName, sourceExtractedRoot );
		const blockFormat = await probeBlockTextureFile( ddjPath );
		return {
			textureId: entry.id,
			flags: entry.flags,
			category: entry.category,
			ddjFileName: entry.ddjFileName,
			sourcePath: toGameRelative( ddjPath, sourceGameRoot ),
			blockFormat,
			imagePublicPath: blockFormat ?
				terrainTileTexturePublicPath( entry.ddjFileName ) :
				terrainTileImagePublicPath( entry.ddjFileName ),
			metadata: entry.metadata
		};
	} ) );
}

export async function copyReferencedTerrainTileImages( referencedTiles, sourceExtractedRoot ) {
	for ( const tile of referencedTiles ) {
		const ddjPath = tileDdjPath( tile.ddjFileName, sourceExtractedRoot );
		const blockFormat = await probeBlockTextureFile( ddjPath );
		const target = path.join(
			imagePublicRoot,
			"Map_extracted",
			"tile2d",
			blockFormat ? terrainTileTextureFileName( tile.ddjFileName ) : terrainTileImageFileName( tile.ddjFileName )
		);
		const copyKey = target.toLowerCase();
		let copyJob = terrainTilePublishJobs.get( copyKey );
		if ( !copyJob ) {
			copyJob = publishTerrainTile( ddjPath, target, tile.sourcePath, Boolean( blockFormat ) ).catch(
				( error ) => {
					terrainTilePublishJobs.delete( copyKey );
					throw error;
				}
			);
			terrainTilePublishJobs.set( copyKey, copyJob );
		}
		await copyJob;
	}
}

/*
================
migrateCachedTerrainTileReferences

A reused region bundle names the tile representation it was published with.
When the probe now admits a DDJ as a block container but the cached
reference still names the converted PNG (an upgrade from a pre-container
build), the reference migrates to the .texture path - publishing the
container and sweeping the stale PNG must never orphan a bundle that still
reads it. The reverse direction matters for the same reason: a cached
.texture reference whose source the probe no longer admits falls back to
the PNG path. Mutates the parsed bundle in place; true when it changed, so
the caller persists the bundle before this run publishes its tiles.
================
*/
export async function migrateCachedTerrainTileReferences( bundle, sourceExtractedRoot ) {
	const tiles = bundle?.terrainTextures?.tileCatalog?.referencedTiles;
	if ( !Array.isArray( tiles ) ) return false;
	let migrated = false;
	for ( const tile of tiles ) {
		if ( typeof tile?.ddjFileName !== "string" ) continue;
		const blockFormat = await probeBlockTextureFile( tileDdjPath( tile.ddjFileName, sourceExtractedRoot ) );
		const next = blockFormat ?
			terrainTileTexturePublicPath( tile.ddjFileName ) :
			terrainTileImagePublicPath( tile.ddjFileName );
		if ( tile.imagePublicPath !== next ) {
			tile.imagePublicPath = next;
			migrated = true;
		}
	}
	return migrated;
}

/*
================
publishTerrainTile

Block tiles publish the NTX1 container and remove the converted PNGs an
earlier build left behind; non-block tiles keep the staging PNG copy.
================
*/
async function publishTerrainTile( ddjPath, target, sourcePath, block ) {
	if ( block ) {
		// Authored levels only, byte remap - see copyTerrainLightmaps.mjs.
		const { readFile } = await import( "node:fs/promises" );
		await writeAuthoredBlockContainer( await readFile( ddjPath ), sourcePath, target );
		const base = target.replace( /\.texture$/, "" );
		for ( const stale of [ `${base}.png`, `${base}.ddj.png` ] ) {
			if ( await exists( stale ) ) await rm( stale );
		}
		return;
	}
	const source = path.join(
		imageSourceRoot,
		"Map_extracted",
		"tile2d",
		terrainTileImageFileName( path.basename( ddjPath ) )
	);
	if ( !(await exists( source )) ) {
		throw new Error(
			`Missing converted terrain texture ${source} for ${sourcePath}; run the DDJ image conversion first.`
		);
	}
	await mkdir( path.dirname( target ), { recursive: true } );
	await copyFile( source, target );
}

export function terrainTileTexturePublicPath( ddjFileName ) {
	return toPublicImagePath( "Map_extracted/tile2d", terrainTileTextureFileName( ddjFileName ), {
		replaceExtension: false
	} );
}

export function terrainTileImagePublicPath( ddjFileName ) {
	return toPublicImagePath( "Map_extracted/tile2d", terrainTileImageFileName( ddjFileName ), {
		replaceExtension: false
	} );
}

function terrainTileTextureFileName( ddjFileName ) {
	return tileDdjFileName( ddjFileName ).replace( /\.[^.]+$/, ".texture" );
}

export function terrainTileImageFileName( ddjFileName ) {
	const normalizedName = tileDdjFileName( ddjFileName );
	const primaryPng = normalizedName.replace( /\.[^.]+$/, ".png" );
	const primaryPath = path.join( imageSourceRoot, "Map_extracted", "tile2d", primaryPng );
	if ( existsSync( primaryPath ) ) {
		return primaryPng;
	}

	return normalizedName.replace( /\.[^.]+$/, ".ddj.png" );
}
