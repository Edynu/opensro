/*
===========================================================================

pick-blocks.test.mjs - tests for picking.ts

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

const { pickGeometry, geometryPickBlocks } = await import(
	sourceFileUrl( "src/engine/foundation/rendering/picking.ts" ).href
);
test("triangle-block rejection preserves exact surface depth, sidedness and alpha", () => {
	const positions = Float32Array.from(
		{ length: 333 * 3 },
		( _, i ) => Math.sin( i * .9 ) * 20 + Math.floor( i / 96 ) * 40
	);
	const g = {
		positions,
		indices: Uint32Array.from( { length: 333 }, ( _, i ) => i ),
		uvs: Float32Array.from( { length: 666 }, ( _, i ) => Math.sin( i ) ),
		colors: Float32Array.from( { length: 1332 }, ( _, i ) => i % 4 === 3 ? .7 : 1 ),
		material: { color: [ 1, 1, 1, .9 ], alphaCutoff: .3, doubleSided: false }
	};
	const blocks = geometryPickBlocks( g ), alpha = { width: 2, height: 2, pixels: Uint8Array.of( 0, 255, 255, 0 ) };
	const ranges = Array.from( { length: blocks.length / 6 }, ( _, i ) => {
		const center = [ 0, 1, 2 ].map( a => (blocks[i * 6 + a] + blocks[i * 6 + a + 3]) / 2 ),
			radius = Math.hypot( ...[ 0, 1, 2 ].map( a => (blocks[i * 6 + a + 3] - blocks[i * 6 + a]) / 2 ) );
		return { indexCount: Math.min( 96, g.indices.length - i * 96 ), center, radius };
	} );
	const number = fc.integer( { min: -300, max: 300 } );
	fc.assert(
		fc.property( fc.array( number, { minLength: 9, maxLength: 9 } ), v => {
			const m = Float32Array.of( v[6] / 20, 0, 0, 0, .2, v[7] / 20, 0, 0, 0, .3, v[8] / 20, 0, 10, -4, 3, 1 );
			const ray = { start: v.slice( 0, 3 ), delta: v.slice( 3, 6 ) }, surface = { alpha, opacity: .8 };
			assert.equal(
				pickGeometry( ray, g, m, undefined, { ...surface, blocks } ),
				pickGeometry( ray, g, m, undefined, surface )
			);
			assert.equal(
				pickGeometry( ray, g, m, undefined, { ...surface, ranges } ),
				pickGeometry( ray, g, m, undefined, surface )
			);
		} ),
		{ seed: 2402027, numRuns: 5000 }
	);
	for ( const doubleSided of [ false, true ] ) {
		for ( const opacity of [ 0, .2, 1 ] ) {
			const plane = {
				...g,
				positions: Float32Array.of( -1, -1, .5, 1, -1, .5, 0, 1, .5 ),
				indices: Uint32Array.of( 0, 1, 2 ),
				material: { ...g.material, doubleSided }
			};
			const m = Float32Array.of( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ),
				ray = { start: [ 0, 0, 0 ], delta: [ 0, 0, 1 ] };
			assert.equal(
				pickGeometry( ray, plane, m, undefined, { alpha, opacity, blocks: geometryPickBlocks( plane ) } ),
				pickGeometry( ray, plane, m, undefined, { alpha, opacity } )
			);
		}
	}
});
