/*
===========================================================================

particle-graphs.ts - the world's particle graphs on the frame workers

Port-only, not native, used with Worker threads on: an actor's particle
graph (foundation/animation/particle-graph.ts) is an instance on the
frame workers' particle tables (foundation/kernels/particle-record.ts),
and a frame's due graphs tick together in one KERNEL_PARTICLES phase
(particle-kernel.ts) instead of one at a time in advanceParticles. A
graph draws from the shared random table at its own cursor, as the object
graph does; only where a new graph's cursor starts differs.

Owns the encoded definitions (one per graph and drawn emitters, written
once and freed with its last instance), the instances' records and their
state and frames regions. advanceParticles admits an instance with the
actor's history and requests each frame; prepare forks the phase, builds
its plan while the workers tick, then joins it. Afterwards the history
reads its frame, its root (for the holder follow) and its emitters'
records (for the particle streams). The renderer releases an instance
with its history.

===========================================================================
*/
import type { FrameKernelPhases } from "@/engine/contracts/frame-workers";
import type { FrameJobRunner } from "@/engine/foundation/workers/frame-jobs";
import { type ParticleEmitter, needsSibling, tickHorizon } from "@/engine/foundation/animation/particle-graph";
import type { ParticleProgram } from "@/engine/foundation/animation/particle-program";
import { PARTICLE_RECORD } from "@/engine/foundation/animation/particle-records";
import { holderFollow } from "@/engine/foundation/animation/particle-holder-link";
import {
	frameKernelViews,
	growTable,
	KERNEL_PARTICLES,
	type KernelTable,
	MAX_PARTICLE_DEF_WORDS,
	MAX_PARTICLE_FRAME_FLOATS,
	MAX_PARTICLE_GRAPHS,
	MAX_PARTICLE_REQUESTS,
	MAX_PARTICLE_STATE_WORDS,
	PARTICLE_CHUNK,
	refreshViews,
	REQUEST_COUNT,
	REQUEST_SLOTS,
	runFrameKernel
} from "@/engine/foundation/kernels/frame-kernels";
import {
	C_BAN_ROTATION,
	C_FLAGS,
	C_FRAMES,
	C_POSITIONS,
	C_PROGRAM,
	C_ROTATIONS,
	COMMAND_RECORD,
	D_BASE,
	D_BIRTHS,
	D_COMMANDS,
	D_DURATION,
	D_EMISSION,
	D_FOLLOW_DEPTH,
	D_FRAMES,
	D_KEEP_MATRIX,
	D_KEEP_ORIGIN,
	D_LIMIT,
	D_LOCAL_MOTION,
	D_LOOP,
	D_MATRIX,
	D_MATRIX_DEPTH,
	D_MOTION,
	D_PARENT,
	D_PARENT_SLOTS,
	D_PARENTS,
	D_PERIOD,
	D_POSITION_DEPTH,
	D_POSITIONS,
	D_PROGRAM,
	D_RATE,
	D_RECORDS,
	D_ROTATIONS,
	D_SCALES,
	D_SHAPE_MOTION,
	D_SIBLINGS,
	D_SLOTS,
	D_START,
	D_STATE,
	D_VELOCITY_DEPTH,
	E_ALIVE,
	E_GROUP,
	E_PARENT,
	E_POSITION,
	E_PRESENT,
	E_SCALE,
	ELEMENT_FLOATS,
	ELEMENT_WORDS,
	EMITTER_RECORD,
	F_DELTA,
	F_LOCAL,
	F_MATRIX,
	F_ROTATION,
	F_SHAPE,
	G_CURRENT,
	G_DEF,
	G_FRAMES,
	G_KEEP_ROOTS,
	G_SHIFT_X,
	G_SHIFT_Z,
	G_STATE,
	G_STOP,
	G_TIME,
	G_TRANSFORM,
	GD_ELEMENTS,
	GD_ELEMENTS_AT,
	GD_EMITTERS,
	GD_HALF_FLOATS,
	GD_HALF_WORDS,
	GD_HEADER,
	GD_HORIZON,
	GD_RECORD_FLOATS,
	GD_SCRATCH_WORDS,
	H_FRAME,
	H_HEADER,
	H_INDEX,
	PARTICLE_GRAPH_RECORD,
	PARTICLE_RANDOM_VALUES,
	PROGRAM_OP_CONE,
	PROGRAM_OP_CONE_FORCE,
	PROGRAM_OP_CONE_POS,
	PROGRAM_OP_OTHER,
	PROGRAM_OP_SCALE,
	PROGRAM_OP_SPHERE,
	PROGRAM_RECORD,
	Q_ATTRACTION,
	Q_ATTRACTION_FRAMES,
	Q_ATTRACTION_SET,
	Q_CONE,
	Q_CONE_FLAGS,
	Q_CONE_FORCE,
	Q_CONE_FORCE_FLAGS,
	Q_CONE_POS,
	Q_CONE_POS_FLAGS,
	Q_ORDER,
	Q_R_VELOCITY,
	Q_ROTATION_FRAMES,
	Q_SCALE,
	Q_SCALE_FRAMES,
	Q_SHAPE,
	Q_SPHERE,
	Q_SPHERE_FLAGS,
	Q_SPIN,
	Q_SPIN_FRAMES,
	Q_VECTORS,
	S_ARRAYS,
	S_GROUPS,
	S_LIVE,
	S_ROWS,
	V_FLAGS,
	V_FRAMES,
	V_NAME,
	V_VALUE,
	VECTOR_FORCE,
	VECTOR_RECORD,
	VECTOR_SET_POSITION,
	VECTOR_SET_VELOCITY
} from "@/engine/foundation/kernels/particle-record";

