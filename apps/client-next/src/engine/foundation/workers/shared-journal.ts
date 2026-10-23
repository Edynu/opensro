/*
===========================================================================

shared-journal.ts - the world journal's batches, written once, read by every thread

The simulation worker publishes each world batch here once; the main
thread and the character worker read every batch in order at their own
pace (docs/CLIENT_WORKERS_PLAN.md 5.1, 5.11). Nothing is posted. An
entity's state (spawn, state) and a gameplay snapshot go as the fields
that changed since the last one published for it, compared by reference:
the worker builds each from the last by a shallow spread, so whatever did
not change is the same value, neither encoded nor copied, and a reader
rebuilds the state from its previous one, keeping every unchanged nested
value by reference. Object keys cross as shared-strings ids; string
values are inline (shared-values.ts), so free text never grows the
string table.

The log is one growable block of words: a batch is appended after the
last, and when every attached reader has consumed every batch the next
one starts the log again (EPOCH). Counters in one shared Int32Array order
it: PUBLISHED, the last batch's sequence, stored after its words; each
reader's CONSUMED; ACKED, the main thread's acknowledgement of the batch
it applied, which the worker waits for before it publishes the next
(entities.ts keeps one batch in flight). A reader attaches before the
first batch, or the deltas would name states it never saw.

===========================================================================
*/
import type { WorldBatch, WorldEvent } from "@/engine/contracts/world";
import { createSharedStrings, createStringReader, createStringWriter, type SharedStrings } from "./shared-strings";
import { createValueReader, createValueWriter } from "./shared-values";

// Control words.
const PUBLISHED = 0;
const EPOCH = 1;
const ACKED = 2;
const ATTACHED = 3;
const CONSUMED = 4;
// The readers a journal has room for: the main thread, the character worker.
export const JOURNAL_MAIN = 0;
export const JOURNAL_PRESENTATION = 1;
const MAX_READERS = 4;
// CONSUMED + MAX_READERS.
const CONTROL_WORDS = 8;
// The log's words before growing, and at most: an EnterWorld burst may hold
// thousands of spawns (entities.ts bounds a batch at 32 MB of values).
const INITIAL_LOG_BYTES = 1048576;
const MAX_LOG_BYTES = 536870912;
// Event encodings.
const EVENT_VALUE = 0;
const EVENT_ENTITY = 1;
const EVENT_GAMEPLAY = 2;
// A delta entry: a key set to a value, removed, or a plain object of its
// own rebuilt around the same values (a movement path's leg), as a delta.
const ENTRY_SET = 0;
const ENTRY_REMOVED = 1;
const ENTRY_NESTED = 2;
// Plain objects deeper than this go whole.
const MAX_NESTED = 3;

/*
================
SharedJournal

The journal's shared memory, given to its writer and every reader.
================
*/
export interface SharedJournal {
	readonly control: SharedArrayBuffer;
	readonly strings: SharedStrings;
	readonly log: SharedArrayBuffer;
}

/*
================
createSharedJournal
================
*/
export function createSharedJournal(): SharedJournal {
	return {
		control: new SharedArrayBuffer( CONTROL_WORDS * Int32Array.BYTES_PER_ELEMENT ),
		strings: createSharedStrings(),
		log: new SharedArrayBuffer( INITIAL_LOG_BYTES, { maxByteLength: MAX_LOG_BYTES } )
	};
}

/*
================
attachJournalReader

Counts reader in: the writer keeps every batch until it has read it.
Before the first batch is published.
================
*/
export function attachJournalReader( memory: SharedJournal, reader: number ) {
	if ( !Number.isInteger( reader ) || reader < 0 || reader >= MAX_READERS ) throw Error( "Invalid journal reader" );
	Atomics.or( new Int32Array( memory.control ), ATTACHED, 1 << reader );
}

type Fields = Record<string, unknown>;

/*
================
plain

Whether value is a plain object, which a delta may descend into.
================
*/
function plain( value: unknown ): value is Fields {
	return typeof value === "object" && value !== null && Object.getPrototypeOf( value ) === Object.prototype;
}

