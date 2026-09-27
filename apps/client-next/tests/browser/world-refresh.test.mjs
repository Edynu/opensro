import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {resolveProbeCredentials,resolveProbeDivisionId} from '../../../../scripts/lib/probeSession.mjs';
import {assertCharacterAllowed} from '../../../../scripts/lib/probeCharacter.mjs';

test('localhost refresh re-enters the selected world without credentials or another click',{timeout:180000},async()=>{
 const character=assertCharacterAllowed('asd2',{context:'world refresh regression'});
 const {browser,page}=await launchProbeBrowser({viewport:{width:1024,height:768}});
 const target=new URL(CLIENT_NEXT_BASE_URL);target.hostname='localhost';
 const artifact='temp/artifacts/session-refresh';await mkdir(artifact,{recursive:true});
 const bind=()=>page.evaluate(async()=>{globalThis.sessionProbeRuntime=(await import('/src/bootstrap.ts')).runtime;});
 const world=()=>page.waitForFunction(character=>sessionProbeRuntime.sessionState()?.phase==='world'&&sessionProbeRuntime.sessionState()?.character===character&&/Frontend: world\n/.test(document.querySelector('output')?.textContent),character,{timeout:60000});
 const paths=[];page.on('request',r=>{const path=new URL(r.url()).pathname;if(path.startsWith('/api/'))paths.push(path);});
 try{
  // Keep probes away from the human's character; this only filters presentation.
  await page.route('**/character/list',async route=>{const response=await route.fetch(),body=await response.json();assert.ok(body.characters.some(row=>row.name===character));await route.fulfill({response,json:{...body,characters:body.characters.filter(row=>row.name===character)}});});
  await page.goto(target.href);await bind();await page.waitForFunction(()=>sessionProbeRuntime.sessionState()?.phase==='signed-out');
  const {loginId,loginPassword}=resolveProbeCredentials(),serverId=resolveProbeDivisionId();
  await page.evaluate(({id,password,serverId})=>sessionProbeRuntime.session({kind:'login',apiBase:location.origin+'/api',id,password,serverId}),{id:loginId,password:loginPassword,serverId});
  await page.locator('[data-ui-id="frontend:create"]').waitFor({timeout:30000});
  await page.mouse.click(505,430);await page.locator('[data-ui-id="enter"]').waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-ui-id="enter"]')?.disabled===false);await page.locator('[data-ui-id="enter"]').click();await world();
  assert.ok((await page.context().cookies()).some(c=>c.name.endsWith('SessionCharacter')&&c.httpOnly),'world entry must remember its admitted selection');
  for(let pass=1;pass<=2;pass++){
   paths.length=0;await page.reload();await bind();await world();
   assert.ok(paths.includes('/api/title/session'));assert.ok(paths.includes('/api/character/list'));
   assert.ok(paths.includes('/api/auth/transport-token'));assert.ok(paths.includes('/api/auth/enterworld-token'));
   assert.ok(!paths.includes('/api/title/login'),'reload must not resubmit credentials');
   assert.equal(await page.evaluate(()=>sessionProbeRuntime.sessionState().restoringWorld),true);
   await page.screenshot({path:artifact+'/world-'+pass+'.png'});
  }
  await writeFile(artifact+'/result.json',JSON.stringify({result:'PASS',origin:target.origin,character,refreshes:2,requests:paths},null,2));
 }finally{
  await writeFile(artifact+'/diagnostic.txt',await page.locator('output').textContent().catch(()=>''));
  await page.screenshot({path:artifact+'/final.png'}).catch(()=>{});await browser.close();
 }
});
