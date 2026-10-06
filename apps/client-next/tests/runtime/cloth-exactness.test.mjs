/*
===========================================================================

cloth-exactness.test.mjs - bit-exact solver output across varied frame debt

The fixture was captured from a2e44f7b before optimizing the hot loop.
Every frame contributes its Float32 bytes, including disabled frames and
stalls. This proves preservation of that implementation, not native parity.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { clothCase } from "../helpers/cloth-cases.mjs";
const { createCloth } = await import( "../../src/engine/foundation/animation/cloth.ts" );
const capture = JSON.parse( readFileSync( new URL( "../fixtures/cloth/before.json", import.meta.url ), "utf8" ) );

test("cloth optimization preserves every position bit and shared RNG consumption", () => {
	for ( const row of capture.rows ) {
		const fixture = clothCase( row.seed ), sim = createCloth( fixture.data, fixture.rest );
		const hash = createHash( "sha256" );
		for ( let frame = 0; frame < fixture.frames; frame++ ) {
			const positions = sim.advance( fixture.input( frame ) );
			hash.update( new Uint8Array( positions.buffer, positions.byteOffset, positions.byteLength ) );
		}
		assert.equal( hash.digest( "hex" ), row.sha256, `positions for seed ${row.seed}` );
		assert.equal( fixture.calls(), row.randomCalls, `RNG consumption for seed ${row.seed}` );
	}
});
