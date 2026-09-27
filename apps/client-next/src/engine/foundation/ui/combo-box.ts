import type {UiQuad,UiRect} from '@/engine/contracts/ui';
import {stretchRing} from './stretch-ring';
// CIFComboBox::OnCreate 51DC80: black list, right arrow, inset static.
// The text static is a new child; parent ClientRect does not carry into it.
export function comboBoxChrome(r:UiRect,size:(path:string)=>readonly[number,number]|undefined,clip:UiRect,state:0|1|2=0){
 const root='/assets/images/Media_extracted/interface/ifcommon/',list:UiRect=[r[0],r[1],r[2]-20,r[3]],ring=stretchRing(list,root+'com_blacksquare_',size,clip);
 const arrows=['','_focus','_press'].map(s=>root+'com_qst_downarrow_button'+s+'.png'),quads:UiQuad[]=[{rect:list,clip,texture:'',uv:[0,0,1,1],color:[0,0,0,1]},...ring.quads];
 const arrowSize=size(arrows[state]!);
 if(arrowSize)quads.push({rect:[r[0]+r[2]-20+Math.floor((20-arrowSize[0])/2),r[1]+Math.floor((r[3]-arrowSize[1])/2),arrowSize[0],arrowSize[1]],clip,texture:arrows[state]!,uv:[0,0,1,1],color:[1,1,1,1]});
 return {quads,paths:[...ring.paths,...arrows],textRect:[r[0]+5,r[1],r[2]-30,r[3]] as UiRect};
}
