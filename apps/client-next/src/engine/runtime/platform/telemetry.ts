/*
===========================================================================

telemetry.ts - compact player FPS/ping and opt-in developer diagnostics

The Experimental preference reveals a separate icon, never developer data in
the player readout. Only icon visibility persists; panels start closed. This is
a local presentation preference, not server authorization.

===========================================================================
*/
import {
	CHARACTER_STAGE_PREFIX,
	COUNT_STAGE_PREFIX,
	PEAK_STAGE_PREFIX,
	RENDER_STAGE_PREFIX,
	WORLD_STAGE_PREFIX,
	type FrameTelemetry
} from "@/engine/contracts/runtime";

/*
================
TelemetryOptions

Platform owns persistence; the console follows the same preference path as
Experimental Confirm. Applying a preference never opens the panel.
================
*/
interface TelemetryOptions {
	readonly enabled: boolean;
	readonly onChange: ( enabled: boolean ) => void;
}

/*
================
DeveloperConsole
================
*/
export interface DeveloperConsole {
	setDiagnostics( enabled: boolean ): boolean;
	dumpMovement(): unknown;
}
declare global {
	interface Window {
		sroDebug?: DeveloperConsole;
	}
}

// ============================================================================
// The developer panel's graph and timing bars. Samples arrive every 500 ms
// (runtime.ts TELEMETRY_INTERVAL_MS), so 120 cover the last minute.

const GRAPH_SAMPLES = 120;
const GRAPH_WIDTH = 260;
const GRAPH_HEIGHT = 64;
// The graph's lowest top line, and the frame budgets drawn as guides.
const GRAPH_MIN_TOP_MS = 20;
const GRAPH_GUIDES_MS = [ 1000 / 60, 1000 / 120, 1000 / 240 ];
// GPU pass times average the most recent completed timestamp samples.
const GPU_SAMPLE_WINDOW = 30;
const SVG_NS = "http://www.w3.org/2000/svg";
// The runtime stage the renderer's own phases subdivide (runtime.ts), and
// the renderer phases the world and character owners subdivide.
const RENDER_STAGE = "render-preparation-submit";
const NESTED_STAGES: Readonly<Record<string, string>> = {
	[RENDER_STAGE]: RENDER_STAGE_PREFIX,
	[RENDER_STAGE_PREFIX + "world-prepare"]: WORLD_STAGE_PREFIX,
	[RENDER_STAGE_PREFIX + "character-prepare"]: CHARACTER_STAGE_PREFIX
};
const STAGE_HINT = "Open the client with ?frame-stages=1&gpu-timing=1 for CPU stage and GPU pass times.";

interface GraphSample {
	readonly frameMs: number;
	readonly p95FrameMs: number;
	readonly cpuMs: number;
}

interface TimingRow {
	readonly name: string;
	readonly ms: number;
	readonly depth: number;
	// The stage's longest frame in the window, when the probe measured it.
	readonly peak?: number;
}

/*
================
ms
================
*/
function ms( value: number ) {
	return `${value.toFixed( value < 10 ? 1 : 0 )} ms`;
}

/*
================
text
================
*/
function text( className: string, content: string ) {
	const element = document.createElement( "div" );
	element.className = className;
	element.textContent = content;
	return element;
}

