import type { Pose } from "@/engine/contracts/gameplay";
// 775E40 reads exactly {GID, walk, run}; these are live channels, not a
// new destination and not a movement acknowledgement.
export function decodeMovementSpeeds(p:Uint8Array){
 if(p.length!==12)throw Error('Invalid movement speed channels');
 const v=new DataView(p.buffer,p.byteOffset,p.byteLength),gid=v.getUint32(0,true),walkSpeed=v.getFloat32(4,true),runSpeed=v.getFloat32(8,true);
 if(!gid||![walkSpeed,runSpeed].every(n=>Number.isFinite(n)&&n>0))throw Error('Invalid movement speed channels');
 return {gid,walkSpeed,runSpeed};
}
export function movementSpeedTransition(segment:MovementSegment,previous:number,next:number,now:number):MovementSegment{
 if(![previous,next].every(n=>Number.isFinite(n)&&n>0))throw Error('Invalid movement speed');
 return {...segment,from:sampleMovement(segment,now),start:now,duration:Math.max(0,segment.start+segment.duration-now)*previous/next};
}
// v1.150 B738, shared by remote motion and local server-driven approaches.
export function decodeNativeMovement(p: Uint8Array, current: Pose) {
    const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
    if (p.length < 9 || p[4]! > 1)
        throw new Error("Invalid movement broadcast");
    const offset = p[4] === 0 ? 8 : 13;
    if (p.length <= offset || p[offset]! > 1 || p.length !== offset + 1 + (p[offset] ? 10 : 0))
        throw new Error("Invalid movement source block");
    const from = p[offset] ? { ...current, regionId: v.getUint16(offset + 1, true), x: v.getInt16(offset + 3, true) / 10, y: v.getFloat32(offset + 5, true), z: v.getInt16(offset + 9, true) / 10 } : current;
    if (!Number.isFinite(from.y))
        throw new Error("Invalid movement height");
    const to = p[4] === 0 ? { ...from, angle: v.getUint16(6, true) } : { ...from, regionId: v.getUint16(5, true), x: v.getInt16(7, true), y: v.getInt16(9, true), z: v.getInt16(11, true) };
    return { gid: v.getUint32(0, true), from, to:p[4]===1?{...to,angle:movementHeading(from,to)}:to };
}
export function poseDistance(a: Pose, b: Pose) { if((a.regionId|b.regionId)&0x8000){if(a.regionId!==b.regionId)throw new Error('Dungeon transition requires teleport');return Math.hypot(b.x-a.x,b.z-a.z);}return Math.hypot(b.x - a.x + ((b.regionId & 255) - (a.regionId & 255)) * 1920, b.z - a.z + ((b.regionId >>> 8) - (a.regionId >>> 8)) * 1920); }

// Native movement mode 2 is walking; other modes use running speed.
export function movementGait(mode: number | undefined): "walk" | "run" { return mode === 2 ? "walk" : "run"; }

// Both local and remote motion use the same sampling and state transitions.
export interface MovementSegment { from: Pose; to: Pose; start: number; duration: number; }
export function interpolateMovement(from: Pose, to: Pose, t: number): Pose {
    if ((from.regionId & 0x8000) !== (to.regionId & 0x8000)) return from;
    if(from.regionId&0x8000){if(from.regionId!==to.regionId)return from;return {...to,x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,z:from.z+(to.z-from.z)*t};}
    const wx = from.x + (from.regionId & 255) * 1920, wz = from.z + (from.regionId >>> 8) * 1920;
    const x = wx + (to.x + (to.regionId & 255) * 1920 - wx) * t, z = wz + (to.z + (to.regionId >>> 8) * 1920 - wz) * t;
    return { regionId: Math.floor(x / 1920) | (Math.floor(z / 1920) << 8), x: x % 1920, y: from.y + (to.y - from.y) * t, z: z % 1920, angle: to.angle };
}
export function sampleMovement(segment: MovementSegment, now: number): Pose {
    return interpolateMovement(segment.from, segment.to, segment.duration ? Math.max(0, Math.min(1, (now-segment.start)/segment.duration)) : 1);
}
export function movementModeTransition(segment: MovementSegment, mode: number, speed: number, now: number, serverTimed = false): {pose: Pose; segment: MovementSegment | null} {
    const pose = sampleMovement(segment, now);
    if (mode === 0 || mode === 4) return {pose, segment: null};
    // A receipt's authoritative arrival time is not replaced by client speed.
    if (serverTimed) return {pose, segment};
    const distance = poseDistance(pose, segment.to);
    if (distance && (!Number.isFinite(speed) || speed <= 0)) throw new Error('Moving entity has no speed');
    return {pose, segment: {from: pose, to: segment.to, start: now, duration: distance ? distance/speed*1000 : 0}};
}

// 8791A0 inverts 8788C0's {sin(yaw), 0, -cos(yaw)}. Keep the
// coordinate-sector conversion shared by predicted and received movement.
export function movementHeading(from:Pose,to:Pose):number {
    const dungeon=!!((from.regionId|to.regionId)&0x8000);
    if(dungeon&&from.regionId!==to.regionId)return from.angle;
    const dx=to.x-from.x+(dungeon?0:((to.regionId&255)-(from.regionId&255))*1920);
    const dz=to.z-from.z+(dungeon?0:((to.regionId>>>8)-(from.regionId>>>8))*1920);
    if(dx===0&&dz===0)return to.angle;
    // 853550 converts model yaw back to wire bearing by subtracting pi/2.
    const yaw=(Math.atan2(dz,dx)+Math.PI*2)%(Math.PI*2);
    return Math.trunc(yaw/(Math.PI*2)*65535);
}
