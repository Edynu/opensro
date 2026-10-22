/*
===========================================================================

cloth-kernel.test.mjs - the cloth wearers' kernel against the object cloth

With Worker threads on, cloth steps in one frame-worker phase for every
wearer (foundation/animation/cloth-wearers.ts, foundation/kernels/
cloth-kernel.ts), each wearer drawing from its own CRT stream. Given the
same draws, the kernel must be the object code (cloth-vertices.ts) bit for
bit: these tests give each object cloth the wearer's stream and compare
every packed vertex of every frame, through option changes, stalls, wind,
shared programs and released and reused state; a world mesh's wearer
holding exactly when its object cloth holds, beside the characters' bank
on the same memory; then the same wearers on real worker threads over
growing shared tables and a replaced output table, and every chunk run
twice as a stalled worker's chunk is.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { clothVertexCase } from "../helpers/cloth-vertex-cases.mjs";
import { createInlineWorkers, createThreadedWorkers } from "../helpers/frame-kernel-threads.mjs";

const { createClothVertices } = await import( "../../src/engine/foundation/animation/cloth-vertices.ts" );
const { crtRandomRange } = await import( "../../src/engine/foundation/math/crt-random.ts" );
const { CHARACTER_CLOTH, WORLD_CLOTH, clothSeed, createClothWearers } = await import(
	"../../src/engine/foundation/animation/cloth-wearers.ts"
);
const { INITIAL_CLOTH_VERTEX_FLOATS, INITIAL_CLOTH_WEARERS, MAX_CLOTH_WEARERS, growTable } = await import(
	"../../src/engine/foundation/kernels/frame-kernels.ts"
);

// The fixture's palette: 128 floats, 8 joints.
const JOINTS = 8;
const SHAPES = [ [ true, true ], [ true, false ], [ false, true ], [ false, false ] ];

/*
================
crtStream

The presentation stream's cloth draw (random.range( 0, 32768 )) from seed.
================
*/
function crtStream( seed ) {
	let state = seed >>> 0;
	return () => {
		const next = crtRandomRange( state, 0, 32768 );
		state = next.state;
		return next.value;
	};
}

/*
================
primitiveOf

A fixture's cloth primitive as the renderer holds it: its palette joints.
================
*/
function primitiveOf( fixture ) {
	return { ...fixture.primitive, joints: Array.from( { length: JOINTS }, ( _, i ) => i ) };
}

/*
================
sameFloats
================
*/
function sameFloats( actual, expected, label ) {
	assert.equal( actual.length, expected.length, label );
	const a = new Uint32Array( Float32Array.from( actual ).buffer ),
		b = new Uint32Array( Float32Array.from( expected ).buffer );
	for ( let i = 0; i < a.length; i++ ) {
		if ( a[i] !== b[i] ) assert.fail( `${label} float ${i}: ${actual[i]} != ${expected[i]}` );
	}
}

test("the cloth kernel draws every packed vertex bit as the object cloth for the same draws", () => {
	for ( const [skinned, normals] of SHAPES ) {
		const fixture = clothVertexCase( skinned, normals ), primitive = primitiveOf( fixture );
		const wearers = createClothWearers( createInlineWorkers() );
		const seeds = [ 1, 0x2468ace, clothSeed( 0xdeadbeef, 3 ) ];
		// Three wearers of one program, each beside the object cloth it ports.
		const pairs = seeds.map( seed => ({
			slot: wearers.admit( primitive, seed ),
			cloth: createClothVertices( primitive, crtStream( seed ) )
		}) );
		for ( let frame = 0; frame < fixture.frames; frame++ ) {
			const input = fixture.input( frame );
			if ( frame === 60 ) {
				// A released wearer's state is reused by the next one, which
				// starts as a new object cloth does.
				wearers.release( pairs[1].slot );
				pairs[1] = {
					slot: wearers.admit( primitive, 77 ),
					cloth: createClothVertices( primitive, crtStream( 77 ) )
				};
			}
			for ( const pair of pairs ) {
				wearers.request( pair.slot, input.palette, input.seconds, input.enabled, input.motion );
			}
			wearers.run();
			for ( const [index, pair] of pairs.entries() ) {
				sameFloats(
					wearers.vertices( pair.slot ),
					pair.cloth.update( input.palette, input.seconds, input.enabled, input.motion ),
					`skinned=${skinned} normals=${normals} frame ${frame} wearer ${index}`
				);
			}
		}
	}
});

