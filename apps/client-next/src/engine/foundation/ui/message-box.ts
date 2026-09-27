import type {UiRect} from '@/engine/contracts/ui';
// CIFMessageBox 525D60: shared caption, drag area and tiled client geometry.
// Position is owned by the admitted dialog, never by this layout function.
export function messageBox(width:number,height:number,w:number,h:number,position:readonly[number,number]|null=null){
 const x=Math.max(0,Math.min(Math.max(0,width-w),position?.[0]??Math.trunc((width-w)/2))),y=Math.max(0,Math.min(Math.max(0,height-h),position?.[1]??Math.trunc((height-h)/2)));
 const at=(dx:number,dy:number,rw:number,rh:number):UiRect=>[x+dx,y+dy,rw,rh];
 return {frame:at(0,0,w,h),drag:at(10,0,w-21,34),title:at(10,11,w-21,12),background:at(16,40,w-32,h-56)};
}
