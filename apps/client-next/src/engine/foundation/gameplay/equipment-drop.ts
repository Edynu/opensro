// 594980 equipment-drop socket families; inventory occupancy chooses ring hand.
export function equipmentDropSlot(type:number,items:readonly {slot:number}[],preferred?:number):number|undefined{
 if(type&2||(type&0x1c)!==12)return;
 const band=type&0x60,group=(type>>>7)&15,sub=(type>>>11)&31;
 if(band===0x60&&group===4)return 7;
 if(band!==0x20)return;
 if(group===6)return 6;
 if(group===4&&(sub===1||sub===2))return 7;
 if(group===7)return 8;
 if([1,2,3,9,10,11].includes(group)){const slot=[undefined,0,2,1,4,3,5][sub];return slot;}
 if(group===5||group===12){
  if(sub===1)return 9;if(sub===2)return 10;
  if(sub===3)return preferred===11||preferred===12?preferred:!items.some(i=>i.slot===11)?11:!items.some(i=>i.slot===12)?12:11;
 }
}
