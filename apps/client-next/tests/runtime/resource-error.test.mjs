/*
===========================================================================

resource-error.test.mjs - tests for resource-error.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { resourceErrorLines } = await import( sourceFileUrl( "src/engine/foundation/ui/resource-error.ts" ).href );
test("in-game resource diagnostics wrap the complete filename using glyph widths", () => {
	const message =
		"UI image unavailable; retrying: /assets/images/Media_extracted/minimap/77x111.png: Error: Asset HTTP 503";
	const lines = resourceErrorLines( message, 80, s => s.length * 7 );
	assert.equal( lines.join( "" ), message );
	assert.ok( lines.every( l => l.length * 7 <= 80 ) );
	assert.ok( resourceErrorLines( "x".repeat( 600 ), 10000, s => s.length ).every( l => l.length <= 240 ) );
});
