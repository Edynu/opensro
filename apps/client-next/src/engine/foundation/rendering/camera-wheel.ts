import type {CameraWheelDelta} from '@/engine/contracts/input';

// Preserve Chromium's native wheel ticks where available (120 per detent).
// Other browsers expose scrolling units: use a declared 100px / 3-line
// detent mapping, preserving fractional and coalesced movement.
export function cameraWheelDelta(event:{deltaY:number;deltaMode:number;wheelDeltaY?:number}):CameraWheelDelta {
 const native=event.wheelDeltaY;
 return (Number.isFinite(native)?-native!:event.deltaY*(event.deltaMode===1?40:event.deltaMode===2?120:1.2)) as CameraWheelDelta;
}

// 67CBC0 -> 67B5E0: signed wheel delta / 20, float store, then clamp.
// Our adapter reverses Win32's sign so positive means zoom out.
// CGInterface constructor 68EFEF enables the normal mission 150-unit rail.
export function zoomCamera(distance:number,delta:CameraWheelDelta):number {
 return Math.max(10,Math.min(150,Math.fround(distance+delta/20)));
}
