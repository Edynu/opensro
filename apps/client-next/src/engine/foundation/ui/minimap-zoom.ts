// CIFMinimap: 5499A0/5499E0 change +400; 54BCA0 advances +3FC.
export function minimapZoomTarget(target:number,direction:1|-1):number {
 return Math.max(64,Math.min(256,Math.fround(target+direction*19.200000762939453)));
}
export function advanceMinimapZoom(displayed:number,target:number,deltaMs:number):number {
 if(displayed===target||!Number.isFinite(deltaMs)||deltaMs<=0)return displayed;
 const step=Math.fround(Math.min(deltaMs,3000)*0.05000000074505806);
 return displayed<target?Math.min(target,Math.fround(displayed+step)):Math.max(target,Math.fround(displayed-step));
}
