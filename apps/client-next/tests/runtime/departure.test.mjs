/*
===========================================================================

departure.test.mjs - tests for departure.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { root } from "../../tools/project.mjs";

const { createDeparture } = await import(
	sourceFileUrl( path.join( root, "src/engine/runtime/simulation/worker/session/world/departure.ts" ) ).href
);
test("retail countdown remains in world at zero and completes only on 315A", () => {
	for ( const type of [ 1, 2 ] ) {
		const frames = [], notices = [], d = createDeparture( f => frames.push( f ), n => notices.push( n ) );
		d.request( type );
		d.request( type );
		assert.equal( frames.length, 1 );
		assert.equal( frames[0].opcode, 0x70b7 );
		assert.deepEqual( [ ...frames[0].payload ], [ type ] );
		assert.equal( notices.length, 0 );
		assert.equal( d.receive( { opcode: 0xb0b7, payload: Uint8Array.of( 1, 5, type ) }, 100 ), 0 );
		d.step( 1099 );
		assert.deepEqual( notices.map( n => n.value ), [ 5 ] );
		d.step( 1100 );
		d.step( 2100 );
		d.step( 3100 );
		d.step( 4100 );
		d.step( 5100 );
		d.step( 99999 );
		assert.deepEqual( notices.map( n => n.value ), [ 5, 4, 3, 2, 1 ] );
		assert.ok( notices.every( n => n.banner && n.key === "UIIT_MSG_LOGOUT_REMAIN_TIME" ) );
		assert.equal( d.receive( { opcode: 0x315a, payload: new Uint8Array() }, 100000 ), type );
		assert.throws( () => d.receive( { opcode: 0x315a, payload: new Uint8Array() }, 100001 ), /Unexpected/ );
	}
});
test("refusal clears the pending request and publishes recovered native errors", () => {
	const frames = [], notices = [], d = createDeparture( f => frames.push( f ), n => notices.push( n ) );
	for ( const code of [ 1, 2 ] ) {
		d.request( 2 );
		d.receive( { opcode: 0xb0b7, payload: Uint8Array.of( 2, code ) }, 0 );
	}
	assert.equal( frames.length, 2 );
	assert.deepEqual( notices.map( n => n.key ), [
		"UIIT_MSG_LOGOUT_ERR_CANT_LOGOUT_IN_BATTLE_STATE",
		"UIIT_MSG_LOGOUT_ERR_CANT_LOGOUT_WHILE_TELEPORT_WORKING"
	] );
	for ( const p of [ [ 1 ], [ 1, 5, 0 ], [ 1, 5, 2, 9 ], [ 2 ], [ 2, 1, 9 ] ] ) {
		assert.throws( () => d.receive( { opcode: 0xb0b7, payload: Uint8Array.from( p ) }, 0 ) );
	}
});
