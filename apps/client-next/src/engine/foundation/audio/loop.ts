// Bound the seconds -> frames round trip to the decoded buffer. In Chromium
// 152 an endpoint just past its length can strand the playhead out of bounds,
// replaying the previous render quantum forever (crbug.com/553218226).
// For night_wind at 48 kHz, (443526 / 48000) * 48000 is 443526.00000000006.
// Adjust only upward rounding, by floating-point precision, not a PCM frame:
// retain every sample, the playback rate, and the authored loop duration.
export function audioLoopEnd(frameCount:number,sampleRate:number):number {
 const seconds=frameCount/sampleRate;
 return seconds*sampleRate>frameCount?seconds-seconds*Number.EPSILON:seconds;
}
