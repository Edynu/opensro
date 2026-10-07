/*
===========================================================================

perf-camera-scenario.test.mjs - fixed benchmark views through real input rules

The adapter delivers pointer events to the shipping input owner. Timing
changes must not alter the orbit left for the following scenario.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { BENCHMARK_CAMERA, dragBenchmarkSweep, resetBenchmarkCamera } from "../../tools/perf/core/camera-scenario.mjs";
const { createInput } = await import( "../../src/engine/runtime/input/input.ts" );

/*
================
fixture
================
*/
function fixture( delayScale = 1 ) {
	const input = createInput(), path = [];
	let x = 0, y = 0, buttons = 0, timeMs = 0;
	const context = createContext( {
		__benchRuntime: { camera: () => input.camera() },
		document: { querySelector: () => ({ getBoundingClientRect: () => ({ x: 0, y: 0, width: 1600, height: 900 }) }) }
	} );
	/*
	================
	pointer
	================
	*/
	function pointer() {
		input.accept( { kind: "pointer", x, y, buttons, timeMs: timeMs++ } );
	}
	const page = {
		async evaluate( callback ) {
			return runInContext( `(${callback.toString()})()`, context );
		},
		async waitForTimeout( ms ) {
			timeMs += ms * delayScale;
		},
		mouse: {
			async move( nextX, nextY ) {
				x = nextX;
				y = nextY;
				pointer();
				path.push( { ...input.camera() } );
			},
			async down() {
				buttons = 2;
				pointer();
			},
			async up() {
				buttons = 0;
				pointer();
			}
		}
	};
	return { page, input, path, buttons: () => buttons };
}

test("camera reset restores the orbit through pointer input and rejects a changed zoom", async () => {
	const f = fixture();
	await f.page.mouse.move( 100, 100 );
	await f.page.mouse.down();
	await f.page.mouse.move( 1100, 150 );
	await f.page.mouse.up();
	const result = await resetBenchmarkCamera( f.page );
	assert.ok( Math.abs( result.yaw - BENCHMARK_CAMERA.yaw ) < .000001 );
	assert.ok( Math.abs( result.pitch - BENCHMARK_CAMERA.pitch ) < .000001 );
	assert.equal( f.buttons(), 0 );
	f.input.accept( /** @type {any} */ ({ kind: "wheel", delta: 20, timeMs: 100 }) );
	await assert.rejects( resetBenchmarkCamera( f.page ), /zoom changed/ );
});

test("fixed sweeps cover the same angles despite scheduling delay and leave no camera drift", async () => {
	const a = fixture( 1 ), b = fixture( 10 );
	const normal = await dragBenchmarkSweep( a.page ), delayed = await dragBenchmarkSweep( b.page );
	assert.deepEqual( a.path, b.path );
	assert.equal( normal.steps, delayed.steps );
	assert.ok( Math.max( ...a.path.map( row => row.yaw ) ) > 1 );
	assert.ok( Math.min( ...a.path.map( row => row.yaw ) ) < -1 );
	assert.ok( Math.abs( a.input.camera().yaw ) < .000001 );
	assert.equal( a.buttons(), 0 );
	assert.equal( b.buttons(), 0 );
});

test("a failed sweep releases its held pointer button", async () => {
	const f = fixture();
	f.page.waitForTimeout = async () => {
		throw Error( "interrupted" );
	};
	await assert.rejects( dragBenchmarkSweep( f.page ), /interrupted/ );
	assert.equal( f.buttons(), 0 );
});