/*
================
createJournalWriter

The simulation worker's side: publish appends a batch and publishes it;
acknowledged is the last batch the main thread applied.
================
*/
export function createJournalWriter( memory: SharedJournal ) {
	const control = new Int32Array( memory.control );
	const values = createValueWriter( memory.log, createStringWriter( memory.strings ), true );
	// The last state published for each entity, and the last gameplay state.
	const entities = new Map<number, Fields>();
	let gameplay: Fields | undefined, end = 0;
	// Each nesting level's changed and removed keys, reused.
	const changed: string[][] = [], removed: string[][] = [];
	/*
	================
	writeDelta

	next as its differences from base: each key whose value is not the same
	(Object.is), then each key next lacks. A changed plain object whose
	predecessor was one too goes as its own delta.
	================
	*/
	const writeDelta = ( base: Fields | undefined, next: Fields, depth = 0 ) => {
		const set = changed[depth] ??= [], gone = removed[depth] ??= [];
		set.length = gone.length = 0;
		for ( const key in next ) {
			if ( !Object.hasOwn( next, key ) ) continue;
			if ( !base || !Object.hasOwn( base, key ) || !Object.is( base[key], next[key] ) ) set.push( key );
		}
		if ( base ) {
			for ( const key in base ) if ( Object.hasOwn( base, key ) && !Object.hasOwn( next, key ) ) gone.push( key );
		}
		values.number( set.length + gone.length );
		for ( const key of set ) {
			const before = base?.[key], after = next[key];
			values.text( key );
			if ( depth < MAX_NESTED && plain( before ) && plain( after ) ) {
				values.number( ENTRY_NESTED );
				writeDelta( before, after, depth + 1 );
			} else {
				values.number( ENTRY_SET );
				values.value( after );
			}
		}
		for ( const key of gone ) {
			values.text( key );
			values.number( ENTRY_REMOVED );
		}
	};
	/*
	================
	writeEvent
	================
	*/
	const writeEvent = ( event: WorldEvent ) => {
		if ( event.kind === "spawn" || event.kind === "state" ) {
			const entity = event.entity as unknown as Fields, gid = event.entity.gid;
			values.number( EVENT_ENTITY );
			values.number( event.kind === "spawn" ? 1 : 0 );
			values.number( gid );
			writeDelta( event.kind === "spawn" ? undefined : entities.get( gid ), entity );
			entities.set( gid, entity );
			return;
		}
		if ( event.kind === "gameplay" ) {
			const state = event.state as unknown as Fields;
			values.number( EVENT_GAMEPLAY );
			writeDelta( gameplay, state );
			gameplay = state;
			return;
		}
		values.number( EVENT_VALUE );
		values.value( event );
		if ( event.kind === "despawn" ) entities.delete( event.gid );
		else if ( event.kind === "reset" ) {
			entities.clear();
			gameplay = undefined;
		}
	};
	return {
		/*
		================
		publish

		The batch appended to the log, then published. Its sequence follows
		the last one's.
		================
		*/
		publish( batch: WorldBatch ) {
			const published = Atomics.load( control, PUBLISHED );
			if ( batch.sequence !== published + 1 ) throw Error( "World journal publication out of order" );
			// Every attached reader has read every batch: start the log again.
			const attached = Atomics.load( control, ATTACHED );
			let drained = true;
			for ( let reader = 0; reader < MAX_READERS; reader++ ) {
				if ( attached & (1 << reader) && Atomics.load( control, CONSUMED + reader ) !== published ) {
					drained = false;
				}
			}
			if ( drained ) {
				end = 0;
				Atomics.add( control, EPOCH, 1 );
			}
			values.seek( end );
			values.number( batch.sequence );
			values.number( batch.events.length );
			for ( const event of batch.events ) writeEvent( event );
			end = values.position();
			// Published last: a reader that sees the sequence sees the words.
			Atomics.store( control, PUBLISHED, batch.sequence );
		},
		acknowledged: () => Atomics.load( control, ACKED )
	};
}

/*
================
createJournalReader

One reader's side: poll returns the next batch, or null; acknowledge
(the main thread's) lets the worker publish the one after.
================
*/
export function createJournalReader( memory: SharedJournal, reader: number ) {
	const control = new Int32Array( memory.control );
	const values = createValueReader( memory.log, createStringReader( memory.strings ) );
	const entities = new Map<number, Fields>();
	let gameplay: Fields | undefined, seen = 0, epoch = 0, at = 0;
	/*
	================
	readDelta

	A copy of base with the entries applied: unchanged values are base's.
	================
	*/
	const readDelta = ( base: Fields | undefined ): Fields => {
		const next: Fields = base ? { ...base } : {};
		const count = values.number();
		for ( let i = 0; i < count; i++ ) {
			const key = values.text(), entry = values.number();
			if ( entry === ENTRY_REMOVED ) delete next[key];
			else if ( entry === ENTRY_NESTED ) next[key] = readDelta( base?.[key] as Fields );
			else next[key] = values.value();
		}
		return next;
	};
	/*
	================
	readEvent
	================
	*/
	const readEvent = (): WorldEvent => {
		const encoding = values.number();
		if ( encoding === EVENT_ENTITY ) {
			const spawn = values.number() === 1, gid = values.number();
			const entity = readDelta( spawn ? undefined : entities.get( gid ) );
			entities.set( gid, entity );
			return { kind: spawn ? "spawn" : "state", entity } as unknown as WorldEvent;
		}
		if ( encoding === EVENT_GAMEPLAY ) {
			gameplay = readDelta( gameplay );
			return { kind: "gameplay", state: gameplay } as unknown as WorldEvent;
		}
		if ( encoding !== EVENT_VALUE ) throw Error( "Invalid world journal event" );
		const event = values.value() as WorldEvent;
		if ( event.kind === "despawn" ) entities.delete( event.gid );
		else if ( event.kind === "reset" ) {
			entities.clear();
			gameplay = undefined;
		}
		return event;
	};
	return {
		/*
		================
		poll

		The batch after the last one read, once published; null before.
		================
		*/
		poll(): WorldBatch | null {
			if ( Atomics.load( control, PUBLISHED ) === seen ) return null;
			// The writer starts the log again only once this reader has read
			// everything, so a new epoch's first batch is at the start.
			const now = Atomics.load( control, EPOCH );
			if ( now !== epoch ) {
				epoch = now;
				at = 0;
			}
			values.seek( at );
			const sequence = values.number(), count = values.number();
			if ( sequence !== seen + 1 ) throw Error( "World journal delivery sequence violation" );
			const events: WorldEvent[] = new Array( count );
			for ( let i = 0; i < count; i++ ) events[i] = readEvent();
			at = values.position();
			seen = sequence;
			Atomics.store( control, CONSUMED + reader, seen );
			return { sequence, events };
		},
		/*
		================
		acknowledge

		The main thread applied the batch of sequence.
		================
		*/
		acknowledge( sequence: number ) {
			Atomics.store( control, ACKED, sequence );
		}
	};
}
