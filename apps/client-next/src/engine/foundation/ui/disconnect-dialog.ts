import type {UiRect} from '@/engine/contracts/ui';
import {messageBox} from './message-box';
// 75DE10 -> 5C82D0 creates 308x148 at (screen/2 -154, screen/2 -74).
// 528230 loads MsgBoxINIF. 52F4F7 selects NETOFF, hides IDs 200/201,
// and retains ID 202. 525D60 supplies title and background extents.
export function disconnectDialog(width:number,height:number,position:readonly[number,number]|null=null){
 const box=messageBox(width,height,308,148,position),[x,y]=box.frame;
 const at=(dx:number,dy:number,w:number,h:number):UiRect=>[x+dx,y+dy,w,h];
 return {...box,message:at(0,52,300,12),confirm:at(112,99,76,24)};
}
