/*
===========================================================================

particle-kernel.test.mjs - particle graphs on flat memory against the objects

With Worker threads on, the world's particle graphs tick on the frame
workers (foundation/kernels/particle-kernel.ts, owner
renderer/characters/particle-graphs.ts). Given the same random table and
cursor, the flat graph must be the object graph (particle-graph.ts) bit
for bit: these tests drive both through seeded graphs that use every
feature (particle-graph-cases.mjs) and compare, after every frame, the
tick and cursor, every emitter's rows, births, parents and groups, every
element's numbers and matrices, and the GPU record of every live element
of a drawn emitter (particle-records.ts writeGraphRecord with the holder
link). Then many graphs on worker threads over growing tables, and every
chunk run twice as a stalled worker's chunk is.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRandom } from "../helpers/walk-scenario.mjs";
import { createInlineWorkers, createThreadedWorkers } from "../helpers/frame-kernel-threads.mjs";
import { particleFrames, particleGraphCase } from "../helpers/particle-graph-cases.mjs";

const { createParticleGraph, advanceParticleGraph } = await import(
	"../../src/engine/foundation/animation/particle-graph.ts"
);
const { particleRandomTable } = await import( "../../src/engine/foundation/animation/particle-program.ts" );
const { PARTICLE_RECORD, RECORD_FLAGS, writeGraphRecord } = await import(
	"../../src/engine/foundation/animation/particle-records.ts"
);
const { ROTATION_WORK } = await import( "../../src/engine/foundation/animation/particle-presentation.ts" );
const { HOLDER_FOLLOW } = await import( "../../src/engine/foundation/animation/particle-holder-link.ts" );
const { createParticleGraphs } = await import( "../../src/engine/runtime/renderer/characters/particle-graphs.ts" );
const { frameKernelViews, INITIAL_PARTICLE_GRAPHS, INITIAL_PARTICLE_STATE_WORDS } = await import(
	"../../src/engine/foundation/kernels/frame-kernels.ts"
);
const R = await import( "../../src/engine/foundation/kernels/particle-record.ts" );

const TABLE = particleRandomTable();

/*
================
sameBits
================
*/
function sameBits( actual, expected, label ) {
	if ( !Object.is( actual, expected ) ) assert.fail( `${label}: ${actual} != ${expected}` );
}

/*
================
sameFloats

Two float32 runs of the same length, bit for bit.
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

/*
================
flatReader

Reads one instance's current state from the shared tables.
================
*/
function flatReader( workers, graphs, slot ) {
	const views = frameKernelViews( workers.memory() );
	return () => {
		const g = views.particleGraphs, d = views.particleDefs, s = views.particleState, f = views.particleFrames;
		const record = slot * R.PARTICLE_GRAPH_RECORD, def = g[record + R.G_DEF];
		const current = g[record + R.G_CURRENT];
		const half = g[record + R.G_STATE] + current * d[def + R.GD_HALF_WORDS];
		const frames = g[record + R.G_FRAMES] + current * d[def + R.GD_HALF_FLOATS];
		const elementsAt = half + d[def + R.GD_ELEMENTS_AT];
		return {
			views,
			def,
			half,
			root: d[def + R.GD_ELEMENTS],
			emitter: n => d[def + R.GD_HEADER + n],
			element: e => elementsAt + e * R.ELEMENT_WORDS,
			matrices: e => frames + e * R.ELEMENT_FLOATS,
			records: () => g[record + R.G_FRAMES] + 2 * d[def + R.GD_HALF_FLOATS],
			s,
			f,
			d
		};
	};
}

/*
================
indexOf

The flat index of every object element: its emitter's base plus its
slot, the root last.
================
*/
function indexOf( state, flat ) {
	const index = new Map( [ [ state.root, flat.root ] ] );
	state.elements.forEach( ( rows, n ) => {
		const base = flat.d[flat.emitter( n ) + R.D_BASE];
		rows.forEach( ( element, b ) => {
			if ( element ) index.set( element, base + b );
		} );
	} );
	return index;
}

