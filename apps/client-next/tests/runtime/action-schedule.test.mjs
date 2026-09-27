/*
===========================================================================

action-schedule.test.mjs - tests for the client modules it imports

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
async function load( file ) {
	return import( sourceFileUrl( file ).href );
}
const { advanceAction } = await load( "src/engine/foundation/animation/action-schedule.ts" );
const { createCombat } = await load( "src/engine/runtime/simulation/worker/session/world/gameplay/combat/combat.ts" );
const phase = clip => ({
	clip,
	definition: {
		durationMs: 1000,
		trackEvents: [ { cursorMs: 200, eventCode: 1, param0: 0, param1: 0 } ],
		soundEvents: [],
		timeWarpCurve: { scale: 0, records: [] }
	}
});
const clock = phases => ({ phases, phase: 0, started: 0, previous: 0, entered: false });
test("READY callbacks precede WAIT, which holds until the server releases SHOT", () => {
	const c = clock( [ phase( "ready" ), phase( "wait" ), phase( "shot" ) ] );
	assert.deepEqual( advanceAction( c, 0 ).events, [ { phase: "READY", event: 0, at: 0 } ] );
	assert.deepEqual( advanceAction( c, .201 ).events, [ { phase: "READY", event: 1, at: .2 } ] );
	assert.deepEqual( advanceAction( c, 1 ).events, [ { phase: "WAIT", event: 0, at: 1 } ] );
	assert.equal( advanceAction( c, 10 ).loop, true );
	assert.equal( c.phase, 1 );
	const released = advanceAction( c, 10.3, 10 );
	assert.deepEqual( released.events, [ { phase: "SHOT", event: 0, at: 10 }, { phase: "SHOT", event: 1, at: 10.2 } ] );
	assert.deepEqual( advanceAction( c, 10.3, 10 ).events, [] );
	advanceAction( c, 11 );
	assert.equal( c.phase, 3 );
});
test("empty phases fire once; late frames preserve event times and release can interrupt READY", () => {
	const c = clock( [ null, null, phase( "shot" ) ] );
	assert.deepEqual( advanceAction( c, 2 ).events.map( e => [ e.phase, e.event, e.at ] ), [
		[ "READY", 0, 0 ],
		[ "WAIT", 0, 0 ],
		[ "SHOT", 0, 0 ],
		[ "SHOT", 1, .2 ]
	] );
	assert.deepEqual( advanceAction( c, 3 ).events, [] );
	const d = clock( [ phase( "ready" ), phase( "wait" ), phase( "shot" ) ] );
	const events = advanceAction( d, .6, .1 ).events;
	assert.deepEqual( events.map( e => [ e.phase, e.event ] ), [ [ "READY", 0 ], [ "SHOT", 0 ], [ "SHOT", 1 ] ] );
	assert.equal( d.started, .1 );
});
test("a B505 release cannot hold or restart SHOT when WAIT has no motion (8DF180)", () => {
	const c = clock( [ null, null, phase( "shot" ) ] );
	assert.deepEqual( advanceAction( c, 0 ).events.map( e => e.phase ), [ "READY", "WAIT", "SHOT" ] );
	assert.deepEqual( advanceAction( c, .3, .25 ).events, [ { phase: "SHOT", event: 1, at: .2 } ] );
	assert.equal( c.started, 0, "empty WAIT does not change the authored callback origin" );
	assert.deepEqual( advanceAction( c, .4, .25 ).events, [] );
});

test("B505 no-steering release is retained once, finalization removes it, malformed packets do not mutate", () => {
	const combat = createCombat(), p = new Uint8Array( 42 ), v = new DataView( p.buffer );
	p[0] = 1;
	v.setUint32( 2, 7, true );
	v.setUint32( 6, 1, true );
	v.setUint32( 10, 3, true );
	v.setUint32( 14, 2, true );
	p[18] = 9;
	p[19] = p[20] = 1;
	v.setUint32( 21, 2, true );
	assert.equal( combat.receive( 0xb245, p, 100 ), true );
	const release = new Uint8Array( 10 ), r = new DataView( release.buffer );
	release[0] = 1;
	r.setUint32( 1, 3, true );
	r.setUint32( 5, 2, true );
	combat.receive( 0xb505, release, 200 );
	combat.receive( 0xb505, release, 300 );
	assert.equal( combat.state().casts[0].shotAtMs, 200 );
	assert.throws( () => combat.receive( 0xb505, release.slice( 0, 9 ) ), /Truncated/ );
	release[9] = 8;
	assert.throws( () => combat.receive( 0xb505, release ), /Truncated/ );
	assert.equal( combat.state().casts[0].shotAtMs, 200 );
	const stop = Uint8Array.of( 2, 0, 3, 0, 0, 0 );
	combat.receive( 0xb505, stop, 400 );
	assert.equal( combat.state().casts[0].cancelledAtMs, 400 );
	combat.receive( 0xb505, stop, 500 );
	combat.step( 599 );
	assert.equal( combat.state().casts.length, 1 );
	combat.step( 600 );
	assert.deepEqual( combat.state().casts, [] );
});

test("cancellation caps callbacks and preserves an exit cursor without replay", () => {
	const c = clock( [ phase( "ready" ), phase( "wait" ), phase( "shot" ) ] );
	assert.deepEqual( advanceAction( c, 10, undefined, .1 ).events, [ { phase: "READY", event: 0, at: 0 } ] );
	assert.equal( c.cancelledAt, .1 );
	assert.deepEqual( advanceAction( c, 20 ).events, [] );
	assert.equal( advanceAction( c, 20 ).time, .1 );
});

test("action entry, phase change, natural end and early cancellation retain native blend envelopes", async () => {
	const { actionLayers } = await load( "src/engine/foundation/animation/action-schedule.ts" );
	const c = clock( [ null, null, phase( "attack" ) ] );
	advanceAction( c, 0 );
	assert.deepEqual( actionLayers( c, 0 ), [] );
	assert.ok( Math.abs( actionLayers( c, .1 )[0].weight - .5 ) < 1e-9 );
	advanceAction( c, 1 );
	assert.equal( c.phase, 3 );
	assert.equal( actionLayers( c, 1 )[0].clip, "attack" );
	assert.equal( actionLayers( c, 1 )[0].weight, 1 );
	assert.ok( Math.abs( actionLayers( c, 1.1 )[0].weight - .5 ) < 1e-9 );
	assert.deepEqual( actionLayers( c, 1.201 ), [] );
	const d = clock( [ phase( "ready" ), phase( "wait" ), phase( "shot" ) ] );
	advanceAction( d, 0 );
	advanceAction( d, 1.1 );
	const transition = actionLayers( d, 1.1 );
	assert.deepEqual( transition.map( x => x.clip ), [ "wait", "ready" ] );
	assert.ok( transition.every( x => Math.abs( x.weight - .5 ) < 1e-9 ) );
	const e = clock( [ null, null, phase( "attack" ) ] );
	advanceAction( e, 0 );
	advanceAction( e, .1, undefined, .1 );
	assert.ok( Math.abs( actionLayers( e, .1 )[0].weight - .5 ) < 1e-9 );
	assert.ok( Math.abs( actionLayers( e, .2 )[0].weight - .25 ) < 1e-9 );
	assert.deepEqual( actionLayers( e, .301 ), [] );
});
