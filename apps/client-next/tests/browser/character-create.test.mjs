import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {resolveProbeCredentials} from '../../../../scripts/lib/probeSession.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';
test('native character creation and cancellation branches',{timeout:150000},async()=>{
 const {browser,page}=await launchProbeBrowser({viewport:{width:1024,height:768}}),control=id=>page.locator(`[data-ui-id="${id}"]`),errors=[],events=[];let roster=[],creates=0,mutations=0,admissions=0;
 page.on('response',async r=>{if(r.url().endsWith('/character/list')&&r.ok())roster=(await r.json()).characters??[];});
 page.on('framenavigated',frame=>{if(frame===page.mainFrame())events.push({navigation:frame.url()});});page.on('console',message=>{if(message.text().includes('[vite]'))events.push({vite:message.text()});});
 await mkdir('temp/artifacts/character-create',{recursive:true});page.on('pageerror',e=>errors.push(e.message));
 async function capture(name){await page.screenshot({path:'temp/artifacts/character-create/'+name+'.png'});await writeFile('temp/artifacts/character-create/'+name+'.json',JSON.stringify({errors,events,status:await page.locator('output').textContent(),message:await page.locator('[data-gpu-ui] [role="status"]').textContent({timeout:1000}).catch(()=>null),controls:await page.locator('[data-ui-id]').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.uiId,disabled:n.disabled})))},null,2));}
 try{
  // Hold the modules loaded by this probe for its complete journey. Shared
  // workspace edits must not turn a state-transition test into a Vite reload.
  await holdProbeRuntime(page);
  // Mutations terminate in this browser fixture. No user's roster is modified.
  await page.route('**/auth/*-token',route=>{admissions++;return route.fulfill({json:{ok:false}});});
  await page.route('**/character/list',async route=>{const response=await route.fetch(),body=await response.json();return route.fulfill({response,json:{...body,characters:body.characters.slice(0,3)}});});
  await page.route('**/character/name-overlap',route=>route.fulfill({json:{action:4,nativeResult:1}}));
  await page.route('**/character/create',route=>{creates++;const draft=route.request().postDataJSON();return route.fulfill({json:creates===1?{action:1,nativeResult:2,nativeErrorCode:17}:{action:1,nativeResult:1,characterRosterContractVersion:1,character:{...roster[0],id:999999,name:draft.characterName}}});});
  await page.route('**/character/delete-action',route=>{mutations++;const request=route.request().postDataJSON(),row=roster.find(r=>r.name===request.characterName);assert.ok(row);return route.fulfill({json:{action:request.action,nativeResult:1,characterRosterContractVersion:1,character:{...row,deletePending:request.action===3,deleteReservedAt:request.action===3?new Date().toISOString():undefined}}});});
  await page.goto(CLIENT_NEXT_BASE_URL);await control('frontend:reveal').click({timeout:30000});await control('login').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="login"]')?.disabled);
  const {loginId,loginPassword}=resolveProbeCredentials();await control('account').fill(loginId);await control('password').fill(loginPassword);await control('password').press('Enter');
  await control('frontend:create').waitFor({timeout:40000});
  await page.mouse.click(505,430);await control('dock:delete').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="dock:delete"]')?.disabled);await control('dock:delete').click();await control('dock:warning-cancel').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="dock:warning-cancel"]')?.disabled);await capture('delete-dialog');await control('dock:warning-cancel').click();await control('dock:warning-cancel').waitFor({state:'detached'});assert.equal(mutations,0);
  await control('dock:delete').click();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="dock:warning-accept"]')?.disabled);await control('dock:warning-accept').click();await control('dock:warning-accept').waitFor({state:'detached'});await control('dock:restore').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="dock:restore"]')?.disabled);await capture('delete-pending');await control('dock:restore').click();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="dock:warning-accept"]')?.disabled);await capture('recovery-dialog');await control('dock:warning-accept').click();await control('dock:warning-accept').waitFor({state:'detached'});await control('dock:delete').waitFor();assert.equal(mutations,2);await page.waitForFunction(()=>!document.querySelector('[data-ui-id="dock:back"]')?.disabled);await control('dock:back').click();
  await control('frontend:create').waitFor();await control('frontend:create').click();await page.waitForFunction(()=>/Frontend: create\n/.test(document.querySelector('output')?.textContent),null,{timeout:15000});await capture('race-table');
  // Native mesh picking; coordinates obtained from the authored race camera.
  await page.mouse.move(260,280);await page.mouse.click(260,280);await control('create:name').waitFor({timeout:40000});await page.waitForFunction(()=>!document.querySelector('[data-ui-id="create:name"]')?.disabled);await capture('creation');
  await control('create:height').fill('4');await control('create:volume').fill('4');
  await page.waitForTimeout(250);await capture('shape-transition');
  await page.waitForTimeout(1000);await capture('shape-full');
  await control('create:height').fill('2');await control('create:volume').fill('2');await page.waitForTimeout(1100);
  for(let figure=2;figure<=4;figure++){await control('create:figure:next').click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await capture('figure-'+figure);}await control('create:figure').fill('1');
  await control('create:name').fill('ProbeChar');await control('create:weapon:next').click();await control('create:protector:next').click();await control('create:ok').click();await control('create:confirm-cancel').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="create:confirm-cancel"]')?.disabled);await capture('confirm');await control('create:confirm-cancel').click();
  await control('frontend:back').click();await page.waitForFunction(()=>/Frontend: create\n/.test(document.querySelector('output')?.textContent),null,{timeout:40000});
  await page.mouse.click(720,280);await control('create:name').waitFor({timeout:40000});await page.waitForFunction(()=>!document.querySelector('[data-ui-id="create:name"]')?.disabled);await control('create:female').click();await control('create:figure:next').click();await control('create:name').fill('ProbeChar');await control('create:check').click();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="create:check"]')?.disabled);await control('create:weapon:next').click();await control('create:protector:next').click();await control('create:zoom').click();await control('create:left').click();await page.waitForTimeout(1100);await capture('china-creation');await control('create:zoom').click();
  for(let attempt=0;attempt<2;attempt++){await control('create:ok').click();await control('create:confirm').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="create:confirm"]')?.disabled);await control('create:confirm').click();if(attempt===0){await control('create:name').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="create:name"]')?.disabled);await capture('creation-rejected');}}
  await control('frontend:create').waitFor({timeout:40000});await capture('creation-success');assert.equal(creates,2);
  await page.mouse.click(395,430);await control('enter').waitFor({timeout:5000});await page.waitForFunction(()=>!document.querySelector('[data-ui-id="enter"]')?.disabled);await control('enter').click();await control('enter').waitFor({state:'detached'});await control('enter').waitFor({timeout:40000});assert.ok(admissions>0);await capture('entry-rejected');await page.waitForFunction(()=>!document.querySelector('[data-ui-id="dock:back"]')?.disabled);await control('dock:back').click();
  await control('frontend:leave').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="frontend:leave"]')?.disabled);await control('frontend:leave').click();await control('frontend:reveal').waitFor({timeout:40000});await capture('returned-title');assert.deepEqual(errors,[]);
 }catch(error){await capture('failure');throw error;}finally{await browser.close();}
});

