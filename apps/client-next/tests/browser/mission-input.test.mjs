import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {resolveProbeCredentials} from '../../../../scripts/lib/probeSession.mjs';
import {assertCharacterAllowed} from '../../../../scripts/lib/probeCharacter.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';

test('ground gestures tolerate pointer drift and issue exactly once on button-down',{timeout:150000},async()=>{
 const character=assertCharacterAllowed('asd2',{context:'client-next mission entry'});
 const {browser,page}=await launchProbeBrowser({viewport:{width:1024,height:768}}),control=id=>page.locator(`[data-ui-id="${id}"]`);
 await mkdir('temp/artifacts/mission-input',{recursive:true});
 try{
  await page.addInitScript(()=>{
   const WorkerBase=window.Worker;window.__entry={commands:[],phases:[],game:null,menus:[]};
   window.addEventListener('contextmenu',e=>window.__entry.menus.push(e.defaultPrevented));
   window.Worker=class extends WorkerBase{
    postMessage(data,...args){if(data.kind==='session'&&['gameplay','world-ready'].includes(data.command?.kind))window.__entry.commands.push(data.command.command?.kind==='navigation'?{kind:'gameplay',command:{kind:'navigation',regionId:data.command.command.regionId}}:data.command);return super.postMessage(data,...args);}
    constructor(...args){super(...args);this.addEventListener('message',({data})=>{const r=window.__entry;if(data.kind==='session'){r.session=data.state;if(r.phases.at(-1)!==data.state.phase)r.phases.push(data.state.phase);}if(data.kind==='world')for(const e of data.batch.events)if(e.kind==='gameplay')r.game={...r.game,...e.state};if(data.kind==='failure')r.failure=data.message;});}
   };
  });
  await page.route('**/character/list',async route=>{const response=await route.fetch(),body=await response.json();await route.fulfill({response,json:{...body,characters:body.characters.filter(row=>row.name===character)}});});
  await holdProbeRuntime(page);await page.goto(CLIENT_NEXT_BASE_URL+'?diagnostics');await control('frontend:reveal').click({timeout:30000});
  await page.waitForFunction(()=>!document.querySelector('[data-ui-id="login"]')?.disabled&&document.querySelector('[data-ui-id="login"]'));
  const {loginId,loginPassword}=resolveProbeCredentials();await control('account').fill(loginId);await control('password').fill(loginPassword);await control('password').press('Enter');
  await control('frontend:create').waitFor({timeout:30000});await page.mouse.click(505,430);await control('enter').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-ui-id="enter"]')?.disabled);await page.screenshot({path:'temp/artifacts/mission-input/dock.png'});await control('enter').click();
  await page.waitForFunction(()=>/Frontend: loading-world/.test(document.querySelector('output')?.textContent),null,{timeout:15000});const loading=await page.screenshot({path:'temp/artifacts/mission-input/loading.png'});
  const loadingMatch=await page.evaluate(async png=>{
   const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=768;const ctx=canvas.getContext('2d'),points=[[800,200],[400,350],[900,400],[600,200]];
   async function samples(url){const image=await createImageBitmap(await(await fetch(url)).blob());ctx.clearRect(0,0,1024,768);ctx.drawImage(image,0,0,1024,768);image.close();return points.flatMap(([x,y])=>[...ctx.getImageData(x,y,1,1).data].slice(0,3));}
   const actual=await samples('data:image/png;base64,'+png),errors=[];for(const variant of [1,2]){const expected=await samples('/assets/images/Media_extracted/interface/loading/loading_europe_'+variant+'.png');errors.push(Math.max(...actual.map((v,i)=>Math.abs(v-expected[i]))));}return Math.min(...errors);
  },loading.toString('base64'));assert.ok(loadingMatch<=3,'Loading pixels must match a retail entry background: '+loadingMatch);
  await page.waitForFunction(()=>/Frontend: world\n/.test(document.querySelector('output')?.textContent),null,{timeout:60000});
  const before=await page.evaluate(()=>window.__entry.game);await page.screenshot({path:'temp/artifacts/mission-input/world-before.png'});
  await page.mouse.move(550,400);await page.mouse.down({button:'right'});await page.mouse.move(600,410,{steps:5});await page.mouse.up({button:'right'});
  await page.mouse.move(650,520);await page.mouse.down();
  await page.waitForFunction(()=>window.__entry.commands.some(c=>c.command?.kind==='ground-move'));
  await page.mouse.move(665,520,{steps:3});await page.mouse.up();
  await page.waitForFunction(()=>window.__entry.commands.some(c=>c.command?.kind==='ground-move'),null,{timeout:5000});
  await page.waitForFunction(ack=>window.__entry.game?.acknowledgedMove>ack,before.acknowledgedMove??0,{timeout:10000});
  const result=await page.evaluate(()=>window.__entry);assert.ok(result.menus.length>0);assert.ok(result.menus.every(Boolean));assert.equal(result.failure,undefined);assert.equal(result.commands.filter(c=>c.kind==='world-ready').length,1);
  assert.equal(result.commands.filter(c=>c.command?.kind==='ground-move').length,1);assert.notDeepEqual(result.game.pose,before.pose);await page.screenshot({path:'temp/artifacts/mission-input/world-after.png'});
 }finally{
  await page.screenshot({path:'temp/artifacts/mission-input/final.png'});await writeFile('temp/artifacts/mission-input/diagnostic.txt',await page.locator('output').textContent());
  await writeFile('temp/artifacts/mission-input/result.json',JSON.stringify(await page.evaluate(()=>window.__entry),null,2));await browser.close();
 }
});
