import type {UiQuad,UiRect} from '@/engine/contracts/ui';
import {stretchRing} from './stretch-ring';

// CIFVerticalSpinCtrl::OnCreate 542FC0: generated children are absent from
// authored layouts. A black field owns a static value and two native buttons.
export function verticalSpinChrome(r:UiRect,size:(path:string)=>readonly[number,number]|undefined,clip:UiRect,upState:0|1|2=0,downState:0|1|2=0){
 const field:UiRect=[r[0],r[1],r[2]-20,r[3]],ring=stretchRing(field,'/assets/images/Media_extracted/interface/ifcommon/com_blacksquare_',size,clip);
 const quads:UiQuad[]=[{rect:field,clip,texture:'',uv:[0,0,1,1],color:[0,0,0,1]},...ring.quads],paths=[...ring.paths];
 const up:UiRect=[r[0]+r[2]-20,r[1]+1,20,12],down:UiRect=[r[0]+r[2]-20,r[1]+r[3]-12,20,12];
 for(const [direction,bounds,state] of [['up',up,upState],['down',down,downState]] as const){
  const family=['','_focus','_press'].map(s=>'/assets/images/Media_extracted/interface/underbar/ub_'+direction+'_arrow'+s+'.png');paths.push(...family);
  const texture=family[state]!,extent=size(texture);
  if(extent)quads.push({rect:[bounds[0]+Math.floor((bounds[2]-extent[0])/2),bounds[1]+Math.floor((bounds[3]-extent[1])/2),...extent],clip,texture,uv:[0,0,1,1],color:[1,1,1,1]});
 }
 return {quads,paths,up,down,textRect:[r[0]+6,r[1]+3,r[2]-26,r[3]-6] as UiRect};
}