// A2E980: whole 50 ms effect ticks.
const TICKS_PER_SECOND = 20;
const IDENTITY = [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ] as const;
// A command without a program runs none of its ops.
const EMPTY_PROGRAM: ParticleProgram = {};

/*
================
Definition

An encoded graph in particleDefs and the instances using it.
================
*/
interface Definition {
	readonly graph: readonly ParticleEmitter[];
	readonly key: string;
	readonly offset: number;
	readonly words: number;
	// Per emitter: its D_* record offset.
	readonly emitters: readonly number[];
	readonly stateWords: number;
	readonly frameFloats: number;
	users: number;
}

/*
================
Instance
================
*/
interface Instance {
	readonly definition: Definition;
	readonly state: number;
	readonly frames: number;
}

/*
================
opCode

An initializeParticle op name as Q_ORDER lists it.
================
*/
function opCode( name: string ): number {
	return name === "SetSpherePos" ?
		PROGRAM_OP_SPHERE :
		name === "SetGraphRandomScale" ?
		PROGRAM_OP_SCALE :
		name === "SetConeVel" ?
		PROGRAM_OP_CONE :
		name === "ConeForce" ?
		PROGRAM_OP_CONE_FORCE :
		name === "SetConePos" ?
		PROGRAM_OP_CONE_POS :
		PROGRAM_OP_OTHER;
}

/*
================
emitterSlots

The element slots an emitter can fill: an emission's capacity (or its
expanded births), else its births.
================
*/
function emitterSlots( def: ParticleEmitter ): number {
	return def.emission ? def.capacity ?? def.births.length : def.births.length;
}

