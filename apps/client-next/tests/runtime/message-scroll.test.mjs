/*
===========================================================================

message-scroll.test.mjs - tests for scroll.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { createMessageScroll } = await import( sourceFileUrl( "src/engine/runtime/ui/hud/scroll.ts" ).href );
test("small drag increments accumulate and all message inputs share the rendered range", () => {
	const scroll = createMessageScroll( "chat-scroll" );
	scroll.geometry( { range: 10, travel: 100, bounds: [ 20, 30, 100, 50 ] } );
	for ( let i = 0; i < 20; i++ ) scroll.event( { kind: "drag", id: "chat-scroll-thumb", dx: 0, dy: -1 } );
	assert.equal( scroll.offset(), 2, "twenty sub-row increments are not discarded" );
	assert.equal( scroll.event( { kind: "scroll", x: 10, y: 40, delta: -1 } ), false );
	assert.equal( scroll.offset(), 2 );
	scroll.event( { kind: "scroll", x: 30, y: 40, delta: -1 } );
	assert.equal( scroll.offset(), 5 );
	scroll.event( { kind: "activate", id: "chat-scroll-down" } );
	assert.equal( scroll.offset(), 4 );
	scroll.geometry( { range: 2, travel: 100, bounds: [ 20, 30, 100, 50 ] } );
	assert.equal( scroll.offset(), 2 );
	scroll.event( { kind: "drag", id: "chat-scroll-thumb", dx: 0, dy: 10000 } );
	assert.equal( scroll.offset(), 0 );
	scroll.reset();
	assert.equal( scroll.event( { kind: "scroll", x: 30, y: 40, delta: -1 } ), false );
});
test("scroll instances cannot consume each others thumb or button commands", () => {
	const chat = createMessageScroll( "chat-scroll" ), status = createMessageScroll( "status-scroll" );
	for ( const owner of [ chat, status ] ) owner.geometry( { range: 30, travel: 120, bounds: [ 0, 0, 100, 100 ] } );
	const event = { kind: "activate", id: "status-scroll-up" };
	assert.equal( chat.event( event ), false );
	assert.equal( status.event( event ), true );
	assert.equal( chat.offset(), 0 );
	assert.equal( status.offset(), 1 );
});
