/*
===========================================================================

cos-behavior.test.mjs - tests for gameplay.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { createGameplay } = await import(
	sourceFileUrl( "src/engine/runtime/simulation/worker/session/world/gameplay/gameplay.ts" ).href
);
function fixture() {
	const owner = createGameplay( () => {} );
	owner.bootstrap( { refObjSnapshot: [ { kind: "cos", refObjId: 102, tidWord: 0x21c6 } ] } );
	owner.take();
	// Band 4: gid, ref, hp, mp, command mode, empty name, status, dead, summon slot.
	owner.receive( {
		opcode: 0x3158,
		payload: Uint8Array.of(
			7,
			0,
			0,
			0,
			102,
			0,
			0,
			0,
			100,
			0,
			0,
			0,
			50,
			0,
			0,
			0,
			0x47,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			14
		)
	}, 0 );
	assert.equal( owner.take().cosRecords[0].commandMode, 0x47 );
	return owner;
}
const changed = Uint8Array.of( 1, 7, 0, 0, 0, 2, 0xc7, 0, 0, 0 );
test("native behavior acknowledgement updates the owning pet bitmask", () => {
	const owner = fixture();
	owner.receive( { opcode: 0xb05b, payload: changed }, 0 );
	assert.equal( owner.take().cosRecords[0].commandMode, 0xc7 );
	owner.receive( { opcode: 0xb05b, payload: Uint8Array.of( 2, 3 ) }, 0 );
	const state = owner.take();
	assert.equal( state.cosRecords[0].commandMode, 0xc7 );
	assert.equal( state.error, null );
	assert.deepEqual( state.notices, [], "native category 12/code 3 is silent" );
	owner.receive( { opcode: 0xb05b, payload: Uint8Array.of( 2, 6 ) }, 0 );
	const refused = owner.take();
	assert.equal( refused.cosRecords[0].commandMode, 0xc7 );
	assert.equal( refused.notices.at( -1 ).key, "UIIT_MSG_COSERR_YOU_DONT_HAVE_ACTIVE_COS_OBJ" );
});
test("malformed and wrong-family behavior results cannot mutate a pet", () => {
	const owner = fixture();
	for ( let n = 0; n < changed.length; n++ ) {
		assert.throws( () => owner.receive( { opcode: 0xb05b, payload: changed.slice( 0, n ) }, 0 ) );
		assert.equal( owner.take(), null );
	}
	for ( const field of [ 1, 5 ] ) {
		const p = changed.slice();
		p[field] = field === 1 ? 0 : 1;
		assert.throws( () => owner.receive( { opcode: 0xb05b, payload: p }, 0 ) );
		assert.equal( owner.take(), null );
	}
	const removed = changed.slice();
	removed[1] = 9;
	owner.receive( { opcode: 0xb05b, payload: removed }, 0 );
	assert.equal( owner.take(), null );
	owner.dispose();
});
