import type {WireFrame} from '@/engine/contracts/network';
import type {SystemNotice} from './system-notices';
import {constantNativeNotice} from './native-notice';

// 76FD40/90/E0, 76FE30/80: these acknowledgments never change academy
// membership or notice text. Authoritative changes arrive separately in 3AC5.
export function academyAcknowledgment(frame:WireFrame):{readonly notice:SystemNotice|null}|null {
 if(![0xb4d4,0xb785,0xb10a,0xb36d,0xb220].includes(frame.opcode))return null;
 const p=frame.payload;
 if(!p.length||p.length!==(p[0]===2?2:1))throw Error('Invalid academy acknowledgment');
 if(p[0]===2)return {notice:constantNativeNotice(0x1d,p[1]!)};
 // 76FE9B -> 67D030 -> child 23: seven-second notice window, no guide.
 if(frame.opcode===0xb220&&p[0]===1)return {notice:{key:'UIIT_MSG_TC_COMMON_KNOW_REMIND_UPDATE',value:0,notificationBanner:true,bannerOnly:true}};
 return {notice:null};
}