/*
================
frameGraph

Frame time (average and p95) and CPU time over the last minute, against
the 60, 120 and 240 FPS budgets. Lower is better.
================
*/
function frameGraph( history: readonly GraphSample[] ) {
	const svg = document.createElementNS( SVG_NS, "svg" );
	svg.setAttribute( "class", "sro-developer-graph" );
	svg.setAttribute( "viewBox", `0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}` );
	svg.setAttribute( "role", "img" );
	let top = GRAPH_MIN_TOP_MS;
	for ( const row of history ) top = Math.max( top, row.p95FrameMs );
	top = Math.ceil( top / 5 ) * 5;
	const y = ( value: number ) => GRAPH_HEIGHT - Math.min( value, top ) / top * GRAPH_HEIGHT;
	for ( const guide of GRAPH_GUIDES_MS ) {
		const line = document.createElementNS( SVG_NS, "line" );
		line.setAttribute( "class", "sro-developer-graph__guide" );
		line.setAttribute( "x1", "0" );
		line.setAttribute( "x2", String( GRAPH_WIDTH ) );
		line.setAttribute( "y1", String( y( guide ) ) );
		line.setAttribute( "y2", String( y( guide ) ) );
		svg.append( line );
		const label = document.createElementNS( SVG_NS, "text" );
		label.setAttribute( "class", "sro-developer-graph__label" );
		label.setAttribute( "x", String( GRAPH_WIDTH - 2 ) );
		label.setAttribute( "y", String( y( guide ) - 1 ) );
		label.textContent = `${Math.round( 1000 / guide )}`;
		svg.append( label );
	}
	const step = GRAPH_WIDTH / (GRAPH_SAMPLES - 1), start = GRAPH_SAMPLES - history.length;
	for (
		const [key, className] of [
			[ "p95FrameMs", "sro-developer-graph__p95" ],
			[ "frameMs", "sro-developer-graph__frame" ],
			[ "cpuMs", "sro-developer-graph__cpu" ]
		] as const
	) {
		const line = document.createElementNS( SVG_NS, "polyline" );
		line.setAttribute( "class", className );
		line.setAttribute(
			"points",
			history.map( ( row, i ) => `${((start + i) * step).toFixed( 1 )},${y( row[key] ).toFixed( 1 )}` ).join(
				" "
			)
		);
		svg.append( line );
	}
	const title = document.createElementNS( SVG_NS, "title" );
	title.textContent = "Frame time (gold), p95 (faint) and CPU time (blue) over the last minute";
	svg.append( title );
	const wrapper = document.createElement( "div" );
	wrapper.className = "sro-developer-graph__frame-wrap";
	wrapper.append(
		text( "sro-developer-graph__axis", `${top} ms` ),
		svg,
		text( "sro-developer-graph__legend", "frame · p95 · CPU (ms, last 60 s; guides: FPS)" )
	);
	return wrapper;
}

/*
================
timingRows

One bar a row, its length the share of scaleMs.
================
*/
function timingRows( title: string, rows: readonly TimingRow[], scaleMs: number ) {
	const section = document.createElement( "div" );
	section.className = "sro-developer-timings";
	section.append( text( "sro-developer-timings__title", title ) );
	for ( const row of rows ) {
		const line = document.createElement( "div" );
		line.className = "sro-developer-timings__row";
		line.style.setProperty( "--depth", String( row.depth ) );
		const name = text( "sro-developer-timings__name", row.name );
		const bar = document.createElement( "div" );
		bar.className = "sro-developer-timings__bar";
		const fill = document.createElement( "div" );
		fill.className = "sro-developer-timings__fill";
		fill.style.width = `${Math.min( 100, scaleMs > 0 ? row.ms / scaleMs * 100 : 0 ).toFixed( 1 )}%`;
		bar.append( fill );
		line.append(
			name,
			bar,
			text( "sro-developer-timings__ms", ms( row.ms ) ),
			text( "sro-developer-timings__peak", row.peak === undefined ? "" : ms( row.peak ) )
		);
		section.append( line );
	}
	return section;
}

