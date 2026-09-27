/*
===========================================================================

world-clock.test.mjs - tests for world-clock.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { root } from "../../tools/project.mjs";

const { decodeWorldClock, sampleWorldClock } = await import(
	sourceFileUrl( path.join( root, "src/engine/foundation/gameplay/world-clock.ts" ) ).href
);
test("both native packets seed the same calendar, with bounded exact payloads", () => {
	const a = decodeWorldClock( Uint8Array.of( 1, 0, 12, 0 ), 0, 50 ),
		b = decodeWorldClock( Uint8Array.of( 7, 0, 0, 0, 1, 0, 12, 0 ), 4, 50 );
	assert.deepEqual( a, b );
	assert.equal( sampleWorldClock( a, 50 ).timeOfDay, .5 );
	for ( const bad of [ [], [ 1, 0, 12 ], [ 1, 0, 12, 0, 1 ], [ 1, 0, 24, 0 ], [ 1, 0, 12, 60 ] ] ) {
		assert.throws( () => decodeWorldClock( Uint8Array.from( bad ), 0, 0 ) );
	}
});
test("retail piecewise sun curve covers dawn, dusk, midnight and integer 20ms ticks", () => {
	const sample = ( hour, elapsed = 0, day = 1 ) =>
		sampleWorldClock( { day, hour, minute: 0, receivedAtMs: 100 }, 100 + elapsed );
	assert.equal( sample( 4 ).timeOfDay, .25 );
	assert.equal( sample( 12 ).timeOfDay, .5 );
	assert.equal( sample( 20 ).timeOfDay, .75 );
	assert.equal( sample( 0 ).timeOfDay, 0 );
	assert.deepEqual( sample( 12, 19 ), sample( 12 ) );
	assert.notDeepEqual( sample( 12, 20 ), sample( 12 ) );
	assert.deepEqual( sample( 23, 72000 ), { timeOfDay: 0, lunarDay: 2 } );
	assert.equal( sample( 23, 72000, 65535 ).lunarDay, 0 );
	assert.equal( sample( 0, 0, 29 ).lunarDay, 29 ); // do not invent a client modulo-29 calendar
	assert.equal( sampleWorldClock( undefined, 0 ), null );
});
