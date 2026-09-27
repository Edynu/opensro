import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkNativeButton} from './helpers/native-button-oracle.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';

test('retail login: live server list, native button pixels, selection, cancel and keyboard recovery',{timeout:90000},async()=>{
 const {browser,page}=await launchProbeBrowser({viewport:{width:1024,height:768}});
 const errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.url().endsWith('/title/servers'))network.push({url:r.url(),status:r.status()});});
 await mkdir('temp/artifacts/login-ui',{recursive:true});
 const control=id=>page.locator(`[data-ui-id="${id}"]`);
 try{
  await page.goto(CLIENT_NEXT_BASE_URL);
  await control('frontend:reveal').click({timeout:30000});
  await control('native:servers').waitFor({timeout:15000});
  await page.waitForFunction(()=>/UI: 0 pending images; 0 failed images/.test(document.querySelector('output')?.textContent));
  await page.waitForTimeout(600);
  await page.mouse.move(1,200);
  await page.screenshot({path:'temp/artifacts/login-ui/login.png'});
  const connect=await control('login').boundingBox();assert.deepEqual(connect,{x:412,y:540,width:91,height:41});
  // Independent raster oracle: source DDJ pixels and published native glyph masks.
  // No title renderer/layout function is called to construct the reference.
  const checkButton=(id,name)=>checkNativeButton(page,id,name);
  const pixelCheck=[await checkButton('login','GDR_BTN_OK'),await checkButton('logout','GDR_BTN_CANCEL')];
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/title/servers'));
  await control('native:servers').click();const response=await responsePromise;assert.equal(response.status(),200);
  const servers=await response.json(),available=servers.filter(s=>s.operating);assert.ok(available.length>=1,'Live gateway must expose a selectable server');
  await control('server:'+available[0].id).click();
  assert.equal(await control('account').count(),0,'Login editor must not intercept server-panel input');
  assert.equal(await control('native:server-accept').isEnabled(),true);
  await page.waitForTimeout(650);await page.screenshot({path:'temp/artifacts/login-ui/servers.png'});
  await page.mouse.move(1,200);await page.waitForTimeout(50);
  pixelCheck.push(await checkButton('native:server-accept','GDR_BTN_SACCEPT'),await checkButton('native:server-cancel','GDR_BTN_SCANCEL'));
  await control('native:server-accept').click();await control('account').waitFor();
  await control('account').fill('probe-user');await control('password').fill('not-submitted');
  await control('native:servers').click();await control('native:server-cancel').waitFor();
  if(available[1])await control('server:'+available[1].id).click();
  await control('native:server-cancel').click();await control('account').waitFor();
  assert.equal(await control('account').inputValue(),'probe-user');assert.equal(await control('password').inputValue(),'not-submitted');
  await control('native:servers').click();
  await control('server:'+available[0].id).waitFor();
  assert.equal(await control('server:'+available[0].id).getAttribute('aria-pressed'),'true','Cancel must preserve committed selection');
  await page.keyboard.press('Escape');await control('account').waitFor();
  assert.deepEqual(errors,[]);
  await writeFile('temp/artifacts/login-ui/result.json',JSON.stringify({network,pixelCheck,errors,verdict:'PASS'},null,2));
 }finally{await browser.close();}
});

test('server list exposes rows beyond thirteen and remains dismissible on request failure',{timeout:60000},async()=>{
 const {browser,page}=await launchProbeBrowser({viewport:{width:1280,height:960},deviceScaleFactor:2});
 const control=id=>page.locator(`[data-ui-id="${id}"]`);
 const servers=Array.from({length:20},(_,i)=>({id:String(i),name:'Server '+i,onlinePlayers:10,capacity:100,nativeServerId:i+1,nativeFarmId:1,isTest:false,operating:true,transportUrl:'https://fixture.invalid'}));
 let reject=false;
 try{
  await page.route('**/title/servers',route=>route.fulfill({status:reject?503:200,contentType:'application/json',body:JSON.stringify(reject?{error:'Unavailable'}:servers),headers:{'access-control-allow-origin':'*'}}));
  await page.goto(CLIENT_NEXT_BASE_URL);await control('frontend:reveal').click({timeout:30000});await control('native:servers').click({timeout:15000});
  await control('server:0').waitFor();assert.equal(await page.locator('[data-ui-id^="server:"]').count(),13);
  for(let i=0;i<7;i++)await control('native:server-next').click();
  await control('server:19').dblclick();await control('account').waitFor();
  reject=true;await control('native:servers').click();await page.waitForFunction(()=>document.querySelector('[data-gpu-ui="semantics"] [role="status"]')?.textContent.includes('HTTP request rejected'));
  await control('native:server-cancel').click();await control('account').waitFor();
  assert.equal(await control('native:servers').isEnabled(),true);
 }finally{await browser.close();}
});
