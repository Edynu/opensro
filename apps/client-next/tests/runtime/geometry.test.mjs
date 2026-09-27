/*
===========================================================================

geometry.test.mjs - tests for geometry.ts, geometry-validation.ts,
geometry-vertices.ts

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

const { copyGeometry } = await import( sourceFileUrl( "src/engine/foundation/rendering/geometry.ts" ).href );
function geometry() {
	return {
		world: true,
		positions: new Float32Array( 9 ),
		indices: new Uint32Array( [ 0, 1, 2 ] ),
		transform: new Float32Array( 16 ),
		instances: new Float32Array( 16 ),
		normals: new Float32Array( 9 ),
		uvs: new Float32Array( 6 ),
		colors: new Float32Array( 12 ),
		maskUVs: new Float32Array( 6 ),
		material: {
			color: [ 1, 0, 0, 1 ],
			texture: "a",
			frames: [ "a", "b" ],
			blend: false,
			doubleSided: true,
			alphaCutoff: 0
		}
	};
}
test("geometry admission preserves every field and owns all mutable attributes", () => {
	const source = geometry(), owned = copyGeometry( source );
	for ( const key of Object.keys( source ) ) assert.deepEqual( owned[key], source[key] );
	for ( const key of [ "positions", "indices", "transform", "instances", "normals", "uvs", "colors", "maskUVs" ] ) {
		source[key].fill( 99 );
		assert.notEqual( owned[key][0], 99 );
	}
	source.material.color[0] = 0;
	source.material.frames.reverse();
	assert.equal( owned.material.color[0], 1 );
	assert.deepEqual( owned.material.frames, [ "a", "b" ] );
});
test("skin admission owns all arrays and counts them in the byte budget", () => {
	const source = {
		...geometry(),
		joints: new Uint32Array( 12 ),
		weights: new Float32Array( [ 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0 ] ),
		bones: new Float32Array( 16 )
	};
	const bytes = Object.values( source ).filter( ArrayBuffer.isView ).reduce( ( n, a ) => n + a.byteLength, 0 );
	assert.throws( () => copyGeometry( source, bytes - 1 ), /budget/ );
	const owned = copyGeometry( source, bytes );
	for ( const key of [ "joints", "weights", "bones" ] ) {
		source[key].fill( 99 );
		assert.notEqual( owned[key][0], 99 );
	}
	for (
		const patch of [ { bones: undefined }, { joints: new Uint32Array( [ 999 ] ) }, {
			weights: new Float32Array( 12 )
		}, { bones: new Float32Array( 17 ) } ]
	) assert.throws( () => copyGeometry( { ...owned, ...patch } ), /skin/ );
});
test("optional attributes and animation metadata are admitted before copying", () => {
	for ( const field of [ "normals", "uvs", "colors", "maskUVs" ] ) {
		const value = geometry();
		value[field] = new Float32Array( 1 );
		assert.throws( () => copyGeometry( value ), /attributes/ );
	}
	const value = geometry();
	value.material.frames = [ "b", "a" ];
	assert.throws( () => copyGeometry( value ), /animation/ );
	value.material.frames = [ "a" ];
	value.colors[0] = NaN;
	assert.throws( () => copyGeometry( value ), /attributes/ );
});

test("indexed validators match the original scalar checks, including subarrays and nonfinite values", async () => {
	const { finiteGeometryValues, geometryIndicesInRange } = await import(
		sourceFileUrl( "src/engine/foundation/rendering/geometry-validation.ts" ).href
	);
	fc.assert(
		fc.property(
			fc.array( fc.oneof( fc.float(), fc.constantFrom( NaN, Infinity, -Infinity, -0 ) ), { maxLength: 1000 } ),
			fc.array( fc.integer( { min: 0, max: 0xffffffff } ), { maxLength: 1000 } ),
			fc.integer( { min: 0, max: 0xffffffff } ),
			( floats, indices, limit ) => {
				const f = Float32Array.from( [ Infinity, ...floats, NaN ] ).subarray( 1, floats.length + 1 );
				const u = Uint32Array.from( [ 0xffffffff, ...indices ] ).subarray( 1 );
				const bitPatterns = new Float32Array( u.buffer, u.byteOffset, u.length );
				assert.equal( finiteGeometryValues( bitPatterns ), bitPatterns.every( Number.isFinite ) );
				assert.equal( finiteGeometryValues( f ), f.every( Number.isFinite ) );
				assert.equal(
					geometryIndicesInRange( u, limit ),
					!u.some( i => i >= limit )
				);
			}
		),
		{ seed: 9091915, numRuns: 200 }
	);
	for ( const field of [ "positions", "normals", "uvs", "colors", "maskUVs", "transform", "instances" ] ) {
		for ( const bad of [ NaN, Infinity, -Infinity ] ) {
			const value = geometry();
			value[field][value[field].length - 1] = bad;
			assert.throws( () => copyGeometry( value ), /attributes/ );
		}
	}
	const value = geometry();
	value.indices[2] = 3;
	assert.throws( () => copyGeometry( value ), /dimensions/ );
});

test("packed vertex bytes match the original stream for every optional attribute combination", async () => {
	const { packGeometryVertices } = await import(
		sourceFileUrl( "src/engine/foundation/rendering/geometry-vertices.ts" ).href
	);
	fc.assert(
		fc.property(
			fc.array( fc.float( { noNaN: true, noDefaultInfinity: true } ), { minLength: 1, maxLength: 60 } ),
			fc.integer( { min: 0, max: 15 } ),
			( values, mask ) => {
				const count = values.length,
					make = n =>
						Float32Array.from( Array.from( { length: count * n + 2 }, ( _, i ) => values[i % count] ) )
							.subarray( 1, count * n + 1 );
				const data = {
					positions: make( 3 ),
					normals: mask & 1 ? make( 3 ) : undefined,
					uvs: mask & 2 ? make( 2 ) : undefined,
					colors: mask & 4 ? make( 4 ) : undefined,
					maskUVs: mask & 8 ? make( 2 ) : undefined
				};
				const reference = new Float32Array( count * 14 );
				for ( let i = 0; i < count; i++ ) {
					reference.set( data.positions.subarray( i * 3, i * 3 + 3 ), i * 14 );
					reference.set( data.normals?.subarray( i * 3, i * 3 + 3 ) ?? [ 0, 1, 0 ], i * 14 + 3 );
					reference.set( data.uvs?.subarray( i * 2, i * 2 + 2 ) ?? [ 0, 0 ], i * 14 + 6 );
					reference.set( data.colors?.subarray( i * 4, i * 4 + 4 ) ?? [ 1, 1, 1, 1 ], i * 14 + 8 );
					reference.set( data.maskUVs?.subarray( i * 2, i * 2 + 2 ) ?? [ 0, 0 ], i * 14 + 12 );
				}
				assert.deepEqual(
					new Uint8Array( packGeometryVertices( data ).buffer ),
					new Uint8Array( reference.buffer )
				);
			}
		),
		{ seed: 9091915, numRuns: 200 }
	);
});
