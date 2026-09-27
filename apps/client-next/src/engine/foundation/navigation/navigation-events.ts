import type {NavPlacement} from '@/engine/contracts/navigation';
import type {NavOwnerSpan} from './dungeon-ownership';
import {navLocal} from './object-navigation';
import {cellEntry} from './contact-response';
export interface NavigationEvent {readonly name:string;readonly entering:boolean;readonly placement:number;readonly cell:number;readonly edge:number|null;readonly fraction:number;readonly context:number;}
// 428290 uses signed cell ordinals; -1 denotes absence. Event high bits
// gate increasing/decreasing ordinals, not the geometric orientation of an edge.
export function navigationEventDirection(byte:number,from:number,to:number):boolean|null{
 if(!Number.isInteger(byte)||byte<0||byte>255||!Number.isInteger(from)||!Number.isInteger(to)||from< -1||to< -1)throw new Error('Invalid navigation event transition');
 if((byte&0x40)&&from<to)return true;
 if((byte&0x80)&&from>to)return false;
 return null;
}
export function navigationEvents(objects:readonly NavPlacement[],spans:readonly NavOwnerSpan[],context:number):NavigationEvent[]{
 const result:NavigationEvent[]=[];
 function append(placement:number,cell:number,edge:number|null,byte:number,from:number,to:number,fraction:number){
  const entering=navigationEventDirection(byte,from,to);if(entering===null)return;
  const name=objects[placement]!.mesh.eventNames?.[byte&63];if(name===undefined)throw new Error('Missing navigation event registry name');
  result.push({name,entering,placement,cell,edge,fraction,context});
 }
 for(let i=1;i<spans.length;i++){
  const a=spans[i-1]!,b=spans[i]!,p=objects[a.placement]!,q=objects[b.placement]!,same=a.placement===b.placement;
  let edge:number|null=null;
  for(let e=0;e<p.mesh.edges.length/6;e++){const o=e*6;if(same?((p.mesh.edges[o+2]===a.cell&&p.mesh.edges[o+3]===b.cell)||(p.mesh.edges[o+3]===a.cell&&p.mesh.edges[o+2]===b.cell)):p.links?.some(link=>link.edge===e&&link.target===b.placement)){edge=e;break;}}
  if(edge!==null)append(a.placement,a.cell,edge,p.mesh.edgeEvents?.[edge]??0,a.cell,same?b.cell:-1,b.from);
  const before=p.mesh.cellEvents?.[a.cell]??0,after=q.mesh.cellEvents?.[b.cell]??0;
  if(!same||!(before&192)||!(after&192)||(before&63)!==(after&63)){
   append(a.placement,a.cell,null,before,a.cell,-1,b.from);
   append(b.placement,b.cell,null,after,-1,b.cell,b.from);
  }
 }
 return result;
}

// 428930 callback stop: edge / destination-enter stops inset the hit into
// the SOURCE cell. Source-exit stops keep requested XZ. 428F40 then projects
// onto that retained cell's plane, even outside its triangle.
export function navigationEventStop(objects:readonly NavPlacement[],spans:readonly NavOwnerSpan[],event:NavigationEvent,from:readonly number[],to:readonly number[]){
 const source=spans.find(s=>s.to>=event.fraction-1e-8&&s.from<event.fraction);
 if(!source)throw Error('Navigation event has no source owner');
 const p=objects[source.placement]!,m=p.mesh,v=m.vertices,ids=m.cells.subarray(source.cell*3,source.cell*3+3);
 let q:readonly number[]=navLocal(p,to[0]!,to[1]!,to[2]!);
 if(event.edge!==null||event.entering){
  const hit=from.map((x,i)=>x+(to[i]!-x)*event.fraction),local=navLocal(p,hit[0]!,hit[1]!,hit[2]!);
  let cx=0,cz=0;for(const i of ids){cx+=v[i*3]!;cz+=v[i*3+2]!;}
  const at=cellEntry([Math.fround(cx/3),Math.fround(cz/3)],[Math.fround(local[0]),Math.fround(local[2])]);q=[at[0],local[1],at[1]];
 }
 const a=ids[0]!*3,b=ids[1]!*3,c=ids[2]!*3,ax=v[a]!,az=v[a+2]!,bx=v[b]!-ax,bz=v[b+2]!-az,cx=v[c]!-ax,cz=v[c+2]!-az,den=bx*cz-bz*cx;
 const u=((q[0]!-ax)*cz-(q[2]!-az)*cx)/den,w=(bx*(q[2]!-az)-bz*(q[0]!-ax))/den;
 const y=Math.fround(v[a+1]!+u*(v[b+1]!-v[a+1]!)+w*(v[c+1]!-v[a+1]!)),co=Math.cos(p.yaw),si=Math.sin(p.yaw);
 return {owner:{placement:source.placement,cell:source.cell},point:[Math.fround(co*q[0]!-si*q[2]!+p.x),Math.fround(y+p.y),Math.fround(si*q[0]!+co*q[2]!+p.z)] as const};
}
