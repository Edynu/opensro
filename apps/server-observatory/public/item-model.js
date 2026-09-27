export function stackable(item){return (item.typeFlags&0x60)===0x60;}
export function parameterLimit(item){return stackable(item)?Math.min(255,item.maxStack):12;}
export function itemCommand(item,value){
 if(value===null||value===undefined||String(value).trim()==='')return null;
 const min=stackable(item)?1:0,n=Number(value);
 if(!Number.isInteger(n)||n<min||n>parameterLimit(item))return null;
 return `/MAKEITEM ${item.codename} ${n}`;
}
export function category(item){
 if(item.recoveryHP>0||item.recoveryMP>0||item.recoveryHPPercent>0||item.recoveryMPPercent>0)return 'Recovery';
 if(/SCROLL/.test(item.codename))return 'Scrolls';
 if(/_COS_|_PET_/.test(item.codename))return 'Pets & mounts';
 if(!stackable(item))return 'Equipment';
 return 'Other items';
}
export function filterItems(items,query,group){const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);return items.filter(item=>(!group||category(item)===group)&&terms.every(term=>(item.name+' '+item.codename+' '+item.id).toLowerCase().includes(term)));}
export function requirements(item){return item.requirementTypes.flatMap((type,i)=>type===-1?[]:[`${type===1?'Character level':type>10?'Mastery '+type:'Requirement '+type}: ${item.requirementValues[i]}`]);}
