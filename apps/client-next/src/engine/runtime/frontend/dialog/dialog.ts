import type {CharacterOperationCommand,CharacterOperationResult,CharacterRecord} from '@/engine/contracts/session';
import type {FrontendDialog} from '@/engine/contracts/frontend';
// Captures identity at admission. Roster refresh, selection and stale replies
// cannot redirect an already-confirmed action to another character.
export function createCharacterDialog(send:(command:CharacterOperationCommand)=>void){
 let state:FrontendDialog|null=null,serial=0;
 return {
  open(row:CharacterRecord){if(state)return;if(row.deletionBlocker){const suffix={'guild-master':'MASTER','guild-member':'MEMBER','academy-guardian':'GUARDIAN','academy-student':'STUDENT'}[row.deletionBlocker];return 'UIO_MSG_CHAR_DEL_WANNING_CONFIRM_'+suffix;}state={kind:row.deletePending?'restore-character':'delete-character',character:row.name,id:row.id,phase:'opening',alpha:0};},
  accept(){if(state?.phase!=='open')return;state={...state,phase:'pending',operationId:++serial};send({kind:state.kind,characterName:state.character,operationId:serial});},
  cancel(){if(state&&(state.phase==='open'||state.phase==='opening'))state={...state,phase:'closing'};},
  step(delta:number,result:CharacterOperationResult|undefined,roster:readonly CharacterRecord[]){
   if(!state)return null;
   if(!roster.some(row=>row.id===state!.id&&row.name===state!.character)){if(state.phase==='pending')send({kind:'cancel-character-operation'});state=null;return null;}
   if(state.phase==='pending'&&result&&result.operationId===state.operationId&&result.kind===state.kind&&result.status!=='pending'){
    state={...state,phase:'closing'};return result;
   }
   if(state.phase==='opening'){const alpha=Math.min(1,state.alpha+delta/.5);state={...state,alpha,phase:alpha===1?'open':'opening'};}
   else if(state.phase==='closing'){const alpha=Math.max(0,state.alpha-delta/.5);state=alpha?{...state,alpha}:null;}
   return null;
  },
  snapshot:()=>state,
  reset(){if(state?.phase==='pending')send({kind:'cancel-character-operation'});state=null;},
  dispose(){state=null;}
 };
}
