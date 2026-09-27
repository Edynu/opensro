/*
===========================================================================

avatar-override-selection.test.mjs - tests for avatar-override.ts,
locomotion-blend.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { selectAvatarOverride } = await import( "../../src/engine/foundation/animation/avatar-override.ts" );
const { changeLocomotion, locomotionLayers } = await import(
	"../../src/engine/foundation/animation/locomotion-blend.ts"
);
const rows = {
	1: { animation: "avatar_wing", priority: 50 },
	2: { animation: "avatar_wing", priority: 50 },
	3: { animation: "other", priority: 10 },
	4: { animation: "", priority: 0 },
	5: { animation: "last", priority: 255 }
};
test("override selection preserves surviving historical ties and restores after removal", () => {
	let s = selectAvatarOverride( undefined, [ 1, 2, 4, 5 ], rows );
	assert.equal( s.selected, 1 );
	s = selectAvatarOverride( s, [ 2, 1, 4, 5 ], rows );
	assert.equal( s.selected, 1 );
	assert.deepEqual( s.order, [ 1, 2, 4, 5 ] );
	s = selectAvatarOverride( s, [ 2, 3, 5 ], rows );
	assert.equal( s.selected, 3 );
	s = selectAvatarOverride( s, [ 1, 2, 5 ], rows );
	assert.equal( s.selected, 2 );
	assert.deepEqual( s.order, [ 2, 5, 1 ] );
	s = selectAvatarOverride( s, [ 5 ], rows );
	assert.equal( s.selected, 5 );
	s = selectAvatarOverride( s, [], rows );
	assert.equal( s.selected, undefined );
	assert.deepEqual( s.order, [] );
});
test("same clip override identity change restarts once and preserves outgoing blend", () => {
	const old = changeLocomotion( undefined, "native:avatar_wing:7", true, 0, "run" );
	assert.equal( changeLocomotion( old, old.clip, true, 1, "run" ), old );
	const next = changeLocomotion( old, old.clip, true, 1, "run", true );
	assert.notEqual( next.activation, old.activation );
	assert.equal( next.started, 1 );
	const layers = locomotionLayers( next, 1.05 );
	assert.equal( layers.length, 2 );
	assert.ok( layers.some( l => l.activation === old.activation ) );
	assert.ok( layers.some( l => l.activation === next.activation ) );
	assert.equal( changeLocomotion( next, next.clip, true, 1.1, "run" ), next );
	assert.equal( locomotionLayers( next, 1.21 ).length, 1 );
});
