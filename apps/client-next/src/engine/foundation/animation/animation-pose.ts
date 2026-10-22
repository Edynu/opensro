/*
===========================================================================

animation-pose.ts - retained character pose sampling, skin palettes and sockets

Owns clip sampling, native event-before-timed blending, and lazy CPU palette
materialization. Direct samples retain exact local inputs in blend scratch;
palette revisions advance only with matrices or radial body shape. Layer
lifetimes belong to the presentation producers; this consumer evaluates every
live fade without truncating sparse bone tracks.
Equipment branches join the socket table without changing explicit private
bone names (A981A0 searches compound branches in order for a marker).

Given a PoseSkeleton, the pose keeps its sampled transforms, blend scratch
and matrices in memory the frame workers share (skeleton-record.ts STATE_*
layout) and materializes through foundation/kernels/skeleton-kernel.ts,
now or in the frame's skeleton phase (renderer/characters/skeletons.ts);
every other rule here is the same code either way. A phase that knows the
palettes will be read on this thread (readsPalettes, or an evaluation the
GPU does not take) writes them too, and palette copies those while they
are current.

===========================================================================
*/
import { createAttachmentBindPose } from "./equipment-sockets";
import { createAnimationTimelines } from "./animation-timelines";
import type { CharacterModel, CharacterPrimitive, CharacterLayer, CharacterClip } from "@/engine/contracts/character";
import { compose, multiplyDisjoint as multiply, multiplyQuaternion, slerp } from "@/engine/foundation/math/pose-math";
import { paletteBindings } from "./palette-bindings";
import { bodyBoneScale } from "./body-shape";
import {
	PALETTES_ALWAYS,
	PALETTES_CHANGED,
	PALETTES_NONE,
	STATE_ANIMATED,
	STATE_CHANGED,
	STATE_COMMITTED,
	STATE_GLOBALS,
	STATE_LOCALS,
	STATE_PASSES,
	STATE_ROTATIONS,
	STATE_SCALES,
	STATE_TRANSLATIONS,
	STATE_WEIGHTS
} from "@/engine/foundation/kernels/skeleton-record";
import { skeletonPalettes } from "@/engine/foundation/kernels/skeleton-kernel";

const DEFAULT_BODY_VOLUME = 2;

/*
================
PoseSkeletonLayer

One layer as the pose resolved it: its clip (undefined for none), clip
time, weight and lane.
================
*/
export interface PoseSkeletonLayer {
	clip: CharacterClip | undefined;
	time: number;
	weight: number;
	lane: "event" | "timed";
}

/*
================
PoseSkeletonInput

One materialization's inputs: the resolved layers, whether a single
full-weight single-track layer samples directly, the bone rotator's node
and quaternion, and the node a dropped rotator held; whether it writes the
palettes (skeleton-record.ts PALETTES_*), the body thickness they use and
that thickness's version, handed back with the result.
================
*/
export interface PoseSkeletonInput {
	layers: readonly PoseSkeletonLayer[];
	direct: boolean;
	rotatedNode: number;
	releasedNode: number;
	readonly rotation: Float32Array;
	palettes: number;
	readonly thickness: Float32Array;
	thicknessVersion: number;
}

/*
================
PoseSkeletonTiming

When a skeleton materializes: "now", a reader needs the matrices; "frame",
an evaluation needs them this frame, in the frame's skeleton phase while
one collects; "spare", an evaluation left them to the GPU, so only while a
phase collects, in case a CPU reader asks.
================
*/
export type PoseSkeletonTiming = "now" | "frame" | "spare";