/*
================
compareElement
================
*/
function compareElement( element, e, index, flat, label ) {
	const { s, f } = flat, at = flat.element( e ), m = flat.matrices( e );
	sameBits( s[at + R.E_PRESENT], 1, `${label} present` );
	sameBits( s[at + R.E_SERIAL], element.serial, `${label} serial` );
	sameBits( s[at + R.E_BORN], element.born, `${label} born` );
	sameBits( s[at + R.E_CLOCK_BIRTH], element.clockBirth, `${label} clock` );
	sameBits( s[at + R.E_AGE], element.age, `${label} age` );
	sameBits( s[at + R.E_ALIVE], element.alive ? 1 : 0, `${label} alive` );
	sameBits( s[at + R.E_CHILDREN], element.children, `${label} children` );
	sameBits( s[at + R.E_RELEASED], element.released ? 1 : 0, `${label} released` );
	sameBits( s[at + R.E_ROOT_LINK], element.rootLink, `${label} links` );
	// A released element may name a parent whose slot holds another element
	// since: the object keeps the old one, the flat graph its slot. Neither
	// is read again.
	const parent = index.get( element.parent );
	if ( parent !== undefined ) sameBits( s[at + R.E_PARENT], parent, `${label} parent` );
	else assert.ok( element.released, `${label} parent gone while the element is not released` );
	const owner = element.group ? index.get( element.group.parent ) : -1;
	if ( owner !== undefined ) sameBits( s[at + R.E_GROUP], owner, `${label} group` );
	else assert.ok( !element.alive, `${label} group owner gone while the element lives` );
	sameBits( s[at + R.E_FRAME], element.state.frame, `${label} frame` );
	assert.equal( element.state.angularVelocity, undefined );
	for ( let i = 0; i < 3; i++ ) {
		sameBits( s[at + R.E_PREVIOUS + i], element.previousPosition[i], `${label} previous ${i}` );
		sameBits( s[at + R.E_POSITION + i], element.state.position[i], `${label} position ${i}` );
		sameBits( s[at + R.E_VELOCITY + i], element.state.velocity[i], `${label} velocity ${i}` );
		sameBits( s[at + R.E_SCALE + i], element.state.scale[i], `${label} scale ${i}` );
		sameBits( s[at + R.E_ORIGIN + i], element.origin[i], `${label} origin ${i}` );
	}
	sameFloats( f.subarray( m + R.F_ROTATION, m + R.F_ROTATION + 16 ), element.state.rotation, `${label} rotation` );
	sameFloats( f.subarray( m + R.F_MATRIX, m + R.F_MATRIX + 16 ), element.matrix, `${label} matrix` );
	sameFloats( f.subarray( m + R.F_DELTA, m + R.F_DELTA + 16 ), element.delta, `${label} delta` );
	sameFloats( f.subarray( m + R.F_LOCAL, m + R.F_LOCAL + 16 ), element.local, `${label} local` );
	sameFloats( f.subarray( m + R.F_SHAPE, m + R.F_SHAPE + 16 ), element.shape, `${label} shape` );
	const previous = element.state.previous;
	sameBits( s[at + R.E_HAS_TICK], previous ? 1 : 0, `${label} ticked` );
	if ( !previous ) return;
	for ( let i = 0; i < 3; i++ ) {
		sameBits( s[at + R.E_TICK_POSITION + i], previous.position[i], `${label} tick position ${i}` );
		sameBits( s[at + R.E_TICK_SCALE + i], previous.scale[i], `${label} tick scale ${i}` );
	}
	sameFloats(
		f.subarray( m + R.F_TICK_ROTATION, m + R.F_TICK_ROTATION + 16 ),
		previous.rotation,
		`${label} tick rotation`
	);
	sameFloats( f.subarray( m + R.F_TICK_MATRIX, m + R.F_TICK_MATRIX + 16 ), previous.matrix, `${label} tick matrix` );
}

