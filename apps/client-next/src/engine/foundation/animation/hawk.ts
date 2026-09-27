// CIDPHawk 8E3730/8E3800/8E39E0. Coordinates here are native scene-space;
// the presentation adapter alone converts regions and the imported model axis.
export interface HawkPoint {readonly x:number;readonly y:number;readonly z:number;}
export type HawkPhase='hover'|'approach'|'attack'|'hold'|'return';
export interface HawkState {
 readonly phase:HawkPhase;readonly position:HawkPoint;readonly yaw:number;readonly targetYaw:number;
 readonly target:number;readonly damage:number;readonly remainingMs:number;readonly animationMs:number;
}
export type HawkEvent={readonly type:'command';readonly target:number;readonly damage:number}|{readonly type:'impact';readonly targetExists:boolean}|{readonly type:'animation-end'};
export function hawkInitial(position:HawkPoint,yaw:number):HawkState{return {phase:'hover',position:{...position},yaw,targetYaw:yaw,target:0,damage:0,remainingMs:0,animationMs:0};}
function phase(state:HawkState,next:HawkPhase):HawkState{return state.phase===next?state:{...state,phase:next,animationMs:0};}
export function hawkEvent(state:HawkState,event:HawkEvent):HawkState{
 switch(event.type){
  case 'command':return phase({...state,target:event.target,damage:event.damage,remainingMs:5000},'approach');
  case 'impact':return {...state,damage:0,target:event.targetExists?state.target:0};
  case 'animation-end':return state.phase==='attack'?phase(state,'hold'):state;
 }
}
export function hawkAnimation(state:HawkState):0|2|7{return state.phase==='approach'||state.phase==='return'?7:state.phase==='attack'?2:0;}
export function hawkYaw(x:number,z:number):number{
 // 8E3350 stores the quotient before CRT atan and reconstructs quadrants.
 // atan2 skips that float store and differs by one ULP on retail samples.
 const f=Math.fround,forward=-z,pi=3.1415927410125732,circle=6.283185482025146;
 if(x===0)return forward>=0?0:pi;
 const angle=f(Math.atan(Math.abs(f(x/forward))));
 return forward>0?(x>0?angle:f(circle-angle)):(x>0?f(pi-angle):f(pi+angle));
}
export function hawkTurn(current:number,target:number,step:number):number{
 const circle=6.283185482025146,pi=3.1415927410125732;
 const normalize=(v:number)=>v<0?Math.fround(v+circle):v>=circle?Math.fround(v-circle):v;
 current=normalize(current);target=normalize(target);
 let delta=Math.fround(target-current);if(Math.abs(delta)>pi)delta+=delta>0?-circle:circle;
 return Math.abs(delta)<=step?target:normalize(Math.fround(current+(delta>0?step:-step)));
}
export interface HawkFrame {
 readonly deltaMs:number;readonly holder:HawkPoint;readonly displayedHolder:HawkPoint;readonly holderYaw:number;readonly holderHeightFactor:number;
 readonly target?:HawkPoint&{readonly heightFactor:number;readonly dead:boolean};
}
export function stepHawk(input:HawkState,frame:HawkFrame):HawkState{
 const f=Math.fround,dt=frame.deltaMs;
 if(!Number.isInteger(dt)||dt<0)throw Error('Invalid hawk frame delta');
 let state=input,position=state.position,targetYaw=state.targetYaw,destination:HawkPoint|undefined,arrival=state.phase;
 if(['approach','attack','hold'].includes(state.phase)&&(!state.target||!frame.target))return phase(state,'return');
 const subtract=(a:HawkPoint,b:HawkPoint)=>({x:f(a.x-b.x),y:f(a.y-b.y),z:f(a.z-b.z)});
 const square=(p:HawkPoint)=>f(p.x*p.x+p.y*p.y+p.z*p.z);
 const toward=(p:HawkPoint)=>{const d=subtract(p,position);if(square(d)>0)targetYaw=hawkYaw(d.x,d.z);return square(d);};
 switch(state.phase){
  case 'hover':position={...frame.displayedHolder,y:f(frame.displayedHolder.y+frame.holderHeightFactor*20+1)};targetYaw=frame.holderYaw;break;
  case 'approach':case 'hold':{
   const target=frame.target!,dx=f(target.x-position.x),dz=f(target.z-position.z),length=f(Math.sqrt(f(dx*dx+dz*dz)));
   destination={x:f(target.x-f((length?f(dx/length):0)*10)),y:f(target.y+target.heightFactor*20+9),z:f(target.z-f((length?f(dz/length):1)*10))};
   if(state.phase==='approach'){arrival='attack';if(toward(destination)>250000)position={...destination};}
   else{
    targetYaw=hawkYaw(f(target.x-position.x),f(target.z-position.z));
    state={...state,remainingMs:state.remainingMs-dt};
    if(state.remainingMs<=0||target.dead){state=phase(state,'return');arrival='return';}
   }
   break;
  }
  case 'attack':break;
  case 'return':destination={...frame.holder,y:f(frame.holder.y+frame.holderHeightFactor*20+1)};arrival='hover';toward(destination);break;
 }
 if(destination){
  const delta=subtract(destination,position),distance=square(delta),step=f(dt/10);
  if(distance>f(step*step)){
   const length=f(Math.sqrt(distance));position={x:f(position.x+f(f(delta.x/length)*step)),y:f(position.y+f(f(delta.y/length)*step)),z:f(position.z+f(f(delta.z/length)*step))};
  }else{position={...destination};state=phase(state,arrival);}
 }
 return {...state,position,targetYaw,yaw:hawkTurn(state.yaw,targetYaw,f(dt*5/1000))};
}
