import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
test('canvas click capability excludes UI, drag, cancelled gestures and disposed owners',{timeout:30000},async()=>{
 const {browser,page}=await launchProbeBrowser();
 try{
  await page.goto('http://127.0.0.1:5180/');
  const result=await page.evaluate(async()=>{
   const {runtime}=await import('/src/bootstrap.ts');runtime.dispose();
   const {createPlatform}=await import('/src/engine/runtime/platform/platform.ts');
   const canvas=document.querySelector('canvas'),hits=[],inputs=[];
   const platform=createPlatform(canvas,document.querySelector('output'),()=>{},event=>inputs.push(event),()=>{},()=>{},x=>x<100,(x,y)=>hits.push([x,y]));
   const rect=canvas.getBoundingClientRect();
   function event(type,x,y,buttons=0){canvas.dispatchEvent(new PointerEvent(type,{clientX:rect.left+x,clientY:rect.top+y,button:0,buttons,pointerId:1,bubbles:true}));}
   // This is an event-routing test. Synthetic events use a capture stub
   // because no browser pointer is active.
   canvas.setPointerCapture=()=>{};
   event('pointerdown',200,200,1);event('pointerup',200,200);event('click',200,200);
   event('pointerdown',20,200,1);event('pointerup',200,200);event('click',200,200);
   event('pointerdown',200,200,1);event('pointermove',250,200,1);event('pointerup',250,200);event('click',250,200);
   event('pointerdown',200,200,1);event('pointercancel',200,200);event('click',200,200);
   platform.dispose();event('pointerdown',200,200,1);event('pointerup',200,200);event('click',200,200);
   return {hits,expected:[200/rect.width,200/rect.height],releases:inputs.filter(e=>e.kind==='release').length};
  });
  assert.deepEqual(result.hits,[result.expected]);assert.ok(result.releases>=2);
 }finally{await browser.close();}
});
