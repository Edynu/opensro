import type {ChatLine} from '@/engine/contracts/gameplay';

// sub_856680 replaces the speaker's text and rearms timer 10 for 10,000ms.
// Sequence is admission identity: retained snapshots must never restart it.
export function createSpeech(){
 let observed=0;
 const active=new Map<number,{text:string;channel:number;expires:number}>();
 return {
  step(lines:readonly ChatLine[],players:readonly {gid:number;name?:string}[],now:number){
   const present=new Set(players.map(p=>p.gid));
   for(const line of lines){
    if(line.sequence===undefined||line.sequence<=observed)continue;
    observed=line.sequence;
    if(![1,3,6,13].includes(line.channel))continue;
    const gid=line.gid??players.find(p=>p.name===line.name)?.gid;
    if(gid!==undefined&&present.has(gid))active.set(gid,{text:line.text,channel:line.channel,expires:now+10000});
   }
   for(const [gid,row] of active)if(now>=row.expires||!present.has(gid))active.delete(gid);
   return active;
  },
  deadline(){let at=Infinity;for(const row of active.values())at=Math.min(at,row.expires);return at;},
  reset(){observed=0;active.clear();}
 };
}
