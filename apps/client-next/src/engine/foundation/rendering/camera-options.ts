export type SightMode=0|1|2;
export function sightMode(value:unknown):SightMode{if(value!==0&&value!==1&&value!==2)throw Error('Invalid sight mode');return value;}
// 68F8E2..68F8FB: native float constants and a final float store.
export function thirdPersonYaw(playerYaw:number):number{return Math.fround(1.5700000524520874-playerYaw+1.5707963705062866);}
