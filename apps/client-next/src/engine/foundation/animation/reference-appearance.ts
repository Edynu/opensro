import type {CharacterAttachment} from '@/engine/contracts/character';
export interface ReferenceAppearance {readonly type:number;readonly cap:number;}
export interface AppearanceChoice {readonly model:number;readonly race:0|1;readonly armor:number;readonly weapon:number;readonly level:number;readonly head:'CA'|'HA';}
// 8DD6F0: five CRT draws, then 8703F0's separate head-piece draw.
export function chooseReferenceAppearance(cap:number,stores:readonly (readonly number[])[],rand:()=>number):AppearanceChoice{
 const race=rand()%2===0?1:0,list=stores[race];if(!list?.length)throw Error('Native appearance store is empty');
 const model=list[rand()%list.length]!,armor=[3,2,1][rand()%3]!,weapons=race?[7,8,9,15,11,12,13,14,10]:[3,2,5,4,6],weapon=weapons[rand()%weapons.length]!,level=rand()%(cap&255||140),head=rand()%2?'HA':'CA';
 return {model,race,armor,weapon,level,head};
}
type Entry={glb:string;parts:string[];covers?:Record<string,number[]>};
export function referenceAppearanceParts(choice:AppearanceChoice,male:boolean,dress:{sets:Record<string,Entry>;weapons:Record<string,Entry>},cover:Record<string,number>={}){
 const prefix=`${choice.race?'EU':'CH'}_${male?'M':'W'}`;let degree=1;for(const t of [8,16,24,32,42,52,64,76,90,104,120,141,164])if(choice.level>=t)degree++;
 const weapon=({2:'SWORD',3:'BLADE',4:'SPEAR',5:'TBLADE',6:'BOW',7:'SWORD',8:'TSWORD',9:'AXE',10:'DARKSTAFF',11:'TSTAFF',12:'CROSSBOW',13:'DAGGER',14:'HARP',15:'STAFF'} as Record<number,string>)[choice.weapon]!;
 const result:CharacterAttachment[]=[];
 function add(table:Record<string,Entry>,kind:string,wanted:readonly string[]){
  for(const part of wanted)for(let d=degree;d>0;d--){const entry=table[`${prefix}_${kind}_${String(d).padStart(2,'0')}`];if(!entry?.parts.includes(part))continue;result.push({model:entry.glb,parts:[part],covers:(entry.covers?.[part]??[]).map(i=>cover[String(i)]).filter((i):i is number=>i!==undefined)});break;}
 }
 add(dress.weapons,weapon,[9,13].includes(choice.weapon)?['WA','WL']:['WA']);
 add(dress.sets,({1:'CLOTHES',2:'LIGHT',3:'HEAVY'} as Record<number,string>)[choice.armor]!,[choice.head,'SA','BA','LA','AA','FA']);
 if([2,3,7,15].includes(choice.weapon))add(dress.weapons,'SHIELD',['WA']);
 return result;
}
// Every msch instance, whatever its word, restores the original model when
// it ends or stops (CIDecoSkill_ExtinguishAndCancel 8DD131). A skin a mask
// applied (0x323A, spawn row) is therefore shown only until the next such
// end on its gid: ends counts them, and a skin revision is pinned to the
// count current when it was first seen.
export function createReferenceAppearances(rand:()=>number){
 let references:ReadonlyMap<number,ReferenceAppearance>|undefined,stores:readonly (readonly number[])[]=[];
 const entries=new Map<string,{gid:number;hasAppearance:boolean;stopped:boolean}>(),current=new Map<number,AppearanceChoice>();
 const ends=new Map<number,number>(),skins=new Map<number,{revision:number;ends:number}>();
 const restore=(gid:number)=>{current.delete(gid);ends.set(gid,(ends.get(gid)??0)+1);};
 return {
  setReferences(refs:ReadonlyMap<number,ReferenceAppearance>,pools:readonly (readonly number[])[]){references=refs;stores=pools;},
  step(effects:readonly {key:string;gid:number;skill:number;stopped:boolean}[]){
   const present=new Set(effects.map(e=>e.key));for(const [key,row] of entries)if(!present.has(key)){if(row.hasAppearance&&!row.stopped)restore(row.gid);entries.delete(key);}
   if(references)for(const effect of effects){let entry=entries.get(effect.key);
    if(!entry){const ref=references.get(effect.skill);entry={gid:effect.gid,hasAppearance:!!ref,stopped:false};entries.set(effect.key,entry);if(ref?.type===3)current.set(effect.gid,chooseReferenceAppearance(ref.cap,stores,rand));}
    // Stop restores the original object even if another transform instance remains.
    if(effect.stopped&&!entry.stopped){if(entry.hasAppearance)restore(effect.gid);entry.stopped=true;}
   }
  },
  get(gid:number){return current.get(gid);},
  // The RefObj a gid is drawn as while its transform skin holds.
  skin(gid:number,skin:{readonly refObjId:number;readonly revision:number}|undefined){
   if(!skin){skins.delete(gid);return undefined;}
   let seen=skins.get(gid);if(!seen||seen.revision!==skin.revision){seen={revision:skin.revision,ends:ends.get(gid)??0};skins.set(gid,seen);}
   return seen.ends===(ends.get(gid)??0)?skin.refObjId:undefined;
  },
  reset(){entries.clear();current.clear();ends.clear();skins.clear();}
 };
}
