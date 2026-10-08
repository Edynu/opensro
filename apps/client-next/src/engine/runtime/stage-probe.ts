/*
===========================================================================

stage-probe.ts - the developer panel's frame probe (?frame-stages=1)

Every owner already reports its frame phases to one frame probe: the
runtime its stages, the renderer and its world and character owners their
sub-phases, the presentation and UI owners detail spans, and counts. A
benchmark installs its own probe; without one, the runtime uses this one,
which keeps each report under its family (frame:, render:, world:,
character:, detail:, span:, count:) for the panel's tree and records each
timing's worst frame (peak:).

Per-primitive and per-actor detail spans cost a clock read each, so they
are sampled one frame in DETAIL_SAMPLE_FRAMES (sampleDetails). A detail
seen only on sampled frames is averaged over those frames.

===========================================================================
*/
import type { FrameProbe } from "./frame-probes";
import { COUNT_KEY_PREFIX, PEAK_KEY_PREFIX } from "@/engine/foundation/rendering/frame-report";

// One frame in this many times its per-actor and per-primitive details.
const DETAIL_SAMPLE_FRAMES = 4;

/*
================
StageProbe
================
*/
export interface StageProbe {
	readonly probe: FrameProbe;
	// Per-frame averages of every report since the last take, then reset.
	take(): Record<string, number>;
}

/*
================
createStageProbe
================
*/
export function createStageProbe(): StageProbe {
	const totals: Record<string, number> = {}, frame: Record<string, number> = {}, peaks: Record<string, number> = {};
	// Keys reported on an unsampled frame are every-frame reports.
	const everyFrame = new Set<string>();
	const opened: Record<string, number> = {};
	const begun = { frame: 0, render: 0, world: 0, character: 0 };
	let frames = 0, sampledFrames = 0, sampled = false;

	/*
	================
	add
	================
	*/
	function add( key: string, value: number ) {
		totals[key] = (totals[key] ?? 0) + value;
		frame[key] = (frame[key] ?? 0) + value;
		if ( !sampled ) everyFrame.add( key );
	}

	/*
	================
	span

	The time since the family's previous mark, under prefix + stage.
	================
	*/
	function span( family: keyof typeof begun, prefix: string, stage: string ) {
		const now = performance.now();
		add( prefix + stage, now - begun[family] );
		begun[family] = now;
	}

	/*
	================
	closeFrame

	Fold the finished frame's timings into the peaks.
	================
	*/
	function closeFrame() {
		for ( const key in frame ) {
			if ( !key.startsWith( COUNT_KEY_PREFIX ) ) peaks[key] = Math.max( peaks[key] ?? 0, frame[key]! );
			frame[key] = 0;
		}
	}

	const probe: FrameProbe = {
		begin( frameId ) {
			frames++;
			sampled = frameId % DETAIL_SAMPLE_FRAMES === 0;
			if ( sampled ) sampledFrames++;
			begun.frame = performance.now();
		},
		mark: stage => span( "frame", "frame:", stage ),
		end: closeFrame,
		// Movement traces are a benchmark's; the panel shows none.
		movement: () => {},
		sampleDetails: () => sampled,
		detailBegin( stage ) {
			opened[stage] = performance.now();
		},
		detailEnd( stage ) {
			const at = opened[stage];
			if ( at === undefined ) return;
			add( "detail:" + stage, performance.now() - at );
			delete opened[stage];
		},
		renderBegin: () => void (begun.render = performance.now()),
		renderMark: stage => span( "render", "render:", stage ),
		renderSpan: ( stage, ms ) => add( "span:" + stage, ms ),
		worldBegin: () => void (begun.world = performance.now()),
		worldMark: stage => span( "world", "world:", stage ),
		worldCount: ( name, value ) => add( COUNT_KEY_PREFIX + name, value ),
		characterBegin: () => void (begun.character = performance.now()),
		characterMark: stage => span( "character", "character:", stage ),
		characterCount: ( name, value = 1 ) => add( COUNT_KEY_PREFIX + name, value )
	};
	return {
		probe,
		take() {
			const result: Record<string, number> = {};
			closeFrame();
			for ( const key in totals ) {
				const over = everyFrame.has( key ) ? frames : sampledFrames;
				result[key] = over > 0 ? totals[key]! / over : 0;
				delete totals[key];
			}
			for ( const key in peaks ) {
				result[PEAK_KEY_PREFIX + key] = peaks[key]!;
				delete peaks[key];
			}
			everyFrame.clear();
			frames = sampledFrames = 0;
			return result;
		}
	};
}
