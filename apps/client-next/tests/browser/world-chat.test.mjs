import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {resolveProbeCredentials} from '../../../../scripts/lib/probeSession.mjs';
import {assertCharacterAllowed} from '../../../../scripts/lib/probeCharacter.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';

test('mission loading hides overlays; acknowledged chat draws a caret and timed overhead text',{timeout:150000},async()=>{
 const character=assertCharacterAllowed('asd2',{context:'world chat presentation'});
 const {browser,page}=await launchProbeBrowser({viewport:{width:1024,height:768}}),control=id=>page.locator(`[data-ui-id="${id}"]`);
 await mkdir('temp/artifacts/world-chat',{recursive:true});
 try{
  await page.addInitScript(()=>{window.__chatProbe={loading:[],sounds:[],played:[],scene:null,lines:[]};});
  await page.route('**/runtime/ui/ui.ts*',async route=>{
   const response=await route.fetch(),body=await response.text(),needle='publish({';assert.ok(body.includes(needle));
   await route.fulfill({response,body:body.replace(needle,'globalThis.__chatProbe.scene={quads,controls}; globalThis.__chatProbe.lines=game?.chat?.lines??[];globalThis.__chatProbe.feedback=game?.chat?.feedback??[]; if(loading)globalThis.__chatProbe.loading.push({anchors:quads.filter(q=>q.characterAnchor!==undefined).length,academy:controls.some(c=>c.id==="academy-open")}); '+needle)});
  });
  await page.route('**/runtime/audio/audio.ts*',async route=>{
   const response=await route.fetch(),body=await response.text(),needle='function nativeUi(handle, at = clock) {';assert.ok(body.includes(needle));
   await route.fulfill({response,body:body.replace(needle,needle+' globalThis.__chatProbe.sounds.push(handle);').replace('source.start();','source.start(); globalThis.__chatProbe.played.push(event.path);')});
  });
  await page.route('**/character/list',async route=>{const response=await route.fetch(),body=await response.json();assert.ok(body.characters.some(c=>c.name===character));await route.fulfill({response,json:{...body,characters:body.characters.filter(c=>c.name===character)}});});
  await holdProbeRuntime(page);await page.goto(CLIENT_NEXT_BASE_URL+'?diagnostics');await control('frontend:reveal').click({timeout:30000});
  await page.waitForFunction(()=>document.querySelector('[data-ui-id="login"]')&&!document.querySelector('[data-ui-id="login"]').disabled);
  await control('native:servers').click();await control('server:global-official').click();await control('native:server-accept').click();
  const {loginId,loginPassword}=resolveProbeCredentials();await control('account').fill(loginId);await control('password').fill(loginPassword);await control('password').press('Enter');
  await control('frontend:create').waitFor({timeout:30000});await page.mouse.click(505,430);await control('enter').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="enter"]')?.disabled);await control('enter').click();
  await control('chat-text').waitFor({timeout:60000});
  await page.addStyleTag({content:'output{visibility:hidden}'});
  await page.screenshot({path:'temp/artifacts/world-chat/entered.png'});
  await control('chat-text').click();await control('chat-text').fill('Retail chat check');
  await page.waitForFunction(()=>window.__chatProbe.scene?.quads.some(q=>q.texture===''&&q.rect[2]===2&&q.rect[3]===11));
  await page.screenshot({path:'temp/artifacts/world-chat/caret.png'});
  await control('chat-text').press('Enter');
  await page.waitForFunction(()=>window.__chatProbe.lines.some(l=>l.text==='Retail chat check'&&l.outgoing),null,{timeout:15000});
  await page.waitForFunction(()=>window.__chatProbe.scene.quads.some(q=>q.characterAnchor!==undefined&&q.rect[1]<-20&&q.texture===''));
  await page.screenshot({path:'temp/artifacts/world-chat/overhead.png'});
  const result=await page.evaluate(()=>({loading:window.__chatProbe.loading,sounds:window.__chatProbe.sounds,played:window.__chatProbe.played,lines:window.__chatProbe.lines,anchors:window.__chatProbe.scene.quads.filter(q=>q.characterAnchor!==undefined)}));
  assert.ok(result.loading.length);assert.ok(result.loading.every(s=>s.anchors===0&&!s.academy));
  assert.ok(result.sounds.includes('SND_QUEST'));assert.ok(result.played.some(p=>p.endsWith('/questopen.wav')));assert.equal(result.lines.filter(l=>l.text==='Retail chat check').length,1);
  assert.ok(result.anchors.some(q=>q.texture.includes('font')&&q.rect[1]>=-20),'name glyphs must be projected with the player');
  const beginner=result.anchors.find(q=>q.texture.endsWith('/icon_rudiment.png'));
  assert.ok(beginner,'scratch character must retain its beginner decoration');
  const nameBoard=result.anchors.find(q=>q.characterAnchor===beginner.characterAnchor&&q.texture===''&&q.rect[1]>-20);
  assert.ok(nameBoard);assert.ok(Math.abs(beginner.rect[1]+8-(nameBoard.rect[1]+nameBoard.rect[3]/2))<2,'beginner icon and name share one row');assert.ok(beginner.rect[0]+16<nameBoard.rect[0]);
  await page.waitForFunction(()=>!window.__chatProbe.scene.quads.some(q=>q.characterAnchor!==undefined&&q.rect[1]<-20&&q.texture===''),null,{timeout:12000});
  await control('chat-tab:1').click();await page.waitForFunction(()=>document.activeElement?.dataset.uiId==='chat-text'&&document.activeElement.value==='#');
  await control('chat-text').press('Enter');await page.waitForFunction(()=>document.activeElement?.dataset.uiId!=='chat-text');
  await page.keyboard.press('NumpadEnter');await page.waitForFunction(()=>document.activeElement?.dataset.uiId==='chat-text'&&document.activeElement.value==='#');
  await control('chat-text').fill('#party check');await control('chat-text').press('Enter');
  await page.waitForFunction(()=>document.querySelector('[data-ui-id="chat-text"]').value==='');
  await page.screenshot({path:'temp/artifacts/world-chat/party-error.png'});
  await control('chat-tab:2').click();await page.waitForFunction(()=>document.activeElement?.value==='@');
  await control('chat-text').fill('@guild check');await control('chat-text').press('Enter');
  await page.waitForFunction(()=>document.querySelector('[data-ui-id="chat-text"]').value==='');
  await control('chat-tab:3').click();await page.waitForFunction(()=>document.activeElement?.value==='%');
  await control('chat-text').fill('%union check');await control('chat-text').press('Enter');
  await page.waitForFunction(()=>window.__chatProbe.feedback?.some(n=>n.key==='UIIT_CHATERR_ALLIANCE_PERMISSION_DENIED'));
  await control('chat-tab:0').click();await control('chat-text').fill('$NoSuchProbe1 whisper check');await control('chat-text').press('Enter');
  await page.waitForFunction(()=>window.__chatProbe.feedback?.some(n=>n.key==='UIIT_CHATERR_CANT_FIND_TARGET'&&n.argument==='NoSuchProbe1'));
  await page.screenshot({path:'temp/artifacts/world-chat/rejections.png'});
  result.feedback=await page.evaluate(()=>window.__chatProbe.feedback);
  await writeFile('temp/artifacts/world-chat/result.json',JSON.stringify(result,null,2));
 }finally{await page.screenshot({path:'temp/artifacts/world-chat/final.png'}).catch(()=>{});await browser.close();}
});
