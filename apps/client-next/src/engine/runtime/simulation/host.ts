/*
===========================================================================

host.ts - the main thread's side of the simulation worker

Owns the worker, the shared world journal (shared-journal.ts) and the one
world batch read from it awaiting acknowledgement, the newest snapshot
buffer and the input sequence checks. The runtime polls it once per frame;
delivery() lets a hidden tab frame from worker messages. The world batches
are not messages: the worker publishes each once in the journal, this
reads it and acknowledges it there, and the character worker reads the
same journal (presentationJournal).

===========================================================================
*/
import type { SessionState } from "@/engine/contracts/session";
import { PROTOCOL_VERSION, readSnapshot } from "@/engine/contracts/simulation";
import type { WorkerMessage, HostMessage } from "@/engine/contracts/simulation";
import type { SimulationHost, SimulationObservation } from "@/engine/contracts/runtime";
import { NET_JOURNAL_FIELDS } from "@/engine/contracts/network";
import {
	attachJournalReader,
	createJournalReader,
	createSharedJournal,
	JOURNAL_MAIN,
	JOURNAL_PRESENTATION
} from "@/engine/foundation/workers/shared-journal";
// The bug report's frame journal keeps at least this many recent frames.
const NET_JOURNAL_KEPT = 8192;

/*
================
createSimulationHost
================
*/
export function createSimulationHost(): SimulationHost {
	const worker = new Worker( new URL( "./worker/entry.ts", import.meta.url ), {
		type: "module",
		name: "sro-simulation"
	} );
	let disposed = false, failure: string | null = null, pending: ArrayBuffer | null = null, sequence = 0;
	let worldBatch: import("@/engine/contracts/world").WorldBatch | null = null;
	const worldJournal = createSharedJournal();
	attachJournalReader( worldJournal, JOURNAL_MAIN );
	const worlds = createJournalReader( worldJournal, JOURNAL_MAIN );
	let sessionState: SessionState | null = null;
	let lastInputSent = 0, lastInputAccepted = 0;
	let receivedAtMs = 0, clock: import("@/engine/contracts/runtime").ClockSample | undefined;
	let deliveryWaiters: (() => void)[] = [];
	// The transport's frame journal (network.ts), oldest first, for bug reports.
	let journal: Float64Array[] = [], journalRecords = 0;
	/*
================
wake
Settles every delivery() waiter. Main-thread timers throttle in a hidden
tab; worker messages do not.
================
	*/
	const wake = () => {
		const waiters = deliveryWaiters;
		deliveryWaiters = [];
		for ( const resolve of waiters ) resolve();
	};
	const send = ( message: HostMessage, transfer: Transferable[] = [] ) => worker.postMessage( message, transfer );
	const recycle = ( buffer: ArrayBuffer ) => send( { kind: "recycle", buffer }, [ buffer ] );
	worker.onmessage = ( event: MessageEvent<WorkerMessage> ) => {
		if ( disposed ) {
			return;
		}
		wake();
		if ( event.data.kind === "failure" ) {
			failure = event.data.message;
			return;
		}
		if ( event.data.kind === "session" ) {
			sessionState = event.data.state;
			return;
		}
		if ( event.data.kind === "net-journal" ) {
			journal.push( event.data.records );
			journalRecords += event.data.records.length / NET_JOURNAL_FIELDS;
			while (
				journal.length > 1 && journalRecords - journal[0]!.length / NET_JOURNAL_FIELDS >= NET_JOURNAL_KEPT
			) {
				journalRecords -= journal.shift()!.length / NET_JOURNAL_FIELDS;
			}
			return;
		}
		if ( pending ) {
			recycle( pending );
		}
		pending = event.data.buffer;
		clock = event.data.clock;
		receivedAtMs = performance.timeOrigin + performance.now();
	};
	worker.onerror = event => {
		failure = event.message;
	};
	worker.onmessageerror = () => {
		failure = "Simulation message could not be decoded";
	};
	send( { kind: "start", version: PROTOCOL_VERSION, journal: worldJournal } );
	return {
		/*
================
pollWorld

The next world batch from the journal, kept until acknowledged.
================
		*/
		pollWorld() {
			if ( worldBatch || disposed || failure ) return worldBatch;
			try {
				worldBatch = worlds.poll();
			} catch ( error ) {
				failure = String( error );
			}
			return worldBatch;
		},
		/*
================
netJournal

The frames journaled so far (at least the last NET_JOURNAL_KEPT), oldest
first: epoch ms, direction, opcode and bytes per frame.
================
		*/
		netJournal() {
			const out = new Float64Array( journalRecords * NET_JOURNAL_FIELDS );
			let at = 0;
			for ( const chunk of journal ) {
				out.set( chunk, at );
				at += chunk.length;
			}
			return out;
		},
		/*
================
delivery
Resolves on the next worker message, or at once after disposal.
================
		*/
		delivery: () =>
			disposed ? Promise.resolve() : new Promise<void>( resolve => {
				deliveryWaiters.push( resolve );
			} ),
		/*
================
ackWorld
================
		*/
		ackWorld( sequence ) {
			if ( !worldBatch || worldBatch.sequence !== sequence ) {
				throw new Error( "World journal acknowledgement mismatch" );
			}
			worldBatch = null;
			worlds.acknowledge( sequence );
		},
		/*
================
presentationJournal

Port-only: the shared world journal, with the character worker attached
as its reader, for its own projection (CLIENT_WORKERS_PLAN.md 5.11).
Before the first batch.
================
		*/
		presentationJournal() {
			attachJournalReader( worldJournal, JOURNAL_PRESENTATION );
			return worldJournal;
		},
		/*
================
session
================
		*/
		session( command ) {
			if ( !disposed && !failure ) {
				send( { kind: "session", command } );
			}
		},
		/*
================
pollSession
================
		*/
		pollSession() {
			const result = sessionState;
			sessionState = null;
			return result;
		},
		/*
================
sendInput
================
		*/
		sendInput( batch ) {
			if ( disposed || failure ) {
				return;
			}
			if ( batch.first !== lastInputSent + 1 || batch.last - lastInputAccepted > 2048 ) {
				failure = "Simulation input backlog or sequence violation";
				return;
			}
			lastInputSent = batch.last;
			send( { kind: "input", batch } );
		},
		/*
================
poll
================
		*/
		poll(): SimulationObservation | null {
			if ( !pending || disposed ) {
				return null;
			}
			const buffer = pending;
			pending = null;
			try {
				const data = readSnapshot( buffer );
				if ( data.sequence <= sequence ) {
					return null;
				}
				if ( data.acceptedInputSequence < lastInputAccepted || data.acceptedInputSequence > lastInputSent ) {
					throw new Error( "Invalid input acknowledgement" );
				}
				lastInputAccepted = data.acceptedInputSequence;
				sequence = data.sequence;
				return {
					...data,
					...(clock ? { clock } : {}),
					receivedAtMs,
					appliedAtMs: performance.timeOrigin + performance.now()
				};
			} catch ( error ) {
				failure = String( error );
				return null;
			} finally {
				recycle( buffer );
			}
		},
		error: () => failure,
		/*
================
dispose
================
		*/
		dispose() {
			if ( disposed ) {
				return;
			}
			disposed = true;
			pending = null;
			wake();
			worker.onmessage = null;
			worker.onerror = null;
			worker.onmessageerror = null;
			worker.terminate();
		}
	};
}
