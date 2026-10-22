/*
===========================================================================

clip-catalogs.ts - values derived once per clip catalog, grown with it

A body's clip catalog (CharacterModel.clips) grows one clip at a time as
lazy actions are admitted: each admission is a new array whose prefix is
the previous one (character-render-plan.ts isCharacterAnimationExtension),
shared by every assembly of the body. A value derived from every clip
(the GPU clip set, the bounds envelope) is kept per array here and built
from its prefix's value plus the new clips, not from every clip again: in
a 200-player town, rescanning whole catalogs on each admitted action was
1.2 ms a frame on the main thread (2026-10-22).

===========================================================================
*/
import type { CharacterClip } from "@/engine/contracts/character";

/*
================
ClipCatalogCache

The value of a catalog, built or extended on first use.
================
*/
export type ClipCatalogCache<T> = ( clips: readonly CharacterClip[] ) => T;

/*
================
createClipCatalogCache

build derives a catalog's value from all its clips; extend derives it from
the value of its first from clips (a catalog seen before) and the rest.
The newest catalog seen for each first clip is the candidate prefix.
================
*/
export function createClipCatalogCache<T>(
	build: ( clips: readonly CharacterClip[] ) => T,
	extend: ( previous: T, clips: readonly CharacterClip[], from: number ) => T
): ClipCatalogCache<T> {
	const values = new WeakMap<readonly CharacterClip[], T>();
	const newest = new WeakMap<CharacterClip, { clips: readonly CharacterClip[]; value: T; }>();
	return clips => {
		if ( values.has( clips ) ) return values.get( clips ) as T;
		const first = clips[0], latest = first ? newest.get( first ) : undefined;
		let prefix = !!latest && latest.clips.length < clips.length;
		for ( let i = 0; prefix && i < latest!.clips.length; i++ ) prefix = latest!.clips[i] === clips[i];
		const value = prefix ? extend( latest!.value, clips, latest!.clips.length ) : build( clips );
		values.set( clips, value );
		if ( first ) newest.set( first, { clips, value } );
		return value;
	};
}
