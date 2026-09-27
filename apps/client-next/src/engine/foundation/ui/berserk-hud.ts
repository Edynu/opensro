// Retail 6B41F0/6B6620: five 12s stages, 50ms atlas frames, 1s fades.
// Pure presentation projection. No gauge awards or gameplay expiry originate here.
export function berserkHud(elapsedMs:number){
 const t=Math.max(0,elapsedMs),finished=t>=60000;
 return {frame:Math.floor(Math.min(t,59999)/50)%12,glow:Math.min(1,t/3000)*Math.max(0,1-(t-60000)/3000),
  circles:Array.from({length:5},(_,i)=>finished?0:Math.max(0,Math.min(1,1-(t-(i+1)*12000)/1000))),
  fire:Array.from({length:5},(_,i)=>finished?0:Math.min(1,t/1000)*Math.max(0,Math.min(1,1-(t-(i+1)*12000)/1000)))};
}

// 777B60 ->8CEF20, shared weather flash: white alpha128, .2s in/.5s out.
export function berserkEntryFlash(elapsedMs:number){return elapsedMs<0?0:(128/255)*Math.max(0,elapsedMs<200?elapsedMs/200:1-(elapsedMs-200)/500);}
