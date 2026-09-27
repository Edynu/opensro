import type {CharacterNode} from '@/engine/contracts/character';
import {compose,multiply} from '@/engine/foundation/math/pose-math';
import {identity} from '@/engine/foundation/rendering/world-math';
export interface EquipmentBranch {readonly part:string;readonly attachBone:string;readonly nodes:readonly CharacterNode[];}
export function equipmentSocket(slot:number,part:string,bone:string){return `equipment:${slot}:${part}:${bone}`;}
export function validateEquipmentBranches(branches:readonly EquipmentBranch[]|undefined){
 if(branches===undefined)return;
 if(!Array.isArray(branches)||branches.length>16)throw Error('Invalid equipment branches');
 for(const b of branches){
  if(!b||typeof b.part!=='string'||typeof b.attachBone!=='string'||!b.attachBone||!Array.isArray(b.nodes)||b.nodes.length>256)throw Error('Invalid equipment branch');
  const names=new Set<string>();
  for(let i=0;i<b.nodes.length;i++){const n=b.nodes[i]!;if(!n||typeof n.name!=='string'||names.has(n.name)||!Number.isInteger(n.parent)||n.parent< -1||n.parent>=i||!Array.isArray(n.translation)||n.translation.length!==3||!Array.isArray(n.rotation)||n.rotation.length!==4||!Array.isArray(n.scale)||n.scale.length!==3||![...n.translation,...n.rotation,...n.scale].every(Number.isFinite)||[...n.scale].some((v:number)=>v!==1)||n.matrix)throw Error('Invalid private socket node');names.add(n.name);}
 }
}
/** ABC680 links a handle-local branch. AB5870 replaces parent skin-matrix
 * translation with parent world position; AB68C0 composes ordinary children.
 * Cancel the parent's bind rotation only. Keep the body's glTF basis adapter. */
export function appendEquipmentSockets(body:readonly CharacterNode[],branches:readonly EquipmentBranch[],slot:number):CharacterNode[]{
 const nodes=[...body],rest=new Map<number,Float32Array>();
 function bind(index:number):Float32Array{
  const old=rest.get(index);if(old)return old;
  const n=body[index]!;if(!n)throw Error('Missing attachment parent');
  if(n.name==='__gltf_left_handed__')return identity();
  const local=new Float32Array(16);if(n.matrix)local.set(n.matrix);else compose(n.translation,n.rotation,n.scale,local);
  const value=new Float32Array(16);if(n.parent<0)value.set(local);else multiply(bind(n.parent),local,value);rest.set(index,value);return value;
 }
 for(const branch of branches){
  const parent=body.findIndex(n=>n.name===branch.attachBone);if(parent<0)throw Error('Missing native wearer socket '+branch.attachBone);
  const world=bind(parent),cancel=identity();
  for(let c=0;c<3;c++)for(let r=0;r<3;r++)cancel[c*4+r]=world[r*4+c]!;
  const anchor=nodes.length;nodes.push({name:equipmentSocket(slot,branch.part,'$root'),parent,translation:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1],matrix:[...cancel]});
  const start=nodes.length;
  for(const n of branch.nodes)nodes.push({...n,name:equipmentSocket(slot,branch.part,n.name),parent:n.parent<0?anchor:start+n.parent});
 }
 if(nodes.length>1024)throw Error('Equipment socket budget exceeded');
 return nodes;
}
