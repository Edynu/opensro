import {fileURLToPath} from 'node:url';
import {launchProbeBrowser} from '../../../scripts/lib/probeBrowser.mjs';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {browser,page}=await launchProbeBrowser({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://localhost:5190');await page.locator('[data-view="items"]').click();await page.locator('#item-rows [data-item]').first().waitFor();
 await page.locator('[data-query="ITEM_ETC_MP_POTION"]').click();assert.ok(await page.locator('#item-rows tr').count()>1);
 await page.locator('.item-identity[data-item="12"]').hover();assert.equal(await page.locator('#item-tip-12').isVisible(),true);
 await mkdir(new URL('../temp/artifacts/',import.meta.url),{recursive:true});await page.screenshot({path:fileURLToPath(new URL('../temp/artifacts/items.png',import.meta.url)),fullPage:true});
 await page.locator('.item-identity[data-item="12"]').click();assert.equal(await page.locator('#item-command').inputValue(),'/MAKEITEM ITEM_ETC_MP_POTION_02 50');
 await page.locator('#item-amount').fill('256');assert.equal(await page.locator('#item-copy').isDisabled(),true);
 await page.locator('#item-amount').fill('20');assert.equal(await page.locator('#item-command').inputValue(),'/MAKEITEM ITEM_ETC_MP_POTION_02 20');
 await page.locator('#item-copy').click();await page.waitForFunction(()=>document.getElementById('item-copy-status').textContent.length>0);assert.match(await page.locator('#item-copy-status').textContent(),/Copied|Ctrl\+C/);
 await page.screenshot({path:fileURLToPath(new URL('../temp/artifacts/item-detail.png',import.meta.url))});await page.keyboard.press('Escape');
 await page.locator('#item-search').fill('nothing-matches-this');assert.match(await page.locator('#item-rows').textContent(),/No items match/);
 await page.locator('#item-search').fill('');await page.locator('#item-category').selectOption('Equipment');await page.locator('#item-rows [data-item]').first().click();assert.match(await page.locator('#item-command').inputValue(),/ 0$/);await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile page must not overflow');
 await page.screenshot({path:fileURLToPath(new URL('../temp/artifacts/items-mobile.png',import.meta.url)),fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS item search, native icons, tooltip, command validation, copy, equipment, empty state and mobile layout');
}finally{await browser.close();}
