// 778190 dispatches by runtime class before examining the COS type word.
// 582110 accepts character/COS family 3, subtype 3 or 4 only.
export function emoteRoute(player:boolean,cos:boolean,tidWord:number,action:number):number|null {
 if(player)return action;
 const band=(tidWord&0xffff)>>>11;
 return cos&&action===1&&(tidWord&0x7fe)===0x1c6&&(band===3||band===4)?0:null;
}
// 8E6310 -> 85EA20 -> A94CF0 writes branch+98=0 for hand attachments.
// A5F2AB skips those branches. Action 2 leaves the previous flag unchanged.
// 8E6470 restores on exit only when GetRideObj is null.
export function emoteAttachments(hidden:boolean,previous:string|undefined,current:string|undefined,player:boolean,mounted:boolean):boolean {
 if(!player)return false;
 if(current!==previous){
  if(previous&&!mounted)hidden=false;
  if(current&&current!=='emote2')hidden=true;
 }
 return !current&&!mounted?false:hidden;
}
