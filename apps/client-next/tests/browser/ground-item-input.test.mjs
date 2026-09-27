import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';
test('drop-name hold passes through focused buttons, never editors, and clears on blur',{timeout:30000},async()=>{
 const {browser,page}=await launchProbeBrowser();try{
  await holdProbeRuntime(page);await page.goto(CLIENT_NEXT_BASE_URL);
  await page.evaluate(async()=>{
   const {runtime}=await import('/src/bootstrap.ts');runtime.dispose();
   const {createInput}=await import('/src/engine/runtime/input/input.ts'),{createPlatform}=await import('/src/engine/runtime/platform/platform.ts');
   const input=createInput(),platform=createPlatform(document.querySelector('canvas'),document.querySelector('output'),()=>{},input.accept,()=>{},event=>{if(event.kind==='input-preferences')input.dropNameBinding(event.value.keys[10]);});
   platform.presentUi({title:'Ground input',message:'',controls:[{id:'ground-button',kind:'button',label:'Button',rect:[10,10,80,24]},{id:'ground-editor',kind:'text',label:'Editor',rect:[10,40,120,24],value:''}]});
   globalThis.groundInputProbe={input,platform};
  });
  const held=()=>page.evaluate(()=>groundInputProbe.input.dropNamesHeld());
  await page.locator('[data-ui-id="ground-button"]').focus();await page.keyboard.down('z');assert.equal(await held(),true);await page.keyboard.up('z');assert.equal(await held(),false);
  await page.keyboard.down('z');await page.locator('[data-ui-id="ground-editor"]').focus();assert.equal(await held(),false);await page.keyboard.up('z');await page.keyboard.type('z');assert.equal(await held(),false);
  await page.locator('[data-ui-id="ground-button"]').focus();await page.keyboard.down('z');assert.equal(await held(),true);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal(await held(),false);await page.keyboard.up('z');
  // The same bridge must route native V from buttons, but never text editors.
  const blind=()=>page.evaluate(()=>groundInputProbe.input.blindHeld());
  await page.locator('[data-ui-id="ground-button"]').focus();await page.keyboard.down('v');assert.equal(await blind(),true);await page.keyboard.up('v');assert.equal(await blind(),false);
  await page.keyboard.down('v');await page.locator('[data-ui-id="ground-editor"]').focus();assert.equal(await blind(),false);await page.keyboard.up('v');await page.keyboard.type('v');assert.equal(await blind(),false);
  await page.locator('[data-ui-id="ground-button"]').focus();await page.keyboard.down('v');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal(await blind(),false);await page.keyboard.up('v');
  await page.evaluate(()=>groundInputProbe.platform.dispose());
 }finally{await browser.close();}
});
