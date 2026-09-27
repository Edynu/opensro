/*
===========================================================================

object-visibility.test.mjs - tests for object-visibility.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { advanceObjectFade: step } = await import(
	sourceFileUrl( "src/engine/foundation/rendering/object-visibility.ts" ).href
);
const initial = () => ({ state: 0, alpha: 0, lastFrame: 0 });

test("retail visibility uses radius-adjusted 3D distance, strict range and immediate threshold", () => {
	assert.equal( step( initial(), 580, 100, 480, 0, 1 ).state, 0 );
	assert.equal( step( initial(), 579, 100, 480, 0, 1 ).state, 1 );
	assert.equal( step( initial(), 420, 100, 480, 0, 1 ).state, 2 );
	assert.equal( step( initial(), 421, 100, 480, 0, 1 ).state, 1 );
	assert.equal( step( initial(), 1000, 0, 2020, 0, 1 ).alpha, 255 );
});
test("retail fades reverse without resetting alpha and complete with a stationary camera", () => {
	let state = step( initial(), 450, 0, 480, 0, 1 );
	assert.deepEqual( state, { state: 1, alpha: 0, lastFrame: 1 } );
	state = step( state, 450, 0, 480, .25, 2 );
	assert.equal( state.alpha, 128 );
	state = step( state, 500, 0, 480, .25, 3 );
	assert.equal( state.state, 3 );
	assert.equal( state.alpha, 128 );
	state = step( state, 500, 0, 480, .125, 4 );
	assert.equal( state.alpha, 64 );
	state = step( state, 450, 0, 480, .25, 5 );
	assert.equal( state.state, 1 );
	assert.equal( state.alpha, 64 );
	state = step( state, 450, 0, 480, .5, 6 );
	assert.equal( state.state, 2 );
	assert.equal( state.alpha, 255 );
	state = step( state, 500, 0, 480, .5, 7 );
	assert.equal( state.state, 3 );
	assert.equal( state.alpha, 255 );
	state = step( state, 500, 0, 480, .5, 8 );
	assert.equal( state.state, 0 );
	assert.equal( state.alpha, 0 );
});
test("native stale reset applies only out of range and after more than 50 frames", () => {
	const visible = { state: 2, alpha: 255, lastFrame: 10 };
	assert.equal( step( visible, 500, 0, 480, 0, 60 ).state, 3 );
	assert.deepEqual( step( visible, 500, 0, 480, 0, 61 ), { state: 0, alpha: 0, lastFrame: 61 } );
	assert.equal( step( visible, 400, 0, 480, 0, 1000 ).state, 2 );
});

test("renderer-owned fade storage preserves transitions with an aliased destination", () => {
	for ( const state of [ 0, 1, 2, 3 ] ) {
		for ( const alpha of [ 0, 64, 128, 255 ] ) {
			for ( const distance of [ 0, 320, 450, 480, 500 ] ) {
				for ( const frame of [ 10, 60, 61, 0xffffffff ] ) {
					const previous = { state, alpha, lastFrame: 10 }, retained = { ...previous };
					const expected = step( previous, distance, 0, 480, .125, frame );
					assert.equal( step( retained, distance, 0, 480, .125, frame, retained ), retained );
					assert.deepEqual( retained, expected );
					assert.deepEqual(
						previous,
						{ state, alpha, lastFrame: 10 },
						"default pure call preserves its input"
					);
				}
			}
		}
	}
	let pure = initial(), retained = initial();
	for ( let frame = 1; frame < 500; frame++ ) {
		const distance = frame % 100 < 50 ? 450 : 500;
		pure = step( pure, distance, 0, 480, 1 / 240, frame );
		step( retained, distance, 0, 480, 1 / 240, frame, retained );
		assert.deepEqual( retained, pure );
	}
});
