export interface SpawnSkillReference {readonly token:boolean;readonly status:boolean;}
export interface SpawnSkill {readonly id:number;readonly token?:number;readonly remaining?:number;readonly status:number;}
// 85fb20: remote rows carry ID, optional token and optional efta status.
// Local rows carry one additional u32 after the token.
export function decodeSpawnSkills(p:Uint8Array,offset:number,refs:ReadonlyMap<number,SpawnSkillReference>,local=false){
 const view=new DataView(p.buffer,p.byteOffset,p.byteLength);let next=offset;
 function take(n:number){if(next+n>p.length)throw new Error('Truncated spawn skills');const at=next;next+=n;return at;}
 const u8=()=>view.getUint8(take(1)),u32=()=>view.getUint32(take(4),true);
 const count=u8(),skills:SpawnSkill[]=[];
 for(let i=0;i<count;i++){
  const id=u32(),ref=refs.get(id);if(!ref)throw new Error('Missing spawn skill reference authority');
  const token=ref.token?u32():undefined,remaining=ref.token&&local?u32():undefined,status=ref.status?u8():2;
  skills.push({id,token,remaining,status});
 }
 return {skills,next};
}
export function spawnSkillReferences(rows:readonly {id:number;token:boolean;status:boolean}[]):ReadonlyMap<number,SpawnSkillReference>{
 const refs=new Map<number,SpawnSkillReference>();
 if(rows.length>65536)throw new Error('Spawn skill reference capacity exceeded');
 for(const row of rows){if(!Number.isInteger(row.id)||row.id<=0||row.id>0xffffffff||typeof row.token!=='boolean'||typeof row.status!=='boolean'||refs.has(row.id))throw new Error('Invalid spawn skill reference');refs.set(row.id,{token:row.token,status:row.status});}
 return refs;
}

// Semantic bootstrap twin of 85FB20. Validate against the same reference
// gates before admitting the local entity; omission means an empty snapshot.
export function entrySpawnSkills(value:unknown,refs:ReadonlyMap<number,SpawnSkillReference>):readonly SpawnSkill[]{
 if(value===undefined||value===null)return [];
 if(!Array.isArray(value)||value.length>255)throw Error('Invalid entry skills');
 const u32=(n:unknown)=>typeof n==='number'&&Number.isInteger(n)&&n>=0&&n<=0xffffffff;
 return value.map(row=>{
  if(!row||!u32(row.id)||!row.id)throw Error('Invalid entry skill identity');
  const ref=refs.get(row.id);if(!ref)throw Error('Missing entry skill reference authority');
  if(ref.token?(!u32(row.token)||!u32(row.remaining)):(row.token!==undefined||row.remaining!==undefined))throw Error('Invalid entry skill token fields');
  if(!Number.isInteger(row.status)||row.status<0||row.status>255||(!ref.status&&row.status!==2))throw Error('Invalid entry skill status');
  return {id:row.id,...(ref.token?{token:row.token,remaining:row.remaining}:{}),status:row.status};
 });
}
