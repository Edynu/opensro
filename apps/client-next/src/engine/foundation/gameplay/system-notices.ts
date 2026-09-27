export interface SystemNotice {readonly localizedArguments?:readonly (string|null)[];readonly formatKinds?:readonly ('d'|'s')[];readonly formatCapacity?:number;readonly dialog?:{readonly title:string;readonly lines:readonly string[]};readonly nativeType?:0|1|2|3|4|5|6|7;readonly colorArgb?:number;readonly sequence?:number;readonly key:string;readonly value:number;readonly text?:string;readonly arguments?:readonly string[];readonly banner?:true;readonly bannerUsesFormattedKey?:true;readonly questBanner?:true;readonly notificationBanner?:true;readonly bannerOnly?:true;}
// 76c870, registered as 3887 by 76e850. These six announcement arms read
// only their subtype byte; their minutes are constants in the client.
export function fortressNotice(opcode:number,p:Uint8Array):SystemNotice|null{
 if(opcode!==0x3887||p[0]===undefined||p[0]<1||(p[0]>6&&p[0]!==9))return null;
 if(p.length!==1)throw Error('Trailing fortress announcement bytes');
 const subtype=p[0];return {key:subtype===1?'UIIT_MSG_FORT_WAR_BEFOREBEGIN':subtype===2?'UIIT_MSG_FORT_WAR_BEGIN':subtype===6?'UIIT_MSG_FORT_WAR_END':'UIIT_MSG_FORT_WAR_BEFOREEND',value:subtype===9?1:subtype===1||subtype===3?30:subtype===4?20:subtype===5?10:0};
}

// 753A6F -> 752ABD -> 67A140/6B3180: native type-7 server notification.
// The chat owner separately retains the (Notify): line in the main log.
export function serverNotification(opcode:number,p:Uint8Array):SystemNotice|null {
 if(opcode!==0x3667||p[0]!==7)return null;
 if(p.length<3)throw Error('Truncated server notification');
 const n=new DataView(p.buffer,p.byteOffset,p.byteLength).getUint16(1,true);
 if(n>100||p.length!==3+2*n)throw Error('Invalid server notification length');
 const text=new TextDecoder('utf-16le',{fatal:true}).decode(p.subarray(3));
 return {key:'',text,value:0,notificationBanner:true,bannerOnly:true};
}

// 74BFF0 -> 9C422E -> 67D030 / 67A600. Fields are bit slices, not a JS Date:
// zero/overflow calendar values remain numbers; noon is still Forenoon.
export function restrictionNotice(opcode:number,p:Uint8Array):SystemNotice|null{
 if(opcode!==0x36ea)return null;
 if(p.length!==5)throw Error('Invalid command restriction notice');
 const kind=p[0]!;if(kind!==0&&kind!==1)return null;
 const date=new DataView(p.buffer,p.byteOffset,p.byteLength).getUint32(1,true);
 const hour=(date>>>15)&31,afternoon=hour>12;
 return {key:kind===0?'UIIT_MSG_GM_PUNISHMENT_CHAT_BLOCK':'UIIT_MSG_GM_PUNISHMENT_TRADE_BLOCK',value:0,
  arguments:[String((date&63)+2000),String((date>>>6)&15),String((date>>>10)&31),'',String(afternoon?hour-12:hour),String((date>>>20)&63)],
  localizedArguments:[null,null,null,afternoon?'UIIT_STT_LETTER_AFTEMOON':'UIIT_STT_LETTER_FORENOON',null,null],
  formatKinds:['d','d','d','s','d','d'],formatCapacity:511,nativeType:5,notificationBanner:true};
}
