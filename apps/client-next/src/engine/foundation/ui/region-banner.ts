import type {UiQuad,UiRect} from '@/engine/contracts/ui';
import type {AuthoredControl} from './authored-layout';
import type {GlyphStyle} from '@/engine/foundation/rendering/ui-glyphs';

export interface RegionBannerText {readonly key:string;readonly title:string;readonly description:string;readonly level:string}
// v1.150 0x720e00 -> 0x54f3d0. Sector IDs alone are not banner identities.
export function regionBannerText(region:number,codes:Readonly<Record<string,string>>,zones:Readonly<Record<string,string>>):RegionBannerText|null {
 const key=codes[String(region&0xffff)];
 if(!key||key==='xxx')return null;
 const value=(suffix:string)=>zones[key+suffix]?.trim()??'';
 const level=value('_03');
 return {key,title:value('_01'),description:value('_02'),level:level==='xxx'?'':level};
}
// 0x54ee90: hold from the key change, then 500 ms fade. Derive presentation
// from elapsed time; there is no independent timer or gameplay mutation.
export function regionBannerAlpha(elapsed:number):number {
 return Math.round(255*Math.max(0,Math.min(1,elapsed/500,(3500-elapsed)/500)))/255;
}
export function regionBannerQuads(value:RegionBannerText,alpha:number,width:number,height:number,
 glyphs:(value:string,rect:UiRect,clip:UiRect,color:UiQuad['color'],style:GlyphStyle)=>UiQuad[],titleHeight:number,background?:AuthoredControl):UiQuad[] {
 if(alpha<=0)return [];
 const clip:UiRect=[0,0,width,height],center=Math.trunc(width/2),scale=1.5;
 // 0x54eee0 scales the title around its measured extent; 0x54ef90 positions
 // the detail rows at y=156/177 independent of viewport height.
 const title=glyphs(value.title,[0,0,width/scale,titleHeight],clip,[61/255,253/255,1,alpha],{fontIndex:4,hAlign:1,vAlign:0});
 const backing:UiQuad[]=background?.texture?[{rect:[center-372,95,744,104],clip,uv:background.uv,texture:background.texture,color:[1,1,1,alpha]}]:[];
 return [...backing,...title.map(q=>({...q,rect:[q.rect[0]*scale,119-Math.trunc(titleHeight*scale*.25)+q.rect[1]*scale,q.rect[2]*scale,q.rect[3]*scale] as UiRect})),
  ...glyphs(value.description,[center-343,156,691,15],clip,[1,1,1,alpha],{fontIndex:3,hAlign:1,vAlign:1}),
  ...glyphs(value.level,[center-214,177,427,13],clip,[1,1,92/255,alpha],{fontIndex:1,hAlign:1,vAlign:1})];
}
