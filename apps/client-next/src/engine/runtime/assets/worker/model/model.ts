import {createCharacterDecoder} from "./character/character";
import type {ModelDocument,ModelJson} from "@/engine/contracts/model";
// GLB container admission only. Mesh/skin/animation interpretation remains a separate owner.
export function createModelDecoder() {
 const characters=createCharacterDecoder();
 function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("Invalid GLB object");return v as Record<string,unknown>;}
 function integer(v:unknown):number{if(typeof v!=="number"||!Number.isSafeInteger(v)||v<0)throw new Error("Invalid GLB integer");return v;}
 function freeze(v:unknown,depth=0):ModelJson {
  if(depth>64)throw new Error("GLB metadata nesting exceeds limit");
  if(v===null||typeof v==="string"||typeof v==="boolean")return v;
  if(typeof v==="number"){if(!Number.isFinite(v))throw new Error("Invalid GLB number");return v;}
  if(Array.isArray(v))return Object.freeze(v.map(item=>freeze(item,depth+1)));
  const result:Record<string,ModelJson>=Object.create(null) as Record<string,ModelJson>;
  for(const [key,value] of Object.entries(object(v)))result[key]=freeze(value,depth+1);
  return Object.freeze(result);
 }
 return {
  character:characters.decode,
  decode(bytes:Uint8Array):ModelDocument {
   if(bytes.length<20)throw new Error("Truncated GLB header");
   const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
   if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.length)throw new Error("Unsupported GLB header");
   let cursor=12,json:Record<string,unknown>|null=null,binary:Uint8Array|null=null;
   while(cursor<bytes.length){
    if(cursor+8>bytes.length)throw new Error("Truncated GLB chunk header");
    const length=view.getUint32(cursor,true),type=view.getUint32(cursor+4,true);cursor+=8;
    if(length%4!==0||length>bytes.length-cursor)throw new Error("Invalid GLB chunk length");
    if(type===0x4e4f534a){if(json||cursor!==20)throw new Error("Invalid GLB JSON chunk order");json=object(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(cursor,cursor+length))));}
    else if(type===0x004e4942){if(!json||binary)throw new Error("Invalid GLB binary chunk order");binary=bytes.subarray(cursor,cursor+length);}
    else if(!json)throw new Error("GLB must start with JSON");
    cursor+=length;
   }
   if(!json||object(json.asset).version!=="2.0")throw new Error("Unsupported glTF asset version");
   const buffers=json.buffers??[];if(!Array.isArray(buffers)||buffers.length>1)throw new Error("External GLB buffers are unsupported");
   const buffer=buffers.length?object(buffers[0]):null;let declared=0;
   if(buffer){declared=integer(buffer.byteLength);if(buffer.uri!==undefined||!binary||declared>binary.length||binary.length-declared>3)throw new Error("Invalid embedded GLB buffer");}
   else if(binary&&binary.length)throw new Error("Unexpected GLB binary data");
   const views=json.bufferViews??[];if(!Array.isArray(views))throw new Error("Invalid GLB buffer views");
   for(const raw of views){const entry=object(raw),offset=integer(entry.byteOffset??0),length=integer(entry.byteLength);if(entry.buffer!==0||offset+length>declared)throw new Error("GLB view exceeds binary buffer");if(entry.byteStride!==undefined){const stride=integer(entry.byteStride);if(stride<4||stride>252||stride%4)throw new Error("Invalid GLB byte stride");}}
   const accessors=json.accessors??[];if(!Array.isArray(accessors))throw new Error("Invalid GLB accessors");
   const components:Record<string,number>={"5120":1,"5121":1,"5122":2,"5123":2,"5125":4,"5126":4};
   const widths:Record<string,number>={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
   for(const raw of accessors){
    const a=object(raw),component=components[String(a.componentType)],width=widths[String(a.type)],count=integer(a.count);
    if(!component||!width||!Object.hasOwn(components,String(a.componentType))||!Object.hasOwn(widths,String(a.type))||typeof a.type!=="string"||typeof a.componentType!=="number")throw new Error("Invalid GLB accessor format");
    // Matrices with small components pad each column to four bytes.
    const columns=a.type==="MAT2"?2:a.type==="MAT3"?3:a.type==="MAT4"?4:0;
    const packed=columns?columns*Math.ceil(columns*component/4)*4:component*width;
    if(a.bufferView!==undefined){
     const v=object(views[integer(a.bufferView)]),offset=integer(a.byteOffset??0),stride=integer(v.byteStride??packed);
     if(offset%component||stride<packed||offset+(count?stride*(count-1)+packed:0)>integer(v.byteLength))throw new Error("GLB accessor exceeds buffer view");
    }else if(a.byteOffset!==undefined)throw new Error("GLB accessor offset without buffer view");
    if(a.sparse!==undefined){
     const sparse=object(a.sparse),sparseCount=integer(sparse.count);if(sparseCount>count)throw new Error("Invalid sparse accessor count");
     const indices=object(sparse.indices),values=object(sparse.values),indexSize=components[String(indices.componentType)];
     if(![5121,5123,5125].includes(Number(indices.componentType)))throw new Error("Invalid sparse index type");
     for(const [part,size] of [[indices,indexSize],[values,packed]] as const){const view=object(views[integer(part.bufferView)]);if(integer(part.byteOffset??0)+sparseCount*size!>integer(view.byteLength))throw new Error("Sparse accessor exceeds buffer view");}
    }
   }
   return Object.freeze({json:freeze(json),binary:binary?new Uint8Array(binary.subarray(0,declared)).buffer:new ArrayBuffer(0)});
  }
 };
}
