import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {openProbeAgentSession,readProbeCharacterSpawnFromSession,fetchProbeSessionJson} from '../../../../scripts/lib/probeSession.mjs';
import {resetMissionMovementFixture} from '../../../../scripts/lib/missionMovementFixture.mjs';
import {assertCharacterAllowed} from '../../../../scripts/lib/probeCharacter.mjs';
import {bootPlayableSession} from './helpers/playable-session.mjs';
import {installFollowRecorder} from './helpers/follow-recorder.mjs';

// Controlled stimuli are sent to the authenticated server fixture. Observations
// only on the browser: no injected goals, entities, AI transitions or cast frames.
test('authenticated authored summon FOLLOW lifecycle',{timeout:240000},async()=>{
 const character=assertCharacterAllowed('asd2',{context:'live summoned-monster FOLLOW'});
 const session=await openProbeAgentSession(),original=await readProbeCharacterSpawnFromSession(session,character);assert.ok(original);
 const out='temp/artifacts/live-summon-follow/'+(process.env.SRO_FOLLOW_CAPTURE??'current');await mkdir(out,{recursive:true});
 await writeFile(out+'/restore.json',JSON.stringify({character,division:session.divisionId,original},null,2));
 const sources=['tests/browser/live-summon-follow.test.mjs','tests/browser/helpers/follow-recorder.mjs','../server/cmd/services/sro-gameworld/development_follow.go','../server/internal/game/action/development_follow.go','../server/internal/game/world/simulation/development_follow.go','../server/internal/game/world/simulation/monstersummon_behavior.go','../server/internal/game/world/simulation/monsterfollow_transaction.go'];
 sources.push('../server/cmd/services/sro-gameworld/wiring_runtime.go','../server/internal/game/action/monstercombat.go','../server/internal/game/action/runtime_lifecycle.go','../server/internal/game/action/skillcombat.go','../server/internal/game/world/simulation/tick.go','../server/internal/game/world/simulation/monstertick.go','../server/internal/game/world/simulation/monsteraicadence.go','../server/internal/game/world/simulation/monstersummon.go','../server/internal/game/world/monster/ai_time_manager.go','../server/internal/game/enterworld/skill_ai_timing.go');
 await writeFile(out+'/sources.json',JSON.stringify(await Promise.all(sources.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')}))),null,2));
 const errors=[],commands=[],phases=[],captures=[];let browser,page,failure,cleanupFailure;
 const control=async command=>{const at=Date.now();if(command!=='status')console.log('[follow]',command);const result=await fetchProbeSessionJson(session,'/development/follow-fixture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({characterName:character,command})});if(command!=='status')commands.push({at,command,result});return result.fixture;};
 const waitServer=async(predicate,label,timeout=20000)=>{const end=Date.now()+timeout;while(Date.now()<end){const state=await control('status');if(predicate(state)){phases.push({label,at:Date.now(),state});return state;}await new Promise(resolve=>setTimeout(resolve,100));}throw Error('FOLLOW phase timed out: '+label);};
 const browserRecord=()=>page.evaluate(()=>{const ids=new Set(globalThis.__followObservedGids??[]);return {events:__pursuit.events.filter(e=>e.kind==='clock'||e.kind==='wire'||e.kind==='worker-failure'),status:document.querySelector('output')?.textContent,session:__playableRuntime.sessionState(),effects:__playableRuntime.gameplay()?.attachedEffects,entities:Object.fromEntries(Object.entries(__pursuit.entities).filter(([gid])=>ids.has(Number(gid)))),segments:__pursuit.segments,visible:globalThis.__followVisible,camera:globalThis.__followCamera,renderSamples:globalThis.__followRenderSamples};});
 const gidOf=event=>event.payload?.length>=4?new DataView(Uint8Array.from(event.payload).buffer).getUint32(0,true):0;
 const movement=(record,gid,after=0)=>record.events.filter(e=>e.kind==='wire'&&e.opcode===0xb738&&gidOf(e)===gid&&e.origin+e.wallAt>=after);
 // Outdoor B738 destination: GID/u8 destination/u16 region/u16 X/Y/Z.
 const goalReceipt=async(gid,goal,after)=>{
  await page.waitForFunction(({gid,goal,after})=>__pursuit.events.some(e=>{if(e.kind!=='wire'||e.opcode!==0xb738||e.payload.length<13||e.payload[4]!==1||e.origin+e.wallAt<after)return false;const v=new DataView(Uint8Array.from(e.payload).buffer);return v.getUint32(0,true)===gid&&v.getUint16(5,true)===goal.RegionID&&v.getUint16(7,true)===goal.X&&v.getUint16(11,true)===goal.Z;}),{gid,goal,after},{timeout:5000});
  phases.push({label:'accepted-goal-wire-match',gid,goal,after});
 };
 const visible=async(gid,label)=>{
  await page.waitForFunction(gid=>Boolean(globalThis.__followVisible?.anchors[gid]),gid,{timeout:15000});
  const model=await page.evaluate(gid=>({entity:__pursuit.entities[gid],anchor:__followVisible.anchors[gid]}),gid);
  assert.ok(model.entity&&model.anchor);phases.push({label,at:Date.now(),render:model});await page.screenshot({path:out+'/'+label+'.png'});
 };
 const cleanupFamily=async()=>{
  const capture=await control('capture');captures.push(capture);
  const gids=[...new Set([capture.state.leader,...capture.state.current.actors.map(a=>a.gid)])];
  await control('cleanup');
  await page.waitForFunction(gids=>gids.every(gid=>!__pursuit.entities[gid]&&!globalThis.__followVisible?.anchors[gid]),gids,{timeout:10000});
  phases.push({label:'family-cleanup-observed',at:Date.now(),gids});
 };
 const begin=async()=>{
  const requested=process.env.SRO_FOLLOW_UNIQUE;
  if(requested)assert.match(requested,/^MOB_[A-Z0-9_]+$/);
  const created=await control(requested?'create:'+requested:'create');console.log('[follow] leader',created.leader);
  await page.waitForFunction(gid=>__pursuit.entities[gid]?.kind==='monster',created.leader,{timeout:20000});
  await control('summon');const released=await waitServer(s=>s.current.actors.some(a=>a.summoner===s.leader)&&s.current.actors.some(a=>a.gid===s.leader&&a.actionUntilMs<=s.current.at),'authored-wave-release');
  await page.evaluate(gids=>{globalThis.__followObservedGids=gids;},released.current.actors.map(a=>a.gid));
  const record=await browserRecord();const summonWire=record.events.find(e=>e.kind==='wire'&&e.opcode===0xb245&&e.payload.length>=14&&new DataView(Uint8Array.from(e.payload).buffer).getUint32(6,true)===released.leader);assert.ok(summonWire,'actual summon cast receipt');phases.push({label:'native-summon-cast',wire:summonWire,leader:released.leader,skill:released.skill});
  await page.evaluate(gids=>{globalThis.__followObservedGids=gids;},released.current.actors.map(a=>a.gid));
  await page.waitForFunction(()=>__followObservedGids.some(gid=>globalThis.__followVisible?.anchors[gid]),null,{timeout:15000});
  await waitServer(s=>s.current.actors.some(a=>a.summoner===s.leader&&a.mode==='idle'),'idle-child-admission-window',15000);
  const moving=await control('move-leader');const followed=await waitServer(s=>s.current.actors.some(a=>a.gid===s.child&&a.mode==='following'&&a.to.RegionID!==0&&a.arriveMs>s.current.at),'follow-entry',30000);
  await goalReceipt(followed.child,followed.current.actors.find(a=>a.gid===followed.child).to,moving.current.at);
  const client=await browserRecord();await writeFile(out+'/entry-'+captures.length+'.json',JSON.stringify(client,null,2));assert.ok(movement(client,followed.child).length,'child received actual movement');phases.push({label:'native-follow-goals',child:followed.child,wire:movement(client,followed.child)});
  await visible(followed.child,'follow-entry-'+captures.length);
  await page.waitForFunction(({gid,after})=>{const rows=(globalThis.__followRenderSamples??[]).filter(r=>r.origin+r.at>=after&&r.actors[gid]);if(rows.length<2)return false;const a=rows[0].actors[gid].point,b=rows.at(-1).actors[gid].point;return Math.hypot(a[0]-b[0],a[2]-b[2])>2;},{gid:followed.child,after:followed.current.at},{timeout:5000});
  return {state:followed,started:moving.current.at};
 };
 try{
  await resetMissionMovementFixture({session,characterName:character,timeoutMs:30000,fixture:{id:'summon-follow-field',movementMode:3,start:{regionId:25511,x:1110,y:64,z:1600},startYawRadians:0}});
  ({browser,page}=await launchProbeBrowser());page.on('pageerror',e=>errors.push(e.message));await installFollowRecorder(page);
  console.log('[follow] authenticated boot');await bootPlayableSession(page,character);
  const dead=await page.evaluate(()=>{const g=__playableRuntime.gameplay();return g.vitals.some(v=>v.gid===g.localGid&&v.hp===0)});
  if(dead){
   await page.evaluate(()=>__playableRuntime.session({kind:'gameplay',command:{kind:'rebirth',choice:2}}));
   await page.waitForFunction(()=>{const g=__playableRuntime.gameplay();return g.vitals.some(v=>v.gid===g.localGid&&v.hp>0)},null,{timeout:10000});
   await page.evaluate(()=>__playableRuntime.session({kind:'logout'}));await page.waitForFunction(()=>__playableRuntime.sessionState()?.phase==='signed-out');
   await resetMissionMovementFixture({session,characterName:character,timeoutMs:30000,fixture:{id:'summon-follow-after-rebirth',movementMode:3,start:{regionId:25511,x:1110,y:64,z:1600},startYawRadians:0}});await bootPlayableSession(page,character);
  }
  await page.context().tracing.start({screenshots:true,snapshots:true});
  // Ordinary camera input only; face the fixture on the west side and zoom out.
  await page.mouse.move(350,300);await page.mouse.down({button:'right'});await page.mouse.move(664,340,{steps:20});await page.mouse.up({button:'right'});for(let i=0;i<12;i++){await page.mouse.wheel(0,120);await page.waitForTimeout(40);}
  if(process.env.SRO_CHILD_BUFFS==='1'){
   // Native registration buckets float32 authored thresholds: 60 belongs to
   // the 60..80 bucket, 40 to 40..60. Preserve the production selector.
   for(const [reference,health,skill] of [[14770,70,10495],[14771,70,10498],[14774,50,10507],[14775,70,10510]]){
    await control('restore');
    const created=await control('create:MOB_AM_IVY');
    await page.waitForFunction(gid=>__pursuit.entities[gid]?.kind==='monster',created.leader,{timeout:20000});
    await control('summon:'+health);
    const released=await waitServer(s=>s.current.actors.some(a=>a.summoner===s.leader&&a.reference===reference)&&s.current.actors.some(a=>a.gid===s.leader&&a.actionUntilMs<=s.current.at),'buff-wave-'+reference);
    await page.evaluate(gids=>{globalThis.__followObservedGids=gids;},released.current.actors.map(a=>a.gid));
    const stimulated=await control('buff:'+reference),child=stimulated.child;
    await page.waitForFunction(({child,skill})=>__pursuit.events.some(e=>{if(e.kind!=='wire'||e.opcode!==0xb419||e.payload.length<12)return false;const v=new DataView(Uint8Array.from(e.payload).buffer);return v.getUint32(0,true)===child&&v.getUint32(4,true)===skill;}),{child,skill},{timeout:20000});
    await control('protect');
    const installed=await waitServer(s=>s.current.actors.some(a=>a.gid===child&&a.selfEffects.some(e=>e.SkillID===skill&&e.Token!==0)),'buff-installed-'+skill);
    const effect=installed.current.actors.find(a=>a.gid===child).selfEffects.find(e=>e.SkillID===skill&&e.Token!==0);
    await page.waitForFunction(({child,skill,token})=>__playableRuntime.gameplay().attachedEffects.some(e=>e.gid===child&&e.skill===skill&&e.token===token),{child,skill,token:effect.Token},{timeout:5000});
    const record=await browserRecord();assert.ok(record.events.some(e=>e.kind==='wire'&&e.opcode===0xb245&&e.payload.length>=14&&new DataView(Uint8Array.from(e.payload).buffer).getUint32(2,true)===skill&&new DataView(Uint8Array.from(e.payload).buffer).getUint32(6,true)===child),'production buff cast bracket');
    await page.screenshot({path:out+'/buff-'+skill+'.png'});
    await waitServer(s=>s.current.at>effect.UntilMs&&s.current.actors.some(a=>a.gid===child&&a.selfEffects.every(e=>e.Token!==effect.Token)),'buff-expired-'+skill,12000);
    await page.waitForFunction(token=>__pursuit.events.some(e=>{if(e.kind!=='wire'||e.opcode!==0xb6a0||!e.payload.length)return false;const v=new DataView(Uint8Array.from(e.payload).buffer);for(let i=0;i<e.payload[0];i++){if(v.getUint32(1+i*4,true)===token)return true;}return false;}),effect.Token,{timeout:5000});
    await page.waitForFunction(token=>!__playableRuntime.gameplay().attachedEffects.some(e=>e.token===token),effect.Token,{timeout:5000});
    phases.push({label:'conditional-buff-cast-attach-expire',reference,health,skill,child,effect});
    await cleanupFamily();
   }
  }else{
  let {state}=await begin();const lostChild=state.child;const loss=await control('leader-loss');
  // Native 55A98F..55A991 returns when the controller is absent. It does
  // not unbind FOLLOW or cancel an already accepted movement command.
  const lossTimer=loss.current.actors.find(a=>a.gid===lostChild).Timer0.LastCheckMs;
  await waitServer(s=>s.current.actors.some(a=>a.gid===lostChild&&a.mode==='following'&&a.arriveMs===0&&a.Timer0.LastCheckMs>lossTimer),'leader-loss-steering-suspended',10000);
  await page.waitForFunction(gid=>!__pursuit.entities[gid],state.leader,{timeout:5000});
  await page.waitForFunction(({gid,after})=>__pursuit.events.some(e=>e.kind==='wire'&&e.opcode===0xb2f5&&e.origin+e.wallAt>=after&&e.payload.length>=4&&new DataView(Uint8Array.from(e.payload).buffer).getUint32(0,true)===gid),{gid:lostChild,after:loss.current.at},{timeout:5000});
  await page.screenshot({path:out+'/leader-loss.png'});await cleanupFamily();
  ({state}=await begin());const child=state.child;
  const before=await browserRecord(),previous=movement(before,child).length;
  const refresh=await control('refresh'),oldGoal=refresh.current.actors.find(a=>a.gid===child).to;
  const refreshed=await waitServer(s=>s.current.actors.some(a=>a.gid===child&&a.mode==='following'&&a.arriveMs>s.current.at&&(a.to.X!==oldGoal.X||a.to.Z!==oldGoal.Z)),'moving-leader-refresh');await goalReceipt(child,refreshed.current.actors.find(a=>a.gid===child).to,refresh.current.at);
  await page.waitForFunction(({gid,count})=>__pursuit.events.filter(e=>e.kind==='wire'&&e.opcode===0xb738&&e.payload.length>=4&&new DataView(Uint8Array.from(e.payload).buffer).getUint32(0,true)===gid).length>count,{gid:child,count:previous},{timeout:5000});
  await control('stationary');await new Promise(resolve=>setTimeout(resolve,400));const quietBefore=await control('status'),quietStart=Date.now();await new Promise(resolve=>setTimeout(resolve,600));
  const quiet=await browserRecord();assert.equal(movement(quiet,child,quietStart).length,0,'stationary leader repeated movement goals');assert.ok(quiet.events.filter(e=>e.kind==='clock'&&e.origin+e.wallAt>=quietStart).length>=2,'browser simulation must keep running during silence');const quietServer=await control('status');assert.equal(quietServer.current.actors.find(a=>a.gid===child)?.mode,'following');assert.equal(quietServer.current.actors.find(a=>a.gid===state.leader)?.mode,'idle');assert.deepEqual(quietServer.current.actors.find(a=>a.gid===state.leader)?.pose,quietBefore.current.actors.find(a=>a.gid===state.leader)?.pose);assert.ok(quietServer.current.actors.find(a=>a.gid===child).Timer0.LastCheckMs>quietBefore.current.actors.find(a=>a.gid===child).Timer0.LastCheckMs,'server FOLLOW timer kept ticking');phases.push({label:'stationary-silence',start:quietStart,end:Date.now(),child,server:quietServer});await page.screenshot({path:out+'/stationary.png'});
  const readyToRetaliate=await control('status');assert.equal(readyToRetaliate.current.actors.find(a=>a.gid===child)?.mode,'following','retaliation must interrupt active FOLLOW');const retaliated=await control('retaliate');await waitServer(s=>s.current.actors.some(a=>a.gid===child&&['chasing','attacking','recovering'].includes(a.mode)&&a.target!==0),'retaliation-interruption',5000);
  await page.waitForFunction(({gid,after})=>__pursuit.events.some(e=>e.kind==='wire'&&e.origin+e.wallAt>=after&&((e.opcode===0xb738&&e.payload.length>=4&&new DataView(Uint8Array.from(e.payload).buffer).getUint32(0,true)===gid)||(e.opcode===0xb245&&e.payload.length>=10&&new DataView(Uint8Array.from(e.payload).buffer).getUint32(6,true)===gid))),{gid:child,after:retaliated.current.at},{timeout:5000});
  // Pursuit alone is not a completed retaliation: require the child to reach
  // the player and publish an actual action through the production adapter.
  await page.waitForFunction(({gid,after})=>__pursuit.events.some(e=>e.kind==='wire'&&e.opcode===0xb245&&e.origin+e.wallAt>=after&&e.payload.length>=10&&new DataView(Uint8Array.from(e.payload).buffer).getUint32(6,true)===gid),{gid:child,after:retaliated.current.at},{timeout:15000});
  const retaliationRecord=await browserRecord();
  const attack=retaliationRecord.events.find(e=>e.kind==='wire'&&e.opcode===0xb245&&e.origin+e.wallAt>=retaliated.current.at&&e.payload.length>=10&&new DataView(Uint8Array.from(e.payload).buffer).getUint32(6,true)===child);
  phases.push({label:'retaliation-action-received',at:Date.now(),child,wire:attack});
  await page.screenshot({path:out+'/retaliation.png'});await cleanupFamily();
  }
  assert.deepEqual(errors,[]);
 }catch(error){failure=error;}finally{
  if(page){captures.push(await control('capture').catch(()=>null));await page.screenshot({path:out+'/final.png'}).catch(()=>{});await writeFile(out+'/browser.json',JSON.stringify(await browserRecord().catch(()=>null),null,2));await page.context().tracing.stop({path:out+'/trace.zip'}).catch(()=>{});}
  try{await control('cleanup');}catch(error){cleanupFailure=error;}
  if(page)await page.evaluate(()=>__playableRuntime?.session({kind:'logout'})).catch(()=>{});await browser?.close();
  try{
   await resetMissionMovementFixture({session,characterName:character,timeoutMs:30000,fixture:{id:'restore-summon-follow-origin',movementMode:3,start:original,startYawRadians:original.angle/65535*Math.PI*2}});
   const restored=await readProbeCharacterSpawnFromSession(session,character);
   assert.deepEqual(restored,original,'scratch character position must be restored');
   phases.push({label:'scratch-position-restored',at:Date.now(),restored});
  }catch(error){cleanupFailure??=error;}
  await writeFile(out+'/session.json',JSON.stringify({verdict:failure||cleanupFailure?'FAIL':'PASS SUCCESS',failure:failure?.stack,cleanupFailure:cleanupFailure?.stack,errors,commands,phases,captures},null,2));
 }
 if(failure)throw failure;if(cleanupFailure)throw cleanupFailure;
});
