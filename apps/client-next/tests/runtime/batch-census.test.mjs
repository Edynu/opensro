/*
===========================================================================

batch-census.test.mjs - tests for batch-census.ts and its panel text in
frame-report.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
async function load( path ) {
	return import( sourceFileUrl( path ).href );
}
const { createBatchCensus, formatBatchCensus, COUNT_KEY_PREFIX } = {
	...(await load( "src/engine/foundation/rendering/batch-census.ts" )),
	...(await load( "src/engine/foundation/rendering/frame-report.ts" ))
};
/*
================
draw
================
*/
function draw( kind, geometry, texture, instances, effect, particles = 0 ) {
	return { kind, geometry, texture, instances, effect, particles };
}
/*
================
panel

The census panel's text for one frame's census.
================
*/
function panel( census ) {
	const stages = Object.fromEntries(
		Object.entries( census.counts() ).map( ( [name, value] ) => [ COUNT_KEY_PREFIX + name, value ] )
	);
	return formatBatchCensus( { stages } );
}

test("an item is its geometry and texture; kinds and the most worn item are kept apart", () => {
	const census = createBatchCensus(), armor = {}, cape = {}, flame = {}, red = {}, blue = {};
	// The same armor in three outfits (red), and once retextured (blue).
	census.add( draw( "mesh", armor, red, 2 ) );
	census.add( draw( "mesh", armor, red, 1 ) );
	census.add( draw( "mesh", armor, red, 4 ) );
	census.add( draw( "mesh", armor, blue, 9 ) );
	census.add( draw( "cloth", cape, red, 1 ) );
	census.add( draw( "cloth", cape, red, 1 ) );
	census.add( draw( "effect", flame, undefined, 30, "fire.efp", 12 ) );
	census.casters( "fire.efp", 1 );
	assert.deepEqual( census.counts(), {
		"census-mesh-draws": 4,
		"census-mesh-items": 2,
		"census-mesh-instances": 16,
		"census-cloth-draws": 2,
		"census-cloth-items": 1,
		"census-cloth-instances": 2,
		"census-effect-draws": 1,
		"census-effect-items": 1,
		"census-effect-instances": 30,
		"census-top-instances": 9,
		"census-top-draws": 1,
		"census-fx-draws:fire.efp": 1,
		"census-fx-casters:fire.efp": 1,
		"census-fx-items:fire.efp": 1,
		"census-fx-particles:fire.efp": 12
	} );
});

test("each effect counts its casters, its draws over all casters and its distinct items", () => {
	const census = createBatchCensus(), flame = {}, smoke = {}, spark = {};
	// Forty casters of one effect, each its own batch of two emitters.
	// Effect model ids are URL encoded paths.
	for ( let caster = 0; caster < 40; caster++ ) {
		census.casters( "skill%2Ffire_force.efp", 1 );
		census.add( draw( "effect", flame, undefined, 8, "skill%2Ffire_force.efp", 5 ) );
		census.add( draw( "effect", smoke, undefined, 8, "skill%2Ffire_force.efp", 3 ) );
	}
	census.casters( "skill/heal.efp", 2 );
	census.add( draw( "effect", spark, undefined, 16, "skill/heal.efp", 7 ) );
	const text = panel( census );
	assert.match( text, /effect draws\s+81\s+→\s+3\s+\(-96%\)/ );
	// Most drawn first, by the name's last path part: draws, casters, items, particles.
	assert.match( text, /\nfire_force\.efp\s+80\s+40\s+2\s+320\nheal\.efp\s+1\s+2\s+1\s+7/ );
});

test("the census panel reports the draws a batch per item would issue", () => {
	const census = createBatchCensus(), armor = {}, helmet = {};
	for ( let i = 0; i < 8; i++ ) census.add( draw( "mesh", i < 6 ? armor : helmet, undefined, 1 ) );
	const text = panel( census );
	assert.match( text, /item mesh draws\s+8\s+→\s+2\s+\(-75%\)/ );
	assert.match( text, /mesh draws per item\s+4\.0/ );
	assert.match( text, /most worn item: instances\s+6/ );
	assert.doesNotMatch( text, /Effects by use/ );
	assert.match( formatBatchCensus( {} ), /\?frame-stages=1/ );
	assert.match( formatBatchCensus( { stages: {} } ), /No character draws sampled yet/ );
});