test('native guild deletion blocker stays on the selected dock and never sends a delete',{timeout:60000},async()=>{
 const {browser,page}=await launchProbeBrowser({viewport:{width:1024,height:768}}),control=id=>page.locator(`[data-ui-id="${id}"]`);let mutations=0;
 try{
  await holdProbeRuntime(page);
  await page.route('**/character/list',async route=>{const response=await route.fetch(),body=await response.json();await route.fulfill({response,json:{...body,characters:body.characters.map(row=>({...row,deletionBlocker:'guild-master'}))}});});
  await page.route('**/character/delete-action',route=>{mutations++;return route.fulfill({json:{action:3,nativeResult:0,nativeErrorCode:2}});});
  await page.goto(CLIENT_NEXT_BASE_URL);await control('frontend:reveal').click({timeout:30000});await control('login').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="login"]')?.disabled);
  const {loginId,loginPassword}=resolveProbeCredentials();await control('account').fill(loginId);await control('password').fill(loginPassword);await control('password').press('Enter');await control('frontend:create').waitFor({timeout:30000});
  await page.mouse.click(505,430);await control('dock:delete').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="dock:delete"]')?.disabled);await control('dock:delete').click();
  const catalog=await page.evaluate(async()=>(await (await fetch('/assets/text/textuisystem.en.json')).json()).entries);await page.waitForFunction(text=>document.querySelector('[data-gpu-ui] [role="status"]')?.textContent===text,catalog.UIO_MSG_CHAR_DEL_WANNING_CONFIRM_MASTER);assert.equal(await control('dock:warning-accept').count(),0);assert.equal(mutations,0);await page.screenshot({path:'temp/artifacts/character-create/guild-blocker.png'});
 }finally{await browser.close();}
});
