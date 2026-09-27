/*
===========================================================================

gpu-timing.test.mjs - tests for timing.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { createGpuTiming } = await import( sourceFileUrl( "src/engine/runtime/renderer/device/timing.ts" ).href );
test("GPU timing skips busy slots, reads nanoseconds asynchronously and ignores disposed completions", async t => {
	const previous = [ "GPUBufferUsage", "GPUMapMode" ].map(
		k => [ k, Object.getOwnPropertyDescriptor( globalThis, k ) ]
	);
	t.after( () => {
		for ( const [k, v] of previous ) {
			if ( v ) Object.defineProperty( globalThis, k, v );
			else delete globalThis[k];
		}
	} );
	globalThis.GPUBufferUsage = { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 };
	globalThis.GPUMapMode = { READ: 1 };
	const pending = [];
	let destroyed = 0, unmapped = 0;
	const device = {
		createQuerySet: () => ({
			destroy() {
				destroyed++;
			}
		}),
		createBuffer: () => ({
			destroy() {
				destroyed++;
			},
			mapAsync() {
				return new Promise( resolve => pending.push( resolve ) );
			},
			getMappedRange() {
				return BigUint64Array.from( [ 1000000n, 3500000n ] ).buffer;
			},
			unmap() {
				unmapped++;
			}
		})
	};
	const owner = createGpuTiming( device );
	for ( let i = 0; i < 3; i++ ) {
		const frame = owner.begin( 100 + i );
		assert.equal( frame.pass( "main" ).endOfPassWriteIndex, 1 );
		assert.equal( frame.resolve().count, 2 );
		frame.submitted();
		assert.throws( () => frame.submitted() );
	}
	assert.equal( owner.begin(), undefined );
	assert.equal( owner.stats().skipped, 1 );
	assert.equal( owner.stats().samples.length, 0 );
	pending.shift()();
	await Promise.resolve();
	assert.equal( owner.stats().samples[0].passes[0].ms, 2.5 );
	assert.equal( owner.stats().samples[0].frameId, 100 );
	assert.equal( unmapped, 1 );
	const next = owner.begin();
	assert.ok( next );
	assert.equal( next.resolve(), undefined );
	next.submitted();
	owner.dispose();
	for ( const resolve of pending ) resolve();
	await Promise.resolve();
	assert.equal( destroyed, 9 );
	assert.equal( unmapped, 1 );
	assert.equal( owner.begin(), undefined );
	assert.equal( owner.stats().samples.length, 0 );
});
