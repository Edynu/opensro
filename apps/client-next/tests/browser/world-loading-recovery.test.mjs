import assert from 'node:assert/strict';
import {test} from 'node:test';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {bootPlayableSession} from './helpers/playable-session.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
test('Constantinople admission failure exposes Retry and recovers the playable session',async()=>{
await mkdir('temp/artifacts/inventory-loading',{recursive:true});
const {browser,page}=await launchProbeBrowser();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try{
 await page.route('**/src/engine/runtime/world/world.ts',async route=>{const response=await route.fetch();let source=await response.text();source=source.replace('const scripts = createCameraScripts(random);','let injected=false; const scripts = createCameraScripts(random);').replace('admit(result);','if(!injected){injected=true;throw Error("Injected world admission failure");} admit(result);');assert.ok(source.includes('let injected=false'));await route.fulfill({response,body:source,contentType:'application/javascript'});});
 const boot=bootPlayableSession(page,'[GM]Test2');void boot.catch(()=>{});
 const retry=page.locator('[data-ui-id="world-load-retry"]');await retry.waitFor({timeout:60000});await page.screenshot({path:'temp/artifacts/inventory-loading/retry-dialog.png'});await retry.click();await boot;await retry.waitFor({state:'detached',timeout:20000});
 assert.deepEqual(errors,[]);await page.screenshot({path:'temp/artifacts/inventory-loading/retry-recovered.png'});await writeFile('temp/artifacts/inventory-loading/retry.json',JSON.stringify({errors,recovered:true,status:await page.locator('output').textContent()},null,2));console.log('PASS injected admission failure -> native Retry -> playable world');
}finally{await browser.close();}

});
