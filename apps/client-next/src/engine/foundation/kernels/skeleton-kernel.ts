/*
===========================================================================

skeleton-kernel.ts - one character pose's matrices, on flat memory

animation-pose.ts materialize ported onto one pose's record
(skeleton-record.ts), so any thread can run it: reset the rest pose,
sample each layer's clip (event lane, then timed), blend by weight with
the remaining headroom, apply the bone rotator, then compose each changed
local matrix and multiply globals parent first.

Every expression keeps the object code's operation order and float32
stores, and the pose math (pose-math.ts compose, multiplyDisjoint, slerp,
multiplyQuaternion) is repeated here on offsets with the same arithmetic,
so the matrices are the same bits (skeleton-kernel.test.mjs drives both).
A key clock's cached bracket and a channel's quaternion bracket only
shorten a search or skip a recomputation; their results do not depend on
them. Allocation-free and restartable (skeleton-record.ts R_BUSY).

===========================================================================
*/
import { hypot4 } from "@/engine/foundation/math/hypot";
import {
	CLIP_CHANNEL,
	CLIP_CHANNELS,
	CLIP_HEADER,
	CLIP_TIMELINE,
	CLIP_TIMELINES,
	INTERPOLATION_CUBIC,
	INTERPOLATION_STEP,
	LANE_EVENT,
	LANE_TIMED,
	LAYER_WORDS,
	PATH_ROTATION,
	PATH_TRANSLATION,
	R_BUSY,
	R_CACHE_CLIP,
	R_CHANGED,
	R_CHANNEL_CAPACITY,
	R_DIRECT,
	R_DIRECT_MATRICES,
	R_INITIALIZED,
	R_LAYER_CAPACITY,
	R_LAYERS,
	R_MODEL,
	R_RELEASED,
	R_ROTATED,
	R_ROTATION,
	R_SCRATCH,
	R_STATE,
	SKELETON_RECORD,
	STATE_ANIMATED,
	STATE_CHANGED,
	STATE_COMMITTED,
	STATE_GLOBALS,
	STATE_LOCALS,
	STATE_PASSES,
	STATE_ROTATIONS,
	STATE_SAMPLE,
	STATE_SCALES,
	STATE_TRANSLATIONS,
	STATE_WEIGHTS,
	S_HEADER,
	S_NODES
} from "./skeleton-record";

/*
================
SkeletonViews

The tables the skeleton kernel reads and writes (frame-kernels.ts).
================
*/
export interface SkeletonViews {
	readonly skeletonModels: Float64Array;
	readonly skeletonClips: Float64Array;
	readonly skeletonKeys: Float32Array;
	readonly skeletonRecords: Float64Array;
	readonly skeletonScratch: Float64Array;
	readonly skeletonState: Float32Array;
}

/*
================
skeletonModelWords

Doubles a skeleton of nodes takes in skeletonModels.
================
*/
export function skeletonModelWords( nodes: number ): number {
	return S_HEADER + nodes * 29;
}

/*
================
skeletonStateFloats

Floats a pose of nodes takes in skeletonState.
================
*/
export function skeletonStateFloats( nodes: number ): number {
	return nodes * STATE_SAMPLE + 4;
}

/*
================
skeletonScratchWords

Doubles a pose's scratch takes for its layers, channels and key clocks.
================
*/
export function skeletonScratchWords( layers: number, channels: number, clocks: number ): number {
	return layers * LAYER_WORDS + channels * 4 + clocks * 4;
}

/*
================
composeAt

pose-math.ts compose: out = T * R(q) * S, q normalized.
================
*/
function composeAt( s: Float32Array, t: number, q: number, sc: number, out: number ) {
	const length = hypot4( s[q]!, s[q + 1]!, s[q + 2]!, s[q + 3]! );
	if ( length < 1e-12 ) throw new Error( "Invalid pose quaternion" );
	const x = s[q]! / length, y = s[q + 1]! / length, z = s[q + 2]! / length, w = s[q + 3]! / length;
	const sx = s[sc]!, sy = s[sc + 1]!, sz = s[sc + 2]!, tx = s[t]!, ty = s[t + 1]!, tz = s[t + 2]!;
	s[out] = (1 - 2 * (y * y + z * z)) * sx;
	s[out + 1] = 2 * (x * y + z * w) * sx;
	s[out + 2] = 2 * (x * z - y * w) * sx;
	s[out + 3] = 0;
	s[out + 4] = 2 * (x * y - z * w) * sy;
	s[out + 5] = (1 - 2 * (x * x + z * z)) * sy;
	s[out + 6] = 2 * (y * z + x * w) * sy;
	s[out + 7] = 0;
	s[out + 8] = 2 * (x * z + y * w) * sz;
	s[out + 9] = 2 * (y * z - x * w) * sz;
	s[out + 10] = (1 - 2 * (x * x + y * y)) * sz;
	s[out + 11] = 0;
	s[out + 12] = tx;
	s[out + 13] = ty;
	s[out + 14] = tz;
	s[out + 15] = 1;
}

