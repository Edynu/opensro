/*
===========================================================================

whisper-block.test.mjs - tests for chat.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { createChat } = await import(
	sourceFileUrl( "src/engine/runtime/simulation/worker/session/world/gameplay/chat/chat.ts" ).href
);
function message( channel, name = "Blocked" ) {
	const n = Buffer.from( name ), text = Buffer.from( "Hello", "utf16le" );
	return {
		opcode: 0x3667,
		payload: Buffer.concat( [ Buffer.from( [ channel, n.length, 0 ] ), n, Buffer.from( [ 5, 0 ] ), text ] )
	};
}
function result( mode, code, name = "Blocked" ) {
	const n = Buffer.from( name );
	return {
		opcode: 0xb66f,
		payload: code ? Uint8Array.of( mode, code ) : Buffer.concat( [ Buffer.from( [ mode, 0, n.length, 0 ] ), n ] )
	};
}
test("persistent whisper list is separate from the local social-message filter and resets on login", () => {
	const c = createChat( () => {} );
	c.bootstrap( { character: { name: "Me", blockedWhisperers: [ "Blocked" ] } } );
	for ( const channel of [ 4, 5, 11 ] ) c.receive( message( channel ), 1 );
	assert.equal( c.state().lines.length, 3, "whisper blocks do not hide party, guild or union messages" );
	assert.deepEqual( c.state().blocked, [ "Blocked" ] );
	c.bootstrap( { character: { name: "Me" } } );
	assert.deepEqual( c.state().blocked, [] );
	c.clear();
	assert.deepEqual( c.state().blocked, [] );
});
test("whisper option suppresses incoming and acknowledged outgoing display independently of block list", () => {
	const c = createChat( () => {} );
	c.bootstrap( { character: { name: "Me" } } );
	c.options( false );
	c.receive( message( 2 ), 1 );
	c.request( 2, "Hello", "Peer", 0 );
	c.receive( { opcode: 0xb367, payload: Uint8Array.of( 1, 2, 255 ) }, 1 );
	assert.equal( c.state().pending, false );
	assert.equal( c.state().lines.length, 0 );
	c.receive( message( 4 ), 1 );
	assert.equal( c.state().lines.length, 1 );
});
test("native block mutation commits only on success; all message and no-op result branches", () => {
	let closed = true;
	const sent = [],
		c = createChat( f => {
			if ( closed ) throw Error( "closed" );
			sent.push( f );
		} );
	c.bootstrap( {} );
	assert.throws( () => c.block( "Blocked", true ), /closed/ );
	assert.equal( c.state().blockPending, false );
	closed = false;
	c.block( "Blocked", true );
	assert.equal( sent[0].opcode, 0x766f );
	assert.deepEqual( [ ...sent[0].payload ], [ 1, 7, 0, ...Buffer.from( "Blocked" ) ] );
	assert.deepEqual( c.state().blocked, [] );
	c.receive( result( 1, 0 ), 1 );
	assert.deepEqual( c.state().blocked, [ "Blocked" ] );
	c.receive( result( 1, 0 ), 1 );
	assert.deepEqual( c.state().blocked, [ "Blocked" ] );
	for ( const code of [ 1, 2, 3, 4 ] ) c.receive( result( 1, code ), 1 );
	assert.deepEqual( c.state().feedback.map( r => r.key ), [
		"UIIT_MSG_COSPETERR_PETNAME_SUMENESS",
		"UIIT_MSG_ALIAS_ACTION_ERR_NOTALLOW",
		"UIIT_STT_BLOCKMAN_DELETE_LISTFULL"
	] );
	assert.throws( () => c.receive( { opcode: 0xb66f, payload: Uint8Array.of( 2, 0, 7, 0 ) }, 1 ) );
	assert.deepEqual( c.state().blocked, [ "Blocked" ] );
	c.block( "Blocked", false );
	assert.equal( sent.at( -1 ).payload[0], 2 );
	c.receive( result( 2, 0 ), 1 );
	assert.deepEqual( c.state().blocked, [] );
	assert.equal( c.state().blockPending, false );
});

test("local blocks filter incoming named channels, preserve exact case and survive session reset", () => {
	const c = createChat( () => {} );
	c.chatBlocks( [ "Blocked" ] );
	c.bootstrap( { character: { name: "Me" } } );
	for ( const channel of [ 2, 4, 5, 11 ] ) {
		c.receive( message( channel ), 1 );
		c.receive( message( channel, "blocked" ), 1 );
	}
	assert.equal( c.state().lines.length, 4 );
	assert.ok( c.state().lines.every( l => l.name === "blocked" ) );
	for ( const channel of [ 1, 3 ] ) {
		const p = Buffer.concat( [ Buffer.from( [ channel, 2, 0, 0, 0, 5, 0 ] ), Buffer.from( "Hello", "utf16le" ) ] );
		c.receive( { opcode: 0x3667, payload: p }, 1, "Blocked" );
	}
	assert.equal(
		c.state().lines.length,
		4,
		"GID names resolved by the entity owner use the same filter, including GM channel 3"
	);
	c.request( 2, "Hello", "Blocked", 0 );
	c.receive( { opcode: 0xb367, payload: Uint8Array.of( 1, 2, 255 ) }, 1 );
	assert.equal( c.state().lines.at( -1 ).outgoing, true );
	c.clear();
	c.bootstrap( {} );
	c.receive( message( 4 ), 1 );
	assert.equal( c.state().lines.length, 0 );
	c.chatBlocks( [] );
	c.receive( message( 4 ), 1 );
	assert.equal( c.state().lines.length, 1 );
	assert.throws( () => c.chatBlocks( [ "[GM]" ] ), /Invalid/ );
	assert.throws( () => c.chatBlocks( [ "A", "A" ] ), /Invalid/ );
	c.chatBlocks( [ "A", "a" ] );
});
test("whisper timeout retains its request slot until receipt or a fresh entry", () => {
	const sent = [], c = createChat( f => sent.push( f ) );
	c.bootstrap( {} );
	c.block( "Peer", true, 100 );
	assert.equal( c.step( 10099 ), false );
	assert.equal( c.step( 10100 ), true );
	assert.match( c.state().blockError, /Reconnect/ );
	assert.equal( c.step( 10101 ), false );
	c.block( "Other", true, 12000 );
	assert.equal( sent.length, 1 );
	c.receive( result( 1, 0, "Peer" ), 1 );
	assert.equal( c.state().blockError, null );
	assert.equal( c.state().blockPending, false );
	assert.deepEqual( c.state().blocked, [ "Peer" ] );
	c.block( "Other", true, 20000 );
	c.step( 30000 );
	c.bootstrap( { character: { blockedWhisperers: [ "Peer" ] } } );
	assert.equal( c.state().blockError, null );
	assert.equal( c.state().blockPending, false );
});
