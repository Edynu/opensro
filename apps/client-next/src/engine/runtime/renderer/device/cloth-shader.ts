/*
===========================================================================

cloth-shader.ts - the GPU cloth solver compute pass

Port-only, not native (Experimental "GPU cloth"). One workgroup owns one
cloth instance and repeats cloth.ts advance in float32: skin the anchors
from the batch's GPU palette, reset or re-pin, then per step integrate every
vertex in parallel and run the ordered extension constraints on one
invocation (they are sequential: each correction reads the last). The free
vertices' positions go straight into the pins draw's vertex stream; the
pins themselves are skinned by that draw. WGSL float32 arithmetic is not
the CPU's rounding sequence, so results differ from the native solver in
the last bits.

Statics (one per mesh, f32): per vertex rest xyz + pin, normal xyz +
mobility, joints, weights; then per constraint in execution order a, b,
rest length.

===========================================================================
*/
export const CLOTH_WORKGROUP = 64;
// Cloth vertices the constraint pass keeps in workgroup memory (16 bytes
// each, within WebGPU's 16 KiB minimum); a larger cloth stays in storage.
export const CLOTH_LOCAL_VERTICES = 1000;

export const clothShader = `
struct Job{counts:vec4u,palette:vec4u,force:vec4f,direction:vec4f,params:vec4f}
@group(0) @binding(0) var<storage,read> statics:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> state:array<vec4f>;
@group(0) @binding(2) var<uniform> job:Job;
@group(0) @binding(3) var<storage,read> gusts:array<u32>;
@group(0) @binding(4) var<storage,read> palettes:array<mat4x4f>;
@group(0) @binding(5) var<storage,read_write> vertices:array<f32>;
const PASSES=7u;
const TOLERANCE=0.009999999776482582;
const FORCE_STEP=0.00039999998989515007;
const LANES=${CLOTH_WORKGROUP}u;
const LOCAL=${CLOTH_LOCAL_VERTICES}u;
var<workgroup> local:array<vec4f,${CLOTH_LOCAL_VERTICES}>;
fn skin(i:u32,n:u32,p:vec4f)->vec3f{
 let joints=statics[n*2u+i];let weights=statics[n*3u+i];var out=vec3f(0.);
 for(var k=0u;k<4u;k++){if(weights[k]!=0.){out+=(palettes[job.palette.x+u32(joints[k])]*p).xyz*weights[k];}}
 return out;
}
@compute @workgroup_size(${CLOTH_WORKGROUP}) fn main(@builtin(local_invocation_index) lane:u32){
 let n=job.counts.x;let m=job.counts.y;let reset=job.counts.z!=0u;
 for(var i=lane;i<n;i+=LANES){
  let rest=statics[i];let pin=u32(rest.w);
  if(reset||pin!=0u){
   let anchor=skin(i,n,vec4f(rest.xyz,1.));
   state[i]=vec4f(anchor,0.);
   if(reset){
    state[n+i]=vec4f(anchor,0.);
    if(pin==0u){let normal=skin(i,n,vec4f(statics[n+i].xyz,0.));vertices[i*14u+3u]=normal.x;vertices[i*14u+4u]=normal.y;vertices[i*14u+5u]=normal.z;}
   }
  }
 }
 storageBarrier();workgroupBarrier();
 let force=select(job.direction.xyz,job.force.xyz,job.palette.y!=0u);
 let damping=job.params.x;let gravity=job.params.y;let gravityMobility=job.params.z;let windMobility=job.params.w;
 for(var s=0u;s<job.counts.w;s++){
  for(var i=lane;i<n;i+=LANES){
   if(u32(statics[i].w)==1u){continue;}
   let weight=statics[n+i].w;
   let push=select(vec3f(0.),force*job.direction.w*(windMobility*weight+1.),((gusts[i]>>s)&1u)!=0u);
   let acceleration=(vec3f(0.,(gravityMobility*weight+1.)*gravity*-5.,0.)+push)*FORCE_STEP;
   let current=state[i].xyz;let velocity=(current-state[n+i].xyz)*damping;
   state[n+i]=vec4f(current,0.);state[i]=vec4f(current+(velocity+acceleration),0.);
  }
  storageBarrier();workgroupBarrier();
  // The constraints run on one invocation; a cloth that fits works in
  // workgroup memory (position, mobility) instead of storage.
  let fits=n<=LOCAL;
  if(fits){for(var i=lane;i<n;i+=LANES){local[i]=vec4f(state[i].xyz,statics[n+i].w);}}
  workgroupBarrier();
  if(lane==0u){
   if(fits){
    for(var sweep=0u;sweep<PASSES;sweep++){
     var settled=true;
     for(var e=0u;e<m;e++){
      let c=statics[n*4u+e];let a=u32(c.x);let b=u32(c.y);
      let va=local[a];let vb=local[b];let d=vb.xyz-va.xyz;let span=sqrt(dot(d,d));let extension=span-c.z;
      if(extension<TOLERANCE){continue;}
      settled=false;
      let sum=va.w+vb.w;let correction=(d/span)*extension;
      local[a]=vec4f(va.xyz+correction*(va.w/sum),va.w);local[b]=vec4f(vb.xyz-correction*(vb.w/sum),vb.w);
     }
     if(settled){break;}
    }
   }else{
    for(var sweep=0u;sweep<PASSES;sweep++){
     var settled=true;
     for(var e=0u;e<m;e++){
      let c=statics[n*4u+e];let a=u32(c.x);let b=u32(c.y);
      let pa=state[a].xyz;let pb=state[b].xyz;let d=pb-pa;let span=sqrt(dot(d,d));let extension=span-c.z;
      if(extension<TOLERANCE){continue;}
      settled=false;
      let ma=statics[n+a].w;let mb=statics[n+b].w;let sum=ma+mb;
      let correction=(d/span)*extension;
      state[a]=vec4f(pa+correction*(ma/sum),0.);state[b]=vec4f(pb-correction*(mb/sum),0.);
     }
     if(settled){break;}
    }
   }
  }
  workgroupBarrier();
  if(fits){for(var i=lane;i<n;i+=LANES){state[i]=vec4f(local[i].xyz,0.);}}
  storageBarrier();workgroupBarrier();
 }
 for(var i=lane;i<n;i+=LANES){
  if(u32(statics[i].w)!=0u){continue;}
  let p=state[i].xyz;vertices[i*14u]=p.x;vertices[i*14u+1u]=p.y;vertices[i*14u+2u]=p.z;
 }
}`;
