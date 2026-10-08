/*
===========================================================================

render-thread-delta.ts - per-frame actor and UI changes for the render thread

Port-only, not native (Experimental "Render thread"). Cloning the whole
actor list and UI scene to the worker every frame cost as much main-thread
time as the worker saved. Each side keeps the last state instead: the main
thread's encoders send only what changed since the last frame they sent,
and the worker's decoders rebuild the full values from what they kept.

- Actors: a new actor goes whole; a known one sends only the top-level
  fields whose value changed (compared deeply: poses, layers and small
  tuples are rebuilt by the presentation every frame), and the fields it
  no longer has.
- UI: a quad equal to the one sent at its index (the renderer's own
  sameUiQuad rule) is not sent; the worker keeps that object, so the
  renderer's retained copy and its validated text run stay in place.

===========================================================================
*/
import type { CharacterActor } from "@/engine/contracts/character";
import type { UiQuad, UiScene } from "@/engine/contracts/ui";

/*
================
ActorDelta

One changed actor: whole when new, else its changed and removed fields.
================
*/
export type ActorDelta =
	| { readonly gid: number; readonly whole: CharacterActor; }
	| { readonly gid: number; readonly set: Readonly<Record<string, unknown>>; readonly unset: readonly string[]; };

/*
================
ActorFrame

The frame's actors as their order (gids) and the changed ones.
================
*/
export interface ActorFrame {
	readonly order: readonly number[];
	readonly changes: readonly ActorDelta[];
}

/*
================
UiFrame

A scene's header, its quad count and the quads that differ by index.
================
*/
export type UiFrame = null | {
	readonly revision: number;
	readonly width: number;
	readonly height: number;
	readonly damageText?: boolean;
	readonly length: number;
	readonly changes: readonly (readonly [number, UiQuad])[];
};

/*
================
sameData

Structural equality of structured-clone data: primitives, arrays, typed
arrays and plain objects.
================
*/
export function sameData( a: unknown, b: unknown ): boolean {
	if ( a === b ) return true;
	if ( typeof a !== "object" || typeof b !== "object" || a === null || b === null ) {
		// NaN equals NaN here: a resend would carry the same value.
		return typeof a === "number" && typeof b === "number" && Number.isNaN( a ) && Number.isNaN( b );
	}
	if ( ArrayBuffer.isView( a ) || ArrayBuffer.isView( b ) ) {
		if ( !ArrayBuffer.isView( a ) || !ArrayBuffer.isView( b ) || a.constructor !== b.constructor ) return false;
		const x = a as unknown as ArrayLike<number>, y = b as unknown as ArrayLike<number>;
		if ( x.length !== y.length ) return false;
		for ( let i = 0; i < x.length; i++ ) if ( !Object.is( x[i], y[i] ) ) return false;
		return true;
	}
	if ( Array.isArray( a ) !== Array.isArray( b ) ) return false;
	if ( Array.isArray( a ) ) {
		const y = b as unknown[];
		if ( a.length !== y.length ) return false;
		for ( let i = 0; i < a.length; i++ ) if ( !sameData( a[i], y[i] ) ) return false;
		return true;
	}
	const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
	let count = 0;
	for ( const key in x ) {
		if ( !Object.hasOwn( x, key ) ) continue;
		count++;
		if ( !Object.hasOwn( y, key ) || !sameData( x[key], y[key] ) ) return false;
	}
	for ( const key in y ) if ( Object.hasOwn( y, key ) ) count--;
	return count === 0;
}

