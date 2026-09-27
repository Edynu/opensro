import type {CharacterRecord} from '@/engine/contracts/session';
import type {CreationSelection} from '@/engine/contracts/frontend';
export function initialCreation(race:0|1):CreationSelection{return {race,gender:0,figure:1,height:2,volume:2,weapon:0,protector:0,name:''};}
export function creationProtectors(s:CreationSelection):readonly string[]{
 return s.race===1?['HEAVY','LIGHT','CLOTHES']:[[],['LIGHT'],['HEAVY','LIGHT'],['HEAVY','LIGHT'],['HEAVY','LIGHT'],['LIGHT'],['LIGHT','CLOTHES'],['CLOTHES'],['CLOTHES'],['LIGHT','CLOTHES']][s.weapon]??[];
}
export function creationRange(s:CreationSelection,key:'figure'|'height'|'volume'|'weapon'|'protector'):readonly [number,number]{return [key==='figure'?1:0,key==='figure'?13:key==='weapon'?(s.race===0?9:5):key==='protector'?creationProtectors(s).length:4];}
export function creationLoadout(s:CreationSelection):CharacterRecord['visualLoadout']{
 const names=s.race===0?(s.gender===0?'NOBLE EXORCIST NECROMENCER MERCHANT PRIEST KNIGHT WARRIOR GLADIATOR BARBARIAN ADVENTURER ANGEL DEVIL WEREWOLF':'NOBLE WITCH SUMMONER MERCHANT ORACLE CRUSADER AMAZONESS KNIGHT ADVENTURER GLADIATOR ANGEL DEVIL SUCCUBUS'):(s.gender===0?'NOBLEBOY SCHOLAR PERFORMER MERCHANT WARRIOR MONK ADVENTURER FIGHTER NECROMANCER PRIEST BOGY MONKEY TATTOO':'NOBLEGIRL SCHOLAR KISAENG MERCHANT ASSASSIN WARRIOR ADVENTURER FIGHTER NECROMENCERW NECROMENCERB FOX BOGY KANGSI');
 const race=s.race===0?'EU':'CH',key=race+'_'+(s.gender===0?'M':'W'),figure=names.split(' ')[s.figure-1];if(!figure)throw Error('Invalid creation figure');
 const weapon=(s.race===0?' DAGGER SWORD TSWORD AXE CROSSBOW STAFF TSTAFF HARP STAFF':' SWORD BLADE SPEAR TBLADE BOW').split(' ')[s.weapon];
 const armor=creationProtectors(s)[s.protector-1],dress=key+'_'+(armor??'CLOTHES')+'_01';
 const animations:Record<string,string>={CH_SWORD:'sword',CH_BLADE:'sword',CH_SPEAR:'spear',CH_TBLADE:'spear',CH_BOW:'bow',EU_SWORD:'onehand_sword',EU_TSWORD:'twohand_sword',EU_AXE:'dual_axe',EU_STAFF:'onehand_staff',EU_TSTAFF:'twohand_staff',EU_CROSSBOW:'bow',EU_DAGGER:'dagger',EU_HARP:'harf'};
 return {modelCodename:'CHAR_'+race+'_'+(s.gender===0?'MAN':'WOMAN')+'_'+figure,dressSetKeys:[dress],dressPartFilters:{[dress]:armor?['BA','LA','FA']:['BA','LA']},weaponSetKeys:weapon?[key+'_'+weapon+'_01',...(['CH_SWORD','CH_BLADE','EU_SWORD','EU_STAFF'].includes(race+'_'+weapon)?[key+'_SHIELD_01']:[])]:[],animationSetName:weapon?animations[race+'_'+weapon]!:'default',heightScale:.94+s.height*.03,volumeScale:.94+s.volume*.03};
}
export interface NameRules {allowed:ReadonlySet<number>;forbidden:readonly string[];wholeWords:readonly string[];}
export function creationNameRules(bytes:ArrayBuffer):NameRules{
 const raw=new Uint8Array(bytes),encoding=raw[0]===255&&raw[1]===254||raw[1]===0?'utf-16le':'utf-8',allowed=new Set<number>(),forbidden:string[]=[],wholeWords:string[]=[];
 for(const line of new TextDecoder(encoding,{fatal:true}).decode(raw).split(/\r?\n/)){
  const fields=line.trim().split('\t');if(fields[0]==='#ALLOW_ID_TABLE'){const a=parseInt(fields[1]??'',16),b=parseInt(fields[2]??'',16);if(a>=0&&b<=65535)for(let n=a;n<=b;n++)allowed.add(n);}
  else if(!fields[0]?.startsWith('#')&&fields[0]&&fields[0]!=='\\n'&&[1,2].includes(Number(fields[1])))(Number(fields[1])===1?wholeWords:forbidden).push(fields[0].replace(/[A-Z]/g,c=>c.toLowerCase()));
 }
 if(!allowed.size)throw Error('Missing native name character table');return {allowed,forbidden,wholeWords};
}
export function creationNameError(name:string,rules:NameRules):string|null{
 if(name.length<2||name.length>12)return 'UIO_MSG_ERROR_CHARACTER_NAME_STRING';
 return checkedNameError(name,rules);
}
// 78E510 ASCII fold; 78FE50 substring list versus 790730 space-token lookup.
export function checkedNameError(name:string,rules:NameRules):string|null{
 const normalized=name.replace(/[A-Z]/g,c=>c.toLowerCase());
 if(Array.from(normalized).some(c=>!rules.allowed.has(c.codePointAt(0)!))||rules.forbidden.some(word=>normalized.includes(word))||normalized.split(/ +/).some(word=>rules.wholeWords.includes(word)))return 'UIO_MSG_ERROR_CHARACTER_WRONGSTRING';
 return null;
}
