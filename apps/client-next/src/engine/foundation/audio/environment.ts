import type {Pose,WorldClockSeed} from '@/engine/contracts/gameplay';
import {musicPath} from './music';
export interface AmbientLayer {readonly path:string|null;readonly min:number;readonly max:number;}
export interface AmbientProfile {readonly name:string;readonly music:string;readonly day:readonly AmbientLayer[];readonly night:readonly AmbientLayer[];}
export interface AudioRegion {readonly fallback:string|null;readonly rectangles:readonly {readonly name:string;readonly bounds:readonly [number,number,number,number]}[];}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid environment audio record');return value as Record<string,unknown>;}
function list(value:unknown):unknown[]{if(!Array.isArray(value)||value.length>4096)throw Error('Invalid environment audio list');return value;}
function name(value:unknown):string{if(typeof value!=='string'||!value.length||value.length>512)throw Error('Invalid environment audio name');return value;}
function integer(value:unknown,min:number,max:number):number{if(typeof value!=='number'||!Number.isInteger(value)||value<min||value>max)throw Error('Invalid environment audio integer');return value;}
export function decodeAmbientProfiles(value:unknown):readonly AmbientProfile[]{
 return list(record(value).profiles).map(value=>{const row=record(value),ambience=record(row.ambience);
  const layers=(value:unknown)=>list(value).map(value=>{const row=record(value),path=row.publicPath===undefined?null:name(row.publicPath),min=integer(row.min,0,0x7ffffffe),max=integer(row.max,min,0x7fffffff);
   if(path&&(!path.startsWith('/assets/audio/sfx/prim/snd/env/')||path.includes('..')||path.includes('\\')||path.includes('%'))||(min>0&&max===min))throw Error('Invalid environment audio layer');
   return {path,min,max};});
  if(row.bgmTrack&&row.bgmPublicPath===undefined)throw Error('Missing regional music asset: '+row.bgmTrack);
  return {name:name(row.name),music:row.bgmPublicPath===undefined?'':musicPath(row.bgmPublicPath),day:layers(ambience.day),night:layers(ambience.night)};
 });
}
export function decodeAudioRegions(input:unknown):ReadonlyMap<number,AudioRegion>{
 const sectors=new Map<number,{fallback:string|null;rectangles:{name:string;bounds:readonly [number,number,number,number]}[]}>();
 for(const value of list(record(input).regions)){const row=record(value),profile=name(row.name);
  for(const value of list(row.entries)){const e=record(value),key=integer(e.sectorX,0,255)|(integer(e.sectorY,0,255)<<8);
   if(e.coverage!=='all'&&e.coverage!=='rect')throw Error('Invalid audio region coverage');
   let sector=sectors.get(key);if(!sector){sector={fallback:null,rectangles:[]};sectors.set(key,sector);}
   // 412A80 replaces the ALL fallback; 412CE0 appends RECT overrides.
   if(e.coverage==='all')sector.fallback=profile;
   else {const r=record(e.rect);
    // The published legacy field names width/height contain right/bottom,
    // passed unchanged by 413620 and compared inclusively by 414030.
    sector.rectangles.push({name:profile,bounds:[integer(r.x,-32768,32767),integer(r.y,-32768,32767),integer(r.width,-32768,65535),integer(r.height,-32768,65535)]});
   }
  }
 }
 return sectors;
}
export function ambientProfileName(regions:ReadonlyMap<number,AudioRegion>,pose:Pose):string|null{
 // CRegionManagerBody vtable starts at C4359C; +60 is 414120.
 // First matching rectangle wins, then the sector's last ALL assignment.
 const sector=regions.get(pose.regionId);if(!sector)return null;
 for(const {name,bounds:[left,top,right,bottom]} of sector.rectangles)if(pose.x>=left&&pose.x<=right&&pose.z>=top&&pose.z<=bottom)return name;
 return sector.fallback;
}
// 728630 uses the calendar hour, not its remapped sky/sun coordinate.
export function ambientPeriod(seed:WorldClockSeed,now:number):'day'|'night'{
 const seconds=(((seed.hour*60+seed.minute)*60+Math.floor(Math.max(0,now-seed.receivedAtMs)/20))%86400);
 const hour=Math.fround(Math.fround(seconds/86400)*24);return hour<4||hour>20?'night':'day';
}
