/*
===========================================================================

shared-journal.test.mjs - the world journal's batches, written once, read by every thread

The simulation worker publishes each world batch once in shared memory
(foundation/workers/shared-journal.ts); the main thread and the character
worker read it. These tests require every reader to read every batch as
it was published, an entity's state and a gameplay snapshot carrying only
what changed, every unchanged nested value shared with the reader's
previous state rather than copied, the log starting again once read, and
the same on a second thread publishing while this one reads.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { journalBatches } from "../helpers/journal-batches.mjs";

const {
	JOURNAL_MAIN,
	JOURNAL_PRESENTATION,
	attachJournalReader,
	createJournalReader,
	createJournalWriter,
	createSharedJournal
} = await import( "../../src/engine/foundation/workers/shared-journal.ts" );

const WRITER = new URL( "../helpers/journal-writer-worker.mjs", import.meta.url );
const READ_LIMIT_MS = 10000;

/*
================
sharedValues

Counts, for a reader's decoded batch, the nested values of each entity
state and gameplay snapshot that are the same as in the reader's previous
one, and requires each to be the previous value itself, not a copy.
================
*/
function sharedValues( previous, batch, published ) {
	let shared = 0;
	for ( let i = 0; i < batch.events.length; i++ ) {
		const event = batch.events[i], sent = published.events[i];
		if ( event.kind === "reset" ) previous.clear();
		if ( event.kind === "despawn" ) previous.delete( event.gid );
		const key = event.kind === "gameplay" ? "gameplay" : event.kind === "state" ? event.entity.gid : undefined;
		const state = event.kind === "gameplay" ? event.state : event.entity;
		const base = key === undefined ? undefined : previous.get( key );
		const sentBase = key === undefined ? undefined : previous.get( `sent:${key}` );
		if ( base ) {
			for ( const field of Object.keys( state ) ) {
				const value = state[field];
				if (
					typeof value === "object" && value !== null &&
					sentBase?.[field] === sent[event.kind === "gameplay" ? "state" : "entity"][field]
				) {
					assert.equal( value, base[field], `${field} of ${String( key )} is shared` );
					shared++;
				}
			}
		}
		if ( event.kind === "spawn" || key !== undefined ) {
			const id = event.kind === "gameplay" ? "gameplay" : event.entity.gid;
			previous.set( id, state );
			previous.set( `sent:${id}`, event.kind === "gameplay" ? sent.state : sent.entity );
		}
	}
	return shared;
}

test("every reader reads every batch as published, sharing what did not change", () => {
	const journal = createSharedJournal();
	attachJournalReader( journal, JOURNAL_MAIN );
	attachJournalReader( journal, JOURNAL_PRESENTATION );
	/** @type {any} */
	const writer = createJournalWriter( journal );
	/** @type {any[]} */
	const readers = [
		createJournalReader( journal, JOURNAL_MAIN ),
		createJournalReader( journal, JOURNAL_PRESENTATION )
	];
	const previous = [ new Map(), new Map() ], read = [ 0, 0 ];
	const batches = journalBatches( 0x10a1, 400 );
	let shared = 0;
	for ( const [index, batch] of batches.entries() ) {
		writer.publish( batch );
		// The main thread reads each batch; the character worker every third.
		for ( const r of index % 3 === 2 ? [ 0, 1 ] : [ 0 ] ) {
			for ( let decoded = readers[r].poll(); decoded; decoded = readers[r].poll() ) {
				const sent = batches[read[r]++];
				assert.deepStrictEqual( decoded, sent, `reader ${r} batch ${decoded.sequence}` );
				shared += sharedValues( previous[r], decoded, sent );
			}
			assert.equal( readers[r].poll(), null );
		}
	}
	for ( let decoded = readers[1].poll(); decoded; decoded = readers[1].poll() ) read[1]++;
	assert.deepEqual( read, [ 400, 400 ] );
	assert.ok( shared > 1000, `shared ${shared}` );
});

