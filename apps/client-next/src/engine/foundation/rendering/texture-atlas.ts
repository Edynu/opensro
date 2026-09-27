import {createModifierDelta} from './modifier-delta';
export interface TextureAtlas {readonly start:number;readonly end:number;readonly flags:number;readonly fps:number;readonly rows:number;readonly columns:number;}
export function validateTextureAtlas(a:TextureAtlas){
 if(![a.start,a.end,a.flags,a.fps,a.rows,a.columns].every(Number.isSafeInteger)||a.start<0||a.end<0||a.start>255||a.end>255||a.flags<0||a.flags>255||a.fps<1||a.fps>1000||a.rows<1||a.columns<1)throw Error('Invalid texture atlas');
}
// AED970/AED680/AED630. Preserve native overshoot clamping, including the
// single reflection on a long update; modulo ping-pong is not equivalent.
export function createTextureAtlas(source:TextureAtlas){
 validateTextureAtlas(source);const a={...source},period=Math.trunc(1000/a.fps);
 const deltaFor=createModifierDelta();let frame=a.start,direction=a.start>a.end?-1:1,active=true,remainder=0;
 const matrix=new Float32Array([1,0,0,0,0,1,0,0]);
 const write=()=>{matrix[2]=Math.fround(1/a.columns)*(frame%a.columns);matrix[6]=Math.trunc(frame/a.columns)*Math.fround(1/a.rows);};write();
 const stepDelta=(delta:number)=>{
  if(delta<=0||!active)return false;
  remainder+=delta;const count=Math.trunc(remainder/period);remainder-=count*period;if(!count)return false;
  if(a.start===a.end){active=false;return false;}
  frame+=direction*count;
  if(a.flags&2){let begin=a.start,end=a.end,reversed=false;if((begin-end)*direction>0){[begin,end]=[end,begin];reversed=true;}
   if((frame-end)*direction>0){if((a.flags&1)||!reversed){frame=2*end-frame;direction=-direction;if((frame-begin)*direction>0){frame=begin;direction=-direction;}}else{frame=a.start;active=false;}}
  }else if((frame-a.end)*direction>0){if(!(a.flags&1)){frame=a.end;active=false;}else{frame+=a.start-a.end-direction;if((frame-a.end)*direction>0)frame=a.start;}}
  const u=matrix[2],v=matrix[6];write();return matrix[2]!==u||matrix[6]!==v;
 };
 return {matrix,stepDelta,step:(seconds:number)=>stepDelta(deltaFor(seconds))};
}
