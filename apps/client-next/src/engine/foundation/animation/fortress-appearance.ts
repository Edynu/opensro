import {fortressActive,fortressStatus,type FortressState} from '@/engine/foundation/gameplay/fortress';

// 868C90 -> 868500/868BB0. The team branch deliberately preserves the old
// index for targets outside teams 0/1. Graphics record byte 15 only gates war.
export function fortressAppearance(previous:number,localTeam:number,targetTeam:number,normalClothes:boolean,state:FortressState|undefined,localGuild:number,targetGuild:number,allies:readonly number[]):number {
 if(localTeam!==255)return targetTeam===0?3:targetTeam===1?4:previous;
 if(!state||!fortressActive(state)||normalClothes)return -1;
 if(!localGuild||!targetGuild||state.registered.length===0)return 0;
 const status=fortressStatus(state,localGuild,targetGuild,allies);
 if(state.registered.includes(localGuild))return status===0xc9?0:3;
 return status===0xcb?0:status===0xcc?4:3;
}
