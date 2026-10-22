/*
===========================================================================

same-value.ts - structural equality of plain data

Owners that receive copies (a portrait's retained actors, the character
worker's answers posted from another thread) tell a changed value from an
unchanged one by structure, since a copy never shares identity.

===========================================================================
*/

/*
================
sameValue

Structural equality of plain actor data (numbers, strings, arrays, typed
arrays, plain objects). Snapshots are owned deep copies, so an in-place
edit of a source snapshot can never hide behind shared identity.
================
*/
export function sameValue( a: unknown, b: unknown, skip?: ReadonlySet<string> ): boolean {
	if ( Object.is( a, b ) ) return true;
	if ( typeof a !== "object" || typeof b !== "object" || a === null || b === null ) return false;
	if ( ArrayBuffer.isView( a ) || ArrayBuffer.isView( b ) ) {
		if ( !ArrayBuffer.isView( a ) || !ArrayBuffer.isView( b ) || a.constructor !== b.constructor ) return false;
		const x = a as unknown as ArrayLike<number>, y = b as unknown as ArrayLike<number>;
		if ( x.length !== y.length ) return false;
		for ( let i = 0; i < x.length; i++ ) if ( !Object.is( x[i], y[i] ) ) return false;
		return true;
	}
	if ( Array.isArray( a ) !== Array.isArray( b ) ) return false;
	const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
	let count = 0;
	for ( const key in x ) {
		if ( skip?.has( key ) || x[key] === undefined ) continue;
		count++;
		if ( !sameValue( x[key], y[key] ) ) return false;
	}
	for ( const key in y ) if ( !skip?.has( key ) && y[key] !== undefined ) count--;
	return count === 0;
}