/*
================
encodeGraph

graph with its drawn emitters as particleDefs doubles, the offsets in it
absolute for a definition placed at base. Programs shared between emitters
or commands are encoded once.
================
*/
function encodeGraph( graph: readonly ParticleEmitter[], drawn: readonly boolean[], base: number ) {
	const out: number[] = [];
	const programs = new Map<ParticleProgram, number>();
	/*
	================
	alloc
	================
	*/
	const alloc = ( count: number ) => {
		const at = base + out.length;
		for ( let i = 0; i < count; i++ ) out.push( 0 );
		return at;
	};
	const set = ( at: number, value: number ) => {
		out[at - base] = value;
	};
	/*
	================
	list
	================
	*/
	const list = ( values: readonly number[] ) => {
		const at = alloc( 1 + values.length );
		set( at, values.length );
		values.forEach( ( value, i ) => set( at + 1 + i, value ) );
		return at;
	};
	/*
	================
	rows

	A list of rows of width doubles each: [count, rows...].
	================
	*/
	const rows = ( values: readonly (readonly number[])[], width: number ) => {
		const at = alloc( 1 + values.length * width );
		set( at, values.length );
		values.forEach( ( row, r ) => {
			for ( let i = 0; i < width; i++ ) set( at + 1 + r * width + i, row[i]! );
		} );
		return at;
	};
	/*
	================
	numbers
	================
	*/
	const numbers = ( values: readonly number[] | undefined ) => {
		if ( !values ) return -1;
		const at = alloc( values.length );
		values.forEach( ( value, i ) => set( at + i, value ) );
		return at;
	};
	/*
	================
	program
	================
	*/
	const program = ( value: ParticleProgram | undefined ): number => {
		if ( !value ) return -1;
		const known = programs.get( value );
		if ( known !== undefined ) return known;
		const at = alloc( PROGRAM_RECORD );
		programs.set( value, at );
		set( at + Q_ORDER, value.order ? list( value.order.map( opCode ) ) : -1 );
		set( at + Q_SPHERE, numbers( value.sphere ) );
		set( at + Q_SPHERE_FLAGS, value.sphereFlags ?? -1 );
		set( at + Q_CONE, numbers( value.cone ) );
		set( at + Q_CONE_FLAGS, value.coneFlags ?? -1 );
		set( at + Q_CONE_FORCE, numbers( value.coneForce ) );
		set( at + Q_CONE_FORCE_FLAGS, value.coneForceFlags ?? -1 );
		set( at + Q_CONE_POS, numbers( value.conePos ) );
		set( at + Q_CONE_POS_FLAGS, value.conePosFlags ?? -1 );
		set( at + Q_R_VELOCITY, numbers( value.rVelocity ) );
		set( at + Q_ROTATION_FRAMES, value.rotationFrames ? list( value.rotationFrames ) : -1 );
		set( at + Q_SPIN, numbers( value.spin ) );
		set( at + Q_SPIN_FRAMES, value.spinFrames ? list( value.spinFrames ) : -1 );
		set( at + Q_SHAPE, numbers( value.shape ) );
		set( at + Q_ATTRACTION_SET, value.attraction !== undefined ? 1 : 0 );
		set( at + Q_ATTRACTION, value.attraction ?? 0 );
		set( at + Q_ATTRACTION_FRAMES, value.attractionFrames ? list( value.attractionFrames ) : -1 );
		set(
			at + Q_SCALE,
			value.scale ? rows( value.scale.map( point => [ point.time, ...point.value ] ), 4 ) : -1
		);
		set( at + Q_SCALE_FRAMES, value.scaleFrames ? list( value.scaleFrames ) : -1 );
		if ( value.vectors ) {
			const vectors = alloc( 1 + value.vectors.length * VECTOR_RECORD );
			set( vectors, value.vectors.length );
			value.vectors.forEach( ( op, i ) => {
				const record = vectors + 1 + i * VECTOR_RECORD;
				set(
					record + V_NAME,
					op.name === "SetPosition" ?
						VECTOR_SET_POSITION :
						op.name === "Force" ?
						VECTOR_FORCE :
						VECTOR_SET_VELOCITY
				);
				set( record + V_FLAGS, op.flags );
				for ( let k = 0; k < 3; k++ ) set( record + V_VALUE + k, op.value[k]! );
				set( record + V_FRAMES, list( op.frames ) );
			} );
			set( at + Q_VECTORS, vectors );
		} else set( at + Q_VECTORS, -1 );
		return at;
	};
	const header = alloc( GD_HEADER + graph.length );
	const slots = graph.map( emitterSlots );
	const emitters = graph.map( () => alloc( EMITTER_RECORD ) );
	let elements = 0, stateAt = H_HEADER, records = 0;
	graph.forEach( ( def, n ) => {
		const at = emitters[n]!, parentSlots = def.parent < 0 ? 1 : slots[def.parent]!;
		set( header + GD_HEADER + n, at );
		set( at + D_PARENT, def.parent );
		set( at + D_FRAMES, def.frames );
		set( at + D_SLOTS, slots[n]! );
		set( at + D_BASE, elements );
		set( at + D_LOOP, def.loop ? 1 : 0 );
		set( at + D_EMISSION, def.emission ? 1 : 0 );
		set( at + D_START, def.emission?.start ?? 0 );
		set( at + D_DURATION, def.emission?.duration ?? 0 );
		set( at + D_PERIOD, def.emission?.period ?? 0 );
		set( at + D_LIMIT, def.emission?.limit ?? 0 );
		set( at + D_RATE, def.emission?.rate ?? 0 );
		// The update program advanceParticle runs: without commands, the
		// emitter's own (its spin and attraction are run elsewhere).
		const own = program( def.program );
		set( at + D_PROGRAM, own );
		set( at + D_MOTION, def.commands ? -1 : own );
		if ( def.commands ) {
			const commands = alloc( 1 + def.commands.length * COMMAND_RECORD );
			set( commands, def.commands.length );
			def.commands.forEach( ( command, c ) => {
				const record = commands + 1 + c * COMMAND_RECORD;
				set( record + C_FLAGS, command.flags ?? 0 );
				set( record + C_BAN_ROTATION, command.name === "SetBANRot" ? 1 : 0 );
				set( record + C_FRAMES, list( command.frames ) );
				set( record + C_PROGRAM, program( command.program ?? EMPTY_PROGRAM ) );
				set( record + C_ROTATIONS, command.rotations ? rows( command.rotations, 16 ) : -1 );
				set( record + C_POSITIONS, command.positions ? rows( command.positions, 3 ) : -1 );
			} );
			set( at + D_COMMANDS, commands );
		} else set( at + D_COMMANDS, -1 );
		set( at + D_MATRIX, numbers( def.matrix ) );
		set( at + D_LOCAL_MOTION, def.localMotion ? 1 : 0 );
		set( at + D_SHAPE_MOTION, def.shapeMotion ? 1 : 0 );
		set( at + D_KEEP_MATRIX, def.keepMatrix ? 1 : 0 );
		set( at + D_KEEP_ORIGIN, def.keepOrigin ? 1 : 0 );
		set( at + D_POSITION_DEPTH, def.positionDepth );
		set( at + D_MATRIX_DEPTH, def.matrixDepth );
		set( at + D_VELOCITY_DEPTH, def.velocityDepth );
		set( at + D_FOLLOW_DEPTH, def.followDepth );
		set( at + D_SCALES, rows( def.scales, 3 ) );
		set( at + D_POSITIONS, rows( def.positions, 3 ) );
		set( at + D_ROTATIONS, rows( def.rotations, 16 ) );
		set( at + D_BIRTHS, list( def.births ) );
		set( at + D_PARENTS, list( def.parents ) );
		set( at + D_SIBLINGS, needsSibling( def ) ? 1 : 0 );
		set( at + D_STATE, stateAt );
		set( at + D_PARENT_SLOTS, parentSlots );
		set( at + D_RECORDS, drawn[n] ? records : -1 );
		stateAt += S_ARRAYS + (def.emission ? 2 * slots[n]! + 2 * parentSlots : 0);
		elements += slots[n]!;
		if ( drawn[n] ) records += slots[n]! * PARTICLE_RECORD;
	} );
	set( header + GD_EMITTERS, graph.length );
	set( header + GD_HORIZON, tickHorizon( graph ) );
	set( header + GD_ELEMENTS, elements );
	set( header + GD_ELEMENTS_AT, stateAt );
	set( header + GD_HALF_WORDS, stateAt + (elements + 1) * ELEMENT_WORDS );
	set( header + GD_HALF_FLOATS, (elements + 1) * ELEMENT_FLOATS );
	set( header + GD_SCRATCH_WORDS, elements + 2 * (elements + 1) );
	set( header + GD_RECORD_FLOATS, records );
	return { out, emitters };
}

