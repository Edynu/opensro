// CGWeatherManager 8CE9C0, OnTimer 8CEEC0, color channel 8CE5A0.
export interface ThunderState {readonly color:readonly number[];readonly start:readonly number[];readonly target:readonly number[];readonly progress:number;readonly complete:boolean;readonly due:readonly {readonly id:number;readonly at:number}[];}
export function initialThunder():ThunderState{return {color:[255,255,255,0],start:[255,255,255,0],target:[255,255,255,0],progress:1,complete:true,due:[]};}
export function advanceThunder(previous:ThunderState,seconds:number,delta:number,rain:boolean,range:(a:number,b:number)=>number):{state:ThunderState;sound:number|null}{
 if(!Number.isFinite(seconds)||!Number.isFinite(delta)||delta<0)throw Error('Invalid thunder clock');
 let state=previous;
 const pending=state.due.filter(timer=>timer.at>seconds);
 if(pending.length!==state.due.length)state={...state,start:state.color,target:[156,156,156,128],progress:0,complete:false,due:pending};
 if(!state.complete){
  const progress=Math.min(1,Math.fround(state.progress+Math.fround(delta)*10));
  const color=state.start.map((v,i)=>Math.fround(v+Math.fround(Math.fround(state.target[i]!-v)*progress)));
  state={...state,progress,color,complete:progress===1};
  if(state.complete&&color[3]!==0)state={...state,start:color,target:[255,255,255,0],progress:0,complete:false};
 }
 let sound:number|null=null;
 if(rain&&state.complete&&range(0,3000)===0){
  sound=range(0,3);const due=[...state.due];
  // A00B30 ignores an existing timer ID and clamps zero delay to 1 ms.
  const delays=sound===1?[1000]:[1,sound===0?1000:500];
  delays.forEach((delay,i)=>{const id=i+1;if(!due.some(timer=>timer.id===id))due.push({id,at:(Math.floor(seconds*1000)+delay)/1000});});
  state={...state,due};
 }
 return {state,sound};
}
