import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {bootPlayableSession,bindPlayableRuntime,waitPlayableWorld} from './helpers/playable-session.mjs';

test('live Skills eligibility and mastery persistence',{timeout:120000},async t=>{
 const {browser,page}=await launchProbeBrowser();const output='temp/artifacts/skill-progression';await mkdir(output,{recursive:true});
 page.context().on('response',async response=>{if(/\/transport\/references\//.test(response.url())){const data=await response.json();await writeFile(output+'/reference-shape.json',JSON.stringify(data.refSkillSnapshot.filter(r=>r.ui&&(!Array.isArray(r.ui.masteries)||r.ui.masteries.length!==2||!Array.isArray(r.ui.prerequisites)||r.ui.prerequisites.length!==3)).slice(0,4),null,2));}});
 try{
  await bootPlayableSession(page,'asd2');await page.locator('[data-ui-id="hotbar:1"]').waitFor();await page.keyboard.press('s');
  await page.locator('[data-ui-id^="skill-mastery:"]').first().waitFor({timeout:30000});
  const state=await page.evaluate(async()=>{
   const game=__playableRuntime.gameplay(),{skillTrainingReason}=await import('/src/engine/foundation/gameplay/skill-catalog.ts');
   return {progression:game.progression,skills:game.skills,bindings:game.quickSlots,catalogSize:game.skillCatalog?.length,
    trainable:game.skillCatalog.filter(row=>!skillTrainingReason(row,game.skills,game.skillCatalog,game.progression)).map(row=>({id:row.id,name:row.name,level:row.level,cost:row.spCost,masteries:row.masteries})),
    controls:[...document.querySelectorAll('[data-ui-id]')].map(n=>({id:n.dataset.uiId,disabled:n.disabled,text:n.textContent})).filter(n=>/skill|mastery/.test(n.id))};
  });
  assert.ok(state.catalogSize>0);await writeFile(output+'/before.json',JSON.stringify(state,null,2));await page.screenshot({path:output+'/before.png'});
  await page.locator('[data-ui-id="skill-tab:0"]').click();await page.locator('[data-ui-id="skill-mastery:257"]').click();
  const initial=await page.evaluate(()=>__playableRuntime.gameplay().progression);
  if(initial.masteries.find(m=>m.id===257)?.level===0){
   await page.locator('[data-ui-id="mastery:257"]').click();
   await page.waitForFunction(()=>__playableRuntime.gameplay().progression.masteries.find(m=>m.id===257)?.level===1&&!__playableRuntime.gameplay().trainingPending);
   assert.equal(await page.evaluate(()=>__playableRuntime.gameplay().progression.skillPoints),initial.skillPoints,'first mastery is free');
  }
  await page.waitForFunction(()=>document.querySelector('[data-ui-id="skill-mastery:257"]')?.getAttribute('aria-pressed')==='true');
  await writeFile(output+'/after-mastery.json',JSON.stringify(await page.evaluate(async()=>{const g=__playableRuntime.gameplay(),{skillTrainingReason}=await import('/src/engine/foundation/gameplay/skill-catalog.ts');return {progression:g.progression,skills:g.skills,rows:g.skillCatalog.filter(r=>r.masteries[0]?.ID===257&&r.level===1).map(r=>({...r,reason:skillTrainingReason(r,g.skills,g.skillCatalog,g.progression)})),controls:[...document.querySelectorAll('[data-ui-id]')].map(n=>n.dataset.uiId).filter(id=>/skill|mastery/.test(id))};}),null,2));
  const candidate=await page.evaluate(()=>{
   const game=__playableRuntime.gameplay(),node=document.querySelector('[data-ui-id^="skill-learn:"]');
   const id=node?Number(node.dataset.uiId.slice(12)):game.skills.find(id=>{const row=game.skillCatalog.find(r=>r.id===id);return row?.trainable&&row.masteries[0]?.ID===257;});
   return {id,learn:!!node,row:game.skillCatalog.find(r=>r.id===id),points:game.progression.skillPoints};
  });
  if(!candidate.id){
   const expected=await page.evaluate(()=>__playableRuntime.gameplay().progression.masteries);
   await page.reload();await bindPlayableRuntime(page);await waitPlayableWorld(page,'asd2');
   assert.deepEqual((await page.evaluate(()=>__playableRuntime.gameplay().progression.masteries)).toSorted((a,b)=>a.id-b.id),expected.toSorted((a,b)=>a.id-b.id));
   await writeFile(output+'/result.json',JSON.stringify({eligibilityAndMasteryPersistence:'PASS',trainDragCastQualified:false,reason:'Scratch character has no affordable unlocked trainable skill',initial,candidate},null,2));
   t.diagnostic('Training/drag/cast acceptance remains unqualified: scratch character has no eligible skill.');return;
  }
  if(candidate.learn){
   await page.locator('[data-ui-id="skill-learn:'+candidate.id+'"]').click();
   await page.locator('[data-ui-id="skill-confirm-ok"]').waitFor();await page.screenshot({path:output+'/confirmation.png'});
   await page.locator('[data-ui-id="skill-confirm-ok"]').click();
   await page.waitForFunction(({id,points})=>{const g=__playableRuntime.gameplay();return g.skills.includes(id)&&!g.trainingPending&&g.progression.skillPoints===points;},{id:candidate.id,points:candidate.points-candidate.row.spCost});
  }
  const source=page.locator('[data-ui-id="skill:'+candidate.id+'"]'),target=page.locator('[data-ui-id="hotbar:1"]');
  const a=await source.boundingBox(),b=await target.boundingBox();assert.ok(a&&b);
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await page.mouse.up();
  await page.waitForFunction(id=>__playableRuntime.gameplay().quickSlots.some(r=>r.slot===1&&r.kind===0x49&&r.payload===id),candidate.id);
  await page.screenshot({path:output+'/learned-bound.png'});
  await page.reload();await bindPlayableRuntime(page);await waitPlayableWorld(page,'asd2');
  const restored=await page.evaluate(()=>({skills:__playableRuntime.gameplay().skills,bindings:__playableRuntime.gameplay().quickSlots,progression:__playableRuntime.gameplay().progression}));
  assert.ok(restored.skills.includes(candidate.id));assert.ok(restored.bindings.some(r=>r.slot===1&&r.payload===candidate.id));
  await writeFile(output+'/result.json',JSON.stringify({result:'PASS training, drag and persistence',candidate,initial,restored},null,2));
 }finally{await writeFile(output+'/diagnostic.txt',await page.locator('output').textContent().catch(()=>''));await browser.close();}
});