test("a world cloth wearer holds when its object cloth holds, apart from the characters' bank", () => {
	for ( const [skinned, normals] of SHAPES ) {
		const fixture = clothVertexCase( skinned, normals ), primitive = primitiveOf( fixture );
		const workers = createInlineWorkers();
		const world = createClothWearers( workers, WORLD_CLOTH ),
			characters = createClothWearers( workers, CHARACTER_CLOTH );
		const seed = clothSeed( 9, 0 ), slot = world.admit( primitive, seed );
		const cloth = createClothVertices( primitive, crtStream( seed ) );
		let other = characters.admit( primitive, 3 ), palette = null, held = 0, ran = 0;
		for ( let frame = 0; frame < fixture.frames; frame++ ) {
			const input = fixture.input( frame );
			// A world mesh's palette changes only with its animation, which
			// always updates; otherwise both are asked whether they hold.
			const changed = frame % 40 === 0;
			if ( changed ) palette = input.palette;
			const hold = !changed && cloth.hold( input.seconds, input.enabled );
			if ( !changed ) assert.equal( world.hold( slot, input.seconds, input.enabled ), hold, `frame ${frame}` );
			if ( hold ) {
				held++;
				continue;
			}
			ran++;
			world.request( slot, /** @type {Float32Array} */ (palette), input.seconds, input.enabled, input.motion );
			world.run();
			// The characters' bank resets and reuses its tables: the world's stay.
			if ( frame === 90 ) {
				characters.reset();
				other = characters.admit( primitive, 4 );
			}
			characters.request( other, input.palette, input.seconds, input.enabled, input.motion );
			characters.run();
			sameFloats(
				world.vertices( slot ),
				cloth.update( /** @type {Float32Array} */ (palette), input.seconds, input.enabled, input.motion ),
				`skinned=${skinned} normals=${normals} frame ${frame}`
			);
		}
		assert.ok( held > 10 && ran > 10, `held ${held} ran ${ran}` );
	}
});

test("a cloth chunk run twice, as after a stalled worker, leaves the same bits", () => {
	const fixture = clothVertexCase( true, true ), primitive = primitiveOf( fixture );
	const once = createClothWearers( createInlineWorkers() ), twice = createClothWearers( createInlineWorkers( 2 ) );
	const slots = [ 5, 6, 7 ].map( seed => [ once.admit( primitive, seed ), twice.admit( primitive, seed ) ] );
	for ( let frame = 0; frame < fixture.frames; frame++ ) {
		const input = fixture.input( frame );
		for ( const [a, b] of slots ) {
			once.request( a, input.palette, input.seconds, input.enabled, input.motion );
			twice.request( b, input.palette, input.seconds, input.enabled, input.motion );
		}
		once.run();
		twice.run();
		for ( const [a, b] of slots ) sameFloats( twice.vertices( b ), once.vertices( a ), `frame ${frame}` );
	}
});

test("cloth wearers on worker threads over growing and replaced tables draw as one thread does", async () => {
	const fixture = clothVertexCase( true, true ), primitive = primitiveOf( fixture );
	const count = MAX_CLOTH_WEARERS, waves = 4, frames = 40, n = fixture.primitive.geometry.positions.length / 3;
	const threads = await createThreadedWorkers( 4 );
	try {
		const inline = createClothWearers( createInlineWorkers() ), threaded = createClothWearers( threads );
		const memory = threads.memory(), slots = [];
		assert.ok( count > INITIAL_CLOTH_WEARERS, "the records grow in place" );
		assert.ok( count * 14 * n > INITIAL_CLOTH_VERTEX_FLOATS, "the wearers outgrow the vertex table" );
		for ( let frame = 0; frame < frames; frame++ ) {
			// Wearers arrive in waves while the threads serve, and the output
			// table is replaced besides every few frames: the threads must take
			// each replacement before they write it.
			if ( frame % (frames / waves) === 0 ) {
				for ( let i = slots.length, end = i + count / waves; i < end; i++ ) {
					slots.push( [
						inline.admit( primitive, clothSeed( i, 0 ) ),
						threaded.admit( primitive, clothSeed( i, 0 ) )
					] );
				}
			} else if ( frame % 3 === 0 ) growTable( memory, "clothVertices", memory.clothVertices.byteLength + 4096 );
			const input = fixture.input( frame );
			for ( const [a, b] of slots ) {
				inline.request( a, input.palette, input.seconds, input.enabled, input.motion );
				threaded.request( b, input.palette, input.seconds, input.enabled, input.motion );
			}
			inline.run();
			threaded.run();
			for ( const [index, [a, b]] of slots.entries() ) {
				sameFloats( threaded.vertices( b ), inline.vertices( a ), `frame ${frame} wearer ${index}` );
			}
		}
		assert.equal( slots.length, count );
		assert.equal( threads.phases(), frames );
		assert.ok( threads.replacements() > 8, `replaced ${threads.replacements()} times` );
		const vertices = /** @type {SharedArrayBuffer} */ (memory.clothVertices);
		assert.equal( vertices.growable, false, "the output table stays fixed-size" );
	} finally {
		await threads.close();
	}
});

test("a wearer steps once a phase, and its seed is its own", () => {
	const fixture = clothVertexCase( true, true ), primitive = primitiveOf( fixture );
	const wearers = createClothWearers( createInlineWorkers() ), slot = wearers.admit( primitive, 1 );
	const input = fixture.input( 0 );
	wearers.request( slot, input.palette, input.seconds, input.enabled, input.motion );
	assert.throws(
		() => wearers.request( slot, input.palette, input.seconds, input.enabled, input.motion ),
		/twice in one phase/
	);
	assert.notEqual( clothSeed( 100, 0 ), clothSeed( 101, 0 ) );
	assert.notEqual( clothSeed( 100, 0 ), clothSeed( 100, 1 ) );
	assert.equal( clothSeed( 100, 2 ), clothSeed( 100, 2 ) );
});
