// 5488F0: version-1 SRExtQSOption defaults. Browser storage belongs to Platform.
export interface ExtendedQuickslotOptions {readonly open:boolean;readonly vertical:boolean;readonly double:boolean;readonly transparent:boolean;readonly slotLock:boolean;readonly positionLock:boolean;readonly position:readonly[number,number]|null;}
export function defaultExtendedQuickslot():ExtendedQuickslotOptions{return {open:true,vertical:true,double:true,transparent:true,slotLock:false,positionLock:false,position:null};}
export function extendedQuickslotOptions(value:unknown):ExtendedQuickslotOptions{
 const row=value as ExtendedQuickslotOptions;
 if(!row||['open','vertical','double','transparent','slotLock','positionLock'].some(k=>typeof row[k as keyof ExtendedQuickslotOptions]!=='boolean')||row.position!==null&&(!Array.isArray(row.position)||row.position.length!==2||row.position.some(n=>!Number.isFinite(n)||Math.abs(n)>65536)))throw Error('Invalid extended quickslot options');
 return {open:row.open,vertical:row.vertical,double:row.double,transparent:row.transparent,slotLock:row.slotLock,positionLock:row.positionLock,position:row.position?[row.position[0],row.position[1]]:null};
}
