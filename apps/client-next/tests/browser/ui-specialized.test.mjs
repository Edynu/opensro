import {test} from 'node:test';import assert from 'node:assert/strict';import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
test('GPU chat composition and quest confirmation route owned commands without optimistic state',{timeout:45000},async()=>{
 const {browser,page}=await launchProbeBrowser();try{
 await page.goto(CLIENT_NEXT_BASE_URL);await page.evaluate(async()=>{
 const entry=Array.from(document.scripts).find(s=>s.src&&new URL(s.src).pathname==='/src/bootstrap.ts');const {runtime}=await import(entry.src);runtime.dispose();
 const {createUi}=await import('/src/engine/runtime/ui/ui.ts'),{createPlatform}=await import('/src/engine/runtime/platform/platform.ts');
 const commands=[],scenes=[],textures=[],state={session:{phase:'world',revision:1,character:'Fixture'},gameplay:{localGid:1,inventory:[],inventorySlotCount:45,equipmentSlotCount:13,vitals:[],casts:[],chat:{lines:[],pending:false,error:null},quests:[{refId:7,u08:0,u09:0,flags:24,u10:2,contents:[{tag:1,kind:0,description:'Find the relic',objectiveSentinel:false,objectiveValues:[1]}],targetIds:[]}]},entities:[],width:1200,height:900,worldReady:true};
 const ui=createUi({available:()=>0,take:()=>null,request:()=>{throw Error('Unexpected resource request');},cancel(){}},c=>commands.push(c),s=>scenes.push(s),(id,image)=>textures.push(id),location.origin,'http://fixture.invalid');
 const platform=createPlatform(document.querySelector('canvas'),document.querySelector('output'),()=>{},()=>{},()=>{},ui.event,ui.blocks);
 window.special={ui,platform,commands,state,scenes,draw(){const s=ui.step({...state});if(s)platform.presentUi(s);}};special.draw();
 });
 await page.evaluate(()=>{special.ui.event({kind:'activate',id:'hud-menu'});special.draw();});await page.getByRole('button',{name:'Chat',exact:true}).click();await page.evaluate(()=>special.draw());
 const input=page.getByLabel('Chat message',{exact:true});await input.fill('hello');await page.evaluate(()=>special.draw());
 await input.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',code:'Enter',isComposing:true}));});assert.equal(await page.evaluate(()=>special.commands.length),0);
 await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'hello'})));await input.press('Enter');
 assert.deepEqual(await page.evaluate(()=>special.commands.at(-1)),{kind:'gameplay',command:{kind:'chat',channel:1,text:'hello',target:''}});assert.equal(await page.evaluate(()=>special.state.gameplay.chat.lines.length),0);
 await page.getByRole('button',{name:'Quests',exact:true}).click();await page.evaluate(()=>special.draw());await page.getByRole('button',{name:'Find the relic',exact:true}).click();await page.evaluate(()=>special.draw());
 await page.getByRole('button',{name:'Abandon',exact:true}).click();await page.evaluate(()=>special.draw());assert.equal(await page.evaluate(()=>special.commands.length),1);
 await page.getByRole('button',{name:'Confirm abandon',exact:true}).click();assert.deepEqual(await page.evaluate(()=>special.commands.at(-1)),{kind:'gameplay',command:{kind:'quest-abandon',refId:7}});assert.equal(await page.evaluate(()=>special.state.gameplay.quests.length),1);
 await page.getByRole('button',{name:'Inventory',exact:true}).click();await page.evaluate(()=>special.draw());await page.getByRole('button',{name:'Next',exact:true}).click();await page.evaluate(()=>special.draw());assert.equal(await page.locator('[data-ui-id^="slot:"]').count(),13);assert.equal(await page.locator('[data-ui-id="slot:45"]').count(),0);
 await page.evaluate(()=>{special.ui.dispose();special.platform.dispose();});assert.equal(await page.locator('[data-gpu-ui]').count(),0);
 }finally{await browser.close();}
});
