import type {UiQuad} from '@/engine/contracts/ui';
// 597F70 -> 78EAD0/78E6E0: signed 64-bit decimal, comma every three
// digits. 5969D0 selects the amount color before CTextBoard publication.
export function moneyPresentation(value:string){
 const amount=BigInt.asIntN(64,BigInt(value)),magnitude=amount<0n?-amount:amount;
 const thresholds=[10000n,100000n,1000000n,10000000n,100000000n,1000000000n,10000000000n,100000000000n];
 const colors=[0xffffffff,0xfffffa85,0xffffd348,0xffffad5c,0xffff9aa1,0xffeba1ff,0xffb8bbff,0xff95deff,0xff8bffe5];
 const index=thresholds.findIndex(limit=>magnitude<limit),argb=colors[index<0?8:index]!;
 return {text:(amount<0n?'-':'')+magnitude.toString().replace(/\B(?=(\d{3})+(?!\d))/g,','),color:[(argb>>>16&255)/255,(argb>>>8&255)/255,(argb&255)/255,1] as UiQuad['color']};
}
