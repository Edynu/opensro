/*
===========================================================================

motion-names.ts - the names actor motion asks for every frame, made once

actor-motion.ts present asks every character, every frame, whether its
body has a clip (a list that runs to hundreds of names) and builds the
same motion names again: a weapon set's motion set, a motion set's native
state roles and a weapon set's preview idle. This keeps a set per readonly
clip list and each name once, so a frame neither scans the lists nor
builds new strings, and the catalog lookups keyed by a name see the same
string (whose hash it keeps) every frame. Owned by one actor motion; the
answers are the ones the scans and the string building gave.

===========================================================================
*/

/*
================
createMotionNames
================
*/
export function createMotionNames() {
	const clipSets = new WeakMap<readonly string[], ReadonlySet<string>>();
	const motionSets = new Map<string, string>(), nativeRoles = new Map<string, string[]>();
	const previewIdles = new Map<string | undefined, string>();
	return {
		/*
		================
		clipSet

		A body's clip names as a set. Published clip lists are never edited
		in place, so the list itself keys it.
		================
		*/
		clipSet( names: readonly string[] ): ReadonlySet<string> {
			let set = clipSets.get( names );
			if ( !set ) {
				set = new Set( names );
				clipSets.set( names, set );
			}
			return set;
		},
		/*
		================
		motionSet

		A weapon set's motion set: its dashes as underscores.
		================
		*/
		motionSet( weaponSet: string ): string {
			let set = motionSets.get( weaponSet );
			if ( set === undefined ) {
				set = weaponSet.replaceAll( "-", "_" );
				motionSets.set( weaponSet, set );
			}
			return set;
		},
		/*
		================
		nativeRole

		A motion set's native state role, "native:set:state".
		================
		*/
		nativeRole( set: string, stateId: number ): string {
			let roles = nativeRoles.get( set );
			if ( !roles ) {
				roles = [];
				nativeRoles.set( set, roles );
			}
			return roles[stateId] ??= `native:${set}:${stateId}`;
		},
		/*
		================
		previewIdle

		A weapon set's preview idle, "preview-state0-" and the set (an
		absent one reads "undefined", as the concatenation did).
		================
		*/
		previewIdle( weaponSet: string | undefined ): string {
			let idle = previewIdles.get( weaponSet );
			if ( idle === undefined ) {
				idle = "preview-state0-" + weaponSet;
				previewIdles.set( weaponSet, idle );
			}
			return idle;
		}
	};
}
