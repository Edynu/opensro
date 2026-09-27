import type {ChatLine} from '@/engine/contracts/gameplay';
import type {UiQuad} from '@/engine/contracts/ui';
import type {ChatFeedback} from '@/engine/foundation/gameplay/chat-feedback';

export function chatTabPrefix(tab:number):string{return tab===1?'#':tab===2?'@':tab===3?'%':'';}
// 6AB240 replaces only an empty draft or a single command marker.
export function selectChatTab(input:string,tab:number):string{
 return !input||input.length===1&&'#$%/@^~'.includes(input)?chatTabPrefix(tab):input;
}
export function composeChat(input:string){
 const marker=input[0];
 if(marker==='$'){
  const match=/^\$(\S+)\s+([\s\S]+)$/.exec(input);
  return match&&match[2]!.trim()?{channel:2,target:match[1]!,text:match[2]!.slice(0,100)}:null;
 }
 const channel=marker==='#'?4:marker==='@'?5:marker==='%'?11:1;
 const text=(channel===1?input:input.slice(1)).slice(0,100);
 return text.trim()?{channel,target:'',text}:null;
}
export function chatLineColor(channel:number):UiQuad['color']{
 const rgb=({2:0x9ffffe,3:0xffaec3,4:0x9affd0,5:0xffb541,6:0xffff00,7:0xffaec3,10:0x9ffffe,11:0xc2f573,13:0xdbadf8} as Record<number,number>)[channel]??0xffffff;
 return [(rgb>>16)/255,((rgb>>8)&255)/255,(rgb&255)/255,1];
}
export function chatLineText(line:ChatLine,copy:(key:string)=>string){
 const {channel,name,text,outgoing}=line;
 if(channel===7)return '('+copy('UIIT_MSG_NOTIFY')+'):'+text;
 if(!name)return text;
 if(channel===2)return `${name}(${copy(outgoing?'UIIT_CHATERR_WHISPER_TO_MESSAGE':'UIIT_CHATERR_WHISPER_FROM_MESSAGE')}):${text}`;
 const key=({4:'UIIT_CTL_PARTY',5:'UIIT_CTL_GUILD',11:'UIIT_STT_GUILD_RESPECT_ALLY'} as Record<number,string>)[channel];
 return name+(key?'('+copy(key)+')':'')+':'+text;
}
export function chatFeedbackText(notice:ChatFeedback,copy:(key:string)=>string){
 // B367 has no duration field. Never format an unspecified stack value as the
 // %d in the restriction caption; use the native non-countdown restriction text.
 return notice.key==='UIIT_STT_CANT_CHATTING'?copy('UIIT_MSG_CANT_CHATTING'):copy(notice.key).replace(/%s/,notice.argument);
}
