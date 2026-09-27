export interface PlayerStats {readonly physicalMin:number;readonly physicalMax:number;readonly magicalMin:number;readonly magicalMax:number;readonly physicalDefense:number;readonly magicalDefense:number;readonly hit:number;readonly parry:number;readonly maxHp:number;readonly maxMp:number;readonly strength:number;readonly intellect:number;}
// 75be90 consumes exactly this 36-byte 343C block, including the two final words.
export function playerStats(payload:Uint8Array):PlayerStats{
 if(payload.length!==36)throw Error('Invalid base-stat block');const v=new DataView(payload.buffer,payload.byteOffset,payload.byteLength);
 return {physicalMin:v.getUint32(0,true),physicalMax:v.getUint32(4,true),magicalMin:v.getUint32(8,true),magicalMax:v.getUint32(12,true),physicalDefense:v.getUint16(16,true),magicalDefense:v.getUint16(18,true),hit:v.getUint16(20,true),parry:v.getUint16(22,true),maxHp:v.getUint32(24,true),maxMp:v.getUint32(28,true),strength:v.getUint16(32,true),intellect:v.getUint16(34,true)};
}
export function playerAbilityValues(s:PlayerStats,level:number):Readonly<Record<string,string>>{
 return {STRDAT:String(s.strength),INTDAT:String(s.intellect),PHYATTDAT:`${s.physicalMin} ~ ${s.physicalMax}`,MAGATTDAT:`${s.magicalMin} ~ ${s.magicalMax}`,PHYDEFDAT:String(s.physicalDefense),MAGDEFDAT:String(s.magicalDefense),HITDAT:String(s.hit),PARRYDAT:String(s.parry),PHYBALDAT:Math.min(120,Math.trunc((s.strength+level*2+14)*100/(((level-1)*7+56)*0.8571428656578064)))+' %',MAGBALDAT:Math.min(120,Math.trunc(s.intellect*100/((level+7)*5*.8)))+' %'};
}
