import { test } from "node:test";
import assert from "node:assert/strict";
import { captureFrameWindow } from "../../tools/lib/frame-window.mjs";
import { defined } from "../helpers/defined.mjs";
test("movement commands and observations stay inside the browser measurement window", async t => {
	const keys = [
			"performance",
			"requestAnimationFrame",
			"__worldProbeRoot",
			"__worldProbeFrameTelemetry",
			"__worldProbeFrameProfiler",
			"__worldProbeCompletedWindow"
		],
		old = new Map( keys.map( k => [ k, Object.getOwnPropertyDescriptor( globalThis, k ) ] ) );
	t.after( () => {
		for ( const [k, d] of old ) {
			if ( d ) Object.defineProperty( globalThis, k, d );
			else delete globalThis[k];
		}
	} );
	for ( const frameMs of [ 1000 / 240, 1000 / 60, 173 ] ) {
		let at = 0, callback;
		const sent = [];
		Object.defineProperty( globalThis, "performance", { configurable: true, value: { now: () => 0, mark() {} } } );
		globalThis.requestAnimationFrame = f => {
			callback = f;
		};
		globalThis.__worldProbeRoot = {
			session: command => sent.push( { at, command } ),
			gameplay: () => ({ pose: { x: at / 20 }, moving: true })
		};
		const movement = { original: { x: 0 }, destination: { x: 120 } },
			pending = captureFrameWindow( { duration: 6000, name: "movement", movement } );
		while ( callback ) {
			const next = callback;
			callback = null;
			at += frameMs;
			globalThis.__worldProbeFrameTelemetry = { cpuMs: 1 };
			next( at );
		}
		const result = await pending;
		assert.equal( sent.length, 4 );
		assert.ok( sent.every( r => r.at < 6000 ) );
		assert.ok( result.end >= 6000 && result.end < 6000 + frameMs + 1e-6 );
		assert.deepEqual( sent.map( r => r.command.command.destination ), [
			movement.destination,
			movement.original,
			movement.destination,
			movement.original
		] );
		assert.ok( result.motion.every( r => r.at >= result.start && r.at <= result.end ) );
		assert.equal( result.motion.at( -1 ).at, result.end );
	}
	let callback, paused = false;
	globalThis.requestAnimationFrame = f => {
		callback = f;
	};
	globalThis.__worldProbeFrameProfiler = {
		start() {},
		pause() {
			paused = true;
		},
		stop() {
			throw Error( "Export must happen after profiler shutdown" );
		}
	};
	const pending = captureFrameWindow( { duration: 1, name: "deferred", deferExport: true } );
	defined( callback )( 2 );
	assert.equal( await pending, null );
	assert.ok( paused );
	assert.deepEqual( globalThis.__worldProbeCompletedWindow.times, [ 2 ] );
});
test("camera recipe follows elapsed browser frames rather than a 100ms host timer", async t => {
	const keys = [ "performance", "requestAnimationFrame", "document", "PointerEvent" ],
		old = new Map( keys.map( k => [ k, Object.getOwnPropertyDescriptor( globalThis, k ) ] ) );
	t.after( () => {
		for ( const [k, d] of old ) {
			if ( d ) Object.defineProperty( globalThis, k, d );
			else delete globalThis[k];
		}
	} );
	Object.defineProperty( globalThis, "performance", { configurable: true, value: { now: () => 0, mark() {} } } );
	let callback;
	const events = [];
	globalThis.requestAnimationFrame = f => {
		callback = f;
	};
	globalThis.PointerEvent = class {
		constructor( type, value ) {
			Object.assign( this, { type }, value );
		}
	};
	globalThis.document = { querySelector: () => ({ dispatchEvent: event => events.push( event ) }) };
	const pending = captureFrameWindow( { duration: 1000, name: "camera", camera: { x: 500, y: 300 } } );
	for ( const at of [ 4, 8, 250, 500, 999, 1000 ] ) defined( callback )( at );
	const result = await pending;
	assert.equal( events.length, 5 );
	assert.equal( result.end, 1000 );
	assert.equal( events[2].clientX, 620 );
	assert.equal( events[3].clientX, 500 );
	assert.ok( events.every( e => e.type === "pointermove" && e.buttons === 2 && e.pointerType === "mouse" ) );
});
