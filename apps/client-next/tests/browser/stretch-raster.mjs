import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const oracle=JSON.parse(readFileSync(new URL('../fixtures/native/native-menu-geometry.json',import.meta.url),'utf8'));

// Expected slot order, UVs and rectangles come from executing retail bytes,
// independently of the scene's quads and the TypeScript stretchRing helper.
export async function assertNativeStretchRaster(page,png,windows,foreground=[]){
 const cases=windows.map(({id,origin})=>{
  const row=oracle.cases.find(row=>row.id===id);assert.ok(row,id);
  return {...row,origin};
 });
 const result=await page.evaluate(async({png,cases,parts,uvs,foreground})=>{
  const shot=await createImageBitmap(new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'}));
  const canvas=new OffscreenCanvas(shot.width,shot.height),ctx=canvas.getContext('2d');ctx.drawImage(shot,0,0);shot.close();
  const actual=ctx.getImageData(0,0,canvas.width,canvas.height).data,results=[];
  for(const row of cases){
   let compared=0,mismatched=0;const differences=[];
   for(let i=0;i<8;i++){
    const source=await createImageBitmap(await (await fetch(row.prefix+parts[i]+'.png')).blob());
    const tile=new OffscreenCanvas(source.width,source.height),tc=tile.getContext('2d');tc.drawImage(source,0,0);source.close();
    const expected=tc.getImageData(0,0,tile.width,tile.height).data;
    const [rx,ry,w,h]=row.quads[i],x=rx+row.origin[0],y=ry+row.origin[1],uv=uvs[i];
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
     // Only the outer two pixels: inner border pixels can legitimately be
     // overpainted by a later authored fill or unclipped text control.
     const dx=rx+px-row.rect[0],dy=ry+py-row.rect[1];
     if(dx>=2&&dy>=2&&dx<row.rect[2]-2&&dy<row.rect[3]-2)continue;
     if(foreground.some(([gx,gy,gw,gh])=>x+px>=gx&&x+px<gx+gw&&y+py>=gy&&y+py<gy+gh))continue;
     const a=(px+.5)/w,b=(py+.5)/h;
     const u=uv[0][0]+a*(uv[1][0]-uv[0][0])+b*(uv[3][0]-uv[0][0]);
     const v=uv[0][1]+a*(uv[1][1]-uv[0][1])+b*(uv[3][1]-uv[0][1]);
     // Exact nearest-sampler boundaries can fall either side after GPU
     // interpolation. Compare texel interiors, not floating-point ties.
     if([u*tile.width,v*tile.height].some(n=>Math.abs(n-Math.round(n))<1e-5))continue;
     const src=(Math.floor(v*tile.height)*tile.width+Math.floor(u*tile.width))*4;
     if(expected[src+3]!==255)continue;
     const dst=((y+py)*canvas.width+x+px)*4;compared++;
     if([0,1,2].some(c=>Math.abs(actual[dst+c]-expected[src+c])>1)){mismatched++;if(differences.length<8)differences.push({part:i,x:x+px,y:y+py,actual:Array.from(actual.slice(dst,dst+3)),expected:Array.from(expected.slice(src,src+3))});}
    }
   }
   results.push({id:row.id,compared,mismatched,differences});
  }
  return results;
 },{png:png.toString('base64'),cases,parts:oracle.textureInstaller.parts,uvs:oracle.uvs,foreground});
 for(const row of result){assert.ok(row.compared>20,row.id+' opaque raster samples');assert.equal(row.mismatched,0,JSON.stringify(row));}
 return result;
}