/*
================
createParticleGraphs
================
*/
export function createParticleGraphs( workers: FrameKernelPhases, random: Float32Array ) {
	if ( random.length !== PARTICLE_RANDOM_VALUES ) throw Error( "Particle random table length" );
	const memory = workers.memory(), views = frameKernelViews( memory );
	views.particleRandom.set( random );
	const definitions = new Map<readonly ParticleEmitter[], Map<string, Definition>>();
	const instances: (Instance | undefined)[] = [], freeSlots: number[] = [];
	// Released regions by size: graphs of one effect repeat.
	const freeDefs = new Map<number, number[]>(),
		freeState = new Map<number, number[]>(),
		freeFrames = new Map<number, number[]>();
	const requested: number[] = [];
	// The root's tick frame and position, copied out for holderFollow.
	const rootMatrix = new Float32Array( 16 ), rootPosition = new Float64Array( 3 );
	// A graph requested twice in one phase would run on two threads at once.
	const slotPhase: number[] = [];
	let defsUsed = 0, stateUsed = 0, framesUsed = 0, slotCount = 0, phase = 1, started = false;
	/*
	================
	runLocal
	================
	*/
	const runLocal: FrameJobRunner = ( kernel, chunk ) => runFrameKernel( views, kernel, chunk );

	/*
	================
	reserve

	size more units at the end of a table, or a released region of that
	size: grown by doubling, at most to max. Undefined when it is full.
	================
	*/
	function reserve(
		table: KernelTable,
		free: Map<number, number[]>,
		used: number,
		size: number,
		max: number,
		unit: number
	): number | undefined {
		const reused = free.get( size )?.pop();
		if ( reused !== undefined ) return reused;
		if ( used + size > max ) return undefined;
		const length = memory[table].byteLength / unit;
		if ( used + size > length ) {
			let grown = length;
			while ( grown < used + size ) grown *= 2;
			growTable( memory, table, Math.min( max, grown ) * unit );
			refreshViews( views );
		}
		return used;
	}

	/*
	================
	release

	A region back to its size's free list.
	================
	*/
	function freeRegion( free: Map<number, number[]>, size: number, at: number ) {
		const list = free.get( size ) ?? [];
		list.push( at );
		free.set( size, list );
	}

	/*
	================
	definitionOf

	The encoded graph with these drawn emitters, written once.
	================
	*/
	function definitionOf( graph: readonly ParticleEmitter[], drawn: readonly boolean[] ): Definition | undefined {
		const key = drawn.map( d => d ? 1 : 0 ).join( "" );
		const known = definitions.get( graph )?.get( key );
		if ( known ) return known;
		const words = encodeGraph( graph, drawn, 0 ).out.length;
		const offset = reserve( "particleDefs", freeDefs, defsUsed, words, MAX_PARTICLE_DEF_WORDS, 8 );
		if ( offset === undefined ) return undefined;
		if ( offset === defsUsed ) defsUsed += words;
		const { out, emitters } = encodeGraph( graph, drawn, offset );
		views.particleDefs.set( out, offset );
		const d = views.particleDefs;
		const definition: Definition = {
			graph,
			key,
			offset,
			words,
			emitters,
			stateWords: 2 * d[offset + GD_HALF_WORDS]! + d[offset + GD_SCRATCH_WORDS]!,
			frameFloats: 2 * d[offset + GD_HALF_FLOATS]! + d[offset + GD_RECORD_FLOATS]!,
			users: 0
		};
		const byKey = definitions.get( graph ) ?? new Map<string, Definition>();
		byKey.set( key, definition );
		definitions.set( graph, byKey );
		return definition;
	}

	/*
	================
	dropDefinition

	A definition no instance uses any more is freed.
	================
	*/
	function dropDefinition( definition: Definition ) {
		if ( definition.users > 0 ) return;
		freeRegion( freeDefs, definition.words, definition.offset );
		const byKey = definitions.get( definition.graph )!;
		byKey.delete( definition.key );
		if ( !byKey.size ) definitions.delete( definition.graph );
	}

	/*
	================
	initialize

	particle-graph.ts createParticleGraph in half 0 of a zeroed instance:
	the root, every emitter empty, the root's groups opened.
	================
	*/
	function initialize( definition: Definition, state: number, frames: number, index: number ) {
		const d = views.particleDefs, s = views.particleState, f = views.particleFrames, at = definition.offset;
		s[state + H_FRAME] = -1;
		s[state + H_INDEX] = index;
		const elements = d[at + GD_ELEMENTS]!, root = state + d[at + GD_ELEMENTS_AT]! + elements * ELEMENT_WORDS;
		s[root + E_PARENT] = elements;
		s[root + E_ALIVE] = 1;
		s[root + E_PRESENT] = 1;
		s[root + E_GROUP] = -1;
		for ( let i = 0; i < 3; i++ ) s[root + E_SCALE + i] = 1;
		const rootFrames = frames + elements * ELEMENT_FLOATS;
		for ( const field of [ F_ROTATION, F_MATRIX, F_DELTA, F_LOCAL, F_SHAPE ] ) {
			f.set( IDENTITY, rootFrames + field );
		}
		for ( const emitter of definition.emitters ) {
			if ( d[emitter + D_PARENT]! >= 0 || d[emitter + D_EMISSION] !== 1 ) continue;
			const groups = state + d[emitter + D_STATE]! + S_ARRAYS + 2 * d[emitter + D_SLOTS]!;
			s[groups] = elements;
			s[state + d[emitter + D_STATE]! + S_GROUPS] = 1;
		}
	}

	/*
	================
	currentHalf

	An instance's current state half.
	================
	*/
	function currentHalf( slot: number ): number {
		const instance = instances[slot]!, record = slot * PARTICLE_GRAPH_RECORD;
		return instance.state + views.particleGraphs[record + G_CURRENT]! *
				views.particleDefs[instance.definition.offset + GD_HALF_WORDS]!;
	}

	/*
	================
	fork

	Open the KERNEL_PARTICLES phase over the graphs requested so far.
	Nothing may be admitted, requested or released until join.
	================
	*/
	function fork() {
		if ( started || !requested.length ) return;
		refreshViews( views );
		const list = views.particleRequests;
		list[REQUEST_COUNT] = requested.length;
		for ( let i = 0; i < requested.length; i++ ) list[REQUEST_SLOTS + i] = requested[i]!;
		workers.fork( KERNEL_PARTICLES, Math.ceil( requested.length / PARTICLE_CHUNK ) );
		started = true;
	}

	/*
	================
	join

	The phase's remaining graphs here, then each requested graph's halves
	switched.
	================
	*/
	function join() {
		if ( !started ) return;
		started = false;
		workers.join( runLocal );
		const g = views.particleGraphs;
		for ( const slot of requested ) {
			const record = slot * PARTICLE_GRAPH_RECORD;
			g[record + G_CURRENT] = 1 - g[record + G_CURRENT]!;
		}
		requested.length = 0;
		phase++;
	}

	return {
		/*
		================
		admit

		A new instance of graph, whose emitters with drawn true are drawn by a
		particle stream, its random cursor at index (createParticleGraph).
		Undefined when the tables cannot hold it: the caller keeps the
		object graph.
		================
		*/
		admit( graph: readonly ParticleEmitter[], drawn: readonly boolean[], index: number ): number | undefined {
			if ( started ) throw Error( "Particle graph admitted during its phase" );
			const definition = definitionOf( graph, drawn );
			if ( !definition ) return undefined;
			const slot = freeSlots.pop() ?? slotCount;
			if ( slot >= MAX_PARTICLE_GRAPHS ) {
				dropDefinition( definition );
				return undefined;
			}
			const state = reserve(
				"particleState",
				freeState,
				stateUsed,
				definition.stateWords,
				MAX_PARTICLE_STATE_WORDS,
				8
			);
			if ( state === undefined ) {
				if ( slot < slotCount ) freeSlots.push( slot );
				dropDefinition( definition );
				return undefined;
			}
			if ( state === stateUsed ) stateUsed += definition.stateWords;
			const frames = reserve(
				"particleFrames",
				freeFrames,
				framesUsed,
				definition.frameFloats,
				MAX_PARTICLE_FRAME_FLOATS,
				4
			);
			if ( frames === undefined ) {
				freeRegion( freeState, definition.stateWords, state );
				if ( slot < slotCount ) freeSlots.push( slot );
				dropDefinition( definition );
				return undefined;
			}
			if ( frames === framesUsed ) framesUsed += definition.frameFloats;
			if ( slot === slotCount ) {
				slotCount++;
				const bytes = slotCount * PARTICLE_GRAPH_RECORD * 8;
				if ( bytes > memory.particleGraphs.byteLength ) {
					growTable(
						memory,
						"particleGraphs",
						Math.min( MAX_PARTICLE_GRAPHS * PARTICLE_GRAPH_RECORD * 8, bytes * 2 )
					);
					refreshViews( views );
				}
			}
			definition.users++;
			instances[slot] = { definition, state, frames };
			slotPhase[slot] = 0;
			views.particleState.fill( 0, state, state + definition.stateWords );
			views.particleFrames.fill( 0, frames, frames + definition.frameFloats );
			const record = slot * PARTICLE_GRAPH_RECORD, g = views.particleGraphs;
			g.fill( 0, record, record + PARTICLE_GRAPH_RECORD );
			g[record + G_DEF] = definition.offset;
			g[record + G_STATE] = state;
			g[record + G_FRAMES] = frames;
			initialize( definition, state, frames, index );
			return slot;
		},
		/*
		================
		request

		The graph's frame, as advanceParticleGraph takes it. Queued only when
		a tick falls due or the region shifts; true when queued.
		================
		*/
		request(
			slot: number,
			time: number,
			transform: Float32Array,
			stop: number,
			shiftX: number,
			shiftZ: number,
			keepRoots: boolean
		): boolean {
			if ( started ) throw Error( "Particle graph requested during its phase" );
			if ( slotPhase[slot] === phase ) throw Error( "Particle graph requested twice in one phase" );
			const instance = instances[slot]!, d = views.particleDefs, s = views.particleState;
			const target = Math.min(
				Math.floor( time * TICKS_PER_SECOND + 1e-6 ),
				d[instance.definition.offset + GD_HORIZON]!
			);
			if ( target === s[currentHalf( slot ) + H_FRAME] && shiftX === 0 && shiftZ === 0 ) return false;
			if ( requested.length >= MAX_PARTICLE_REQUESTS ) throw Error( "Particle graph requests exceeded" );
			slotPhase[slot] = phase;
			const record = slot * PARTICLE_GRAPH_RECORD, g = views.particleGraphs;
			g[record + G_TIME] = time;
			for ( let i = 0; i < 16; i++ ) g[record + G_TRANSFORM + i] = transform[i]!;
			g[record + G_STOP] = stop;
			g[record + G_SHIFT_X] = shiftX;
			g[record + G_SHIFT_Z] = shiftZ;
			g[record + G_KEEP_ROOTS] = keepRoots ? 1 : 0;
			requested.push( slot );
			return true;
		},
		fork,
		join,
		/*
		================
		run

		fork then join.
		================
		*/
		run() {
			fork();
			join();
		},
		/*
		================
		frame

		The graph's tick (ParticleGraphState frame).
		================
		*/
		frame( slot: number ): number {
			return views.particleState[currentHalf( slot ) + H_FRAME]!;
		},
		/*
		================
		index

		The graph's random cursor.
		================
		*/
		index( slot: number ): number {
			return views.particleState[currentHalf( slot ) + H_INDEX]!;
		},
		/*
		================
		follow

		particle-holder-link.ts holderFollow of the graph's root (its tick
		holder frame and position) against this frame's holder transform,
		into out.
		================
		*/
		follow( slot: number, transform: Float32Array, out: Float32Array ) {
			const instance = instances[slot]!, d = views.particleDefs, at = instance.definition.offset;
			const current = views.particleGraphs[slot * PARTICLE_GRAPH_RECORD + G_CURRENT]!;
			const elements = d[at + GD_ELEMENTS]!;
			const matrix = instance.frames + current * d[at + GD_HALF_FLOATS]! + elements * ELEMENT_FLOATS + F_MATRIX;
			const position = currentHalf( slot ) + d[at + GD_ELEMENTS_AT]! + elements * ELEMENT_WORDS + E_POSITION;
			for ( let i = 0; i < 16; i++ ) rootMatrix[i] = views.particleFrames[matrix + i]!;
			for ( let i = 0; i < 3; i++ ) rootPosition[i] = views.particleState[position + i]!;
			holderFollow( rootMatrix, rootPosition, transform, out );
		},
		/*
		================
		emitter

		Emitter n's rows, live elements and the GPU records of its slots (a
		view, valid until a table grows); undefined when it is not drawn.
		================
		*/
		emitter( slot: number, n: number ) {
			const instance = instances[slot]!, d = views.particleDefs, at = instance.definition.offset;
			const emitter = instance.definition.emitters[n]!, records = d[emitter + D_RECORDS]!;
			if ( records < 0 ) return undefined;
			const state = currentHalf( slot ) + d[emitter + D_STATE]!;
			const start = instance.frames + 2 * d[at + GD_HALF_FLOATS]! + records;
			return {
				rows: views.particleState[state + S_ROWS]!,
				live: views.particleState[state + S_LIVE]!,
				records: views.particleFrames.subarray( start, start + d[emitter + D_SLOTS]! * PARTICLE_RECORD )
			};
		},
		/*
		================
		release
		================
		*/
		release( slot: number ) {
			if ( started ) throw Error( "Particle graph released during its phase" );
			const instance = instances[slot];
			if ( !instance ) return;
			instances[slot] = undefined;
			freeRegion( freeState, instance.definition.stateWords, instance.state );
			freeRegion( freeFrames, instance.definition.frameFloats, instance.frames );
			instance.definition.users--;
			dropDefinition( instance.definition );
			freeSlots.push( slot );
			const queued = requested.indexOf( slot );
			if ( queued >= 0 ) requested.splice( queued, 1 );
		},
		/*
		================
		reset

		Every instance and definition released: their histories are gone.
		================
		*/
		reset() {
			if ( started ) join();
			definitions.clear();
			instances.length =
				slotPhase.length =
				freeSlots.length =
				requested.length =
					0;
			freeDefs.clear();
			freeState.clear();
			freeFrames.clear();
			defsUsed =
				stateUsed =
				framesUsed =
				slotCount =
					0;
			phase++;
		}
	};
}
