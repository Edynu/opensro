import type {ProjectileCurve} from '@/engine/foundation/animation/projectile-curve';
import type {OrbMover,OrbPoint} from '@/engine/foundation/animation/orb-mover';
import type {StarFlicker} from '@/engine/foundation/rendering/star-flicker';
export interface PresentationRandomObservation {
 readonly operation:'range'|'curve'|'orb'|'flicker';
 readonly stateBefore:number;
 readonly stateAfter:number;
}
export interface PresentationRandom {
 readonly range:(lower:number,upper:number)=>number;
 readonly curve:(start:OrbPoint,end:OrbPoint)=>ProjectileCurve;
 readonly orb:(start:OrbPoint,end:OrbPoint)=>OrbMover;
 readonly flicker:(state:StarFlicker,nowMs:number,visible:boolean)=>StarFlicker;
 readonly sky:()=>{readonly vertices:readonly {readonly x:number;readonly y:number;readonly z:number;readonly colorArgb:number}[]};
}
