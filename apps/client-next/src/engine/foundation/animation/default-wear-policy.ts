/** 744C50 records the first case-sensitive #$T marker. 745D10 applies it
 * only for language 0 (Korean); the other language initializers leave wear on.
 * This freezes existing default handles, not the rest of the compound. */
export function defaultWearFrozen(language:number,rawServerName:string|undefined):boolean {
 if(!Number.isInteger(language)||language<0||language>5)throw Error('Invalid native clothing language');
 if(language!==0)return false;
 if(rawServerName===undefined)throw Error('Missing native shard name for clothing policy');
 return !rawServerName.includes('#$T');
}
export function refreshDefaultWear(previous:readonly string[],desired:readonly string[],frozen:boolean):readonly string[]{
 return frozen?previous:desired;
}
