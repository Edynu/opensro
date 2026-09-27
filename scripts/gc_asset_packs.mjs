/*
===========================================================================

gc_asset_packs.mjs - `pnpm assets gc`: retire unused asset-pack outputs

	node scripts/gc_asset_packs.mjs            report what would be retired
	node scripts/gc_asset_packs.mjs --apply    soft-archive it

Retired files move to temp/archives/generated-artifacts/ with their original
path and a provenance record (see assetPackGarbage.mjs); nothing is deleted.
Emptying temp/ is always safe. Runs under the generated-assets lock, so it
never races a publisher.

===========================================================================
*/

import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectPackGarbage } from "./build/assetPackGarbage.mjs";
import { withGeneratedAssetsLock } from "./rebuildLock.mjs";

const rebuildRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), ".." );
const publicRoot = path.join( rebuildRoot, ".generated", "client-public" );
const apply = process.argv.includes( "--apply" );

await withGeneratedAssetsLock( "retire unused asset packs", async () => {
	const { live, garbage, garbageBytes } = await collectPackGarbage( { publicRoot, apply } );
	const gigabytes = (garbageBytes / 2 ** 30).toFixed( 2 );
	const verb = apply ? "archived" : "would archive";
	console.log( `asset packs: ${live} live file(s); ${verb} ${garbage.length} unused file(s), ${gigabytes} GB` );
	if ( !apply && garbage.length > 0 ) {
		console.log( "run with --apply to move them to temp/archives/generated-artifacts/" );
	}
} );
