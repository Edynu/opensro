import type {UiQuad,UiRect} from '@/engine/contracts/ui';
// CIFBarWnd: natural end caps and a repeated middle sprite, including its tail UV.
export function barChrome(r:UiRect,prefix:string,size:(p:string)=>readonly[number,number]|undefined,clip:UiRect){
 const paths=['left','mid','right'].map(n=>prefix+n+'.png'),[l,m,rr]=paths.map(size),quads:UiQuad[]=[];
 if(l&&m&&rr){const piece=(i:number,x:number,width:number,naturalWidth:number,height:number)=>{if(width>0)quads.push({rect:[x,r[1],width,height],clip,texture:paths[i]!,uv:[0,0,width/naturalWidth,1],color:[1,1,1,1]});};piece(0,r[0],l[0],l[0],l[1]);piece(2,r[0]+r[2]-rr[0],rr[0],rr[0],rr[1]);for(let dx=l[0];dx<r[2]-rr[0];dx+=m[0])piece(1,r[0]+dx,Math.min(m[0],r[2]-rr[0]-dx),m[0],m[1]);}
 return {paths,quads};
}
