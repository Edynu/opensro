// A170B0 stores the raw timestamp at [this+0x68], so its float32 seconds delta
// never drifts. It then publishes an integer millisecond delta,
// `trunc(deltaSeconds * 1000)` at [this+0x2c], and discards the fraction.
// A0F430 caps that published integer at 3000 ms; A2E980 clamps negatives.
//
// Deliberate presentation deviation: the discarded fraction is carried into the
// next frame. The original loss is frame-rate dependent - a fixed 1 ms
// truncation costs more the shorter the frame, so it is ~4% of animation time at
// the original's own ~60 FPS but ~14% at 144 Hz. Reproducing it verbatim makes a
// high-refresh client slower than the original rather than equal to it.
// Carrying the remainder keeps every published value an integer, so all
// downstream integer cursor arithmetic is unchanged, while the deltas sum to the
// true elapsed time at any refresh rate. A stall that saturates the cap banks
// nothing.
//
// This clock is presentation-only: animation, material, texture and particle
// cursors. Action, projectile and gameplay clocks take `seconds` directly and
// are unaffected, so this cannot change gameplay timing.
export function createModifierDelta(){
 let previous:number|null=null,carry=0;
 return (seconds:number):number=>{
  if(!Number.isFinite(seconds))throw Error('Invalid modifier clock');
  if(previous===null){previous=seconds;return 0;}
  const elapsed=Math.fround(Math.max(0,seconds-previous))*1000+carry;
  previous=seconds;
  const delta=Math.trunc(elapsed);
  if(delta>=3000){carry=0;return 3000;}
  carry=elapsed-delta;return delta;
 };
}
