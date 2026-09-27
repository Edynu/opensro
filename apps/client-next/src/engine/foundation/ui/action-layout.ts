export interface ActionSlot {readonly id:number;readonly slot:number;readonly name:string;readonly icon:string;}
// CIFAction 58b720: enabled records bind group 1..4, index within that
// group's authored slot array. Names are localization symbols, not captions.
export function decodeActionSlots(value:unknown):readonly ActionSlot[]{
 const rows=(value as {rows?:unknown}).rows;if(!Array.isArray(rows))throw Error('Invalid action records');
 const ids=new Set<number>(),slots=new Set<number>();
 return rows.flatMap(raw=>{if(typeof raw!=='string')throw Error('Invalid action row');const row=raw.split('\t');if(row.length!==7)throw Error('Invalid action fields');if(row[1]!=='1')return [];
  const id=Number(row[0]),group=Number(row[5]),index=Number(row[6]),max=group===1||group===4?18:8,slot=group*100+index;
  if(!Number.isInteger(id)||id<=0||group<1||group>4||!Number.isInteger(group)||!Number.isInteger(index)||index<0||index>=max||ids.has(id)||slots.has(slot))throw Error('Invalid action binding');ids.add(id);slots.add(slot);
  const icon=row[4]!.replaceAll('\\','/').replace(/^icon\//i,'');
  if(!icon.startsWith('action/')||icon.includes('..'))throw Error('Invalid action icon');
  return [{id,slot,name:row[3]!,icon}];
 }).sort((a,b)=>a.id-b.id);
}
