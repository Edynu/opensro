/*
===========================================================================

camera-scenario.mjs - repeatable benchmark camera input

Uses real pointer events and the read-only camera witness. Every sweep has
the same angles and returns to its start, independent of frame throughput.

===========================================================================
*/
import assert from "node:assert/strict";

const YAW_PER_PIXEL = .005, PITCH_PER_PIXEL = Math.fround( .005 );
const MAX_RESET_DRAGS = 64, CAMERA_TOLERANCE = .000001;
const SWEEP_STEPS = 128, SWEEP_WAIT_MS = 40;
export const BENCHMARK_CAMERA = { yaw: 0, pitch: Math.PI / 18, distance: 80 };

/*
================
cameraBox
================
*/
async function cameraBox( page ) {
	return page.evaluate( () => {
		const box = document.querySelector( "canvas" ).getBoundingClientRect();
		return { x: box.x, y: box.y, width: box.width, height: box.height };
	} );
}

/*
================
readBenchmarkCamera
================
*/
export async function readBenchmarkCamera( page ) {
	return page.evaluate( () => ({ ...globalThis.__benchRuntime.camera() }) );
}

/*
================
resetBenchmarkCamera

Benchmark scenarios never zoom. Refuse a changed zoom instead of silently
changing the tested scene. Restore orbit through the shipping input owner.
================
*/
export async function resetBenchmarkCamera( page ) {
	const box = await cameraBox( page ), x = box.x + box.width / 2, y = box.y + box.height * .45;
	for ( let attempt = 0; attempt < MAX_RESET_DRAGS; attempt++ ) {
		const camera = await readBenchmarkCamera( page );
		assert.equal( camera.distance, BENCHMARK_CAMERA.distance, "Benchmark zoom changed" );
		const dx = (BENCHMARK_CAMERA.yaw - camera.yaw) / YAW_PER_PIXEL;
		const dy = (BENCHMARK_CAMERA.pitch - camera.pitch) / PITCH_PER_PIXEL;
		assert.ok( Number.isFinite( dx ) && Number.isFinite( dy ), "Invalid camera witness" );
		if (
			Math.abs( dx ) * YAW_PER_PIXEL < CAMERA_TOLERANCE &&
			Math.abs( dy ) * PITCH_PER_PIXEL < CAMERA_TOLERANCE
		) return camera;
		await page.mouse.move( x, y );
		await page.mouse.down( { button: "right" } );
		try {
			await page.mouse.move(
				x + Math.max( -box.width / 4, Math.min( box.width / 4, dx ) ),
				y + Math.max( -box.height / 4, Math.min( box.height / 4, dy ) )
			);
		} finally {
			await page.mouse.up( { button: "right" } );
		}
	}
	throw Error( "Camera reset failed to reach the fixed orbit" );
}

/*
================
dragBenchmarkSweep

One complete, fixed sweep: centre, right, left, centre. Never terminate it
at a time deadline, which couples the next scenario's view to performance.
The caller measures the actual duration, including any scheduling stalls.
================
*/
export async function dragBenchmarkSweep( page ) {
	const before = await resetBenchmarkCamera( page ), box = await cameraBox( page );
	const x = box.x + box.width / 2, y = box.y + box.height * .45;
	const amplitude = Math.floor( box.width / 5 );
	await page.mouse.move( x, y );
	await page.mouse.down( { button: "right" } );
	try {
		for ( let step = 1; step <= SWEEP_STEPS; step++ ) {
			const phase = step / SWEEP_STEPS;
			const offset = phase <= .25 ? phase * 4 : phase <= .75 ? 2 - phase * 4 : phase * 4 - 4;
			await page.mouse.move( x + amplitude * offset, y );
			await page.waitForTimeout( SWEEP_WAIT_MS );
		}
	} finally {
		await page.mouse.up( { button: "right" } );
	}
	const after = await readBenchmarkCamera( page );
	assert.ok( Math.abs( before.yaw - after.yaw ) < CAMERA_TOLERANCE, "Sweep must restore yaw" );
	assert.ok( Math.abs( before.pitch - after.pitch ) < CAMERA_TOLERANCE, "Sweep must preserve pitch" );
	assert.equal( before.distance, after.distance );
	return { before, after, steps: SWEEP_STEPS, nominalMs: SWEEP_STEPS * SWEEP_WAIT_MS };
}
