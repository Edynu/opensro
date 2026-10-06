/*
===========================================================================

movement-journal.test.mjs - bounded incident history on the replay clock

Movement uses the existing report journal. Its longer window must still
discard old events and bound bursts without mixing worker and main clocks.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { createJournal, JOURNAL_WINDOW_MS } = await import( "../../src/engine/runtime/bug-report/journal.ts" );

test("movement history retains two minutes and caps a burst", t => {
	let now = 0;
	t.mock.method( performance, "now", () => now );
	const oldWindow = Object.getOwnPropertyDescriptor( globalThis, "window" );
	Object.defineProperty( globalThis, "window", { value: new EventTarget(), configurable: true } );
	t.after( () => {
		if ( oldWindow ) Object.defineProperty( globalThis, "window", oldWindow );
		else Reflect.deleteProperty( globalThis, "window" );
	} );
	const journal = createJournal( /** @type {HTMLCanvasElement} */ ({}) );
	t.after( () => journal.dispose() );
	journal.record( "movement", { event: "request", simulationAtMs: 800 } );
	now = JOURNAL_WINDOW_MS;
	journal.record( "movement", { event: "receipt", simulationAtMs: 1600 } );
	assert.equal( journal.since( 0 ).length, 2 );
	now++;
	journal.record( "movement", { event: "correction" } );
	assert.deepEqual( journal.since( 0 ).map( event => event.event ), [ "receipt", "correction" ] );
	for ( let requestId = 0; requestId < 6001; requestId++ ) journal.record( "movement", { requestId } );
	const events = journal.since( 0 );
	assert.equal( events.length, 6000 );
	assert.equal( events[0].requestId, 1 );
	const last = events.at( -1 );
	assert.ok( last );
	assert.equal( last.requestId, 6000 );
	assert.equal( events[0].atMs, now );
	now += 1;
	journal.record( "movement", { event: "frame-spike", durationMs: 33, logical: { x: 1 } } );
	now += 40;
	journal.record( "error", { message: "keep this input-adjacent evidence" } );
	journal.record( "movement", { event: "frame-spike", durationMs: 250, logical: { x: 2 } } );
	now += 40;
	journal.record( "movement", { event: "frame-spike", durationMs: 40, logical: { x: 3 } } );
	const grouped = journal.since( now - 100 ).filter( event => event.event === "frame-spike" );
	assert.equal( grouped.length, 1 );
	assert.equal( grouped[0].count, 3 );
	assert.equal( grouped[0].durationMs, 250 );
	assert.deepEqual( grouped[0].logical, { x: 2 } );
	assert.equal( journal.since( now - 100 ).filter( event => event.kind === "error" ).length, 1 );
	now += 1000;
	journal.record( "movement", { event: "frame-spike", durationMs: 33 } );
	assert.equal( journal.since( now - 2000 ).filter( event => event.event === "frame-spike" ).length, 2 );
	now += JOURNAL_WINDOW_MS + 1;
	assert.deepEqual( journal.since( 0 ), [], "idle history also respects the time window" );
	journal.dispose();
	assert.deepEqual( journal.since( 0 ), [] );
});

test("late long-frame observations are sorted, bounded and disconnected", t => {
	let now = 1000, disconnected = 0;
	/** @type {(list: { getEntries(): { startTime: number; duration: number; }[]; }) => void} */
	let deliver = () => {
		throw Error( "Observer was not installed" );
	};
	t.mock.method( performance, "now", () => now );
	const saved = new Map(
		[ "window", "PerformanceObserver" ].map( key => [ key, Object.getOwnPropertyDescriptor( globalThis, key ) ] )
	);
	t.after( () => {
		for ( const [key, descriptor] of saved ) {
			if ( descriptor ) Object.defineProperty( globalThis, key, descriptor );
			else Reflect.deleteProperty( globalThis, key );
		}
	} );
	/*
	================
	FakeObserver
	================
	*/
	class FakeObserver {
		static supportedEntryTypes = [ "longtask" ];
		/*
		================
		constructor
		================
		*/
		constructor( callback ) {
			deliver = callback;
		}
		/*
		================
		observe
		================
		*/
		observe() {}
		/*
		================
		disconnect
		================
		*/
		disconnect() {
			disconnected++;
		}
	}
	Object.defineProperty( globalThis, "window", { value: new EventTarget(), configurable: true } );
	Object.defineProperty( globalThis, "PerformanceObserver", { value: FakeObserver, configurable: true } );
	const journal = createJournal( /** @type {HTMLCanvasElement} */ ({}) );
	journal.record( "movement", { event: "request" } );
	assert.ok( deliver );
	deliver( { getEntries: () => [ { startTime: 900, duration: 60 } ] } );
	assert.deepEqual( journal.since( 0 ).map( event => event.atMs ), [ 900, 1000 ] );
	now += JOURNAL_WINDOW_MS;
	assert.deepEqual( journal.since( 0 ).map( event => event.kind ), [ "movement" ] );
	journal.dispose();
	assert.equal( disconnected, 1 );
	assert.deepEqual( journal.since( 0 ), [] );
});
