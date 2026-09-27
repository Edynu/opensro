import type {NativeTexture} from '@/engine/contracts/texture';
export function decodeNativeTexture(bytes:Uint8Array):NativeTexture{
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(bytes.length<20||v.getUint32(0,true)!==0x3158544e)throw Error('Invalid native texture header');
 const width=v.getUint32(4,true),height=v.getUint32(8,true),format=v.getUint32(12,true),count=v.getUint32(16,true);
 if(!width||!height||width>8192||height>8192||(width&(width-1))||(height&(height-1))||![21,0x33545844].includes(format)||count!==1+Math.floor(Math.log2(Math.max(width,height))))throw Error('Invalid native texture dimensions or format');
 const levels:Uint8Array[]=[];let offset=20;
 for(let level=0;level<count;level++){const w=Math.max(1,width>>level),h=Math.max(1,height>>level),size=format===21?w*h*4:Math.ceil(w/4)*Math.ceil(h/4)*16;if(offset+size>bytes.length)throw Error('Truncated native texture');levels.push(bytes.slice(offset,offset+size));offset+=size;}
 if(offset!==bytes.length||offset>64<<20)throw Error('Invalid native texture extent');
 return {kind:'native-texture',width,height,format:format===21?'bgra8unorm':'bc2-rgba-unorm',levels};
}