/*
================
PoseSkeleton

Where a pose's matrices live and what computes them
(renderer/characters/skeletons.ts). state is a fixed view of the pose's
region: 61 floats a node, 4, then the palettes of skeletonBindings
(skeleton-record.ts). materialize computes it from input as timing says
and calls done( changed, paletted, thicknessVersion ) once the matrices
are ready, with the thickness version of the input it materialized.
resetDirect makes the next materialization recompose rather than reuse a
direct sample; release returns the region.
================
*/
export interface PoseSkeleton {
	readonly state: Float32Array;
	materialize(
		input: PoseSkeletonInput,
		done: ( changed: boolean, paletted: boolean, thicknessVersion: number ) => void,
		timing: PoseSkeletonTiming
	): void;
	resetDirect(): void;
	release(): void;
}
/*
================
skeletonBindings

The model's distinct palette bindings (paletteBindings) in primitive
order, as a skeleton writes their palettes; none when a joint is not one
of its nodes.
================
*/
export function skeletonBindings(
	model: CharacterModel,
	bindings: ReturnType<typeof paletteBindings> = paletteBindings( model )
): readonly CharacterPrimitive[] {
	const canonical: CharacterPrimitive[] = [];
	for ( const primitive of model.primitives ) {
		const binding = bindings.get( primitive ) ?? primitive;
		if ( canonical.includes( binding ) ) continue;
		for ( const joint of binding.joints ) {
			if ( !Number.isInteger( joint ) || joint < 0 || joint >= model.nodes.length ) return [];
		}
		canonical.push( binding );
	}
	return canonical;
}

