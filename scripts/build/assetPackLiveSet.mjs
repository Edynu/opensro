/*
===========================================================================

assetPackLiveSet.mjs - which files under assets/packs/ the published index uses

The published pack index (assets/packs/manifest.json) is the single source of
truth for delivery. A file under the packs root is live when the index, its
delivery sidecar or their precompressed variants name it: the index itself,
every pack and its zstd encoding, and every per-asset transport file.
Everything else under the packs root is a superseded build output.

Both the full pack build (assetPacks.mjs) and the pack garbage collector
(gc_asset_packs.mjs) use this one rule, so they cannot disagree about what
may be retired.

===========================================================================
*/

import path from "node:path";

const INDEX_SIDECARS = [ "", ".br", ".gz", ".zst" ];

/*
================
resolvePublicAssetFile

Maps a public asset path to its file under publicRoot, refusing any path
that would escape it.
================
*/
function resolvePublicAssetFile( publicRoot, publicPath ) {
	const absolute = path.resolve( publicRoot, publicPath.replace( /^\/+/, "" ) );
	const relative = path.relative( publicRoot, absolute );
	if ( relative.startsWith( ".." ) || path.isAbsolute( relative ) ) {
		throw new Error( `asset path escapes ${publicRoot}: ${publicPath}` );
	}
	return absolute;
}

/*
================
livePackFiles

Returns the lower-cased absolute paths of every live file for a published
index. `indexPath` is the index file; `publicRoot` resolves the public
asset paths the index names.
================
*/
export function livePackFiles( publicRoot, indexPath, index ) {
	const live = new Set();
	const add = ( filename ) => live.add( path.resolve( filename ).toLowerCase() );
	const deliveryPath = path.join( path.dirname( indexPath ), "delivery.json" );

	for ( const suffix of INDEX_SIDECARS ) {
		add( `${indexPath}${suffix}` );
		add( `${deliveryPath}${suffix}` );
	}
	for ( const entry of index.assets ?? [] ) {
		if ( entry.transport ) {
			add( resolvePublicAssetFile( publicRoot, entry.transport.path ) );
		}
	}
	for ( const group of index.groups ?? [] ) {
		for ( const pack of group.packs ?? [] ) {
			add( resolvePublicAssetFile( publicRoot, pack.path ) );
			if ( pack.zstdPath ) {
				add( resolvePublicAssetFile( publicRoot, pack.zstdPath ) );
			}
		}
	}
	return live;
}
