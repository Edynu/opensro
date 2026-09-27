import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {resolveProbeCredentials} from '../../../../scripts/lib/probeSession.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';
test('creation sliders blend admitted actors without replacing model assemblies',{timeout:90000},async()=>{
 const {browser,page}=await launchProbeBrowser({viewport:{width:1024,height:768}}),control=id=>page.locator(`[data-ui-id="${id}"]`),errors=[];
 const dir='temp/artifacts/creation-body-shape';await mkdir(dir,{recursive:true});
 try{
  await holdProbeRuntime(page);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/src/engine/runtime/renderer/characters/characters.ts',async route=>{
   const response=await route.fetch(),body=await response.text(),anchor='actors(value) {';assert.ok(body.includes(anchor));
   await route.fulfill({response,body:body.replace(anchor,anchor+`for(const a of value)if(a.model.startsWith('creation:')){const log=globalThis.__shapeFrames??=[];if(log.length<1000)log.push({model:a.model,height:a.scale,volume:a.bodyVolume?.index,female:a.bodyVolume?.female,time:performance.now()});}`)});
  });
  // Admission is read-only; no creation, deletion or world-entry requests are needed.
  await page.route('**/character/list',async route=>{const response=await route.fetch(),body=await response.json();await route.fulfill({response,json:{...body,characters:[]}});});
  await page.goto(CLIENT_NEXT_BASE_URL);await control('frontend:reveal').click({timeout:30000});await control('login').waitFor();
  await page.waitForFunction(()=>!document.querySelector('[data-ui-id="login"]')?.disabled);
  const {loginId,loginPassword}=resolveProbeCredentials();await control('account').fill(loginId);await control('password').fill(loginPassword);await control('password').press('Enter');
  await control('frontend:create').click({timeout:30000});await page.waitForFunction(()=>/Frontend: create\n/.test(document.querySelector('output')?.textContent));
  await page.mouse.click(260,280);await control('create:height').waitFor({timeout:30000});await page.waitForFunction(()=>!document.querySelector('[data-ui-id="create:height"]')?.disabled);
  await page.waitForFunction(()=>globalThis.__shapeFrames?.length);await page.evaluate(()=>globalThis.__shapeFrames=[]);
  await control('create:height').fill('4');await control('create:volume').fill('4');
  await page.waitForFunction(()=>globalThis.__shapeFrames?.at(-1)?.volume===4&&globalThis.__shapeFrames.at(-1).height>1.059);
  const frames=await page.evaluate(()=>globalThis.__shapeFrames);assert.ok(frames.some(f=>f.volume>2&&f.volume<4));assert.ok(frames.some(f=>f.height>1&&f.height<1.059));assert.equal(new Set(frames.map(f=>f.model)).size,1);
  await page.screenshot({path:dir+'/full.png'});await writeFile(dir+'/frames.json',JSON.stringify(frames,null,2));
  await control('create:volume').fill('0');await page.waitForFunction(()=>globalThis.__shapeFrames?.at(-1)?.volume===0);await page.screenshot({path:dir+'/slim.png'});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
