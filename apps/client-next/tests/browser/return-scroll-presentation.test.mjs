import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {bootPlayableSession} from './helpers/playable-session.mjs';

// This injects presentation feedback only; it does not qualify server item use.
// Unlike the direct GPU fixture, assets go through the real packed worker.
test('return-scroll feedback reaches the live character presentation',{timeout:90000},async()=>{
 const {browser,page}=await launchProbeBrowser();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const out='temp/artifacts/inventory-return/presentation';await mkdir(out,{recursive:true});
 try{
 await page.route('**/src/engine/runtime/characters/characters.ts',async route=>{const response=await route.fetch(),source=await response.text();await route.fulfill({response,body:source.replace('export function createCharacterPresentation(','function observedCharacterPresentation(')+'\nexport function createCharacterPresentation(...args){const owner=observedCharacterPresentation(...args);globalThis.__scrollCharacters=owner;return owner;}'});});
 await page.route('**/src/engine/runtime/characters/effects/effects.ts',async route=>{const response=await route.fetch(),source=await response.text();await route.fulfill({response,body:source.replace('export function createCharacterEffects(','function observedEffects(')+'\nexport function createCharacterEffects(...args){const owner=observedEffects(...args);return {...owner,step(...args){globalThis.__scrollDebug={entities:args[0].length,holders:args[7]?.length,error:owner.error()};const actors=owner.step(...args);const rows=actors.filter(a=>a.model.includes("item_returnscroll"));if(rows.length)globalThis.__scrollActors=rows;return actors;}};}'});});
 await bootPlayableSession(page,'asd3');
 await page.evaluate(()=>{const game=__playableRuntime.gameplay(),source={...game.pose,gid:game.localGid,kind:'local-player',heading:game.pose.angle};__scrollCharacters.receiveFeedback([{kind:'item-effect',source,item:61,typeFlags:0x9ec}],[source]);});
 try{await page.waitForFunction(()=>{if(globalThis.__scrollDebug?.error)throw Error(__scrollDebug.error);return globalThis.__scrollActors?.length;},null,{timeout:15000});}catch(e){await writeFile(out+'/failure.json',JSON.stringify(await page.evaluate(()=>({debug:__scrollDebug,state:__playableRuntime.gameplay()?.localGid})),null,2));throw e;}
 await page.waitForTimeout(500);await page.screenshot({path:out+'/effect.png'});
 const actors=await page.evaluate(()=>__scrollActors);await writeFile(out+'/incident.json',JSON.stringify({syntheticFeedback:true,actors,errors},null,2));assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
