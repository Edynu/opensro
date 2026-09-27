import type {InventoryItem} from '@/engine/contracts/gameplay';
import type {UiQuad,UiRect} from '@/engine/contracts/ui';

const ROOT='/assets/images/Media_extracted/interface/item_number/item_number_';
// v1.150 CIFSlotWithHelp::OnCreate 5548C0 and render 568420 -> 564470.
// Counts are 8x8 sprites, stepped backwards by five pixels, at the TOP left.
// D3D9's -0.5 vertex correction is implicit in WebGPU pixel coordinates.
export function itemCountQuads(item:Partial<Pick<InventoryItem,'quantity'|'typeFlags'|'tooltip'>>|undefined,r:UiRect,clip:UiRect):UiQuad[]{
 if(!item||!Number.isInteger(item.quantity)||item.quantity!<1||item.quantity!>65535)return [];
 const type=item.typeFlags;
 // 4FB260: expendable/stackable type 3/3; a single remaining unit is drawn too.
 if(type!==undefined&&((type&2)!==0||(type&0x1c)!==0xc||(type&0x60)!==0x60))return [];
 if(type===undefined&&item.quantity===1)return [];
 if(type!==undefined&&(type&0xff80)===0x7e80&&((item.tooltip?.fields.itemParam6_2b0??0)&2))return [];
 const digits=String(item.quantity),quads:UiQuad[]=[];
 for(let i=digits.length-1,x=r[0]+digits.length*4-2;i>=0;i--,x-=5)
  quads.push({rect:[x,r[1]+2,8,8],clip,color:[1,1,1,1],texture:ROOT+digits[i]+'.png',uv:[0,0,1,1]});
 return quads;
}
