/*
===========================================================================

thunder.test.mjs - tests for thunder.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { initialThunder, advanceThunder } = await import(
	sourceFileUrl( "src/engine/foundation/rendering/thunder.ts" ).href
);
for ( const variant of [ 0, 1, 2 ] ) {
	test( "native thunder timer sequence " + variant, () => {
		let calls = 0;
		const range = ( a, b ) => {
			calls++;
			return b === 3000 ? 0 : variant;
		};
		let next = advanceThunder( initialThunder(), 10, 0, true, range );
		assert.equal( next.sound, variant );
		assert.equal( calls, 2 );
		assert.deepEqual(
			next.state.due,
			variant === 1 ? [ { id: 1, at: 11 } ] : [ { id: 1, at: 10.001 }, { id: 2, at: variant === 0 ? 11 : 10.5 } ]
		);
		const due = next.state.due[0].at;
		next = advanceThunder( next.state, due, .05, false, range );
		assert.equal( next.state.complete, false );
		assert.equal( next.state.color[3], 64 );
		next = advanceThunder( next.state, due + .05, .05, false, range );
		assert.equal( next.state.color[3], 128 );
		assert.deepEqual( next.state.target, [ 255, 255, 255, 0 ] );
		next = advanceThunder( next.state, due + .15, .1, false, range );
		assert.equal( next.state.complete, true );
		assert.deepEqual( next.state.color, [ 255, 255, 255, 0 ] );
		assert.equal( calls, 2 );
	} );
}
test("clear and snow consume no thunder RNG; malformed clocks fail closed", () => {
	const range = () => {
		throw Error( "Unexpected RNG" );
	};
	assert.deepEqual( advanceThunder( initialThunder(), 0, 0, false, range ).state, initialThunder() );
	assert.throws( () => advanceThunder( initialThunder(), NaN, 0, false, range ) );
	assert.throws( () => advanceThunder( initialThunder(), 0, -1, false, range ) );
});

test("native duplicate timer IDs keep deadlines and an unrelated pending timer survives", () => {
	const lottery = variant => ( a, b ) => b === 3000 ? 0 : variant;
	const first = advanceThunder( initialThunder(), 0, 0, true, lottery( 1 ) );
	const second = advanceThunder( first.state, .1, 0, true, lottery( 2 ) );
	assert.equal( second.sound, 2 );
	assert.deepEqual( second.state.due, [ { id: 1, at: 1 }, { id: 2, at: .6 } ] );
	const third = advanceThunder( second.state, .2, 0, true, lottery( 1 ) );
	assert.equal( third.sound, 1 );
	assert.deepEqual( third.state.due, second.state.due );
	const fired = advanceThunder( third.state, .6, .05, false, lottery( 1 ) );
	assert.deepEqual( fired.state.due, [ { id: 1, at: 1 } ] );
	assert.equal( fired.state.color[3], 64 );
});
