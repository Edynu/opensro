/*
===========================================================================

actor-table.ts - a frame's character actors in shared memory

The character worker (docs/CLIENT_WORKERS_PLAN.md 5.1, 5.11) publishes the
actor and portrait lists the presentation builds into one shared block;
the renderer reads them straight into the rows it keeps per gid
(actor-snapshots.ts), so the lists are neither cloned between threads nor
copied twice. A record is one actor: its numbers as 64-bit words, its
names as shared-strings ids, an absent optional field as a cleared bit.
The writer checks what actor-snapshots.ts checks of a publication before
it writes; the reader updates a row exactly as that file's copy does,
reusing the row's nested storage.

===========================================================================
*/
import type { CharacterActor, CharacterLayer } from "@/engine/contracts/character";
import type { AnimationActivation } from "./animation-activation";
import type { ModelAnimationFrame, ModifierSelector } from "./model-animation";
import type { createStringReader, createStringWriter } from "@/engine/foundation/workers/shared-strings";

type Mutable<T> = { -readonly [K in keyof T]: T[K]; };
type Actor = Mutable<CharacterActor>;

// The block's header: actors, portraits, words used.
const ACTORS = 0;
const PORTRAITS = 1;
const HEADER_WORDS = 3;
const INITIAL_BYTES = 262144;
const MAX_BYTES = 67108864;

// A record's fixed words.
const R_LENGTH = 0;
const R_GID = 1;
const R_MODEL = 2;
const R_CLIP = 3;
const R_TIME = 4;
const R_SCALE = 5;
const R_POSE = 6;
const R_STATES = 11;
const R_PRESENT = 12;
const R_VALUES = 13;

// Two-bit states of the boolean fields: absent, false, true.
const STATE_FIELDS = [
	"loop",
	"groundItem",
	"shadowAttachment",
	"blindable",
	"blindableCompanion",
	"drawGeometry",
	"absoluteEffectScale",
	"pickable",
	"pickWhenFiltered",
	"effectEntity"
] as const;
// Optional numbers, one presence bit each, in this order.
const NUMBER_FIELDS = [
	"shadowSize",
	"modifierId",
	"heightFactor",
	"effectBaseScale",
	"emissionEnd",
	"height",
	"pickOwner",
	"dungeonBlock",
	"opacity",
	"mountedOn"
] as const;
// Optional structures, one presence bit each after the numbers.
const P_PREVIEW_CLIP = 1024;
const P_MODEL_ANIMATION = 2048;
const P_ANIMATION_LOD = 4096;
const P_DEFERRED = 8192;
const P_POINT_LIGHT = 16384;
const P_BLOOD = 32768;
const P_EFFECT_BASIS = 65536;
const P_TINT = 131072;
const P_EFFECT_ROTATION = 262144;
const P_EFFECT_ANCHOR = 524288;
const P_BODY_VOLUME = 1048576;
const P_LAYERS = 2097152;
const P_BONE_ROTATION = 4194304;
const P_ATTACHMENT = 8388608;

const AXES = [ "x", "y", "z" ] as const;
// An attachment's basis by its word; null is an absent one.
const BASES = [ null, "native", "native-bsr", "bsr", "compound" ] as const;
// A null name (bloodEffects, effectAnchor.bone).
const NO_STRING = -1;

/*
================
createActorTable
================
*/
export function createActorTable(): SharedArrayBuffer {
	return new SharedArrayBuffer( INITIAL_BYTES, { maxByteLength: MAX_BYTES } );
}

/*
================
tri

A boolean field's two-bit state.
================
*/
function tri( value: boolean | undefined ): number {
	return value === undefined ? 0 : value ? 2 : 1;
}

/*
================
untri
================
*/
function untri( state: number ): boolean | undefined {
	return state === 0 ? undefined : state === 2;
}

