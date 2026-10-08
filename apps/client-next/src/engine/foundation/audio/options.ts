/*
===========================================================================

options.ts - saved audio levels and their playback gain

Integer levels 1..100 keep the native curve (714180). Below level 1 the
port adds quiet levels: the native slider spans only 20 dB (0.2 dB per
level), so its minimum of -19.8 dB is too loud for many players and the
step from it to silence was the only quiet setting.
Port-only, not native; the owner made it the default (2026-10-09).

===========================================================================
*/
// Retail 5CA340 stores three integer levels and three mute bytes.
/*
================
AudioOptions
================
*/
export interface AudioOptions {
	readonly bgm: number;
	readonly effects: number;
	readonly environment: number;
	readonly muteBgm: boolean;
	readonly muteEffects: boolean;
	readonly muteEnvironment: boolean;
}
/*
================
initialAudioOptions
================
*/
export function initialAudioOptions(): AudioOptions {
	return { bgm: 30, effects: 50, environment: 50, muteBgm: false, muteEffects: false, muteEnvironment: false };
}
// 5CA1A0 sends 50 to each slider; startup uses 30 for music.
/*
================
defaultAudioOptions
================
*/
export function defaultAudioOptions(): AudioOptions {
	return { ...initialAudioOptions(), bgm: 50 };
}
/*
================
audioOptions
================
*/
export function audioOptions( value: unknown ): AudioOptions {
	if ( !value || typeof value !== "object" || Array.isArray( value ) ) throw Error( "Invalid audio options" );
	const v = value as AudioOptions;
	if (
		![ v.bgm, v.effects, v.environment ].every( n =>
			Number.isFinite( n ) && n >= 0 && n <= 100 && (n < 1 || Number.isInteger( n ))
		) ||
		![ v.muteBgm, v.muteEffects, v.muteEnvironment ].every( n => typeof n === "boolean" )
	) throw Error( "Invalid audio options" );
	return {
		bgm: v.bgm,
		effects: v.effects,
		environment: v.environment,
		muteBgm: v.muteBgm,
		muteEffects: v.muteEffects,
		muteEnvironment: v.muteEnvironment
	};
}
// 714180: (5 * level - 500) * 4 hundredths of a dB. Mute is -10000.
/*
================
nativeAudioAmplitude
================
*/
function nativeAudioAmplitude( level: number ): number {
	return Math.pow( 10, (20 * level - 2000) / 2000 );
}

// The quiet range spans level 1's amplitude down to 1/QUIET_DEPTH of it.
const QUIET_DEPTH = 50;

/*
================
audioAmplitude

Levels 1..100 are the native branch unchanged. Below level 1 the gain
keeps falling by an equal number of decibels per slider step, as the
native levels do, to about 1/50 of the native minimum (-53 dB); 0 is
silence. A linear fade there gave the first quiet step a 6 dB jump and
the top half of the range 6 dB in all.
================
*/
export function audioAmplitude( level: number, muted: boolean ): number {
	if ( muted || level === 0 ) return 0;
	if ( level < 1 ) return nativeAudioAmplitude( 1 ) * Math.pow( QUIET_DEPTH, level - 1 );
	return nativeAudioAmplitude( level );
}
