export type EffectScript={readonly kind:'none'}|{readonly kind:'arrow'|'mover'}|{readonly kind:'material';readonly from:readonly [number,number,number];readonly to:readonly [number,number,number];readonly durationMs:number}|{readonly kind:'parsed-scale';readonly operation:'SCT_CHAR_SCALE'|'SCT_EFFECT_SCALE';readonly scale:number;readonly durationSeconds?:number}|{readonly kind:'rotation';readonly radians:number}|{readonly kind:'camera';readonly arrival:boolean;readonly amplitude:50|200|300|400;readonly durationMs:500;readonly periodMs:20|25}|{readonly kind:'unsupported';readonly operation:string;readonly parameters:readonly string[]};
// 91F891: parse float, divide by 360, multiply the retail 2*pi double,
// then store float. Negative values are meaningful to the interpreter.
export function effectScript(tokens:readonly string[]):EffectScript{
 if(!tokens.length)return {kind:'none'};
 if(tokens[0]==='SCT_MOVER'){if(tokens.length!==1)throw Error('Invalid SCT_MOVER parameter');return {kind:'mover'};}
 if(tokens[0]==='SCT_ARROW'){if(tokens.length!==1)throw Error('Invalid SCT_ARROW parameter');return {kind:'arrow'};}
 if(tokens[0]==='SCT_MAT'){
  const values=tokens.slice(1).map(Number);
  if(values.length!==7||tokens.slice(1).some(v=>!v.trim())||values.some(v=>!Number.isInteger(v))||values.slice(0,6).some(v=>v<0||v>255)||values[6]!<0||values[6]!>0xffffffff)throw Error('Invalid SCT_MAT parameter');
  const rgb=(at:number):[number,number,number]=>[Math.fround(values[at]!/255),Math.fround(values[at+1]!/255),Math.fround(values[at+2]!/255)];
  return {kind:'material',from:rgb(0),to:rgb(3),durationMs:values[6]!};
 }
 // 91F9xx stores these fields. Neither 8DCA40 nor 8DDDE0 reads them.
 // HWAN model enlargement is the separate 868DC0 state transition.
 if(tokens[0]==='SCT_CHAR_SCALE'||tokens[0]==='SCT_EFFECT_SCALE'){
  const character=tokens[0]==='SCT_CHAR_SCALE',scale=Number(tokens[1]);
  if(tokens.length!==(character?3:2)||tokens.slice(1).some(v=>!v.trim()||!Number.isFinite(Number(v)))||character&&!Number.isInteger(Number(tokens[2])))throw Error('Invalid scale script parameter');
  return {kind:'parsed-scale',operation:tokens[0],scale:Math.fround(scale),...(character?{durationSeconds:Math.fround(Number(tokens[2])*.001)}:{})};
 }
 const camera=/^SCT_SHAKECAM(_MOV)?([0-3])$/.exec(tokens[0]!);
 if(camera){
  if(tokens.length!==1)throw Error('Invalid camera script parameter');
  const amplitude=([50,200,300,400] as const)[Number(camera[2])]!;
  return {kind:'camera',arrival:!!camera[1],amplitude,durationMs:500,periodMs:amplitude===50?20:25};
 }
 if(tokens[0]==='SCT_RUT'){
  if(tokens.length!==2||tokens[1]!.trim()===''||!Number.isFinite(Number(tokens[1])))throw Error('Invalid SCT_RUT parameter');
  return {kind:'rotation',radians:Math.fround(Math.fround(Number(tokens[1]))/360*6.283185482025146)};
 }
 return {kind:'unsupported',operation:tokens[0]!,parameters:tokens.slice(1)};
}
// 8DEACA compares zero to the authored value: BOTH zero and negative
// values enter weapon fallback. The old-port's angle===0 omitted -1.
export function hitRotation(authored:number,weapon:number|undefined,attack:number,row:number){
 const angles=[0,45,305,90,325,55,155,270,0,25,270,270,330,0,45,30,330,150,270,45,225,30] as const;
const compression=[0,4,4,1,4,4,4,4,4,4,4,4,4,4,2,3] as const;

 let angle=authored,pierce=false;
 if(!(angle>0)){
  const kind=weapon===undefined?-1:((weapon&0xffff)>>>11)-2,c=compression[attack-2]??4;
  let base=-1;
  if(kind===0||kind===1)base=[14,16,18,20][c]??-1;
  else if(kind===2||kind===3){base=[10,11,12,13][c]??-1;pierce=true;}
  else if(kind===5)base=attack===2?8:attack===5?9:-1;
  else if(kind===6)base=attack===2?4:attack===5?5:attack===16?6:-1;
  else if(kind===7)base=attack===2?0:attack===5?2:-1;
  if(!Number.isInteger(row)||row<0||base>=0&&base+row>=angles.length)throw Error('Invalid native hit-angle row');
  const degrees=base<0?0:angles[base+row]!;pierce&&=degrees!==0;
  angle=Math.fround(degrees*0.01745329238474369);
 }
 const axis=angle<6.283185482025146?'z':'x';
 return {rotation:{axis,angle:axis==='z'?angle:Math.fround(angle-6.283185482025146)} as {axis:'x'|'z';angle:number},pierce};
}

// 008D5764..008D57B1: the tested +2B6 belongs to the LOCAL CASTER,
// not the victim. 0085EC00 state 1 enters HWAN through 00868DC0.
export function localHitFlash(localCaster:boolean,hwan:boolean,flags:number,atMs:number):import('@/engine/contracts/camera-script').CameraScript|null {
 if(!localCaster||(!(flags&2)&&!hwan))return null;
 const strong=!!(flags&2)&&hwan;
 return {atMs,amplitude:strong?200:50,durationMs:500,periodMs:strong?25:20};
}

// 0x91F7B7..0x91F828: decode authored integer rotation column. Values <= 0
// store 0.0 rad, which 0x8D9F13 skips. Positive bands select axis and angle:
// 1..360 -> Axis 0 (Yaw / 'y'), 361..720 -> Axis 1 (Pitch / 'x'), > 720 -> Axis 2 (Roll / 'z').
export function projectNativeCommandRotation(encoded: number): { axis: 'x' | 'y' | 'z'; angle: number } | undefined {
 if (!Number.isFinite(encoded) || encoded <= 0) return undefined;
 if (encoded > 720) return { axis: 'z', angle: Math.fround(Math.fround(encoded - 720) / 360 * 6.283185482025146) };
 if (encoded > 360) return { axis: 'x', angle: Math.fround(Math.fround(encoded - 360) / 360 * 6.283185482025146) };
 return { axis: 'y', angle: Math.fround(Math.fround(encoded) / 360 * 6.283185482025146) };
}

