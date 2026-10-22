/*
===========================================================================

clip-catalogs.test.mjs - a growing clip catalog's values against fresh builds

A body's clip catalog grows one clip at a time as lazy actions arrive. The
GPU clip set (gpu-animation-plan.ts) and the bounds envelope
(character-bounds.ts) of each new catalog are extended from the previous
catalog's (clip-catalogs.ts), and the source charge (character-budget.ts)
adds only the new clip's buffers. Each must equal a build from every clip:
these tests grow seeded catalogs past header reservations, with new
animated nodes, step and cubic channels, a degenerate rotation, a
non-finite clip and a replaced catalog, and compare every step.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRandom } from "../helpers/walk-scenario.mjs";

const { createGpuClipPlan, extendGpuClipPlan } = await import(
	"../../src/engine/foundation/animation/gpu-animation-plan.ts"
);
const { createClipCatalogCache } = await import( "../../src/engine/foundation/animation/clip-catalogs.ts" );
const { characterRadius, createCharacterBoundsCache } = await import(
	"../../src/engine/foundation/animation/character-bounds.ts"
);
const { characterBytes, characterClipBytes } = await import(
	"../../src/engine/foundation/animation/character-budget.ts"
);

const PATHS = [ "translation", "rotation", "scale" ];
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

Channels on random nodes below nodes, sharing one key clock as a bound
native clip does.
================
*/
function createClip( random, name, nodes ) {
	const keys = 2 + Math.floor( random() * 5 ), duration = .5 + random() * 2;
	const times = Float32Array.from( { length: keys }, ( _, i ) => duration * i / (keys - 1) );
	const channels = [];
	for ( let node = 0; node < nodes; node++ ) {
		if ( random() < .5 ) continue;
		for ( const path of PATHS ) {
			if ( random() < .5 ) continue;
			const interpolation = INTERPOLATIONS[Math.floor( random() * INTERPOLATIONS.length )];
			const width = path === "rotation" ? 4 : 3, copies = interpolation === "CUBICSPLINE" ? 3 : 1;
			const values = new Float32Array( keys * width * copies );
			for ( let key = 0; key < keys * copies; key++ ) {
				values.set(
					path === "rotation" ?
						quaternion( random ) :
						[ random() * 4 - 2, random() * 4 - 2, random() * 4 - 2 ],
					key * width
				);
			}
			channels.push( { node, path, interpolation, times, values } );
		}
	}
	if ( !channels.length ) {
		channels.push( {
			node: 0,
			path: "translation",
			interpolation: "LINEAR",
			times,
			values: new Float32Array( keys * 3 )
		} );
	}
	return { name, duration, channels };
}

/*
================
samePlan
================
*/
function samePlan( actual, expected, label ) {
	if ( expected === null ) {
		assert.equal( actual, null, label );
		return;
	}
	assert.ok( actual, label );
	assert.deepEqual( actual.data, expected.data, `${label} data` );
	assert.equal( actual.nodes, expected.nodes, `${label} nodes` );
	assert.equal( actual.count, expected.count, `${label} count` );
	assert.equal( actual.capacity, expected.capacity, `${label} capacity` );
	assert.deepEqual( [ ...actual.index ], [ ...expected.index ], `${label} index` );
	assert.deepEqual( [ ...actual.eligible ], [ ...expected.eligible ], `${label} eligible` );
}

/*
================
countingPlans

A clip plan cache that counts the catalogs it extended.
================
*/
function countingPlans() {
	const counts = { extended: 0 };
	const plans = createClipCatalogCache( createGpuClipPlan, ( previous, clips, from ) => {
		counts.extended++;
		return extendGpuClipPlan( previous, clips, from );
	} );
	return { plans, counts };
}

test("a clip set extended clip by clip equals the set built from every clip", () => {
	for ( const seed of [ 1, 2, 3 ] ) {
		const random = createRandom( 0xc1a9 + seed ), { plans, counts } = countingPlans();
		let clips = [], nodes = 6;
		for ( let step = 0; step < 70; step++ ) {
			// Now and then a clip animates nodes past every table so far.
			if ( step % 23 === 11 ) nodes += 3;
			clips = [ ...clips, createClip( random, `clip-${step}`, nodes ) ];
			const plan = plans( clips );
			samePlan( plan, createGpuClipPlan( clips ), `seed ${seed} step ${step}` );
			assert.equal( plans( clips ), plan, "a catalog's plan is kept" );
		}
		assert.equal( counts.extended, 69 );
	}
});

