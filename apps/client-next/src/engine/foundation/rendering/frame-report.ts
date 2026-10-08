/*
===========================================================================

frame-report.ts - the developer panel's text: where a frame's time goes

Turns one telemetry window (runtime.ts, stage keys from the panel's frame
probe, runtime/stage-probe.ts) into monospace text: what limits the
frame, CPU time by system, the stage tree with each stage's worst frame,
the workload, and the GPU passes. Pure formatting; owns no state.

Stage keys carry their family: frame: (runtime stages), render:, world:,
character: (renderer phases), detail: (spans inside a phase), span:
(measured shares), count: (per-frame counts) and peak: (a timing's worst
frame). A key the layout does not name is still listed, under "Other".

===========================================================================
*/
import type { FrameTelemetry } from "@/engine/contracts/runtime";

export const PEAK_KEY_PREFIX = "peak:";
export const COUNT_KEY_PREFIX = "count:";

// Column widths of the monospace text.
const LABEL_WIDTH = 30;
const VALUE_WIDTH = 7;
const BAR_WIDTH = 12;
// A parent's time its children leave uncovered is listed from this much.
const NOT_ITEMIZED_MS = 0.05;
// The main thread is the limit when it is busy this share of the frame.
const CPU_BOUND_SHARE = 0.85;

/*
================
StageRow

One line of the stage tree: its key, label and indent.
================
*/
type StageRow = readonly [key: string, label: string, depth: number];

/*
================
stageTree

The stage tree in frame order. Particle work (VFX) is named as such.
================
*/
function stageTree(): readonly StageRow[] {
	return [
		[ "frame:input-state-frontend", "Input & frontend", 0 ],
		[ "frame:character-presentation", "Characters (game logic)", 0 ],
		[ "detail:presentation-selection", "selection", 1 ],
		[ "detail:presentation-events", "events & effects", 1 ],
		[ "detail:presentation-state", "state", 1 ],
		[ "detail:presentation-actors", "actors", 1 ],
		[ "detail:actor-motion", "motion & animation", 2 ],
		[ "detail:actor-sounds", "sounds", 2 ],
		[ "detail:actor-record", "records", 2 ],
		[ "detail:presentation-finalize", "finalize", 1 ],
		[ "frame:world-stream", "World streaming", 0 ],
		[ "frame:ui", "UI", 0 ],
		[ "detail:ui-assembly", "assembly", 1 ],
		[ "detail:ui-finalize", "finalize", 1 ],
		[ "detail:ui-compare", "compare", 1 ],
		[ "detail:ui-publish", "publish", 1 ],
		[ "frame:render-preparation-submit", "Renderer", 0 ],
		[ "render:renderer-setup", "setup", 1 ],
		[ "render:world-prepare", "world", 1 ],
		[ "world:world-camera", "camera", 2 ],
		[ "world:world-environment", "environment", 2 ],
		[ "world:world-selection", "visible set", 2 ],
		[ "world:world-finalize", "finalize", 2 ],
		[ "render:character-prepare", "characters", 1 ],
		[ "character:character-setup", "setup", 2 ],
		[ "character:character-particles", "particle simulation (VFX)", 2 ],
		[ "character:character-plan", "visibility & batches", 2 ],
		[ "character:character-poses", "CPU poses", 2 ],
		[ "character:character-upload", "draws & upload", 2 ],
		[ "detail:batch-rows", "bone rows", 3 ],
		[ "detail:draw-skinned", "skinned meshes", 3 ],
		[ "detail:draw-cloth", "cloth", 3 ],
		[ "detail:draw-particles", "particle rows (VFX)", 3 ],
		[ "render:labels-portraits", "labels & portraits", 1 ],
		[ "render:submit", "GPU commands & submit", 1 ],
		[ "span:encode-skeletal", "skeletal encode", 2 ],
		[ "span:encode-particles", "particle encode (VFX)", 2 ],
		[ "span:encode-shadows", "shadow encode", 2 ],
		[ "frame:hover", "Hover pick", 0 ],
		[ "frame:audio", "Audio", 0 ]
	];
}

/*
================
System

A CPU system: the stages it adds and the shares it takes out of them.
================
*/
type System = { readonly label: string; readonly add: readonly string[]; readonly subtract?: readonly string[]; };

