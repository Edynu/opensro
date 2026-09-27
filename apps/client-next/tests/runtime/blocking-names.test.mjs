/*
===========================================================================

blocking-names.test.mjs - tests for character-create.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { creationNameRules, creationNameError, checkedNameError } = await import(
	sourceFileUrl( "src/engine/foundation/ui/character-create.ts" ).href
);
test("native type 1 is a whole word, type 2 a substring; whisper does not inherit creation length rules", () => {
	const data = "#ALLOW_ID_TABLE\t0x0061\t0x007A\n#ALLOW_ID_TABLE\t0x0020\t0x0020\nwhole\t1\npart\t2\n";
	const r = creationNameRules( new TextEncoder().encode( data ).buffer );
	assert.equal( checkedNameError( "A", r ), null );
	assert.equal( checkedNameError( "abcdefghijklm", r ), null );
	assert.ok( creationNameError( "A", r ) );
	assert.ok( creationNameError( "abcdefghijklm", r ) );
	assert.ok( checkedNameError( "WHOLE", r ) );
	assert.equal( checkedNameError( "wholegrain", r ), null );
	assert.ok( checkedNameError( "a WHOLE b", r ) );
	assert.ok( checkedNameError( "partial", r ) );
	assert.ok( checkedNameError( "[GM]", r ) );
});
