import type {CatalogMessage} from '@/engine/contracts/message';
// 0x796390 returns the empty string for a missing catalog entry. Formatting is
// requested by the caller, never guessed from the key by a rendering adapter.
export function catalogMessage(message:CatalogMessage,template:string|undefined):string{
 let text=template??'',index=0;
 if(message.args)text=text.replace(/%d/g,token=>index<message.args!.length?String(message.args![index++]):token);
 return text+message.suffix;
}