/*
================
checkPublication

What actor-snapshots.ts update refuses of a publication, refused here
before anything is written.
================
*/
function checkPublication( value: readonly CharacterActor[] ) {
	const seen = new Set<number>();
	for ( const actor of value ) {
		const deferred = actor.deferredParticle;
		if (
			deferred &&
			(!Number.isInteger( deferred.offset ) || deferred.offset < 0 || deferred.offset > 255 ||
				deferred.nightOnly !== undefined && typeof deferred.nightOnly !== "boolean" ||
				deferred.lodHidden !== undefined && typeof deferred.lodHidden !== "boolean")
		) throw Error( "Invalid deferred particle descriptor" );
	}
	for ( const actor of value ) {
		if (
			actor.animationLod &&
			(!Number.isFinite( actor.animationLod.fraction ) || actor.animationLod.fraction < 0 ||
				actor.animationLod.fraction > 1 || typeof actor.animationLod.crowded !== "boolean")
		) throw Error( "Invalid animation LOD" );
		if ( actor.modifierId !== undefined && !Number.isSafeInteger( actor.modifierId ) ) {
			throw Error( "Invalid modifier owner" );
		}
		const rotation = actor.attachment?.rotation;
		if (
			rotation &&
			(!(rotation instanceof Float32Array) || rotation.length !== 16 || !rotation.every( Number.isFinite ))
		) throw Error( "Invalid particle attachment rotation" );
		const light = actor.pointLight;
		if (
			light &&
			(![ light.attenuation, light.range, ...light.ambient, ...light.diffuse ].every( Number.isFinite ) ||
				!Object.values( light.pose ).every( Number.isFinite ))
		) throw Error( "Invalid character point light" );
		if (
			actor.materialTint &&
			(actor.materialTint.length !== 3 || actor.materialTint.some( v => !Number.isFinite( v ) || v < 0 || v > 1 ))
		) throw Error( "Invalid character material tint" );
		if (
			actor.emissionEnd !== undefined && (!Number.isFinite( actor.emissionEnd ) || actor.emissionEnd < 0)
		) throw Error( "Invalid effect emission end" );
		if (
			actor.bodyVolume &&
			(!Number.isFinite( actor.bodyVolume.index ) || actor.bodyVolume.index < 0 || actor.bodyVolume.index > 4 ||
				typeof actor.bodyVolume.female !== "boolean")
		) throw Error( "Invalid character volume" );
		if (
			actor.opacity !== undefined && (!Number.isFinite( actor.opacity ) || actor.opacity < 0 || actor.opacity > 1)
		) throw Error( "Invalid character opacity" );
		if ( seen.has( actor.gid ) ) throw Error( "Character identity violation" );
		seen.add( actor.gid );
	}
}

/*
================
emptyActorRow

A row for gid with every field of CharacterActor present, in one order,
so the rows the table fills share one shape (actor-snapshots.ts).
================
*/
export function emptyActorRow( gid: number, model: string ): Actor {
	return {
		gid,
		model,
		clip: "",
		time: 0,
		loop: false,
		scale: 1,
		pose: { regionId: 0, x: 0, y: 0, z: 0, yaw: 0 as CharacterActor["pose"]["yaw"] },
		groundItem: undefined,
		shadowAttachment: undefined,
		blindable: undefined,
		blindableCompanion: undefined,
		drawGeometry: undefined,
		absoluteEffectScale: undefined,
		pickable: undefined,
		pickWhenFiltered: undefined,
		effectEntity: undefined,
		shadowSize: undefined,
		modifierId: undefined,
		heightFactor: undefined,
		effectBaseScale: undefined,
		emissionEnd: undefined,
		height: undefined,
		pickOwner: undefined,
		dungeonBlock: undefined,
		opacity: undefined,
		mountedOn: undefined,
		previewClip: undefined,
		modelAnimation: undefined,
		animationLod: undefined,
		deferredParticle: undefined,
		pointLight: undefined,
		bloodEffects: undefined,
		effectBasis: undefined,
		materialTint: undefined,
		effectRotation: undefined,
		effectAnchor: undefined,
		bodyVolume: undefined,
		layers: undefined,
		boneRotation: undefined,
		attachment: undefined
	};
}

