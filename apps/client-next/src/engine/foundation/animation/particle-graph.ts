import {particleEmission,type ParticleEmitter as EmissionParameters} from '@/engine/foundation/animation/particle-emission';
import {identity} from '@/engine/foundation/rendering/world-math';
import {multiply} from '@/engine/foundation/math/pose-math';
import {initializeParticle,advanceParticle,type ParticleInstance,type ParticleProgram} from '@/engine/foundation/animation/particle-program';
export interface ParticleEmitter {
 readonly emission?:EmissionParameters;readonly capacity?:number;
 readonly loop?:boolean;
 readonly commands?:readonly {readonly name:string;readonly frames:readonly number[];readonly program:ParticleProgram}[];
 readonly parent:number;readonly parents:readonly number[];readonly births:readonly number[];readonly frames:number;
 readonly program?:ParticleProgram;readonly matrix?:readonly number[];
 readonly localMotion?:boolean;readonly shapeMotion?:boolean;readonly keepMatrix:boolean;readonly keepOrigin:boolean;readonly positionDepth:number;readonly matrixDepth:number;readonly velocityDepth:number;readonly followDepth:number;
 readonly scales:readonly (readonly number[])[];readonly positions:readonly (readonly number[])[];readonly rotations:readonly (readonly number[])[];
}
interface ParticleGroup {readonly parent:ParticleElement;total:number;}
export interface ParticleElement {serial:number;born:number;clockBirth:number;age:number;alive:boolean;children:number;released:boolean;group?:ParticleGroup;readonly previousPosition:number[];readonly state:ParticleInstance;readonly matrix:Float32Array;readonly delta:Float32Array;readonly origin:number[];readonly local:Float32Array;readonly shape:Float32Array;readonly parent:ParticleElement;}
export interface ParticleGraphState {serial:number;frame:number;index:number;readonly births:number[][];readonly parents:(ParticleElement|undefined)[][];readonly groups:Map<ParticleElement,ParticleGroup>[];readonly elements:(ParticleElement|undefined)[][];readonly root:ParticleElement;}
function affine(m:ArrayLike<number>,v:ArrayLike<number>){return [0,1,2].map(i=>Math.fround(m[i]!*v[0]!+m[4+i]!*v[1]!+m[8+i]!*v[2]!+m[12+i]!));}
function inverse(m:Float32Array){
 const a=m[0]!,b=m[4]!,c=m[8]!,d=m[1]!,e=m[5]!,f=m[9]!,g=m[2]!,h=m[6]!,i=m[10]!;
 const det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);if(Math.abs(det)<1e-12)throw Error('Singular particle motion matrix');
 const out=identity();out.set([(e*i-f*h)/det,(f*g-d*i)/det,(d*h-e*g)/det,0,(c*h-b*i)/det,(a*i-c*g)/det,(b*g-a*h)/det,0,(b*f-c*e)/det,(c*d-a*f)/det,(a*e-b*d)/det,0]);
 const t=affine(out,[-m[12]!,-m[13]!,-m[14]!]);out.set(t,12);return out;
}
function ancestor(element:ParticleElement,depth:number):ParticleElement|undefined{if(!depth)return;let result=element.parent;for(let n=1;n<depth&&result.parent!==result;n++)result=result.parent;return result;}
function commands(element:ParticleElement,def:ParticleEmitter,age:number,history:ParticleGraphState,table:Float32Array,sibling?:ParticleElement){
 for(const command of def.commands??[]){if(!command.frames.includes(age))continue;
  const program=command.program;
  if(program.vectors){vectors(element,{vectors:program.vectors.map(op=>({...op,frames:[age]}))},age,sibling);continue;}
  if(program.rVelocity){element.local.set(program.rVelocity);continue;}
  if(program.spin){element.shape.set(program.spin);continue;}
  if(program.shape){element.state.rotation.set(program.shape);continue;}
  if(program.attraction!==undefined){const difference=element.state.position.map((v,i)=>v-element.parent.state.position[i]!);const length=Math.hypot(...difference);if(length>1e-6)for(let i=0;i<3;i++)element.state.velocity[i]=Math.fround(element.state.velocity[i]!+difference[i]!*program.attraction/length);continue;}
  const flags=program.coneFlags??program.coneForceFlags??0;
  if(flags===3&&!sibling)continue;
  const basis=flags===1?element.matrix:flags===3?sibling!.matrix:element.parent.matrix;
  const sample=initializeParticle({...program,coneFlags:flags?2:0,coneForceFlags:flags?2:0},table,history.index,basis);history.index=sample.index;
  if(program.sphere)element.state.position=sample.state.position.map((v,i)=>Math.fround(v+element.parent.state.position[i]!));
  if(program.conePos)element.state.position=sample.state.position.map((v,i)=>Math.fround(v+element.state.position[i]!));
  if(program.cone)element.state.velocity=sample.state.velocity;
  if(program.coneForce)element.state.velocity=sample.state.velocity.map((v,i)=>Math.fround(v+element.state.velocity[i]!));
  if(program.scale)element.state.scale=sample.state.scale;
 }
}
function vectors(element:ParticleElement,program:ParticleProgram,frame:number,sibling?:ParticleElement){
 for(const op of program.vectors??[]){if(!op.frames.includes(frame))continue;const flag=op.flags;let v=[...op.value];
  if(op.name==='SetPosition'){
   if((flag===2||flag===5)&&!sibling)continue;
   const base=flag===1||flag===4||flag===7?element.parent:flag===2||flag===5?sibling:undefined;
   if(flag>=3)v=affine(flag>=6?element.parent.matrix:element.matrix,v);
   if(base)element.state.position=[...base.state.position];
   for(let i=0;i<3;i++)element.state.position[i]=Math.fround(element.state.position[i]!+v[i]!);
  }else{
   if(flag===3&&!sibling)continue;
   if(flag)v=affine(flag===1?element.matrix:flag===2?element.parent.matrix:sibling!.matrix,v);
   for(let i=0;i<3;i++)element.state.velocity[i]=Math.fround(v[i]!+(op.name==='Force'?element.state.velocity[i]!:0));
  }
 }
}
export function createParticleGraph(graph:readonly ParticleEmitter[],index:number):ParticleGraphState{
 const root={previousPosition:[0,0,0],serial:0,born:0,clockBirth:0,age:0,alive:true,children:0,released:false,state:{position:[0,0,0],velocity:[0,0,0],scale:[1,1,1],rotation:identity(),frame:0},matrix:identity(),delta:identity(),origin:[0,0,0],local:identity(),shape:identity()} as ParticleElement;
 Object.assign(root,{parent:root});return {serial:0,frame:-1,index,elements:graph.map(()=>[]),births:graph.map(d=>d.emission?[]:[...d.births]),parents:graph.map(()=>[]),groups:graph.map(d=>d.parent<0?new Map([[root,{parent:root,total:0}]]):new Map()),root};
}
// One chronological owner updates invisible parents before their child groups.
// Retained expired elements supply identity/state to descendants, never new draws.
export function advanceParticleGraph(history:ParticleGraphState,graph:readonly ParticleEmitter[],time:number,transform:Float32Array,table:Float32Array,stop=Infinity,shiftX=0,shiftZ=0,keepRoots=false){
 const target=Math.min(Math.floor(time*20+1e-6),graph.some(def=>def.loop||def.emission)?Infinity:graph.reduce((last,def)=>Math.max(last,...def.births.map(b=>b+def.frames)),0));if(target<history.frame||!Number.isSafeInteger(target))throw Error('Invalid particle graph time');
 for(const rows of history.elements)for(const e of rows)if(e){e.state.position[0]!+=shiftX;e.state.position[2]!+=shiftZ;e.origin[0]!+=shiftX;e.origin[2]!+=shiftZ;e.previousPosition[0]!+=shiftX;e.previousPosition[2]!+=shiftZ;}
 const root=history.root;root.state.position[0]!+=shiftX;root.state.position[2]!+=shiftZ;
 const oldRoot=[...root.state.position],oldMatrix=root.matrix.slice();
 root.matrix.set(transform);root.matrix[12]=root.matrix[13]=root.matrix[14]=0;
 multiply(root.matrix,inverse(oldMatrix),root.delta);
 for(let tick=history.frame+1;tick<=target;tick++){
  root.origin.splice(0,3,...(history.frame<0?Array.from(transform.subarray(12,15)):oldRoot));
  root.state.position=Array.from(transform.subarray(12,15));
  if(tick>history.frame+1){root.origin.splice(0,3,...root.state.position);root.delta.set(identity());}
  root.age=tick;
  // AF2A40 returns capacity on retirement, even while descendants retain the
  // dead parent. Release identity only after the last descendant lets it go.
  for(let n=0;n<graph.length;n++)for(const element of history.elements[n]!){
   if(!element||!element.alive)continue;element.previousPosition.splice(0,3,...element.state.position);const def=graph[n]!;
   if((def.loop||keepRoots&&def.parent<0&&tick/20<stop)&&tick-element.clockBirth>=def.frames)element.clockBirth+=Math.floor((tick-element.clockBirth)/def.frames)*def.frames;
   element.age=tick-element.clockBirth;
   if(element.age>=def.frames){element.alive=false;if(element.group)element.group.total=Math.fround(element.group.total-1);element.origin.splice(0,3,...element.state.position);element.delta.set(identity());}
  }
  let released=true;while(released){released=false;for(const rows of history.elements)for(const element of rows)if(element&&!element.alive&&!element.children&&!element.released){element.released=true;element.parent.children--;for(const groups of history.groups)groups.delete(element);released=true;}}
  for(let n=0;n<graph.length;n++){
   const def=graph[n]!,rows=history.elements[n]!,births=history.births[n]!;
   if(def.emission&&tick/20<stop)for(const group of history.groups[n]!.values()){
    if(!group.parent.alive)continue;const emitted=particleEmission(def.emission,group.total,group.parent.age);group.total=emitted.total;
    for(let count=0;count<emitted.emitted;count++){
     let slot=rows.findIndex(e=>e?.released);if(slot<0)slot=rows.length;
     if(slot>=(def.capacity??def.births.length))throw Error('Particle live capacity exceeded');
     // Reserve distinct slots for simultaneous births before evaluation.
     rows[slot]=undefined;births[slot]=tick;history.parents[n]![slot]=group.parent;
     rows.length=Math.max(rows.length,slot+1);
    }
   }
   for(let b=0;b<births.length;b++){
    const birth=births[b]!,elapsed=tick-birth,existing=rows[b],age=existing?existing.age:def.loop&&elapsed>=0?elapsed%def.frames:elapsed;if(age<0||(!existing&&birth/20>=stop))continue;
    const parent=def.emission?history.parents[n]![b]:def.parent<0?root:history.elements[def.parent]![def.parents[b]!] ;if(!parent)continue;
    let element=rows[b];const previous=def.keepMatrix?element?.matrix.slice():undefined;
    // The old sorted list was consumed only at its final element. Select the
    // same greatest serial directly, including later equal-serial entries.
    let sibling:ParticleElement|undefined;
    if(def.emission){for(const e of rows)if(e&&e!==element&&e.alive&&e.parent===parent&&e.born<=birth&&(!element||e.serial<element.serial)&&(!sibling||e.serial>=sibling.serial))sibling=e;}
    else if(b>0&&def.parents[b-1]===def.parents[b])sibling=rows[b-1];
    if(!element){
     const sample=initializeParticle(def.commands?{}:def.program??{},table,history.index,parent.matrix);history.index=sample.index;
     const state=sample.state;const inherited=[...parent.state.velocity];state.position=state.position.map((v,i)=>Math.fround(v+parent.state.position[i]!));
     element={previousPosition:[...state.position],serial:++history.serial,born:birth,clockBirth:birth,age:0,alive:true,children:0,released:false,group:def.emission?history.groups[n]!.get(parent):undefined,state,matrix:parent.matrix.slice(),delta:identity(),origin:[...parent.state.position],local:identity(),shape:identity(),parent};rows[b]=element;parent.children++;
     for(let child=0;child<graph.length;child++)if(graph[child]!.parent===n&&graph[child]!.emission)history.groups[child]!.set(element,{parent:element,total:0});
     if(def.matrixDepth<0){const translation=element.matrix.slice(12,15);element.matrix.set(identity());element.matrix.set(translation,12);}
     if(def.matrix)element.matrix.set(def.matrix);
     const follow=ancestor(element,def.followDepth);for(let i=0;i<3;i++){inherited[i]=Math.fround(inherited[i]!-(follow?.state.velocity[i]??0));state.position[i]=Math.fround(state.position[i]!+inherited[i]!);if(def.commands||!def.program?.cone)state.velocity[i]=Math.fround(state.velocity[i]!+inherited[i]!);}
     element.state.angularVelocity=undefined;
     if(!def.commands&&def.program)vectors(element,def.program,0,sibling);
    }else if(age<def.frames){
     if(def.keepOrigin)element.origin.splice(0,3,...element.state.position);
     const positionParent=ancestor(element,def.positionDepth),matrixParent=ancestor(element,Math.max(0,def.matrixDepth)),velocityParent=ancestor(element,def.velocityDepth),follow=ancestor(element,def.followDepth);
     if(positionParent){const relative=element.state.position.map((v,i)=>v-positionParent.origin[i]!);element.state.position=affine(positionParent.delta,relative).map((v,i)=>Math.fround(v+positionParent.origin[i]!));}
     if(matrixParent){const out=identity();multiply(matrixParent.delta,element.matrix,out);element.matrix.set(out);}
     if(def.localMotion){const out=identity();multiply(element.matrix,element.local,out);element.matrix.set(out);}
     if(velocityParent)element.state.velocity=affine(velocityParent.delta,element.state.velocity);
     if(follow)for(let i=0;i<3;i++)element.state.position[i]=Math.fround(element.state.position[i]!+follow.state.position[i]!-follow.origin[i]!);
     history.index=advanceParticle(element.state,{...(def.commands?{}:def.program),spin:undefined,attraction:undefined},element.state.frame+1,table,history.index);
     if(def.shapeMotion){const out=identity();multiply(element.state.rotation,element.shape,out);element.state.rotation.set(out);}
     if(!def.commands&&def.program)vectors(element,def.program,age,sibling);
    }
    if(age<def.frames){
     commands(element,def,age,history,table,sibling);
     const program=def.commands?undefined:def.program;
     if(program?.rVelocity&&(program.rotationFrames??[0]).includes(age))element.local.set(program.rVelocity);
     if(program?.spin&&(program.spinFrames??[0]).includes(age))element.shape.set(program.spin);
     if(program?.attraction!==undefined&&(program.attractionFrames??[0]).includes(age)){
      // AF4410/4A: (element.position - sourceParent.position) * signed strength.
      const difference=element.state.position.map((v,i)=>v-parent.state.position[i]!);const length=Math.hypot(...difference);
      if(length>1e-6)for(let i=0;i<3;i++)element.state.velocity[i]=Math.fround(element.state.velocity[i]!+difference[i]!*program.attraction/length);
     }
     const at=Math.min(age,def.scales.length-1);if(at>=0)element.state.scale=[...def.scales[at]!];
     const pos=def.positions[Math.min(age,def.positions.length-1)];if(pos)element.state.position=affine(parent.matrix,pos).map((v,i)=>Math.fround(v+parent.state.position[i]!));
     const rot=def.rotations[Math.min(age,def.rotations.length-1)];if(rot)element.matrix.set(rot);
     if(def.keepMatrix&&previous)multiply(element.matrix,inverse(previous),element.delta);
     element.state.frame=age;
     if(element.born===tick)element.previousPosition.splice(0,3,...element.state.position);
    }else{element.origin.splice(0,3,...element.state.position);element.delta.set(identity());}
   }
  }
 }
 history.frame=target;
}
// Presentation-only bounded prediction: exact tick poses are unchanged.
// No random draws, command execution, births or retirement occur here.
export function particleElementMatrix(element:ParticleElement,out:Float32Array,offset:number,fraction=0){
 out.set(element.matrix,offset);const blend=Math.max(0,Math.min(1,fraction));
 for(let axis=0;axis<3;axis++)out[offset+12+axis]=element.state.position[axis]!+(element.state.position[axis]!-element.previousPosition[axis]!)*blend;
}
