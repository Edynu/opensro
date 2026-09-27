// Source Map v3 base64 VLQ mappings. Resolve only sampled call-frame locations;
// CPU duration accounting remains in the existing profile summarizer.
export function profileSourceMap(map){
 if(map.version!==3||!Array.isArray(map.sources)||typeof map.mappings!=='string')throw Error('Unsupported profile source map');
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 let source=0,line=0,column=0,name=0;
 const lines=map.mappings.split(';').map(row=>{
  let generated=0;const entries=[];
  for(const segment of row.split(',')){
   if(!segment)continue;const values=[];let value=0,shift=0;
   for(const char of segment){const digit=alphabet.indexOf(char);if(digit<0)throw Error('Invalid source-map digit');value+=(digit&31)*2**shift;if(digit&32){shift+=5;continue;}values.push((value&1)?-Math.floor(value/2):Math.floor(value/2));value=0;shift=0;}
   if(shift||![1,4,5].includes(values.length))throw Error('Invalid source-map segment');
   generated+=values[0];
   if(values.length===1){entries.push({generated});continue;}
   source+=values[1];line+=values[2];column+=values[3];if(values.length===5)name+=values[4];
   if(!map.sources[source]||line<0||column<0)throw Error('Invalid source-map location');
   entries.push({generated,source:map.sources[source],line,column,name:values.length===5?map.names?.[name]:undefined});
  }return entries;
 });
 return (generatedLine,generatedColumn)=>{
  const row=lines[generatedLine];if(!row?.length)return null;
  let low=0,high=row.length;
  while(low<high){const middle=(low+high)>>>1;if(row[middle].generated<=generatedColumn)low=middle+1;else high=middle;}
  const found=row[low-1];return found?.source?found:null;
 };
}