/*
================
createActorTableWriter

The worker's side: write publishes a frame's actors and portraits.
================
*/
export function createActorTableWriter( block: SharedArrayBuffer, strings: ReturnType<typeof createStringWriter> ) {
	// Length-tracking: follows the block as it grows.
	const words = new Float64Array( block );
	let at = HEADER_WORDS;
	const room = ( count: number ) => {
		const bytes = (at + count) * 8;
		if ( bytes <= block.byteLength ) return;
		if ( bytes > block.maxByteLength ) throw Error( "Shared actor table exceeds its budget" );
		block.grow( Math.min( block.maxByteLength, Math.max( bytes, block.byteLength * 2 ) ) );
	};
	const name = ( value: string | null ) => value === null ? NO_STRING : strings.intern( value );
	const selector = ( value: ModifierSelector ) => {
		room( 3 );
		words[at++] = strings.intern( value.set );
		words[at++] = value.state;
		words[at++] = tri( value.override );
	};
	/*
	================
	record
	================
	*/
	const record = ( actor: CharacterActor ) => {
		const start = at;
		room( R_VALUES );
		words[at + R_GID] = actor.gid;
		words[at + R_MODEL] = strings.intern( actor.model );
		words[at + R_CLIP] = strings.intern( actor.clip );
		words[at + R_TIME] = actor.time;
		words[at + R_SCALE] = actor.scale;
		words[at + R_POSE] = actor.pose.regionId;
		words[at + R_POSE + 1] = actor.pose.x;
		words[at + R_POSE + 2] = actor.pose.y;
		words[at + R_POSE + 3] = actor.pose.z;
		words[at + R_POSE + 4] = actor.pose.yaw;
		let states = 0, present = 0;
		for ( let i = 0; i < STATE_FIELDS.length; i++ ) states |= tri( actor[STATE_FIELDS[i]!] ) << i * 2;
		words[at + R_STATES] = states;
		at += R_VALUES;
		for ( let i = 0; i < NUMBER_FIELDS.length; i++ ) {
			const value = actor[NUMBER_FIELDS[i]!];
			if ( value === undefined ) continue;
			present |= 1 << i;
			room( 1 );
			words[at++] = value;
		}
		if ( actor.previewClip !== undefined ) {
			present |= P_PREVIEW_CLIP;
			room( 1 );
			words[at++] = strings.intern( actor.previewClip );
		}
		const animation = actor.modelAnimation;
		if ( animation ) {
			present |= P_MODEL_ANIMATION;
			room( 2 );
			words[at++] = animation.revision;
			words[at++] = animation.selected ? 1 : 0;
			if ( animation.selected ) selector( animation.selected );
			room( 1 );
			words[at++] = animation.restarted.length;
			for ( const row of animation.restarted ) selector( row );
			room( 1 );
			words[at++] = animation.dispatch.length;
			for ( const row of animation.dispatch ) {
				selector( row.selector );
				room( 1 + row.ranges.length * 2 );
				words[at++] = row.ranges.length;
				for ( const range of row.ranges ) {
					words[at++] = range[0];
					words[at++] = range[1];
				}
			}
		}
		if ( actor.animationLod ) {
			present |= P_ANIMATION_LOD;
			room( 3 );
			words[at++] = actor.animationLod.fraction;
			words[at++] = actor.animationLod.crowded ? 1 : 0;
			words[at++] = tri( actor.animationLod.optional );
		}
		if ( actor.deferredParticle ) {
			present |= P_DEFERRED;
			room( 3 );
			words[at++] = actor.deferredParticle.offset;
			words[at++] = tri( actor.deferredParticle.nightOnly );
			words[at++] = tri( actor.deferredParticle.lodHidden );
		}
		const light = actor.pointLight;
		if ( light ) {
			present |= P_POINT_LIGHT;
			room( 12 );
			words[at++] = light.pose.regionId;
			words[at++] = light.pose.x;
			words[at++] = light.pose.y;
			words[at++] = light.pose.z;
			for ( let i = 0; i < 3; i++ ) words[at++] = light.ambient[i]!;
			for ( let i = 0; i < 3; i++ ) words[at++] = light.diffuse[i]!;
			words[at++] = light.attenuation;
			words[at++] = light.range;
		}
		if ( actor.bloodEffects ) {
			present |= P_BLOOD;
			room( 2 );
			words[at++] = name( actor.bloodEffects[0] );
			words[at++] = name( actor.bloodEffects[1] );
		}
		if ( actor.effectBasis ) {
			present |= P_EFFECT_BASIS;
			room( 9 );
			for ( let i = 0; i < 9; i++ ) words[at++] = actor.effectBasis[i]!;
		}
		if ( actor.materialTint ) {
			present |= P_TINT;
			room( 3 );
			for ( let i = 0; i < 3; i++ ) words[at++] = actor.materialTint[i]!;
		}
		if ( actor.effectRotation ) {
			present |= P_EFFECT_ROTATION;
			room( 2 );
			words[at++] = AXES.indexOf( actor.effectRotation.axis );
			words[at++] = actor.effectRotation.angle;
		}
		if ( actor.effectAnchor ) {
			present |= P_EFFECT_ANCHOR;
			room( 4 );
			words[at++] = name( actor.effectAnchor.bone );
			for ( let i = 0; i < 3; i++ ) words[at++] = actor.effectAnchor.offset[i]!;
		}
		if ( actor.bodyVolume ) {
			present |= P_BODY_VOLUME;
			room( 2 );
			words[at++] = actor.bodyVolume.index;
			words[at++] = actor.bodyVolume.female ? 1 : 0;
		}
		if ( actor.layers ) {
			present |= P_LAYERS;
			room( 1 + actor.layers.length * 7 );
			words[at++] = actor.layers.length;
			for ( const layer of actor.layers ) {
				words[at++] = strings.intern( layer.clip );
				words[at++] = layer.time;
				words[at++] = layer.loop ? 1 : 0;
				words[at++] = layer.weight;
				words[at++] = layer.lane === "event" ? 0 : 1;
				words[at++] = layer.rate === undefined ? 0 : 1;
				words[at++] = layer.rate ?? 0;
				room( 2 );
				words[at++] = layer.activation ? 1 : 0;
				words[at++] = layer.activation?.started ?? 0;
			}
		}
		if ( actor.boneRotation ) {
			present |= P_BONE_ROTATION;
			room( 5 );
			words[at++] = strings.intern( actor.boneRotation.bone );
			for ( let i = 0; i < 4; i++ ) words[at++] = actor.boneRotation.rotation[i]!;
		}
		const attachment = actor.attachment;
		if ( attachment ) {
			present |= P_ATTACHMENT;
			room( 13 + 16 );
			words[at++] = attachment.gid;
			words[at++] = strings.intern( attachment.bone );
			for ( let i = 0; i < 3; i++ ) words[at++] = attachment.offset[i]!;
			words[at++] = tri( attachment.rootIfMissing );
			words[at++] = tri( attachment.root );
			words[at++] = tri( attachment.keepRotation );
			words[at++] = tri( attachment.ground );
			words[at++] = BASES.indexOf( attachment.basis ?? null );
			words[at++] = attachment.modelScale === undefined ? NaN : attachment.modelScale;
			words[at++] = attachment.modelScale === undefined ? 0 : 1;
			words[at++] = attachment.facing === undefined ? 0 : 1;
			words[at++] = attachment.facing ?? 0;
			words[at++] = attachment.rotation ? 1 : 0;
			if ( attachment.rotation ) { for ( let i = 0; i < 16; i++ ) words[at++] = attachment.rotation[i]!; }
		}
		words[start + R_PRESENT] = present;
		words[start + R_LENGTH] = at - start;
	};
	return {
		/*
		================
		write

		One frame's lists; read after the output counter publishes them.
		================
		*/
		write( actors: readonly CharacterActor[], portraits: readonly CharacterActor[] ) {
			checkPublication( actors );
			checkPublication( portraits );
			at = HEADER_WORDS;
			for ( const actor of actors ) record( actor );
			for ( const actor of portraits ) record( actor );
			words[ACTORS] = actors.length;
			words[PORTRAITS] = portraits.length;
			words[2] = at;
		}
	};
}

