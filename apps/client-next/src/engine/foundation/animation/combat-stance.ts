import type {CastImpact} from '@/engine/contracts/gameplay';
import type {EntityState} from '@/engine/contracts/world';

export const COMBAT_STANCE_SECONDS=5;
type Subject=Pick<EntityState,'kind'|'tidWord'>;

// 4BE6B0. Use the native type when supplied; the kind fallback supports
// snapshots/fixtures which have already classified the reference object.
function player(subject:Subject):boolean {
 const type=subject.tidWord;
 return type===undefined?subject.kind==='player'||subject.kind==='local-player':
  !!(type&2)&&(type&0x1c)===4&&(type&0x60)===0x20;
}
// 8E67FE..8E6855: player or COS-family 0x1C6, and NO secondary WAIT
// motion. Effect-only instances never enter character action state 2.
export function combatStanceOnCast(subject:Subject,hasMotion:boolean,hasWait:boolean):boolean {
 const type=subject.tidWord;
 const companion=type!==undefined&&!!(type&2)&&(type&0x1c)===4&&
  (type&0x60)===0x40&&(type&0x780)===0x180;
 return hasMotion&&!hasWait&&(player(subject)||companion);
}
// 8D57C4..8D5821. Subtypes 2 and 7 BYPASS the timer write, not enter
// it. Zero damage still refreshes the timer; only the flinch requires >0.
export function combatStanceOnHit(subject:Subject,alive:boolean,impact:CastImpact):boolean {
 return alive&&player(subject)&&!impact.fatal&&impact.type!==2&&impact.type!==7;
}
