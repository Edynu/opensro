/*
===========================================================================

skeleton-kernel.test.mjs - character poses on flat memory against the objects

With Worker threads on, the world's character poses keep their matrices
in the frame workers' shared tables and materialize through
foundation/kernels/skeleton-kernel.ts, at once or in one phase
(renderer/characters/skeletons.ts). The matrices must be the object
pose's (animation-pose.ts) bit for bit: these tests drive both with the
same seeded models and inputs (linear, step and cubic channels, shared and
distinct key clocks, blended event and timed layers, a non-single-track
clip, authored node matrices, body volume, bone rotators set and dropped,
a clip admitted mid-run) and compare every palette and socket after every
evaluation; then many poses in phases on real worker threads, and every
chunk run twice as a stalled worker's chunk is. The phase writes the
palettes too, which must not be read once the body volume changed.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRandom } from "../helpers/walk-scenario.mjs";
import { createInlineWorkers, createThreadedWorkers } from "../helpers/frame-kernel-threads.mjs";

const { createCharacterPose } = await import( "../../src/engine/foundation/animation/animation-pose.ts" );
const { createSkeletons, sharedSkeletons } = await import(
	"../../src/engine/runtime/renderer/characters/skeletons.ts"
);
const { INITIAL_SKELETONS, INITIAL_SKELETON_STATE_FLOATS } = await import(
	"../../src/engine/foundation/kernels/frame-kernels.ts"
);

/** @typedef {import("../../src/engine/contracts/character.ts").CharacterChannel} CharacterChannel */
/** @typedef {import("../../src/engine/contracts/character.ts").CharacterClip} CharacterClip */

// Bone names the body volume table and the rotator act on.
const NAMED = [ "Bip01", "Bip01 Pelvis", "Bip01 Spine", "Bip01 Spine1", "Bip01 L Thigh", "Bip01 R UpperArm" ];
/** @type {CharacterChannel["path"][]} */
const PATHS = [ "translation", "rotation", "scale" ];
/** @type {CharacterChannel["interpolation"][]} */
const INTERPOLATIONS = [ "LINEAR", "LINEAR", "STEP", "CUBICSPLINE" ];

/*
================
quaternion
================
*/
function quaternion( random ) {
	const q = [ random() - .5, random() - .5, random() - .5, random() - .5 ];
	const length = Math.hypot( ...q );
	return q.map( c => c / length );
}

/*
================
createClip

Channels on random nodes with one key clock most share, a copy of its
bytes and a clock of their own; duplicate makes one node/path twice.
================
*/
function createClip( random, name, nodes, duplicate ) {
	const keys = 2 + Math.floor( random() * 6 ), duration = .5 + random() * 1.5;
	const clock = Float32Array.from( { length: keys }, ( _, i ) => duration * i / (keys - 1) );
	/** @type {CharacterChannel[]} */
	const channels = [];
	for ( let node = 0; node < nodes; node++ ) {
		if ( random() < .35 ) continue;
		for ( const path of PATHS ) {
			if ( random() < .4 ) continue;
			const interpolation = INTERPOLATIONS[Math.floor( random() * INTERPOLATIONS.length )];
			const choice = random();
			const times = choice < .7 ?
				clock :
				choice < .85 ?
				clock.slice() :
				Float32Array.from( { length: 1 + Math.floor( random() * 5 ) }, ( _, i ) => i * duration / 4 );
			const width = path === "rotation" ? 4 : 3, copies = interpolation === "CUBICSPLINE" ? 3 : 1;
			const values = new Float32Array( times.length * width * copies );
			for ( let key = 0; key < times.length * copies; key++ ) {
				const value = path === "rotation" ?
					quaternion( random ) :
					path === "scale" ?
					[ .8 + random() * .4, .8 + random() * .4, .8 + random() * .4 ] :
					[ random() * 4 - 2, random() * 4 - 2, random() * 4 - 2 ];
				values.set( value, key * width );
			}
			channels.push( { node, path, interpolation, times, values } );
		}
	}
	if ( duplicate && channels.length ) {
		channels.push( { ...channels[0], values: channels[0].values.slice().reverse() } );
	}
	return { name, duration, channels };
}

