/*
===========================================================================

palette-streams.test.mjs - tests for palette-streams.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
const { createPaletteStreams } = await import(
	sourceFileUrl( "src/engine/runtime/renderer/characters/palette-streams.ts" ).href
);
test("exact pose and binding identities share data while mappings and revisions remain independent", () => {
	const p = { joints: [ 0, 1 ], inverseBind: new Float32Array( 32 ) },
		q = { ...p, inverseBind: p.inverseBind.slice() },
		r = { ...p, joints: [ 1, 0 ] };
	const bank = createPaletteStreams( { primitives: [ p, q, r ] }, 4 );
	let copies = 0;
	const pose = seed => ({
		version: 1,
		revision() {
			return this.version;
		},
		palette( primitive, out, offset ) {
			copies++;
			out.fill( seed + this.version + (primitive === r ? 10 : 0), offset, offset + 32 );
		}
	});
	const a = pose( 1 ), b = pose( 5 );
	bank.update( [ a, a, b ] );
	assert.equal( copies, 4 );
	assert.equal( bank.streams[0], bank.streams[1] );
	assert.notEqual( bank.streams[0], bank.streams[2] );
	assert.deepEqual( [ ...bank.streams[0].offsets.subarray( 0, 3 ) ], [ 0, 0, 2 ] );
	assert.equal( bank.streams[0].length, 64 );
	const revision = bank.streams[0].revision;
	bank.update( [ a, a, b ] );
	assert.equal( copies, 4 );
	assert.equal( bank.streams[0].revision, revision );
	b.version++;
	bank.update( [ a, b, a ] );
	assert.equal( copies, 6 );
	assert.deepEqual( [ ...bank.streams[0].offsets.subarray( 0, 3 ) ], [ 0, 2, 0 ] );
	assert.ok( bank.streams[0].mappingChanged );
	for ( let i = 0; i < 3; i++ ) {
		const source = [ a, b, a ][i], offset = bank.streams[0].offsets[i] * 16;
		assert.equal( bank.streams[0].data[offset], (source === a ? 1 : 5) + source.version );
	}
	bank.update( [ b ] );
	assert.equal( bank.streams[0].length, 32 );
	assert.equal( bank.streams[0].previous.length, 1 );
	assert.throws( () => bank.update( [ a, a, a, a, a ] ), /capacity/ );
});
