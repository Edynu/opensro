import {sceneryMaterial,type Modifier,type MaterialModifier,type TextureModifier} from '@/engine/foundation/rendering/scenery-modifiers';
import {createModifierDelta} from '@/engine/foundation/rendering/modifier-delta';
import {createMaterialTimeline} from '@/engine/foundation/rendering/material-timeline';
import {createTextureMotion} from '@/engine/foundation/rendering/texture-motion';
import {createTextureAtlas} from '@/engine/foundation/rendering/texture-atlas';
import type {CharacterActor,CharacterPrimitive} from '@/engine/contracts/character';
import type {WorldMaterial} from '@/engine/contracts/scene';
export interface MaterialClock {glow?:ReturnType<typeof import("@/engine/foundation/rendering/equipment-glow").createEquipmentGlowClock>;colors?:{rgb:Float32Array;flags:number}[];material?:WorldMaterial;color?:ReturnType<typeof createMaterialTimeline>;texture?:ReturnType<typeof createTextureMotion>|ReturnType<typeof createTextureAtlas>;flags:number;colorChanged:boolean;textureChanged:boolean;}
/** CRTModMtrl has no key handlers. AB3460 selects the queue; AED1F0 advances
 * only queued, LOD-eligible instances. Its clock survives BAN replacement. */
export function createAnimatedMaterial(){
 const clocks=new Map<Modifier,MaterialClock>(),deltaFor=createModifierDelta();let delta=0,frame=0;
 const updated=new Map<Modifier,number>();
 return {begin(seconds:number){delta=deltaFor(seconds);frame++;},
  sample(primitive:CharacterPrimitive,actor:CharacterActor):MaterialClock{
   const source=primitive.modifierSource!,mods=source.modifiers,selector=actor.modelAnimation?.selected;
   const selected=(m:Modifier)=>m.kind===1&&!!selector&&m.stateId===selector.state&&m.animationSetName===selector.set;
   const override=selector?.override||[...mods.materialModifiers,...mods.textureModifiers].find(selected)?.baseWords[4]!==undefined&&[...mods.materialModifiers,...mods.textureModifiers].find(selected)!.baseWords[4]!==0;
   const active=(m:Modifier)=>(selected(m)||!override&&m.kind===2&&m.animationSetName.toLowerCase()==='ambient')&&(m.baseWords[3]===0xffffffff||m.baseWords[3]===source.index);
   let material=source.material;const result:MaterialClock={colors:[],flags:0,colorChanged:true,textureChanged:true};
   function instance(m:MaterialModifier|TextureModifier,color:boolean){
    let clock=clocks.get(m);if(!clock){
     const projected=sceneryMaterial(source.material,{materialModifiers:color?[m as MaterialModifier]:[],textureModifiers:color?[]:[m as TextureModifier]},source.index,message=>{throw Error(message);},()=>true);
     clock={flags:color?(m as MaterialModifier).flags:0,color:projected.colorTimeline?createMaterialTimeline(projected.colorTimeline):undefined,texture:projected.uvVelocity?createTextureMotion(projected.uvVelocity):projected.uvAtlas?createTextureAtlas(projected.uvAtlas):undefined,colorChanged:true,textureChanged:true};clocks.set(m,clock);
    }
    if(updated.get(m)!==frame){updated.set(m,frame);if((m.baseWords[2]!&16)!==0&&(actor.animationLod?.fraction??0)<=.5){clock.colorChanged=clock.color?.stepDelta(delta)??false;clock.textureChanged=clock.texture?.stepDelta(delta)??false;}}
    return clock;
   }
   // Native queues append ambient first, then the installed animation set.
   for(const kind of [2,1]){
    for(const m of mods.materialModifiers)if(m.kind===kind&&active(m)){
     const clock=instance(m,true);if(!(m.baseWords[2]!&256)||(actor.animationLod?.fraction??0)>.5)continue;material=sceneryMaterial(material,{materialModifiers:[m],textureModifiers:[]},source.index,message=>{throw Error(message);},()=>true);
     if(clock.color)result.colors!.push({rgb:clock.color.rgb,flags:clock.flags});
    }
    for(const m of mods.textureModifiers)if(m.kind===kind&&active(m)){
     const clock=instance(m,false);if(!(m.baseWords[2]!&256)||(actor.animationLod?.fraction??0)>.5)continue;material=sceneryMaterial(material,{materialModifiers:[],textureModifiers:[m]},source.index,message=>{throw Error(message);},()=>true);if(clock.texture)result.texture=clock.texture;
    }
   }
   result.material=material;return result;
  }
 };
}
