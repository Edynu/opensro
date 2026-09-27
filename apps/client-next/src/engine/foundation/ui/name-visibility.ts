import type {EntityState} from '@/engine/contracts/world';
import type {GameOptions} from '@/engine/foundation/gameplay/game-options';
// CICCharacter 85E2E0: hover wins before distance/options. Guild equality is
// native guild-record pointer equality, including two absent records.
export function nameVisible(entity:EntityState,local:EntityState|undefined,hovered:boolean,options:GameOptions,pose?:import('@/engine/contracts/gameplay').Pose|null):boolean {
 if(hovered)return true;
 if(!local)return false;
 const origin=pose??local,target=entity.gid===local.gid?origin:entity;
 const dx=target.x-origin.x+((target.regionId&255)-(origin.regionId&255))*1920;
 const dz=target.z-origin.z+((target.regionId>>>8)-(origin.regionId>>>8))*1920;
 const dy=target.y-origin.y;
 if(dx*dx+dy*dy+dz*dz>=90000)return false;
 if(entity.kind==='monster'||entity.kind==='cos')return options.monsterNames&&!entity.ownerGid;
 if(entity.kind==='npc')return options.npcNames;
 if(entity.gid===local.gid)return options.ownName;
 if(entity.kind==='player')return options.playerNames||(options.guildNames&&(entity.guildId??0)===(local.guildId??0));
 return false;
}
// 8602C0/85E550 class mask, with the requested local-character exemption.
export function blindableCharacter(entity:Pick<EntityState,'kind'|'gid'>,localGid?:number):boolean{return entity.gid!==localGid&&['monster','player','script-object'].includes(entity.kind);}
// 854680 -> 5500F0: mall pickup COS, not every pet bought with Silk.
export function hiddenSilkCos(entity:EntityState,hide:boolean):boolean {
 const tid=entity.tidWord??0;
 return hide&&entity.kind==='cos'&&(tid&2)!==0&&(tid&0x1c)===4&&(tid&0x60)===0x40&&(tid&0x780)===0x180&&(tid&0xf800)===0x2000;
}
