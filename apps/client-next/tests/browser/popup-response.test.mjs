import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {resolveProbeCredentials} from '../../../../scripts/lib/probeSession.mjs';
import {assertCharacterAllowed} from '../../../../scripts/lib/probeCharacter.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';

test('popup keyboard and sidebar response in an authenticated mission',{timeout:150000},async()=>{
 const character=assertCharacterAllowed('asd2',{context:'popup response'}),baseline=process.env.POPUP_BASELINE==='1';
 const folder='temp/artifacts/popup-response/'+(baseline?'before':'after');await mkdir(folder,{recursive:true});
 const {browser,page}=await launchProbeBrowser({viewport:{width:1024,height:768}}),control=id=>page.locator(`[data-ui-id="${id}"]`),results=[];
 try{
  await page.addInitScript(()=>{const Base=window.Worker;window.__popupAssets=[];window.Worker=class extends Base{postMessage(data,...args){if(data.decode==='png')window.__popupAssets.push({ms:performance.now(),url:data.url});return super.postMessage(data,...args);}};});
  await page.route('**/character/list',async route=>{const response=await route.fetch(),body=await response.json();await route.fulfill({response,json:{...body,characters:body.characters.filter(row=>row.name===character)}});});
  await holdProbeRuntime(page);await page.goto(CLIENT_NEXT_BASE_URL+'?diagnostics');await control('frontend:reveal').click({timeout:30000});
  await page.waitForFunction(()=>document.querySelector('[data-ui-id="login"]')&&!document.querySelector('[data-ui-id="login"]').disabled);
  const {loginId,loginPassword}=resolveProbeCredentials();await control('account').fill(loginId);await control('password').fill(loginPassword);await control('password').press('Enter');
  await control('frontend:create').waitFor({timeout:30000});await page.mouse.click(505,430);await control('enter').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="enter"]')?.disabled);await control('enter').click();
  await page.waitForFunction(()=>/Frontend: world\n/.test(document.querySelector('output')?.textContent),null,{timeout:60000});
  await control('hotbar:1').waitFor({timeout:15000});
  // Another live probe may have left the scratch character dead. Move its
  // prompt away from the sidebar without changing the authoritative LIFE state.
  if(await control('rebirth-drag').count()){
   const r=await control('rebirth-drag').boundingBox();await page.mouse.move(r.x+30,r.y+10);await page.mouse.down();await page.mouse.move(60,650,{steps:3});await page.mouse.up();
  }
  // Time from the real input event to committed panel semantics, excluding Playwright polling.
  await page.evaluate(()=>{window.__popup=[];for(const type of ['keydown','click'])document.addEventListener(type,e=>{
   if(type==='keydown'&&e.code!=='KeyC'||type==='click'&&!e.target.closest?.('[data-ui-id]'))return;
   window.__popup.push({event:type,id:e.code??e.target.closest('[data-ui-id]').dataset.uiId,start:performance.now(),frames:[]});
  },true);
  function sample(){const row=window.__popup.at(-1);if(row&&performance.now()-row.start<3000)row.frames.push({ms:performance.now()-row.start,caption:document.querySelector('[data-ui-id="main-popup-drag"]')?.textContent??null});requestAnimationFrame(sample);}requestAnimationFrame(sample);});
  await page.keyboard.press('KeyC');await control('main-popup-drag').waitFor({timeout:15000});
  await control((baseline?'open-window:':'select-window:')+'Inventory').click();await control('slot:13').waitFor({timeout:15000});
  await control((baseline?'open-window:':'select-window:')+'Inventory').click();await page.waitForTimeout(250);
  const remained=await control('slot:13').count();results.push({sameTabStayedOpen:!!remained});
  if(!baseline)assert.ok(remained,'selecting the current sidebar tab must keep the popup open');
  if(!remained){await page.keyboard.press('KeyI');await control('slot:13').waitFor({timeout:15000});}
  await control((baseline?'open-window:':'select-window:')+'Character').click();await control('main-popup-drag').waitFor({timeout:15000});
  await page.keyboard.press('KeyC');await control('main-popup-drag').waitFor({state:'detached'});
  await page.keyboard.press('KeyC');await control('main-popup-drag').waitFor({timeout:15000});
  await page.screenshot({path:folder+'/character.png'});
  if(!baseline){
   const events=await page.evaluate(()=>window.__popup);
   for(const row of events.filter((r,i)=>r.id.startsWith('select-window:')||i===0||i===events.length-1)){
    const expected=row.id==='select-window:Inventory'?'Inventory':'Character',ready=row.frames.find(f=>f.caption===expected);
    assert.ok(ready&&ready.ms<250,`${row.id} must commit within 250 ms: ${ready?.ms}`);
    assert.ok(row.frames.every(f=>f.caption!==null),`${row.id} must never blank the popup`);
   }
  }
 }finally{results.push({events:await page.evaluate(()=>window.__popup??[]),assets:await page.evaluate(()=>window.__popupAssets??[])});await writeFile(folder+'/result.json',JSON.stringify(results,null,2));await writeFile(folder+'/diagnostic.txt',await page.locator('output').textContent()??'');await browser.close();}
});
