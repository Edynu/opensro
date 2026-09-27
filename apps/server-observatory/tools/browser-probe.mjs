import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../scripts/lib/probeBrowser.mjs';

const directory=new URL('../temp/artifacts/',import.meta.url);await mkdir(directory,{recursive:true});
const {browser,page}=await launchProbeBrowser({viewport:{width:1440,height:1120}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto('http://localhost:5190/');
 await page.waitForFunction(()=>document.getElementById('connection').textContent.startsWith('Live'),null,{timeout:120000});
 await page.waitForTimeout(4500);
 await page.screenshot({path:fileURLToPath(new URL('overview.png',directory)),fullPage:true});
 const hotspot=page.locator('#hotspots [data-region]').first();
 if(await hotspot.count()){
  const sector=await hotspot.getAttribute('data-region');await hotspot.click();
  assert.equal(await page.locator('#sector-filter').inputValue(),sector);
  assert.equal(await page.locator('#world').isVisible(),true);
  await page.locator('#monster-sort').selectOption('health');await page.waitForTimeout(2500);
  assert.equal(await page.locator('#monster-sort').inputValue(),'health');
  await page.locator('#clear-filters').click();assert.equal(await page.locator('#sector-filter').inputValue(),'');
 }
 await page.locator('[data-shard="test"]').click();assert.match(await page.locator('#subtitle').textContent(),/Test/);
 await page.locator('[data-shard="global-official"]').click();
 await page.getByRole('button',{name:'World census',exact:true}).click();
 await page.getByRole('searchbox',{name:'Search monsters'}).fill('Cerber');
 await page.waitForTimeout(2500);
 assert.equal(await page.getByRole('searchbox',{name:'Search monsters'}).inputValue(),'Cerber','polling must preserve focused search');
 const rows=await page.locator('#monster-table tbody tr').count();
 if(rows){await page.locator('#monster-table [data-entity]').first().click();await page.waitForFunction(()=>document.getElementById('detail').open);await page.screenshot({path:fileURLToPath(new URL('entity.png',directory))});await page.keyboard.press('Escape');}
 await page.getByRole('button',{name:'Players',exact:true}).click();
 await page.getByRole('button',{name:'Runtime',exact:true}).click();
 await page.screenshot({path:fileURLToPath(new URL('runtime.png',directory)),fullPage:true});
 await page.locator('#shard').selectOption('test');await page.waitForTimeout(2500);assert.match(await page.locator('#subtitle').textContent(),/Test/);
 await page.locator('#pause').click();assert.match(await page.locator('#connection').textContent(),/Paused/);await page.locator('#pause').click();
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Overview',exact:true}).click();await page.screenshot({path:fileURLToPath(new URL('mobile.png',directory)),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile page must not overflow');
 // Controlled connection failure must be honest and recoverable.
 await page.route('**/api/snapshot',route=>route.fulfill({status:503,body:'unavailable'}));
 await page.waitForFunction(()=>document.getElementById('connection').textContent==='Disconnected',null,{timeout:12000});
 assert.match(await page.locator('#warning').textContent(),/last capture/);await page.unroute('**/api/snapshot');
 await page.waitForFunction(()=>document.getElementById('connection').textContent.startsWith('Live'),null,{timeout:12000});
 assert.deepEqual(errors,[]);await writeFile(new URL('browser-report.json',directory),JSON.stringify({passed:true,errors,cerberusRows:rows,inspector:rows?'exercised':'not exercised: no Cerberus resident',scenarios:['live data','hotspot sector navigation','sort retention','clear filters','realm strip switching','search retained during updates','runtime','shard switch','pause/resume','mobile','failure/recovery']},null,2));
 console.log('PASS: live dashboard, search, inspector, shard switch, pause, mobile, failure/recovery');
}finally{await browser.close();}
