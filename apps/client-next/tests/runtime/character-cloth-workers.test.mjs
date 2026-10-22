/*
===========================================================================

character-cloth-workers.test.mjs - the renderer's cloth on the frame workers

With Worker threads on, the world's characters step their cloth in one
frame-worker phase, each wearer from its own random stream
(foundation/animation/cloth-wearers.ts). Driven through the shipped renderer
by the cloth palette fixture (membership changes, model swaps, fades,
tints, layered clips, a device invalidation and disposal), cloth must stop
drawing from the shared presentation stream and leave every other
primitive's draws as the object path draws them (the frozen digests of
character-cloth-palette.test.mjs), and real worker threads must draw what
one thread draws.

===========================================================================
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { captureClothPalettes } from "../helpers/character-cloth-palette-fixture.mjs";
import { createInlineWorkers, createThreadedWorkers } from "../helpers/frame-kernel-threads.mjs";

const baseline = JSON.parse(
	readFileSync( new URL( "../fixtures/cloth/palette-owner-before.json", import.meta.url ), "utf8" )
);
const CLOTH = [ "cloth-a", "cloth-b" ];

test("cloth on the frame workers leaves the shared stream and every other primitive as it was", () => {
	const workers = createInlineWorkers();
	const actual = captureClothPalettes( false, false, { frameWorkers: workers } );
	assert.equal( actual.frames.length, baseline.frames.length );
	assert.ok( workers.phases() > 0, "cloth stepped in frame-worker phases" );
	for ( const [frame, row] of actual.frames.entries() ) {
		assert.equal( row.randomCalls, 0, `frame ${frame}: cloth drew from the shared stream` );
		for ( const [name, digest] of Object.entries( row.primitives ) ) {
			if ( CLOTH.includes( name ) ) continue;
			assert.equal( digest, baseline.primitives[name][frame], `frame ${frame}, primitive ${name}` );
		}
	}
	for ( const name of CLOTH ) {
		const drawn = actual.frames.filter( row => row.draws > 0 ).map( row => row.primitives[name] );
		assert.ok( new Set( drawn ).size > drawn.length / 2, `${name} keeps moving` );
	}
});

test("cloth groups built first still leave every draw in its place", () => {
	const options = { mixed: true, variants: true, moving: true };
	const workers = captureClothPalettes( false, false, { ...options, frameWorkers: createInlineWorkers() } );
	const object = captureClothPalettes( false, false, options );
	assert.deepEqual( workers.frames.map( row => row.order ), object.frames.map( row => row.order ) );
	assert.ok( object.frames.some( row => new Set( row.order.map( draw => draw.split( "@" )[1] ) ).size > 1 ) );
});

test("a frame's cloth goes up at finishCloth, and a frame that never finished at the next prepare", () => {
	const finished = captureClothPalettes( false, false, { frameWorkers: createInlineWorkers() } );
	const held = captureClothPalettes( false, false, { frameWorkers: createInlineWorkers(), holdCloth: true } );
	let lagged = 0, current = 0;
	for ( let frame = 1; frame < finished.frames.length; frame++ ) {
		const before = finished.frames[frame - 1], now = finished.frames[frame];
		// The same draws in both frames: a new draw starts from its upload.
		if ( !now.draws || before.drawIds.join() !== now.drawIds.join() ) continue;
		for ( const name of CLOTH ) {
			assert.equal( held.frames[frame].vertices[name], before.vertices[name], `frame ${frame}, ${name}` );
			lagged++;
			if ( now.vertices[name] !== before.vertices[name] ) current++;
		}
	}
	assert.ok( lagged > 20 && current > lagged / 2, `compared ${lagged}, moved ${current}` );
});

test("cloth on worker threads draws as cloth on one thread", async () => {
	const threads = await createThreadedWorkers( 4 );
	try {
		const inline = captureClothPalettes( false, false, { frameWorkers: createInlineWorkers() } );
		const threaded = captureClothPalettes( false, false, { frameWorkers: threads } );
		assert.deepEqual( threaded.frames.map( row => row.digest ), inline.frames.map( row => row.digest ) );
		assert.ok( threads.phases() > 0 );
	} finally {
		await threads.close();
	}
});
