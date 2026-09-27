import {viewProjection} from '@/engine/foundation/rendering/world-math';
import {previewYaw} from '@/engine/foundation/math/angles';
import type {CharacterActor,CharacterModel} from '@/engine/contracts/character';
import type {GeometryCommands,ImageCommands,GeometryDraw} from '../internal/gpu-contract';
export interface PortraitSource {readonly actor:CharacterActor;readonly model:CharacterModel;readonly images:readonly ImageBitmap[];}
// Synchronous GPU projection. Model/bitmap lifetime stays with world characters;
// this owner owns only its pose, preview geometry and texture uploads.
export function createPortrait(preview:{retain(ids:readonly string[]):void;actors(actors:readonly CharacterActor[]):void;prepare(geometry:GeometryCommands,images:ImageCommands,origin:number,view?:Float32Array,preview?:boolean):readonly GeometryDraw[];borrowModel(id:string,model:CharacterModel,images:readonly ImageBitmap[]):void;socket(actors:readonly CharacterActor[],gid:number,bone:string,offset:readonly[number,number,number]):{x:number;y:number;z:number}|null;invalidate():void;dispose(geometry:GeometryCommands|null,images:ImageCommands|null):void}){
 let source:CharacterModel|null=null,started=0,identity:number|undefined;
 preview.retain([]);
 return {prepare(value:PortraitSource|null,geometry:GeometryCommands,images:ImageCommands,dollYaw?:number,seconds=0){
  if(!value){preview.actors([]);source=null;identity=undefined;return preview.prepare(geometry,images,0);}
  if(source!==value.model||identity!==value.actor.gid){started=seconds;identity=value.actor.gid;
   if(source!==value.model){preview.actors([]);preview.prepare(geometry,images,0);preview.borrowModel(value.actor.model,value.model,value.images);source=value.model;}}
  const actor:CharacterActor={...value.actor,animationLod:undefined,modelAnimation:undefined,pose:{regionId:0,x:0,y:0,z:0,yaw:previewYaw(dollYaw??.100000001)},mountedOn:undefined,attachment:undefined,opacity:1,layers:undefined,clip:(dollYaw===undefined?undefined:value.actor.previewClip)??value.model.clips.find(c=>c.name==='stand')?.name??value.actor.clip,time:dollYaw===undefined?0:Math.max(0,seconds-started),loop:true,scale:1};
  if(dollYaw!==undefined){preview.actors([actor]);return preview.prepare(geometry,images,0,viewProjection({eye:[0,9,-40],target:[0,9,0],fov:Math.PI/6,near:.01,far:500000},176/318),true);}
  const head=preview.socket([actor],actor.gid,'Bip01 Head',[0,1,0]);
  if(!head)return [];
  const target=[head.x,head.y,head.z] as const,eye=[head.x,head.y+Math.sin(.2)*6.5,head.z-Math.cos(.2)*6.5] as const;
  preview.actors([actor]);return preview.prepare(geometry,images,0,viewProjection({eye,target,fov:Math.PI/6,near:.01,far:500000},1),true);
 },invalidate(){preview.invalidate();},dispose(geometry:GeometryCommands|null,images:ImageCommands|null){preview.dispose(geometry,images);source=null;}};
}
