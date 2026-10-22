/*
===========================================================================

batched-effects.test.mjs - a program's skill effects share one model

presentation-auxiliary.ts presentStages gives every skill effect instance
a model of its own, so each batches alone; Experimental "Batched effects"
(port-only) gives the instances of one program one model, so a crowd's
casts draw as one batch. A batch's rows must present what the instances'
own batches did: these tests check the model each setting assembles, and
drive two shipped character owners through effects that start and end,
one with a model an instance and one with a model a program, comparing
every row the GPU draws (its actor row and live records), with and
without the frame workers. Only the rows' order differs, which is the
blend order the option's comment states.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRandom } from "../helpers/walk-scenario.mjs";
import { createInlineWorkers } from "../helpers/frame-kernel-threads.mjs";
import { particleGraphCase } from "../helpers/particle-graph-cases.mjs";

const { createCharacters } = await import( "../../src/engine/runtime/renderer/characters/characters.ts" );
const { createAuxiliaryPresentation } = await import(
	"../../src/engine/runtime/characters/presentation-auxiliary.ts"
);
const { PARTICLE_ACTOR, PARTICLE_RECORD, RECORD_FLAGS } = await import(
	"../../src/engine/foundation/animation/particle-records.ts"
);

const identity = () => Float32Array.of( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 );
const PROGRAMS = [ "fire", "ice" ];
const FRAMES = 80;

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

Geometry commands that keep each pass's drawn rows: per presented stream,
every row with a live record, as its program's emitter, its actor row and
its live records (a record the GPU skips, flags 0, may keep old bytes).
================
*/
function recorder() {
	let rows = [], streams = 0;
	return {
		next() {
			const done = { rows: rows.sort(), streams };
			rows = [];
			streams = 0;
			return done;
		},
		gpu: /** @type {any} */ ({
			upload: () => ({}),
			release() {},
			updateInstances: d => d,
			updateBones() {},
			presentParticles( _draw, particles ) {
				streams++;
				for ( let r = 0; r < particles.rows; r++ ) {
					const live = [];
					for ( let b = 0; b < particles.slots; b++ ) {
						const at = (r * particles.slots + b) * PARTICLE_RECORD;
						if ( particles.records[at + RECORD_FLAGS] === 0 ) continue;
						live.push( b, ...particles.records.slice( at, at + PARTICLE_RECORD ) );
					}
					if ( !live.length ) continue;
					rows.push( JSON.stringify( [
						particles.primitive.particleEmitter,
						Array.from( particles.actors.slice( r * PARTICLE_ACTOR, (r + 1) * PARTICLE_ACTOR ) ),
						live
					] ) );
				}
			}
		})
	};
}

// Each cast's frames [start, end), the programs alternating. Each program
// reaches four casts (a batch of capacity four), loses one (a row past the
// active rows keeps a retired cast's records), and gains one whose newer
// gid sorts first, so every row changes owner, two of them between casts
// begun together (the same tick); then it drains through capacities two
// and one.
const CASTS = [
	[ 0, 70 ],
	[ 2, 62 ],
	[ 4, 30 ],
	[ 6, 32 ],
	[ 8, 72 ],
	[ 10, 73 ],
	[ 8, 74 ],
	[ 10, 75 ],
	[ 40, 76 ],
	[ 42, 79 ]
];

/*
================
effectActors

Frame's effect actors: the casts alive in it, each at its own place and
heading.
================
*/
function effectActors( frame, time ) {
	const actors = [];
	for ( const [i, [start, end]] of CASTS.entries() ) {
		if ( frame < start || frame >= end ) continue;
		actors.push( {
			gid: -(i + 1),
			program: PROGRAMS[i % 2],
			pose: { regionId: 257, x: i * 7 - 20, y: 0, z: (i % 3) * 5, yaw: i * .7 },
			clip: "effect",
			time: time - start * .033,
			loop: true,
			scale: 1
		} );
	}
	return actors;
}

