// Retail 9c4776 and 878a10. The caller owns the thread-stream projection.
// The upper range bound is exclusive; reversed/equal bounds consume no RNG.
export function crtRandomRange(state:number,lower:number,upper:number):{state:number;value:number} {
 if(!Number.isInteger(state)||state<0||state>0xffffffff||!Number.isInteger(lower)||!Number.isInteger(upper)||lower< -0x80000000||lower>0x7fffffff||upper< -0x80000000||upper>0x7fffffff||upper-lower>0x7fffffff)throw new Error('Invalid CRT random range');
 if(upper<=lower)return {state,value:lower};
 const next=(Math.imul(state,0x343fd)+0x269ec3)>>>0;
 return {state:next,value:lower+((next>>>16)&0x7fff)%(upper-lower)};
}
