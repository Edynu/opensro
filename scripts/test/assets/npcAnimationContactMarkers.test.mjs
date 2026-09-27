import assert from "node:assert/strict";
import test from "node:test";
import { npcAttackContactMarkerKeys } from "../../lib/npcAnimationContactMarkers.mjs";
import { readPublishedAssetJsonSync } from "../../lib/publishedAsset.mjs";

test( "NPC contact markers are resolved per published model, not from Mangyang constants", () => {
	const manifest = readPublishedAssetJsonSync( "/assets/npc/manifest.json" );
	assert.deepEqual(
		npcAttackContactMarkerKeys( manifest, "MOB_CH_MANGNYANG" ),
		[ 651, 821, 1381 ]
	);
	assert.deepEqual(
		npcAttackContactMarkerKeys( manifest, "MOB_EU_MOVOI_CLON" ),
		[ 1077, 1085, 1312, 1394, 1538 ]
	);
	assert.deepEqual( npcAttackContactMarkerKeys( manifest, "MISSING_MODEL" ), [] );
} );
