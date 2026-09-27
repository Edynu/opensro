// MAPT embeds a single 2D DXT1 surface. Decode once in the asset worker;
// GPU mip residency and sampling remain device-owned.
export function decodeDxt1(bytes:Uint8Array,limit=64<<20){
 if(bytes.byteLength<128)throw new Error('Truncated DDS header');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u=(n:number)=>v.getUint32(n,true);
 if(u(0)!==0x20534444||u(4)!==124||u(76)!==32||!(u(80)&4)||u(84)!==0x31545844||u(112)!==0||u(24)>1)throw new Error('Unsupported DDS surface');
 const width=u(16),height=u(12),size=width*height*4,blocksX=Math.ceil(width/4),blocksY=Math.ceil(height/4);
 if(!width||!height||width>8192||height>8192||size>limit||128+blocksX*blocksY*8>bytes.length)throw new Error('DDS dimensions or payload exceed budget');
 const pixels=new Uint8ClampedArray(size),palette=new Uint8Array(16);
 const unpack=(c:number,i:number)=>{const r=(c>>>11)&31,g=(c>>>5)&63,b=c&31;palette.set([(r<<3)|(r>>>2),(g<<2)|(g>>>4),(b<<3)|(b>>>2),255],i);};
 for(let y=0;y<blocksY;y++)for(let x=0;x<blocksX;x++){
  const offset=128+(y*blocksX+x)*8,c0=v.getUint16(offset,true),c1=v.getUint16(offset+2,true),bits=u(offset+4);unpack(c0,0);unpack(c1,4);
  for(let c=0;c<3;c++){palette[8+c]=Math.floor(c0>c1?(2*palette[c]!+palette[4+c]!)/3:(palette[c]!+palette[4+c]!)/2);palette[12+c]=c0>c1?Math.floor((palette[c]!+2*palette[4+c]!)/3):0;}palette[11]=255;palette[15]=c0>c1?255:0;
  for(let dy=0;dy<4;dy++)for(let dx=0;dx<4;dx++)if(x*4+dx<width&&y*4+dy<height){const p=((bits>>>((dy*4+dx)*2))&3)*4;pixels.set(palette.subarray(p,p+4),((y*4+dy)*width+x*4+dx)*4);}
 }
 return {width,height,pixels};
}
