/*
===========================================================================

quest-tutorial-wire.test.mjs - tests for the client modules it imports

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

async function load( entry ) {
	return import( sourceFileUrl( entry ).href );
}
const { decodeQuest } = await load( "src/engine/foundation/gameplay/quest.ts" );
const { questObjectivePresentation } = await load( "src/engine/foundation/ui/quest-presentation.ts" );
const fixture = JSON.parse( readFileSync( "../server/internal/game/quest/tutorial_wire_fixture.json", "utf8" ) );
const text = fixture.text;

test("server tutorial stages decode without leaking persistence fields and render native objectives", () => {
	for ( const row of fixture.frames ) {
		const decoded = decodeQuest( Buffer.from( row.payloadHex, "hex" ) );
		assert.equal( decoded.refId, fixture.questId );
		assert.equal( decoded.op, row.op );
		if ( row.op === 3 ) {
			assert.equal( decoded.record, undefined );
			continue;
		}
		assert.equal( decoded.record.u08, 0x11 );
		assert.equal( "stage" in decoded.record, false );
		const node = decoded.record.contents[0];
		assert.equal( node.description, row.description );
		const view = questObjectivePresentation( node, text );
		assert.equal( view.description, text[row.description].replace( "%d", String( row.progress ) ) );
		assert.equal( view.statusKey, row.progress === 30 ? "UIIT_STT_QUEST_END" : "UIIT_STT_QUEST_ING" );
		assert.throws( () => decodeQuest( Buffer.from( row.payloadHex + "00", "hex" ) ), /trailing/ );
	}
});
