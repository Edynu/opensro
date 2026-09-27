export interface WeatherOptions {readonly eventRain?:boolean;readonly mode:1|2|3;readonly amount:number;}

// CPSMission 7775A0: opcode 3BDE writes options 3 and 4. Values outside
// 1..3 select clear; the amount remains an unsigned byte, not a percentage.
export function decodeWeather(payload:Uint8Array):WeatherOptions {
 if(payload.length!==2)throw Error('Invalid native weather packet');
 const mode=payload[0]!;
 return {mode:mode>=1&&mode<=3?mode as 1|2|3:1,amount:payload[1]!};
}

export interface WeatherAmount {readonly value:number;readonly start:number;readonly target:number;readonly progress:number;}
export function initialWeatherAmount():WeatherAmount{return {value:0,start:0,target:0,progress:1};}

// CGWeatherManager 8CF1B0 / 8CE9C0 and Int32TweenChannel 862C60.
// Retarget from the current integer amount; do not restart an unchanged target.
export function advanceWeatherAmount(previous:WeatherAmount,target:number,seconds:number):WeatherAmount {
 if(!Number.isInteger(target)||target<0||target>255||!Number.isFinite(seconds)||seconds<0)throw Error('Invalid weather amount input');
 const start=target===previous.target?previous.start:previous.value;
 const progress=Math.min(1,Math.fround((target===previous.target?previous.progress:0)+Math.fround(seconds)*Math.fround(.2)));
 return {start,target,progress,value:progress===1?target:Math.trunc(start+(target-start)*progress)};
}
