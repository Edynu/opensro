import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {resolveProbeCredentials} from '../../../../scripts/lib/probeSession.mjs';
import {assertCharacterAllowed} from '../../../../scripts/lib/probeCharacter.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';

test('loading shows real transfer feedback and compressed packs avoid loose audio fallback',{timeout:90000},async t=>{
 const {browser,page}=await launchProbeBrowser({viewport:{width:1024,height:768}});t.after(()=>browser.close());
 await mkdir('temp/artifacts/loading-feedback',{recursive:true});const failures=[],loose=[];
 page.context().on('response',r=>{if(new URL(r.url()).pathname.startsWith('/assets/')&&r.status()>=400)failures.push({url:r.url(),status:r.status()});});
 page.context().on('request',r=>{if(/\/assets\/audio\/.*\.(wav|mp3)$/.test(r.url()))loose.push(r.url());});
 await page.goto(CLIENT_NEXT_BASE_URL+'?diagnostics');
 await page.waitForFunction(()=>Number.parseFloat(document.querySelector('[data-transfer="bytes"]')?.textContent)>0&&Number(document.querySelector('[data-transfer="files"]')?.textContent)>0,null,{timeout:30000});
 const feedback=await page.locator('#loading-transfer').innerText();await page.screenshot({path:'temp/artifacts/loading-feedback/transfers.png'});
 assert.match(feedback,/MB/);assert.match(feedback,/Files ready/i);assert.ok(!feedback.includes('NaN'));
 await page.locator('[data-ui-id="frontend:reveal"]').click({timeout:60000});await page.locator('[data-ui-id="account"]').waitFor({timeout:30000});
 await writeFile('temp/artifacts/loading-feedback/startup.json',JSON.stringify({feedback,failures,loose},null,2));assert.deepEqual(failures,[]);assert.deepEqual(loose,[]);
});

test('failed world connection keeps the selected dock visible and permits retry',{timeout:120000},async t=>{
 const character=assertCharacterAllowed('asd2',{context:'loading feedback failure probe'});
 const {browser,page}=await launchProbeBrowser({viewport:{width:1024,height:768}});t.after(()=>browser.close());
 await mkdir('temp/artifacts/loading-feedback',{recursive:true});await holdProbeRuntime(page);
 await page.route('**/character/list',async route=>{const response=await route.fetch(),body=await response.json();await route.fulfill({response,json:{...body,characters:body.characters.filter(row=>row.name===character)}});});
 const control=id=>page.locator(`[data-ui-id="${id}"]`);await page.goto(CLIENT_NEXT_BASE_URL+'?diagnostics');
 await control('frontend:reveal').click({timeout:60000});await page.waitForFunction(()=>document.querySelector('[data-ui-id="login"]')&&!document.querySelector('[data-ui-id="login"]').disabled);
 const credentials=resolveProbeCredentials();await control('account').fill(credentials.loginId);await control('password').fill(credentials.loginPassword);await control('password').press('Enter');
 await control('frontend:create').waitFor({timeout:30000});await page.mouse.click(505,430);await control('enter').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="enter"]')?.disabled);
 await page.evaluate(()=>{window.__entryPhases=[];new MutationObserver(()=>{const phase=/Frontend: ([^\n]+)/.exec(document.querySelector('output')?.textContent??'')?.[1];if(phase&&window.__entryPhases.at(-1)!==phase)window.__entryPhases.push(phase);}).observe(document.querySelector('output'),{subtree:true,childList:true,characterData:true});});
 let release,started;const requested=new Promise(resolve=>started=resolve);let attempts=0;
 await page.context().route('**/auth/transport-token',async route=>{attempts++;started();await new Promise(resolve=>release=resolve);await route.fulfill({status:503,json:{ok:false}});});
 await control('enter').click();await requested;
 await page.waitForFunction(()=>document.querySelector('[data-transfer="title"]')?.textContent==='Connecting to server');
 await page.waitForFunction(()=>/Session: connecting/.test(document.querySelector('output')?.textContent));const connecting=await page.locator('output').textContent();assert.match(connecting,/Frontend: dock\n/);assert.match(connecting,/World: [1-9]\d* visible groups/);assert.equal(await control('enter').isDisabled(),true);
 await page.screenshot({path:'temp/artifacts/loading-feedback/connecting-dock.png'});release();
 await page.waitForFunction(()=>document.querySelector('[data-ui-id="enter"]')&&!document.querySelector('[data-ui-id="enter"]').disabled&&document.querySelector('#loading-transfer').hidden&&/Session: character-select/.test(document.querySelector('output')?.textContent),null,{timeout:15000});
 const phases=await page.evaluate(()=>window.__entryPhases);assert.ok(phases.every(p=>p==='dock'),JSON.stringify(phases));assert.equal(attempts,1);
 await page.screenshot({path:'temp/artifacts/loading-feedback/rejected-dock.png'});
 await writeFile('temp/artifacts/loading-feedback/entry-failure.json',JSON.stringify({phases,attempts,diagnostic:await page.locator('output').textContent()},null,2));
});
