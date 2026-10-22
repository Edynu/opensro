/*
===========================================================================

cloth-wearers.ts - the world's cloth on the frame workers

Port-only, not native, used with Worker threads on: every cloth primitive
an actor wears is one wearer record (foundation/kernels/cloth-record.ts),
and a frame's wearers step together in one KERNEL_CLOTH phase on the frame
workers (cloth-kernel.ts) instead of one at a time in drawCloth. Each
wearer draws from its own CRT stream, seeded from its gid and primitive
(clothSeed); the simulation is otherwise the object code's
(cloth-vertices.ts), which keeps running with Worker threads off.

Owns the wearer records, the programs (one per cloth primitive, written
once and freed with its last wearer) and the state arena. drawCloth
admits a wearer and requests its frame; prepare forks the phase once the
wearers' groups are built, builds the other groups while the workers
simulate, joins it, then each cloth draw uploads its wearer's packed
vertices. A wearer lives as long as the batch that holds it; the renderer
releases it with the batch.

===========================================================================
*/
import type { CharacterPrimitive } from "@/engine/contracts/character";
import type { FrameKernelPhases } from "@/engine/contracts/frame-workers";
import type { FrameJobRunner } from "@/engine/foundation/workers/frame-jobs";
import { packGeometryVertices } from "@/engine/foundation/rendering/geometry-vertices";
import {
	CLOTH_CHUNK,
	KERNEL_CLOTH,
	MAX_CLOTH_PROGRAM_WORDS,
	MAX_CLOTH_STATE_FLOATS,
	MAX_CLOTH_WEARERS,
	REQUEST_COUNT,
	REQUEST_SLOTS,
	frameKernelViews,
	growTable,
	refreshViews,
	runFrameKernel
} from "@/engine/foundation/kernels/frame-kernels";
import {
	CLOTH_JOINT_FLOATS,
	CLOTH_RECORD,
	CLOTH_VERTEX_FLOATS,
	N_ELAPSED,
	N_RANDOM,
	P_CONSTRAINTS,
	P_DAMPING,
	P_FORCE,
	P_FORCE_SET,
	P_GRAVITY,
	P_GRAVITY_MOBILITY,
	P_HEADER,
	P_JOINTS,
	P_SKINNED,
	P_VERTICES,
	P_WIND_MOBILITY,
	P_WIND_PERIOD,
	W_CURRENT,
	W_DIRECTION,
	W_ELAPSED,
	W_ENABLED,
	W_INITIALIZED,
	W_LAST_SECONDS,
	W_LAST_SET,
	W_PROGRAM,
	W_RANDOM,
	W_SECONDS,
	W_SPEED,
	W_STATE
} from "@/engine/foundation/kernels/cloth-record";
import {
	clothProgramWords,
	clothStateFloats,
	clothStateHalf,
	clothStatePalette,
	clothStateVertices
} from "@/engine/foundation/kernels/cloth-kernel";

/*
================
clothSeed

A wearer's own CRT state: its gid and primitive mixed, so wearers start
apart and the same wearer starts the same way.
================
*/
export function clothSeed( gid: number, primitive: number ): number {
	return (Math.imul( gid >>> 0, 0x9e3779b1 ) ^ Math.imul( primitive + 1, 0x85ebca6b )) >>> 0;
}

/*
================
Program

A cloth primitive's program in clothPrograms and the wearers using it.
================
*/
interface Program {
	readonly primitive: CharacterPrimitive;
	readonly offset: number;
	readonly words: number;
	users: number;
}

