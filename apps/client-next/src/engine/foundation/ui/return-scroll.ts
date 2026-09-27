import type {UiQuad,UiRect} from '@/engine/contracts/ui';
import type {ReturnScrollCast} from '@/engine/foundation/gameplay/return-scroll';
const ROOT='/assets/images/Media_extracted/interface/ifcommon/';
// CIFDelayInfo: 6B14E0, 6B13B0 and resinfo/ifdelayinfo.txt. The type-0
// bar remains full at zero remaining; only server cancellation/reset removes it.
export function returnScrollBar(cast:ReturnScrollCast,width:number,height:number,now:number,pressed=false,focused=false){
 const x=width===800?405:Math.trunc((width-192)/2),y=height-165+76;
 const frame:UiRect=[x,y,192,36],cancel:UiRect=[x+171,y+4,20,20],name:UiRect=[x,y+7,167,12];
 // 6B18A0 skips its fraction update when the initial remaining time is zero.
 const ratio=cast.durationMs===0?0:Math.max(0,Math.min(1,(now-cast.startedAtMs)/cast.durationMs));
 const quads:UiQuad[]=[{rect:frame,clip:[0,0,width,height],texture:ROOT+'com_casting_window.png',uv:[0,0,1,1],color:[1,1,1,1]},
 {rect:cancel,clip:frame,texture:ROOT+'com_casting_cancel'+(pressed?'_press':focused?'_focus':'')+'.png',uv:[0,0,1,1],color:[1,1,1,1]}];
 if(ratio>0)quads.push({rect:[x+6,y+27,184*ratio,8],clip:frame,texture:ROOT+'com_casting_gauge_return.png',uv:[0,0,ratio,1],color:[1,1,1,1]});
 return {frame,cancel,name,quads};
}
