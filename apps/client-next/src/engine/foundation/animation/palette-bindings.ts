import type {CharacterModel,CharacterPrimitive} from '@/engine/contracts/character';

// The pose owns this binding plan and its cached matrix products.
export function paletteBindings(model:CharacterModel):Pick<WeakMap<CharacterPrimitive,CharacterPrimitive>,'get'>{
 const bindings=new WeakMap<CharacterPrimitive,CharacterPrimitive>();const buckets=new Map<number,CharacterPrimitive[]>();
 const bits=(p:CharacterPrimitive)=>new Uint32Array(p.inverseBind.buffer,p.inverseBind.byteOffset,p.inverseBind.length);
 for(const primitive of model.primitives){
  let hash=2166136261;const words=bits(primitive);
  for(const joint of primitive.joints)hash=Math.imul(hash^joint,16777619);
  for(const word of words)hash=Math.imul(hash^word,16777619);
  let bucket=buckets.get(hash);if(!bucket){bucket=[];buckets.set(hash,bucket);}
  // Hashes only select candidates. Joint ordering and every float32 bit must
  // match, including signed zero, before products may be shared.
  const source=bucket.find(candidate=>candidate.joints.length===primitive.joints.length&&candidate.inverseBind.length===primitive.inverseBind.length&&candidate.joints.every((joint,i)=>joint===primitive.joints[i])&&bits(candidate).every((word,i)=>word===words[i]));
  bindings.set(primitive,source??primitive);if(!source)bucket.push(primitive);
 }
 return bindings;
}
