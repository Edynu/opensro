import type {CastDisplacement,Pose} from '@/engine/contracts/gameplay';
import {movementHeading,poseDistance,type MovementSegment} from './native-movement';
// 8D5734: type 5 travels at 250 units/s; 8E0440 bit 8 at 500 units/s.
// Type 4 uses state-4's 8E5CD0 update: delta seconds * 50. Bit 2 is a correction.
export function displacementSegment(from:Pose,command:CastDisplacement,now:number):MovementSegment {
 const to={...command.destination,angle:from.angle};
 if(command.kind===2)return {from:to,to,start:now,duration:0};
 const rate=command.kind===5?250:command.kind===8?500:50;
 return {from,to:{...to,angle:command.kind===4?from.angle:movementHeading(from,to)},start:now,duration:poseDistance(from,to)/rate*1000};
}
