/*
===========================================================================

capture-character-cloth-palette.mjs - freeze the pre-sharing renderer oracle

Run from a checkout whose apps/client-next/src tree matches BASELINE_COMMIT.
Restore this generator and character-cloth-palette-fixture.mjs into that
checkout from the commit introducing the oracle, without replacing src.
Command from apps/client-next: node tests/helpers/capture-character-cloth-palette.mjs

The fixture helper imports that checkout's exact renderer and dependencies
through the shared native loader. Never regenerate with candidate sources.

===========================================================================
*/
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { captureClothPalettes } from "./character-cloth-palette-fixture.mjs";
const BASELINE_COMMIT = "a0adfab4026181ccef4c8215abf2346b0f518860";
const root = fileURLToPath( new URL( "../../../../", import.meta.url ) );
execFileSync( "git", [ "diff", "--exit-code", BASELINE_COMMIT, "--", "apps/client-next/src" ], {
	cwd: root,
	stdio: "pipe"
} );
const result = captureClothPalettes();
const fixture = {
	provenance: {
		sourceCommit: BASELINE_COMMIT,
		owner: "apps/client-next/src/engine/runtime/renderer/characters/characters.ts",
		command: "node tests/helpers/capture-character-cloth-palette.mjs",
		scope:
			"Exact per-primitive instance transforms, palettes, cloth vertices and materials; whole-frame order and presentation RNG; real geometry resource validation."
	},
	boneWriteBytes: result.boneWriteBytes,
	frames: result.frames.map( frame => frame.digest ),
	primitives: Object.fromEntries(
		Object.keys( result.frames[0].primitives ).map( name => [
			name,
			result.frames.map( frame => frame.primitives[name] )
		] )
	)
};
writeFileSync(
	new URL( "../fixtures/cloth/palette-owner-before.json", import.meta.url ),
	JSON.stringify( fixture, null, 2 ) + "\n"
);
console.log(
	JSON.stringify( {
		frames: result.frames.length,
		boneWriteBytes: result.boneWriteBytes,
		sourceCommit: BASELINE_COMMIT
	} )
);
