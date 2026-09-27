import type {UiRect} from '@/engine/contracts/ui';
// 59DF10: capacity is bag capacity (wire total minus equipment slots).
// Each page has 32 controls; spare controls use pt_block, never wire slots.
export function inventorySlots(x:number,y:number,total:number,equipment:number,page:number){
 const capacity=Math.max(0,total-equipment),pages=Math.max(1,Math.ceil(capacity/32)),selected=Math.max(0,Math.min(pages-1,page));
 return {pages,page:selected,slots:Array.from({length:32},(_,index)=>({slot:equipment+selected*32+index,enabled:selected*32+index<capacity,rect:[x+18+(index%4)*36,y+13+Math.floor(index/4)*36,32,32] as UiRect}))};
}
// CIFLattice 6F7850: interior, right column, bottom row, bottom-right.
export function inventoryLattice(x:number,y:number){
 return latticeCells(x,y,4,8);
}
export function latticeCells(x:number,y:number,columns:number,rows:number){
 return Array.from({length:columns*rows},(_,i)=>({rect:[x+(i%columns)*36,y+Math.floor(i/columns)*36,36,36] as UiRect,part:(i>=columns*(rows-1)?(i%columns===columns-1?'right_down':'left_down'):(i%columns===columns-1?'right_up':'left_up'))}));
}
export function equipmentSocket(slot:number){return ['helm','mail','shoulderguard','gauntlet','pants','boots','weapon','shield','specialdress','earring','necklace','l_ring','r_ring'][slot];}
