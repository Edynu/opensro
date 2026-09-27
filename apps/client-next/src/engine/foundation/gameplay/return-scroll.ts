import type {InventoryItem} from '@/engine/contracts/gameplay';
import {isReturnScroll} from './travel';
export interface ReturnScrollCast {readonly refObjId:number;readonly name:string;readonly startedAtMs:number;readonly durationMs:number;}
// 755E40 starts the bar before replacing/removing the acknowledged stack.
export function returnScrollCast(item:InventoryItem|undefined,now:number):ReturnScrollCast|undefined {
 if(!item||!isReturnScroll(item.typeFlags))return undefined;
 const duration=item.tooltip?.fields.itemParam1_29c;
 if(duration===undefined||!Number.isInteger(duration)||duration<0||duration>0xffffffff)throw Error('Missing return-scroll duration authority');
 return {refObjId:item.refObjId,name:item.name??'',startedAtMs:now,durationMs:duration};
}
