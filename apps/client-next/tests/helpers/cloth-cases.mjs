/*
===========================================================================

cloth-cases.mjs - deterministic moving cloth inputs for equivalence checks

===========================================================================
*/
const VERTICES = 24;
const FRAMES = 120;

/*
================
clothCase

Exercise ordered and reversed constraints, non-binary pins, gusts, moving
anchors, option changes and time debt without depending on live assets.
================
*/
export function clothCase( seed ) {
	let state = seed, calls = 0;
	const random = () => {
		calls++;
		state = (Math.imul( state, 1664525 ) + 1013904223) >>> 0;
		return state >>> 16;
	};
	const rest = new Float32Array( VERTICES * 3 );
	for ( let i = 0; i < VERTICES; i++ ) rest.set( [ i % 6, Math.floor( i / 6 ), (i % 3) / 7 ], i * 3 );
	/** @type {import("../../src/engine/foundation/animation/cloth.ts").ClothData} */
	const data = {
		mobility: Array.from( { length: VERTICES }, ( _, i ) => i % 6 ? (i + seed) / 13 : 0 ),
		pins: Array.from( { length: VERTICES }, ( _, i ) => i % 6 ? (i % 7 === 0 ? 2 : 0) : 1 ),
		constraints: Array.from( { length: VERTICES - 1 }, ( _, i ) => [ i, i + 1, .7 + (i % 4) / 3 ] ),
		order: Array.from( { length: VERTICES - 1 }, ( _, i ) => seed % 2 ? i : VERTICES - 2 - i ),
		force: seed % 3 ? null : [ .3, -.2, .7 ],
		gravity: (seed % 5) / 3,
		gravityMobility: .2,
		windMobility: .1,
		damping: .85 + (seed % 9) / 100,
		windPeriod: 1 + seed % 7
	};
	return {
		data,
		rest,
		calls: () => calls,
		frames: FRAMES,
		input( frame ) {
			const anchors = rest.slice();
			for ( let i = 0; i < anchors.length; i++ ) anchors[i] += Math.sin( frame / 9 + i ) / 3;
			return {
				anchors,
				deltaMs: [ 0, 16, 33, 50, 100, 150, 300, 1000 ][frame % 8],
				enabled: frame % 29 !== 0,
				direction: [ Math.sin( frame ), .2, Math.cos( frame ) ],
				speed: [ -1, 0, .01, .2, 1, 8 ][frame % 6],
				random
			};
		}
	};
}
