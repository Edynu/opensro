import type {CharacterModel} from '@/engine/contracts/character';
import {createCharacterPose} from './animation-pose';
import {geometryVertex,geometryPickBounds,type PickBounds} from '@/engine/foundation/rendering/picking';
import {identity} from '@/engine/foundation/rendering/world-math';
// Native 0x8e7b80 -> 0x8e7900 tests the aggregate model box, not the
// animated triangles or their texture alpha. Build once per admitted assembly.
export function characterPickVolume(model:CharacterModel):PickBounds{
 const pose=createCharacterPose(model);pose.evaluate('',0);const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity],matrix=identity();
 for(const primitive of model.primitives){
  if(primitive.emission)continue;
  const palette=new Float32Array(primitive.joints.length*16);pose.palette(primitive,palette);
  const points=new Float32Array(primitive.geometry.positions.length);
  for(let i=0;i<points.length/3;i++)points.set(geometryVertex(primitive.geometry,matrix,i,palette.length?palette:undefined),i*3);
  const b=geometryPickBounds(points);for(let i=0;i<3;i++){bounds[i]=Math.min(bounds[i]!,b[i]!);bounds[i+3]=Math.max(bounds[i+3]!,b[i+3]!);}
 }
 return [bounds[0]!,bounds[1]!,bounds[2]!,bounds[3]!,bounds[4]!,bounds[5]!];
}
