/*
===========================================================================

posture.test.mjs - tests for posture.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { transitionPosture: advance, postureLayers: layers } = await import(
	sourceFileUrl( "src/engine/foundation/animation/posture.ts" ).href
);
test("knockdown owns fall, held down, strict recovery timer and zero-entry wake", () => {
	let state = advance( undefined, { kind: "down", at: 1, recoveryMs: 2000 } );
	assert.deepEqual( layers( state, 1.2, 1 ).map( v => v.clip ), [ "down", "downwait" ] );
	assert.deepEqual( layers( state, 2.1, 1 ).map( v => v.clip ), [ "downwait" ] );
	assert.equal( advance( state, { kind: "down", at: 3, recoveryMs: 2000 } ), state );
	assert.equal( advance( state, { kind: "tick", at: 3.5, duration: 1 } ), state );
	state = advance( state, { kind: "tick", at: 3.501, duration: 1 } );
	assert.equal( state.kind, "recover" );
	assert.equal( layers( state, 3.501, 1 )[0].weight, 1 );
	assert.equal( layers( state, 3.501, 1 )[0].clip, "wakeup" );
	assert.equal( advance( state, { kind: "tick", at: 4.702, duration: 1 } ), undefined );
});
test("emote holds cursor during entry, exits over 200ms and cannot replace knockdown", () => {
	const state = advance( undefined, { kind: "emote", action: 6, at: 1 } );
	const entry = layers( state, 1.1, 1 )[0];
	assert.equal( entry.clip, "emote6" );
	assert.equal( entry.time, 0 );
	assert.ok( Math.abs( entry.weight - .5 ) < 1e-6 );
	assert.ok( Math.abs( layers( state, 2.3, 1 )[0].weight - .5 ) < 1e-6 );
	assert.equal( advance( state, { kind: "tick", at: 2.401, duration: 1 } ), undefined );
	const down = advance( state, { kind: "down", at: 2, recoveryMs: 1000 } );
	assert.equal( advance( down, { kind: "emote", action: 0, at: 2 } ), down );
	assert.equal( advance( down, { kind: "cancel" } ), undefined );
	assert.throws( () => advance( undefined, { kind: "down", at: 0, recoveryMs: NaN } ) );
});
