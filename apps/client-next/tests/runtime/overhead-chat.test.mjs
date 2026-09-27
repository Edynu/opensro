/*
===========================================================================

overhead-chat.test.mjs - tests for speech.ts, chat.ts, text-lines.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { defined } from "../helpers/defined.mjs";
const { createSpeech } = await import( "../../src/engine/runtime/ui/hud/speech.ts" );
const { createChat } = await import( "../../src/engine/runtime/simulation/worker/session/world/gameplay/chat/chat.ts" );
test("accepted self chat owns one ten-second board; retained frames and duplicate acknowledgements cannot rearm it", () => {
	const chat = createChat( () => {} ), speech = createSpeech(), players = [ { gid: 1, name: "Me" } ];
	chat.bootstrap( { character: { name: "Me" } } );
	chat.request( 1, "hello", "", 0 );
	assert.equal( speech.step( chat.state().lines, players, 0 ).size, 0 );
	const ack = { opcode: 0xb367, payload: Uint8Array.of( 1, 1, 255 ) };
	chat.receive( ack, 1 );
	chat.receive( ack, 1 );
	assert.equal( chat.state().lines.length, 1 );
	assert.equal( defined( speech.step( chat.state().lines, players, 100 ).get( 1 ) ).text, "hello" );
	assert.equal( speech.deadline(), 10100 );
	assert.equal( speech.step( chat.state().lines, players, 10099 ).size, 1 );
	assert.equal( speech.step( chat.state().lines, players, 10100 ).size, 0 );
	chat.request( 1, "hello", "", 10101 );
	chat.receive( ack, 1 );
	assert.equal( speech.step( chat.state().lines, players, 10102 ).size, 1 );
	assert.equal( speech.step( chat.state().lines, [], 10103 ).size, 0 );
	assert.equal( speech.step( chat.state().lines, players, 10104 ).size, 0 );
	speech.reset();
	assert.equal( speech.deadline(), Infinity );
});
test("private/group channels never become overhead speech; a new public message replaces only its speaker", () => {
	const owner = createSpeech(), players = [ { gid: 1, name: "Me" }, { gid: 2, name: "Peer" } ];
	const line = ( sequence, channel, gid, text = "hello" ) => ({
		sequence,
		channel,
		gid,
		text,
		name: "Peer",
		outgoing: false
	});
	assert.equal( owner.step( [ line( 1, 1, 1 ), line( 2, 3, 2 ) ], players, 0 ).size, 2 );
	owner.step( [ line( 3, 2, 1 ), line( 4, 4, 1 ), line( 5, 5, 1 ), line( 6, 11, 1 ) ], players, 1000 );
	assert.equal( owner.deadline(), 10000 );
	assert.equal( defined( owner.step( [ line( 7, 6, undefined, "new" ) ], players, 2000 ).get( 2 ) ).text, "new" );
	const remaining = owner.step( [], players, 10000 );
	assert.equal( remaining.has( 1 ), false );
	assert.equal( remaining.has( 2 ), true );
});

const { textBoardLines } = await import( "../../src/engine/foundation/ui/text-lines.ts" );
test("native boards wrap glyphs and preserve boundary spaces, newlines and long tokens", () => {
	const measure = s => s.length;
	assert.deepEqual( textBoardLines( "one two", 5, measure ), [ "one t", "wo" ] );
	assert.deepEqual( textBoardLines( "  a  b ", 4, measure ), [ "  a ", " b " ] );
	assert.deepEqual( textBoardLines( "a\n\nb\n", 5, measure ), [ "a", "", "b", "" ] );
	assert.deepEqual( textBoardLines( "abcdefgh", 3, measure ), [ "abc", "def", "gh" ] );
});
