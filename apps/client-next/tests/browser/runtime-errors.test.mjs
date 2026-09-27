import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {bootPlayableSession} from './helpers/playable-session.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';

test('caught character failure reaches console and native HUD once, then rearms after recovery',{timeout:120000},async()=>{
 const {browser,page}=await launchProbeBrowser(),messages=[];
 const fault='Runtime reporting regression fixture';
 page.on('console',message=>{if(message.type()==='error'&&message.text().includes(fault))messages.push(message.text());});
 try{
  await holdProbeRuntime(page);
  await page.route('**/runtime/characters/characters.ts*',async route=>{
   const response=await route.fetch(),source=await response.text();
   await route.fulfill({response,body:source.replace('export function createCharacterPresentation(','function observedCharacters(')+`
export function createCharacterPresentation(...args){const owner=observedCharacters(...args);return {...owner,error(){return globalThis.__reportingFault??owner.error();}};}`});
  });
  await page.route('**/runtime/ui/hud/messages.ts*',async route=>{
   const response=await route.fetch(),source=await response.text();
   await route.fulfill({response,body:source.replace('export function createHudMessages(','function observedMessages(')+`
export function createHudMessages(...args){const owner=observedMessages(...args);globalThis.__reportingHud=[];return {...owner,append(...values){globalThis.__reportingHud.push(values);return owner.append(...values);}};}`});
  });
  await bootPlayableSession(page,'asd2');
  await page.evaluate(fault=>globalThis.__reportingFault=fault,fault);
  await page.waitForFunction(fault=>globalThis.__reportingHud?.some(row=>row[0].includes(fault)),fault);
  await page.waitForTimeout(1000);assert.equal(messages.length,1);
  let rows=await page.evaluate(fault=>__reportingHud.filter(row=>row[0].includes(fault)),fault);
  assert.equal(rows.length,1);assert.equal(rows[0][1],0xffff7070);
  await page.evaluate(()=>globalThis.__reportingFault=null);await page.waitForTimeout(500);
  await page.evaluate(fault=>globalThis.__reportingFault=fault,fault);
  await page.waitForFunction(fault=>__reportingHud.filter(row=>row[0].includes(fault)).length===2,fault);
  assert.equal(messages.length,2);
  await mkdir('temp/artifacts/vfx-regression',{recursive:true});
  rows=await page.evaluate(fault=>__reportingHud.filter(row=>row[0].includes(fault)),fault);
  await writeFile('temp/artifacts/vfx-regression/error-reporting.json',JSON.stringify({messages,rows},null,2));
  await page.screenshot({path:'temp/artifacts/vfx-regression/error-reporting.png'});
 }finally{await page.evaluate(()=>globalThis.__playableRuntime?.session({kind:'logout'})).catch(()=>{});await browser.close();}
});
