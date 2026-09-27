import type {WorldMaterial} from '@/engine/contracts/scene';
export interface Modifier {readonly kind:number;readonly stateId:number;readonly animationSetName:string;readonly baseWords:readonly number[];readonly baseBytes?:readonly number[];}
export interface MaterialModifier extends Modifier {readonly field24?:number;readonly mode?:number;readonly flags:number;readonly colors:readonly {readonly time:number;readonly value:readonly number[]}[];readonly words50:readonly number[];readonly bytes60:readonly number[];readonly field70:number;}
export interface TextureModifier extends Modifier {readonly words24:readonly number[];readonly matrix38:readonly number[];}
export interface SceneryModifiers {readonly particleModifiers?:unknown;readonly materialModifiers:readonly MaterialModifier[];readonly textureModifiers:readonly TextureModifier[];}
// AED240 applies target -1 before the material traversal; indexed overrides are
// applied only to their material. Never merge BSRs solely by their mesh paths.
export function sceneryMaterial(source:WorldMaterial,modifiers:SceneryModifiers|undefined,index:number,warn:(message:string)=>void,select:(m:Modifier)=>boolean=m=>m.kind===2&&m.animationSetName.toLowerCase()==='ambient'):WorldMaterial{
 if(!modifiers)return source;
 let material=source;
 const active=(m:Modifier)=>select(m)&&(m.baseWords[3]===0xffffffff||m.baseWords[3]===index);
 for(const m of modifiers.materialModifiers){
  if(!active(m))continue;
  const b=m.bytes60,w=m.words50,color=m.colors[0]?.value;
  // Native D3DTOP 3 is SELECTARG2 (texture alpha), not MODULATE.
  // These overrides do not consume the separately animated texture factor.
  const constant=!m.colors.length||m.colors.every(k=>k.value.length===4&&k.value.every((v,i)=>Number.isFinite(v)&&v===color?.[i]));
  const blendSupported=b[0]===5&&[2,6].includes(b[1]!)&&[4,5].includes(b[2]!)&&b[3]===0&&b[4]===2;
  const multiplyAdd=b[0]===2&&b[1]===3&&b[2]===2&&b[3]===2;
  if(b.length!==16||w.length!==4||(!constant&&(m.mode===undefined||m.field24===undefined))||w[1]!==0&&(!blendSupported&&!multiplyAdd)||w[1]!==0&&!((b[5]===3&&b[7]===2)||(b[5]===2&&b[6]===2)||(b[5]===4&&b[6]===2&&b[7]===2))||w[0]!==0&&(!Number.isInteger(b[9])||b[9]!<1||b[9]!>8)){warn('Unimplemented scenery material state');continue;}
  material={...material,colorTimeline:!constant?{duration:m.field24!,mode:m.mode as 0|1|2,flags:m.flags,colors:m.colors}:material.colorTimeline,
   ...(w[1]?{blend:true,additive:b[1]===2,multiplyAddBlend:multiplyAdd,unlit:multiplyAdd||material.unlit,surfaceAlpha:true,stageFactor:b[2]===5?2:1}:{}),
   depthWrite:w[2]?false:material.depthWrite,alphaCompare:w[0]?b[9] as WorldMaterial['alphaCompare']:material.alphaCompare,textureAlphaSquared:w[1]?b[5]===4:material.textureAlphaSquared,alphaCutoff:w[0]?b[8]!/255:material.alphaCutoff,doubleSided:m.field70===1||material.doubleSided,
   ambient:color&&(m.flags&1)?[color[0]!,color[1]!,color[2]!]:material.ambient,
   color:color&&(m.flags&2)?[color[0]!,color[1]!,color[2]!,material.color[3]]:material.color};
 }
 for(const m of modifiers.textureModifiers){
  if(!active(m))continue;
  const v=m.matrix38;
  if(m.words24[0]===0&&m.words24[1]===0){
   const [start,end,flags]=m.baseBytes??[],fps=m.words24[2],rows=m.words24[3],columns=m.words24[4];
   if([start,end,flags,fps,rows,columns].some(v=>v===undefined||!Number.isSafeInteger(v))||!fps||fps>1000||!rows||!columns){warn('Invalid scenery texture atlas');continue;}
   material={...material,uvVelocity:undefined,uvAtlas:{start:start!,end:end!,flags:flags!,fps,rows,columns}};continue;
  }
  if(m.words24.length!==5||m.words24[0]!==0||m.words24[1]!==1||v.length!==16||!v.every(Number.isFinite)){warn('Unimplemented scenery texture animation');continue;}
  material={...material,uvAtlas:undefined,uvVelocity:[v[0]!,v[1]!,v[4]!,v[5]!,v[8]!,v[9]!]};
 }
 return material;
}