/*
================
cpuSection

The frame owner's stages in frame order, the render stage opened into the
renderer's phases and those into the world and character sub-phases.
================
*/
function cpuSection( sample: FrameTelemetry ) {
	const stages = sample.stages;
	if ( !stages ) return [ text( "sro-developer-readout__hint", STAGE_HINT ) ];
	const rows: TimingRow[] = [];
	const nested = new Set( Object.values( NESTED_STAGES ) );
	/*
	================
	appendStage
	================
	*/
	const appendStage = ( key: string, depth: number ) => {
		const prefix = NESTED_STAGES[key];
		const label = key.slice( key.indexOf( ":" ) + 1 );
		rows.push( { name: label, ms: stages[key] ?? 0, depth, peak: stages[PEAK_STAGE_PREFIX + key] } );
		if ( !prefix ) return;
		for ( const child in stages ) if ( child.startsWith( prefix ) ) appendStage( child, depth + 1 );
	};
	const counts: string[] = [];
	for ( const key in stages ) {
		if ( key.startsWith( PEAK_STAGE_PREFIX ) ) continue;
		if ( key.startsWith( COUNT_STAGE_PREFIX ) ) {
			counts.push( `${key.slice( COUNT_STAGE_PREFIX.length )} ${stages[key]!.toFixed( 1 )}` );
			continue;
		}
		if ( [ ...nested ].some( prefix => key.startsWith( prefix ) ) ) continue;
		appendStage( key, 0 );
	}
	return [
		timingRows(
			`CPU per frame (bars: share of ${ms( sample.frameMs )} frame; right: longest frame)`,
			rows,
			sample.frameMs
		),
		...(counts.length ? [ text( "sro-developer-readout__line", "Per frame: " + counts.join( " · " ) ) ] : [])
	];
}

/*
================
gpuSection

Each pass's GPU time, averaged over the recent timestamp samples; a frame
with several passes of one name (shadows, portraits) counts their sum.
================
*/
function gpuSection( sample: FrameTelemetry ) {
	const gpu = sample.gpu;
	if ( !gpu?.enabled ) return [];
	if ( !gpu.supported ) return [ text( "sro-developer-readout__hint", "GPU timing: timestamp-query unsupported." ) ];
	const recent = gpu.samples.slice( -GPU_SAMPLE_WINDOW );
	if ( !recent.length ) return [ text( "sro-developer-readout__hint", "GPU timing: waiting for samples..." ) ];
	const totals = new Map<string, number>();
	for ( const frame of recent ) {
		for ( const pass of frame.passes ) totals.set( pass.name, (totals.get( pass.name ) ?? 0) + pass.ms );
	}
	const rows = [ ...totals ].map( ( [name, total] ) => ({ name, ms: total / recent.length, depth: 0 }) );
	const sum = rows.reduce( ( total, row ) => total + row.ms, 0 );
	return [
		timingRows( `GPU per frame: ${ms( sum )} (bars: share of frame)`, rows, Math.max( sum, sample.frameMs ) )
	];
}

