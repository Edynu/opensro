/*
===========================================================================

audio-options.test.mjs - native volume compatibility and the quiet range

Exercise shipped functions against an independent native oracle and real
JSON records. Slider positions never reinterpret saved native integer levels.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { audioAmplitude, audioOptions, initialAudioOptions, defaultAudioOptions } = await import(
	"../../src/engine/foundation/audio/options.ts"
);
const { AUDIO_SLIDER_MAX, audioSliderLevel, audioSliderPosition, stepAudioLevel, audioLevelText } = await import(
	"../../src/engine/foundation/audio/volume-control.ts"
);

/*
================
decibels
================
*/
function decibels( amplitude ) {
	return 20 * Math.log10( amplitude );
}

/*
================
native compatibility
================
*/
test("all 100 original levels match the original expression exactly", () => {
	for ( let level = 1; level <= 100; level++ ) {
		assert.equal( audioAmplitude( level, false ), Math.pow( 10, (20 * level - 2000) / 2000 ) );
		assert.equal( audioSliderLevel( audioSliderPosition( level ) ), level );
	}
	assert.equal( audioAmplitude( 1, false ), Math.pow( 10, -.99 ) );
	assert.equal( audioAmplitude( 50, false ), Math.pow( 10, -.5 ) );
	assert.equal( audioAmplitude( 100, false ), 1 );
});

/*
================
quiet curve
================
*/
test("quiet steps fall by equal decibels below the native minimum, and 0 is silence", () => {
	let previous = -1;
	const quietSteps = [];
	for ( let position = 0; position <= AUDIO_SLIDER_MAX; position++ ) {
		const level = audioSliderLevel( position ), amplitude = audioAmplitude( level, false );
		assert.equal( audioSliderPosition( level ), position );
		assert.ok( amplitude > previous );
		assert.equal( audioAmplitude( level, true ), 0 );
		if ( position > 1 && level <= 1 ) quietSteps.push( decibels( amplitude ) - decibels( previous ) );
		previous = amplitude;
	}
	// 49 steps from the first quiet level to level 1, each 20 log10(50) / 50 dB.
	assert.equal( quietSteps.length, 49 );
	for ( const step of quietSteps ) assert.ok( Math.abs( step - 20 * Math.log10( 50 ) / 50 ) < 1e-9, String( step ) );
	// The first quiet step is about 1/50 of the native minimum, far below it.
	assert.ok( Math.abs( decibels( audioAmplitude( .02, false ) ) - (-19.8 - 33.3) ) < .1 );
	assert.equal( audioAmplitude( 0, false ), 0 );
	assert.ok( Math.abs( audioAmplitude( 1 - 1e-12, false ) - audioAmplitude( 1, false ) ) < 1e-12 );
	assert.equal( stepAudioLevel( .98, 1 ), 1 );
	assert.equal( stepAudioLevel( 1, 1 ), 2 );
	assert.equal( stepAudioLevel( 2, -1 ), 1 );
	assert.equal( stepAudioLevel( 1, -1 ), .98 );
	assert.equal( stepAudioLevel( 0, 1 ), .02 );
	assert.equal( stepAudioLevel( .02, -1 ), 0 );
	assert.equal( stepAudioLevel( 0, -1 ), 0 );
	assert.equal( stepAudioLevel( 100, 1 ), 100 );
});

/*
================
saved records
================
*/
test("old integer and new fractional records retain their values and mute flags", () => {
	const original = { ...initialAudioOptions(), bgm: 1, effects: 20 };
	const quiet = { ...original, bgm: .02, effects: .123456789, environment: .98, muteEffects: true };
	for ( const value of [ original, quiet ] ) {
		assert.deepEqual( audioOptions( JSON.parse( JSON.stringify( value ) ) ), value );
		assert.notEqual( audioOptions( value ), value );
	}
	assert.deepEqual( defaultAudioOptions(), { ...initialAudioOptions(), bgm: 50 } );
	assert.equal( audioSliderPosition( quiet.effects ), 6 );
	assert.equal( quiet.effects, .123456789 );
	for ( const bad of [ null, [], {}, { ...original, muteBgm: 1 } ] ) assert.throws( () => audioOptions( bad ) );
	for ( const bad of [ -1, 101, 1.1, 50.5, NaN, Infinity, "0.1", undefined ] ) {
		for ( const key of [ "bgm", "effects", "environment" ] ) {
			assert.throws( () => audioOptions( { ...original, [key]: bad } ), /Invalid audio options/ );
		}
	}
});

/*
================
labels and bounds
================
*/
test("slider labels name the level, and bad positions and steps are refused", () => {
	assert.equal( audioLevelText( 0, false ), "Silent" );
	assert.equal( audioLevelText( 1, false ), "SRO level 1" );
	assert.equal( audioLevelText( .1, true ), "Quiet 0.1 (muted)" );
	for ( const bad of [ -1, .5, 150, NaN, Infinity ] ) assert.throws( () => audioSliderLevel( bad ) );
	assert.throws( () => stepAudioLevel( 1, 0 ) );
});