/*
================
systems

The CPU systems. VFX is every particle share: simulation, rows, encoding.
================
*/
function systems(): readonly System[] {
	return [
		{ label: "Characters: game logic", add: [ "frame:character-presentation" ] },
		{
			label: "Characters: rendering",
			add: [ "render:character-prepare", "render:labels-portraits" ],
			subtract: [ "character:character-particles", "detail:draw-particles" ]
		},
		{
			label: "VFX particles",
			add: [ "character:character-particles", "detail:draw-particles", "span:encode-particles" ]
		},
		{ label: "World", add: [ "frame:world-stream", "render:world-prepare" ] },
		{ label: "UI", add: [ "frame:ui" ] },
		{ label: "GPU commands & submit", add: [ "render:submit" ], subtract: [ "span:encode-particles" ] },
		{
			label: "Input, hover, audio",
			add: [ "frame:input-state-frontend", "frame:hover", "frame:audio", "render:renderer-setup" ]
		}
	];
}

/*
================
workload

The per-frame counts shown by name, in this order.
================
*/
function workload(): readonly (readonly [string, string])[] {
	return [
		[ "character-candidates", "character actors" ],
		[ "character-visible-bodies", "bodies on screen" ],
		[ "pose-evaluations", "CPU poses" ],
		[ "character-particle-needed-poses", "poses for particles" ],
		[ "particles", "live particles" ],
		[ "pose-created", "poses created" ]
	];
}

/*
================
ms
================
*/
function ms( value: number ): string {
	return value.toFixed( value < 10 ? 2 : 1 );
}

/*
================
row

A label, right-aligned values and an optional bar.
================
*/
function row( label: string, values: readonly string[], bar = "" ): string {
	const name = label.length > LABEL_WIDTH ? label.slice( 0, LABEL_WIDTH - 1 ) + "…" : label.padEnd( LABEL_WIDTH );
	return name + values.map( value => value.padStart( VALUE_WIDTH ) ).join( "" ) + (bar ? " " + bar : "");
}

/*
================
bar

share (0..1) as a run of block characters.
================
*/
function bar( share: number ): string {
	const cells = Math.round( Math.max( 0, Math.min( 1, share ) ) * BAR_WIDTH );
	return "█".repeat( cells ) + "·".repeat( BAR_WIDTH - cells );
}

/*
================
stageLines

The stage tree's lines, each with its worst frame. A stage whose children
reported ends with a "(not itemized)" line: the time no child covers.
================
*/
function stageLines( tree: readonly StageRow[], stages: Readonly<Record<string, number>> ): string[] {
	const lines: string[] = [];
	// Emits the row at index and its subtree; returns the index after it.
	const emit = ( index: number ): number => {
		const [key, label, depth] = tree[index]!, own = stages[key];
		if ( own !== undefined ) {
			const peak = stages[PEAK_KEY_PREFIX + key];
			lines.push( row( "  ".repeat( depth ) + label, [ ms( own ), peak === undefined ? "" : ms( peak ) ] ) );
		}
		let next = index + 1, children = 0, reported = false;
		while ( next < tree.length && tree[next]![2] > depth ) {
			const child = stages[tree[next]![0]];
			if ( child !== undefined ) {
				children += child;
				reported = true;
			}
			next = emit( next );
		}
		if ( own !== undefined && reported && own - children >= NOT_ITEMIZED_MS ) {
			lines.push( row( "  ".repeat( depth + 1 ) + "(not itemized)", [ ms( own - children ), "" ] ) );
		}
		return next;
	};
	for ( let index = 0; index < tree.length; ) index = emit( index );
	return lines;
}

/*
================
gpuPasses

Each pass's average over the window's GPU samples, longest first.
================
*/
function gpuPasses( gpu: FrameTelemetry["gpu"] ): { name: string; ms: number; }[] {
	if ( !gpu?.samples.length ) return [];
	const totals = new Map<string, number>();
	for ( const sample of gpu.samples ) {
		for ( const pass of sample.passes ) totals.set( pass.name, (totals.get( pass.name ) ?? 0) + pass.ms );
	}
	return [ ...totals ].map( ( [name, total] ) => ({ name, ms: total / gpu.samples.length }) ).sort( ( a, b ) =>
		b.ms - a.ms
	);
}