/*
================
createModel

A skeleton of nodes with named bones, authored matrices on every seventh
node, clips (one not single-track) and two primitives over some joints.
================
*/
function createModel( random, nodes ) {
	const model = {
		nodes: Array.from( { length: nodes }, ( _, i ) => ({
			name: NAMED[i] ?? `bone-${i}`,
			parent: i ? Math.floor( random() * i ) : -1,
			translation: [ random() * 2, random() * 2, random() * 2 ],
			rotation: quaternion( random ),
			scale: [ 1, .9 + random() * .2, 1 ],
			...(i % 7 === 6 ?
				{ matrix: Array.from( { length: 16 }, ( _, c ) => c % 5 === 0 ? 1 : random() * .1 ) } :
				{})
		}) ),
		clips: /** @type {CharacterClip[]} */ ([]),
		images: [],
		primitives: /** @type {any[]} */ ([])
	};
	model.clips = [ 0, 1, 2, 3 ].map( i => createClip( random, `clip-${i}`, nodes, i === 3 ) );
	for ( let p = 0; p < 2; p++ ) {
		const joints = Array.from(
			{ length: 1 + Math.floor( random() * (nodes - 1) ) },
			() => Math.floor( random() * nodes )
		);
		const inverseBind = Float32Array.from(
			{ length: joints.length * 16 },
			( _, i ) => i % 5 === 0 ? 1 : random() * .2
		);
		model.primitives.push( { name: `part-${p}`, node: 0, image: -1, joints, inverseBind, geometry: {} } );
	}
	return model;
}

/*
================
drive

One frame's inputs for a pose, from random: a clip and time, or layers in
both lanes (some at weight 0 or 1), now and then a body volume change, a
rotator set or dropped.
================
*/
function drive( random, model, frame ) {
	const clip = model.clips[Math.floor( random() * model.clips.length )].name;
	const time = frame * .037 + random() * .01;
	const layers = random() < .5 ?
		undefined :
		Array.from( { length: 1 + Math.floor( random() * 3 ) }, () => ({
			clip: model.clips[Math.floor( random() * model.clips.length )].name,
			time: random() * 3,
			loop: random() < .7,
			weight: [ 0, 1, random(), random() ][Math.floor( random() * 4 )],
			lane: random() < .4 ? "event" : "timed"
		}) );
	return {
		clip,
		time,
		loop: random() < .8,
		layers,
		volume: random() < .1 ? [ Math.floor( random() * 5 ), random() < .5 ] : undefined,
		rotation: random() < .15 ? quaternion( random ) : random() < .1 ? null : undefined
	};
}

/*
================
apply
================
*/
function apply( pose, input, defer = false ) {
	if ( input.volume ) pose.bodyVolume( input.volume[0], input.volume[1] );
	if ( input.rotation !== undefined ) pose.setBoneRotation( "Bip01 Spine", input.rotation );
	return pose.evaluate( input.clip, input.time, input.loop, input.layers, defer );
}

/*
================
sameBits
================
*/
function sameBits( actual, expected, label ) {
	const a = new Uint32Array( Float32Array.from( actual ).buffer ),
		b = new Uint32Array( Float32Array.from( expected ).buffer );
	assert.equal( a.length, b.length, label );
	for ( let i = 0; i < a.length; i++ ) {
		if ( a[i] !== b[i] ) assert.fail( `${label} [${i}]: ${actual[i]} != ${expected[i]}` );
	}
}

/*
================
compare

Every palette and socket of the flat pose against the object pose.
================
*/
function compare( flat, object, model, label ) {
	assert.equal( flat.revision(), object.revision(), `${label} revision` );
	for ( const primitive of model.primitives ) {
		const a = new Float32Array( primitive.joints.length * 16 ),
			b = new Float32Array( primitive.joints.length * 16 );
		flat.palette( primitive, a );
		object.palette( primitive, b );
		sameBits( a, b, `${label} ${primitive.name}` );
	}
	for ( const name of [ "Bip01", "Bip01 Spine", "bone-9", "bone-13" ] ) {
		for ( const compound of [ false, true ] ) {
			const a = flat.socket( name, compound ), b = object.socket( name, compound );
			if ( b === null ) assert.equal( a, null );
			else sameBits( a, b, `${label} socket ${name} ${compound}` );
		}
	}
	assert.equal( flat.cpuEvaluations(), object.cpuEvaluations(), `${label} evaluations` );
}

