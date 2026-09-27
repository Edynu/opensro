import type {EntityState} from '@/engine/contracts/world';
export type WorldCursor=0x95|0x97|0x98|0x99|0x9a|0xa0|0xa1|0xa3;
// 6875F0's ordinary world-class branches; attack flags are the constructor
// value overridden by the optional name-info dword, not inferred from HP.
export function worldCursor(entity:EntityState|undefined,local:EntityState|undefined,pressed=false):WorldCursor{
 if(!entity||entity.appearanceState?.[0]===2)return 0x95;
 if(entity.kind==='ground-item')return pressed?0x9a:0x99;
 if(entity.kind==='teleport')return 0xa1;
 if(entity.kind==='npc')return 0x98;
 if(!local||entity.appearanceState?.[0]===4)return 0x95;
 if(entity.kind==='monster')return ((entity.attackFlags??0x10)&0x10)?0x97:0x95;
 return 0x95;
}
