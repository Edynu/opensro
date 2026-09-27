// Local CIFChattingBlocking: 61C100 exact-case lookup, 61C770 validation.
export function chatBlockError(name:string,names:readonly string[]):string|null {
 if(name.includes('[')||name.includes(']')||name.includes('\0'))return 'UIO_MSG_ERROR_CHARACTER_WRONGSTRING';
 return names.includes(name)?'UIIT_MSG_COSPETERR_PETNAME_SUMENESS':null;
}
export function chatBlocks(value:unknown):readonly string[]{
 if(!Array.isArray(value)||value.some(n=>typeof n!=='string'||!n||n.length>13)||value.some((n,i)=>chatBlockError(n,value.slice(0,i))))throw Error('Invalid local chatting block list');
 return [...value];
}
export function chatIsBlocked(names:readonly string[],channel:number,name:string):boolean{return channel>0&&(channel<=5||channel===11)&&names.includes(name);}
