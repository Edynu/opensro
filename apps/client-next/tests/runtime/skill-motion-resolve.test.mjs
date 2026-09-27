/*
===========================================================================

skill-motion-resolve.test.mjs - tests for skill-motion-resolve.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
const { skillMotionResolveAnimation } = await (async () => {
	return import( sourceFileUrl( "src/engine/foundation/animation/skill-motion-resolve.ts" ).href );
})();
const mobAttack1 = {
	stateId: 2,
	durationMs: 1666,
	soundEvents: [],
	trackEvents: [ { cursorMs: 100, eventCode: 1, param0: 0, param1: 0 } ],
	timeWarpCurve: { scale: 0, records: [] }
};
const mobAttack2 = {
	stateId: 5,
	durationMs: 2566,
	soundEvents: [],
	trackEvents: [],
	timeWarpCurve: { scale: 0, records: [] }
};
const mobClips = [ "stand", "walk", "attack1", "attack2", "death" ];
const mobBody = { attack1: mobAttack1, attack2: mobAttack2 };
test("8E7150 DEFAULT retry resolves mob basic attacks from resident GLB branches", () => {
	const sword = skillMotionResolveAnimation( { role: "native:sword:2", clips: mobClips, bodyStates: mobBody } );
	assert.deepEqual( sword, { clip: "attack1", definition: mobAttack1 } );
	const defaultShot = skillMotionResolveAnimation( {
		role: "native:default:5",
		clips: mobClips,
		bodyStates: mobBody
	} );
	assert.deepEqual( defaultShot, { clip: "attack2", definition: mobAttack2 } );
});
test("published BAN admission keeps native clip identity on player bodies", () => {
	const definition = { durationMs: 900, soundEvents: [], trackEvents: [], timeWarpCurve: { scale: 0, records: [] } };
	const role = "native:sword:26", banUrl = "/assets/anim/CHAR/skill_1.ban";
	const resolved = skillMotionResolveAnimation( {
		role,
		clips: [ "stand" ],
		catalogStates: { [role]: definition },
		motionUrls: new Map( [ [ role, banUrl ] ] )
	} );
	assert.deepEqual( resolved, { clip: role, definition, banUrl } );
});
test("authored set miss without DEFAULT state remains an admission failure", () => {
	assert.equal(
		skillMotionResolveAnimation( { role: "native:sword:26", clips: mobClips, bodyStates: mobBody } ),
		undefined
	);
});
