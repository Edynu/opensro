/*
===========================================================================

perf-tool-imports.test.mjs - source the perf tools load without the alias

tools/perf/core/client.mjs and the benches import a few client modules
statically, with Node's type stripping and no @/ alias loader. Such a
module may import only types through the alias: one value import made the
town crowd bench fail to start (2026-10-22). Each is loaded here in a
fresh Node with no loader.

===========================================================================
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Modules a perf tool imports before any loader is registered.
const MODULES = [
	"src/engine/foundation/ui/experimental-options.ts",
	"src/engine/foundation/rendering/video-options.ts",
	"src/engine/foundation/release/protocol.ts",
	"src/engine/runtime/simulation/worker/network/codec/codec.ts"
];

test("the modules perf tools import load without the @/ alias loader", () => {
	for ( const module of MODULES ) {
		const url = new URL( `../../${module}`, import.meta.url ).href;
		const output = execFileSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`const m = await import( ${JSON.stringify( url )} ); console.log( Object.keys( m ).length );`
			],
			{ encoding: "utf8", stdio: [ "ignore", "pipe", "pipe" ] }
		);
		assert.ok( Number( output.trim() ) > 0, `${module} exports nothing` );
	}
});
