/*
===========================================================================

ground-visual.test.mjs - tests for ground-visual.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { groundVisualClock, groundVisualEvent, advanceGroundVisual } = await import(
	sourceFileUrl( "src/engine/foundation/animation/ground-visual.ts" ).href
);
test("a late completion schedules from the observed callback, not the nominal clip end", () => {
	const clock = groundVisualClock( 0, true );
	advanceGroundVisual( clock, 3, false, 1 );
	assert.equal( clock.pendingModel, true );
	assert.equal( clock.scheduledAt, 3000 );
	groundVisualEvent( clock, 100, 4000 );
	assert.equal( clock.scheduledAt, 3000 );
	advanceGroundVisual( clock, 3.0005, false, 1 );
	assert.equal( clock.pendingModel, true );
	advanceGroundVisual( clock, 3.002, false, 1 );
	assert.equal( clock.pendingModel, false );
	assert.ok( clock.time < .01 );
	groundVisualEvent( clock, 100, 4000 );
	assert.equal( clock.scheduledAt, null );
});
test("claim freezes animation, not an already registered timer; grouped spawns have no auxiliary holder", () => {
	const clock = groundVisualClock( 0, true );
	advanceGroundVisual( clock, .5, false, 1 );
	advanceGroundVisual( clock, 2, true, 1 );
	assert.equal( clock.time, .5 );
	assert.equal( clock.scheduledAt, null );
	groundVisualEvent( clock, 99, 2000 );
	assert.equal( clock.scheduledAt, null );
	groundVisualEvent( clock, 100, 2000 );
	advanceGroundVisual( clock, 2.002, true, 1 );
	assert.equal( clock.pendingModel, false );
	assert.equal( clock.time, 0 );
	const grouped = groundVisualClock( 0, false );
	groundVisualEvent( grouped, 100, 0 );
	advanceGroundVisual( grouped, 3, false, 1 );
	assert.equal( grouped.time, 3 );
	assert.equal( grouped.scheduledAt, null );
});
