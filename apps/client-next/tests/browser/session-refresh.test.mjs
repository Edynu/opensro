import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {resolveProbeCredentials,resolveProbeDivisionId} from '../../../../scripts/lib/probeSession.mjs';

// Authentication/roster only: never selects, enters, creates or mutates a character.
for(const hostname of ['localhost','127.0.0.1'])test(hostname+' reload restores authentication and logout removes restoration',{timeout:90000},async()=>{
 const {browser,page}=await launchProbeBrowser();
 const bind=()=>page.evaluate(async()=>{globalThis.sessionProbeRuntime=(await import('/src/bootstrap.ts')).runtime;});
 const phase=value=>page.waitForFunction(value=>sessionProbeRuntime.sessionState()?.phase===value,value);
 try{
  const {loginId,loginPassword}=resolveProbeCredentials(),divisionId=resolveProbeDivisionId();
  const target=new URL(CLIENT_NEXT_BASE_URL);target.hostname=hostname;const apiBase=new URL('/api',target).href;
  await page.goto(target.href);await bind();await phase('signed-out');
  await page.evaluate(({base,id,password,serverId})=>sessionProbeRuntime.session({kind:'login',apiBase:base,id,password,serverId}),{base:apiBase,id:loginId,password:loginPassword,serverId:divisionId});
  await phase('character-select');
  let cookies=await page.context().cookies();
  const sessionCookie=cookies.find(c=>c.name==='SROLoopbackSession'||c.name==='__Host-SROSession');
  assert.ok(sessionCookie);assert.equal(sessionCookie.httpOnly,true);assert.equal(sessionCookie.sameSite,'Strict');
  assert.equal(await page.evaluate(()=>document.cookie.includes('SROLoopbackSession')||document.cookie.includes('__Host-SROSession')),false);
  const requests=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));
  await page.reload();await bind();await phase('character-select');
  await page.locator('[data-ui-id="frontend:create"]').waitFor({timeout:30000});
  assert.ok(requests.includes('/api/title/session'));assert.ok(!requests.includes('/api/title/login'),'reload must not submit credentials');
  assert.equal(await page.evaluate(()=>sessionProbeRuntime.sessionState().divisionId),divisionId);
  assert.equal(await page.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].some(v=>v.includes('SAS2.'))),false);
  // Exercise the real departure transition, with enough latency for many frames.
  let logouts=0;
  await page.route('**/api/title/logout',async route=>{logouts++;await new Promise(resolve=>setTimeout(resolve,300));await route.continue();});
  await page.locator('[data-ui-id="frontend:leave"]').click();await phase('signed-out');
  await page.locator('[data-ui-id="frontend:reveal"],[data-ui-id="account"]').first().waitFor({timeout:30000});
  if(await page.locator('[data-ui-id="frontend:reveal"]').count())await page.locator('[data-ui-id="frontend:reveal"]').click();
  await page.waitForFunction(()=>/Frontend: login\n/.test(document.querySelector('output')?.textContent),null,{timeout:30000});
  assert.equal(logouts,1,'Cancel must send one logout for the whole departure');
  cookies=await page.context().cookies();assert.ok(!cookies.some(c=>c.name===sessionCookie.name));
  await page.reload();await bind();await phase('signed-out');
 }catch(error){console.error(await page.locator('output').textContent());throw error;}finally{await browser.close();}
});
