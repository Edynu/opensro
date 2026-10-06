/*
===========================================================================

journal.ts - what happened during the replay, for the report's .zip

A bounded rolling record of the last two minutes, kept beside the video so a
developer can line up the picture with what the player pressed, what the
game said and how the page was doing:

	key        a key went down or up (never while typing in a text field)
	click      a press on the game world (normalized position, button)
	ui         a press on a game window control (its data-ui-id)
	chat       a chat line the player saw or sent
	error      a JavaScript or runtime failure
	long-frame the main thread was blocked (Long Animation Frames or
	           long tasks, with the scripts the browser blames)
	sample     once a second: phase, place, vitals, target, heap
	movement   commands, receipts, corrections and display hitches

Keys typed into a text field (chat, login, the report itself) are not
recorded at all: they are messages and passwords, not game input.

===========================================================================
*/

export const JOURNAL_WINDOW_MS = 120000;
const MAX_EVENTS = 6000;
const MAX_SCRIPTS = 3;
const FRAME_GROUP_MS = 1000;

/*
================
JournalEvent

`atMs` is performance.now(), the clock the replay's timestamps use.
================
*/
export interface JournalEvent {
	readonly atMs: number;
	readonly kind: "key" | "click" | "ui" | "chat" | "error" | "long-frame" | "sample" | "movement";
	readonly [field: string]: unknown;
}

/*
================
Journal
================
*/
export interface Journal {
	record( kind: JournalEvent["kind"], fields: Readonly<Record<string, unknown>> ): void;
	/** The events from `fromMs` on, oldest first. */
	since( fromMs: number ): JournalEvent[];
	dispose(): void;
}

/*
================
createJournal
================
*/
export function createJournal( canvas: HTMLCanvasElement ): Journal {
	const lifetime = new AbortController();
	const signal = lifetime.signal;
	let events: JournalEvent[] = [];
	let next = 0, count = 0, frameSlot = -1;

	/*
	================
	record
	================
	*/
	function record( kind: JournalEvent["kind"], fields: Readonly<Record<string, unknown>> ) {
		const atMs = performance.now();
		if ( kind === "movement" && fields.event === "frame-spike" ) {
			const previous = events[frameSlot];
			if ( previous?.kind === kind && previous.event === fields.event && atMs - previous.atMs < FRAME_GROUP_MS ) {
				// Keep the worst frame's pose and duration, plus the count and interval.
				// A 30 Hz display must not replace input/error history every frame.
				const worst = Number( fields.durationMs ) > Number( previous.durationMs ) ? fields : previous;
				events[frameSlot] = {
					...worst,
					atMs: previous.atMs,
					kind,
					count: Number( previous.count ) + 1,
					lastAtMs: atMs
				};
				return;
			}
			frameSlot = next;
			append( { ...fields, atMs, kind, count: 1, lastAtMs: atMs } );
			return;
		}
		append( { ...fields, atMs, kind } );
	}

	/*
	================
	append

	Both event producers share a fixed-capacity ring. Writes never scan/copy
	the history; since() filters by replay time when a report is requested.
	================
	*/
	function append( event: JournalEvent ) {
		events[next] = event;
		next = (next + 1) % MAX_EVENTS;
		count = Math.min( count + 1, MAX_EVENTS );
	}

	/*
	================
	typing

	A text field has focus: its keys are words, not input.
	================
	*/
	const typing = () => {
		const active = document.activeElement;
		return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ||
			(active instanceof HTMLElement && active.isContentEditable);
	};
	for ( const kind of [ "keydown", "keyup" ] as const ) {
		window.addEventListener( kind, event => {
			if ( event.repeat || typing() ) return;
			record( "key", {
				code: event.code,
				down: kind === "keydown",
				...(event.shiftKey ? { shift: true } : {}),
				...(event.ctrlKey ? { ctrl: true } : {}),
				...(event.altKey ? { alt: true } : {})
			} );
		}, { signal, capture: true, passive: true } );
	}
	window.addEventListener( "pointerdown", event => {
		const target = event.target instanceof Element ? event.target : null;
		const control = target?.closest( "[data-ui-id]" )?.getAttribute( "data-ui-id" );
		if ( control ) {
			record( "ui", { id: control, button: event.button } );
			return;
		}
		if ( target !== canvas ) return;
		const rect = canvas.getBoundingClientRect();
		record( "click", {
			button: event.button,
			x: +((event.clientX - rect.left) / Math.max( 1, rect.width )).toFixed( 3 ),
			y: +((event.clientY - rect.top) / Math.max( 1, rect.height )).toFixed( 3 )
		} );
	}, { signal, capture: true, passive: true } );

	// Long Animation Frames name the scripts behind a hitch; long tasks are
	// the older, coarser signal for browsers without them.
	const supported = typeof PerformanceObserver === "function" ? PerformanceObserver.supportedEntryTypes : [];
	const type = supported.includes( "long-animation-frame" ) ?
		"long-animation-frame" :
		supported.includes( "longtask" ) ?
		"longtask" :
		null;
	const observer = type ?
		new PerformanceObserver( list => {
			for ( const entry of list.getEntries() ) {
				const frame = entry as PerformanceEntry & {
					blockingDuration?: number;
					scripts?: readonly {
						duration: number;
						sourceURL?: string;
						sourceFunctionName?: string;
						invoker?: string;
					}[];
				};
				append( {
					atMs: entry.startTime,
					kind: "long-frame",
					durationMs: Math.round( entry.duration ),
					...(frame.blockingDuration !== undefined ?
						{ blockingMs: Math.round( frame.blockingDuration ) } :
						{}),
					...(frame.scripts?.length ?
						{
							scripts: [ ...frame.scripts ].sort( ( a, b ) => b.duration - a.duration ).slice(
								0,
								MAX_SCRIPTS
							)
								.map( script => ({
									durationMs: Math.round( script.duration ),
									source: script.sourceURL?.replace( location.origin, "" ) ?? "",
									function: script.sourceFunctionName ?? "",
									invoker: script.invoker ?? ""
								}) )
						} :
						{})
				} );
			}
		} ) :
		null;
	observer?.observe( { type: type!, buffered: false } );

	return {
		record,
		/*
		================
		since
		================
		*/
		since( fromMs ) {
			const cutoff = Math.max( fromMs, performance.now() - JOURNAL_WINDOW_MS ), result: JournalEvent[] = [];
			for ( let i = 0; i < count; i++ ) {
				const event = events[(next - count + i + MAX_EVENTS) % MAX_EVENTS]!;
				if ( event.atMs >= cutoff ) result.push( event );
			}
			// Long-frame observers report start time after later input has arrived.
			return result.sort( ( a, b ) => a.atMs - b.atMs );
		},
		/*
		================
		dispose
		================
		*/
		dispose() {
			lifetime.abort();
			observer?.disconnect();
			events = [];
			next = count = 0;
			frameSlot = -1;
		}
	};
}