/*
================
multiplyAt

pose-math.ts multiplyDisjoint: out = a * b, out apart from both.
================
*/
function multiplyAt( s: Float32Array, a: number, b: number, out: number ) {
	const a0 = s[a]!, a1 = s[a + 1]!, a2 = s[a + 2]!, a3 = s[a + 3]!, a4 = s[a + 4]!, a5 = s[a + 5]!, a6 = s[a + 6]!;
	const a7 = s[a + 7]!, a8 = s[a + 8]!, a9 = s[a + 9]!, a10 = s[a + 10]!, a11 = s[a + 11]!, a12 = s[a + 12]!;
	const a13 = s[a + 13]!, a14 = s[a + 14]!, a15 = s[a + 15]!;
	for ( let c = 0; c < 4; c++ ) {
		const at = c * 4, b0 = s[b + at]!, b1 = s[b + at + 1]!, b2 = s[b + at + 2]!, b3 = s[b + at + 3]!;
		const to = out + at;
		s[to] = ((0 + a0 * b0 + a4 * b1) + a8 * b2) + a12 * b3;
		s[to + 1] = ((0 + a1 * b0 + a5 * b1) + a9 * b2) + a13 * b3;
		s[to + 2] = ((0 + a2 * b0 + a6 * b1) + a10 * b2) + a14 * b3;
		s[to + 3] = ((0 + a3 * b0 + a7 * b1) + a11 * b2) + a15 * b3;
	}
}

/*
================
slerpAt

pose-math.ts slerp; out may be a.
================
*/
function slerpAt( s: Float32Array, a: number, b: number, t: number, out: number ) {
	let dot = 0;
	for ( let i = 0; i < 4; i++ ) dot += s[a + i]! * s[b + i]!;
	const sign = dot < 0 ? -1 : 1;
	dot = Math.min( 1, Math.abs( dot ) );
	const angle = Math.acos( dot ),
		sin = Math.sin( angle ),
		left = sin < 1e-6 ? 1 - t : Math.sin( (1 - t) * angle ) / sin,
		right = sin < 1e-6 ? t : Math.sin( t * angle ) / sin;
	for ( let i = 0; i < 4; i++ ) s[out + i] = s[a + i]! * left + s[b + i]! * right * sign;
}

/*
================
sameLocalSample

The node's sampled translation, rotation and scale equal its last direct
pass, signed zeros apart and NaN never equal.
================
*/
function sameLocalSample( s: Float32Array, base: number, n: number, node: number ): boolean {
	const passes = base + n * STATE_PASSES + node * 10;
	for ( let c = 0; c < 3; c++ ) {
		const value = s[base + n * STATE_TRANSLATIONS + node * 3 + c]!;
		if ( !Object.is( value, s[passes + c] ) || Number.isNaN( value ) ) return false;
	}
	for ( let c = 0; c < 4; c++ ) {
		const value = s[base + n * STATE_ROTATIONS + node * 4 + c]!;
		if ( !Object.is( value, s[passes + 3 + c] ) || Number.isNaN( value ) ) return false;
	}
	for ( let c = 0; c < 3; c++ ) {
		const value = s[base + n * STATE_SCALES + node * 3 + c]!;
		if ( !Object.is( value, s[passes + 7 + c] ) || Number.isNaN( value ) ) return false;
	}
	return true;
}