test("a pose on flat memory materializes every matrix bit as the object pose", () => {
	const workers = createInlineWorkers( 1, true ), skeletons = createSkeletons( workers );
	for ( const seed of [ 1, 2, 3 ] ) {
		const random = createRandom( 0x5e1e + seed ), model = createModel( random, 10 + seed * 8 );
		const flat = createCharacterPose( model, skeletons.pose ), object = createCharacterPose( model );
		for ( let frame = 0; frame < 300; frame++ ) {
			if ( frame === 120 ) {
				const clip = createClip( random, "admitted", model.nodes.length, false );
				assert.equal( flat.admitClip( clip ), object.admitClip( clip ) );
			}
			const input = drive( random, model, frame );
			assert.equal( apply( flat, input ), apply( object, input ), `seed ${seed} frame ${frame} changed` );
			compare( flat, object, model, `seed ${seed} frame ${frame}` );
		}
		flat.release();
	}
});

/*
================
phases

Poses of several models evaluated while the skeletons collect, forked, then
read: every pose against its object twin, frame after frame.
================
*/
function phases( workers, frames ) {
	const skeletons = createSkeletons( workers ), random = createRandom( 0xfa5e );
	const models = [ 9, 17, 30 ].map( nodes => createModel( random, nodes ) );
	const count = INITIAL_SKELETONS + 44;
	const pairs = Array.from( { length: count }, ( _, i ) => {
		const model = models[i % models.length];
		return { model, flat: createCharacterPose( model, skeletons.pose ), object: createCharacterPose( model ) };
	} );
	for ( let frame = 0; frame < frames; frame++ ) {
		skeletons.collect();
		for ( const pair of pairs ) {
			const input = drive( random, pair.model, frame );
			assert.equal( apply( pair.flat, input ), apply( pair.object, input ) );
		}
		skeletons.fork();
		for ( const [index, pair] of pairs.entries() ) {
			compare( pair.flat, pair.object, pair.model, `frame ${frame} pose ${index}` );
		}
	}
	return { skeletons, count, models };
}

test("poses materialized in phases, on worker threads over growing tables, match their objects", async () => {
	const threads = await createThreadedWorkers( 4 );
	try {
		const { count, models } = phases( threads, 20 );
		const floats = count * Math.max( ...models.map( model => model.nodes.length ) ) * 60;
		assert.ok( count > INITIAL_SKELETONS && floats > INITIAL_SKELETON_STATE_FLOATS / 32, "the records grow" );
		assert.ok( threads.phases() >= 20 );
	} finally {
		await threads.close();
	}
});

test("a skeleton chunk run twice, as after a stalled worker, leaves the same matrices", () => {
	const workers = createInlineWorkers( 2, true );
	phases( workers, 8 );
	assert.ok( workers.phases() >= 8 );
});

test("a body volume changed after its pose was queued is not read from the phase's palettes", () => {
	const workers = createInlineWorkers( 1, true ), skeletons = createSkeletons( workers );
	const random = createRandom( 0xb0d1 ), model = createModel( random, 20 );
	const flat = createCharacterPose( model, skeletons.pose ), object = createCharacterPose( model );
	for ( let frame = 0; frame < 40; frame++ ) {
		const input = drive( random, model, frame );
		const volume = /** @type {[ number, boolean ]} */ ([ frame % 5, frame % 2 === 0 ]);
		skeletons.collect();
		assert.equal( apply( flat, input ), apply( object, input ) );
		// The phase's palettes take the thickness the inputs were queued with.
		flat.bodyVolume( ...volume );
		object.bodyVolume( ...volume );
		skeletons.fork();
		compare( flat, object, model, `frame ${frame}` );
	}
	flat.release();
});

test("plain memory keeps the poses' own arrays", () => {
	assert.equal( sharedSkeletons( createInlineWorkers() ), undefined );
	assert.ok( sharedSkeletons( createInlineWorkers( 1, true ) ) );
	assert.equal( sharedSkeletons( undefined ), undefined );
});
