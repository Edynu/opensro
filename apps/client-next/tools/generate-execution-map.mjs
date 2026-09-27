/*
===========================================================================

generate-execution-map.mjs - resolve and verify the runtime execution flow

execution-contract.json is the reviewed source of truth: parent-issued
capabilities, frame order and disposal order. This tool resolves the actual
call flow from src/, verifies it against that contract, and writes the
resolved graph to temp/artifacts/execution/execution-map.json for inspection.

The resolved graph is a derived artifact, not a committed file: it runs to
megabytes, its diffs cannot be reviewed, and the contract check is what
fails a change. Run with no arguments (`pnpm verify:execution`).

===========================================================================
*/

import fs from "node:fs";
import path from "node:path";
import { executionFlow } from "./execution-flow.mjs";
import { root } from "./project.mjs";
import { verifyExecution } from "./verify-execution.mjs";

const ARTIFACT_PATH = path.join( root, "temp", "artifacts", "execution", "execution-map.json" );

/*
================
serializeExecutionMap

Source line numbers belong in live diagnostics, not in the semantic graph:
moving code without changing its flow must serialize identically.
================
*/
export function serializeExecutionMap( graph ) {
	const { issues, ...semantic } = graph;
	return JSON.stringify(
		{
			...semantic,
			version: 3,
			functions: graph.functions.map( ( { line, ...fn } ) => fn ),
			calls: graph.calls.map( ( { line, ...call } ) => call )
		},
		null,
		2
	) + "\n";
}

/*
================
executionMap
================
*/
export function executionMap( base = root ) {
	return serializeExecutionMap( executionFlow( base ) );
}

/*
================
main
================
*/
function main() {
	const graph = executionFlow();
	const issues = verifyExecution( root, graph );

	fs.mkdirSync( path.dirname( ARTIFACT_PATH ), { recursive: true } );
	fs.writeFileSync( ARTIFACT_PATH, serializeExecutionMap( graph ) );

	if ( issues.length > 0 ) {
		console.error( issues.join( "\n" ) );
		process.exitCode = 1;
		return;
	}
	console.log(
		`Resolved execution/capability flow PASS (map: ${
			path.relative( root, ARTIFACT_PATH ).split( path.sep ).join( "/" )
		})`
	);
}

if ( process.argv[1] === import.meta.filename ) {
	main();
}
