/*
===========================================================================

perf-trace-profiles.test.mjs - independent samplers keep their own clocks

Simultaneous trace and Inspector profiles reuse node IDs on the same thread.
Their chunks must never be interpreted as one sampling session.

===========================================================================
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readProfiles, forEachSample } from "../../tools/perf/core/trace.mjs";
import { createCaptures } from "../../tools/perf/core/client.mjs";

test("a capture refuses duplicate CPU samplers before starting browser instrumentation", async () => {
	const page = /** @type {import("playwright-core").Page} */ ({});
	await assert.rejects( createCaptures( page, { cpu: true, trace: "unused.json" } ), /Choose --cpu or --trace/ );
});

/*
================
recording
================
*/
/** @returns {Array<Record<string, any>>} */
function recording( id, source, start, duration, tid = 7 ) {
	return [
		{ name: "Profile", pid: 1, tid, id, args: { data: { source, startTime: start } } },
		{
			name: "ProfileChunk",
			pid: 1,
			tid,
			id,
			args: {
				data: {
					cpuProfile: {
						nodes: [
							{ id: 1, callFrame: { functionName: "root" }, children: [ 2 ] },
							{ id: 2, callFrame: { functionName: source } }
						],
						samples: [ 2, 2 ]
					},
					timeDeltas: [ 10, duration ],
					lines: [ 4, 5 ],
					columns: [ 1, 2 ]
				}
			}
		}
	];
}

for ( const reverse of [ false, true ] ) {
	test(`overlapping samplers retain independent nodes and timestamps (reverse=${reverse})`, () => {
		const internal = recording( "a", "Internal", 100, 20 );
		const inspector = recording( "b", "Inspector", 120, 80 );
		const events = reverse ? [ ...inspector, ...internal ] : [ ...internal, ...inspector ];
		const profile = readProfiles( events, new Map() ).get( "1/7" );
		assert.equal( profile.id, "1:a" );
		assert.equal( profile.nodes.get( 2 ).callFrame.functionName, "Internal" );
		assert.deepEqual( profile.samples, [ 2, 2 ] );
		assert.deepEqual( profile.times, [ 110, 130 ] );
		const visited = [];
		forEachSample( profile, 100, 200, 1000, ( index, owned, stack ) => visited.push( { index, owned, stack } ) );
		assert.deepEqual( visited, [ { index: 0, owned: 20, stack: [ 2, 1 ] } ] );
	});
}

test("the longest same-source recording wins without concatenating separate captures", () => {
	const profiles = readProfiles( [
		...recording( "short", "Internal", 100, 20 ),
		...recording( "long", "Internal", 200, 60 ),
		...recording( "worker", "Inspector", 300, 80, 8 )
	], new Map() );
	assert.equal( profiles.size, 2 );
	assert.deepEqual( profiles.get( "1/7" ).times, [ 210, 270 ] );
	assert.deepEqual( profiles.get( "1/8" ).times, [ 310, 390 ] );
});

test("Inspector-only captures and chunks arriving separately preserve their own timeline", () => {
	const events = recording( "a", "Inspector", 100, 20 );
	events.push( {
		name: "ProfileChunk",
		pid: 1,
		tid: 7,
		id: "a",
		args: { data: { cpuProfile: { samples: [ 2 ] }, timeDeltas: [ 30 ], lines: [ 6 ] } }
	} );
	const profile = readProfiles( events, new Map() ).get( "1/7" );
	assert.deepEqual( profile.times, [ 110, 130, 160 ] );
	assert.deepEqual( profile.lines, [ 4, 5, 6 ] );
});
