/*
===========================================================================

renderer-stand-in.ts - the renderer the character worker's presentation talks to

Port-only, not native (docs/CLIENT_WORKERS_PLAN.md 5.11). On the character
worker the presentation issues the renderer commands it issues on the main
thread; this records them in their order for the main thread to repeat on
the real renderer, and answers the presentation's queries: the skeleton
queries from a renderer character owner of the worker's own, which is
given the same models, clips and assemblies without their geometry, and
the rest from the facts the main thread posted with the frame (the frame
it drew last).

===========================================================================
*/
import type { CharacterWorkerCommand, CharacterWorkerFacts } from "@/engine/contracts/character-worker";
import type { CharacterActor, CharacterAttachment, CharacterModel } from "@/engine/contracts/character";
import type { PresentationRenderer } from "@/engine/contracts/runtime";
import type { WorldTexture } from "@/engine/contracts/texture";
import type { NativeClip } from "@/engine/foundation/animation/native-clip";
import { characterBytes } from "@/engine/foundation/animation/character-budget";
import { collectTransferables } from "@/engine/foundation/workers/transferables";

/*
================
SkeletonOwner

What the stand-in borrows from the worker's renderer character owner
(renderer/characters/characters.ts): admission and the skeleton queries.
================
*/
export interface SkeletonOwner {
	model( id: string, model: CharacterModel, images: WorldTexture[] ): void;
	animation( id: string, name: string, source: NativeClip ): number;
	assembly( id: string, base: string, parts: readonly CharacterAttachment[] ): void;
	retain( ids: readonly string[] ): void;
	socket: PresentationRenderer["characterSocket"];
	matrix: PresentationRenderer["characterMatrix"];
	localMatrix: PresentationRenderer["characterLocalMatrix"];
	skeletonFrame( seconds: number ): void;
}

/*
================
skeletonModel

The model a skeleton query needs: its nodes, clips, joints and inverse
binds, with no vertices, indices, images or cloth (cloth is checked against
the vertices). Pose evaluation and the render plan read none of them;
joints and weights stay present, empty, because the plan tells a
shared-palette body by their presence.
================
*/
export function skeletonModel( model: CharacterModel ): CharacterModel {
	return {
		...model,
		images: [],
		primitives: model.primitives.map( primitive => {
			const geometry = primitive.geometry;
			return {
				...primitive,
				cloth: undefined,
				geometry: {
					transform: geometry.transform,
					positions: new Float32Array( 0 ),
					indices: new Uint32Array( 0 ),
					...(geometry.joints ? { joints: new Uint32Array( 0 ) } : {}),
					...(geometry.weights ? { weights: new Float32Array( 0 ) } : {}),
					...(geometry.bones ? { bones: geometry.bones } : {}),
					...(geometry.material ? { material: geometry.material } : {})
				}
			};
		} )
	};
}

