import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {resetMissionMovementFixture} from '../../../../scripts/lib/missionMovementFixture.mjs';
import {openProbeAgentSession,readProbeCharacterSpawnFromSession} from '../../../../scripts/lib/probeSession.mjs';
import {assertCharacterAllowed} from '../../../../scripts/lib/probeCharacter.mjs';
import {bootPlayableSession} from './helpers/playable-session.mjs';

test('Samarkand Hoyun publishes visible vehicle offers',{timeout:180000},async()=>{
 const character=assertCharacterAllowed('asd2',{context:'Samarkand shop regression'});
 const authority=await openProbeAgentSession(),original=await readProbeCharacterSpawnFromSession(authority,character);
 assert.ok(original);const directory='temp/artifacts/samarkand-shop';await mkdir(directory,{recursive:true});
 let browser,page;const errors=[];
 try{
  console.log('[samarkand-shop] position scratch character at authored Hoyun spawn');
  await resetMissionMovementFixture({session:authority,characterName:character,timeoutMs:30000,fixture:{id:'samarkand-hoyun-shop',movementMode:3,start:{regionId:27500,x:686.56,y:180,z:216.67},startYawRadians:0}});
  ({browser,page}=await launchProbeBrowser());page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{
   const Original=window.Worker;window.__shopEntities={};window.__shopReadyCount=0;
   window.Worker=class extends Original {postMessage(data,...args){if(data?.kind==='session'&&data.command?.kind==='world-ready')window.__shopReadyCount++;return super.postMessage(data,...args);}constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.kind==='world'&&data.batch)for(const e of data.batch.events){if(e.kind==='spawn'||e.kind==='state')window.__shopEntities[e.entity.gid]=e.entity;else if(e.kind==='despawn')delete window.__shopEntities[e.gid];}});}};
  });
  console.log('[samarkand-shop] authenticated boot');
  await bootPlayableSession(page,character);
  await page.waitForFunction(()=>Object.values(__shopEntities).some(e=>e.refObjId===7534),null,{timeout:15000});
  const npc=await page.evaluate(()=>Object.values(__shopEntities).find(e=>e.refObjId===7534));
  console.log('[samarkand-shop] select '+npc.gid);
  await page.evaluate(gid=>__playableRuntime.session({kind:'gameplay',command:{kind:'select',gid}}),npc.gid);
  await page.locator('[data-ui-id="shop-open"]').click({timeout:15000});
  await page.waitForFunction(()=>__playableRuntime.gameplay().shop&&!__playableRuntime.gameplay().inventoryPending,null,{timeout:15000});
  const shop=await page.evaluate(()=>__playableRuntime.gameplay().shop);
  await writeFile(directory+'/shop.json',JSON.stringify({npc,shop,errors},null,2));
  assert.equal(shop.error,undefined);assert.ok(shop.offers.some(o=>o.tab===0),'Vehicle tab must publish offers');
  assert.ok(shop.offers.filter(o=>o.tab===0).every(o=>o.icon),'Every vehicle offer needs its authored icon');
  await page.locator('[data-ui-id^="shop-offer:"]').first().waitFor({timeout:15000});
  await page.screenshot({path:directory+'/shop.png'});
  console.log('[samarkand-shop] same-session warp and reopen');
  assert.equal(await page.evaluate(()=>__playableRuntime.gameplay().eligibility.gm),true,'scratch fixture must permit native warp');
  await page.evaluate(()=>__playableRuntime.session({kind:'gameplay',command:{kind:'gm-command',line:'/warp 27500 686.56 180 216.67'}}));
  await page.waitForFunction(()=>!__playableRuntime.gameplay()?.shop,null,{timeout:15000});
  await page.waitForFunction(()=>__shopReadyCount===2&&/Frontend: world\n/.test(document.querySelector('output')?.textContent)&&__playableRuntime.gameplay()?.localGid,null,{timeout:45000});
  await page.evaluate(gid=>__playableRuntime.session({kind:'gameplay',command:{kind:'select',gid}}),npc.gid);
  await page.locator('[data-ui-id="shop-open"]').click({timeout:15000});
  await page.waitForFunction(()=>__playableRuntime.gameplay().shop&&!__playableRuntime.gameplay().inventoryPending,null,{timeout:15000});
  const after=await page.evaluate(()=>__playableRuntime.gameplay().shop);
  await page.locator('[data-ui-id^="shop-offer:"]').first().waitFor({timeout:15000});
  await page.screenshot({path:directory+'/after-travel.png'});
  await writeFile(directory+'/after-travel.json',JSON.stringify(after,null,2));
  assert.ok(after.offers.filter(o=>o.tab===0).every(o=>o.icon),'travel must retain the merchandise icon dictionary');
  assert.deepEqual(errors,[]);
 }finally{
  if(page){await writeFile(directory+'/state.json',JSON.stringify(await page.evaluate(()=>({game:globalThis.__playableRuntime?.gameplay(),session:globalThis.__playableRuntime?.sessionState()})).catch(()=>null),null,2));await page.screenshot({path:directory+'/last.png'}).catch(()=>{});await page.evaluate(()=>__playableRuntime.session({kind:'logout'})).catch(()=>{});}
  if(browser)await browser.close();
  await resetMissionMovementFixture({session:authority,characterName:character,timeoutMs:30000,fixture:{id:'restore-samarkand-shop',movementMode:3,start:original,startYawRadians:original.angle/65535*Math.PI*2}});
 }
});
