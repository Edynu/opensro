import {resetMissionMovementFixture} from '../../../../scripts/lib/missionMovementFixture.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {bootPlayableSession} from './helpers/playable-session.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';
test('character circle and animated silhouette shadow passes survive mode transitions',{timeout:150000},async()=>{
 if(process.env.SRO_SHADOW_TERRAIN_CASE==='1')await resetMissionMovementFixture({characterName:'asd2',fixture:{id:'shadow-reported-11249-1526',movementMode:3,start:{regionId:0x634c,x:790,y:4.11749792098999,z:1820},startYawRadians:0},onLog:console.log});
 const out=process.env.SRO_SHADOW_MONSTER==='1'?'temp/artifacts/shadow-aduna':process.env.SRO_SHADOW_TERRAIN_CASE==='1'?'temp/artifacts/character-shadows-terrain':'temp/artifacts/character-shadows';await mkdir(out,{recursive:true});const {browser,page}=await launchProbeBrowser(),evidence={errors:[],cases:[]};
 try{
  await holdProbeRuntime(page);await page.addInitScript(monster=>{globalThis.__shadowEvidence=[];globalThis.__shadowMonster=monster;},process.env.SRO_SHADOW_MONSTER==='1');page.on('pageerror',e=>evidence.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')evidence.errors.push(m.text());});
  await page.route('**/src/engine/runtime/renderer/renderer.ts*',async route=>{const response=await route.fetch(),source=await response.text();await route.fulfill({response,contentType:'application/javascript',body:source.replace('export function createRenderer(','function createObservedRenderer(')+`\nexport function createRenderer(...args){const owner=createObservedRenderer(...args);globalThis.__shadowRenderer=owner;return owner;}`});});
  await page.route('**/src/engine/runtime/renderer/device/character-shadows.ts*',async route=>{const response=await route.fetch(),source=await response.text();await route.fulfill({response,contentType:'application/javascript',body:source.replace('prepare(requests, blob) {','prepare(requests, blob) { globalThis.__shadowEvidence=requests.map(r=>({blob:r.blob,parts:r.parts.length,indices:r.receiver.indices.length,matrix:[...r.matrix]}));')});});
  // Scratch character is currently dead. Exercise alive geometry without
  // altering persistent character data or sending gameplay mutations.
  await page.route('**/src/engine/runtime/characters/characters.ts*',async route=>{const response=await route.fetch(),source=await response.text();await route.fulfill({response,contentType:'application/javascript',body:source.replace('export function createCharacterPresentation(','function createObservedPresentation(')+`\nexport function createCharacterPresentation(...args){const health=args[6];if(health)args[6]={...health,dead(){return false;}};const owner=createObservedPresentation(...args);return {...owner,step(entities,gameplay,...rest){entities=entities.map(e=>e.gid===gameplay?.localGid?{...e,...(globalThis.__shadowMonster?{refObjId:5866,kind:'monster',rarity:0,equipment:[],avatars:[],name:'Aduna Ladon'}:{}),appearanceState:[1,0,0],movementMode:globalThis.__shadowWalk?2:3,moving:!!globalThis.__shadowWalk}:e);return owner.step(entities,gameplay?{...gameplay,...(globalThis.__shadowMonster?{inventory:[]}:{}),moving:!!globalThis.__shadowWalk}:gameplay,...rest);}};}`});});
  await bootPlayableSession(page,'asd2');
  for(const mode of [0,1,2,1,0,2]){
   await page.evaluate(async mode=>{const {defaultVideoOptions}=await import('/src/engine/foundation/rendering/video-options.ts');const options=defaultVideoOptions();options.records[0][1]=mode;__shadowRenderer.videoOptions(options);},mode);
   await page.waitForFunction(mode=>mode===0?__shadowEvidence?.length===0:__shadowEvidence?.length>0&&__shadowEvidence.every(r=>r.blob===(mode===1)),mode,{timeout:25000});
   await page.waitForTimeout(250);evidence.cases.push({mode,rows:await page.evaluate(()=>__shadowEvidence)});await page.screenshot({path:`${out}/mode-${mode}.png`});
  }
  await page.evaluate(()=>globalThis.__shadowWalk=true);await page.waitForTimeout(400);await page.screenshot({path:`${out}/detail-walking.png`});
  evidence.renderer=await page.evaluate(()=>({phase:__shadowRenderer.phase(),error:__shadowRenderer.error()}));assert.equal(evidence.renderer.error,null);assert.deepEqual(evidence.errors,[]);
 }finally{await writeFile(`${out}/evidence.json`,JSON.stringify(evidence,null,2));await browser.close();}
});
