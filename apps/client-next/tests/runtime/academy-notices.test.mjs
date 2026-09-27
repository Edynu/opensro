/*
===========================================================================

academy-notices.test.mjs - tests for gameplay.ts, native-notice.ts,
academy.ts, windows1252.ts

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
const { constantNativeNotice } = await import( "../../src/engine/foundation/gameplay/native-notice.ts" );
const opcodes = [ 0xb4d4, 0xb785, 0xb10a, 0xb36d, 0xb220 ];
test("authoritative academy notice push atomically replaces text and publishes the native notice window", () => {
	const g = createGameplay( () => {} );
	g.bootstrap( { academyMember: true } );
	g.seed( { gid: 1, regionId: 1, x: 0, y: 0, z: 0, heading: 0 } );
	let state = g.take();
	const before = state;
	// Hand-authored little-endian lengths and Windows-1252 e-acute.
	const payload = Uint8Array.of( 7, 4, 0, 67, 97, 102, 233, 5, 0, 72, 101, 108, 108, 111 );
	assert.equal( g.receive( { opcode: 0x3ac5, payload }, 0 ), true );
	state = g.take();
	assert.equal( defined( defined( state ).academy ).subject, "Café" );
	assert.equal( defined( defined( state ).academy ).contents, "Hello" );
	assert.deepEqual( { ...defined( state ).academy, subject: undefined, contents: undefined }, {
		...defined( before ).academy,
		subject: undefined,
		contents: undefined
	} );
	assert.deepEqual( { ...defined( defined( state ).notices ).at( -1 ), sequence: undefined }, {
		key: "UIIT_MSG_TC_COMMON_KNOW_REMIND_UPDATE",
		value: 0,
		notificationBanner: true,
		bannerOnly: true,
		sequence: undefined
	} );
	for ( let size = 1; size < payload.length; size++ ) {
		assert.throws( () => g.receive( { opcode: 0x3ac5, payload: payload.slice( 0, size ) }, 0 ) );
		assert.equal( g.take(), null );
	}
	assert.throws(
		() => g.receive( { opcode: 0x3ac5, payload: Uint8Array.from( [ ...payload, 0 ] ) }, 0 ),
		/Trailing academy notice/
	);
	assert.equal( g.take(), null );
	g.receive( { opcode: 0x3ac5, payload: Uint8Array.of( 7, 0, 0, 0, 0 ) }, 0 );
	state = g.take();
	assert.equal( defined( defined( state ).academy ).subject, "" );
	assert.equal( defined( defined( state ).academy ).contents, "" );
	assert.equal( defined( defined( state ).notices ).length, 2, "each authoritative update has its own notification" );
});
test("academy lifecycle acknowledgments route every refusal independently of membership bootstrap", () => {
	for ( const opcode of opcodes ) {
		for ( const bootstrap of [ {}, { academyMember: true } ] ) {
			const g = createGameplay( () => {} );
			g.bootstrap( bootstrap );
			g.seed( { gid: 1, regionId: 1, x: 0, y: 0, z: 0, heading: 0 } );
			let state = g.take();
			const original = state;
			for ( let code = 0; code < 256; code++ ) {
				const before = defined( state ).notices;
				assert.equal( g.receive( { opcode, payload: Uint8Array.of( 2, code ) }, 0 ), true );
				state = g.take() ?? state;
				const expected = constantNativeNotice( 29, code );
				if ( expected ) {
					assert.deepEqual( { ...defined( defined( state ).notices ).at( -1 ), sequence: undefined }, {
						...expected,
						sequence: undefined
					} );
				} else assert.deepEqual( defined( state ).notices, before );
				for ( const key of [ "academy", "inventory", "vitals", "social" ] ) {
					assert.deepEqual( defined( state )[key], defined( original )[key] );
				}
			}
		}
	}
});
test("academy notice success uses the native notice window while sibling successes and unknown flags stay silent", () => {
	const g = createGameplay( () => {} );
	g.bootstrap( { academyMember: true } );
	g.seed( { gid: 1, regionId: 1, x: 0, y: 0, z: 0, heading: 0 } );
	let state = g.take();
	for ( const opcode of opcodes ) {
		g.receive( { opcode, payload: Uint8Array.of( 1 ) }, 0 );
		const next = g.take();
		if ( opcode === 0xb220 ) {
			assert.ok( next );
			assert.deepEqual( { ...defined( next.notices ).at( -1 ), sequence: undefined }, {
				key: "UIIT_MSG_TC_COMMON_KNOW_REMIND_UPDATE",
				value: 0,
				notificationBanner: true,
				bannerOnly: true,
				sequence: undefined
			} );
			assert.deepEqual( next.academy, defined( state ).academy );
			state = next;
		} else assert.equal( next, null );
		for ( const flag of [ 0, 3, 255 ] ) {
			g.receive( { opcode, payload: Uint8Array.of( flag ) }, 0 );
			assert.equal( g.take(), null );
		}
	}
	for ( const opcode of opcodes ) {
		for ( const payload of [ [], [ 2 ], [ 1, 0 ], [ 2, 23, 0 ] ] ) {
			assert.throws(
				() => g.receive( { opcode, payload: Uint8Array.from( payload ) }, 0 ),
				/Invalid academy acknowledgment/
			);
			assert.equal( g.take(), null );
		}
	}
});

const { academyNoticeRequest } = await import( "../../src/engine/foundation/gameplay/academy.ts" );
const { encodeWindows1252 } = await import( "../../src/engine/foundation/gameplay/windows1252.ts" );
test("web ANSI writer matches every UTF-16 unit in the captured Windows oracle", async () => {
	const { readFile } = await import( "node:fs/promises" );
	const captured = await readFile( "../server/internal/game/item/wire/testdata/windows1252.bin" );
	for ( let start = 0; start < 65536; start += 1024 ) {
		const text = String.fromCharCode( ...Array.from( { length: 1024 }, ( _, i ) => start + i ) );
		assert.deepEqual( encodeWindows1252( text ), new Uint8Array( captured.subarray( start, start + 1024 ) ) );
	}
	assert.deepEqual( [ ...encodeWindows1252( "\u{1f600}" ) ], [ 63, 63 ] );
});
test("academy notice command preserves native preflight, punctuation conversion and byte lengths", () => {
	for ( const [subject, contents] of [ [ "", "" ], [ "", "body" ], [ "subject", "" ], [ "\0hidden", "body" ] ] ) {
		assert.equal( academyNoticeRequest( subject, contents ), null );
	}
	assert.deepEqual( academyNoticeRequest( "Caf\xe9;", "\u20ac\u0100\u{1f600}" ), {
		opcode: 0x7220,
		payload: Uint8Array.of( 5, 0, 67, 97, 102, 233, 32, 4, 0, 128, 65, 63, 63 )
	} );
	assert.deepEqual( [ ...defined( academyNoticeRequest( "\"'", "body\0ignored" ) ).payload ], [
		2,
		0,
		32,
		32,
		4,
		0,
		98,
		111,
		100,
		121
	] );
	assert.ok( academyNoticeRequest( " ", " " ), "whitespace is not empty" );
	assert.throws( () => academyNoticeRequest( "a".repeat( 65536 ), "body" ), /wire string/ );
	const sent = [], g = createGameplay( f => sent.push( f ) );
	g.bootstrap( { academyMember: true } );
	g.seed( { gid: 1, regionId: 1, x: 0, y: 0, z: 0, heading: 0 } );
	const before = g.take();
	for ( const [subject, contents] of [ [ "", "body" ], [ "subject", "" ] ] ) {
		assert.equal( g.command( { kind: "academy-notice", subject, contents }, 0 ), null );
		const state = g.take();
		assert.deepEqual( { ...defined( defined( state ).notices ).at( -1 ), sequence: undefined }, {
			...constantNativeNotice( 29, 23 ),
			sequence: undefined
		} );
		assert.deepEqual( defined( state ).academy, defined( before ).academy );
	}
	assert.equal( sent.length, 0 );
	const frame = g.command( { kind: "academy-notice", subject: "Valid", contents: "Contents" }, 0 );
	assert.deepEqual( sent, [ frame ] );
	assert.equal( defined( frame ).opcode, 0x7220 );
	assert.deepEqual(
		g.take()?.academy ?? defined( before ).academy,
		defined( before ).academy,
		"no optimistic notice mutation"
	);
});
