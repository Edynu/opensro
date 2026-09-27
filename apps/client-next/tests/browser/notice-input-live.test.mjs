import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {bootPlayableSession} from './helpers/playable-session.mjs';

test('game UI owns context menus across controls and Restart uses the warning skin',{timeout:150000},async()=>{
 const directory='apps/client-next/temp/artifacts/notice-input';await mkdir(directory,{recursive:true});
 const {browser,page}=await launchProbeBrowser();const errors=[];let tracing=false;page.on('pageerror',e=>errors.push(e.message));
 try{
  await bootPlayableSession(page,'asd2');
  await page.context().tracing.start({screenshots:true,snapshots:true});tracing=true;
  await page.evaluate(()=>{window.__menus=[];window.addEventListener('contextmenu',e=>__menus.push({id:e.target.dataset?.uiId??e.target.tagName,prevented:e.defaultPrevented,trusted:e.isTrusted}));});
  await page.mouse.click(300,400,{button:'right'});
  await page.keyboard.press('KeyI');await page.locator('[data-ui-id="main-popup-drag"]').waitFor();
  // Real RMB gestures cover regions, buttons and editors, including GPU chrome.
  for(const id of ['main-popup-drag','slot:13','hotbar:1','chat-text'])await page.locator(`[data-ui-id="${id}"]`).click({button:'right'});
  const controls=await page.evaluate(()=>[...document.querySelectorAll('[data-ui-id]')].map(el=>{
   const e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2});el.dispatchEvent(e);return {id:el.dataset.uiId,kind:el.tagName,disabled:!!el.disabled,prevented:e.defaultPrevented};
  }));
  await page.screenshot({path:directory+'/inventory.png'});
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.locator('[data-ui-id="system-restart"]').waitFor();
  await page.locator('[data-ui-id="system-restart"]').click();
  await page.waitForFunction(()=>__playableRuntime.gameplay()?.notices?.some(n=>n.key==='UIIT_MSG_LOGOUT_REMAIN_TIME'));
  await page.screenshot({path:directory+'/countdown.png'});
  await page.waitForFunction(()=>__playableRuntime.sessionState()?.phase==='character-select',null,{timeout:15000});
  const menus=await page.evaluate(()=>__menus);await writeFile(directory+'/incident.json',JSON.stringify({controls,menus,errors},null,2));
  assert.ok(menus.filter(e=>e.trusted).length>=5);assert.deepEqual(controls.filter(c=>!c.prevented),[]);assert.ok(menus.every(e=>e.prevented));assert.deepEqual(errors,[]);
 }finally{try{if(tracing)await page.context().tracing.stop({path:directory+'/trace.zip'});}finally{await browser.close();}}
});
