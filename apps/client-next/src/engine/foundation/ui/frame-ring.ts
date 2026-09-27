import type {UiQuad,UiRect} from '@/engine/contracts/ui';
export function frameParts(){return ['left_up','right_up','right_down','left_down','left_side','mid_up','right_side','mid_down'] as const;}
// 6F6740: natural-size corners, then top/bottom/left/right tiled strips.
// Partial tiles clip UVs; the frame itself never fills the interior.
export function frameRing(rect:UiRect,prefix:string,sizes:readonly(readonly[number,number]|undefined)[],clip:UiRect):UiQuad[]{
 const [x,y,w,h]=rect,paths=frameParts().map(part=>prefix+part+'.png'),out:UiQuad[]=[];
 if(sizes.length!==8||sizes.some(s=>!s))return out;
 const s=sizes.map(v=>v!);
 if(s.some(v=>!v.every(n=>Number.isFinite(n)&&n>0)))throw Error('Invalid frame sprite extent');
 function piece(i:number,px:number,py:number,width:number,height:number){if(width>0&&height>0)out.push({rect:[x+px,y+py,width,height],texture:paths[i]!,uv:[0,0,width/s[i]![0],height/s[i]![1]],color:[1,1,1,1],clip});}
 piece(0,0,0,...s[0]!);piece(1,w-s[1]![0],0,...s[1]!);piece(2,w-s[2]![0],h-s[2]![1],...s[2]!);piece(3,0,h-s[3]![1],...s[3]!);
 function horizontal(i:number,left:number,right:number,py:number){const end=w-right;for(let px=left;px<end;px+=s[i]![0])piece(i,px,py,Math.min(s[i]![0],end-px),s[i]![1]);}
 function vertical(i:number,top:number,bottom:number,px:number){const end=h-bottom;for(let py=top;py<end;py+=s[i]![1])piece(i,px,py,s[i]![0],Math.min(s[i]![1],end-py));}
 horizontal(5,s[0]![0],s[1]![0],0);horizontal(7,s[3]![0],s[2]![0],h-s[7]![1]);vertical(4,s[0]![1],s[3]![1],0);vertical(6,s[1]![1],s[2]![1],w-s[6]![0]);
 return out;
}
