import type {UiRect,UiQuad} from '@/engine/contracts/ui';
// CIFNotify warning sibling: fixed Y 130, measured and centered text,
// untextured blue decorator followed by the outside stretch chrome.
export function uniqueBannerQuads(value:string,alpha:number,width:number,height:number,textWidth:number,textHeight:number,paths:readonly string[],size:(p:string)=>readonly[number,number]|undefined,y=130,rgb:readonly[number,number,number]=[0,52,92]):UiQuad[]{
 if(alpha<=0||!value)return [];
 // 68E841..68E8E2 pushes bottom/top edge, right/left edge2 (right-to-left
 // arguments). 6FA940 stores its first resource as the left edge at +38C.
 // edge2 is the 40px side fade; edge is the 4px-wide top/bottom strip.
 const [corner,horizontal,vertical]=paths;
 if(!corner||!horizontal||!vertical)return [];
 const c=size(corner),e=size(vertical),h=size(horizontal);if(!c||!e||!h)return [];
 const x=(width>>1)-(Math.ceil(textWidth)>>1),w=Math.ceil(textWidth),t=textHeight,clip:UiRect=[0,0,width,height];
 const a=Math.round(alpha*255),quads:UiQuad[]=[{rect:[x,y,w,t],texture:'',uv:[0,0,1,1],clip,color:[rgb[0]/255,rgb[1]/255,rgb[2]/255,(128-((255-a)>>1))/255]}];
 const add=(texture:string,rect:UiRect,uv:UiRect)=>quads.push({texture,rect,uv,clip,color:[1,1,1,alpha]});
 add(corner,[x-c[0],y-c[1],...c],[0,0,1,1]);add(corner,[x+w,y-c[1],...c],[1,0,-1,1]);
 add(corner,[x+w,y+t,...c],[1,1,-1,-1]);add(corner,[x-c[0],y+t,...c],[0,1,1,-1]);
 add(vertical,[x-e[0],y,e[0],t],[0,0,1,1]);add(vertical,[x+w,y,e[0],t],[1,0,-1,1]);
 add(horizontal,[x,y-h[1],w,h[1]],[0,0,1,1]);add(horizontal,[x,y+t,w,h[1]],[0,1,1,-1]);
 return quads;
}