/*
================
createActorEncoder

Main thread: the actors as last sent, by gid.
================
*/
export function createActorEncoder() {
	let sent = new Map<number, CharacterActor>(), next = new Map<number, CharacterActor>();
	return {
		encode( actors: readonly CharacterActor[] ): ActorFrame {
			const order: number[] = [], changes: ActorDelta[] = [];
			next.clear();
			for ( const actor of actors ) {
				order.push( actor.gid );
				next.set( actor.gid, actor );
				const previous = sent.get( actor.gid );
				if ( !previous ) {
					changes.push( { gid: actor.gid, whole: actor } );
					continue;
				}
				if ( previous === actor ) continue;
				let set: Record<string, unknown> | undefined;
				const unset: string[] = [];
				const fields = actor as unknown as Record<string, unknown>,
					before = previous as unknown as Record<string, unknown>;
				for ( const key in fields ) {
					if ( !Object.hasOwn( fields, key ) ) continue;
					if ( Object.hasOwn( before, key ) && sameData( fields[key], before[key] ) ) continue;
					(set ??= {})[key] = fields[key];
				}
				for ( const key in before ) {
					if ( Object.hasOwn( before, key ) && !Object.hasOwn( fields, key ) ) unset.push( key );
				}
				if ( set || unset.length ) changes.push( { gid: actor.gid, set: set ?? {}, unset } );
			}
			const swap = sent;
			sent = next;
			next = swap;
			return { order, changes };
		}
	};
}

/*
================
createActorDecoder

Render thread: the actors as last received, rebuilt from each frame.
================
*/
export function createActorDecoder() {
	let kept = new Map<number, CharacterActor>(), next = new Map<number, CharacterActor>();
	return {
		decode( frame: ActorFrame ): CharacterActor[] {
			next.clear();
			for ( const change of frame.changes ) {
				if ( "whole" in change ) {
					next.set( change.gid, change.whole );
					continue;
				}
				const previous = kept.get( change.gid );
				if ( !previous ) throw Error( "Render thread actor " + change.gid + " was never sent" );
				const actor = { ...previous, ...change.set } as Record<string, unknown>;
				for ( const key of change.unset ) delete actor[key];
				next.set( change.gid, actor as unknown as CharacterActor );
			}
			const actors: CharacterActor[] = [];
			for ( const gid of frame.order ) {
				let actor = next.get( gid );
				if ( !actor ) {
					actor = kept.get( gid );
					if ( !actor ) throw Error( "Render thread actor " + gid + " was never sent" );
					next.set( gid, actor );
				}
				actors.push( actor );
			}
			const swap = kept;
			kept = next;
			next = swap;
			return actors;
		}
	};
}

/*
================
createUiEncoder

Main thread: the quads as last sent, by index.
================
*/
export function createUiEncoder( same: ( a: UiQuad, b: UiQuad ) => boolean ) {
	let sent: readonly UiQuad[] = [];
	return {
		encode( scene: UiScene | null ): UiFrame {
			if ( !scene ) {
				sent = [];
				return null;
			}
			const changes: [number, UiQuad][] = [];
			for ( let i = 0; i < scene.quads.length; i++ ) {
				const quad = scene.quads[i]!, previous = sent[i];
				if ( previous === quad || previous && same( previous, quad ) ) continue;
				changes.push( [ i, quad ] );
			}
			sent = scene.quads;
			return {
				revision: scene.revision,
				width: scene.width,
				height: scene.height,
				...(scene.damageText !== undefined ? { damageText: scene.damageText } : {}),
				length: scene.quads.length,
				changes
			};
		}
	};
}

/*
================
createUiDecoder

Render thread: the quads as last received; unchanged ones keep their object.
================
*/
export function createUiDecoder() {
	let quads: UiQuad[] = [];
	return {
		decode( frame: UiFrame ): UiScene | null {
			if ( !frame ) {
				quads = [];
				return null;
			}
			const next = quads.slice( 0, frame.length );
			next.length = frame.length;
			for ( const [index, quad] of frame.changes ) next[index] = quad;
			for ( let i = 0; i < next.length; i++ ) {
				if ( !next[i] ) throw Error( "Render thread UI quad " + i + " was never sent" );
			}
			quads = next;
			return {
				revision: frame.revision,
				width: frame.width,
				height: frame.height,
				...(frame.damageText !== undefined ? { damageText: frame.damageText } : {}),
				quads: next
			};
		}
	};
}
