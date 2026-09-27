import type {EffectiveHpEvent} from '@/engine/contracts/effective-hp';
import type {CastImpact} from '@/engine/contracts/gameplay';

// Retail +440 is the wire baseline, +450 the effective HP, +29C pending fatal.
// 8E2840 attaches each unbound outstanding result to one HP checkpoint;
// 8E1BD0/85E710 retire checkpoints in order. This is a data reducer, with
// no timers or animation policy of its own (see the work-item boundary note).
export function createEffectiveHp(){
 type Checkpoint={hp:number;references:Set<string>};
 type Entry={wire:number;hp:number;pendingFatal:boolean;dead:boolean;checkpoints:Checkpoint[];lastProgress:number};
 const entries=new Map<number,Entry>();
 const results=new Map<string,{gid:number;checkpoint?:Checkpoint}>();
 // Advances only when hp(gid) or dead(gid) can read differently, so projections
 // stay identity-stable across frames; wire, fatal and checkpoint bookkeeping do not count.
 let revision=0;
 function setHp(row:Entry,hp:number){if(row.hp!==hp){row.hp=hp;revision++;}}
 function setDead(row:Entry,dead:boolean){if(row.dead!==dead){row.dead=dead;revision++;}}
 function entry(gid:number){let row=entries.get(gid);if(!row){row={wire:0,hp:0,pendingFatal:false,dead:false,checkpoints:[],lastProgress:0};entries.set(gid,row);revision++;}return row;}
 function drain(row:Entry,now:number){
  while(row.checkpoints.length){const head=row.checkpoints[0]!;
   if(head.references.size){
    // 85E80C: strictly greater than 5000; discard, do not apply stale HP.
    if(now-row.lastProgress>5000){row.checkpoints.shift();row.lastProgress=now;continue;}break;
   }
   setHp(row,head.hp);row.checkpoints.shift();row.lastProgress=now;
  }
 }
 return {
  receive(event:EffectiveHpEvent){const row=entry(event.gid);
   if(event.kind==='hp-seed'){setHp(row,event.hp);row.wire=event.hp;}
   else if(event.kind==='hp-revive'){
    // LIFE-alive supersedes the previous life's deferred result vector. Clear
    // its checkpoint references without applying them; a late animation or
    // projectile callback must neither debit revived HP nor reinstall death.
    // The ordered revival baseline has already updated wire, even if an old
    // fatal reference prevented that checkpoint from draining.
    for(const [key,result]of results)if(result.gid===event.gid)results.delete(key);
    row.checkpoints=[];setHp(row,row.wire);row.pendingFatal=false;setDead(row,false);
   }
   else if(event.kind==='hp-result'){if(!results.has(event.key))results.set(event.key,{gid:event.gid});if(event.fatal)row.pendingFatal=true;}
   else {
    if((event.sourceFlags&0xffffffcd)===0)setHp(row,Math.max(0,row.hp+event.hp-row.wire));
    if((event.sourceFlags&0x402)&&event.hp===0&&!row.pendingFatal)setDead(row,true);
    row.wire=event.hp;
    const checkpoint:Checkpoint={hp:event.hp,references:new Set()};
    for(const [key,result]of results)if(result.gid===event.gid&&!result.checkpoint){result.checkpoint=checkpoint;checkpoint.references.add(key);}
    if(!row.checkpoints.length)row.lastProgress=event.atMs;
    row.checkpoints.push(checkpoint);drain(row,event.atMs);
   }
  },
  currentResult:(gid:number,key:string)=>results.get(key)?.gid===gid,
  impact(gid:number,key:string,impact:CastImpact,now:number,source:'cast'|'hawk'='cast'):boolean{
   // Cast callbacks consume an ingress-owned reference, exactly once. Hawk
   // callbacks have a separate native producer and reserve no cast checkpoint.
   const result=results.get(key);
   if(source==='cast'&&result?.gid!==gid)return false;
   const row=entry(gid);
   // 8D57B1 skips HP for kind 7; the fatal motion branch is separate.
   if(impact.type!==7)setHp(row,Math.max(0,row.hp-impact.damage));
   if(impact.fatal)setDead(row,true);
   if(result){const checkpoint=result.checkpoint;checkpoint?.references.delete(key);results.delete(key);
    // 85E73C -> 8E1B50: a detached checkpoint is applied when its last
    // reference eventually retires, even after the five-second unlink.
    if(checkpoint&&!checkpoint.references.size&&!row.checkpoints.includes(checkpoint))setHp(row,checkpoint.hp);
   }
   drain(row,now);
   return true;
  },
  release(key:string,now:number){const result=results.get(key);if(!result)return;result.checkpoint?.references.delete(key);results.delete(key);const row=entries.get(result.gid);if(row){const checkpoint=result.checkpoint;if(checkpoint&&!checkpoint.references.size&&!row.checkpoints.includes(checkpoint))setHp(row,checkpoint.hp);drain(row,now);}},
  step(now:number){for(const row of entries.values())drain(row,now);},
  hp:(gid:number)=>entries.get(gid)?.hp,
  dead:(gid:number)=>entries.get(gid)?.dead??false,
  revision:()=>revision,
  remove(gid:number){if(entries.delete(gid))revision++;for(const [key,result]of results)if(result.gid===gid)results.delete(key);},
  clear(){if(entries.size)revision++;entries.clear();results.clear();}
 };
}
