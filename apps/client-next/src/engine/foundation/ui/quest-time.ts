// v1.150 5C2A30 / 5C3040. This word is a packed duration, not a timestamp.
export function questDurationText(packed:number|undefined,copy:(key:string)=>string,initial=true):string{
 const p=packed??0xffffffff;
 if(p===0xffffffff)return copy('UIIT_STT_QUEST_UNLIMITED');
 if(p===0&&initial)return copy('UIIT_STT_QUEST_DEFAULTTIME');
 const minutes=(p>>>20)&63,hours=((p>>>10)&31)*24+((p>>>15)&31);
 return (p&0xffc00?hours+copy('UIIT_STT_HOUR'):'')+minutes+copy('UIIT_STT_MINUTE');
}
export function decrementQuestMinute(p:number):number{
 const minutes=(p>>>20)&63,hours=(p>>>15)&31,days=(p>>>10)&31;
 if(minutes)return ((p&~0x3f00000)|((minutes-1)<<20))>>>0;
 if(hours)return ((p&~0x3ff8000)|((hours-1)<<15)|(59<<20))>>>0;
 if(days)return ((p&~0x3fffc00)|((days-1)<<10)|(23<<15)|(59<<20))>>>0;
 return (p&~0x3fffc00)>>>0;
}