/*
================
drive

The same frames through two owners: one assembles a model an instance
and one a model a program, as presentStages does with the option off and
on. Returns the streams each presented.
================
*/
function drive( seed, workers ) {
	const random = createRandom( 0xbe0 + seed );
	const graphs = Object.fromEntries( PROGRAMS.map( name => [ name, particleGraphCase( random ) ] ) );
	const owners = [ createCharacters( undefined, workers?.() ), createCharacters( undefined, workers?.() ) ];
	const records = [ recorder(), recorder() ];
	const names = [ actor => `effect:${actor.gid}:${actor.program}`, actor => `effect:${actor.program}` ];
	const streams = [ 0, 0 ];
	let compared = 0;
	for ( const owner of owners ) {
		for ( const name of PROGRAMS ) owner.model( name, effectModel( graphs[name] ), [] );
	}
	try {
		let time = 0;
		for ( let frame = 0; frame < FRAMES; frame++ ) {
			time += [ .016, .033, .05 ][frame % 3];
			const passes = owners.map( ( owner, index ) => {
				const actors = effectActors( frame, time ).map( ( { program, ...actor } ) => {
					const model = names[index]( { ...actor, program } );
					owner.assembly( model, program, [] );
					return { ...actor, model };
				} );
				owner.actors( /** @type {any} */ (actors) );
				owner.prepare( records[index].gpu, /** @type {any} */ ({}), 257, undefined, false, time );
				return records[index].next();
			} );
			const [own, shared] = passes;
			assert.deepEqual( shared.rows, own.rows, `seed ${seed} frame ${frame}` );
			compared += own.rows.length;
			streams[0] += own.streams;
			streams[1] += shared.streams;
		}
	} finally {
		for ( const [index, owner] of owners.entries() ) owner.dispose( records[index].gpu, null );
	}
	// Most frames draw rows of several instances at once.
	assert.ok( compared > FRAMES * 4, `seed ${seed}: ${compared} rows compared` );
	return streams;
}

test("presentStages assembles a model an instance, or a model a program with Batched effects", () => {
	for ( const batched of [ false, true ] ) {
		const auxiliary = createAuxiliaryPresentation( () => 0 );
		const assembled = [], next = new Map();
		const effect = ( gid, model ) => /** @type {any} */ ({
			gid,
			model,
			clip: "effect",
			time: 0,
			pose: { regionId: 257, x: 0, y: 0, z: 0 }
		});
		auxiliary.presentStages(
			{
				orbActors: [],
				effectActors: [ effect( -1, "fx" ), effect( -2, "fx" ), effect( -3, "fy" ) ],
				next,
				seconds: 0,
				animationHolders: [],
				player: undefined
			},
			{
				renderer: {
					setCharacterAssembly: ( id, base, parts ) => assembled.push( [ id, base, parts.length ] ),
					batchedEffects: () => batched
				},
				resources: { duration: () => 1 },
				effects: { animationModel: () => undefined, takeBudget: () => ({ actors: 3, gaveWay: 0 }) },
				probe: undefined
			}
		);
		const expected = batched ?
			[ [ "effect:fx", "fx", 0 ], [ "effect:fx", "fx", 0 ], [ "effect:fy", "fy", 0 ] ] :
			[ [ "effect:-1:fx", "fx", 0 ], [ "effect:-2:fx", "fx", 0 ], [ "effect:-3:fy", "fy", 0 ] ];
		assert.deepEqual( assembled, expected );
		assert.deepEqual( [ ...next.values() ].map( actor => actor.model ), expected.map( row => row[0] ) );
	}
});

test("a program's shared model presents every instance's rows, in fewer streams", () => {
	let own = 0, shared = 0;
	for ( let seed = 1; seed <= 4; seed++ ) {
		const [a, b] = drive( seed );
		own += a;
		shared += b;
	}
	assert.ok( shared < own / 2, `streams: ${shared} shared, ${own} a model an instance` );
});

test("with the frame workers, a shared model presents every instance's rows too", () => {
	const [own, shared] = drive( 5, () => createInlineWorkers() );
	assert.ok( shared < own / 2, `streams: ${shared} shared, ${own} a model an instance` );
});
