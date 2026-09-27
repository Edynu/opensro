import type {CharacterActor} from '@/engine/contracts/character';
// 85EA70: bone translation, optional saddle transform, then normalized source ray.
export function damageAnchor(target:CharacterActor['pose'],caster:CharacterActor['pose'],offset:readonly [number,number,number],bone?:Float32Array|null,saddle?:Float32Array|null):CharacterActor['pose']{
 const f=Math.fround;let x=f(offset[0]+(bone?.[12]??0)),y=f(offset[1]+(bone?.[13]??0)),z=f(offset[2]-(bone?.[14]??0));
 if(saddle){const a=x,b=y,c=-z;x=f(saddle[0]!*a+saddle[4]!*b+saddle[8]!*c+saddle[12]!);y=f(saddle[1]!*a+saddle[5]!*b+saddle[9]!*c+saddle[13]!);z=f(-(saddle[2]!*a+saddle[6]!*b+saddle[10]!*c+saddle[14]!));}
 const region=target.regionId&0x8000,dx=f(caster.x-target.x+(region?0:((caster.regionId&255)-(target.regionId&255))*1920)),dy=f(caster.y-target.y),dz=f(caster.z-target.z+(region?0:((caster.regionId>>>8)-(target.regionId>>>8))*1920)),length=Math.sqrt(dx*dx+dy*dy+dz*dz),scale=length?f(-z/length):0;
 return {...target,x:f(target.x+f(dx*scale)),y:f(f(target.y+f(dy*scale))+y),z:f(target.z+f(dz*scale))};
}
