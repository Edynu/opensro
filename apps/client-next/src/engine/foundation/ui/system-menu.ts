import type {AuthoredLayout} from './authored-layout';
import type {UiRect} from '@/engine/contracts/ui';
// 5D1920 removes control 12 and compacts the remaining four controls.
export function systemMenu(layout:AuthoredLayout,x:number,y:number){
 const at=(a:number,b:number,w:number,h:number):UiRect=>[x+a,y+b,w,h];
 const frame=layout.GDR_SYSTEM_FRAME!,tile=layout.GDR_SYSTEM_BGTILE!;
 return {frame:at(0,0,214,212),inner:at(frame.rect[0],frame.rect[1],frame.rect[2],151),tile:at(tile.rect[0],tile.rect[1],tile.rect[2],112),buttons:[10,11,13,14].map((id,index)=>{
  const node=Object.values(layout).find(n=>n.id===id);if(!node)throw Error('Missing System menu control');
  return {...node,rect:[31,58+34*index,...node.size] as UiRect};
 })};
}
