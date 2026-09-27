import type {UiRect} from '@/engine/contracts/ui';
// UI-owned placement only. Visibility, modal admission and close side effects
// remain with each window's existing lifecycle owner.
export function createWindowPlacement(){
 const frames=new Map<string,{rect:UiRect;viewport:readonly[number,number]}>();
 const clamp=(r:UiRect,w:number,h:number):UiRect=>[Math.max(0,Math.min(Math.max(0,w-r[2]),r[0])),Math.max(0,Math.min(Math.max(0,h-r[3]),r[1])),r[2],r[3]];
 return {
  frame(id:string,initial:UiRect,w:number,h:number):UiRect {
   const old=frames.get(id);let rect:UiRect=old?[old.rect[0],old.rect[1],initial[2],initial[3]]:initial;
   // Native tab reflow changes extent without recentering the owner.
   if(!old||old.viewport[0]!==w||old.viewport[1]!==h)rect=clamp(rect,w,h);
   frames.set(id,{rect,viewport:[w,h]});return rect;
  },
  drag(id:string,dx:number,dy:number){const entry=frames.get(id);if(!entry)return false;entry.rect=clamp([entry.rect[0]+dx,entry.rect[1]+dy,entry.rect[2],entry.rect[3]],...entry.viewport);return true;},
  read(id:string){return frames.get(id)?.rect;},
  reset(){frames.clear();},
 };
}
