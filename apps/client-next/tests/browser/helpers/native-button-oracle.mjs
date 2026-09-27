import assert from 'node:assert/strict';
// Independent source texture / native glyph oracle; no production layout code.
export async function checkNativeButton(page,id,name,layoutName='pstitle'){
  const rect=await page.locator(`[data-ui-id="${id}"]`).boundingBox(),screenshot=(await page.screenshot()).toString('base64');
  const result=await page.evaluate(async({rect,screenshot,name,layoutName})=>{
   const layout=await(await fetch(`/assets/cif/layouts/${layoutName}.json`)).json(),node=layout.controlsByName[name];
   const catalog=await(await fetch('/assets/text/textuisystem.en.json')).json();
   const atlas=await(await fetch('/assets/fonts/native-ui-font-atlas.json')).json();
   const load=async path=>createImageBitmap(await(await fetch(path)).blob());
   const [button,fontImage]=await Promise.all([load(node.ddj.publicPath),load(atlas.image)]);
   const expected=document.createElement('canvas');expected.width=rect.width;expected.height=rect.height;const ctx=expected.getContext('2d');
   ctx.drawImage(button,0,0,rect.width,rect.height);const font=atlas.fonts[node.fontIndex],glyphs=Array.from(catalog.entries[node.text],c=>font.glyphs[c.codePointAt(0)]);
   const align=(size,content,mode)=>mode===1?Math.floor((size-content)/2):mode===2?Math.floor(size-content):0;
   let x=align(rect.width,glyphs.reduce((sum,g)=>sum+g.advanceX,0),node.hAlign);const baseline=align(rect.height,font.recordHeight+5,node.vAlign)+font.ascent;
   for(const g of glyphs){ctx.drawImage(fontImage,g.x,g.y,g.width,g.height,x+g.originX,baseline-g.originY,g.width,g.height);x+=g.advanceX;}
   const capturedImage=await load('data:image/png;base64,'+screenshot);
   const capture=document.createElement('canvas');capture.width=rect.width;capture.height=rect.height;capture.getContext('2d').drawImage(capturedImage,rect.x,rect.y,rect.width,rect.height,0,0,rect.width,rect.height);capturedImage.close();
   const a=ctx.getImageData(5,5,rect.width-10,rect.height-11).data,b=capture.getContext('2d').getImageData(5,5,rect.width-10,rect.height-11).data;
   let max=0,total=0;for(let i=0;i<a.length;i++){max=Math.max(max,Math.abs(a[i]-b[i]));total+=Math.abs(a[i]-b[i]);}
   button.close();fontImage.close();return {name,fontIndex:node.fontIndex,max,mean:total/a.length};
  },{rect,screenshot,name,layoutName});
  assert.ok(result.mean<1&&result.max<=5,JSON.stringify(result));return result;
  }
