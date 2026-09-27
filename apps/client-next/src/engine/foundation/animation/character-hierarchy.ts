import type {CharacterActor} from '@/engine/contracts/character';

/** Frame values change continuously; parent links change only with actor topology. */
export function createCharacterHierarchy(){
 const byGid=new Map<number,CharacterActor>(),parents=new Map<number,number|undefined>();
 let chains=new Map<number,CharacterActor[]>(),rebuilds=0,valid=false;
 return {
  update(actors:readonly CharacterActor[]){
   let changed=!valid||actors.length!==byGid.size;
   for(const actor of actors){
    const parent=actor.attachment?.gid??actor.mountedOn;
    if(!byGid.has(actor.gid)||parents.get(actor.gid)!==parent)changed=true;
   }
   // Retire records at the topology boundary. Ordinary frames only replace values.
   if(changed){byGid.clear();parents.clear();}
   for(const actor of actors){byGid.set(actor.gid,actor);parents.set(actor.gid,actor.attachment?.gid??actor.mountedOn);}
   if(changed){
    valid=false;
    const next=new Map<number,CharacterActor[]>();
    for(const actor of actors){
     const chain:CharacterActor[]=[];
     for(let current:CharacterActor|undefined=actor;current;){
      if(chain.some(row=>row.gid===current!.gid)||chain.length>=8){parents.clear();throw Error('Cyclic or excessive character attachment');}
      chain.push(current);const parent=parents.get(current.gid);
      if(parent===undefined)break;
      current=byGid.get(parent);if(!current){chain.length=0;break;}
     }
     next.set(actor.gid,chain);
    }
    chains=next;rebuilds++;valid=true;
   }else{
    for(const chain of chains.values())for(let i=0;i<chain.length;i++)chain[i]=byGid.get(chain[i]!.gid)!;
   }
   return {byGid,chains};
  },
  stats:()=>({rebuilds}),
  reset(){byGid.clear();parents.clear();chains.clear();valid=false;}
 };
}
