/**
 * Project BAN's timestamp map into a glTF timeline without changing key identity.
 * Native LoadBanFile (0xa6c421..0xa6c456) inserts {milliseconds, sourceIndex}
 * through std::map::insert (0x42fe20): equal keys keep the FIRST insertion.
 * SeekKeyframeBracket (0xa68490) samples the stored source indices, not adjacent
 * raw BAN records.
 */
export function compileBanTimeline(clip, label = clip.name ?? '<BAN>') {
  if (!Number.isSafeInteger(clip.frameCount) || clip.frameCount < 1 ||
      clip.frameTimesMs.length !== clip.frameCount) {
    throw new Error(`${label}: invalid BAN frame count`);
  }
  const firstByTime = new Map();
  for (let index = 0; index < clip.frameCount; index += 1) {
    const milliseconds = clip.frameTimesMs[index];
    if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 0xffffffff) {
      throw new Error(`${label}: invalid BAN timestamp at frame ${index}`);
    }
    if (!firstByTime.has(milliseconds)) firstByTime.set(milliseconds, index);
  }
  const entries = [...firstByTime].sort(([a], [b]) => a - b);
  const times = Float32Array.from(entries, ([milliseconds]) => milliseconds / 1000);
  for (let index = 1; index < times.length; index += 1) {
    if (times[index] <= times[index - 1]) {
      throw new Error(`${label}: distinct BAN timestamps collide in glTF float32 seconds`);
    }
  }
  for (const bone of clip.bones) {
    if (bone.keyCount !== clip.frameCount || bone.keys.length !== clip.frameCount) {
      throw new Error(`${label}: ${bone.name} key count does not match the BAN timeline`);
    }
  }
  return {times, sourceIndices: entries.map(([, index]) => index)};
}
