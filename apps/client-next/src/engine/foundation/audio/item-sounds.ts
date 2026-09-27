// v1.150 8ED490 and its TID predicates. These are inventory categories,
// not the weapon labels used by character animation sound selection.
export function itemSoundCategory(typeFlags:number):string {
 const tid=typeFlags&0xffff,kind=tid&0x7e,family=(tid>>>7)&15,band=tid>>>11;
 if(kind===0x2c){
  if(family===4&&(band===1||band===2))return 'SHIELD';
  if([1,2,3,9,10,11].includes(family))return (family===1||family===9?
   ['','CAP','GLOVES','ROBE','GLOVES','GLOVES','SHOES']:
   ['','HELM','PAULDRONS','BREASTPLATE','CUISSE','GAUNTLET','GREAVE'])[band]??'';
  if(family===6)return ({2:'SWORD',3:'BLADE',4:'SPEAR',5:'TBLADE',6:'BOW',7:'SWORD',8:'TSWORD',9:'DUELAXE',10:'WAND',11:'STAFF',12:'CROSSBOW',13:'DAGGER',14:'HARP',15:'WAND',16:'HAMMER'} as Record<number,string>)[band]??'';
  if(family===5||family===12)return ['','EARRING','NECKLACE','RING'][band]??'';
  if(family===7)return ['','TRADER','THIEF','HUNTER'][band]??'';
 }
 if(kind===0x6c){
  if(family===1&&band>=1&&band<=3)return 'POTION';
  if(family===4&&(band===1||band===2))return 'QUIVER';
  if(family===3)return 'SCROLL';
  if(family===5)return 'GOLD';
 }
 return '';
}

// 75789F..7578F7: only the bag -> ordinary equipment leg warns. Native
// excludes accessories and job gear, then compares durability as signed int32.
export function equipDurabilityWarning(typeFlags:number,durability:number|undefined):boolean {
 const family=(typeFlags>>>7)&15;
 return (typeFlags&0x7e)===0x2c&&family!==5&&family!==12&&family!==7&&durability!==undefined&&(durability|0)<=6;
}
