/*
===========================================================================

image-parity.mjs - exact displayed-image evidence for renderer changes

Compares uncompressed RGBA bytes. Baseline repeat noise is reported separately;
it never silently enlarges the acceptance threshold for an exact optimization.

===========================================================================
*/
import assert from "node:assert/strict";

const CHANNELS = 4;

/*
================
compareImages

The opaque diff paints every mismatching pixel magenta, including alpha-only
changes. This is a visibility aid, not a displacement or perceptual metric.
================
*/
export function compareImages( reference, candidate, width, height ) {
	assert.ok( Number.isSafeInteger( width ) && width > 0, "Invalid image width" );
	assert.ok( Number.isSafeInteger( height ) && height > 0, "Invalid image height" );
	const bytes = width * height * CHANNELS;
	assert.equal( reference.length, bytes, "Reference RGBA length" );
	assert.equal( candidate.length, bytes, "Candidate RGBA length" );
	const diff = new Uint8Array( bytes );
	let changedPixels = 0, changedChannels = 0, maxChannelError = 0, absoluteError = 0;
	for ( let offset = 0; offset < bytes; offset += CHANNELS ) {
		let changed = false;
		for ( let channel = 0; channel < CHANNELS; channel++ ) {
			const error = Math.abs( reference[offset + channel] - candidate[offset + channel] );
			if ( error > 0 ) {
				changed = true;
				changedChannels++;
			}
			maxChannelError = Math.max( maxChannelError, error );
			absoluteError += error;
		}
		if ( changed ) {
			changedPixels++;
			diff[offset] = 255;
			diff[offset + 2] = 255;
		}
		diff[offset + 3] = 255;
	}
	return {
		exact: changedPixels === 0,
		changedPixels,
		changedChannels,
		maxChannelError,
		meanChannelError: absoluteError / bytes,
		diff
	};
}

/*
================
compareImageTriplet

An unstable reference cannot certify an exact optimization, even if one of
its repetitions happens to match the candidate.
================
*/
export function compareImageTriplet( { baseline, repeat, candidate, width, height } ) {
	const noise = compareImages( baseline, repeat, width, height );
	const change = compareImages( baseline, candidate, width, height );
	return { accepted: noise.exact && change.exact, noise, change };
}
