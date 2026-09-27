/*
===========================================================================

loading-presentation.test.mjs - tests for loading-presentation.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { loadingPresentation: step } = await import(
	sourceFileUrl( "src/engine/foundation/ui/loading-presentation.ts" ).href
);
const request = {
	key: "mission",
	background: "entry.png",
	progress: .66,
	complete: false,
	startup: false,
	status: "Loading models"
};
test("entry starts empty, discovery cannot rewind it or replace its artwork", () => {
	let state = step( null, request, 0 );
	assert.equal( state.progress, 0 );
	for ( const [estimate, expected] of [ [ .4, .4 ], [ .1, .4 ], [ NaN, .4 ], [ .8, .8 ], [ 1, .99 ] ] ) {
		state = step( state, { ...request, background: "destination.png", progress: estimate }, 10 );
		assert.equal( state.progress, expected );
		assert.equal( state.background, "entry.png" );
	}
});
test("completion is presented even when producer skips directly to the next scene", () => {
	let state = step( null, request, 0 );
	state = step( state, { ...request, progress: .5 }, 10 );
	state = step( state, null, 20 );
	assert.equal( state.progress, 1 );
	assert.equal( state.status, "Ready" );
	assert.equal( step( state, null, 119 ), state );
	assert.equal( step( state, null, 120 ), null );
});
test("readiness fills the bar; later loading estimates cannot undo completion", () => {
	let state = step( null, request, 0 );
	state = step( state, { ...request, complete: true }, 10 );
	assert.equal( state.progress, 1 );
	assert.equal( step( state, request, 200 ).progress, 1 );
	assert.equal( step( state, null, 200 ), null );
});
test("new generations reset while cancellation never pretends success", () => {
	const old = step( step( null, request, 0 ), request, 10 );
	assert.equal( step( old, null, 11, true ), null );
	const fresh = step( old, { ...request, key: "loading-create:3", background: "creation.png" }, 11 );
	assert.equal( fresh.progress, 0 );
	assert.equal( fresh.background, "creation.png" );
});
