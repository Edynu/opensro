/*
===========================================================================

status-presentation.test.mjs - tests for status-presentation.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { stepStatus, createStatusOwner, statusCodes } = await import(
	sourceFileUrl( "src/engine/foundation/animation/status-presentation.ts" ).href
);
test("frostbite sets the playback scale to 0.5 and clearing it restores 1", () => {
	const set = stepStatus( undefined, 0x2, 0 );
	assert.equal( set.rate, 0.5 );
	assert.deepEqual( set.names, [ "PARAM_FB" ] );
	const cleared = stepStatus( set, 0, 0 );
	assert.equal( cleared.rate, 1 );
	assert.deepEqual( cleared.names, [] );
});
test("clearing one tint resets the material while the later tint bit stays", () => {
	const burn = stepStatus( undefined, 0x8, 0 );
	const both = stepStatus( burn, 0x8 | 0x4000, 0 );
	assert.equal( both.tint.from[2], Math.fround( 64 / 255 ) );
	const stunOnly = stepStatus( both, 0x4000, 0 );
	assert.equal( stunOnly.tint, null );
	assert.deepEqual( stunOnly.names, [ "PARAM_STUN" ] );
});
test("darkness attaches PARAM_DN and freeze locks the pose", () => {
	const dark = stepStatus( undefined, 0x2000, 0 );
	assert.deepEqual( dark.names, [ "PARAM_DN" ] );
	const frozen = stepStatus( undefined, 1, 0 );
	assert.equal( frozen.poseLocked, true );
	assert.equal( stepStatus( frozen, 0, 0 ).poseLocked, false );
});
test("combustion is bit 0x400000; 0x800000 and 0x1000 have no code", () => {
	assert.deepEqual( stepStatus( undefined, 0x400000, 0 ).names, [ "PARAM_CURSIE_MP" ] );
	assert.deepEqual( stepStatus( undefined, 0x800000 | 0x1000, 0 ).names, [] );
	assert.deepEqual( stepStatus( undefined, 0x1000000, 0 ).names, [ "PARAM_TIME_BOMB" ] );
});
test("slow scales playback by 0.75 and clearing either scale bit restores 1", () => {
	const slow = stepStatus( undefined, 0x100, 0 );
	assert.equal( slow.rate, 0.75 );
	assert.equal( slow.tint, undefined );
	assert.equal( stepStatus( stepStatus( slow, 0x102, 0 ), 0x100, 0 ).rate, 1 );
});
test("body visual 1 skips the material calls but not speed or pose", () => {
	const s = stepStatus( undefined, 0x4000 | 0x2 | 0x1, 1 );
	assert.equal( s.tint, undefined );
	assert.equal( s.rate, 0.5 );
	assert.equal( s.poseLocked, true );
});
test("one owner steps a character once per mask and both readers see it", () => {
	const owner = createStatusOwner();
	const first = owner.view( 7, 0x2, 0 );
	const second = owner.view( 7, 0x2, 1 );
	assert.equal( first, second );
	assert.equal( first.rate, 0.5 );
	const changed = owner.view( 7, 0, 0 );
	assert.equal( changed.rate, 1 );
	assert.notEqual( changed, first );
	assert.equal( statusCodes()[22], "CURSIE_MP" );
	assert.equal( statusCodes()[12], "" );
	assert.equal( statusCodes()[23], "" );
});
