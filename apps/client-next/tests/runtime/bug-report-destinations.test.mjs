/*
===========================================================================

bug-report-destinations.test.mjs - disclose the Agent's report destinations

Legacy Agents provide no destination list. Do not promise Discord delivery
when the operator stores reports on the game server instead.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { deliveryNote } = await import( "../../src/engine/runtime/bug-report/dialog.ts" );

test("report disclosure follows Discord, directory and combined delivery", () => {
	assert.match( deliveryNote( [ "discord" ] ), /Discord/ );
	assert.doesNotMatch( deliveryNote( [ "discord" ] ), /saved on/ );
	assert.match( deliveryNote( [ "directory" ] ), /saved on the game server/ );
	assert.doesNotMatch( deliveryNote( [ "directory" ] ), /Discord/ );
	assert.match( deliveryNote( [ "directory", "discord" ] ), /Discord.*saved on the game server/ );
	assert.equal( deliveryNote( [ "discord", "directory" ] ), deliveryNote( [ "directory", "discord" ] ) );
});

test("legacy or unknown destinations do not invent storage claims", () => {
	for ( const destinations of [ undefined, [], [ "future-sink" ] ] ) {
		assert.equal( deliveryNote( destinations ), "The report and its attachments are sent to the team." );
	}
});