test("an unchanged value is not written again, and the read log starts again", () => {
	const journal = createSharedJournal();
	attachJournalReader( journal, JOURNAL_MAIN );
	/** @type {any} */
	const writer = createJournalWriter( journal ),
		reader = /** @type {any} */ (createJournalReader( journal, JOURNAL_MAIN ));
	const before = journal.log.byteLength, length = before / 64;
	// A state holding a quarter of the log's first size (two words a number),
	// never changed: 200 unread states fit only if it is not written again.
	let entity = { gid: 1, x: 0, history: Array.from( { length }, ( _, i ) => i ) };
	writer.publish( { sequence: 1, events: [ { kind: "spawn", entity } ] } );
	for ( let sequence = 2; sequence <= 200; sequence++ ) {
		entity = { ...entity, x: sequence };
		writer.publish( { sequence, events: [ { kind: "state", entity } ] } );
	}
	assert.equal( journal.log.byteLength, before, "not written again" );
	const first = reader.poll().events[0].entity.history;
	assert.equal( first.length, length );
	for ( let sequence = 2; sequence <= 200; sequence++ ) {
		const decoded = reader.poll().events[0].entity;
		assert.equal( decoded.x, sequence );
		assert.equal( decoded.history, first, "the reader's own value, not a copy" );
	}
	// Read as published, the log starts again rather than growing.
	for ( let sequence = 201; sequence <= 1200; sequence++ ) {
		entity = { ...entity, x: sequence, history: [ sequence ] };
		writer.publish( { sequence, events: [ { kind: "state", entity } ] } );
		assert.deepEqual( reader.poll().events[0].entity.history, [ sequence ] );
	}
	assert.equal( journal.log.byteLength, before, "started again" );
});

test("a batch out of order is refused", () => {
	const journal = createSharedJournal(), writer = /** @type {any} */ (createJournalWriter( journal ));
	writer.publish( { sequence: 1, events: [] } );
	assert.throws( () => writer.publish( { sequence: 3, events: [] } ), /out of order/ );
});

test("a second thread publishes while this one reads, every batch as published", async () => {
	const journal = createSharedJournal(), count = 300, seed = 0x5eed;
	attachJournalReader( journal, JOURNAL_MAIN );
	const reader = /** @type {any} */ (createJournalReader( journal, JOURNAL_MAIN )),
		batches = journalBatches( seed, count );
	const worker = new Worker( WRITER, { workerData: { journal, seed, count } } );
	try {
		const started = Date.now();
		let read = 0;
		while ( read < count ) {
			if ( Date.now() - started > READ_LIMIT_MS ) throw Error( `read ${read} of ${count}` );
			const decoded = reader.poll();
			if ( !decoded ) {
				await new Promise( resolve => setImmediate( resolve ) );
				continue;
			}
			assert.deepStrictEqual( decoded, batches[read++] );
		}
	} finally {
		await worker.terminate();
	}
});

test("a plain object rebuilt around the same values goes as its own delta", () => {
	const journal = createSharedJournal();
	attachJournalReader( journal, JOURNAL_MAIN );
	const writer = /** @type {any} */ (createJournalWriter( journal ));
	const reader = /** @type {any} */ (createJournalReader( journal, JOURNAL_MAIN ));
	const from = { regionId: 1, x: 0, y: 0, z: 0, angle: 0 }, to = { regionId: 1, x: 9, y: 0, z: 9, angle: 1 };
	const chain = Float64Array.from( { length: 1281 }, ( _, i ) => i / 3 );
	let entity = { gid: 1, movementPath: { from, to, walkingChain: chain, durationMs: 100 } };
	writer.publish( { sequence: 1, events: [ { kind: "spawn", entity } ] } );
	const first = reader.poll().events[0].entity.movementPath;
	assert.deepStrictEqual( first.walkingChain, chain );
	// The worker publishes each sample's leg as a new object around the same
	// poses and chain (walking-history.ts publishedLeg).
	entity = { ...entity, movementPath: { ...entity.movementPath, durationMs: 120 } };
	writer.publish( { sequence: 2, events: [ { kind: "state", entity } ] } );
	const second = reader.poll().events[0].entity.movementPath;
	assert.equal( second.durationMs, 120 );
	assert.equal( second.from, first.from, "unchanged pose shared" );
	assert.equal( second.walkingChain, first.walkingChain, "unchanged chain shared" );
	assert.notEqual( second, first );
});
