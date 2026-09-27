export const number=new Intl.NumberFormat('en-US');
export const fmt=value=>Number.isFinite(value)?number.format(value):'—';
export const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function coordinates(entity){
 if(entity.region&0x8000)return {x:entity.x/10,y:entity.z/10,indoor:true};
 return {x:((entity.region&255)-135)*192+entity.x/10,y:((entity.region>>>8)-92)*192+entity.z/10,indoor:false};
}
export function grade(rarity){return ({0:'Normal',1:'Champion',3:'Unique',4:'Giant',5:'Titan',6:'Elite',7:'Strong',8:'Elite',9:'Unique'})[rarity&15]??`Grade ${rarity&15}`;}
export function isUnique(m){return (m.rarity&15)===3;}
export function census(monsters,query='',rarity='all'){
 const q=query.trim().toLowerCase();return monsters.filter(m=>{
  const matchesGrade=rarity==='all'||(rarity==='other'?![0,1,3,4].includes(m.rarity&15):(m.rarity&15)===Number(rarity));
  return matchesGrade&&(!q||`${m.name} ${m.gid} ${m.ref} ${m.region}`.toLowerCase().includes(q));
 });
}
export function historySample(data,previous){
 const at=Date.parse(data.capturedAt),dt=previous?(at-previous.at)/1000:0,t=data.transport;
 const reset=!previous||data.uptimeSeconds<previous.uptime;
 return {at,uptime:data.uptimeSeconds,tick:t.tick_last_ms,heap:data.runtime.metrics['/memory/classes/heap/objects:bytes']/1048576,bytes:t.bytes_out,inBytes:t.bytes_in,outRate:!reset&&dt>0?Math.max(0,t.bytes_out-previous.bytes)/dt:null,inRate:!reset&&dt>0?Math.max(0,t.bytes_in-previous.inBytes)/dt:null,players:data.players.length};
}
export function uptime(seconds){if(!Number.isFinite(seconds))return '—';return `${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`;}
export function byteSize(n){if(!Number.isFinite(n))return '—';if(n<1024)return fmt(n)+' B';if(n<1048576)return (n/1024).toFixed(1)+' KiB';return (n/1048576).toFixed(1)+' MiB';}
