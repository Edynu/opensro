/*
===========================================================================

shared-echo-worker.mjs - a Node worker thread answering frames through shared memory

The test-side twin of the character worker's loop
(runtime/character-worker/worker/entry.ts): it waits for a frame with the
shipping nextFrame, reads every value the host wrote into the inbox, and
answers with the frame's number and the same values written into its own
outbox and string table, then posts the output. A negative frame stops it.

===========================================================================
*/
import "./native-source-loader.mjs";
import { workerData } from "node:worker_threads";

const { nextFrame, postOutput } = await import( "../../src/engine/foundation/workers/shared-frame.ts" );
const { createStringReader, createStringWriter } = await import(
	"../../src/engine/foundation/workers/shared-strings.ts"
);
const { createValueReader, createValueWriter } = await import(
	"../../src/engine/foundation/workers/shared-values.ts"
);

const control = new Int32Array( workerData.control );
const inbox = createValueReader( workerData.inbox, createStringReader( workerData.inboxStrings ) );
const outbox = createValueWriter( workerData.outbox, createStringWriter( workerData.outboxStrings ) );
let seen = 0;
for ( ;; ) {
	const frame = await nextFrame( control, seen );
	if ( frame < 0 ) break;
	seen = frame;
	inbox.begin();
	const values = [];
	while ( inbox.more() ) values.push( inbox.value() );
	outbox.begin();
	outbox.number( frame );
	for ( const value of values ) outbox.value( value );
	outbox.end();
	postOutput( control, frame );
}
