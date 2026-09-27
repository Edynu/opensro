import type {EntityState} from '@/engine/contracts/world';
import type {GameplayState} from '@/engine/contracts/gameplay';
import type {GameOptions} from '@/engine/foundation/gameplay/game-options';
import {monsterMaximumHp} from './target-status';
// 85E3F0 / 85F660 select the shared full or half status window.
export function quickStatus(entity:EntityState,local:EntityState|undefined,game:GameplayState,options:GameOptions):{hp:number;mp?:number}|null {
 const ratio=(n:number|undefined,max:number|undefined)=>n!==undefined&&max!==undefined&&max>0?Math.fround(Math.min(n,max)/max):undefined;
 const vital=game.vitals.find(v=>v.gid===entity.gid);
 if(entity.gid===game.localGid){
  if(!options.ownStatus)return null;
  const hp=ratio(vital?.hp,game.progression?.stats?.maxHp??vital?.maxHp),mp=ratio(vital?.mp,game.progression?.stats?.maxMp??vital?.maxMp);
  return hp===undefined||mp===undefined?null:{hp,mp};
 }
 if(entity.kind==='player'){
  if(!options.partyStatus)return null;
  const member=game.social?.members.find(row=>row.name===entity.name);
  return member?{hp:Math.min(10,member.status&15)/10,mp:Math.min(10,member.status>>>4)/10}:null;
 }
 if(entity.kind==='monster'){
  if(!options.monsterStatus||game.target!==entity.gid)return null;
  const hp=ratio(vital?.hp,monsterMaximumHp(entity));return hp===undefined?null:{hp};
 }
 if(entity.kind==='cos'){
  if(!options.cosStatus||!local||entity.ownerGid!==local.gid)return null;
  const tid=entity.tidWord??0,band=tid>>>11;
  if((tid&0x7fe)===0x1c6&&(band===4||([1,2].includes(band)&&local.mountedOn)))return null;
  const cos=game.cosRecords?.find(row=>row.gid===entity.gid),hp=ratio(cos?.hp??vital?.hp,entity.maxHp);
  return hp===undefined?null:{hp};
 }
 return null;
}
