/*
===========================================================================

progression-bars.test.mjs - tests for progression-bars.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { experienceBar, advanceGauge, gaugeFill } = await import(
	sourceFileUrl( "src/engine/foundation/ui/progression-bars.ts" ).href
);
test("EXP uses complete native segments followed by a quantized cropped segment", () => {
	const q = experienceBar( "456", "1000", 0, 0, [ 0, 0, 800, 600 ] );
	assert.equal( q.length, 5 );
	assert.deepEqual( q[0].rect, [ 18, 27, 20, 20 ] );
	assert.ok( Math.abs( q[4].rect[2] - 11.2 ) < 1e-12 );
	assert.equal( q[4].uv[2], .56 );
	assert.equal( experienceBar( "0", "1000", 0, 0, [ 0, 0, 800, 600 ] ).length, 0 );
	const full = experienceBar( "1000", "1000", 0, 0, [ 0, 0, 800, 600 ] );
	assert.equal( full.length, 10 );
	assert.ok( full[9].uv[2] < 1 );
});
test("SP rising and rollover display the larger extent as a translucent ghost", () => {
	const a = advanceGauge( 0, .5 );
	assert.ok( a > 0 && a < .5 );
	const b = advanceGauge( .9, .1 );
	assert.ok( b > .1 && b < .9 );
	for ( const [current, target] of [ [ .1, .9 ], [ .9, .1 ] ] ) {
		const q = gaugeFill( [ 0, 0, 100, 8 ], [ 0, 0, 1, 1 ], "sp", current, target, [ 0, 0, 100, 8 ] );
		assert.equal( q[0].rect[2], 90 );
		assert.equal( q[0].color[3], 96 / 255 );
		assert.equal( q[1].rect[2], 10 );
		assert.equal( q[1].color[3], 1 );
	}
	assert.equal( advanceGauge( .5, .5 ), .5 );
});

const { createGaugePresentation } = await import(
	sourceFileUrl( "src/engine/runtime/ui/hud/progression-bars.ts" ).href
);
test("gauge interpolation follows native stores without rounding the intermediate step", () => {
	for ( let i = 0; i < 1000; i++ ) {
		const current = Math.fround( i / 999 ), target = Math.fround( (i * 37 % 1000) / 999 );
		const delta = Math.fround( target - current );
		assert.equal( advanceGauge( current, target ), Math.fround( current + delta * 10 * Math.fround( .01 ) ) );
	}
});
test("gauge ownership resets on rebind and retirement, retains on layout changes, and stops invalidating at rest", () => {
	const gauges = createGaugePresentation();
	gauges.begin();
	let row = gauges.read( "hp", 1, .5, "empty" );
	assert.equal( row.current, 0 );
	gauges.end();
	assert.equal( gauges.advance(), true );
	assert.ok( row.current > 0 && row.current < .5 );
	gauges.begin();
	assert.equal( gauges.read( "hp", 1, .5, "empty" ), row, "resource/viewport rebuild retains the control" );
	gauges.end();
	gauges.begin();
	row = gauges.read( "hp", 1, .1 );
	gauges.end();
	const before = row.current;
	assert.equal( gauges.advance(), true );
	assert.ok( row.current > before, "new target replaces old target without resetting current" );
	gauges.begin();
	row = gauges.read( "hp", 2, .8 );
	assert.equal( row.current, Math.fround( .8 ), "target rebind snaps" );
	gauges.end();
	assert.equal( gauges.advance(), false );
	gauges.begin();
	gauges.end();
	gauges.begin();
	row = gauges.read( "hp", 2, .3 );
	assert.equal( row.current, Math.fround( .3 ), "hidden controls retire" );
	gauges.end();
	gauges.reset();
	gauges.begin();
	row = gauges.read( "hp", 2, 1, "empty" );
	gauges.end();
	for ( let i = 0; i < 1000; i++ ) gauges.advance();
	assert.equal( gauges.advance(), false, "float32 fixed point must not invalidate forever" );
	assert.ok( row.current > .99999 );
	assert.equal( row.target, 1 );
});
