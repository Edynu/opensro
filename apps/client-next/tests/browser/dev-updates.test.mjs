import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';

test('normal play keeps transfer statistics and development notices out of loading artwork',{timeout:60000},async t=>{
 const {browser,page}=await launchProbeBrowser();t.after(()=>browser.close());
 let polls=0;page.on('request',request=>{if(request.url().includes('/__client-next-dev-session?'))polls++;});
 await page.goto(CLIENT_NEXT_BASE_URL);
 await page.waitForFunction(()=>document.querySelector('output')?.textContent?.includes('Replacement runtime:'),null,{timeout:30000});
 assert.equal(await page.locator('#loading-transfer').isHidden(),true);
 // Force the source-change notifier's focus path: normal play must not poll or render it.
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.locator('[data-ui-id="frontend:reveal"]').waitFor({timeout:45000});
 assert.equal(polls,0);assert.equal(await page.locator('[data-dev-update]').count(),0);
 assert.equal(await page.locator('#loading-transfer').isHidden(),true);
 await mkdir('temp/artifacts/dev-updates',{recursive:true});await page.screenshot({path:'temp/artifacts/dev-updates/native-loading.png'});
});

test('real source edits preserve the document; update banner closes and reload is opt-in',{timeout:45000},async()=>{
 await mkdir('temp/artifacts/dev-updates',{recursive:true});const file='temp/artifacts/dev-updates/loaded-probe.mjs';
 const {browser,page}=await launchProbeBrowser();
 try{
  await writeFile(file,'export const version=1;');await page.goto(CLIENT_NEXT_BASE_URL+'?diagnostics');
  assert.equal(await page.locator('script[src="/@vite/client"]').count(),0);
  await page.evaluate(async()=>{window.__devProbe={version:(await import('/temp/artifacts/dev-updates/loaded-probe.mjs')).version};});
  await page.waitForResponse(r=>r.url().includes('/__client-next-dev-session'));
  await writeFile(file,'export const version=2;');
  await page.locator('[data-dev-update="banner"]').waitFor({timeout:12000});
  assert.equal(await page.evaluate(()=>window.__devProbe.version),1);
  for(const width of [1280,480,320]){
   await page.setViewportSize({width,height:720});
   const reload=await page.getByRole('button',{name:'Reload',exact:true}).boundingBox(),close=await page.getByRole('button',{name:'Dismiss update for this page'}).boundingBox();
   assert.ok(Math.abs(reload.y-close.y)<1,'Reload and dismiss stay on one row');assert.ok(close.x>=reload.x+reload.width);assert.ok(close.x+close.width<=width-12);
  }
  await page.screenshot({path:'temp/artifacts/dev-updates/banner.png'});
  await page.getByRole('button',{name:'Dismiss update for this page'}).click();assert.equal(await page.locator('[data-dev-update]').count(),0);
  await writeFile(file,'export const version=3;');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  assert.equal(await page.locator('[data-dev-update]').count(),0);assert.equal(await page.evaluate(()=>window.__devProbe.version),1);
  await page.reload();assert.equal(await page.evaluate(()=>window.__devProbe),undefined);
 }finally{await browser.close();await unlink(file);}
});

test('resource updates and errors while stale escalate to closable notices; unrelated edits stay quiet',{timeout:45000},async()=>{
 const {browser,page}=await launchProbeBrowser();let override=null;
 try{
  await page.route('**/__client-next-dev-session?*',async route=>{const response=await route.fetch(),actual=await response.json();await route.fulfill({response,json:override?{...actual,...override}:actual});});
  await page.goto(CLIENT_NEXT_BASE_URL+'?diagnostics');const initial=await (await page.request.get(new URL('/__client-next-dev-session',CLIENT_NEXT_BASE_URL).href)).json();
  await page.waitForResponse(r=>r.url().includes('/__client-next-dev-session?'));
  async function poll(value){override=value;await Promise.all([page.waitForResponse(r=>r.url().includes('/__client-next-dev-session?')),page.evaluate(()=>window.dispatchEvent(new Event('focus')))]);}
  await poll({generation:initial.generation+1,changed:['/not-loaded.ts']});assert.equal(await page.locator('[data-dev-update]').count(),0);
  await poll({generation:initial.generation+2,changed:['/src/bootstrap.ts']});await page.locator('[data-dev-update="banner"]').waitFor();
  await page.evaluate(()=>window.dispatchEvent(new ErrorEvent('error',{message:'probe error while stale'})));await page.locator('[data-dev-update="overlay"]').waitFor();
  await page.getByRole('button',{name:'Dismiss update for this page'}).click();assert.equal(await page.locator('[data-dev-update]').count(),0);
  override={resources:'changed-resource-generation'};await page.reload();await page.locator('[data-dev-update="overlay"]').waitFor({timeout:12000});
  await page.screenshot({path:'temp/artifacts/dev-updates/overlay.png'});
  override=null;await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Reload',exact:true}).click()]);
  await page.waitForResponse(r=>r.url().includes('/__client-next-dev-session?'));assert.equal(await page.locator('[data-dev-update]').count(),0);
 }finally{await browser.close();}
});

