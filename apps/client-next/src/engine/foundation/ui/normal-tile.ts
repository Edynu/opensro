import type {UiQuad,UiRect} from '@/engine/contracts/ui';
// CIFNormalTile::RenderTiled (6F86F0): preserve natural texel scale,
// including right/bottom remainders. No stretched interior or tint.
export function normalTile(rect:UiRect,texture:string,size:readonly[number,number]|undefined,clip:UiRect):UiQuad[]{
 if(!size)return [];
 if(!size.every(n=>Number.isFinite(n)&&n>0))throw Error('Invalid tile sprite extent');
 const [x,y,w,h]=rect,[tw,th]=size,out:UiQuad[]=[];
 for(let dy=0;dy<h;dy+=th)for(let dx=0;dx<w;dx+=tw){
  const width=Math.min(tw,w-dx),height=Math.min(th,h-dy);
  out.push({rect:[x+dx,y+dy,width,height],texture,uv:[0,0,width/tw,height/th],color:[1,1,1,1],clip});
 }
 return out;
}
