/*
===========================================================================

skeletons.ts - the world's character poses on the frame workers

Port-only, not native, used with Worker threads on and shared memory: each
of the world's character poses (animation-pose.ts) keeps its matrices in
one region of the skeleton tables (foundation/kernels/skeleton-record.ts)
and materializes through skeleton-kernel.ts. While prepare evaluates the
frame's poses (collect), each pose that needs CPU matrices is queued;
fork then materializes them all in one KERNEL_SKELETON phase on the frame
workers, and the first palette or socket read joins it. A pose read
before the fork, or outside the window, materializes at once on this
thread through the same kernel. The phase also writes the palettes of the
poses whose palettes this thread will read (animation-pose.ts
readsPalettes). The matrices and palettes are the object code's bit for
bit (skeleton-kernel.test.mjs), so this changes when they are computed,
not what they are.

Owns the tables: one skeleton a model, one entry a sampled clip (its key
clocks and values), and each pose's state, scratch and palette regions,
reused by size. Models and clips are rebuilt from the live poses when
their tables pass three quarters full, between phases.

The palettes are an output table (frame-kernels.ts OUTPUT_TABLES): the
renderer's palette pool uploads them to the GPU straight from shared
memory. A pose publishes its palettes when they are current and read
(animation-pose.ts paletteSlot); takePaletteRanges hands the frame's
published ranges to the upload. A replaced table (a larger one) bumps
paletteGeneration, and every pose publishes again.

===========================================================================
*/
import type { CharacterClip, CharacterModel, CharacterPrimitive } from "@/engine/contracts/character";
import type { FrameKernelPhases } from "@/engine/contracts/frame-workers";
import type { FrameJobRunner } from "@/engine/foundation/workers/frame-jobs";
import {
	type PoseSkeleton,
	type PoseSkeletonInput,
	skeletonBindings
} from "@/engine/foundation/animation/animation-pose";
import {
	KERNEL_SKELETON,
	MAX_SKELETONS,
	MAX_SKELETON_CLIP_WORDS,
	MAX_SKELETON_KEY_FLOATS,
	MAX_SKELETON_MODEL_WORDS,
	MAX_SKELETON_PALETTE_FLOATS,
	MAX_SKELETON_REQUESTS,
	MAX_SKELETON_SCRATCH_WORDS,
	MAX_SKELETON_STATE_FLOATS,
	REQUEST_COUNT,
	REQUEST_SLOTS,
	SKELETON_CHUNK,
	type FrameKernelMemory,
	frameKernelViews,
	growTable,
	growsInPlace,
	refreshViews,
	runFrameKernel
} from "@/engine/foundation/kernels/frame-kernels";
import {
	CLIP_CHANNEL,
	CLIP_CHANNELS,
	CLIP_HEADER,
	CLIP_TIMELINE,
	CLIP_TIMELINES,
	INTERPOLATION_CUBIC,
	INTERPOLATION_LINEAR,
	INTERPOLATION_STEP,
	LANE_EVENT,
	LANE_TIMED,
	LAYER_WORDS,
	PALETTES_NONE,
	PATH_ROTATION,
	PATH_SCALE,
	PATH_TRANSLATION,
	R_BUSY,
	R_CACHE_CLIP,
	R_CHANGED,
	R_CHANNEL_CAPACITY,
	R_CLOCK_CAPACITY,
	R_DIRECT,
	R_DIRECT_MATRICES,
	R_LAYERS,
	R_LAYER_CAPACITY,
	R_MODEL,
	R_PALETTE_AT,
	R_PALETTED,
	R_PALETTES,
	R_RELEASED,
	R_ROTATED,
	R_ROTATION,
	R_SCRATCH,
	R_STATE,
	SKELETON_RECORD,
	STATE_THICKNESS,
	S_BINDINGS,
	S_HEADER,
	S_NODES,
	S_NODE_WORDS
} from "@/engine/foundation/kernels/skeleton-record";
import {
	materializeSkeleton,
	skeletonModelWords,
	skeletonScratchWords,
	skeletonStateFloats
} from "@/engine/foundation/kernels/skeleton-kernel";

