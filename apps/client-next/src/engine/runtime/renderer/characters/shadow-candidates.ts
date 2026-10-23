/*
===========================================================================

shadow-candidates.ts - the characters whose shadows a frame draws

At most SHADOW_LIMIT character shadows are drawn, the nearest
(foundation/rendering/character-shadow.ts). This chooses them from the
frame's batches in two passes: each shadowed root's position (its own
instance's translation) and distance, the nearest chosen; then the drawn
parts of each chosen root and of its shadow-casting attachments, in batch
order. Parts are gathered for the chosen roots alone, and the scratch is
kept frame to frame, so a crowd of hundreds costs no allocation per actor.

===========================================================================
*/
import type { CharacterActor, CharacterModel } from "@/engine/contracts/character";
import { SHADOW_DISTANCE, SHADOW_LIMIT, shadowProjection } from "@/engine/foundation/rendering/character-shadow";
import { hypot3 } from "@/engine/foundation/math/hypot";
import type { GeometryDraw } from "../internal/gpu-contract";

/*
================
ShadowBatch

A batch as the selection reads it: its rows' gids, its primitives' draws
and its rows' instance matrices.
================
*/
export interface ShadowBatch {
	readonly gids: readonly number[];
	readonly draws: readonly GeometryDraw[];
	readonly instances: Float32Array;
}

/*
================
ShadowSource

The renderer's frame the selection reads (characters.ts).
================
*/
export interface ShadowSource {
	readonly batches: Iterable<ShadowBatch>;
	readonly actors: readonly CharacterActor[];
	model( id: string ): CharacterModel | undefined;
	bindBounds( model: CharacterModel ): ArrayLike<number>;
}

/*
================
ShadowPart
================
*/
export interface ShadowPart {
	readonly draw: GeometryDraw;
	readonly instance: number;
}

/*
================
createShadowCandidates
================
*/
export function createShadowCandidates() {
	const active = new Set<GeometryDraw>(), byId = new Map<number, CharacterActor>(), visited = new Set<number>();
	// Each shadowed root's position and distance, by its index in rootIndex.
	const rootIndex = new Map<number, number>(), gids: number[] = [], xs: number[] = [], ys: number[] = [];
	const zs: number[] = [], distances: number[] = [], order: number[] = [];
	const chosen = new Map<number, ShadowPart[]>();
	/*
	================
	shadowRoot

	The root whose shadow actor casts into: itself, or the actor it hangs
	from, through every attachment; undefined when actor casts none (an
	attachment that is not a shadow attachment) or the root has no shadow.
	================
	*/
	function shadowRoot( actor: CharacterActor ): CharacterActor | undefined {
		if ( actor.attachment && !actor.shadowAttachment ) return undefined;
		let root = actor;
		visited.clear();
		while ( root.attachment ) {
			if ( visited.has( root.gid ) ) break;
			visited.add( root.gid );
			const parent = byId.get( root.attachment.gid );
			if ( !parent ) break;
			root = parent;
		}
		if ( root.shadowSize === undefined || (root.opacity ?? 1) <= 0 || root.drawGeometry === false ) {
			return undefined;
		}
		return root;
	}
	/*
	================
	drawn

	Whether the batch row's primitive p is drawn this frame and casts a
	shadow: not an emission or a particle program.
	================
	*/
	function drawn( model: CharacterModel, draw: GeometryDraw, p: number ): boolean {
		const primitive = model.primitives[p];
		return active.has( draw ) && !primitive?.emission && !primitive?.particleProgram;
	}
	return {
		/*
		================
		select

		The shadows of draws' characters for eye: none in mode 0, the nearest
		SHADOW_LIMIT, within SHADOW_DISTANCE in mode 2, and in mode 1 a blob of
		each root's shadow size (none for size 0).
		================
		*/
		select( source: ShadowSource, draws: readonly GeometryDraw[], eye: readonly number[], mode: number ) {
			if ( mode === 0 ) return [];
			active.clear();
			for ( const draw of draws ) active.add( draw );
			byId.clear();
			for ( const actor of source.actors ) byId.set( actor.gid, actor );
			rootIndex.clear();
			gids.length =
				xs.length =
				ys.length =
				zs.length =
					0;
			// Each root drawn this frame, at its own row.
			for ( const batch of source.batches ) {
				for ( let i = 0; i < batch.gids.length; i++ ) {
					const actor = byId.get( batch.gids[i]! );
					if ( !actor ) continue;
					const root = shadowRoot( actor );
					if ( root !== actor ) continue;
					const model = source.model( actor.model );
					if ( !model ) continue;
					let any = false;
					for ( let p = 0; p < batch.draws.length && !any; p++ ) any = drawn( model, batch.draws[p]!, p );
					if ( !any ) continue;
					let at = rootIndex.get( root.gid );
					if ( at === undefined ) {
						at = gids.length;
						rootIndex.set( root.gid, at );
						gids.push( root.gid );
					}
					xs[at] = batch.instances[i * 16 + 12]!;
					ys[at] = batch.instances[i * 16 + 13]!;
					zs[at] = batch.instances[i * 16 + 14]!;
				}
			}
			order.length = distances.length = 0;
			for ( let at = 0; at < gids.length; at++ ) {
				distances.push( hypot3( xs[at]! - eye[0]!, ys[at]! - eye[1]!, zs[at]! - eye[2]! ) );
				order.push( at );
			}
			order.sort( ( a, b ) => distances[a]! - distances[b]! || gids[a]! - gids[b]! );
			chosen.clear();
			for ( const at of order ) {
				if ( chosen.size === SHADOW_LIMIT ) break;
				if ( mode !== 2 || distances[at]! <= SHADOW_DISTANCE ) chosen.set( gids[at]!, [] );
			}
			if ( !chosen.size ) return [];
			// The chosen roots' parts, and their shadow attachments', in batch order.
			for ( const batch of source.batches ) {
				for ( let i = 0; i < batch.gids.length; i++ ) {
					const actor = byId.get( batch.gids[i]! );
					if ( !actor ) continue;
					const root = shadowRoot( actor ), parts = root && chosen.get( root.gid );
					if ( !parts ) continue;
					const model = source.model( actor.model );
					if ( !model ) continue;
					for ( let p = 0; p < batch.draws.length; p++ ) {
						const draw = batch.draws[p]!;
						if ( drawn( model, draw, p ) ) parts.push( { draw, instance: i } );
					}
				}
			}
			const candidates: {
				projection: ReturnType<typeof shadowProjection>;
				blobSize: number | undefined;
				parts: readonly ShadowPart[];
			}[] = [];
			for ( const [gid, parts] of chosen ) {
				const actor = byId.get( gid )!, at = rootIndex.get( gid )!;
				if ( mode === 1 && actor.shadowSize === 0 ) continue;
				const b = source.bindBounds( source.model( actor.model )! );
				candidates.push( {
					projection: shadowProjection( [ xs[at]!, ys[at]!, zs[at]! ], (b[4]! - b[1]!) * actor.scale ),
					blobSize: mode === 1 ? actor.shadowSize! + 5 : undefined,
					parts
				} );
			}
			return candidates;
		}
	};
}