/*
================
formatFrameReport

The panel's text for one telemetry window. stages is absent without
?frame-stages=1; the GPU section needs ?gpu-timing=1.
================
*/
export function formatFrameReport( sample: FrameTelemetry, ping: string ): string {
	const stages = sample.stages ?? {};
	const value = ( key: string ) => stages[key] ?? 0;
	const passes = gpuPasses( sample.gpu ), gpuMs = passes.reduce( ( sum, pass ) => sum + pass.ms, 0 );
	const lines: string[] = [
		"Developer diagnostics",
		`${Math.round( sample.fps )} FPS · ${ping} ms ping`,
		`Frame ${ms( sample.frameMs )} ms (p95 ${ms( sample.p95FrameMs )})`,
		`CPU   ${ms( sample.cpuMs )} ms (p95 ${ms( sample.p95CpuMs )})` +
		(passes.length ? `   GPU ${ms( gpuMs )} ms` : "")
	];
	// What sets the frame time.
	const cpuShare = sample.frameMs > 0 ? sample.cpuMs / sample.frameMs : 0;
	lines.push(
		passes.length && gpuMs > sample.cpuMs ?
			`Limited by: GPU (${ms( gpuMs )} ms of passes)` :
			cpuShare >= CPU_BOUND_SHARE ?
			`Limited by: CPU (main thread busy ${Math.round( cpuShare * 100 )}% of the frame)` :
			passes.length ?
			`Limited by: display pacing (CPU busy ${Math.round( cpuShare * 100 )}%)` :
			`Limited by: not the main thread (CPU busy ${Math.round( cpuShare * 100 )}%): GPU or display`
	);
	if ( !sample.stages ) {
		lines.push( "", "Add ?frame-stages=1 for the CPU breakdown." );
	} else {
		// CPU by system, largest first, with the time no stage covers.
		const measured = Object.keys( stages ).filter( key => key.startsWith( "frame:" ) ).reduce(
			( sum, key ) => sum + value( key ),
			0
		);
		const cpu = systems().map( system => ({
			label: system.label,
			ms: Math.max(
				0,
				system.add.reduce( ( sum, key ) => sum + value( key ), 0 ) -
					(system.subtract ?? []).reduce( ( sum, key ) => sum + value( key ), 0 )
			)
		}) );
		cpu.push( { label: "Unmeasured", ms: Math.max( 0, sample.cpuMs - measured ) } );
		cpu.sort( ( a, b ) => b.ms - a.ms );
		lines.push( "", row( "CPU by system", [ "ms", "share" ] ) );
		for ( const system of cpu ) {
			const share = sample.cpuMs > 0 ? system.ms / sample.cpuMs : 0;
			lines.push( row( system.label, [ ms( system.ms ), `${Math.round( share * 100 )}%` ], bar( share ) ) );
		}
		// The stage tree with each stage's worst frame.
		lines.push( "", row( "CPU stages", [ "avg", "peak" ] ) );
		const tree = stageTree(), named = new Set( tree.map( ( [key] ) => key ) );
		lines.push( ...stageLines( tree, stages ) );
		const others = Object.keys( stages ).filter( key =>
			!named.has( key ) && !key.startsWith( PEAK_KEY_PREFIX ) && !key.startsWith( COUNT_KEY_PREFIX )
		).sort();
		if ( others.length ) {
			lines.push( "Other" );
			for ( const key of others ) {
				const peak = stages[PEAK_KEY_PREFIX + key];
				lines.push( row( "  " + key, [ ms( value( key ) ), peak === undefined ? "" : ms( peak ) ] ) );
			}
		}
	}
	// Workload: what the time is spent on.
	lines.push(
		"",
		"Workload per frame",
		row( "actors / draws / groups", [
			String( sample.actors ),
			String( sample.draws ),
			String( sample.visibleGroups )
		] )
	);
	for ( const [name, label] of workload() ) {
		const count = stages[COUNT_KEY_PREFIX + name];
		if ( count !== undefined ) lines.push( row( label, [ String( Math.round( count ) ) ] ) );
	}
	// GPU passes, longest first.
	lines.push( "" );
	if ( !sample.gpu?.enabled ) {
		lines.push( "GPU: add &gpu-timing=1 for pass times." );
	} else if ( !sample.gpu.supported ) {
		lines.push( "GPU: timestamp queries are not supported here." );
	} else if ( passes.length ) {
		lines.push( row( "GPU passes", [ "ms", "share" ] ) );
		for ( const pass of passes ) {
			const share = gpuMs > 0 ? pass.ms / gpuMs : 0;
			lines.push( row( pass.name, [ ms( pass.ms ), `${Math.round( share * 100 )}%` ], bar( share ) ) );
		}
		lines.push( row( "total", [ ms( gpuMs ) ] ) );
	}
	if ( sample.overload?.level ) lines.push( "", `Overload level ${sample.overload.level}` );
	lines.push( "", ...sample.build.lines, sample.build.detail );
	return lines.filter( line => line !== undefined ).join( "\n" );
}
