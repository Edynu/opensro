/*
===========================================================================

attached-host-motion.test.mjs - tests for effects.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	pickAttachedMotionClips,
	attachedMotionRequests
} from "../../../../scripts/build/char/attachedMotionClips.mjs";

const { createCharacterEffects } = await import(
	sourceFileUrl( "src/engine/runtime/characters/effects/effects.ts" ).href
);
test("native attached motion uses the first table-4 entry and requested set before DEFAULT", () => {
	const request = attachedMotionRequests( [ {
		aniGroup: "SWORD",
		actionWaitAnims: [ "ANI_HANDLOOF", "ANI_ATTACK1" ]
	} ] );
	assert.equal( request[0].id, 188 );
	const bsr = {
		animationSets: [ { name: "default", states: [ { stateId: 188, animationPath: "default.ban" } ] }, {
			name: "sword",
			states: [ { stateId: 188, animationPath: "sword.ban" } ]
		} ]
	};
	assert.equal( pickAttachedMotionClips( bsr, request )[0].path, "sword.ban" );
	bsr.animationSets.pop();
	assert.equal( pickAttachedMotionClips( bsr, request )[0].path, "default.ban" );
	bsr.animationSets = [];
	assert.deepEqual( pickAttachedMotionClips( bsr, request ), [] );
});
test("host motion starts only on phase zero or overlap and retains its explicit stop blend", () => {
	for ( const phase of [ 1, 2 ] ) {
		for ( const overlap of [ false, true ] ) {
			let id = 0;
			const jobs = new Map(),
				record = { clips: [], stages: [], overlap, attachedMotion: { set: "default", id: 188 } };
			const owner = createCharacterEffects(
				{
					available: () => 4,
					request( url, limit, decode ) {
						jobs.set(
							++id,
							decode === "effects" ?
								{ kind: "effects", catalog: { 7: record } } :
								{
									kind: "bytes",
									buffer: new TextEncoder().encode(
										JSON.stringify( { format: "sro-skill-stage-models", models: {} } )
									).buffer
								}
						);
						return id;
					},
					take( id ) {
						const r = jobs.get( id );
						jobs.delete( id );
						return r;
					},
					cancel() {}
				},
				"http://fixture.invalid",
				() => {},
				{ range: () => 0 }
			);
			const entity = { gid: 1, regionId: 257, x: 0, y: 0, z: 0, heading: 0 },
				actor = { gid: 1, pose: { ...entity, yaw: 0 } },
				game = { casts: [], attachedEffects: [ { gid: 1, skill: 7, token: 1, phase } ] };
			const step = at => owner.step( [ entity ], game, at, () => true, () => 1, [], undefined, [ actor ] );
			step( 0 );
			step( .1 );
			step( .2 );
			assert.equal( owner.hostMotions( 1 ).length, Number( phase === 1 || overlap ) );
			game.attachedEffects = [];
			step( 1 );
			assert.equal( owner.hostMotions( 1 )[0]?.stoppedAt, phase === 1 || overlap ? 1 : undefined );
			step( 1.1 );
			assert.equal( owner.hostMotions( 1 ).length, Number( phase === 1 || overlap ) );
			step( 1.21 );
			assert.deepEqual( owner.hostMotions( 1 ), [] );
			owner.dispose();
		}
	}
});
