import {crtRandomRange} from '@/engine/foundation/math/crt-random';
import {createProjectileCurve} from '@/engine/foundation/animation/projectile-curve';
import {launchOrb} from '@/engine/foundation/animation/orb-mover';
import {advanceStarFlicker} from '@/engine/foundation/rendering/star-flicker';
import {buildNativeSkyStarPrimitive} from '@/engine/foundation/rendering/star-construction';
import type {PresentationRandom,PresentationRandomObservation} from '@/engine/contracts/presentation-random';

// One presentation-thread stream, constructed once by the runtime. Resource
// completion, scene replacement, reconnect and device recovery cannot reseed it.
// SWorld is a CRT initializer: BC6FA4 -> BBCE10 -> 8BB530 -> 8CD0F0 ->
// 8CBE10 constructs stars before WinMain 711C6C reseeds rand. The static seed
// is a separate replay input. Native startup capture verifies seed 1 and all
// 3000 constructed XYZ/ARGB records (native-startup-rng-verified.json).
export function createPresentationRandom(seed:number,staticSeed=1,traceLimit=0):PresentationRandom&{takeTrace():readonly PresentationRandomObservation[]} {
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('Invalid presentation startup seed');
 if(!Number.isInteger(staticSeed)||staticSeed<0||staticSeed>0xffffffff)throw Error('Invalid static star seed');
 if(!Number.isSafeInteger(traceLimit)||traceLimit<0||traceLimit>1000000)throw Error('Invalid RNG trace limit');
 const observations:PresentationRandomObservation[]=[];
 function record(operation:PresentationRandomObservation['operation'],before:number){if(!traceLimit)return;if(observations.length>=traceLimit)throw Error('RNG trace limit exceeded');observations.push({operation,stateBefore:before,stateAfter:state});}
 const field=buildNativeSkyStarPrimitive(staticSeed);
 const vertices=Object.freeze(field.vertices.map(vertex=>Object.freeze(vertex)));
 const sky=Object.freeze({vertices});
 let state=seed; // Native srand replaces, rather than continues, the static stream.
 return Object.freeze<PresentationRandom&{takeTrace():readonly PresentationRandomObservation[]}>({
  range(lower,upper){const before=state,next=crtRandomRange(state,lower,upper);state=next.state;record('range',before);return next.value;},
  curve(start,end){const before=state,next=createProjectileCurve(start,end,state);state=next.state;record('curve',before);return next.curve;},
  orb(start,end){const before=state,next=launchOrb(start,end,state);state=next.random;record('orb',before);return next.mover;},
  flicker(previous,nowMs,visible){const before=state,next=advanceStarFlicker({...previous,random:state},nowMs,visible);state=next.random;record('flicker',before);return next;},
  takeTrace(){const rows=observations.slice();observations.length=0;return rows;},
  sky:()=>sky
 });
}
