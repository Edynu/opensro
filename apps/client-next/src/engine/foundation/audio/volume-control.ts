/*
===========================================================================

volume-control.ts - audio slider positions and their saved levels

The slider's first third (positions 0..50) holds the port's quiet levels
below the native minimum, 1/50 of level 1's amplitude per step; the rest
(51..149) are native levels 2..100. Saved values stay SRO levels, so a
saved integer keeps its native meaning. Port-only, not native.

===========================================================================
*/

export const QUIET_VOLUME_STEPS = 50;
// Fifty quiet steps (level 1 is the fiftieth) and the ninety-nine native
// levels above it.
export const AUDIO_SLIDER_MAX = 149;

/*
================
audioSliderLevel
================
*/
export function audioSliderLevel( position: number ): number {
	if ( !Number.isInteger( position ) || position < 0 || position > AUDIO_SLIDER_MAX ) {
		throw Error( "Invalid audio slider position" );
	}
	return position <= QUIET_VOLUME_STEPS ? position / QUIET_VOLUME_STEPS : position - QUIET_VOLUME_STEPS + 1;
}

/*
================
audioSliderPosition

Round only the control projection; never normalize a saved fraction.
================
*/
export function audioSliderPosition( level: number ): number {
	return level < 1 ? Math.round( level * QUIET_VOLUME_STEPS ) : level + QUIET_VOLUME_STEPS - 1;
}

/*
================
stepAudioLevel
================
*/
export function stepAudioLevel( level: number, delta: number ): number {
	if ( delta !== -1 && delta !== 1 ) throw Error( "Invalid audio slider step" );
	return audioSliderLevel( Math.max( 0, Math.min( AUDIO_SLIDER_MAX, audioSliderPosition( level ) + delta ) ) );
}

/*
================
audioLevelText
================
*/
export function audioLevelText( level: number, muted: boolean ): string {
	const selected = level === 0 ? "Silent" : level < 1 ? `Quiet ${String( level )}` : `SRO level ${level}`;
	return muted ? `${selected} (muted)` : selected;
}
