/*
===========================================================================

gpu-animation-plan.ts - the GPU skeletal animation inputs of a model

The compute pass (renderer/device/animation-shader.ts) reads two storage
buffers:

- a clip set: every clip's keyframe tables. It depends only on the clips,
  so models that share a clip array share one buffer. An assembled
  character (body plus equipment) is a new model per assembly but reuses
  its body's clips; copying every channel into each model's buffer was
  21 ms on the main thread when a character came into view.
- a skeleton: the model's own hierarchy, rest pose and bind data. It is a
  few kilobytes and built per model.

Both are float arrays; offsets into them are stored as floats (exact below
2^24) or in the 48-byte configuration of each primitive.

===========================================================================
*/
import type { CharacterClip, CharacterModel, CharacterPrimitive } from "@/engine/contracts/character";

// GPU workgroup storage is two matrices for each of at most 128 bones (16 KiB).
// Larger rigs retain the full-rate CPU path. Static admission has its own cap;
// the device additionally limits the sum of resident GPU animation tables.
export const GPU_ANIMATION_NODES = 128;
// The largest clip set or skeleton admitted to one GPU buffer.
export const GPU_ANIMATION_MODEL_BYTES = 8388608;
// Floats per node in a clip table: translation, rotation, scale entries of
// [ key count, times offset, values offset, interpolation ].
const TABLE_FLOATS_PER_NODE = 12;
// Clip header entries a clip set reserves at least; it reserves the next
// power of two above its clip count, so a lazily grown set extends within
// its header (extendGpuClipPlan) until the count doubles.
const MIN_HEADER_CLIPS = 16;

/*
================
GpuClipPlan

data: a header of capacity clips' [ duration, table offset ] (count of
them used), then each clip's table of nodes x 12 floats and its channel
keys. index: a clip's position in the header. eligible: clips the GPU
evaluator runs exactly like the CPU one.
================
*/
export interface GpuClipPlan {
	readonly data: Float32Array;
	readonly nodes: number;
	readonly count: number;
	readonly capacity: number;
	readonly index: ReadonlyMap<CharacterClip, number>;
	readonly eligible: ReadonlySet<CharacterClip>;
}

/*
================
GpuSkeletonPlan

data: depths, parents, rest pose, fixed flags and matrices of the nodes,
then each primitive's joint nodes and inverse binds. configurations: the
48-byte uniform of each primitive (see the shader's Configuration).
================
*/
export interface GpuSkeletonPlan {
	readonly data: Float32Array;
	readonly configurations: ReadonlyMap<CharacterPrimitive, Uint32Array>;
}

/*
================
eligibleClip

A clip the GPU path evaluates as the CPU does: at least one channel, one
channel per node and property, keys present, no cubic splines.
================
*/
function eligibleClip( clip: CharacterClip ): boolean {
	const keys = new Set<string>();
	return clip.channels.length > 0 && clip.channels.every( channel => {
		const key = channel.node + ":" + channel.path;
		if ( keys.has( key ) || !channel.times.length || channel.interpolation === "CUBICSPLINE" ) return false;
		keys.add( key );
		return true;
	} );
}

/*
================
headerCapacity
================
*/
function headerCapacity( count: number ): number {
	let capacity = MIN_HEADER_CLIPS;
	while ( capacity < count ) capacity *= 2;
	return capacity;
}

/*
================
tableNodes

The table width of clips from index from on: one past their highest
animated node, and at least nodes.
================
*/
function tableNodes( clips: readonly CharacterClip[], from: number, nodes: number ): number {
	for ( let c = from; c < clips.length; c++ ) {
		for ( const channel of clips[c]!.channels ) nodes = Math.max( nodes, channel.node + 1 );
	}
	return nodes;
}

/*
================
clipFloats

The floats of the tables and keys of clips from index from on.
================
*/
function clipFloats( clips: readonly CharacterClip[], from: number, nodes: number ): number {
	let floats = 0;
	for ( let c = from; c < clips.length; c++ ) {
		floats += nodes * TABLE_FLOATS_PER_NODE;
		for ( const channel of clips[c]!.channels ) floats += channel.times.length + channel.values.length;
	}
	return floats;
}

