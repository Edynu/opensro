export interface StarFlicker { readonly random:number; readonly tickMs:number; readonly bytes:readonly number[] }
// SWorld static constructor BBCE10 binds 0xEFFE90. Star words at +0x2A43+0xE8
// occupy zero-filled PE .data virtual storage (0xF029BB..0xF029E2).
// 8CD0F0 initializes the embedded timer and geometry, not these ten words.
export function initialStarFlicker(random=1,tickMs=0):StarFlicker {
 if(!Number.isInteger(random)||random<0||random>0xffffffff||!Number.isFinite(tickMs))throw new Error('Invalid star startup state');
 return {random,tickMs,bytes:Array(10).fill(0)};
}
// Native 8cd194 -> a17020(10Hz), a173f0 timer, 8cb380 ten 100-point batches.
// State belongs to the world renderer. Explicit random/initial state makes
// replay reproducible; it does not claim the retail render-thread RNG seed.
export function advanceStarFlicker(state:StarFlicker,nowMs:number,visible:boolean):StarFlicker {
 if(!Number.isFinite(nowMs)||!Number.isFinite(state.tickMs)||!Number.isInteger(state.random)||state.random<0||state.random>0xffffffff||state.bytes.length!==10||state.bytes.some(value=>!Number.isInteger(value)||value<0||value>255))throw new Error('Invalid star flicker state');
 if(!visible||nowMs-state.tickMs<100)return state;
 const tickMs=state.tickMs+Math.floor((nowMs-state.tickMs)/100)*100;
 let random=state.random;const bytes=state.bytes.slice();
 const roll=()=>{random=(Math.imul(random,0x343fd)+0x269ec3)>>>0;return (random>>>16)&0x7fff;};
 // Timer returns one boolean even after missed intervals: no catch-up rerolls.
 for(let i=0;i<10;i++)if(roll()%10===0)bytes[i]=(roll()&127)+128;
 return {random,tickMs,bytes};
}
