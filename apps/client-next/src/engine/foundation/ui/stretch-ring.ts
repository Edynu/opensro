import type {UiQuad,UiRect} from '@/engine/contracts/ui';
// 6FAEB0 builds x86 aggregate arguments right-to-left: 6FA680 consumes
// TL/TR/BR/BL, then 6FA940 consumes left/top/right/bottom. Construction
// order is the reverse of these texture slots. Authored type 0 = corner 2,
// edge 3 (6f9d00 / 6f9fe0). Top/bottom rotate vertical strips +90 degrees.
export function stretchRing(r:UiRect,prefix:string,size:(p:string)=>readonly[number,number]|undefined,clip:UiRect){
 const names=['left_up','right_up','right_down','left_down','left_side','left_side','right_side','right_side'],paths=names.map(n=>prefix+n+'.png'),s=paths.map(size),quads:UiQuad[]=[];
 if(s.some(v=>!v))return {paths,quads};
 const [x,y,w,h]=r,a=s[0]!,b=s[1]!,c=s[2]!,d=s[3]!,left=s[4]!,right=s[6]!;
 // Authored children dispatch bounds changes through C0428C slot A0 to
 // 6F9950: corners and stretched strips are INSIDE the window rectangle.
 // 6F9590 is the separate outside-border path used by positioned text
 // bubbles; using it here separates the inventory outline from its grid.
 const rects:UiRect[]=[[x,y,...a],[x+w-b[0],y,...b],[x+w-c[0],y+h-c[1],...c],[x,y+h-d[1],...d],[x,y+a[1],left[0],h-a[1]-d[1]],[x+a[0],y,w-a[0]-b[0],left[0]],[x+w-right[0],y+b[1],right[0],h-b[1]-c[1]],[x+d[0],y+h-right[0],w-d[0]-c[0],right[0]]];
 rects.forEach((rect,i)=>{if(rect[2]>0&&rect[3]>0)quads.push({rect,clip,sampling:"nearest",texture:paths[i]!,uv:[0,0,1,1],uvTurn:i===5||i===7?1:0,color:[1,1,1,1]});});return {paths,quads};
}
