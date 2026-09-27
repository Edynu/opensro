import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {openProbeAgentSession,readProbeCharacterSpawnFromSession} from '../../../../scripts/lib/probeSession.mjs';
import {resetMissionMovementFixture} from '../../../../scripts/lib/missionMovementFixture.mjs';
import {assertCharacterAllowed} from '../../../../scripts/lib/probeCharacter.mjs';
import {bootPlayableSession} from './helpers/playable-session.mjs';
import {installPursuitRecorder} from './helpers/pursuit-recorder.mjs';

// Diagnostic GID engage enters the same gameplay command as a double click.
// Observe real moving monsters and server replies; never inject movement/damage.
test('live pursuit reaches a walking-away monster before its movement ends',{timeout:180000},async()=>{
 const character=assertCharacterAllowed('asd2',{context:'live moving-target pursuit'}),authority=await openProbeAgentSession();
 const original=await readProbeCharacterSpawnFromSession(authority,character);assert.ok(original);
 const out='temp/artifacts/live-pursuit/'+(process.env.SRO_PURSUIT_CAPTURE??'current');await mkdir(out,{recursive:true});
 await writeFile(out+'/restore.json',JSON.stringify({character,original},null,2));
 let browser,page,primaryFailure,cleanupFailure;const errors=[];
 try{
  await resetMissionMovementFixture({session:authority,characterName:character,timeoutMs:30000,fixture:{id:'pursuit-water-ghost-field',movementMode:3,start:{regionId:25511,x:1110,y:64,z:1800},startYawRadians:0}});
  ({browser,page}=await launchProbeBrowser());page.on('pageerror',e=>errors.push(e.message));
  const instrumentation=await installPursuitRecorder(page);
  console.log('[pursuit] authenticated boot');await bootPlayableSession(page,character);
  assert.ok(instrumentation.core&&instrumentation.motion,'Both owner observations must be installed');
  const revived=await page.evaluate(()=>{const g=__playableRuntime.gameplay();__pursuit.boot=structuredClone({vitals:g.vitals,local:__playableRuntime.entity(g.localGid)});if(g.vitals.some(v=>v.gid===g.localGid&&v.hp===0)){__playableRuntime.session({kind:'gameplay',command:{kind:'rebirth',choice:2}});return true;}return false;});
  await page.waitForFunction(()=>{const g=__playableRuntime.gameplay();return g.vitals.some(v=>v.gid===g.localGid&&v.hp>0);},null,{timeout:10000});
  if(revived){
   // Town rebirth changes the authoritative position. Re-establish the field
   // fixture after its real lifecycle completes, before measuring any pursuit.
   await writeFile(out+'/revival.json',JSON.stringify(await page.evaluate(()=>__pursuit),null,2));
   await page.evaluate(()=>__playableRuntime.session({kind:'logout'}));
   await page.waitForFunction(()=>__playableRuntime.sessionState()?.phase==='signed-out');
   await resetMissionMovementFixture({session:authority,characterName:character,timeoutMs:30000,fixture:{id:'pursuit-after-rebirth',movementMode:3,start:{regionId:25511,x:1110,y:64,z:1800},startYawRadians:0}});
   await bootPlayableSession(page,character);
  }
  assert.equal(await page.evaluate(()=>__playableRuntime.gameplay().pose?.regionId),25511,'Pursuit fixture must survive world admission');
  console.log('[pursuit] approaching one visible resident before measurement');
  await page.waitForFunction(()=>{
   const r=__pursuit,g=__playableRuntime.gameplay(),p=g.pose,visible=globalThis.__pursuitVisible;
   if(!p||!visible||performance.now()-visible.at>250)return false;
   const candidates=Object.values(r.entities).filter(e=>e.kind==='monster'&&e.regionId===p.regionId&&visible.anchors[e.gid]&&e.appearanceState?.[0]!==2).map(e=>({entity:e,distance:Math.hypot(e.x-p.x,e.z-p.z)})).filter(e=>e.distance>20&&e.distance<350).sort((a,b)=>a.distance-b.distance);
   if(!candidates.length)return false;
   r.scout=structuredClone(candidates[0]);return true;
  },null,{timeout:10000});
  await page.evaluate(()=>{
   const r=__pursuit,p=__playableRuntime.gameplay().pose,e=r.scout.entity,distance=Math.hypot(e.x-p.x,e.z-p.z);
   if(distance<=45)return;
   const destination={regionId:p.regionId,x:e.x+(p.x-e.x)*40/distance,y:e.y,z:e.z+(p.z-e.z)*40/distance,angle:p.angle};
   r.setupCommand={kind:'move',destination};__playableRuntime.session({kind:'gameplay',command:r.setupCommand});
  });
  await page.waitForFunction(()=>{const g=__playableRuntime.gameplay();if(g.error)throw Error(g.error);return !__pursuit.setupCommand||g.acknowledgedMove>0&&!g.pendingMoves&&!g.moving;},null,{timeout:15000});
  console.log('[pursuit] waiting for walking-away target');
  await page.waitForFunction(()=>{
   const r=__pursuit,g=__playableRuntime.gameplay(),p=g?.pose;if(!p)return false;
   const now=performance.now();if(r.previousAt&&now-r.previousAt<100)return false;
   const candidates=Object.values(r.entities).filter(e=>e.gid===r.scout.entity.gid&&e.moving&&e.regionId===p.regionId&&e.appearanceState?.[0]!==2);
   for(const e of candidates){
    const prev=r.previous?.[e.gid],distance=Math.hypot(e.x-p.x,e.z-p.z),observation=r.segments[e.gid],local=__playableRuntime.entity(g.localGid);
    const visual=globalThis.__pursuitVisible;
    if(!observation||!local||!r.clock||!visual?.anchors[e.gid]||now-visual.at>250)continue;
    const clockAge=performance.timeOrigin+now-(r.clock.origin+r.clock.wallAt);
    if(clockAge>250)continue;
    const remainingMs=observation.segment.start+observation.segment.duration-(r.clock.at+Math.max(0,clockAge));
    const closingSpeed=(r.localSpeed??0)-(e.walkSpeed??0),interceptMs=closingSpeed>0?distance/closingSpeed*1000:Infinity;
    // Qualify a complete intercept window before issuing exactly one engage.
    // Counting an attack after a naturally finished walk cannot diagnose pursuit.
    if(prev&&distance>20&&distance<180&&remainingMs>interceptMs+750&&(e.x-prev.x)*(e.x-p.x)+(e.z-prev.z)*(e.z-p.z)>0.05){r.target=e.gid;r.initial={at:now,player:p,target:e,distance,remainingMs,interceptMs,segment:observation,visibleModelAnchor:visual.anchors[e.gid]};return true;}
   }
   r.previous=structuredClone(r.entities);r.previousAt=now;return false;
  },null,{timeout:60000});
  await page.evaluate(()=>{__pursuit.started=performance.now();__pursuit.oldTokens=__playableRuntime.gameplay().casts.map(c=>c.token);__playableRuntime.session({kind:'gameplay',command:{kind:'attack',gid:__pursuit.target}});});
  console.log('[pursuit] engage sent; recording range handoff');
  // Consumed native combat packets publish typed casts, not unhandled-native
  // events. Observe the owning adapter output and filter caster/target/token.
  await page.waitForFunction(()=>{const r=__pursuit,at=performance.now(),game=__playableRuntime.gameplay(),target=r.entities[r.target];r.samples.push({at,player:game.pose,target,casts:game.casts});const attack=game.casts.find(c=>c.caster===game.localGid&&c.target===r.target&&!r.oldTokens.includes(c.token));if(attack){r.firstAttack=attack;r.targetAtAttack=target;return true;}return at-r.started>12000;},null,{timeout:15000,polling:50});
  const record=await page.evaluate(()=>__pursuit);assert.ok(record.firstAttack,'No attack within 12 seconds while following');assert.equal(record.targetAtAttack?.moving,true,'Attack waited for the target to stop');
  const castWire=record.events.find(e=>e.kind==='wire'&&e.opcode===0xb245&&e.at===record.firstAttack.receivedAtMs&&e.payload.length>=14&&new DataView(Uint8Array.from(e.payload).buffer).getUint32(10,true)===record.firstAttack.token);
  assert.ok(castWire,'Typed cast must match a received native cast token');
  assert.equal(castWire.targetBefore?.moving,true,'Target stopped before native cast was admitted');
  assert.ok(castWire.at<record.initial.segment.segment.start+record.initial.segment.segment.duration,'Native cast arrived after the original wander deadline');
  assert.deepEqual(errors,[]);
 }catch(error){primaryFailure=error;}finally{
  const record=page?await page.evaluate(()=>__pursuit).catch(()=>null):null;
  if(page){await page.screenshot({path:out+'/mission.png'}).catch(()=>{});await page.evaluate(()=>__playableRuntime?.session({kind:'logout'})).catch(()=>{});}
  await browser?.close();
  try{await resetMissionMovementFixture({session:authority,characterName:character,timeoutMs:30000,fixture:{id:'restore-pursuit-origin',movementMode:3,start:original,startYawRadians:original.angle/65535*Math.PI*2}});}catch(error){cleanupFailure=error;}
  await writeFile(out+'/session.json',JSON.stringify({errors,primaryFailure:String(primaryFailure??''),cleanupFailure:String(cleanupFailure??''),record},null,2));
 }
 if(primaryFailure&&cleanupFailure)throw new AggregateError([primaryFailure,cleanupFailure],'Pursuit and restoration both failed');
 if(primaryFailure)throw primaryFailure;if(cleanupFailure)throw cleanupFailure;
});
