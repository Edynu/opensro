import type {UiQuad,UiRect} from '@/engine/contracts/ui';
export const EXPERIENCE_BAR='/assets/images/Media_extracted/interface/underbar/ub_exp_bar.png';

// CIFUnderBar 0x5742b0: ten 20px sprites, with the trailing UV/destination
// cropped in 0.1-percent increments. EXP arithmetic stays qword until division.
export function experienceBar(experience:string,required:string,x:number,y:number,clip:UiRect):UiQuad[]{
 const denominator=Number(BigInt(required));if(denominator<=0)return [];
 const fraction=Math.max(0,Math.min(Number(BigInt(experience))/denominator,99.989997863769531/100));
 const pieces=Math.min(9,Math.floor(fraction*10)),tail=(Math.trunc(fraction*1000)%100)/100;
 const quads:UiQuad[]=[];
 for(let i=0;i<pieces+(tail>0?1:0);i++){
  const fill=i<pieces?1:tail;
  quads.push({texture:EXPERIENCE_BAR,rect:[x+18+i*20,y+27,20*fill,20],uv:[0,0,fill,1],color:[1,1,1,1],clip});
 }
 return quads;
}
// CIFGauge 0x5232f0, retained coefficient 0.01 (not frame delta).
export function advanceGauge(current:number,target:number):number {
 // x87 stores delta and the final sum, but does NOT store/round the step.
 const f=Math.fround,delta=f(target-current),step=Math.abs(delta)*10*f(.01);
 return target<current?Math.max(target,f(current-step)):Math.min(target,f(current+step));
}
// CIFGauge 0x5237b0: larger extent is a 0x60-alpha ghost under the smaller
// opaque extent. Covers rising EXP as well as rollover after earning an SP.
export function gaugeFill(rect:UiRect,uv:UiRect,texture:string,current:number,target:number,clip:UiRect):UiQuad[]{
 const quad=(fill:number,alpha:number):UiQuad=>({texture,rect:[rect[0],rect[1],rect[2]*fill,rect[3]],uv:[uv[0],uv[1],uv[2]*fill,uv[3]],color:[1,1,1,alpha],clip});
 return current===target?[quad(current,1)]:[quad(Math.max(current,target),96/255),quad(Math.min(current,target),1)];
}