// Layers a pose's scratch holds before it grows.
const INITIAL_LAYERS = 4;
// A table is rebuilt from the live poses past this share of its maximum.
const REBUILD_SHARE = .75;

/*
================
Region

A pose's region in one table, reused by size once released.
================
*/
interface Region {
	offset: number;
	size: number;
}

/*
================
SkeletonSlot

A live pose: its model, regions, scratch capacities, the thickness
version of its last inputs and, while queued, what to call once its
matrices are ready.
================
*/
interface SkeletonSlot {
	model: CharacterModel;
	state: Region;
	scratch: Region;
	palettes: Region;
	layers: number;
	channels: number;
	clocks: number;
	thicknessVersion: number;
	done: (( changed: boolean, paletted: boolean, thicknessVersion: number ) => void) | undefined;
}

/*
================
sharedSkeletons

The skeleton owner when the frame workers' tables are shared memory that
grows in place; a pose's state is then a fixed view that stays valid as
its table grows. Without it the world's poses keep their own arrays.
================
*/
export function sharedSkeletons( workers: FrameKernelPhases | undefined ) {
	return workers && growsInPlace( workers.memory(), "skeletonState" ) ? createSkeletons( workers ) : undefined;
}

/*
================
createSkeletons
================
*/
export function createSkeletons( workers: FrameKernelPhases ) {
	const memory = workers.memory(), views = frameKernelViews( memory );
	const models = new Map<CharacterModel, number>();
	// A model's palette bindings (skeletonBindings) and their joints in all.
	const bindings = new WeakMap<CharacterModel, { list: readonly CharacterPrimitive[]; joints: number; }>();
	const clips = new Map<CharacterClip, number>();
	const slots: (SkeletonSlot | undefined)[] = [], freeSlots: number[] = [];
	const freeState = new Map<number, number[]>(), freeScratch = new Map<number, number[]>();
	const freePalettes = new Map<number, number[]>();
	const queued: number[] = [];
	// The palette ranges published since the last upload: start, end pairs in
	// floats; merged by takePaletteRanges.
	const published: number[] = [];
	// takePaletteRanges' scratch, reused frame to frame.
	const rangeOrder: number[] = [], rangeMerged: number[] = [], rangeTaken: number[] = [];
	let modelUsed = 0, clipUsed = 0, keyUsed = 0, stateUsed = 0, scratchUsed = 0, paletteUsed = 0, slotCount = 0;
	let collecting = false, forked = false, paletteGeneration = 0;
	/*
	================
	runLocal
	================
	*/
	const runLocal: FrameJobRunner = ( kernel, chunk ) => runFrameKernel( views, kernel, chunk );

	/*
	================
	reserve

	Room for size more units at used in one table: grown by doubling, at most
	to max. The tables grow in place, so no pose's view moves.
	================
	*/
	function reserve( table: keyof FrameKernelMemory, unit: number, used: number, size: number, max: number ) {
		const length = memory[table].byteLength / unit;
		if ( used + size <= length ) return;
		if ( used + size > max ) throw Error( "Skeleton capacity exceeded" );
		let grown = length;
		while ( grown < used + size ) grown *= 2;
		const before = memory[table];
		growTable( memory, table, Math.min( max, grown ) * unit );
		refreshViews( views );
		// An output table is replaced, not grown: its pool uploads it again.
		if ( memory[table] !== before && table === "skeletonPalettes" ) paletteGeneration++;
	}

	/*
	================
	allocate

	A region of size from a table's free list, else at its end.
	================
	*/
	function allocate( free: Map<number, number[]>, size: number, take: () => number ): Region {
		const offset = free.get( size )?.pop();
		return { offset: offset ?? take(), size };
	}

	/*
	================
	retire
	================
	*/
	function retire( free: Map<number, number[]>, region: Region ) {
		const list = free.get( region.size ) ?? [];
		list.push( region.offset );
		free.set( region.size, list );
	}

	/*
	================
	bindingsOf
	================
	*/
	function bindingsOf( model: CharacterModel ) {
		let known = bindings.get( model );
		if ( !known ) {
			const list = skeletonBindings( model );
			known = { list, joints: list.reduce( ( sum, binding ) => sum + binding.joints.length, 0 ) };
			bindings.set( model, known );
		}
		return known;
	}

	/*
	================
	modelOf

	The model's skeleton offset, written once: parents, parent-first order,
	authored matrices and float32 rest transforms (as animation-pose.ts
	keeps them), then its palette bindings' joints and inverse binds.
	================
	*/
	function modelOf( model: CharacterModel ): number {
		const known = models.get( model );
		if ( known !== undefined ) return known;
		const palettes = bindingsOf( model );
		const n = model.nodes.length, words = skeletonModelWords( n, palettes.list.length, palettes.joints );
		reserve( "skeletonModels", 8, modelUsed, words, MAX_SKELETON_MODEL_WORDS );
		const at = modelUsed, table = views.skeletonModels;
		modelUsed += words;
		table.fill( 0, at, at + words );
		table[at + S_NODES] = n;
		const parents = at + S_HEADER, order = parents + n, hasMatrix = order + n, matrices = hasMatrix + n;
		const restT = matrices + n * 16, restR = restT + n * 3, restS = restR + n * 4;
		const visited = new Uint8Array( n );
		let next = 0;
		/*
		================
		visit
		================
		*/
		const visit = ( node: number ) => {
			if ( visited[node] ) return;
			const parent = model.nodes[node]!.parent;
			if ( parent >= 0 ) visit( parent );
			visited[node] = 1;
			table[order + next++] = node;
		};
		for ( let node = 0; node < n; node++ ) visit( node );
		for ( let node = 0; node < n; node++ ) {
			const source = model.nodes[node]!;
			table[parents + node] = source.parent;
			if ( source.matrix ) {
				table[hasMatrix + node] = 1;
				for ( let c = 0; c < 16; c++ ) table[matrices + node * 16 + c] = source.matrix[c]!;
			}
			for ( let c = 0; c < 3; c++ ) table[restT + node * 3 + c] = Math.fround( source.translation[c]! );
			for ( let c = 0; c < 4; c++ ) table[restR + node * 4 + c] = Math.fround( source.rotation[c]! );
			for ( let c = 0; c < 3; c++ ) table[restS + node * 3 + c] = Math.fround( source.scale[c]! );
		}
		table[at + S_BINDINGS] = palettes.list.length;
		let binding = at + S_HEADER + n * S_NODE_WORDS;
		for ( const primitive of palettes.list ) {
			const joints = primitive.joints.length;
			table[binding] = joints;
			for ( let i = 0; i < joints; i++ ) table[binding + 1 + i] = primitive.joints[i]!;
			for ( let i = 0; i < joints * 16; i++ ) table[binding + 1 + joints + i] = primitive.inverseBind[i]!;
			binding += 1 + joints * 17;
		}
		models.set( model, at );
		return at;
	}

	/*
	================
	clocksOf

	The clip's distinct key clocks: channels whose times are the same bytes
	share one, as animation-timelines.ts shares their brackets.
	================
	*/
	function clocksOf( clip: CharacterClip ): { readonly clocks: Float32Array[]; readonly index: number[]; } {
		const clocks: Float32Array[] = [], words: Uint32Array[] = [], index: number[] = [];
		for ( const channel of clip.channels ) {
			const times = channel.times, bits = new Uint32Array( times.buffer, times.byteOffset, times.length );
			let found = clocks.findIndex( ( known, at ) =>
				known === times || known.length === times.length && words[at]!.every( ( word, i ) => word === bits[i] )
			);
			if ( found < 0 ) {
				found = clocks.length;
				clocks.push( times );
				words.push( bits );
			}
			index.push( found );
		}
		return { clocks, index };
	}

	/*
	================
	clipOf

	The clip's offset in skeletonClips, written once while poses sample it:
	its key clocks and channels, keys and values in skeletonKeys.
	================
	*/
	function clipOf( clip: CharacterClip ): number {
		const known = clips.get( clip );
		if ( known !== undefined ) return known;
		const { clocks, index } = clocksOf( clip ), channels = clip.channels.length;
		const words = CLIP_HEADER + clocks.length * CLIP_TIMELINE + channels * CLIP_CHANNEL;
		let floats = 0;
		for ( const times of clocks ) floats += times.length;
		for ( const channel of clip.channels ) floats += channel.values.length;
		reserve( "skeletonClips", 8, clipUsed, words, MAX_SKELETON_CLIP_WORDS );
		reserve( "skeletonKeys", 4, keyUsed, floats, MAX_SKELETON_KEY_FLOATS );
		const at = clipUsed, table = views.skeletonClips, keys = views.skeletonKeys;
		clipUsed += words;
		table[at + CLIP_CHANNELS] = channels;
		table[at + CLIP_TIMELINES] = clocks.length;
		for ( let clock = 0; clock < clocks.length; clock++ ) {
			const times = clocks[clock]!, entry = at + CLIP_HEADER + clock * CLIP_TIMELINE;
			keys.set( times, keyUsed );
			table[entry] = keyUsed;
			table[entry + 1] = times.length;
			keyUsed += times.length;
		}
		const first = at + CLIP_HEADER + clocks.length * CLIP_TIMELINE;
		for ( let c = 0; c < channels; c++ ) {
			const channel = clip.channels[c]!, entry = first + c * CLIP_CHANNEL;
			keys.set( channel.values, keyUsed );
			table[entry] = channel.node;
			table[entry + 1] = channel.path === "translation" ?
				PATH_TRANSLATION :
				channel.path === "rotation" ?
				PATH_ROTATION :
				PATH_SCALE;
			table[entry + 2] = channel.interpolation === "CUBICSPLINE" ?
				INTERPOLATION_CUBIC :
				channel.interpolation === "STEP" ?
				INTERPOLATION_STEP :
				INTERPOLATION_LINEAR;
			table[entry + 3] = index[c]!;
			table[entry + 4] = keyUsed;
			keyUsed += channel.values.length;
		}
		clips.set( clip, at );
		return at;
	}

	/*
	================
	scratchFor

	The slot's scratch, grown to hold layers, channels and clocks; a new
	region drops the quaternion brackets it held.
	================
	*/
	function scratchFor( index: number, slot: SkeletonSlot, layers: number, channels: number, clocks: number ) {
		if ( layers <= slot.layers && channels <= slot.channels && clocks <= slot.clocks ) return;
		retire( freeScratch, slot.scratch );
		slot.layers = Math.max( slot.layers, layers );
		slot.channels = Math.max( slot.channels, channels );
		slot.clocks = Math.max( slot.clocks, clocks );
		const size = skeletonScratchWords( slot.layers, slot.channels, slot.clocks );
		slot.scratch = allocate( freeScratch, size, () => {
			reserve( "skeletonScratch", 8, scratchUsed, size, MAX_SKELETON_SCRATCH_WORDS );
			const offset = scratchUsed;
			scratchUsed += size;
			return offset;
		} );
		const records = views.skeletonRecords, w = index * SKELETON_RECORD;
		records[w + R_SCRATCH] = slot.scratch.offset;
		records[w + R_LAYER_CAPACITY] = slot.layers;
		records[w + R_CHANNEL_CAPACITY] = slot.channels;
		records[w + R_CLOCK_CAPACITY] = slot.clocks;
		records[w + R_CACHE_CLIP] = -1;
	}

	/*
	================
	writeInput

	A materialization's inputs into the slot's record and scratch.
	================
	*/
	function writeInput( index: number, slot: SkeletonSlot, input: PoseSkeletonInput ) {
		let channels = 0, clocks = 0;
		for ( const layer of input.layers ) {
			if ( !layer.clip ) continue;
			const clip = clipOf( layer.clip );
			channels = Math.max( channels, views.skeletonClips[clip + CLIP_CHANNELS]! );
			clocks = Math.max( clocks, views.skeletonClips[clip + CLIP_TIMELINES]! );
		}
		scratchFor( index, slot, input.layers.length, channels, clocks );
		const records = views.skeletonRecords, scratch = views.skeletonScratch, w = index * SKELETON_RECORD;
		for ( let i = 0; i < input.layers.length; i++ ) {
			const layer = input.layers[i]!, at = slot.scratch.offset + i * LAYER_WORDS;
			scratch[at] = layer.clip ? clipOf( layer.clip ) : -1;
			scratch[at + 1] = layer.time;
			scratch[at + 2] = layer.weight;
			scratch[at + 3] = layer.lane === "event" ? LANE_EVENT : LANE_TIMED;
		}
		records[w + R_LAYERS] = input.layers.length;
		records[w + R_DIRECT] = input.direct ? 1 : 0;
		records[w + R_ROTATED] = input.rotatedNode;
		records[w + R_RELEASED] = input.releasedNode;
		for ( let c = 0; c < 4; c++ ) records[w + R_ROTATION + c] = input.rotation[c]!;
		records[w + R_CHANGED] = 0;
		records[w + R_PALETTES] = input.palettes;
		records[w + R_PALETTED] = 0;
		slot.thicknessVersion = input.thicknessVersion;
		if ( input.palettes !== PALETTES_NONE ) {
			views.skeletonState.set(
				input.thickness,
				slot.state.offset + slot.model.nodes.length * STATE_THICKNESS
			);
		}
	}

	/*
	================
	handOut

	A materialized slot's result to its pose.
	================
	*/
	function handOut( index: number, done: ( changed: boolean, paletted: boolean, thicknessVersion: number ) => void ) {
		const records = views.skeletonRecords, w = index * SKELETON_RECORD;
		const changed = records[w + R_CHANGED] === 1, paletted = records[w + R_PALETTED] === 1;
		records[w + R_CHANGED] = records[w + R_PALETTED] = 0;
		done( changed, paletted, slots[index]!.thicknessVersion );
	}

	/*
	================
	join

	The forked phase over, then every queued pose finished.
	================
	*/
	function join() {
		if ( !forked ) return;
		forked = false;
		workers.join( runLocal );
		const finished = queued.splice( 0 );
		for ( const index of finished ) {
			const slot = slots[index]!, done = slot.done!;
			slot.done = undefined;
			handOut( index, done );
		}
	}

	/*
	================
	unqueue
	================
	*/
	function unqueue( index: number ) {
		const at = queued.indexOf( index );
		if ( at >= 0 ) queued.splice( at, 1 );
		slots[index]!.done = undefined;
	}

	/*
	================
	rebuild

	Past REBUILD_SHARE of a table's maximum, between phases: the live poses'
	models written again from the start, and clips written again as poses
	sample them. Every pose's quaternion brackets are dropped with them.
	================
	*/
	function rebuild() {
		const records = views.skeletonRecords;
		if ( modelUsed > MAX_SKELETON_MODEL_WORDS * REBUILD_SHARE ) {
			models.clear();
			modelUsed = 0;
			for ( let index = 0; index < slotCount; index++ ) {
				const slot = slots[index];
				if ( slot ) records[index * SKELETON_RECORD + R_MODEL] = modelOf( slot.model );
			}
		}
		if ( clipUsed > MAX_SKELETON_CLIP_WORDS * REBUILD_SHARE || keyUsed > MAX_SKELETON_KEY_FLOATS * REBUILD_SHARE ) {
			clips.clear();
			clipUsed = keyUsed = 0;
			for ( let index = 0; index < slotCount; index++ ) {
				if ( slots[index] ) records[index * SKELETON_RECORD + R_CACHE_CLIP] = -1;
			}
		}
	}

	return {
		/*
		================
		pose

		A new pose's skeleton for model: its record, its state (rest
		transforms in place, everything else zero) and scratch.
		================
		*/
		pose( model: CharacterModel ): PoseSkeleton {
			if ( forked ) throw Error( "Skeleton admitted during its phase" );
			const index = freeSlots.pop() ?? slotCount;
			if ( index >= MAX_SKELETONS ) throw Error( "Skeleton capacity exceeded" );
			if ( index === slotCount ) {
				slotCount++;
				reserve(
					"skeletonRecords",
					8,
					(slotCount - 1) * SKELETON_RECORD,
					SKELETON_RECORD,
					MAX_SKELETONS * SKELETON_RECORD
				);
			}
			const n = model.nodes.length, floats = skeletonStateFloats( n );
			const state = allocate( freeState, floats, () => {
				reserve( "skeletonState", 4, stateUsed, floats, MAX_SKELETON_STATE_FLOATS );
				const offset = stateUsed;
				stateUsed += floats;
				return offset;
			} );
			const paletteFloats = bindingsOf( model ).joints * 16;
			const palettes = allocate( freePalettes, paletteFloats, () => {
				reserve( "skeletonPalettes", 4, paletteUsed, paletteFloats, MAX_SKELETON_PALETTE_FLOATS );
				const offset = paletteUsed;
				paletteUsed += paletteFloats;
				return offset;
			} );
			const channels = model.clips.reduce( ( max, clip ) => Math.max( max, clip.channels.length ), 0 );
			const size = skeletonScratchWords( INITIAL_LAYERS, channels, channels );
			const scratch = allocate( freeScratch, size, () => {
				reserve( "skeletonScratch", 8, scratchUsed, size, MAX_SKELETON_SCRATCH_WORDS );
				const offset = scratchUsed;
				scratchUsed += size;
				return offset;
			} );
			const slot: SkeletonSlot = {
				model,
				state,
				scratch,
				palettes,
				layers: INITIAL_LAYERS,
				channels,
				clocks: channels,
				thicknessVersion: 0,
				done: undefined
			};
			slots[index] = slot;
			const records = views.skeletonRecords, w = index * SKELETON_RECORD;
			records.fill( 0, w, w + SKELETON_RECORD );
			records[w + R_MODEL] = modelOf( model );
			records[w + R_STATE] = state.offset;
			records[w + R_SCRATCH] = scratch.offset;
			records[w + R_PALETTE_AT] = palettes.offset;
			records[w + R_LAYER_CAPACITY] = INITIAL_LAYERS;
			records[w + R_CHANNEL_CAPACITY] = channels;
			records[w + R_CLOCK_CAPACITY] = channels;
			records[w + R_CACHE_CLIP] = -1;
			records[w + R_ROTATED] = -1;
			records[w + R_RELEASED] = -1;
			views.skeletonState.fill( 0, state.offset, state.offset + floats );
			const view = new Float32Array( memory.skeletonState, state.offset * 4, floats );
			let paletteView: Float32Array = new Float32Array( 0 ), publishedVersion = -1, publishedGeneration = -1;
			let released = false;
			return {
				state: view,
				paletteAt: palettes.offset,
				palettes() {
					// The table is replaced as it grows: the view follows it.
					if ( paletteView.buffer !== memory.skeletonPalettes ) {
						paletteView = new Float32Array( memory.skeletonPalettes, palettes.offset * 4, palettes.size );
					}
					return paletteView;
				},
				publish( version, force = false ) {
					if ( !force && version === publishedVersion && publishedGeneration === paletteGeneration ) return;
					publishedVersion = version;
					publishedGeneration = paletteGeneration;
					if ( palettes.size ) published.push( palettes.offset, palettes.offset + palettes.size );
				},
				materialize( input, done, timing ) {
					if ( released ) throw Error( "Released skeleton" );
					if ( timing === "spare" && !collecting ) return;
					if ( slot.done ) {
						// Queued: a forked phase is joined, and an unforked request
						// gives way to this one.
						if ( forked ) {
							join();
							return;
						}
						unqueue( index );
					}
					writeInput( index, slot, input );
					if ( timing !== "now" && collecting && queued.length < MAX_SKELETON_REQUESTS ) {
						slot.done = done;
						queued.push( index );
						return;
					}
					refreshViews( views );
					materializeSkeleton( views, index );
					handOut( index, done );
				},
				resetDirect() {
					if ( slot.done && forked ) join();
					views.skeletonRecords[w + R_DIRECT_MATRICES] = 0;
				},
				release() {
					if ( released ) return;
					if ( slot.done ) {
						if ( forked ) join();
						else unqueue( index );
					}
					released = true;
					retire( freeState, slot.state );
					retire( freeScratch, slot.scratch );
					retire( freePalettes, slot.palettes );
					slots[index] = undefined;
					views.skeletonRecords[w + R_BUSY] = 0;
					freeSlots.push( index );
				}
			};
		},
		/*
		================
		collect

		Start queueing: until fork, a pose evaluate materializes waits for the
		frame's skeleton phase. Tables past their share rebuild first.
		================
		*/
		collect() {
			join();
			rebuild();
			collecting = true;
		},
		/*
		================
		fork

		Stop queueing and fork one KERNEL_SKELETON phase over the queued poses.
		================
		*/
		fork() {
			collecting = false;
			if ( forked || !queued.length ) return;
			refreshViews( views );
			const list = views.skeletonRequests;
			list[REQUEST_COUNT] = queued.length;
			for ( let i = 0; i < queued.length; i++ ) list[REQUEST_SLOTS + i] = queued[i]!;
			workers.fork( KERNEL_SKELETON, Math.ceil( queued.length / SKELETON_CHUNK ) );
			forked = true;
		},
		join,
		/*
		================
		paletteTable

		The palette table as it is now, which the palette pool mirrors.
		================
		*/
		paletteTable(): Float32Array {
			refreshViews( views );
			return views.skeletonPalettes;
		},
		/*
		================
		paletteGeneration

		Bumped each time the palette table is replaced by a larger one.
		================
		*/
		paletteGeneration: () => paletteGeneration,
		/*
		================
		takePaletteRanges

		The palette ranges published since the last take, start and end pairs
		in floats, sorted and merged where they meet. The frame's phase is
		joined first: the upload reads the table at the frame's submit, and
		no worker may be writing it then. The list is reused by the next take.
		================
		*/
		takePaletteRanges(): readonly number[] {
			join();
			const pairs = published.length / 2;
			if ( pairs > 1 ) {
				rangeOrder.length = 0;
				for ( let i = 0; i < pairs; i++ ) rangeOrder.push( i );
				rangeOrder.sort( ( a, b ) => published[a * 2]! - published[b * 2]! );
				rangeMerged.length = 0;
				for ( const i of rangeOrder ) {
					const start = published[i * 2]!, end = published[i * 2 + 1]!;
					if ( rangeMerged.length && start <= rangeMerged[rangeMerged.length - 1]! ) {
						rangeMerged[rangeMerged.length - 1] = Math.max( rangeMerged[rangeMerged.length - 1]!, end );
					} else rangeMerged.push( start, end );
				}
				published.length = 0;
				published.push( ...rangeMerged );
			}
			rangeTaken.length = 0;
			rangeTaken.push( ...published );
			published.length = 0;
			return rangeTaken;
		},
		/*
		================
		reset

		Every pose released: the renderer dropped them.
		================
		*/
		reset() {
			join();
			collecting = false;
			queued.length = 0;
			models.clear();
			clips.clear();
			slots.length = freeSlots.length = 0;
			freeState.clear();
			freeScratch.clear();
			freePalettes.clear();
			published.length = 0;
			modelUsed =
				clipUsed =
				keyUsed =
				stateUsed =
				scratchUsed =
				paletteUsed =
				slotCount =
					0;
		}
	};
}
