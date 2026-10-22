/*
===========================================================================

deferred-continuation.test.mjs - a continuation that would draw nothing is skipped

renderer.ts runs a second character prepare after the occlusion query
(the deferred particles' continuation) only when a queued emitter draws
(characters.ts deferredDrawing). Skipping one that would draw nothing must
change nothing the renderer shows: these tests drive two shipped character
owners through the same frames, one always running the continuation and one
skipping it as the renderer does, with an effect drawn at once and a
deferred one whose query results come and go, and compare every presented
particle stream of every main pass and every continuation both ran, as the
GPU draws it.

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

Geometry commands that keep each pass's presented streams.
================
*/
function recorder() {
	let pass = [];
	return {
		next() {
			const done = pass;
			pass = [];
			return done;
		},
		gpu: {
			upload: () => ({}),
			release() {},
			updateInstances: d => d,
			updateBones() {},
			presentParticles( _draw, particles ) {
				pass.push( {
					emitter: particles.primitive.particleEmitter,
					live: particles.live,
					actors: Array.from( particles.actors ),
					records: Array.from( particles.records )
				} );
			}
		}
	};
}

/*
================
samePass

Two passes' presented streams as the GPU draws them: the same emitters,
rows and live counts, every record's flags, and every drawn record (a
record the GPU skips, flags 0, may keep an older particle's bytes).
================
*/
function samePass( actual, expected, label ) {
	assert.equal( actual.length, expected.length, `${label} streams` );
	expected.forEach( ( stream, i ) => {
		const got = actual[i];
		assert.equal( got.emitter, stream.emitter, `${label} emitter` );
		assert.equal( got.live, stream.live, `${label} live` );
		assert.deepEqual( got.actors, stream.actors, `${label} actor rows` );
		assert.equal( got.records.length, stream.records.length, `${label} records` );
		for ( let at = 0; at < stream.records.length; at += PARTICLE_RECORD ) {
			assert.equal( got.records[at + RECORD_FLAGS], stream.records[at + RECORD_FLAGS], `${label} flags ${at}` );
			if ( stream.records[at + RECORD_FLAGS] === 0 ) continue;
			assert.deepEqual(
				got.records.slice( at, at + PARTICLE_RECORD ),
				stream.records.slice( at, at + PARTICLE_RECORD ),
				`${label} record ${at / PARTICLE_RECORD}`
			);
		}
	} );
}

/*
================
drive

Frames of one effect drawn at once and one deferred, through two owners:
always runs every continuation, skip runs one only when a queued emitter
draws. Returns how many continuations were skipped and run.
================
*/
function drive( seed, workers ) {
	const random = createRandom( 0xdef0 + seed );
	const plain = particleGraphCase( random ), light = particleGraphCase( random );
	const owners = [ createCharacters( undefined, workers?.() ), createCharacters( undefined, workers?.() ) ];
	const records = [ recorder(), recorder() ];
	for ( const owner of owners ) {
		owner.model( "plain", effectModel( plain ), [] );
		owner.model( "light", effectModel( light ), [] );
	}
	let skipped = 0, ran = 0, time = 0;
	const visibility = [];
	try {
		for ( let frame = 0; frame < 90; frame++ ) {
			time += [ .016, .033, .05, .1 ][frame % 4];
			const actors = [ {
				gid: 1,
				model: "plain",
				pose: { regionId: 257, x: 1, y: 0, z: 0, yaw: 0 },
				clip: "effect",
				time,
				loop: true,
				scale: 1
			}, {
				gid: 2,
				model: "light",
				pose: { regionId: 257, x: -1, y: 0, z: 0, yaw: 0 },
				clip: "effect",
				time,
				loop: true,
				scale: 1,
				deferredParticle: { offset: 11 }
			} ];
			// The query's answer for this frame, the same for both owners.
			visibility.push( random() < .6 );
			const passes = [];
			for ( const [index, owner] of owners.entries() ) {
				const record = records[index];
				owner.actors( actors );
				owner.prepare( record.gpu, {}, 257, undefined, false, time );
				const main = record.next();
				const plan = owner.deferredPlan( 257, [ 0, 10, 10 ], true, true );
				let continuation;
				if ( plan ) {
					owner.completeDeferred(
						plan.query ?
							Array.from( { length: plan.points.length / 4 }, () => visibility[frame] ) :
							undefined
					);
					if ( index === 0 || owner.deferredDrawing() ) {
						owner.prepare( record.gpu, {}, 257, undefined, false, time, true );
						continuation = record.next();
					}
				}
				passes.push( { main, continuation, drawing: plan ? owner.deferredDrawing() : false } );
			}
			const [always, skip] = passes;
			samePass( skip.main, always.main, `seed ${seed} frame ${frame} main pass` );
			assert.equal( skip.drawing, always.drawing );
			if ( skip.continuation ) {
				ran++;
				samePass( skip.continuation, always.continuation, `seed ${seed} frame ${frame} continuation` );
			} else if ( always.continuation ) {
				skipped++;
				// What the skipped pass would have shown: nothing of the light.
				assert.ok(
					always.continuation.every( stream => stream.live === 0 ),
					`seed ${seed} frame ${frame} skipped a continuation that drew`
				);
			}
		}
	} finally {
		for ( const [index, owner] of owners.entries() ) owner.dispose( records[index].gpu, null );
	}
	return { skipped, ran };
}

test("skipping a continuation with no queued emitter to draw changes no pass", () => {
	let skipped = 0, ran = 0;
	for ( let seed = 1; seed <= 6; seed++ ) {
		const counts = drive( seed );
		skipped += counts.skipped;
		ran += counts.ran;
	}
	assert.ok( skipped > 20 && ran > 20, `skipped ${skipped}, ran ${ran}` );
});

test("with the frame workers, skipping a continuation changes no pass either", () => {
	const counts = drive( 7, () => createInlineWorkers() );
	assert.ok( counts.skipped > 0 && counts.ran > 0, `skipped ${counts.skipped}, ran ${counts.ran}` );
});
