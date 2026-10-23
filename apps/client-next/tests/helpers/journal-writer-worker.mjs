/*
===========================================================================

journal-writer-worker.mjs - a Node worker thread publishing world batches

The test-side twin of the simulation worker's publication
(runtime/simulation/worker/simulation.ts): the shipping journal writer
publishes journalBatches( seed, count ) into the shared journal it was
given, as fast as it can, while the test reads them on its own thread.

===========================================================================
*/
import "./native-source-loader.mjs";
import { workerData } from "node:worker_threads";
import { journalBatches } from "./journal-batches.mjs";

const { createJournalWriter } = await import( "../../src/engine/foundation/workers/shared-journal.ts" );
/** @type {any} */
const writer = createJournalWriter( workerData.journal );
for ( const batch of journalBatches( workerData.seed, workerData.count ) ) writer.publish( batch );
