export interface ChatFeedback {readonly sequence:number;readonly key:string;readonly argument:string;}
// 753290: unused result arms deliberately display no invented fallback text.
export function chatRejectionKey(code:number):string|null{
 return ({3:'UIIT_CHATERR_CANT_FIND_TARGET',6:'UIIT_CHATERR_YOU_ARE_SQUELCHED',8:'UIIT_CHATERR_INVALID_COMMAND',10:'UIIT_CHATERR_NOT_A_PARTY_MEMBER',11:'UIIT_CHATERR_ALLIANCE_PERMISSION_DENIED',12:'UIIT_CHATERR_ALLIANCE_PERMISSION_DENIED',13:'UIIT_STT_CANT_CHATTING',14:'UIIT_MSG_GUILD_UNION_CHAT_LIMIT'} as Record<number,string>)[code]??null;
}