/*
================
createClothWearers
================
*/
export function createClothWearers( workers: FrameKernelPhases ) {
	const memory = workers.memory(), views = frameKernelViews( memory );
	const programs = new Map<CharacterPrimitive, Program>();
	// Per wearer slot: its primitive's program, its state offset and size.
	const slotPrograms: (Program | undefined)[] = [], slotState: number[] = [], slotFloats: number[] = [];
	const slotVertices: number[] = [];
	// A slot requested twice in one phase would run on two threads at once.
	const slotPhase: number[] = [];
	const freeSlots: number[] = [];
	// Released regions by size: programs and wearers of one mesh repeat.
	const freePrograms = new Map<number, number[]>(), freeState = new Map<number, number[]>();
	let slotCount = 0, programUsed = 0, stateUsed = 0, phase = 1, started = false;
	const requested: number[] = [];
	/*
	================
	runLocal
	================
	*/
	const runLocal: FrameJobRunner = ( kernel, chunk ) => runFrameKernel( views, kernel, chunk );

	/*
	================
	reserve

	Room for size more units at the end of a table: grown by doubling, at
	most to its maximum.
	================
	*/
	function reserve( table: "clothPrograms" | "clothState", used: number, size: number, max: number ) {
		const unit = table === "clothPrograms" ? Float64Array.BYTES_PER_ELEMENT : Float32Array.BYTES_PER_ELEMENT;
		const length = memory[table].byteLength / unit;
		if ( used + size <= length ) return;
		if ( used + size > max ) throw Error( "Cloth wearer capacity exceeded" );
		let grown = length;
		while ( grown < used + size ) grown *= 2;
		growTable( memory, table, Math.min( max, grown ) * unit );
		refreshViews( views );
	}

	/*
	================
	programOf

	The primitive's program, written once while any wearer uses it.
	================
	*/
	function programOf( primitive: CharacterPrimitive ): Program {
		const known = programs.get( primitive );
		if ( known ) return known;
		const mesh = primitive.geometry, data = primitive.cloth!;
		const n = mesh.positions.length / 3, m = data.order.length, words = clothProgramWords( n, m );
		let offset = freePrograms.get( words )?.pop();
		if ( offset === undefined ) {
			reserve( "clothPrograms", programUsed, words, MAX_CLOTH_PROGRAM_WORDS );
			offset = programUsed;
			programUsed += words;
		}
		const table = views.clothPrograms, skinned = !!mesh.joints && !!mesh.weights;
		table.fill( 0, offset, offset + words );
		table[offset + P_VERTICES] = n;
		table[offset + P_CONSTRAINTS] = m;
		table[offset + P_JOINTS] = primitive.joints.length;
		table[offset + P_SKINNED] = skinned ? 1 : 0;
		table[offset + P_FORCE_SET] = data.force ? 1 : 0;
		if ( data.force ) table.set( data.force, offset + P_FORCE );
		table[offset + P_GRAVITY] = data.gravity;
		table[offset + P_GRAVITY_MOBILITY] = data.gravityMobility;
		table[offset + P_WIND_MOBILITY] = data.windMobility;
		table[offset + P_DAMPING] = data.damping;
		table[offset + P_WIND_PERIOD] = data.windPeriod;
		const rest = offset + P_HEADER, normals = rest + n * 3, joints = normals + n * 3, weights = joints + n * 4;
		const mobility = weights + n * 4, pins = mobility + n, constraints = pins + n;
		table.set( mesh.positions, rest );
		// cloth-vertices.ts reads a missing normal as (0, 1, 0).
		for ( let i = 0; i < n; i++ ) {
			table[normals + i * 3] = mesh.normals?.[i * 3] ?? 0;
			table[normals + i * 3 + 1] = mesh.normals?.[i * 3 + 1] ?? 1;
			table[normals + i * 3 + 2] = mesh.normals?.[i * 3 + 2] ?? 0;
		}
		if ( skinned ) {
			table.set( mesh.joints!.subarray( 0, n * 4 ), joints );
			table.set( mesh.weights!.subarray( 0, n * 4 ), weights );
		}
		table.set( data.mobility, mobility );
		table.set( data.pins, pins );
		for ( let edge = 0; edge < m; edge++ ) {
			table.set( data.constraints[data.order[edge]!]!, constraints + edge * 3 );
		}
		const program = { primitive, offset, words, users: 0 };
		programs.set( primitive, program );
		return program;
	}

	/*
	================
	forkCloth

	Open the KERNEL_CLOTH phase over the wearers requested so far: the frame
	workers start on them while the caller goes on. Nothing may be admitted,
	requested or released until joinCloth.
	================
	*/
	function forkCloth() {
		if ( started || !requested.length ) return;
		refreshViews( views );
		const list = views.clothRequests;
		list[REQUEST_COUNT] = requested.length;
		for ( let i = 0; i < requested.length; i++ ) list[REQUEST_SLOTS + i] = requested[i]!;
		workers.fork( KERNEL_CLOTH, Math.ceil( requested.length / CLOTH_CHUNK ) );
		started = true;
	}

	/*
	================
	joinCloth

	The forked phase's remaining wearers here, then each requested wearer's
	current half switched and its clock and random state committed.
	================
	*/
	function joinCloth() {
		if ( !started ) return;
		started = false;
		workers.join( runLocal );
		const records = views.clothRecords;
		for ( const slot of requested ) {
			const w = slot * CLOTH_RECORD;
			records[w + W_CURRENT] = 1 - records[w + W_CURRENT]!;
			records[w + W_RANDOM] = records[w + N_RANDOM]!;
			records[w + W_ELAPSED] = records[w + N_ELAPSED]!;
			records[w + W_INITIALIZED] = 1;
			records[w + W_LAST_SET] = 1;
			records[w + W_LAST_SECONDS] = records[w + W_SECONDS]!;
		}
		requested.length = 0;
		phase++;
	}

	return {
		/*
		================
		begin

		A new frame: a phase a failed frame left open is finished, and requests
		it never ran are dropped, so a wearer can be requested again.
		================
		*/
		begin() {
			if ( started ) joinCloth();
			requested.length = 0;
			phase++;
		},
		/*
		================
		admit

		A new wearer of primitive, whose CRT state starts at seed: its record
		and state, its vertices the mesh's packed stream, as createClothVertices
		starts them.
		================
		*/
		admit( primitive: CharacterPrimitive, seed: number ): number {
			if ( started ) throw Error( "Cloth wearer admitted during its phase" );
			const program = programOf( primitive ), mesh = primitive.geometry;
			const n = mesh.positions.length / 3, floats = clothStateFloats( n, primitive.joints.length );
			const slot = freeSlots.pop() ?? slotCount;
			if ( slot >= MAX_CLOTH_WEARERS ) throw Error( "Cloth wearer capacity exceeded" );
			if ( slot === slotCount ) {
				slotCount++;
				const bytes = slotCount * CLOTH_RECORD * Float64Array.BYTES_PER_ELEMENT;
				if ( bytes > memory.clothRecords.byteLength ) {
					growTable(
						memory,
						"clothRecords",
						Math.min( MAX_CLOTH_WEARERS * CLOTH_RECORD * Float64Array.BYTES_PER_ELEMENT, bytes * 2 )
					);
					refreshViews( views );
				}
			}
			let state = freeState.get( floats )?.pop();
			if ( state === undefined ) {
				reserve( "clothState", stateUsed, floats, MAX_CLOTH_STATE_FLOATS );
				state = stateUsed;
				stateUsed += floats;
			}
			program.users++;
			slotPrograms[slot] = program;
			slotState[slot] = state;
			slotFloats[slot] = floats;
			slotVertices[slot] = n;
			slotPhase[slot] = 0;
			const records = views.clothRecords, w = slot * CLOTH_RECORD, cloth = views.clothState;
			records.fill( 0, w, w + CLOTH_RECORD );
			records[w + W_PROGRAM] = program.offset;
			records[w + W_STATE] = state;
			records[w + W_RANDOM] = seed >>> 0;
			cloth.fill( 0, state, state + floats );
			cloth.set( mesh.positions, clothStateHalf( state, n, 0 ) );
			cloth.set( mesh.positions, clothStateHalf( state, n, 0 ) + n * 3 );
			cloth.set( packGeometryVertices( mesh ), clothStateVertices( state, n ) );
			return slot;
		},
		/*
		================
		request

		The wearer's frame, as createClothVertices' update takes it: its palette
		(the batch's, 16 floats a joint), the frame time, whether it simulates,
		and the wind.
		================
		*/
		request(
			slot: number,
			palette: Float32Array,
			seconds: number,
			enabled: boolean,
			motion: { readonly direction: readonly number[]; readonly speed: number; }
		) {
			if ( started ) throw Error( "Cloth wearer requested during its phase" );
			if ( slotPhase[slot] === phase ) throw Error( "Cloth wearer requested twice in one phase" );
			slotPhase[slot] = phase;
			const records = views.clothRecords, w = slot * CLOTH_RECORD;
			records[w + W_SECONDS] = seconds;
			records[w + W_ENABLED] = enabled ? 1 : 0;
			records[w + W_DIRECTION] = motion.direction[0]!;
			records[w + W_DIRECTION + 1] = motion.direction[1]!;
			records[w + W_DIRECTION + 2] = motion.direction[2]!;
			records[w + W_SPEED] = motion.speed;
			const n = slotVertices[slot]!, program = slotPrograms[slot]!.offset;
			const joints = views.clothPrograms[program + P_JOINTS]! * CLOTH_JOINT_FLOATS;
			views.clothState.set(
				palette.subarray( 0, Math.min( joints, palette.length ) ),
				clothStatePalette( slotState[slot]!, n )
			);
			requested.push( slot );
		},
		forkCloth,
		joinCloth,
		/*
		================
		run

		forkCloth then joinCloth.
		================
		*/
		run() {
			forkCloth();
			joinCloth();
		},
		/*
		================
		vertices

		The wearer's packed vertices as the last phase left them; a view, valid
		until the state arena next grows.
		================
		*/
		vertices( slot: number ): Float32Array {
			refreshViews( views );
			const n = slotVertices[slot]!, at = clothStateVertices( slotState[slot]!, n );
			return views.clothState.subarray( at, at + n * CLOTH_VERTEX_FLOATS );
		},
		/*
		================
		release
		================
		*/
		release( slot: number ) {
			if ( started ) throw Error( "Cloth wearer released during its phase" );
			const program = slotPrograms[slot];
			if ( !program ) return;
			slotPrograms[slot] = undefined;
			const floats = slotFloats[slot]!;
			const free = freeState.get( floats ) ?? [];
			free.push( slotState[slot]! );
			freeState.set( floats, free );
			freeSlots.push( slot );
			const index = requested.indexOf( slot );
			if ( index >= 0 ) requested.splice( index, 1 );
			if ( --program.users > 0 ) return;
			const regions = freePrograms.get( program.words ) ?? [];
			regions.push( program.offset );
			freePrograms.set( program.words, regions );
			programs.delete( program.primitive );
		},
		/*
		================
		reset

		Every wearer and program released: the batches holding them are gone.
		================
		*/
		reset() {
			if ( started ) joinCloth();
			programs.clear();
			slotPrograms.length =
				slotState.length =
				slotFloats.length =
				slotVertices.length =
				slotPhase.length =
					0;
			freeSlots.length = 0;
			freePrograms.clear();
			freeState.clear();
			requested.length = 0;
			slotCount = programUsed = stateUsed = 0;
			phase++;
		}
	};
}