/*
================
degenerateRotation

A rotation key of clips from index from on with no direction: the GPU
must not run the set; the CPU validator and evaluator handle it.
================
*/
function degenerateRotation( clips: readonly CharacterClip[], from: number ): boolean {
	for ( let c = from; c < clips.length; c++ ) {
		for ( const channel of clips[c]!.channels ) {
			if ( channel.path !== "rotation" || channel.interpolation === "CUBICSPLINE" ) continue;
			const v = channel.values;
			for ( let i = 0; i < v.length; i += 4 ) {
				if ( Math.hypot( v[i]!, v[i + 1]!, v[i + 2]!, v[i + 3]! ) < 1e-12 ) return true;
			}
		}
	}
	return false;
}

/*
================
writeClips

Writes the header entries, tables and keys of clips from index from on,
the tables starting at cursor; returns the end of what it wrote.
================
*/
function writeClips(
	data: Float32Array,
	cursor: number,
	clips: readonly CharacterClip[],
	from: number,
	nodes: number
): number {
	/*
	================
	append
	================
	*/
	function append( values: ArrayLike<number> ): number {
		const at = cursor;
		data.set( values, at );
		cursor += values.length;
		return at;
	}
	for ( let index = from; index < clips.length; index++ ) {
		const clip = clips[index]!;
		data[index * 2] = clip.duration;
		data[index * 2 + 1] = cursor;
		const table = cursor;
		cursor += nodes * TABLE_FLOATS_PER_NODE;
		for ( const channel of clip.channels ) {
			const property = channel.path === "translation" ? 0 : channel.path === "rotation" ? 1 : 2,
				at = table + (channel.node * 3 + property) * 4;
			data[at] = channel.times.length;
			data[at + 1] = append( channel.times );
			data[at + 2] = append( channel.values );
			data[at + 3] = channel.interpolation === "STEP" ? 1 : channel.interpolation === "CUBICSPLINE" ? 2 : 0;
		}
	}
	return cursor;
}

/*
================
finite

Whether data's values in [ start, end ) are all finite.
================
*/
function finite( data: Float32Array, start: number, end: number ): boolean {
	for ( let i = start; i < end; i++ ) if ( !Number.isFinite( data[i]! ) ) return false;
	return true;
}

/*
================
createGpuClipPlan

The clip set buffer of a clip array, or null when the GPU must not run it
(oversized, a degenerate rotation key, non-finite data).
================
*/
export function createGpuClipPlan( clips: readonly CharacterClip[] ): GpuClipPlan | null {
	const nodes = tableNodes( clips, 0, 1 ), capacity = headerCapacity( clips.length );
	const floats = capacity * 2 + clipFloats( clips, 0, nodes );
	if ( floats * 4 > GPU_ANIMATION_MODEL_BYTES ) return null;
	// Reject unsafe GPU inputs to the existing CPU validator/evaluator.
	if ( degenerateRotation( clips, 0 ) ) return null;
	const data = new Float32Array( floats );
	if ( writeClips( data, capacity * 2, clips, 0, nodes ) !== data.length ) {
		throw Error( "GPU clip plan accounting mismatch" );
	}
	if ( !finite( data, 0, data.length ) ) return null;
	return {
		data,
		nodes,
		count: clips.length,
		capacity,
		index: new Map( clips.map( ( clip, index ) => [ clip, index ] ) ),
		eligible: new Set( clips.filter( eligibleClip ) )
	};
}

