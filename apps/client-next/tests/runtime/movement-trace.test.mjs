import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeMovementTrace } from "../../tools/lib/movement-trace.mjs";
import { defined } from "../helpers/defined.mjs";
const mark = ( suffix, ms ) => ({
	name: "world-profile:movement:" + suffix,
	pid: 1,
	tid: 2,
	ts: 100000 + ms * 1000,
	args: { data: { startTime: ms } }
});
const event = ( name, ms, dur, tid = 2 ) => ({ name, pid: 1, tid, ts: 100000 + ms * 1000, dur: dur * 1000, ph: "X" });
const frames = {
	columns: [ "frameId", "startMs", "cpuMs", "ui" ],
	rows: [ [ 1, 101, 6, 1 ], [ 2, 110, 2, 0 ] ],
	dropped: 0
};
const window = { name: "movement", motion: { samples: [ { at: 101, pose: { x: 960 } } ] } };
test("movement correlation clips GC overlaps and excludes worker and nested collector spans", () => {
	const events = [
		mark( "start", 100 ),
		mark( "end", 120 ),
		event( "MinorGC", 100, 2 ),
		event( "MajorGC", 103, 2 ),
		event( "V8.GC_MARK_COMPACTOR", 103, 2 ),
		event( "MinorGC", 103, 5, 3 ),
		{ ...event( "FireAnimationFrame", 101, 6.2 ), tdur: 5900 }
	];
	const result = analyzeMovementTrace( events, frames, window );
	assert.equal( result.gc.length, 2 );
	assert.equal( result.overBudgetFramesWithGc, 1 );
	assert.equal( result.worstFrames[0].gcMs, 3 );
	assert.equal( result.worstFrames[0].callback.threadCpuMs, 5.9 );
	assert.equal( result.worstFrames[0].nearestMotion.pose.x, 960 );
});
test("movement correlation rejects missing markers, clock mismatch and incomplete recordings", () => {
	assert.throws( () => analyzeMovementTrace( [], frames, window ), /marker/ );
	assert.throws(
		() => analyzeMovementTrace( [ mark( "start", 100 ), { ...mark( "end", 120 ), tid: 3 } ], frames, window ),
		/clocks/
	);
	assert.throws(
		() => analyzeMovementTrace( [ mark( "start", 100 ), mark( "end", 120 ) ], { ...frames, dropped: 1 }, window ),
		/Incomplete/
	);
});

test("outer stage GC attribution separates interrupted UI from non-GC UI work", () => {
	const capture = {
		columns: [
			"frameId",
			"startMs",
			"cpuMs",
			"input-state-frontend",
			"character-presentation",
			"world-stream",
			"ui",
			"render-preparation-submit",
			"hover",
			"audio"
		],
		rows: [ [ 1, 101, 7, 1, 1, 0, 3, 2, 0, 0 ], [ 2, 110, 4, 1, 0, 0, 2, 1, 0, 0 ] ],
		dropped: 0
	};
	const result = analyzeMovementTrace(
		[ mark( "start", 100 ), mark( "end", 120 ), event( "MinorGC", 103, 2 ) ],
		capture,
		window
	);
	assert.equal( defined( result.runtimeStageGc ).ui.totalMs, 5 );
	assert.equal( defined( result.runtimeStageGc ).ui.gcOverlapMs, 2 );
	assert.equal( defined( result.runtimeStageGc ).ui.withoutGcFrames, 1 );
	assert.equal( defined( result.runtimeStageGc ).ui.maxWithoutGcMs, 2 );
	assert.equal( defined( result.runtimeStageGc )["character-presentation"].gcOverlapMs, 0 );
});
