import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {resolveProbeCharacter} from '../../../../scripts/lib/probeCharacter.mjs';
import {bootPlayableSession} from './helpers/playable-session.mjs';

test('live ring unequip/equip preserves the connected session',{timeout:150000},async()=>{
 const character=resolveProbeCharacter({context:'ring equipment incident'});
 const {browser,page}=await launchProbeBrowser();
 const output='temp/artifacts/ring-equip/'+new Date().toISOString().replaceAll(':','-');
 await mkdir(output,{recursive:true});
 const report={character,verdict:'RUNNING',errors:[],frames:[]};
 page.on('pageerror',e=>report.errors.push(String(e)));
 page.on('websocket',socket=>{
  const record=(direction,event)=>{const p=event.payload;if(typeof p!=='string')report.frames.push({direction,hex:Buffer.from(p).toString('hex')});};
  socket.on('framereceived',e=>record('received',e));socket.on('framesent',e=>record('sent',e));
 });
 const snapshot=()=>page.evaluate(()=>({session:__playableRuntime.sessionState(),inventory:__playableRuntime.gameplay()?.inventory,pending:__playableRuntime.gameplay()?.inventoryPending,output:document.querySelector('output')?.textContent}));
 try{
  console.log('ring incident: authenticated boot');await bootPlayableSession(page,character);
  await page.context().tracing.start({screenshots:true,snapshots:true});
  report.before=await snapshot();
  const ring=report.before.inventory.find(i=>i.typeFlags===6828);
  assert.ok(ring,'Character must already own a ring');
  const bag=Array.from({length:32},(_,i)=>i+13).find(slot=>!report.before.inventory.some(i=>i.slot===slot));
  assert.ok(bag!==undefined,'An empty bag slot is needed');
  const move=async(source,destination)=>{
   console.log('ring incident: move',source,destination);
   await page.evaluate(({source,destination})=>__playableRuntime.session({kind:'gameplay',command:{kind:'inventory-move',source,destination,quantity:1}}),{source,destination});
   await page.waitForFunction(({destination,ref})=>__playableRuntime.sessionState()?.phase!=='world'||!__playableRuntime.gameplay()?.inventoryPending&&__playableRuntime.gameplay()?.inventory?.some(i=>i.slot===destination&&i.refObjId===ref),{destination,ref:ring.refObjId},{timeout:15000});
   await page.waitForTimeout(1500);
   const state=await snapshot();(report.moves??=[]).push(state);
   assert.equal(state.session.phase,'world',JSON.stringify(state.session));
   assert.ok(state.inventory.some(i=>i.slot===destination&&i.refObjId===ring.refObjId));
  };
  if(ring.slot<13){await move(ring.slot,bag);await move(bag,ring.slot);}
  else {await move(ring.slot,11);await move(11,ring.slot);}
  report.after=await snapshot();report.verdict='PASS SUCCESS';
 }catch(e){report.verdict='FAIL';report.error=String(e);report.after=await snapshot().catch(()=>null);throw e;}
 finally{
  await page.screenshot({path:output+'/result.png'}).catch(()=>{});
  await page.context().tracing.stop({path:output+'/trace.zip'}).catch(()=>{});
  await writeFile(output+'/recording.json',JSON.stringify(report,null,2));console.log(output,report.verdict);
  await page.evaluate(()=>__playableRuntime?.dispose()).catch(()=>{});await browser.close();
 }
});
