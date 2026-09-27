import type {WireFrame} from '@/engine/contracts/network';
import type {SystemNotice} from '@/engine/foundation/gameplay/system-notices';
// v1.150 74B2E0 / 6814D0 / 6875F0: zero ends the notice timer, not the world.
export function createDeparture(send:(frame:WireFrame)=>void,notice:(value:SystemNotice)=>void){
 let requested:1|2|0=0,accepted:1|2|0=0,seconds=0,next=0;
 function show(){notice({key:'UIIT_MSG_LOGOUT_REMAIN_TIME',value:seconds,banner:true});}
 return {
  request(type:1|2){if(requested)return;send({opcode:0x70b7,payload:Uint8Array.of(type)});requested=type;},
  receive(frame:WireFrame,now:number):1|2|0|null{
   if(frame.opcode===0xb0b7){
    const p=frame.payload;
    if(p[0]===1){if(p.length!==3||(p[2]!==1&&p[2]!==2))throw Error('Invalid restart countdown');accepted=p[2];requested=accepted;seconds=p[1]!;next=now+1000;show();}
    else if(p[0]===2){if(p.length!==2)throw Error('Invalid restart refusal');requested=0;accepted=0;next=0;const key=p[1]===1?'UIIT_MSG_LOGOUT_ERR_CANT_LOGOUT_IN_BATTLE_STATE':p[1]===2?'UIIT_MSG_LOGOUT_ERR_CANT_LOGOUT_WHILE_TELEPORT_WORKING':null;if(key)notice({key,value:0,banner:true});}
    else throw Error('Invalid restart result');
    return 0;
   }
   if(frame.opcode!==0x315a)return null;
   if(frame.payload.length||!accepted)throw Error('Unexpected restart completion');
   const type=accepted;this.reset();return type;
  },
  step(now:number){if(!next||now<next)return;const elapsed=Math.floor((now-next)/1000)+1;seconds=Math.max(0,seconds-elapsed);next=seconds?next+elapsed*1000:0;if(seconds)show();},
  reset(){requested=0;accepted=0;seconds=0;next=0;}
 };
}
