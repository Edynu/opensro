// 85DE0F/8E5BB0: one motion draw precedes the next-deadline draw. No catch-up.
// State belongs to each admitted actor, not a timer or a second RNG owner.
export interface RandomIdle { remaining:number; previous:number; clip?:string; started:number; }
export function advanceRandomIdle(state:RandomIdle,now:number,eligible:boolean,clips:readonly string[],range:(lower:number,upper:number)=>number,duration:(clip:string)=>number) {
 const elapsed=Math.max(0,now-state.previous);state.previous=now;
 if(!eligible){state.remaining=15;state.clip=undefined;return;}
 if(state.clip){
  const age=now-state.started,length=duration(state.clip);
  // Active state 7 is outside 85D890's 0x109 eligibility mask, so its
  // updates restore 15000. 8E5C90 removes state 7 at clip completion,
  // overriding its authored 400ms exit with a 200ms handle exit.
  if(age<length){state.remaining=15;return;}
  if(age<length+.2){state.remaining-=elapsed;return;}
  state.clip=undefined;
 }
 state.remaining-=elapsed;
 if(state.remaining>0)return;
 const role=['idle122','idle61','idle81'][range(0,3)]!;
 state.clip=clips.includes(role)?role:clips.includes('idle122')?'idle122':undefined;
 state.started=now;state.remaining=range(10000,15000)/1000;
}
