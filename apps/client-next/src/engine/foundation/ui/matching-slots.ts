import {authoredRect,type AuthoredLayout} from './authored-layout';
// 63DA20/63D500 and 675E00/6758E0 create every authored slot. Clearing a
// record clears its labels/mark, not child 5's normal background bar.
export function matchingSlots<T>(layout:AuthoredLayout,type:'CIFPartyMatchSlot'|'CIFMentorMatchSlot',rows:readonly T[],x:number,y:number){
 const slots=Object.values(layout).filter(node=>node.type===type).sort((a,b)=>a.id-b.id);
 if(rows.length>slots.length)throw Error('Matching page exceeds authored slots');
 return slots.map((node,index)=>({rect:authoredRect(node,x,y),row:rows[index]}));
}
