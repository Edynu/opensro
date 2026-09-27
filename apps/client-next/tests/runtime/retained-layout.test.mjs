/*
===========================================================================

retained-layout.test.mjs - tests for retained-layout.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

const { createRetainedLayout } = await import( sourceFileUrl( "src/engine/foundation/ui/retained-layout.ts" ).href );
test("layout retention follows domain changes and reset without publishing failed builds", () => {
	fc.assert(
		fc.property(
			fc.array(
				fc.record( {
					keys: fc.array( fc.integer(), { maxLength: 8 } ),
					reset: fc.boolean(),
					fail: fc.boolean()
				} ),
				{ maxLength: 100 }
			),
			events => {
				const owner = createRetainedLayout();
				let keys, product, serial = 0;
				for ( const event of events ) {
					if ( event.reset ) {
						owner.reset();
						keys = undefined;
					}
					const same = keys?.length === event.keys.length &&
						keys.every( ( key, i ) => Object.is( key, event.keys[i] ) );
					const build = () => {
						if ( event.fail ) throw Error( "incomplete" );
						return { serial: ++serial };
					};
					if ( !same && event.fail ) {
						assert.throws( () => owner.read( event.keys, build ), /incomplete/ );
						continue;
					}
					const next = owner.read( event.keys, build );
					if ( same ) assert.equal( next, product );
					else {
						assert.notEqual( next, product );
						keys = [ ...event.keys ];
						product = next;
					}
					event.keys.push( 123 ); // Caller mutation cannot change the retained key snapshot.
				}
			}
		),
		{ seed: 2402029, numRuns: 1000 }
	);
});
