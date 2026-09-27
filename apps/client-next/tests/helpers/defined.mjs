/*
===========================================================================

defined.mjs - assert a test value is present, and tell the type checker

Tests often read a value that the types allow to be missing (a Map lookup,
an optional field, a DOM query) and then use it. If it were missing, the
test would already fail with a TypeError at that point; defined() fails at
the same point with a message naming what was missing, and narrows the type
so the test type-checks under strict null checks.

===========================================================================
*/

/*
================
defined
================
*/
/**
 * @template T
 * @param {T} value
 * @param {string} [what]
 * @returns {NonNullable<T>}
 */
export function defined( value, what = "value" ) {
	if ( value === null || value === undefined ) {
		throw new Error( `expected ${what} to be defined, got ${value}` );
	}
	return /** @type {NonNullable<T>} */ (value);
}
