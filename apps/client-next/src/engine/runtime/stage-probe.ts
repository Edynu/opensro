/*
===========================================================================

stage-probe.ts - renderer phase timings for the developer diagnostics panel

With ?frame-stages=1 the frame owner measures its own stages; the renderer
reports finer phases (setup, world, characters, labels, submit) and the
world and character owners their sub-phases, but only to a frame probe.
A benchmark installs its own probe; otherwise this one turns those marks
into per-frame averages for the telemetry sample. Each family's marks are
consecutive spans from its begin call.

===========================================================================
*/
import {
	CHARACTER_STAGE_PREFIX,
	COUNT_STAGE_PREFIX,
	PEAK_STAGE_PREFIX,
	RENDER_STAGE_PREFIX,
	WORLD_STAGE_PREFIX,
	type RenderFrameProbe
} from "@/engine/contracts/runtime";

/*
================
StageProbe
================
*/
export interface StageProbe {
	readonly probe: RenderFrameProbe;
	// The per-frame average of every span since the last take, then reset.
	take( frames: number ): Record<string, number>;
}

/*
================
createStageProbe
================
*/
export function createStageProbe(): StageProbe {
	const totals: Record<string, number> = {};
	// This frame's time per stage, and each stage's longest frame since take.
	const frame: Record<string, number> = {}, peaks: Record<string, number> = {};
	const begun = { render: 0, world: 0, character: 0 };

	/*
	================
	closeFrame

	Fold the finished frame into the peaks.
	================
	*/
	function closeFrame() {
		for ( const key in frame ) {
			peaks[key] = Math.max( peaks[key] ?? 0, frame[key]! );
			frame[key] = 0;
		}
	}

	/*
	================
	span

	Add the time since the family's previous mark to stage.
	================
	*/
	function span( family: keyof typeof begun, prefix: string, stage: string ) {
		const now = performance.now(), key = prefix + stage;
		totals[key] = (totals[key] ?? 0) + now - begun[family];
		frame[key] = (frame[key] ?? 0) + now - begun[family];
		begun[family] = now;
	}

	const probe: RenderFrameProbe = {
		renderBegin: () => {
			closeFrame();
			begun.render = performance.now();
		},
		renderMark: stage => span( "render", RENDER_STAGE_PREFIX, stage ),
		worldBegin: () => void (begun.world = performance.now()),
		worldMark: stage => span( "world", WORLD_STAGE_PREFIX, stage ),
		characterBegin: () => void (begun.character = performance.now()),
		characterMark: stage => span( "character", CHARACTER_STAGE_PREFIX, stage ),
		characterCount: () => {},
		renderCount: ( name, value ) => {
			const key = COUNT_STAGE_PREFIX + name;
			totals[key] = (totals[key] ?? 0) + value;
		}
	};
	return {
		probe,
		take( frames: number ) {
			const averages: Record<string, number> = {};
			closeFrame();
			for ( const key in totals ) {
				averages[key] = frames > 0 ? totals[key]! / frames : 0;
				totals[key] = 0;
			}
			for ( const key in peaks ) {
				averages[PEAK_STAGE_PREFIX + key] = peaks[key]!;
				peaks[key] = 0;
			}
			return averages;
		}
	};
}
