// Retail 8E7E00 tables CCCF08/CCCF68; BC0110 binds these entries to bone names.
// Volume is radial skin deformation, NOT a world X/Z scale or inherited bone scale.
export function bodyVolumeIndex(packed:number|undefined,index:number):number {
 if(packed===255)return 2;
 const value=packed===undefined?index:packed>>>4;
 return value>=8?0:Math.max(0,Math.min(4,value));
}
export function bodyBoneScale(name:string,volume:number,female:boolean):number {
 let low=1,high=1;
 switch(name){
  case 'Bip01 Spine':low=female?.95:.88;high=1.1;break;
  case 'Bip01 Spine1':low=.95;high=female?1:1.11;break;
  case 'Bip01 L UpperArm':case 'Bip01 R UpperArm':low=female?.95:.92;high=female?1.15:1.2;break;
  case 'Bip01 L Thigh':case 'Bip01 R Thigh':low=.9;high=1.15;break;
  case 'Bip01 Pelvis':low=.9;high=female?1.08:1;break;
  case 'Bone01':if(female){low=.8;high=1.18;}break;
 }
 const v=Math.max(0,Math.min(4,volume));
 return Math.fround(v<=2?Math.fround(low)+(1-Math.fround(low))*Math.fround(v*.5):1+(Math.fround(high)-1)*Math.fround((v-2)*.5));
}
export interface BodyShapeBlend {readonly key:string;readonly height:number;readonly volume:number;readonly fromHeight:number;readonly fromVolume:number;readonly targetHeight:number;readonly targetVolume:number;readonly started:number;}
// 6D0B40 retargets from the currently displayed values; 6D08C0 advances linearly.
export function advanceBodyShape(previous:BodyShapeBlend|null,key:string,height:number,volume:number,seconds:number):BodyShapeBlend {
 if(!previous||previous.key!==key)return {key,height,volume,fromHeight:height,fromVolume:volume,targetHeight:height,targetVolume:volume,started:seconds};
 let state=previous;
 if(height!==state.targetHeight||volume!==state.targetVolume)state={...state,fromHeight:state.height,fromVolume:state.volume,targetHeight:height,targetVolume:volume,started:seconds};
 const t=Math.min(1,Math.max(0,seconds-state.started));
 return {...state,height:Math.fround(state.fromHeight+(height-state.fromHeight)*t),volume:Math.fround(state.fromVolume+(volume-state.fromVolume)*t)};
}
