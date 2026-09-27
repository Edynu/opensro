import {initialCreation,creationLoadout,creationRange,creationNameRules,creationNameError} from '@/engine/foundation/ui/character-create';
import {characterStatus} from '@/engine/foundation/ui/character-status';
import {frontendCameraView} from '@/engine/foundation/rendering/frontend-camera';
import type {CreationSnapshot,CreationSelection} from '@/engine/contracts/frontend';
import type {AssetOwner} from '@/engine/contracts/assets';
import type {CharacterOperationCommand,CharacterOperationResult} from '@/engine/contracts/session';
export function createCreation(assets:AssetOwner,base:string,send:(command:CharacterOperationCommand)=>void,messageSound:()=>void=()=>{}){
 let selection:CreationSelection|null=null,phase:CreationSnapshot['phase']='editing',alpha=0,serial=0,operation=0,submitted=false,status:CreationSnapshot['status'],statusAge=0;
 let explain:CreationSnapshot['explain']='weapon';
 let retry=0;
 let job:number|null=null,rules:ReturnType<typeof creationNameRules>|null=null;
 let yaw=0,velocity=0,zoom=false,zoomTime=1,pose=[.5,9.80000019,28.5],from=pose,to=pose;
 function reset(){if(phase==='checking'||phase==='submitting')send({kind:'cancel-character-operation'});if(job!==null){assets.cancel(job);job=null;}selection=null;operation=0;submitted=false;phase='editing';status=undefined;}
 function show(key:string){status={key,suffix:''};statusAge=0;messageSound();}
 function validate(){if(!selection||!rules)return false;const error=creationNameError(selection.name,rules);if(error)show(error);return !error;}
 return {
  open(race:0|1){reset();selection=initialCreation(race);explain='weapon';yaw=velocity=0;zoom=false;pose=[.5,9.80000019,28.5];from=to=pose;zoomTime=1;alpha=0;},
  action(id:string,value?:string){
   if(!selection)return;
   if(id==='create:confirm-cancel'&&phase==='confirming'){phase='dismissing';return;}
   if(id==='create:confirm'&&phase==='confirming'&&alpha===1){phase='submitting';submitted=false;return;}
   if(phase!=='editing')return;
   if(id==='create:explain'&&['figure','height','volume','weapon','protector'].includes(value??'')){explain=value as typeof explain;return;}
   if(id==='create:name'){selection={...selection,name:(value??'').slice(0,12)};status=undefined;return;}
   if(id==='create:check'){if(validate()){operation=++serial;phase='checking';send({kind:'check-name',operationId:operation,characterName:selection.name});}return;}
   if(id==='create:ok'){
    if(selection.race===0&&!selection.protector){show('UIO_MSG_ERROR_CHARACTER_SELECTARMOR');messageSound();return;}
    if(!selection.weapon){show('UIO_MSG_ERROR_CHARACTER_SELECTWEAPON');messageSound();return;}
    if(validate()){phase='confirming';alpha=0;}return;
   }
   if(id==='create:male'||id==='create:female'){selection={...initialCreation(selection.race),name:selection.name,gender:id==='create:male'?0:1};explain='weapon';return;}
   if(id==='create:left'||id==='create:right'){velocity+=id==='create:left'?50:-50;return;}
   if(id==='create:zoom'){zoom=!zoom;from=pose;to=zoom?[2,(selection.gender===0?15:14)*(.94+selection.height*.03),11]:[.5,9.80000019,28];zoomTime=0;return;}
   const match=/^create:(figure|height|volume|weapon|protector):(prev|next|\d+)$/.exec(id);if(!match)return;
   const key=match[1] as 'figure'|'height'|'volume'|'weapon'|'protector',[min,max]=creationRange(selection,key),n=match[2]==='prev'?selection[key]-1:match[2]==='next'?selection[key]+1:Number(match[2]);
   selection={...selection,[key]:Math.max(min,Math.min(max,n)),...(key==='weapon'?{protector:0}:{})};
  },
  step(delta:number,result:CharacterOperationResult|undefined){
   if(!selection)return false;
   retry=Math.max(0,retry-delta);
   if(job!==null){const result=assets.take(job);if(result){job=null;try{if(result.kind!=='bytes')throw Error('Native name filter unavailable');rules=creationNameRules(result.buffer);}catch{retry=2;status=characterStatus(2);statusAge=0;}}}
   if(!rules&&job===null&&retry===0&&assets.available())job=assets.request(new URL('/assets/textdata/abusefilter.txt',base).href,4<<20);
   statusAge+=delta;if(statusAge>=15)status=undefined;
   if(phase==='dismissing'){alpha=Math.max(0,alpha-delta/.5);if(alpha===0)phase='editing';}
   if(phase==='confirming')alpha=Math.min(1,alpha+delta/.5);
   if(phase==='submitting'&&!submitted){alpha=Math.max(0,alpha-delta/.5);if(alpha===0){submitted=true;operation=++serial;const s=selection;send({kind:'create-character',operationId:operation,draft:{characterName:s.name,modelCodename:creationLoadout(s).modelCodename,heightIndex:s.height,volumeIndex:s.volume,weaponIndex:s.weapon,protectorIndex:s.protector,armorSelected:s.protector>0,weaponSelected:s.weapon>0}});}}
   if(result&&operation===result.operationId&&result.status!=='pending'&&((phase==='checking'&&result.kind==='check-name')||(phase==='submitting'&&submitted&&result.kind==='create-character'))){
    operation=0;if(result.status==='failed'){phase='editing';status=characterStatus(result.nativeErrorCode);statusAge=0;messageSound();}
    else if(phase==='checking'){phase='editing';show('UIO_MSG_ERROR_ADMISSON');}
    else {phase='accepted';alpha=0;}
   }
   if(phase==='accepted'){alpha=Math.min(1,alpha+delta/.5);if(alpha===1)return true;}
   yaw+=velocity*delta;velocity-=velocity*delta*.5;if(Math.abs(velocity)<30)velocity=0;
   zoomTime=Math.min(1,zoomTime+delta);pose=from.map((v,i)=>v+(to[i]!-v)*zoomTime);
   return false;
  },
  snapshot():CreationSnapshot|null{return selection?{selection,explain,phase,alpha,status,ready:!!rules,yaw:yaw*Math.PI/180,zoom,camera:{...frontendCameraView({timeSeconds:0,sectorX:0,sectorY:0,position:{x:pose[0]!,y:pose[1]!,z:0},rotation:{x:.200000003,y:0,z:0},mode:pose[2]!}),fov:Math.PI/4,far:500000}}:null;},
  reset,
  dispose(){if(job!==null)assets.cancel(job);job=null;selection=null;rules=null;}
 };
}