/*
================
compareGraph

The flat instance against the object state after a frame, records of
drawn emitters included (written with link, as the renderer does).
================
*/
function compareGraph( state, graph, drawn, flat, link, label ) {
	const { s, f, d } = flat;
	sameBits( s[flat.half + R.H_FRAME], state.frame, `${label} frame` );
	sameBits( s[flat.half + R.H_INDEX], state.index, `${label} cursor` );
	sameBits( s[flat.half + R.H_SERIAL], state.serial, `${label} serial` );
	const index = indexOf( state, flat );
	compareElement( state.root, flat.root, index, flat, `${label} root` );
	const work = new Float64Array( ROTATION_WORK );
	graph.forEach( ( def, n ) => {
		const emitter = flat.emitter( n ), half = flat.half + d[emitter + R.D_STATE], base = d[emitter + R.D_BASE];
		const rows = state.elements[n];
		sameBits( s[half + R.S_ROWS], rows.length, `${label} emitter ${n} rows` );
		if ( def.emission ) {
			const slots = d[emitter + R.D_SLOTS];
			for ( let b = 0; b < rows.length; b++ ) {
				sameBits( s[half + R.S_ARRAYS + b], state.births[n][b], `${label} emitter ${n} birth ${b}` );
				const parent = index.get( state.parents[n][b] );
				if ( parent !== undefined ) {
					sameBits( s[half + R.S_ARRAYS + slots + b], parent, `${label} emitter ${n} parent ${b}` );
				} else assert.ok( rows[b]?.released, `${label} emitter ${n} birth ${b} parent gone` );
			}
			const groups = [ ...state.groups[n].values() ];
			sameBits( s[half + R.S_GROUPS], groups.length, `${label} emitter ${n} groups` );
			const order = half + R.S_ARRAYS + 2 * slots, parentSlots = d[emitter + R.D_PARENT_SLOTS];
			groups.forEach( ( group, i ) => {
				const owner = index.get( group.parent );
				sameBits( s[order + i], owner, `${label} emitter ${n} group ${i}` );
				const slot = def.parent < 0 ? 0 : owner - d[flat.emitter( def.parent ) + R.D_BASE];
				sameBits( s[order + parentSlots + slot], group.total, `${label} emitter ${n} total ${i}` );
			} );
		}
		for ( let b = 0; b < rows.length; b++ ) {
			const element = rows[b];
			if ( !element ) sameBits( s[flat.element( base + b ) + R.E_PRESENT], 0, `${label} emitter ${n} hole ${b}` );
			else compareElement( element, base + b, index, flat, `${label} emitter ${n} element ${b}` );
		}
		if ( !drawn[n] ) return;
		const records = flat.records() + d[emitter + R.D_RECORDS], expected = new Float32Array( PARTICLE_RECORD );
		let live = 0;
		for ( let b = 0; b < rows.length; b++ ) {
			const at = records + b * PARTICLE_RECORD;
			if ( !rows[b]?.alive ) {
				sameBits( f[at + RECORD_FLAGS], 0, `${label} emitter ${n} hidden ${b}` );
				continue;
			}
			live++;
			writeGraphRecord( expected, 0, rows[b], work, link );
			sameFloats( f.subarray( at, at + PARTICLE_RECORD ), expected, `${label} emitter ${n} record ${b}` );
		}
		sameBits( s[half + R.S_LIVE], live, `${label} emitter ${n} live` );
	} );
}

/*
================
drive

One seeded graph through frames, flat (on workers) against the object.
Returns how many elements lived and records were compared.
================
*/
function drive( workers, graphs, seed, count ) {
	const random = createRandom( seed ), graph = particleGraphCase( random );
	const drawn = graph.map( () => random() < .7 ), cursor = Math.floor( random() * 5000 );
	const stop = random() < .3 ? .4 + random() : Infinity, keepRoots = random() < .3;
	const state = createParticleGraph( graph, cursor );
	const link = {
		root: state.root,
		follow: new Float32Array( HOLDER_FOLLOW ),
		turned: new Float32Array( 16 ),
		shift: [ 0, 0, 0 ]
	};
	const slot = graphs.admit( graph, drawn, cursor ), read = flatReader( workers, graphs, slot );
	let lived = 0;
	for ( const [frame, input] of particleFrames( random, count ).entries() ) {
		let failure = null;
		try {
			advanceParticleGraph(
				state,
				graph,
				input.time,
				input.transform,
				TABLE,
				stop,
				input.shiftX,
				input.shiftZ,
				keepRoots
			);
		} catch ( error ) {
			failure = error;
		}
		graphs.request( slot, input.time, input.transform, stop, input.shiftX, input.shiftZ, keepRoots );
		if ( failure ) {
			// The flat graph refuses the same frame the same way.
			assert.throws( () => graphs.run(), { message: /** @type {Error} */ (failure).message } );
			break;
		}
		graphs.run();
		compareGraph( state, graph, drawn, read(), link, `seed ${seed} frame ${frame}` );
		lived += state.elements.reduce( ( sum, rows ) => sum + rows.filter( e => e?.alive ).length, 0 );
	}
	graphs.release( slot );
	return lived;
}

test("a particle graph on flat memory ticks every element bit as the object graph", () => {
	const workers = createInlineWorkers(), graphs = createParticleGraphs( workers, TABLE );
	let lived = 0;
	for ( let seed = 1; seed <= 60; seed++ ) lived += drive( workers, graphs, 0x9a2c + seed, 90 );
	assert.ok( lived > 2000, `elements lived: ${lived}` );
});

