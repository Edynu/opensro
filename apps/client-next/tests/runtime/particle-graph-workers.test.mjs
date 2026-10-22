/*
===========================================================================

particle-graph-workers.test.mjs - the shipped renderer's particle graphs on the workers

With Worker threads on, characters.ts gives an effect model's particle
graph to the frame workers (particle-graphs.ts): advanceParticles requests
it and forks the phase, prepare joins it and writes the holder follow,
and the particle streams copy the kernel's records. With the same random
cursor (one effect, its graph made first) the streams the renderer
presents must be the object path's: these tests drive one renderer of
each kind through seeded graphs on a moving, turning holder and compare
every presented stream's actor rows, live count and live records,
through a rewind that replaces the graph.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRandom } from "../helpers/walk-scenario.mjs";
import { createInlineWorkers } from "../helpers/frame-kernel-threads.mjs";
import { particleGraphCase } from "../helpers/particle-graph-cases.mjs";

const { createCharacters } = await import( "../../src/engine/runtime/renderer/characters/characters.ts" );
const { PARTICLE_RECORD, RECORD_FLAGS } = await import( "../../src/engine/foundation/animation/particle-records.ts" );

const identity = () => Float32Array.of( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 );

/*
================
effectModel

An effect whose every emitter is drawn by an emitted primitive.
================
*/
function effectModel( graph ) {
	return {
		nodes: [ { name: "root", parent: -1, translation: [ 0, 0, 0 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ],
		images: [],
		clips: [ { name: "effect", duration: 30, channels: [] } ],
		particleGraph: graph,
		primitives: graph.map( ( def, n ) => ({
			name: `emitter-${n}`,
			node: 0,
			joints: [ 0 ],
			inverseBind: identity(),
			image: -1,
			particleEmitter: n,
			emission: {
				births: def.births,
				lifetime: 30,
				capacity: def.emission ? def.capacity ?? def.births.length : def.births.length
			},
			geometry: {
				positions: new Float32Array( 9 ),
				indices: Uint32Array.of( 0, 1, 2 ),
				transform: identity(),
				material: { color: [ 1, 1, 1, 1 ], alphaCutoff: 0, blend: true, doubleSided: true }
			}
		}) )
	};
}

/*
================
recorder

Geometry commands that keep each frame's presented streams by primitive.
================
*/
function recorder() {
	let frame = [];
	return {
		next() {
			const done = frame;
			frame = [];
			return done;
		},
		gpu: {
			upload: () => ({}),
			release() {},
			updateInstances: d => d,
			updateBones() {},
			presentParticles( _draw, particles ) {
				frame.push( {
					emitter: particles.primitive.particleEmitter,
					live: particles.live,
					actors: particles.actors.slice(),
					records: particles.records.slice()
				} );
			}
		}
	};
}

/*
================
sameFloats
================
*/
function sameFloats( actual, expected, label ) {
	const a = new Uint32Array( Float32Array.from( actual ).buffer ),
		b = new Uint32Array( Float32Array.from( expected ).buffer );
	assert.equal( a.length, b.length, label );
	for ( let i = 0; i < a.length; i++ ) {
		if ( a[i] !== b[i] ) assert.fail( `${label} [${i}]: ${actual[i]} != ${expected[i]}` );
	}
}

test("the shipped renderer presents a graph on the frame workers as its object graph", () => {
	let compared = 0;
	for ( let seed = 1; seed <= 16; seed++ ) {
		const random = createRandom( 0x61a + seed ), graph = particleGraphCase( random ), model = effectModel( graph );
		const workers = createInlineWorkers();
		const plain = createCharacters(), threaded = createCharacters( undefined, workers );
		const a = recorder(), b = recorder();
		plain.model( "effect", model, [] );
		threaded.model( "effect", model, [] );
		const loop = random() < .5;
		let time = 0, x = 0, yaw = 0;
		try {
			for ( let frame = 0; frame < 60; frame++ ) {
				time += [ 0, .016, .033, .05, .1 ][frame % 5];
				// A rewind restarts the history: its new graph replaces the old
				// one's rows, and the old tail must go.
				if ( frame === 40 ) time = .02;
				x += random() - .4;
				yaw += (random() - .5) * .4;
				const actors = [ {
					gid: 1,
					model: "effect",
					pose: { regionId: 257, x, y: 0, z: 0, yaw },
					clip: "effect",
					time,
					loop,
					scale: 1
				} ];
				for ( const [owner, record] of [ [ plain, a ], [ threaded, b ] ] ) {
					owner.actors( actors );
					owner.prepare( record.gpu, {}, 257, undefined, false, time );
				}
				const expected = a.next(), actual = b.next();
				assert.equal( actual.length, expected.length, `seed ${seed} frame ${frame} streams` );
				expected.forEach( ( stream, i ) => {
					const label = `seed ${seed} frame ${frame} emitter ${stream.emitter}`, got = actual[i];
					assert.equal( got.emitter, stream.emitter );
					assert.equal( got.live, stream.live, `${label} live` );
					sameFloats( got.actors, stream.actors, `${label} actor row` );
					for ( let slot = 0; slot * PARTICLE_RECORD < stream.records.length; slot++ ) {
						const at = slot * PARTICLE_RECORD;
						assert.equal(
							got.records[at + RECORD_FLAGS],
							stream.records[at + RECORD_FLAGS],
							`${label} slot ${slot}`
						);
						if ( stream.records[at + RECORD_FLAGS] === 0 ) continue;
						sameFloats(
							got.records.subarray( at, at + PARTICLE_RECORD ),
							stream.records.subarray( at, at + PARTICLE_RECORD ),
							`${label} slot ${slot}`
						);
						compared++;
					}
				} );
			}
		} finally {
			plain.dispose( a.gpu, null );
			threaded.dispose( b.gpu, null );
		}
		assert.ok( workers.phases() > 0, `seed ${seed} ran no particle phase` );
	}
	assert.ok( compared > 500, `records compared: ${compared}` );
});

test("a model that draws ribbons keeps its object graph", () => {
	const random = createRandom( 9 ), graph = particleGraphCase( random ), model = effectModel( graph );
	model.primitives[0] = { ...model.primitives[0], ribbon: { widths: new Float32Array( 1 ) } };
	const workers = createInlineWorkers(), threaded = createCharacters( undefined, workers ), record = recorder();
	threaded.model( "effect", model, [] );
	try {
		threaded.actors( [ {
			gid: 1,
			model: "effect",
			pose: { regionId: 257, x: 0, y: 0, z: 0, yaw: 0 },
			clip: "effect",
			time: .3,
			loop: false,
			scale: 1
		} ] );
		try {
			threaded.prepare( record.gpu, {}, 257, undefined, false, .3 );
		} catch {
			// The ribbon fixture is not drawable; only where its graph runs matters.
		}
		assert.equal( workers.phases(), 0 );
	} finally {
		threaded.dispose( record.gpu, null );
	}
});
