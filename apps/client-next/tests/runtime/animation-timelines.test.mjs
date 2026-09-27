/*
===========================================================================

animation-timelines.test.mjs - tests for animation-timelines.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { createAnimationTimelines } = await import(
	sourceFileUrl( "src/engine/foundation/animation/animation-timelines.ts" ).href
);

test("shared clocks match a stateless linear-search oracle through seeks, duplicate keys and endpoints", () => {
	const arrays = [ [ .1, .3, .3, .9, 1.8 ], [ .1, .3, .3, .9, 1.8 ], [ 0, .2, .7, 2 ], [ 1 ], [ 0, 1 ], [ -0, 1 ] ]
		.map( values => Float32Array.from( values ) );
	const plan = createAnimationTimelines( { channels: arrays.map( times => ({ times }) ) } );
	assert.equal( plan.channels[0], plan.channels[1] );
	assert.notEqual( plan.channels[4], plan.channels[5] );
	let seed = 17;
	for (
		const time of [
			...arrays.flatMap( values => [ ...values ] ),
			0,
			10,
			...Array.from( { length: 2000 }, () => {
				seed = (Math.imul( seed, 1664525 ) + 1013904223) >>> 0;
				return seed / 2 ** 32 * 3;
			} )
		]
	) {
		plan.sample( time );
		for ( let i = 0; i < arrays.length; i++ ) {
			const times = arrays[i];
			let low = 0;
			for ( let key = 0; key < times.length; key++ ) if ( times[key] <= time ) low = key;
			const next = Math.min( low + 1, times.length - 1 ),
				span = times[next] - times[low],
				fraction = span ? Math.max( 0, Math.min( 1, (time - times[low]) / span ) ) : 0;
			assert.deepEqual( [
				plan.channels[i].low,
				plan.channels[i].next,
				plan.channels[i].span,
				plan.channels[i].fraction
			], [ low, next, span, fraction ] );
		}
	}
});

test("pose owners keep independent clocks even when they share immutable clip data", () => {
	const clip = { channels: [ { times: Float32Array.of( 0, 1, 2 ) } ] },
		a = createAnimationTimelines( clip ),
		b = createAnimationTimelines( clip );
	a.sample( .25 );
	b.sample( 1.75 );
	assert.equal( a.channels[0].fraction, .25 );
	assert.equal( b.channels[0].fraction, .75 );
});

test("a timestamp hash collision never aliases different authored clocks", () => {
	const a = Float32Array.of( 0, 1 ), b = new Float32Array( Uint32Array.of( 1, 1048577683 ).buffer );
	const hash = times => {
		let h = 2166136261;
		for ( const word of new Uint32Array( times.buffer ) ) h = Math.imul( h ^ word, 16777619 );
		return h;
	};
	assert.equal( hash( a ), hash( b ) );
	const plan = createAnimationTimelines( { channels: [ { times: a }, { times: b } ] } );
	assert.notEqual( plan.channels[0], plan.channels[1] );
	plan.sample( .125 );
	assert.notEqual( plan.channels[0].fraction, plan.channels[1].fraction );
});
