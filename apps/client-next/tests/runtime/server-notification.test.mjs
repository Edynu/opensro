/*
===========================================================================

server-notification.test.mjs - tests for gameplay.ts, system-notices.ts,
unique-banner.ts, chat-presentation.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { defined } from "../helpers/defined.mjs";
const { createGameplay } = await import(
	"../../src/engine/runtime/simulation/worker/session/world/gameplay/gameplay.ts"
);
const { serverNotification } = await import( "../../src/engine/foundation/gameplay/system-notices.ts" );
const { createNoticeBanner, notificationBannerPaths } = await import(
	"../../src/engine/runtime/ui/hud/unique-banner.ts"
);
const { chatLineText, chatLineColor } = await import( "../../src/engine/foundation/ui/chat-presentation.ts" );
test("server refusal reaches the independent native red notice and pink chat log", () => {
	const text = "This skill is not implemented yet.",
		bytes = Buffer.from( text, "utf16le" ),
		payload = Buffer.concat( [ Buffer.from( [ 7, text.length, 0 ] ), bytes ] );
	const game = createGameplay( () => {} );
	game.receive( { opcode: 0x3667, payload }, 100 );
	const state = game.take(),
		notice = defined( defined( state ).notices ).at( -1 ),
		line = defined( defined( state ).chat ).lines.at( -1 );
	assert.equal( defined( notice ).notificationBanner, true );
	assert.equal( defined( notice ).questBanner, undefined );
	assert.equal( defined( line ).text, text );
	assert.equal( chatLineText( line, () => "Notify" ), "(Notify):" + text );
	assert.deepEqual( chatLineColor( defined( line ).channel ), [ 1, 174 / 255, 195 / 255, 1 ] );
	const banner = createNoticeBanner( "notificationBanner" ), warning = createNoticeBanner();
	banner.step( defined( state ).notices, 100, true );
	warning.step( defined( state ).notices, 100, true );
	assert.equal( banner.value( () => "" ), text );
	assert.equal( banner.alpha(), 1 );
	assert.equal( warning.alpha(), 0 );
	assert.ok( notificationBannerPaths.every( p => p.includes( "/com_notice_" ) ) );
	banner.step( [], 6100, true );
	assert.equal( banner.alpha(), 127 / 255 );
	banner.step( [], 7100, true );
	assert.equal( banner.alpha(), 0 );
	for ( let n = 1; n < payload.length; n++ ) {
		assert.throws( () => serverNotification( 0x3667, payload.subarray( 0, n ) ) );
	}
	assert.throws( () => serverNotification( 0x3667, Buffer.concat( [ payload, Buffer.from( [ 0 ] ) ] ) ) );
});
