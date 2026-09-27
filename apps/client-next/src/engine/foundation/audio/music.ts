export interface MusicRequest {readonly path:string;readonly loop:boolean;}
export function musicPath(value:unknown):string{
 if(typeof value!=='string'||!/^\/assets\/audio\/music\/[a-zA-Z0-9_-]+\.mp3$/.test(value))throw Error('Invalid music asset path');return value;
}
// 8F78F3..8F7BDE: mode 0 repeats the region track; special tracks do not.
// The carol counter belongs to the process, survives scene teardown and wraps u8.
export function createMusicSelection(){let carol=0;return (mode:number,region:string,playing:boolean,current:string):MusicRequest|null=>{
 if(mode===0)return {path:region,loop:true};
 if(mode===1){if(playing&&current.startsWith('event_'))return null;const n=(carol&3)+1;carol=(carol+1)&255;return {path:`/assets/audio/music/event_carol_0${n}.mp3`,loop:false};}
 if(mode===2||mode===3){const name=mode===2?'shiningstar':'fortress_war';if(playing&&current.startsWith(name))return null;return {path:`/assets/audio/music/${name}.mp3`,loop:false};}
 return null;
};}
// A241D0: float-narrow the decreasing factor, multiply the CURRENT DS volume,
// truncate toward zero, then stop at <= -5000 hundredths of a dB.
export function musicFade(factor:number,volumeDb:number){const next=Math.fround(factor-0.00800000037997961),db=Math.trunc(next*(volumeDb+10000))-10000;return {factor:next,db,stop:db<=-5000};}
// The browser streams MP3 conversions. Read their clock without decoding a
// whole long track into AudioBuffers (AudioContext may also resample it).
export function musicSampleRate(bytes:Uint8Array):number{
 let start=0;if(bytes[0]===73&&bytes[1]===68&&bytes[2]===51){if(bytes.length<10)throw Error('Truncated music metadata');start=10+((bytes[6]!&127)*2097152+(bytes[7]!&127)*16384+(bytes[8]!&127)*128+(bytes[9]!&127));}
 for(let i=start;i+4<=bytes.length&&i<start+65536;i++){
  if(bytes[i]!==255||(bytes[i+1]!&224)!==224)continue;
  const version=(bytes[i+1]!>>3)&3,layer=(bytes[i+1]!>>1)&3,index=(bytes[i+2]!>>2)&3,bitrate=bytes[i+2]!>>4;
  if(version===1||layer!==1||index===3||bitrate===0||bitrate===15)continue;
  return [44100,48000,32000][index]!/(version===3?1:version===2?2:4);
 }
 throw Error('Missing MP3 music clock');
}
