import {crtRandomRange} from '@/engine/foundation/math/crt-random';
export type OrbPoint=[number,number,number];
export interface OrbMover {position:OrbPoint;target:OrbPoint;velocity:OrbPoint;phase:0|1|2|3;elapsed:number;delay:number;speed:number;}
function length(v:OrbPoint){return Math.hypot(...v);}
function unit(v:OrbPoint):OrbPoint{const n=length(v)||1;return [v[0]/n,v[1]/n,v[2]/n];}
function dot(a:OrbPoint,b:OrbPoint){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function scale(a:OrbPoint,n:number):OrbPoint{return [Math.fround(a[0]*n),Math.fround(a[1]*n),Math.fround(a[2]*n)];}
function add(a:OrbPoint,b:OrbPoint):OrbPoint{return [Math.fround(a[0]+b[0]),Math.fround(a[1]+b[1]),Math.fround(a[2]+b[2])];}
// 866FA0 + 876BB0: five draws, including the native sequential X/Z rotation.
export function launchOrb(position:OrbPoint,target:OrbPoint,seed:number){
 let random=seed;const draw=(upper:number)=>{const r=crtRandomRange(random,0,upper);random=r.state;return r.value;};
 const angle=(draw(120)-60)*0.01745329238474369,dx=position[0]-target[0],dz=position[2]-target[2];
 const x=Math.fround(dx*Math.cos(angle)+dz*Math.sin(angle)),z=Math.fround(-Math.sin(angle)*x+Math.cos(angle)*dz);
 const direction=unit([x,0,z]);direction[1]=Math.fround(draw(400)/1000+0.1);
 const velocity=scale(unit(direction),50+draw(25)),delay=draw(800),speed=Math.fround(draw(400)/1000+0.9);
 return {random,mover:{position:[...position],target:[...target],velocity,phase:1,elapsed:0,delay,speed} as OrbMover};
}
// Rizin 876FDF branches past BOTH straightening and arrival when dot <= .93.
export function advanceOrb(m:OrbMover,deltaMs:number):boolean{
 if(m.phase===0)return false;if(deltaMs===0)return true;
 m.elapsed+=deltaMs;const vector:OrbPoint=[m.target[0]-m.position[0],m.target[1]-m.position[1],m.target[2]-m.position[2]],distance=length(vector);
 if(distance===0){m.phase=0;return false;}const direction=unit(vector),dt=Math.fround(deltaMs/1000);let timed=false;
 if(m.elapsed>m.delay+2200){m.phase=3;timed=true;m.velocity=scale(direction,length(m.velocity));}
 if(m.elapsed>m.delay+3500){m.position=[...m.target];m.phase=0;}
 if(m.phase===2){if(m.speed*0.5<dot(unit(m.velocity),direction))m.phase=3;m.velocity=add(m.velocity,scale(direction,Math.fround(m.speed*78.400001525878906*dt)));m.position=add(m.position,scale(m.velocity,dt));}
 else if(m.phase===3){
  m.velocity=add(m.velocity,scale(direction,Math.fround(m.speed*392*dt)));const speed=length(m.velocity);let blend=unit(add(scale(direction,0.5),scale(unit(m.velocity),0.5)));
  if(timed||dot(blend,direction)>0.93000000715255737){if(!timed)blend=direction;if(speed*dt>=distance){m.position=[...m.target];m.phase=0;return true;}}
  m.velocity=scale(blend,speed);m.position=add(m.position,scale(m.velocity,dt));
 }else if(m.phase===1&&m.elapsed>=m.delay)m.phase=2;
 return true;
}
