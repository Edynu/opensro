/*
===========================================================================

world-cloth-workers.test.mjs - the world's cloth meshes on the frame workers

With Worker threads on, the world renderer's cloth meshes are wearers in
their own bank (foundation/animation/cloth-wearers.ts WORLD_CLOTH) and
step in one phase a frame; with them off, each is an object cloth
(cloth-vertices.ts). Each wearer draws from its own random stream instead
of the shared presentation stream, so simulated frames differ in their
draws only. These tests drive one world renderer of each kind through the
same frames: both upload on the same frames (a mesh with no step due and
an unchanged palette is held), the same vertices while cloth is off, and
finite simulated vertices while it is on; a scene change releases the
wearers.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { clothCase } from "../helpers/cloth-cases.mjs";
import { createInlineWorkers } from "../helpers/frame-kernel-threads.mjs";

const { createWorldRenderer } = await import( "../../src/engine/runtime/renderer/world/world.ts" );
const { createPresentationRandom } = await import( "../../src/engine/runtime/random/random.ts" );
const { INITIAL_WORLD_CLOTH_MESHES } = await import( "../../src/engine/foundation/kernels/frame-kernels.ts" );
const { CLOTH_RECORD } = await import( "../../src/engine/foundation/kernels/cloth-record.ts" );

const identity = () => Float32Array.of( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 );

/*
================
clothScene

One world group of the cloth fixture's mesh, unskinned as a flag is.
================
*/
/** @returns {import("../../src/engine/contracts/scene.ts").WorldScene} */
function clothScene( id ) {
	const fixture = clothCase( 7 ), count = fixture.rest.length / 3;
	return {
		id,
		originRegion: 1,
		warnings: [],
		groups: [ {
			id,
			center: [ 960, 0, 960 ],
			radius: 10000,
			material: { color: [ 1, 1, 1, 1 ], alphaCutoff: 0, blend: false, doubleSided: true },
			geometry: {
				positions: fixture.rest,
				normals: new Float32Array( count * 3 ),
				uvs: new Float32Array( count * 2 ),
				indices: Uint32Array.of( 0, 1, 2 ),
				instances: identity(),
				transform: identity(),
				cloth: fixture.data
			}
		} ]
	};
}

/*
================
recorder

Geometry commands that record each frame's cloth uploads, by either call.
================
*/
function recorder() {
	const frames = [];
	const write = ( _draw, base, vertices ) => {
		assert.equal( base, 0 );
		frames.at( -1 ).push( vertices.slice() );
	};
	return {
		frames,
		geometry: /** @type {any} */ ({
			upload: () => ({ instanceCount: 1 }),
			release() {},
			updateInstances: draw => draw,
			writeVertices: write,
			streamVertices: write,
			streamOutputVertices: write
		}),
		textures: /** @type {any} */ ({ upload: () => ({}), release() {} })
	};
}

/*
================
drive

A world renderer through the frames: cloth off in the first third.
================
*/
function drive( world, record, frames ) {
	world.scene( clothScene( "town" ) );
	world.camera( { eye: [ 0, 0, 0 ], target: [ 0, 0, -1 ], near: 1, far: 1000, fov: Math.PI / 3 } );
	let seconds = 0;
	for ( let frame = 0; frame < frames; frame++ ) {
		seconds += [ 0, .016, .033, .05, .1, .016 ][frame % 6];
		record.frames.push( [] );
		world.prepare( record.geometry, record.textures, 1, seconds, 1, 1, undefined, false, frame >= frames / 3 );
	}
}

test("world cloth on the frame workers uploads on the object cloth's frames", () => {
	const frames = 120;
	const objects = recorder(), wearers = recorder();
	const plain = createWorldRenderer( undefined, undefined, createPresentationRandom( 5 ) );
	const workers = createInlineWorkers();
	const threaded = createWorldRenderer( undefined, undefined, createPresentationRandom( 5 ), undefined, workers );
	drive( plain, objects, frames );
	drive( threaded, wearers, frames );
	let uploads = 0, simulated = 0;
	for ( let frame = 0; frame < frames; frame++ ) {
		const a = objects.frames[frame], b = wearers.frames[frame];
		assert.equal( b.length, a.length, `frame ${frame} uploads` );
		uploads += a.length;
		for ( let i = 0; i < a.length; i++ ) {
			assert.equal( b[i].length, a[i].length );
			if ( frame < frames / 3 ) assert.deepEqual( b[i], a[i], `frame ${frame}: cloth off draws no random` );
			else {
				assert.ok( b[i].every( Number.isFinite ), `frame ${frame}` );
				simulated++;
			}
		}
	}
	assert.ok( uploads > 10 && uploads < frames, `held frames: ${uploads} uploads` );
	assert.ok( simulated > 5 );
	assert.ok( workers.phases() > 5 );
	threaded.dispose( wearers.geometry, wearers.textures );
	plain.dispose( objects.geometry, objects.textures );
});

test("a scene change releases the world's wearers and admits the new scene's", () => {
	const record = recorder(), workers = createInlineWorkers();
	const world = createWorldRenderer( undefined, undefined, createPresentationRandom( 1 ), undefined, workers );
	drive( world, record, 12 );
	// Each replacement releases the old group's wearer; its slot is reused,
	// so many replacements stay within the first records.
	for ( let i = 0; i < 40; i++ ) {
		world.scene( clothScene( `scene-${i}` ) );
		record.frames.push( [] );
		world.prepare( record.geometry, record.textures, 1, 10 + i, 1, 1, undefined, false, true );
		assert.equal( record.frames.at( -1 ).length, 1, `scene ${i} uploads its new mesh` );
	}
	const records = INITIAL_WORLD_CLOTH_MESHES * CLOTH_RECORD * Float64Array.BYTES_PER_ELEMENT;
	assert.equal( workers.memory().worldClothRecords.byteLength, records, "no wearer outlives its scene" );
	world.dispose( record.geometry, record.textures );
});