test("graphs on worker threads over growing tables tick as one thread does", async () => {
	const threads = await createThreadedWorkers( 4 );
	try {
		const inline = createInlineWorkers(),
			one = createParticleGraphs( inline, TABLE ),
			many = createParticleGraphs( threads, TABLE );
		const random = createRandom( 0x7e11 ), count = INITIAL_PARTICLE_GRAPHS + 40;
		const pairs = Array.from( { length: count }, () => {
			const graph = particleGraphCase( random ), drawn = graph.map( () => random() < .7 );
			return {
				graph,
				a: /** @type {number} */ (one.admit( graph, drawn, 7 )),
				b: /** @type {number} */ (many.admit( graph, drawn, 7 ))
			};
		} );
		const frames = particleFrames( random, 30 );
		for ( const input of frames ) {
			for ( const pair of pairs ) {
				one.request( pair.a, input.time, input.transform, Infinity, input.shiftX, input.shiftZ, false );
				many.request( pair.b, input.time, input.transform, Infinity, input.shiftX, input.shiftZ, false );
			}
			one.run();
			many.run();
			for ( const pair of pairs ) {
				assert.equal( many.frame( pair.b ), one.frame( pair.a ) );
				assert.equal( many.index( pair.b ), one.index( pair.a ) );
				pair.graph.forEach( ( _, n ) => {
					const a = one.emitter( pair.a, n );
					const b = /** @type {NonNullable<typeof a>} */ (many.emitter( pair.b, n ));
					if ( !a ) return;
					assert.equal( b.rows, a.rows );
					assert.equal( b.live, a.live );
					for ( let slot = 0; slot < a.rows; slot++ ) {
						const at = slot * PARTICLE_RECORD;
						if ( a.records[at + RECORD_FLAGS] === 0 ) assert.equal( b.records[at + RECORD_FLAGS], 0 );
						else {sameFloats(
								b.records.subarray( at, at + PARTICLE_RECORD ),
								a.records.subarray( at, at + PARTICLE_RECORD ),
								"record"
							);}
					}
				} );
			}
		}
		const words = threads.memory().particleState.byteLength / 8;
		assert.ok( words > INITIAL_PARTICLE_STATE_WORDS, "the state grows" );
		// A frame with no tick due and no crossing opens no phase.
		assert.ok( threads.phases() > frames.length / 3 );
	} finally {
		await threads.close();
	}
});

test("a particle chunk run twice, as after a stalled worker, leaves the same bits", () => {
	const workers = createInlineWorkers( 2 ), graphs = createParticleGraphs( workers, TABLE );
	let lived = 0;
	for ( let seed = 1; seed <= 15; seed++ ) lived += drive( workers, graphs, 0x51a7 + seed, 60 );
	assert.ok( lived > 300 );
});

test("released instances and definitions are reused, and requests wait for a tick or a crossing", () => {
	const workers = createInlineWorkers(), graphs = createParticleGraphs( workers, TABLE );
	const random = createRandom( 3 ), graph = particleGraphCase( random ), drawn = graph.map( () => true );
	const first = /** @type {number} */ (graphs.admit( graph, drawn, 0 ));
	const transform = Float32Array.of( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 );
	assert.equal( graphs.request( first, .1, transform, Infinity, 0, 0, false ), true );
	graphs.run();
	assert.equal( graphs.frame( first ), 2 );
	assert.equal( graphs.request( first, .12, transform, Infinity, 0, 0, false ), false, "no tick falls due" );
	assert.equal( graphs.request( first, .12, transform, Infinity, 192, 0, false ), true, "a crossing runs" );
	assert.throws( () => graphs.request( first, .2, transform, Infinity, 0, 0, false ), /twice/ );
	graphs.run();
	// A released instance's regions and definition serve the next instance
	// of its graph: however many come and go, the tables do not grow.
	const memory = workers.memory(), state = memory.particleState.byteLength, defs = memory.particleDefs.byteLength;
	for ( let i = 0; i < 200; i++ ) {
		graphs.release( first );
		assert.equal( graphs.admit( graph, drawn, i ), first );
		assert.equal( graphs.index( first ), i );
	}
	assert.equal( memory.particleState.byteLength, state );
	assert.equal( memory.particleDefs.byteLength, defs );
});