/*
================
createActorTableReader

The main thread's side: the lists' records in order, each read into a row.
================
*/
export function createActorTableReader( block: SharedArrayBuffer, strings: ReturnType<typeof createStringReader> ) {
	const words = new Float64Array( block );
	let at = 0;
	const name = ( id: number ) => id === NO_STRING ? null : strings.text( id );
	const selector = (): ModifierSelector => {
		const set = strings.text( words[at++]! ), state = words[at++]!, override = untri( words[at++]! );
		return override === undefined ? { set, state } : { set, state, override };
	};
	return {
		/*
		================
		count

		The actors (list 0) or portraits (list 1) the last write holds.
		================
		*/
		count: ( list: 0 | 1 ) => words[list === 0 ? ACTORS : PORTRAITS]!,
		/*
		================
		first

		The offset of a list's first record.
		================
		*/
		first( list: 0 | 1 ): number {
			let offset = HEADER_WORDS;
			if ( list === 1 ) { for ( let i = 0; i < words[ACTORS]!; i++ ) offset += words[offset + R_LENGTH]!; }
			return offset;
		},
		next: ( offset: number ) => offset + words[offset + R_LENGTH]!,
		gid: ( offset: number ) => words[offset + R_GID]!,
		model: ( offset: number ) => strings.text( words[offset + R_MODEL]! ),
		/*
		================
		read

		Bring row up to the record at offset, as actor-snapshots.ts copy
		brings it up to a published actor: every field written, absent ones
		cleared, nested storage the row owns reused.
		================
		*/
		read( offset: number, row: Actor ) {
			row.gid = words[offset + R_GID]!;
			row.model = strings.text( words[offset + R_MODEL]! );
			row.clip = strings.text( words[offset + R_CLIP]! );
			row.time = words[offset + R_TIME]!;
			row.scale = words[offset + R_SCALE]!;
			const pose = row.pose as Mutable<CharacterActor["pose"]>;
			pose.regionId = words[offset + R_POSE]!;
			pose.x = words[offset + R_POSE + 1]!;
			pose.y = words[offset + R_POSE + 2]!;
			pose.z = words[offset + R_POSE + 3]!;
			pose.yaw = words[offset + R_POSE + 4]! as CharacterActor["pose"]["yaw"];
			// Each field by name, not by a loop over names: the row's every
			// store stays monomorphic. States are two bits a field in
			// STATE_FIELDS' order, presence a bit in NUMBER_FIELDS' order.
			const states = words[offset + R_STATES]!, present = words[offset + R_PRESENT]!;
			row.loop = (states & 3) === 2;
			row.groundItem = untri( states >>> 2 & 3 );
			row.shadowAttachment = untri( states >>> 4 & 3 );
			row.blindable = untri( states >>> 6 & 3 );
			row.blindableCompanion = untri( states >>> 8 & 3 );
			row.drawGeometry = untri( states >>> 10 & 3 );
			row.absoluteEffectScale = untri( states >>> 12 & 3 );
			row.pickable = untri( states >>> 14 & 3 );
			row.pickWhenFiltered = untri( states >>> 16 & 3 );
			row.effectEntity = untri( states >>> 18 & 3 );
			at = offset + R_VALUES;
			row.shadowSize = present & 1 ? words[at++]! : undefined;
			row.modifierId = present & 2 ? words[at++]! : undefined;
			row.heightFactor = present & 4 ? words[at++]! : undefined;
			row.effectBaseScale = present & 8 ? words[at++]! : undefined;
			row.emissionEnd = present & 16 ? words[at++]! : undefined;
			row.height = present & 32 ? words[at++]! : undefined;
			row.pickOwner = present & 64 ? words[at++]! : undefined;
			row.dungeonBlock = present & 128 ? words[at++]! : undefined;
			row.opacity = present & 256 ? words[at++]! : undefined;
			row.mountedOn = present & 512 ? words[at++]! : undefined;
			row.previewClip = present & P_PREVIEW_CLIP ? strings.text( words[at++]! ) : undefined;
			if ( present & P_MODEL_ANIMATION ) {
				const revision = words[at++]!, selected = words[at++] ? selector() : null;
				const restarted: ModifierSelector[] = new Array( words[at++]! );
				for ( let i = 0; i < restarted.length; i++ ) restarted[i] = selector();
				const dispatch: Mutable<ModelAnimationFrame["dispatch"][number]>[] = new Array( words[at++]! );
				for ( let i = 0; i < dispatch.length; i++ ) {
					const owner = selector(), ranges: (readonly [number, number])[] = new Array( words[at++]! );
					for ( let r = 0; r < ranges.length; r++ ) ranges[r] = [ words[at++]!, words[at++]! ];
					dispatch[i] = { selector: owner, ranges };
				}
				row.modelAnimation = { selected, revision, restarted, dispatch };
			} else row.modelAnimation = undefined;
			if ( present & P_ANIMATION_LOD ) {
				const fraction = words[at++]!, crowded = words[at++] === 1, optional = untri( words[at++]! );
				row.animationLod = optional === undefined ? { fraction, crowded } : { fraction, crowded, optional };
			} else row.animationLod = undefined;
			if ( present & P_DEFERRED ) {
				const offsetValue = words[at++]!, nightOnly = untri( words[at++]! ), lodHidden = untri( words[at++]! );
				row.deferredParticle = {
					offset: offsetValue,
					...(nightOnly === undefined ? {} : { nightOnly }),
					...(lodHidden === undefined ? {} : { lodHidden })
				};
			} else row.deferredParticle = undefined;
			if ( present & P_POINT_LIGHT ) {
				const old = row.pointLight as Mutable<NonNullable<CharacterActor["pointLight"]>> | undefined;
				const light = old ?? {
					pose: { regionId: 0, x: 0, y: 0, z: 0 },
					ambient: [ 0, 0, 0 ],
					diffuse: [ 0, 0, 0 ],
					attenuation: 0,
					range: 0
				};
				const lightPose = light.pose as Mutable<typeof light.pose>;
				lightPose.regionId = words[at++]!;
				lightPose.x = words[at++]!;
				lightPose.y = words[at++]!;
				lightPose.z = words[at++]!;
				const ambient = light.ambient as [number, number, number],
					diffuse = light.diffuse as [number, number, number];
				for ( let i = 0; i < 3; i++ ) ambient[i] = words[at++]!;
				for ( let i = 0; i < 3; i++ ) diffuse[i] = words[at++]!;
				light.attenuation = words[at++]!;
				light.range = words[at++]!;
				row.pointLight = light;
			} else row.pointLight = undefined;
			if ( present & P_BLOOD ) {
				const blood = (row.bloodEffects ?? [ null, null ]) as [string | null, string | null];
				blood[0] = name( words[at++]! );
				blood[1] = name( words[at++]! );
				row.bloodEffects = blood;
			} else row.bloodEffects = undefined;
			if ( present & P_EFFECT_BASIS ) {
				const basis = (row.effectBasis ?? new Array( 9 ).fill( 0 )) as number[];
				for ( let i = 0; i < 9; i++ ) basis[i] = words[at++]!;
				row.effectBasis = basis as unknown as CharacterActor["effectBasis"];
			} else row.effectBasis = undefined;
			if ( present & P_TINT ) {
				const tint = (row.materialTint ?? [ 0, 0, 0 ]) as [number, number, number];
				for ( let i = 0; i < 3; i++ ) tint[i] = words[at++]!;
				row.materialTint = tint;
			} else row.materialTint = undefined;
			if ( present & P_EFFECT_ROTATION ) {
				const axis = AXES[words[at++]!]!, angle = words[at++]!;
				if ( row.effectRotation ) Object.assign( row.effectRotation, { axis, angle } );
				else row.effectRotation = { axis, angle };
			} else row.effectRotation = undefined;
			if ( present & P_EFFECT_ANCHOR ) {
				const bone = name( words[at++]! );
				const anchor = (row.effectAnchor ?? { bone, offset: [ 0, 0, 0 ] }) as Mutable<
					NonNullable<CharacterActor["effectAnchor"]>
				>;
				anchor.bone = bone;
				const anchorOffset = anchor.offset as [number, number, number];
				for ( let i = 0; i < 3; i++ ) anchorOffset[i] = words[at++]!;
				row.effectAnchor = anchor;
			} else row.effectAnchor = undefined;
			if ( present & P_BODY_VOLUME ) {
				row.bodyVolume = { index: words[at++]!, female: words[at++] === 1 };
			} else row.bodyVolume = undefined;
			if ( present & P_LAYERS ) {
				const count = words[at++]!, layers = (row.layers ?? []) as Mutable<CharacterLayer>[];
				for ( let i = 0; i < count; i++ ) {
					const clip = strings.text( words[at++]! ), time = words[at++]!, loop = words[at++] === 1;
					const weight = words[at++]!, lane = words[at++] === 0 ? "event" : "timed";
					const rated = words[at++] === 1, rate = words[at++]!;
					const activated = words[at++] === 1, started = words[at++]!;
					const owned = layers[i];
					// One activation token a start (the presentation's identity per layer
					// start); the renderer only passes it on.
					const activation = !activated ?
						undefined :
						owned?.activation?.started === started ?
						owned.activation :
						Object.freeze( { started } ) as AnimationActivation;
					if ( owned ) {
						owned.clip = clip;
						owned.time = time;
						owned.loop = loop;
						owned.weight = weight;
						owned.lane = lane;
						owned.activation = activation;
						owned.rate = rated ? rate : undefined;
					} else layers[i] = { rate: rated ? rate : undefined, clip, time, loop, weight, lane, activation };
				}
				layers.length = count;
				row.layers = layers;
			} else row.layers = undefined;
			if ( present & P_BONE_ROTATION ) {
				const bone = strings.text( words[at++]! );
				const owned = row.boneRotation as Mutable<NonNullable<CharacterActor["boneRotation"]>> | undefined;
				const rotation = (owned?.rotation ?? [ 0, 0, 0, 0 ]) as [number, number, number, number];
				for ( let i = 0; i < 4; i++ ) rotation[i] = words[at++]!;
				if ( owned ) owned.bone = bone;
				else row.boneRotation = { bone, rotation };
			} else row.boneRotation = undefined;
			if ( present & P_ATTACHMENT ) {
				const gid = words[at++]!, bone = strings.text( words[at++]! );
				const old = row.attachment as Mutable<NonNullable<CharacterActor["attachment"]>> | undefined;
				const attachment = old ?? {
					gid,
					bone,
					offset: [ 0, 0, 0 ],
					rootIfMissing: undefined,
					root: undefined,
					basis: undefined,
					keepRotation: undefined,
					modelScale: undefined,
					rotation: undefined,
					facing: undefined,
					ground: undefined
				};
				attachment.gid = gid;
				attachment.bone = bone;
				const attachmentOffset = attachment.offset as [number, number, number];
				for ( let i = 0; i < 3; i++ ) attachmentOffset[i] = words[at++]!;
				attachment.rootIfMissing = untri( words[at++]! );
				attachment.root = untri( words[at++]! );
				attachment.keepRotation = untri( words[at++]! );
				attachment.ground = untri( words[at++]! );
				attachment.basis = BASES[words[at++]!] ?? undefined;
				const modelScale = words[at++]!, scaled = words[at++] === 1;
				attachment.modelScale = scaled ? modelScale : undefined;
				const faced = words[at++] === 1, facing = words[at++]!;
				attachment.facing = faced ? facing as NonNullable<typeof attachment.facing> : undefined;
				if ( words[at++] === 1 ) {
					const rotation = old?.rotation ?? new Float32Array( 16 );
					for ( let i = 0; i < 16; i++ ) rotation[i] = words[at++]!;
					attachment.rotation = rotation;
				} else attachment.rotation = undefined;
				row.attachment = attachment;
			} else row.attachment = undefined;
		}
	};
}