/*
================
createRendererStandIn
================
*/
export function createRendererStandIn( skeletons: SkeletonOwner, delivered: WeakSet<object> ) {
	let commands: CharacterWorkerCommand[] = [], transfer: Transferable[] = [];
	let facts: CharacterWorkerFacts | null = null;
	let scenery: CharacterWorkerFacts["scenery"] = null,
		dungeonVisibility: CharacterWorkerFacts["dungeonVisibility"] = null;
	let particleTimes = new Map<number, number>();
	let published: readonly CharacterActor[] = [];
	// The buffers and bitmaps under root that arrived in an asset result: no
	// one on the worker reads them again (the skeleton owner keeps its own
	// copy), so they move to the main thread. Anything else, a procedural
	// effect the presentation caches or a clip it decoded, is copied.
	const handOver = ( root: unknown ) => {
		const taken = collectTransferables( root, value => delivered.has( value ) );
		for ( const value of taken ) delivered.delete( value );
		return taken;
	};
	// Assemblies whose definition the main thread has.
	const sent = new Set<string>();
	// A model's bytes as the renderer charges them, and as the skeleton
	// owner charges its geometry-free copy: a clip adds the same to both.
	const charged = new Map<string, { bytes: number; skeleton: number; }>();
	const renderer: PresentationRenderer = {
		setCharacterActors( actors, portraits ) {
			published = actors;
			commands.push( { kind: "actors", actors, portraits } );
		},
		setCharacterAssembly( id, base, parts ) {
			skeletons.assembly( id, base, parts );
			if ( sent.has( id ) ) commands.push( { kind: "assembly", id } );
			else {
				sent.add( id );
				commands.push( { kind: "assembly", id, definition: { base, parts } } );
			}
		},
		setCharacterModel( id, model, images ) {
			// The renderer charges the source first (its throw), then admits;
			// the skeleton owner admits the geometry-free copy.
			const bytes = characterBytes( model, images ), skeleton = skeletonModel( model );
			skeletons.model( id, skeleton, [] );
			charged.set( id, { bytes, skeleton: characterBytes( skeleton, [] ) } );
			commands.push( { kind: "model", id, model, images } );
			transfer.push( ...handOver( [ model, images ] ) );
		},
		setCharacterAnimation( id, name, clip ) {
			const skeleton = skeletons.animation( id, name, clip ), row = charged.get( id );
			commands.push( { kind: "animation", id, name, clip } );
			transfer.push( ...handOver( clip ) );
			if ( !row ) return skeleton;
			row.bytes += skeleton - row.skeleton;
			row.skeleton = skeleton;
			return row.bytes;
		},
		retainCharacterModels( ids ) {
			skeletons.retain( ids );
			commands.push( { kind: "retain", ids } );
		},
		setFootprints( value ) {
			commands.push( { kind: "footprints", value } );
		},
		characterSocket: ( actors, gid, bone, offset ) => skeletons.socket( actors, gid, bone, offset ),
		characterMatrix: ( actors, gid ) => skeletons.matrix( actors, gid ),
		characterLocalMatrix: ( actors, gid, bone ) => skeletons.localMatrix( actors, gid, bone ),
		characterParticleSnapshot( gid ) {
			// The renderer keeps the matrix it last drew the actor at; the
			// last published actors place it the same way.
			const actor = published.find( row => row.gid === gid );
			const matrix = actor ? skeletons.matrix( published, gid ) : null;
			return actor && matrix ? { matrix, regionId: actor.pose.regionId } : null;
		},
		characterParticleTime: gid => particleTimes.get( gid ),
		scenery: () => scenery ?? null,
		presentationNight: () => facts?.night ?? false,
		presentationCamera: () => facts?.camera ?? null,
		audioListener: () => facts?.listener ?? null,
		enchantSparks: () => facts?.enchantSparks ?? false,
		sharedActorRoom: () => facts?.sharedActorRoom ?? false,
		batchedEffects: () => facts?.batchedEffects ?? false,
		vHidesCompanions: () => facts?.vHidesCompanions ?? false,
		dungeonBlockHides( block, activeBlock ) {
			if ( !dungeonVisibility || activeBlock === undefined ) return false;
			const visible = dungeonVisibility[activeBlock];
			return visible !== undefined && !visible.includes( block );
		}
	};
	return {
		renderer,
		/*
		================
		frame

		The main thread's facts for this step; a fact sent only on change
		keeps its last value.
		================
		*/
		frame( value: CharacterWorkerFacts, seconds: number ) {
			facts = value;
			if ( value.scenery !== undefined ) scenery = value.scenery;
			if ( value.dungeonVisibility !== undefined ) dungeonVisibility = value.dungeonVisibility;
			particleTimes = new Map( value.particleTimes );
			skeletons.skeletonFrame( seconds );
		},
		/*
		================
		take

		This step's commands and what they transfer.
		================
		*/
		take() {
			const taken = { commands, transfer };
			commands = [];
			transfer = [];
			return taken;
		},
		/*
		================
		reset

		The presentation's reset publishes no actors; the main thread keeps
		every assembly definition it was sent, as the renderer keeps them.
		================
		*/
		reset() {
			published = [];
		}
	};
}
