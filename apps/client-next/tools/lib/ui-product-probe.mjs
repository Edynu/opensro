// Diagnostic snapshots only, bounded to the first 24 assembled products of a
// browser-owned world window. Export after capture, never during acceptance.
export function createUiProductProbe(){
 let active=false,bytes=0,truncated=false;const products=[];
 return {
  start(){active=true;bytes=0;truncated=false;products.length=0;},
  pause(){active=false;},
  record(width,height,quads,semantics){
   if(!active||products.length===24||truncated)return;
   const json=JSON.stringify({width,height,quads,semantics});
   if(bytes+json.length*2>16*1024*1024){truncated=true;return;}
   bytes+=json.length*2;products.push(json);
  },
  stats(){return {products:products.map(value=>JSON.parse(value)),bytes,truncated};}
 };
}