/*
================
extendGpuClipPlan

The plan of clips, whose first previous.count clips are the clips previous
was made of: previous's buffer copied unchanged, then the new clips' header
entries, tables and keys. Equal to createGpuClipPlan( clips ), which it
falls back to when the new clips animate a node past previous's tables or
outgrow its header. A null previous stays null: every reason persists.
================
*/
export function extendGpuClipPlan(
	previous: GpuClipPlan | null,
	clips: readonly CharacterClip[]
): GpuClipPlan | null {
	if ( !previous ) return null;
	const from = previous.count, nodes = tableNodes( clips, from, previous.nodes );
	if ( nodes !== previous.nodes || clips.length > previous.capacity ) return createGpuClipPlan( clips );
	const floats = previous.data.length + clipFloats( clips, from, nodes );
	if ( floats * 4 > GPU_ANIMATION_MODEL_BYTES || degenerateRotation( clips, from ) ) return null;
	const data = new Float32Array( floats );
	data.set( previous.data );
	if ( writeClips( data, previous.data.length, clips, from, nodes ) !== data.length ) {
		throw Error( "GPU clip plan accounting mismatch" );
	}
	if ( !finite( data, from * 2, clips.length * 2 ) || !finite( data, previous.data.length, data.length ) ) {
		return null;
	}
	const index = new Map( previous.index ), eligible = new Set( previous.eligible );
	for ( let i = from; i < clips.length; i++ ) {
		const clip = clips[i]!;
		index.set( clip, i );
		if ( eligibleClip( clip ) ) eligible.add( clip );
	}
	return { data, nodes, count: clips.length, capacity: previous.capacity, index, eligible };
}

/*
================
createGpuSkeletonPlan

The skeleton buffer of a model whose clips have clipNodes animated nodes,
or null when the rig is too large or not GPU safe.
================
*/
export function createGpuSkeletonPlan( model: CharacterModel, clipNodes: number ): GpuSkeletonPlan | null {
	const count = model.nodes.length;
	if ( !count || count > GPU_ANIMATION_NODES ) return null;
	let floats = count * 31;
	for ( const primitive of model.primitives ) floats += primitive.joints.length * 17;
	if ( floats * 4 > GPU_ANIMATION_MODEL_BYTES ) return null;
	for ( const node of model.nodes ) if ( !node.matrix && Math.hypot( ...node.rotation ) < 1e-12 ) return null;
	const data = new Float32Array( floats );
	let cursor = 0;
	/*
	================
	append
	================
	*/
	function append( values: ArrayLike<number> ): number {
		const at = cursor;
		data.set( values, at );
		cursor += values.length;
		return at;
	}
	const depths = new Uint32Array( count ), state = new Uint8Array( count );
	/*
	================
	visit

	A node's depth below its root, parents first.
	================
	*/
	function visit( n: number ): number {
		if ( n < 0 ) return -1;
		if ( n >= count || state[n] === 1 ) throw Error( "Invalid GPU animation hierarchy" );
		if ( state[n] === 2 ) return depths[n]!;
		state[n] = 1;
		depths[n] = visit( model.nodes[n]!.parent ) + 1;
		state[n] = 2;
		return depths[n]!;
	}
	for ( let n = 0; n < count; n++ ) visit( n );
	const depthAt = append( depths ),
		parents = append( model.nodes.map( n => n.parent ) ),
		rest = append( model.nodes.flatMap( n => [ ...n.translation, 0, ...n.rotation, ...n.scale, 0 ] ) ),
		fixed = append( model.nodes.map( n => n.matrix ? 1 : 0 ) ),
		matrices = append( model.nodes.flatMap( n => n.matrix ? [ ...n.matrix ] : Array<number>( 16 ).fill( 0 ) ) );
	let deepest = 0;
	for ( const depth of depths ) deepest = Math.max( deepest, depth );
	const configurations = new Map<CharacterPrimitive, Uint32Array>();
	for ( const primitive of model.primitives ) {
		const joints = append( primitive.joints ), inverse = append( primitive.inverseBind );
		configurations.set(
			primitive,
			Uint32Array.of(
				count,
				deepest + 1,
				primitive.joints.length,
				joints,
				parents,
				rest,
				fixed,
				matrices,
				depthAt,
				clipNodes,
				inverse,
				0
			)
		);
	}
	if ( cursor !== data.length ) throw Error( "GPU skeleton plan accounting mismatch" );
	if ( !data.every( Number.isFinite ) ) return null;
	return { data, configurations };
}
