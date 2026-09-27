import type {UiControl,UiRect} from '@/engine/contracts/ui';
export function containsPoint(rect:UiRect,x:number,y:number):boolean{return x>=rect[0]&&y>=rect[1]&&x<rect[0]+rect[2]&&y<rect[1]+rect[3];}
// Disabled controls still occlude controls below them. Dispatch owns eligibility.
export function topmostControlAt(controls:readonly UiControl[],x:number,y:number):UiControl|undefined{
 for(let i=controls.length-1;i>=0;i--)if(containsPoint(controls[i]!.rect,x,y))return controls[i];
 return undefined;
}