/*
================
createTelemetry
================
*/
export function createTelemetry( options: TelemetryOptions ) {
	const lifetime = new AbortController();
	const chip = document.getElementById( "fps-chip" );
	const fpsToggle = document.getElementById( "fps-toggle" );
	const fpsReadout = document.getElementById( "fps-readout" );
	const toggle = document.createElement( "button" );
	toggle.id = "developer-toggle";
	toggle.className = "sro-fps-chip__toggle";
	toggle.type = "button";
	toggle.textContent = "</>";
	toggle.setAttribute( "aria-controls", "developer-readout" );
	const readout = document.createElement( "div" );
	readout.id = "developer-readout";
	readout.className = "sro-fps-chip__readout sro-developer-readout";
	readout.setAttribute( "role", "region" );
	readout.setAttribute( "aria-label", "Developer diagnostics" );
	let enabled = options.enabled;
	let latest: FrameTelemetry | null = null;
	const history: GraphSample[] = [];
	let movementDump: (() => unknown) | undefined;
	chip?.insertBefore( toggle, fpsToggle );
	chip?.append( readout );

	/*
 ================
 setExpanded
 ================
 */
	function setExpanded( developer: boolean, expanded: boolean ) {
		const button = developer ? toggle : fpsToggle;
		const panel = developer ? readout : fpsReadout;
		if ( !button || !panel ) return;
		panel.hidden = !expanded;
		const label = `${expanded ? "Hide" : "Show"} ${developer ? "developer diagnostics" : "FPS and ping"}`;
		button.setAttribute( "aria-expanded", String( expanded ) );
		button.setAttribute( "aria-label", label );
		button.title = label;
		if ( !developer ) {
			chip?.setAttribute( "data-expanded", String( expanded ) );
			button.textContent = expanded ? "x" : "F";
		}
	}

	/*
 ================
 present
 ================
 */
	function present( sample: FrameTelemetry ) {
		latest = sample;
		const ping = sample.pingMs == null ? "—" : String( Math.round( sample.pingMs ) );
		if ( fpsReadout && !fpsReadout.hidden ) {
			fpsReadout.textContent = `${Math.round( sample.fps )} FPS · ${ping} ms`;
		}
		if ( !enabled ) return;
		// The graph keeps its history while the panel is closed.
		history.push( { frameMs: sample.frameMs, p95FrameMs: sample.p95FrameMs, cpuMs: sample.cpuMs } );
		if ( history.length > GRAPH_SAMPLES ) history.shift();
		if ( readout.hidden ) return;
		const header = text( "sro-developer-readout__title", "Developer diagnostics" );
		const summary = text(
			"sro-developer-readout__summary",
			`${Math.round( sample.fps )} FPS · ${ping} ms ping\n` +
				`Frame ${ms( sample.frameMs )} (p95 ${ms( sample.p95FrameMs )}) · CPU ${ms( sample.cpuMs )} (p95 ${
					ms( sample.p95CpuMs )
				})`
		);
		const counts = text(
			"sro-developer-readout__line",
			`Actors: ${sample.actors} · Draws: ${sample.draws} · Groups: ${sample.visibleGroups}`
		);
		const build = text(
			"sro-developer-readout__line",
			[ ...sample.build.lines, sample.build.detail ].filter( Boolean ).join( "\n" )
		);
		readout.replaceChildren(
			header,
			summary,
			frameGraph( history ),
			...cpuSection( sample ),
			...gpuSection( sample ),
			counts,
			build
		);
	}

	/*
 ================
 setDiagnostics
 ================
 */
	function setDiagnostics( value: boolean ) {
		enabled = value === true;
		toggle.hidden = !enabled;
		if ( !enabled ) {
			setExpanded( true, false );
			readout.textContent = "";
		}
		return enabled;
	}
	setExpanded( false, false );
	setExpanded( true, false );
	toggle.hidden = !enabled;
	const previous = window.sroDebug;
	const consoleApi = {
		/*
		================
		dumpMovement
		================
		*/
		dumpMovement: () => movementDump?.() ?? null,
		/*
		================
		setDiagnostics
		================
		*/
		setDiagnostics( value: boolean ) {
			options.onChange( value === true );
			return enabled;
		}
	};
	window.sroDebug = consoleApi;
	fpsToggle?.addEventListener( "click", () => {
		const expanded = !!fpsReadout?.hidden;
		setExpanded( true, false );
		setExpanded( false, expanded );
		if ( latest ) present( latest );
	}, { signal: lifetime.signal } );
	toggle.addEventListener( "click", () => {
		const expanded = readout.hidden;
		setExpanded( false, false );
		setExpanded( true, expanded );
		if ( latest ) present( latest );
	}, { signal: lifetime.signal } );
	return {
		/*
		================
		setMovementDump
		================
		*/
		setMovementDump: ( dump: () => unknown ) => {
			movementDump = dump;
		},
		setDiagnostics,
		present,
		active: () => enabled && !readout.hidden && !document.hidden,
		/*
  ================
  dispose
  ================
  */
		dispose() {
			movementDump = undefined;
			lifetime.abort();
			toggle.remove();
			readout.remove();
			setExpanded( false, false );
			if ( window.sroDebug === consoleApi ) {
				if ( previous ) window.sroDebug = previous;
				else delete window.sroDebug;
			}
		}
	};
}
