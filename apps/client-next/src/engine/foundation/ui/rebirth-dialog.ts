import type {UiRect} from '@/engine/contracts/ui';
import {messageBox} from './message-box';
// CIFMessageBox kind 3, 52F460. LIFE, not a transient zero-HP delta,
// controls admission. 697215 checks level <= 10 for the second wire choice.
export function rebirthDialog(width:number,height:number,position:readonly[number,number]|null=null){
 const box=messageBox(width,height,400,210,position),[x,y]=box.frame;
 const at=(a:number,b:number,w:number,h:number):UiRect=>[x+a,y+b,w,h];
 return {...box,art:at(128,43,148,52),first:at(0,117,400,16),second:at(0,134,400,20),point:at(22,168,176,24),alternate:at(202,168,176,24)};
}