test("a degenerate rotation or a non-finite clip leaves the grown set to the CPU, as a build does", () => {
	const random = createRandom( 0xdead ), { plans } = countingPlans();
	let clips = [ createClip( random, "idle", 5 ), createClip( random, "walk", 5 ) ];
	assert.ok( plans( clips ) );
	const infinite = { ...createClip( random, "far", 5 ), duration: Infinity };
	assert.equal( plans( [ ...clips, infinite ] ), null );
	assert.equal( createGpuClipPlan( [ ...clips, infinite ] ), null );
	const degenerate = createClip( random, "flat", 5 );
	degenerate.channels.push( {
		node: 1,
		path: "rotation",
		interpolation: "LINEAR",
		times: Float32Array.of( 0, 1 ),
		values: new Float32Array( 8 )
	} );
	clips = [ ...clips, degenerate ];
	assert.equal( plans( clips ), null );
	clips = [ ...clips, createClip( random, "run", 5 ) ];
	samePlan( plans( clips ), createGpuClipPlan( clips ), "after a refused clip" );
	assert.equal( createGpuClipPlan( clips ), null );
});

test("a catalog whose prefix differs from the last one is built, not extended", () => {
	const random = createRandom( 0xbeef ), { plans, counts } = countingPlans();
	const [a, b, c] = [ "a", "b", "c" ].map( name => createClip( random, name, 7 ) );
	plans( [ a, b ] );
	const replaced = [ a, c, b ];
	samePlan( plans( replaced ), createGpuClipPlan( replaced ), "replaced" );
	assert.equal( counts.extended, 0 );
	samePlan( plans( [ a, c, b, a ] ), createGpuClipPlan( [ a, c, b, a ] ), "a clip twice" );
	assert.equal( counts.extended, 1 );
});

test("the bounds envelope of a growing catalog gives the uncached radius of every assembly", () => {
	const random = createRandom( 0xb0b0 ), cache = createCharacterBoundsCache();
	const nodes = Array.from( { length: 12 }, ( _, i ) => ({
		name: `bone-${i}`,
		parent: i ? Math.floor( random() * i ) : -1,
		translation: [ random(), random() * 2, random() ],
		rotation: quaternion( random ),
		scale: [ 1, .8 + random() * .4, 1 ]
	}) );
	const primitive = {
		joints: [ 0, 3, 7 ],
		inverseBind: Float32Array.from( { length: 48 }, ( _, i ) => i % 5 === 0 ? 1 : 0 ),
		geometry: { positions: Float32Array.from( { length: 30 }, () => random() * 2 - 1 ) }
	};
	const body = { nodes, primitives: [ primitive ], images: [], clips: [] };
	for ( let step = 0; step < 30; step++ ) {
		// A channel past the skeleton is ignored by both.
		const clip = createClip( random, `clip-${step}`, step === 17 ? 14 : 12 );
		body.clips = [ ...body.clips, clip ];
		const assembly = { ...body, nodes: [ ...nodes ], primitives: [ primitive ] };
		for ( const model of [ body, assembly ] ) {
			assert.ok( Object.is( characterRadius( model, cache ), characterRadius( model ) ), `step ${step}` );
		}
		// The catalog's envelope encloses every pose of each of its clips.
		const radius = characterRadius( body, cache );
		for ( const one of body.clips ) {
			assert.ok( radius >= characterRadius( { ...body, clips: [ one ] } ), `step ${step} ${one.name}` );
		}
	}
});

test("an admitted clone's charge adds to the source's as characterBytes counts it", () => {
	const random = createRandom( 0xb17e );
	let model = { nodes: [], primitives: [], images: [], clips: [ createClip( random, "idle", 4 ) ] };
	let bytes = characterBytes( model, [] );
	for ( let step = 0; step < 8; step++ ) {
		const clip = structuredClone( createClip( random, `clip-${step}`, 6 ) );
		model = { ...model, clips: [ ...model.clips, clip ] };
		bytes = characterClipBytes( bytes, clip );
		assert.equal( bytes, characterBytes( model, [] ) );
	}
	const huge = {
		name: "huge",
		duration: 1,
		channels: [ {
			node: 0,
			path: "translation",
			interpolation: "LINEAR",
			times: Float32Array.of( 0, 1 ),
			values: new Float32Array( 1 << 22 )
		} ]
	};
	assert.throws( () => characterClipBytes( bytes, huge ), /exceed budget/ );
	assert.throws( () => characterBytes( { ...model, clips: [ ...model.clips, huge ] }, [] ), /exceed budget/ );
});
