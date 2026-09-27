import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';

test('world button-down, double-click, camera chords and UI exclusion are separate native gestures',{timeout:30000},async t=>{
 const {browser,page}=await launchProbeBrowser({viewport:{width:800,height:600}});t.after(()=>browser.close());
 await page.route(new URL(CLIENT_NEXT_BASE_URL).href,route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0}canvas{width:800px;height:600px}</style><canvas></canvas><output></output>'}));
 await page.goto(CLIENT_NEXT_BASE_URL);
 await page.evaluate(async()=>{const {createPlatform}=await import('/src/engine/runtime/platform/platform.ts');window.gestures=[];window.owner=createPlatform(document.querySelector('canvas'),document.querySelector('output'),()=>{},()=>{},()=>{},()=>{},(x,y)=>x<100&&y<100,(x,y,doubleClick=false)=>window.gestures.push({x,y,doubleClick}));});
 await page.mouse.move(300,200);await page.mouse.down();assert.equal(await page.evaluate(()=>window.gestures.length),1);
 await page.mouse.move(350,230);await page.mouse.up();assert.equal(await page.evaluate(()=>window.gestures.length),1);
 await page.mouse.dblclick(450,300);let events=await page.evaluate(()=>window.gestures);assert.deepEqual(events.map(e=>e.doubleClick),[false,false,false,true]);
 await page.mouse.dblclick(50,50);assert.equal(await page.evaluate(()=>window.gestures.length),4);
 await page.mouse.move(500,350);await page.mouse.down({button:'right'});await page.mouse.move(550,350);await page.mouse.down();await page.mouse.up();await page.mouse.up({button:'right'});
 events=await page.evaluate(()=>window.gestures);assert.equal(events.length,5);assert.equal(events.at(-1).doubleClick,false);
 await page.evaluate(()=>window.owner.dispose());await page.mouse.click(400,200);assert.equal(await page.evaluate(()=>window.gestures.length),5);
});
