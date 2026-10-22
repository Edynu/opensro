/*
===========================================================================

motion-names.test.mjs - actor motion's per-frame names, made once

runtime/characters/motion-names.ts answers what actor-motion.ts asked of
a body's clip list (includes) and the names it built (replaceAll, the
native role and preview idle templates) every frame. The answers must be
those, and the same string each time it is asked again.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { createMotionNames } = await import( "../../src/engine/runtime/characters/motion-names.ts" );

test("a clip set answers as the clip list's includes, per list", () => {
	const names = createMotionNames();
	const clips = Object.freeze( [ "stand", "run", "native:sword:7", "", "Stand" ] );
	for ( const name of [ "stand", "run", "walk", "native:sword:7", "native:sword:1", "", "Stand", "STAND" ] ) {
		assert.equal( names.clipSet( clips ).has( name ), clips.includes( name ), name );
	}
	assert.equal( names.clipSet( clips ), names.clipSet( clips ) );
	const other = Object.freeze( [ "walk" ] );
	assert.equal( names.clipSet( other ).has( "walk" ), true );
	assert.equal( names.clipSet( other ).has( "stand" ), false );
});

test("motion names are the strings actor motion built, the same string each time", () => {
	const names = createMotionNames();
	for ( const set of [ "sword", "onehand-sword", "twohand-staff", "dual-axe", "" ] ) {
		assert.equal( names.motionSet( set ), set.replaceAll( "-", "_" ) );
		assert.equal( names.motionSet( set ), names.motionSet( set ) );
		for ( const state of [ 0, 1, 6, 7, 80 ] ) {
			const role = names.motionSet( set );
			assert.equal( names.nativeRole( role, state ), `native:${role}:${state}` );
			assert.equal( names.nativeRole( role, state ), names.nativeRole( role, state ) );
		}
	}
	for ( const set of [ "bow", "onehand-staff", undefined ] ) {
		assert.equal( names.previewIdle( set ), "preview-state0-" + set );
	}
	assert.equal( names.previewIdle( undefined ), "preview-state0-undefined" );
});