/*
================
createCharacterPose
================
*/
export function createCharacterPose( model: CharacterModel, skeletons?: ( model: CharacterModel ) => PoseSkeleton ) {
	const bindings = paletteBindings( model );
	const skeleton = skeletons?.( model ), count = model.nodes.length;
	/*
	================
	region

	The skeleton's view of one STATE_* array, width floats a node.
	================
	*/
	const region = ( offset: number, width: number ) =>
		skeleton!.state.subarray( count * offset, count * offset + count * width );
	const attachmentBind = createAttachmentBindPose( model.nodes );
	let volume = DEFAULT_BODY_VOLUME, female = false;
	// Body nodes precede attached handles. Keep that compound order for
	// unqualified lookups; explicit branch names stay distinct even when both
	// weapons carry an identically named marker.
	const sockets = new Map<string, number>();
	const equipmentMarker = /^equipment:\d+:[^:]+:(.+)$/;
	for ( let index = 0; index < model.nodes.length; index++ ) {
		const name = model.nodes[index]!.name;
		if ( !sockets.has( name ) ) sockets.set( name, index );
		const marker = equipmentMarker.exec( name )?.[1];
		if ( marker && marker !== "$root" && !sockets.has( marker ) ) sockets.set( marker, index );
	}
	const thickness = new Float32Array( model.nodes.length ).fill( 1 ), radial = new Float32Array( 16 );
	// The skeleton's palettes by binding, as its phase writes them.
	const skeletonPaletteViews = new Map<CharacterPrimitive, Float32Array>();
	if ( skeleton ) {
		let at = skeletonPalettes( count );
		for ( const binding of skeletonBindings( model, bindings ) ) {
			skeletonPaletteViews.set( binding, skeleton.state.subarray( at, at + binding.joints.length * 16 ) );
			at += binding.joints.length * 16;
		}
	}
	const localData = skeleton ? region( STATE_LOCALS, 16 ) : new Float32Array( count * 16 ),
		globalData = skeleton ? region( STATE_GLOBALS, 16 ) : new Float32Array( count * 16 );
	const locals = model.nodes.map( ( _, i ) => localData.subarray( i * 16, i * 16 + 16 ) ),
		globals = model.nodes.map( ( _, i ) => globalData.subarray( i * 16, i * 16 + 16 ) );
	const restTranslations = new Float32Array( model.nodes.flatMap( n => [ ...n.translation ] ) ),
		restRotations = new Float32Array( model.nodes.flatMap( n => [ ...n.rotation ] ) ),
		restScales = new Float32Array( model.nodes.flatMap( n => [ ...n.scale ] ) );
	const translationData = skeleton ? region( STATE_TRANSLATIONS, 3 ) : restTranslations.slice(),
		rotationData = skeleton ? region( STATE_ROTATIONS, 4 ) : restRotations.slice(),
		scaleData = skeleton ? region( STATE_SCALES, 3 ) : restScales.slice();
	if ( skeleton ) {
		translationData.set( restTranslations );
		rotationData.set( restRotations );
		scaleData.set( restScales );
	}
	const translations = model.nodes.map( ( _, i ) => translationData.subarray( i * 3, i * 3 + 3 ) ),
		rotations = model.nodes.map( ( _, i ) => rotationData.subarray( i * 4, i * 4 + 4 ) ),
		scales = model.nodes.map( ( _, i ) => scaleData.subarray( i * 3, i * 3 + 3 ) );
	const inverseViews = new WeakMap<CharacterPrimitive, Float32Array[]>();
	const palettes = new WeakMap<CharacterPrimitive, { version: number; data: Float32Array; }>();
	let poseVersion = 0, paletteVersion = 0;
	const order: number[] = [], visited = new Set<number>();
	/*
================
visit
================
	*/
	function visit( n: number ) {
		if ( visited.has( n ) ) {
			return;
		}
		const parent = model.nodes[n]!.parent;
		if ( parent >= 0 ) {
			visit( parent );
		}
		visited.add( n );
		order.push( n );
	}
	for ( let n = 0; n < model.nodes.length; n++ ) {
		visit( n );
	}
	const animatedLocal = skeleton ? region( STATE_ANIMATED, 1 ) : new Uint8Array( count ),
		changedGlobal = skeleton ? region( STATE_CHANGED, 1 ) : new Uint8Array( count );
	let matricesInitialized = false, directMatrices = false;
	const clips = new Map<string, CharacterClip>();
	const timelines = new Map<CharacterClip, ReturnType<typeof createAnimationTimelines>>();
	// One reusable clip's quaternion brackets, not a cache for every admitted
	// animation. Switching layer clips invalidates this bounded scratch.
	let rotationSamples = new Float64Array(
		model.clips.reduce( ( max, clip ) => Math.max( max, clip.channels.length ), 0 ) * 4
	).fill( NaN );
	let rotationClip: CharacterClip | undefined;
	const singleTrackClips = new Set<CharacterClip>(), gpuClips = new Set<CharacterClip>();
	/*
================
registerClip

The caller owns validation and binding. A catalog entry adds sampling metadata
without changing skeleton storage, the selected layers or their revision.
================
	*/
	function registerClip( clip: CharacterClip ) {
		const paths = new Set<string>();
		let singleTrack = true;
		for ( const channel of clip.channels ) {
			const key = channel.node + ":" + channel.path;
			if ( paths.has( key ) ) singleTrack = false;
			paths.add( key );
			if ( !model.nodes[channel.node]!.matrix ) animatedLocal[channel.node] = 1;
		}
		clips.set( clip.name, clip );
		if ( singleTrack ) singleTrackClips.add( clip );
		if (
			singleTrack && clip.channels.length > 0 &&
			clip.channels.every( channel => channel.interpolation !== "CUBICSPLINE" && channel.times.length > 0 )
		) gpuClips.add( clip );
	}
	for ( const clip of model.clips ) registerClip( clip );
	const passData = skeleton ? region( STATE_PASSES, 10 ) : new Float32Array( count * 10 );
	const pass = model.nodes.map( ( _, i ) => [
		passData.subarray( i * 10, i * 10 + 3 ),
		passData.subarray( i * 10 + 3, i * 10 + 7 ),
		passData.subarray( i * 10 + 7, i * 10 + 10 )
	] );
	const weights = skeleton ? region( STATE_WEIGHTS, 3 ) : new Float32Array( count * 3 ),
		committed = skeleton ? region( STATE_COMMITTED, 3 ) : new Float32Array( count * 3 ),
		sample = new Float32Array( 4 );
	const sample3 = sample.subarray( 0, 3 );
	/*
    ================
    ResolvedLayer
    Validated sampling identity retained between frames.
    ================
    */
	type ResolvedLayer = { clip: CharacterClip | undefined; time: number; weight: number; lane: "event" | "timed"; };
	let resolved: ResolvedLayer[] = [], pendingLayers: ResolvedLayer[] = [], hasPose = false;
	// One CCompChar bone rotator (spine-aim.ts): its node, rotation and whether
	// it changed since the last evaluation. A released node recomposes once.
	const boneRotation = new Float32Array( 4 );
	let rotatedNode = -1, releasedNode = -1, rotationChanged = false;
	let cpuPending = false, cpuEvaluations = 0;
	// Whether this thread reads the palettes whatever the GPU samples, and
	// the palette version the skeleton's palettes are (-1: none). A body
	// volume change after a materialization's inputs leaves its palettes
	// out of date (thicknessVersion).
	let readsPalettes = false, skeletonPaletteVersion = -1, thicknessVersion = 0;
	const sampleRequest = { clip: model.clips[0]!, time: 0 };
	const skeletonInput: PoseSkeletonInput = {
		layers: resolved,
		direct: false,
		rotatedNode: -1,
		releasedNode: -1,
		rotation: boneRotation,
		palettes: PALETTES_NONE,
		thickness,
		thicknessVersion: 0
	};
	/*
================
gpuSample
================
	*/
	function gpuSample(): { readonly clip: CharacterClip; readonly time: number; } | null {
		const layer = resolved[0];
		if (
			volume !== DEFAULT_BODY_VOLUME || resolved.length !== 1 || !layer?.clip || layer.weight !== 1 ||
			!gpuClips.has( layer.clip ) || rotatedNode >= 0
		) return null;
		sampleRequest.clip = layer.clip;
		sampleRequest.time = layer.time;
		return sampleRequest;
	}
	/*
================
sameLocalSample

The direct sampler does not use blend scratch. Compare its retained TRS
words numerically with signed-zero preservation; NaNs always recompute.
================
	*/
	function sameLocalSample( n: number ) {
		for ( let path = 0; path < 3; path++ ) {
			const current = path === 0 ? translations[n]! : path === 1 ? rotations[n]! : scales[n]!;
			const previous = pass[n]![path]!;
			for ( let c = 0; c < current.length; c++ ) {
				const value = current[c]!;
				if ( !Object.is( value, previous[c] ) || Number.isNaN( value ) ) return false;
			}
		}
		return true;
	}
	/*
================
finishSkeleton

The skeleton's materialization is in its state: the tail of materialize.
================
	*/
	function finishSkeleton( changed: boolean, paletted: boolean, materialized: number ) {
		if ( changed ) paletteVersion++;
		if ( paletted && materialized === thicknessVersion ) skeletonPaletteVersion = paletteVersion;
		releasedNode = -1;
		cpuPending = false;
		cpuEvaluations++;
	}
	/*
================
materialize

timing: a reader needs the matrices now; evaluate asks for the frame or,
having left them to the GPU, spare (PoseSkeletonTiming). The pose's own
arrays materialize at once.
================
	*/
	function materialize( timing: PoseSkeletonTiming = "now" ) {
		if ( !cpuPending ) return;
		if ( skeleton ) {
			skeletonInput.layers = resolved;
			skeletonInput.direct = resolved.length === 1 && resolved[0]!.weight === 1 &&
				(!resolved[0]!.clip || singleTrackClips.has( resolved[0]!.clip ));
			skeletonInput.rotatedNode = rotatedNode;
			skeletonInput.releasedNode = releasedNode;
			// The phase writes the palettes this thread will read: the owner's
			// (readsPalettes) or an evaluation the GPU did not take.
			skeletonInput.palettes = !skeletonPaletteViews.size || !readsPalettes && timing !== "frame" ?
				PALETTES_NONE :
				skeletonPaletteVersion === paletteVersion ?
				PALETTES_CHANGED :
				PALETTES_ALWAYS;
			skeletonInput.thicknessVersion = thicknessVersion;
			skeleton.materialize( skeletonInput, finishSkeleton, timing );
			return;
		}
		// A single full-weight pass with one channel per node/path has no
		// blending to accumulate. Sample with the identical interpolation,
		// then commit directly. Layered/duplicate-channel inputs keep the
		// native event-before-timed accumulation below.
		const direct = resolved.length === 1 && resolved[0]!.weight === 1 &&
			(!resolved[0]!.clip || singleTrackClips.has( resolved[0]!.clip ));
		const reuseMatrices = direct && directMatrices;
		// A blended pass overwrites scratch. A failed sample must also leave
		// reuse disabled until a complete materialization publishes new matrices.
		directMatrices = false;
		// Reset contiguous float32 rest poses in three copies instead of
		// three small typed-array calls per node. Channel views stay stable.
		translationData.set( restTranslations );
		rotationData.set( restRotations );
		scaleData.set( restScales );
		if ( !direct ) committed.fill( 0 );
		// CRTBone 0xab56c0 accumulates each pass by w/(sum+w). 0xab5780
		// caps the next pass to remaining headroom; event tracks precede timed tracks.
		for ( let laneIndex = 0; laneIndex < (direct ? 1 : 2); laneIndex++ ) {
			const lane = direct ? resolved[0]!.lane : laneIndex === 0 ? "event" : "timed";
			if ( !direct ) weights.fill( 0 );
			for ( const layer of resolved ) {
				if ( layer.lane !== lane || layer.weight === 0 ) continue;
				const time = layer.time;
				if ( !layer.clip ) continue;
				// Catalog admission can reach every standing peer. Grow scratch
				// only when this pose samples the new clip, after frame admission
				// has charged its updated pose budget.
				if ( rotationSamples.length < layer.clip.channels.length * 4 ) {
					rotationSamples = new Float64Array( layer.clip.channels.length * 4 );
					rotationClip = undefined;
				}
				if ( rotationClip !== layer.clip ) {
					rotationSamples.fill( NaN );
					rotationClip = layer.clip;
				}
				let clocks = timelines.get( layer.clip );
				if ( !clocks ) {
					clocks = createAnimationTimelines( layer.clip );
					timelines.set( layer.clip, clocks );
				}
				clocks.sample( time );
				for ( let channelIndex = 0; channelIndex < layer.clip.channels.length; channelIndex++ ) {
					const channel: CharacterClip["channels"][number] = layer.clip.channels[channelIndex]!;
					const path = channel.path === "translation" ? 0 : channel.path === "rotation" ? 1 : 2,
						width = path === 1 ? 4 : 3;
					// A single full-weight track owns this node/path. Its
					// float32 destination is the sampler output itself.
					const target = direct ?
						(path === 0 ?
							translations[channel.node]! :
							path === 1 ?
							rotations[channel.node]! :
							scales[channel.node]!) :
						width === 4 ?
						sample :
						sample3;
					const { low, next, span, fraction } = clocks.channels[channelIndex]!;
					const values = channel.values;
					if ( channel.interpolation === "CUBICSPLINE" ) {
						const t = fraction, t2 = t * t, t3 = t2 * t;
						for ( let c = 0; c < width; c++ ) {
							target[c] = (2 * t3 - 3 * t2 + 1) * values[(low * 3 + 1) * width + c]! +
								(t3 - 2 * t2 + t) * span * values[(low * 3 + 2) * width + c]! +
								(-2 * t3 + 3 * t2) * values[(next * 3 + 1) * width + c]! +
								(t3 - t2) * span * values[next * 3 * width + c]!;
						}
					} else if ( channel.interpolation === "STEP" || next === low ) {
						for ( let c = 0; c < width; c++ ) target[c] = values[low * width + c]!;
					} else if ( width === 4 ) {
						const at = channelIndex * 4;
						if ( rotationSamples[at] !== low ) {
							let dot = 0;
							for ( let i = 0; i < 4; i++ ) dot += values[low * 4 + i]! * values[next * 4 + i]!;
							const sign = dot < 0 ? -1 : 1;
							dot = Math.min( 1, Math.abs( dot ) );
							const angle = Math.acos( dot );
							rotationSamples[at] = low;
							rotationSamples[at + 1] = sign;
							rotationSamples[at + 2] = angle;
							rotationSamples[at + 3] = Math.sin( angle );
						}
						const sign = rotationSamples[at + 1]!,
							angle = rotationSamples[at + 2]!,
							sin = rotationSamples[at + 3]!;
						const left = sin < 1e-6 ? 1 - fraction : Math.sin( (1 - fraction) * angle ) / sin,
							right = sin < 1e-6 ? fraction : Math.sin( fraction * angle ) / sin;
						for ( let i = 0; i < 4; i++ ) {
							target[i] = values[low * 4 + i]! * left + values[next * 4 + i]! * right * sign;
						}
					} else {
						for ( let c = 0; c < width; c++ ) {
							target[c] = values[low * width + c]! * (1 - fraction) +
								values[next * width + c]! * fraction;
						}
					}
					if ( direct ) continue;
					const index = channel.node * 3 + path;
					const out = pass[channel.node]![path]!, before = weights[index]!, total = before + layer.weight;
					if ( before === 0 ) out.set( target );
					else if ( path === 1 ) slerp( out, target, layer.weight / total, out );
					else {for ( let c = 0; c < width; c++ ) {
							out[c] = out[c]! + (target[c]! - out[c]!) * layer.weight / total;
						}}
					weights[index] = total;
				}
			}
			if ( !direct ) {
				for ( let n = 0; n < model.nodes.length; n++ ) {
					for ( let path = 0; path < 3; path++ ) {
						const index = n * 3 + path, weight = Math.min( weights[index]!, 1 - committed[index]! );
						if ( weight <= 0 ) continue;
						const out = path === 0 ? translations[n]! : path === 1 ? rotations[n]! : scales[n]!,
							value = pass[n]![path]!,
							previous = committed[index]!;
						if ( previous === 0 ) out.set( value );
						else if ( path === 1 ) slerp( out, value, weight / (previous + weight), out );
						else {for ( let c = 0; c < 3; c++ ) {
								out[c] = out[c]! + (value[c]! - out[c]!) * weight / (previous + weight);
							}}
						committed[index] = previous + weight;
					}
				}
			}
		}
		// A9ADD0 multiplies the rotator after the sampled local rotation.
		if ( rotatedNode >= 0 ) {
			multiplyQuaternion( boneRotation, rotations[rotatedNode]!, rotations[rotatedNode]! );
		}
		let matricesChanged = !matricesInitialized;
		for ( const n of order ) {
			const node = model.nodes[n]!;
			let localChanged = !matricesInitialized;
			const rotated = n === rotatedNode || n === releasedNode;
			if ( !matricesInitialized || animatedLocal[n] || rotated ) {
				localChanged = rotated || !reuseMatrices || !sameLocalSample( n );
				if ( localChanged ) {
					if ( node.matrix ) {
						locals[n]!.set( node.matrix );
					} else {
						compose( translations[n]!, rotations[n]!, scales[n]!, locals[n]! );
					}
					if ( direct ) {
						pass[n]![0]!.set( translations[n]! );
						pass[n]![1]!.set( rotations[n]! );
						pass[n]![2]!.set( scales[n]! );
					}
				}
			}
			// Parent-first traversal propagates a changed ancestor through static
			// descendants. Unchanged local and parent bytes imply identical globals.
			const globalChanged = localChanged || (node.parent >= 0 && changedGlobal[node.parent] !== 0);
			changedGlobal[n] = globalChanged ? 1 : 0;
			if ( globalChanged ) {
				if ( node.parent < 0 ) {
					globals[n]!.set( locals[n]! );
				} else {
					multiply( globals[node.parent]!, locals[n]!, globals[n]! );
				}
				matricesChanged = true;
			}
		}
		if ( matricesChanged ) paletteVersion++;
		matricesInitialized = true;
		releasedNode = -1;
		directMatrices = direct;
		cpuPending = false;
		cpuEvaluations++;
	}
	return {
		/*
================
admitClip

Append a validated bound clip without retiring active playback or palettes.
Names are immutable once admitted, matching renderer clip admission. Longer
quaternion scratch is charged and allocated only when playback needs it.
================
		*/
		admitClip( clip: CharacterClip ) {
			if ( clips.has( clip.name ) ) return false;
			registerClip( clip );
			// A newly animated node has no retained direct sample in blend
			// scratch; the next materialization must not compare against it.
			directMatrices = false;
			skeleton?.resetDirect();
			return true;
		},
		/*
        ================
        bodyVolume
        ================
        */
		bodyVolume( index = DEFAULT_BODY_VOLUME, isFemale = false ) {
			if ( volume === index && female === isFemale ) return;
			volume = index;
			female = isFemale;
			poseVersion++;
			paletteVersion++;
			thicknessVersion++;
			for ( let i = 0; i < model.nodes.length; i++ ) {
				thickness[i] = bodyBoneScale( model.nodes[i]!.name, index, isFemale );
			}
		},
		revision: () => poseVersion,
		/*
		================
		readsPalettes

		Whether the owner reads this pose's palettes on this thread even when
		the GPU samples it (a cloth wearer's batch), so the skeleton phase
		writes them.
		================
		*/
		readsPalettes( reads: boolean ) {
			readsPalettes = reads;
		},
		/*
        ================
        setBoneRotation

        Install, update or drop the named bone's rotator rotation (x y z w in
        model space) before the next evaluate. A bone the model lacks is ignored,
        as CAnimTrack_FindMarkerByName fails in A9C370.
        ================
        */
		setBoneRotation( bone: string, rotation: readonly number[] | null ) {
			const node = rotation ? sockets.get( bone ) ?? -1 : -1;
			if ( node < 0 ) {
				if ( rotatedNode < 0 ) return;
				releasedNode = rotatedNode;
				rotatedNode = -1;
				rotationChanged = true;
				return;
			}
			if (
				node === rotatedNode && boneRotation[0] === rotation![0] && boneRotation[1] === rotation![1] &&
				boneRotation[2] === rotation![2] && boneRotation[3] === rotation![3]
			) return;
			if ( rotatedNode >= 0 && rotatedNode !== node ) releasedNode = rotatedNode;
			rotatedNode = node;
			boneRotation.set( rotation! );
			rotationChanged = true;
		},
		/*
        ================
        evaluate
        ================
        */
		evaluate( name: string, seconds: number, loop = true, layers?: readonly CharacterLayer[], defer = false ) {
			// Several independent producers may each retain outgoing 200 ms fades.
			// Their combined population is not bounded by eight. The mixer uses
			// skeleton-sized scratch and must preserve every live sparse track.
			const count = layers?.length ?? 1;
			let changed = !hasPose || count !== resolved.length || rotationChanged;
			for ( let i = 0; i < count; i++ ) {
				const source = layers?.[i],
					clipName = source ? source.clip : name,
					rawTime = source ? source.time : seconds,
					weight = source ? source.weight : 1,
					lane = source ? source.lane : "timed",
					repeat = source ? source.loop : loop;
				if (
					layers && !source || !Number.isFinite( rawTime ) || rawTime < 0 || !Number.isFinite( weight ) ||
					weight < 0 || weight > 1 || (lane !== "event" && lane !== "timed")
				) throw new Error( "Invalid animation layer" );
				const clip = clips.get( clipName );
				if ( !clip && clipName ) throw new Error( `Missing animation ${clipName}` );
				const time = clip?.duration ?
					(repeat ? rawTime % clip.duration : Math.min( rawTime, clip.duration )) :
					0;
				const previous = resolved[i];
				if (
					!previous || previous.clip !== clip || previous.time !== time || previous.weight !== weight ||
					previous.lane !== lane
				) changed = true;
				const pending = pendingLayers[i];
				if ( pending ) {
					pending.clip = clip;
					pending.time = time;
					pending.weight = weight;
					pending.lane = lane;
				} else pendingLayers[i] = { clip, time, weight, lane };
			}
			// Validate the entire request before publishing its identity. A bad
			// later layer must not poison the retained pose or its revision.
			if ( !changed ) {
				if ( !defer ) materialize( "frame" );
				else if ( skeleton ) materialize( "spare" );
				return false;
			}
			pendingLayers.length = count;
			rotationChanged = false;
			const previous = resolved;
			resolved = pendingLayers;
			pendingLayers = previous;
			hasPose = true;
			poseVersion++;
			cpuPending = true;
			if ( !defer || !gpuSample() ) materialize( "frame" );
			else if ( skeleton ) materialize( "spare" );
			return true;
		},
		gpuSample,
		cpuEvaluations: () => cpuEvaluations,
		/*
		================
		release

		Return a skeleton's shared region; the pose is not used after.
		================
		*/
		release() {
			skeleton?.release();
		},
		/*
        ================
        palette
        ================
        */
		palette( primitive: CharacterPrimitive, out: Float32Array, offset = 0 ) {
			materialize();
			primitive = bindings.get( primitive ) ?? primitive;
			const written = skeletonPaletteVersion === paletteVersion ?
				skeletonPaletteViews.get( primitive ) :
				undefined;
			if ( written ) {
				out.set( written, offset );
				return;
			}
			let views = inverseViews.get( primitive );
			if ( !views ) {
				views = Array.from(
					primitive.joints,
					( _, i ) => primitive.inverseBind.subarray( i * 16, i * 16 + 16 )
				);
				inverseViews.set( primitive, views );
			}
			let cached = palettes.get( primitive );
			if ( !cached ) {
				cached = { version: -1, data: new Float32Array( primitive.joints.length * 16 ) };
				palettes.set( primitive, cached );
			}
			if ( cached.version !== paletteVersion ) {
				for ( let i = 0; i < primitive.joints.length; i++ ) {
					const joint = primitive.joints[i]!, factor = thickness[joint]!;
					let matrix = globals[joint]!;
					// AB6B20 scales radial Y/Z rows of the native global matrix,
					// then multiplies inverse bind. Children and sockets stay unchanged.
					if ( factor !== 1 ) {
						radial.set( matrix );
						for ( const n of [ 4, 5, 6, 8, 9, 10 ] ) radial[n]! *= factor;
						matrix = radial;
					}
					multiply( matrix, views[i]!, cached.data, i * 16 );
				}
				cached.version = paletteVersion;
			}
			out.set( cached.data, offset );
		},
		/*
        ================
        socket

        The first compound marker's sampled matrix, or a named private branch
        when the caller supplies an explicit equipment handle.
        ================
        */
		socket( name: string, compound = false ) {
			const index = sockets.get( name );
			if ( index === undefined ) return null;
			// Missing markers fall back to the holder or mount. Their immutable
			// lookup needs no CPU bones; keep a GPU-owned pose lazy until used.
			materialize();
			const current = globals[index]!;
			if ( !compound ) return current.slice();
			// AB58C5..AB5924 cancels bind rotation but copies current world position.
			// The child resource supplies its own import adapter exactly once.
			const rest = attachmentBind( index ), result = current.slice();
			for ( let c = 0; c < 3; c++ ) {
				for ( let r = 0; r < 3; r++ ) {
					result[c * 4 + r] = current[r]! * rest[c]! + current[4 + r]! * rest[4 + c]! +
						current[8 + r]! * rest[8 + c]!;
				}
			}
			return result;
		}
	};
}
