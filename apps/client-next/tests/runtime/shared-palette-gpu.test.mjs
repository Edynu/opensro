/*
===========================================================================

shared-palette-gpu.test.mjs - tests for the client modules it imports

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInlineWorkers } from "../helpers/frame-kernel-threads.mjs";
async function load( path ) {
	return import( sourceFileUrl( path ).href );
}
const { createCharacters, createGeometryResources } = {
	...(await load( "src/engine/runtime/renderer/characters/characters.ts" )),
	...(await load( "src/engine/runtime/renderer/device/geometry.ts" ))
};
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4, VERTEX: 8, INDEX: 16 };
globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };
const I = () => Float32Array.of( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 );
function fixture() {
	const buffers = [],
		writes = [],
		gpu = {
			createBuffer( { size, label } ) {
				const b = {
					size,
					label,
					bytes: new Uint8Array( size ),
					destroyed: 0,
					destroy() {
						this.destroyed++;
					}
				};
				buffers.push( b );
				return b;
			},
			createTexture() {
				return {
					createView() {
						return {};
					},
					destroy() {}
				};
			},
			// The sun cascade's comparison sampler (bindings 13/14).
			createSampler() {
				return {};
			},
			createBindGroup( { entries } ) {
				return entries;
			},
			pushErrorScope() {},
			popErrorScope() {
				return Promise.resolve( null );
			},
			queue: {
				writeTexture() {},
				writeBuffer( buffer, offset, data, start, length ) {
					assert.equal( buffer.destroyed, 0 );
					buffer.bytes.set( new Uint8Array( data, start, length ), offset );
					writes.push( { buffer, length, data } );
				}
			}
		};
	const resources = createGeometryResources(
		gpu,
		() => gpu,
		e => {
			throw e;
		},
		// One geometry pipeline per state.
		() => ({
			getBindGroupLayout() {
				return {};
			}
		}),
		{ texture() {}, acquire() {}, drop() {} },
		{},
		{},
		{},
		() => ({})
	);
	return { resources, buffers, writes };
}
const binding = ( draw, n ) => draw.binding.find( e => e.binding === n ).resource.buffer;
// The floats a binding exposes: slab ranges bind at an offset (buffer-slabs.ts).
const bound = ( draw, n ) => {
	const resource = draw.binding.find( e => e.binding === n ).resource;
	return new Float32Array(
		resource.buffer.bytes.buffer,
		resource.offset ?? 0,
		(resource.size ?? resource.buffer.size) / 4
	);
};
const geometry = () => ({
	positions: Float32Array.of( -1, -1, 0, 1, -1, 0, 0, 1, 0 ),
	indices: Uint32Array.of( 0, 1, 2 ),
	transform: I(),
	joints: new Uint32Array( 12 ),
	weights: Float32Array.of( 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0 )
});
test("shared GPU palette has one upload per revision and one lifetime across draw handles", () => {
	const f = fixture(), bones = new Float32Array( 64 ), g = { ...geometry(), bones }, c = f.resources.commands;
	const a = c.upload( g, undefined, Uint32Array.of( 0 ) ),
		b = c.upload( g, undefined, Uint32Array.of( 0 ) ),
		buffer = binding( a, 7 );
	assert.equal( buffer, binding( b, 7 ) );
	f.writes.length = 0;
	assert.equal( c.updateBones( a, bones.subarray( 0, 16 ), 1 ), 64 );
	assert.equal( c.updateBones( b, bones.subarray( 0, 16 ), 1 ), 0 );
	assert.equal( f.writes.length, 1 );
	assert.throws( () => c.updateBones( a, bones, 0 ), /revision/ );
	assert.throws( () => c.updateBones( a, bones.slice(), 2 ), /revision/ );
	assert.throws( () => c.updateInstances( a, I(), undefined, undefined, undefined, Uint32Array.of( 4 ) ), /offset/ );
	const grown = c.updateInstances(
		a,
		new Float32Array( 32 ),
		undefined,
		undefined,
		undefined,
		Uint32Array.of( 0, 1 )
	);
	assert.equal( binding( grown, 7 ), buffer );
	const packed = bound( grown, 1 );
	assert.equal( packed[17], 0 );
	assert.equal( packed[18], 1 );
	assert.equal( packed[57], 1 );
	c.release( a );
	assert.equal( buffer.destroyed, 0 );
	c.release( grown );
	assert.equal( buffer.destroyed, 0 );
	c.release( b );
	assert.equal( buffer.destroyed, 1 );
	f.resources.dispose();
	assert.ok( f.buffers.every( b => b.destroyed === 1 ) );
});
test("shader-addressed shared palettes equal expanded poses through merge, split, membership and recovery", () => {
	let f = fixture();
	const retired = [],
		owner = createCharacters(),
		p = { name: "body", node: 0, image: -1, joints: [ 0 ], inverseBind: I(), geometry: geometry() },
		q = { ...p, name: "clothing", inverseBind: I(), geometry: geometry() };
	const model = {
		nodes: [ { name: "root", parent: -1, translation: [ 0, 0, 0 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ],
		images: [],
		clips: [ {
			name: "move",
			duration: 1,
			channels: [ {
				node: 0,
				path: "translation",
				interpolation: "LINEAR",
				times: Float32Array.of( 0, 1 ),
				values: Float32Array.of( 0, 0, 0, 1, 2, 3 )
			} ]
		} ],
		primitives: [ p, q ]
	};
	owner.model( "m", model, [] );
	for ( let frame = 0; frame < 40; frame++ ) {
		if ( frame === 20 ) {
			f.resources.dispose();
			retired.push( ...f.buffers );
			owner.invalidate();
			f = fixture();
		}
		const rows = Array.from(
			{ length: frame % 3 === 0 ? 3 : 4 },
			( _, i ) => ({
				gid: i + 1,
				model: "m",
				clip: "move",
				time: frame % 2 ? .25 : (frame + i) / 100,
				loop: true,
				scale: 1,
				pose: { regionId: 257, x: i, y: 0, z: 10, yaw: 0 }
			})
		);
		owner.actors( rows );
		f.writes.length = 0;
		const draws = owner.prepare( f.resources.commands, {}, 257 );
		assert.equal( binding( draws[0], 7 ), binding( draws[1], 7 ) );
		for ( const draw of draws ) {
			const packed = bound( draw, 1 ),
				bones = new Float32Array( binding( draw, 7 ).bytes.buffer );
			for ( let i = 0; i < rows.length; i++ ) {
				const offset = packed[i * 40 + 17] * 16, expected = I();
				expected[12] = rows[i].time;
				expected[13] = rows[i].time * 2;
				expected[14] = rows[i].time * 3;
				assert.deepEqual( bones.slice( offset, offset + 16 ), expected, `frame ${frame} actor ${i}` );
			}
		}
		assert.ok( f.writes.filter( w => w.buffer === binding( draws[0], 7 ) ).length <= 1 );
	}
	owner.dispose( f.resources.commands, null );
	f.resources.dispose();
	assert.ok( [ ...retired, ...f.buffers ].every( b => b.destroyed === 1 ) );
});

/*
================
poolModel

A one-node model whose two primitives (one binding each) skin joints
joints, every one to the root: each palette matrix is the root's.
================
*/
function poolModel( joints = 1 ) {
	const primitive = name => ({
		name,
		node: 0,
		image: -1,
		joints: new Array( joints ).fill( 0 ),
		inverseBind: new Float32Array( joints * 16 ).map( ( _, i ) => i % 5 === 0 ? 1 : 0 ),
		geometry: geometry()
	});
	return {
		nodes: [ { name: "root", parent: -1, translation: [ 0, 0, 0 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ],
		images: [],
		clips: [ {
			name: "move",
			duration: 1,
			channels: [ {
				node: 0,
				path: "translation",
				interpolation: "LINEAR",
				times: Float32Array.of( 0, 1 ),
				values: Float32Array.of( 0, 0, 0, 1, 2, 3 )
			} ]
		} ],
		primitives: [ primitive( "body" ), primitive( "clothing" ) ]
	};
}

/*
================
drivePool

The renderer on the frame workers' shared skeletons through frames of
count( frame ) actors, membership changing; every instance's palettes
read from the GPU buffer its draw binds, at its offset, must be its
pose's.
================
*/
function drivePool( joints, count, frames ) {
	const f = fixture(), owner = createCharacters( undefined, createInlineWorkers( 1, true ) );
	owner.model( "m", poolModel( joints ), [] );
	for ( let frame = 0; frame < frames; frame++ ) {
		const rows = Array.from( { length: count( frame ) }, ( _, i ) => ({
			gid: i + 1,
			model: "m",
			clip: "move",
			time: (frame * 7 + i) % 100 / 100,
			loop: true,
			scale: 1,
			pose: { regionId: 257, x: i, y: 0, z: 10, yaw: 0 }
		}) );
		owner.actors( rows );
		f.writes.length = 0;
		const draws = owner.prepare( f.resources.commands, {}, 257 );
		const pool = binding( draws[0], 7 );
		assert.equal( pool.label, "geometry-palette-pool", "the draws bind the palette pool" );
		for ( const draw of draws ) {
			assert.equal( binding( draw, 7 ), pool );
			const packed = bound( draw, 1 ), bones = new Float32Array( pool.bytes.buffer );
			for ( let i = 0; i < rows.length; i++ ) {
				const offset = packed[i * 40 + 17] * 16, expected = I();
				expected[12] = rows[i].time;
				expected[13] = rows[i].time * 2;
				expected[14] = rows[i].time * 3;
				for ( const joint of [ 0, joints - 1 ] ) {
					assert.deepEqual(
						bones.slice( offset + joint * 16, offset + joint * 16 + 16 ),
						expected,
						`frame ${frame} actor ${i} joint ${joint}`
					);
				}
			}
		}
		// Straight from the shared table: no palette was copied to upload it.
		const uploads = f.writes.filter( write => write.buffer.label === "geometry-palette-pool" );
		assert.ok( uploads.length > 0, `frame ${frame} uploads its changed palettes` );
		assert.ok( uploads.every( write => write.data instanceof SharedArrayBuffer ), `frame ${frame} shared` );
	}
	assert.equal( f.buffers.filter( buffer => buffer.label === "geometry-palette" ).length, 0, "no batch palette" );
	owner.dispose( f.resources.commands, null );
	f.resources.dispose();
	return f;
}

test("pooled palettes are read by every draw at its instances' offsets, uploaded from shared memory", () => {
	drivePool( 1, frame => 5 - frame % 2, 30 );
});

test("a palette table outgrown by its poses is replaced and the pooled draws bind the new pool", () => {
	// 40 poses of two 4096-joint bindings outgrow the table's first size,
	// after the first 10 have drawn from it.
	const f = drivePool( 4096, frame => frame < 2 ? 10 : 40, 5 );
	const pools = f.buffers.filter( buffer => buffer.label === "geometry-palette-pool" );
	assert.ok( pools.length >= 2, `pools ${pools.length}` );
	assert.ok( pools.every( buffer => buffer.destroyed === 1 ) );
});