/*
================
sampleClock

createAnimationTimelines sample for one key clock: the bracket around time
(low, next, span, fraction) into scratch at at. The cached low only skips
the search when it still brackets time.
================
*/
function sampleClock(
	keys: Float32Array,
	times: number,
	count: number,
	time: number,
	scratch: Float64Array,
	at: number
) {
	const high = count - 1;
	let low = scratch[at]!;
	if ( !(low >= 0 && low <= high) ) low = 0;
	if ( !(keys[times + low]! <= time && (low === high || time < keys[times + low + 1]!)) ) {
		let top = high;
		low = 0;
		while ( low < top ) {
			const mid = Math.ceil( (low + top) / 2 );
			if ( keys[times + mid]! <= time ) low = mid;
			else top = mid - 1;
		}
	}
	const next = Math.min( low + 1, high );
	const span = count ? keys[times + next]! - keys[times + low]! : NaN;
	scratch[at] = low;
	scratch[at + 1] = next;
	scratch[at + 2] = span;
	scratch[at + 3] = span ? Math.max( 0, Math.min( 1, (time - keys[times + low]!) / span ) ) : 0;
}

/*
================
materializeSkeleton

One pose's materialization, from its record's inputs: sampled locals and
globals in its state, R_CHANGED set when a global matrix changed.
================
*/
export function materializeSkeleton( views: SkeletonViews, slot: number ) {
	const records = views.skeletonRecords, models = views.skeletonModels, clips = views.skeletonClips;
	const keys = views.skeletonKeys, scratch = views.skeletonScratch, s = views.skeletonState;
	const w = slot * SKELETON_RECORD, model = records[w + R_MODEL]!, base = records[w + R_STATE]!;
	const work = records[w + R_SCRATCH]!, n = models[model + S_NODES]!;
	const parents = model + S_HEADER, order = parents + n, hasMatrix = order + n, matrices = hasMatrix + n;
	const restT = matrices + n * 16, restR = restT + n * 3, restS = restR + n * 4;
	const T = base + n * STATE_TRANSLATIONS, R = base + n * STATE_ROTATIONS, S = base + n * STATE_SCALES;
	const P = base + n * STATE_PASSES, W = base + n * STATE_WEIGHTS, K = base + n * STATE_COMMITTED;
	const L = base + n * STATE_LOCALS, G = base + n * STATE_GLOBALS, CG = base + n * STATE_CHANGED;
	const AL = base + n * STATE_ANIMATED, SAMPLE = base + n * STATE_SAMPLE;
	const layers = work, layerCount = records[w + R_LAYERS]!;
	const brackets = layers + records[w + R_LAYER_CAPACITY]! * LAYER_WORDS;
	const clocks = brackets + records[w + R_CHANNEL_CAPACITY]! * 4;
	// A run a stalled worker left recomposes every matrix from the samples.
	const restarted = records[w + R_BUSY] === 1;
	records[w + R_BUSY] = 1;
	const initialized = !restarted && records[w + R_INITIALIZED] === 1;
	const direct = records[w + R_DIRECT] === 1;
	const reuseMatrices = !restarted && direct && records[w + R_DIRECT_MATRICES] === 1;
	records[w + R_DIRECT_MATRICES] = 0;
	for ( let i = 0; i < n * 3; i++ ) s[T + i] = models[restT + i]!;
	for ( let i = 0; i < n * 4; i++ ) s[R + i] = models[restR + i]!;
	for ( let i = 0; i < n * 3; i++ ) s[S + i] = models[restS + i]!;
	if ( !direct ) s.fill( 0, K, K + n * 3 );
	// CRTBone 0xab56c0 accumulates each pass by w/(sum+w). 0xab5780 caps the
	// next pass to remaining headroom; event tracks precede timed tracks.
	for ( let laneIndex = 0; laneIndex < (direct ? 1 : 2); laneIndex++ ) {
		const lane = direct ? scratch[layers + 3]! : laneIndex === 0 ? LANE_EVENT : LANE_TIMED;
		if ( !direct ) s.fill( 0, W, W + n * 3 );
		for ( let layer = 0; layer < layerCount; layer++ ) {
			const at = layers + layer * LAYER_WORDS;
			const clip = scratch[at]!, time = scratch[at + 1]!, weight = scratch[at + 2]!;
			if ( scratch[at + 3] !== lane || weight === 0 ) continue;
			if ( clip < 0 ) continue;
			const channelCount = clips[clip + CLIP_CHANNELS]!, clockCount = clips[clip + CLIP_TIMELINES]!;
			if ( records[w + R_CACHE_CLIP] !== clip ) {
				scratch.fill( NaN, brackets, brackets + channelCount * 4 );
				records[w + R_CACHE_CLIP] = clip;
			}
			for ( let clock = 0; clock < clockCount; clock++ ) {
				const entry = clip + CLIP_HEADER + clock * CLIP_TIMELINE;
				sampleClock( keys, clips[entry]!, clips[entry + 1]!, time, scratch, clocks + clock * 4 );
			}
			const channels = clip + CLIP_HEADER + clockCount * CLIP_TIMELINE;
			for ( let channelIndex = 0; channelIndex < channelCount; channelIndex++ ) {
				const channel = channels + channelIndex * CLIP_CHANNEL;
				const node = clips[channel]!, path = clips[channel + 1]!, interpolation = clips[channel + 2]!;
				const clock = clocks + clips[channel + 3]! * 4, values = clips[channel + 4]!;
				const width = path === PATH_ROTATION ? 4 : 3;
				// A single full-weight track owns this node/path. Its float32
				// destination is the sampler output itself.
				const target = direct ?
					(path === PATH_TRANSLATION ? T + node * 3 : path === PATH_ROTATION ? R + node * 4 : S + node * 3) :
					SAMPLE;
				const low = scratch[clock]!, next = scratch[clock + 1]!, span = scratch[clock + 2]!;
				const fraction = scratch[clock + 3]!;
				if ( next < 0 ) {
					// An empty key clock: the object code reads past both arrays.
					for ( let c = 0; c < width; c++ ) s[target + c] = NaN;
				} else if ( interpolation === INTERPOLATION_CUBIC ) {
					const t = fraction, t2 = t * t, t3 = t2 * t;
					for ( let c = 0; c < width; c++ ) {
						s[target + c] = (2 * t3 - 3 * t2 + 1) * keys[values + (low * 3 + 1) * width + c]! +
							(t3 - 2 * t2 + t) * span * keys[values + (low * 3 + 2) * width + c]! +
							(-2 * t3 + 3 * t2) * keys[values + (next * 3 + 1) * width + c]! +
							(t3 - t2) * span * keys[values + next * 3 * width + c]!;
					}
				} else if ( interpolation === INTERPOLATION_STEP || next === low ) {
					for ( let c = 0; c < width; c++ ) s[target + c] = keys[values + low * width + c]!;
				} else if ( width === 4 ) {
					const cached = brackets + channelIndex * 4;
					if ( scratch[cached] !== low ) {
						let dot = 0;
						for ( let i = 0; i < 4; i++ ) dot += keys[values + low * 4 + i]! * keys[values + next * 4 + i]!;
						const sign = dot < 0 ? -1 : 1;
						dot = Math.min( 1, Math.abs( dot ) );
						const angle = Math.acos( dot );
						scratch[cached] = low;
						scratch[cached + 1] = sign;
						scratch[cached + 2] = angle;
						scratch[cached + 3] = Math.sin( angle );
					}
					const sign = scratch[cached + 1]!, angle = scratch[cached + 2]!, sin = scratch[cached + 3]!;
					const left = sin < 1e-6 ? 1 - fraction : Math.sin( (1 - fraction) * angle ) / sin,
						right = sin < 1e-6 ? fraction : Math.sin( fraction * angle ) / sin;
					for ( let i = 0; i < 4; i++ ) {
						s[target + i] = keys[values + low * 4 + i]! * left +
							keys[values + next * 4 + i]! * right * sign;
					}
				} else {
					for ( let c = 0; c < width; c++ ) {
						s[target + c] = keys[values + low * width + c]! * (1 - fraction) +
							keys[values + next * width + c]! * fraction;
					}
				}
				if ( direct ) continue;
				const index = node * 3 + path;
				const out = P + node * 10 + (path === PATH_TRANSLATION ? 0 : path === PATH_ROTATION ? 3 : 7);
				const before = s[W + index]!, total = before + weight;
				if ( before === 0 ) { for ( let c = 0; c < width; c++ ) s[out + c] = s[SAMPLE + c]!; }
				else if ( path === PATH_ROTATION ) slerpAt( s, out, SAMPLE, weight / total, out );
				else {
					for ( let c = 0; c < width; c++ ) {
						s[out + c] = s[out + c]! + (s[SAMPLE + c]! - s[out + c]!) * weight / total;
					}
				}
				s[W + index] = total;
			}
		}
		if ( !direct ) {
			for ( let node = 0; node < n; node++ ) {
				for ( let path = 0; path < 3; path++ ) {
					const index = node * 3 + path, weight = Math.min( s[W + index]!, 1 - s[K + index]! );
					if ( weight <= 0 ) continue;
					const width = path === PATH_ROTATION ? 4 : 3;
					const out = path === PATH_TRANSLATION ?
						T + node * 3 :
						path === PATH_ROTATION ?
						R + node * 4 :
						S + node * 3;
					const value = P + node * 10 + (path === PATH_TRANSLATION ? 0 : path === PATH_ROTATION ? 3 : 7);
					const previous = s[K + index]!;
					if ( previous === 0 ) { for ( let c = 0; c < width; c++ ) s[out + c] = s[value + c]!; }
					else if ( path === PATH_ROTATION ) slerpAt( s, out, value, weight / (previous + weight), out );
					else {
						for ( let c = 0; c < 3; c++ ) {
							s[out + c] = s[out + c]! + (s[value + c]! - s[out + c]!) * weight / (previous + weight);
						}
					}
					s[K + index] = previous + weight;
				}
			}
		}
	}
	// A9ADD0 multiplies the rotator after the sampled local rotation.
	const rotated = records[w + R_ROTATED]!, released = records[w + R_RELEASED]!;
	if ( rotated >= 0 ) {
		const q = R + rotated * 4, r = w + R_ROTATION;
		const ax = records[r]!, ay = records[r + 1]!, az = records[r + 2]!, aw = records[r + 3]!;
		const bx = s[q]!, by = s[q + 1]!, bz = s[q + 2]!, bw = s[q + 3]!;
		s[q] = aw * bx + ax * bw + ay * bz - az * by;
		s[q + 1] = aw * by - ax * bz + ay * bw + az * bx;
		s[q + 2] = aw * bz + ax * by - ay * bx + az * bw;
		s[q + 3] = aw * bw - ax * bx - ay * by - az * bz;
	}
	let matricesChanged = !initialized;
	for ( let i = 0; i < n; i++ ) {
		const node = models[order + i]!, parent = models[parents + node]!;
		let localChanged = !initialized;
		const turned = node === rotated || node === released;
		if ( !initialized || s[AL + node] !== 0 || turned ) {
			localChanged = turned || !reuseMatrices || !sameLocalSample( s, base, n, node );
			if ( localChanged ) {
				const local = L + node * 16;
				if ( models[hasMatrix + node] === 1 ) {
					const matrix = matrices + node * 16;
					for ( let c = 0; c < 16; c++ ) s[local + c] = models[matrix + c]!;
				} else composeAt( s, T + node * 3, R + node * 4, S + node * 3, local );
				if ( direct ) {
					const pass = P + node * 10;
					for ( let c = 0; c < 3; c++ ) s[pass + c] = s[T + node * 3 + c]!;
					for ( let c = 0; c < 4; c++ ) s[pass + 3 + c] = s[R + node * 4 + c]!;
					for ( let c = 0; c < 3; c++ ) s[pass + 7 + c] = s[S + node * 3 + c]!;
				}
			}
		}
		// Parent-first traversal propagates a changed ancestor through static
		// descendants. Unchanged local and parent bytes imply identical globals.
		const globalChanged = localChanged || (parent >= 0 && s[CG + parent] !== 0);
		s[CG + node] = globalChanged ? 1 : 0;
		if ( globalChanged ) {
			if ( parent < 0 ) { for ( let c = 0; c < 16; c++ ) s[G + node * 16 + c] = s[L + node * 16 + c]!; }
			else multiplyAt( s, G + parent * 16, L + node * 16, G + node * 16 );
			matricesChanged = true;
		}
	}
	if ( matricesChanged ) records[w + R_CHANGED] = 1;
	records[w + R_INITIALIZED] = 1;
	records[w + R_DIRECT_MATRICES] = direct ? 1 : 0;
	records[w + R_BUSY] = 0;
}
