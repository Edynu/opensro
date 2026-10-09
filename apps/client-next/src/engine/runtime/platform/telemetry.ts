/*
===========================================================================

telemetry.ts - compact player FPS/ping and opt-in developer diagnostics

The Experimental preference reveals separate icons, never developer data in
the player readout: the frame report and the batching census, each in its
own panel, one open at a time. Only icon visibility persists; panels start
closed. This is a local presentation preference, not server authorization.

===========================================================================
*/
import type { FrameTelemetry } from "@/engine/contracts/runtime";
import { formatBatchCensus, formatFrameReport } from "@/engine/foundation/rendering/frame-report";

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

/*
================
DeveloperPanel

A developer readout and the icon that opens it; report names its text.
================
*/
interface DeveloperPanel {
	readonly toggle: HTMLButtonElement;
	readonly readout: HTMLDivElement;
	readonly name: string;
	readonly report: "frame" | "census";
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/*
================
tilesIcon

The batching census icon: four equal tiles, one item drawn for many
players. Drawn, not a glyph, so it stays crisp at the chip's 10px font.
================
*/
function tilesIcon(): SVGSVGElement {
	const icon = document.createElementNS( SVG_NAMESPACE, "svg" );
	icon.setAttribute( "viewBox", "0 0 10 10" );
	icon.setAttribute( "width", "10" );
	icon.setAttribute( "height", "10" );
	icon.setAttribute( "aria-hidden", "true" );
	for ( const [x, y] of [ [ 0, 0 ], [ 6, 0 ], [ 0, 6 ], [ 6, 6 ] ] ) {
		const tile = document.createElementNS( SVG_NAMESPACE, "rect" );
		tile.setAttribute( "x", String( x ) );
		tile.setAttribute( "y", String( y ) );
		tile.setAttribute( "width", "4" );
		tile.setAttribute( "height", "4" );
		tile.setAttribute( "fill", "currentColor" );
		icon.append( tile );
	}
	return icon;
}

/*
================
createDeveloperPanel

The icon <id>-toggle and its hidden readout <id>-readout.
================
*/
function createDeveloperPanel(
	id: string,
	icon: string | SVGSVGElement,
	title: string,
	report: DeveloperPanel["report"]
): DeveloperPanel {
	const toggle = document.createElement( "button" );
	toggle.id = `${id}-toggle`;
	toggle.className = "sro-fps-chip__toggle sro-developer-toggle";
	toggle.type = "button";
	if ( typeof icon === "string" ) toggle.textContent = icon;
	else toggle.append( icon );
	toggle.setAttribute( "aria-controls", `${id}-readout` );
	const readout = document.createElement( "div" );
	readout.id = `${id}-readout`;
	readout.className = "sro-fps-chip__readout sro-developer-readout";
	readout.setAttribute( "role", "region" );
	readout.setAttribute( "aria-label", title );
	return { toggle, readout, name: title.toLowerCase(), report };
}

/*
================
panelText
================
*/
function panelText( panel: DeveloperPanel, sample: FrameTelemetry, ping: string ): string {
	return panel.report === "census" ? formatBatchCensus( sample ) : formatFrameReport( sample, ping );
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
	// Left of FPS in this order. The frame report fills the panel's height,
	// so the census has its own.
	const panels: readonly DeveloperPanel[] = [
		createDeveloperPanel( "census", tilesIcon(), "Batching census", "census" ),
		createDeveloperPanel( "developer", "</>", "Developer diagnostics", "frame" )
	];
	let enabled = options.enabled;
	let latest: FrameTelemetry | null = null;
	let movementDump: (() => unknown) | undefined;
	for ( const panel of panels ) {
		chip?.insertBefore( panel.toggle, fpsToggle );
		chip?.append( panel.readout );
	}

	/*
 ================
 setExpanded

 Opens or closes a developer panel, or the player's FPS readout (null).
 ================
 */
	function setExpanded( panel: DeveloperPanel | null, expanded: boolean ) {
		const button = panel ? panel.toggle : fpsToggle;
		const readout = panel ? panel.readout : fpsReadout;
		if ( !button || !readout ) return;
		readout.hidden = !expanded;
		const label = `${expanded ? "Hide" : "Show"} ${panel ? panel.name : "FPS and ping"}`;
		button.setAttribute( "aria-expanded", String( expanded ) );
		button.setAttribute( "aria-label", label );
		button.title = label;
		if ( !panel ) {
			chip?.setAttribute( "data-expanded", String( expanded ) );
			button.textContent = expanded ? "x" : "F";
		}
	}

	/*
 ================
 open

 Shows one readout (a developer panel, or FPS for null) and closes the rest.
 ================
 */
	function open( panel: DeveloperPanel | null, expanded: boolean ) {
		if ( panel ) setExpanded( null, false );
		for ( const other of panels ) if ( other !== panel ) setExpanded( other, false );
		setExpanded( panel, expanded );
		if ( latest ) present( latest );
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
		for ( const panel of panels ) {
			if ( !panel.readout.hidden ) panel.readout.textContent = panelText( panel, sample, ping );
		}
	}

	/*
 ================
 setDiagnostics
 ================
 */
	function setDiagnostics( value: boolean ) {
		enabled = value === true;
		for ( const panel of panels ) {
			panel.toggle.hidden = !enabled;
			if ( !enabled ) {
				setExpanded( panel, false );
				panel.readout.textContent = "";
			}
		}
		return enabled;
	}
	setExpanded( null, false );
	for ( const panel of panels ) {
		setExpanded( panel, false );
		panel.toggle.hidden = !enabled;
	}
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
	fpsToggle?.addEventListener( "click", () => open( null, !!fpsReadout?.hidden ), { signal: lifetime.signal } );
	for ( const panel of panels ) {
		panel.toggle.addEventListener( "click", () => open( panel, panel.readout.hidden ), {
			signal: lifetime.signal
		} );
	}
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
		active: () => enabled && panels.some( panel => !panel.readout.hidden ) && !document.hidden,
		/*
  ================
  dispose
  ================
  */
		dispose() {
			movementDump = undefined;
			lifetime.abort();
			for ( const panel of panels ) {
				panel.toggle.remove();
				panel.readout.remove();
			}
			setExpanded( null, false );
			if ( window.sroDebug === consoleApi ) {
				if ( previous ) window.sroDebug = previous;
				else delete window.sroDebug;
			}
		}
	};
}
