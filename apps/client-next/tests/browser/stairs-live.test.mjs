import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {openProbeAgentSession,fetchProbeSessionJson,readProbeCharacterSpawnFromSession} from '../../../../scripts/lib/probeSession.mjs';
import {resetMissionMovementFixture} from '../../../../scripts/lib/missionMovementFixture.mjs';
import {bootPlayableSession} from './helpers/playable-session.mjs';

test('persisted Constantinople stair stand survives login and permits descent',{timeout:180000},async()=>{
 const character='asd2',out='temp/artifacts/stairs-ui/live-'+(process.env.SRO_STAIR_CAPTURE??'current');await mkdir(out,{recursive:true});
 const session=await openProbeAgentSession(),original=await readProbeCharacterSpawnFromSession(session,character);
 assert.ok(original,'scratch spawn must exist before preserving it');
 const list=await fetchProbeSessionJson(session,'/character/list'),mode=list.characters.find(c=>c.name===character)?.world?.movementMode??1;
 const reset=async(spawn,id,movementMode=1)=>resetMissionMovementFixture({session,characterName:character,timeoutMs:30000,fixture:{id,movementMode,start:spawn,startYawRadians:spawn.angle/65535*Math.PI*2,startToleranceNative:.01},onLog:console.log});
 const start={regionId:0x6046,x:920,y:1124.1568906758841,z:610,angle:32767};
 const report={original,start,stages:[],wire:[]};let browser,page,failure;
 try{
  await reset(start,'stair-descent-audit');({browser,page}=await launchProbeBrowser());
  page.on('console',message=>{const text=message.text();if(text.startsWith('[stairs-wire]'))report.wire.push(JSON.parse(text.slice(13)));});
  // Read-only observation at the real socket boundary; only movement frames
  // are retained, never HELLO/admission credentials. No packet is substituted.
  await page.route('**/runtime/simulation/worker/network/network.ts*',async route=>{
   const response=await route.fetch();let body=await response.text();
   const inbound='const frame = codec.decode(new Uint8Array(event.data));',outbound='socket.send(encoded);';
   assert.ok(body.includes(inbound)&&body.includes(outbound),'network observation anchors changed');
   const observe=direction=>`if([9,10,0x7021,0xb738,0xb2f5].includes(frame.opcode))console.log('[stairs-wire]'+JSON.stringify({direction:'${direction}',at:performance.now(),opcode:frame.opcode,payload:Array.from(frame.payload)}));`;
   body=body.replace(inbound,inbound+observe('receive')).replace(outbound,outbound+observe('send'));
   await route.fulfill({response,body,contentType:'application/javascript'});
  });
  await page.addInitScript(()=>{const Base=window.Worker;window.__stairs={game:{},samples:[]};window.Worker=class extends Base{constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.kind==='world')for(const e of data.batch.events)if(e.kind==='gameplay'){Object.assign(__stairs.game,e.state);if(e.state.pose)__stairs.samples.push({time:performance.now(),pose:e.state.pose,owner:e.state.navigationOwner,ack:e.state.acknowledgedMove,error:e.state.error});}});}};});
  console.log('[stairs] authenticated boot');await bootPlayableSession(page,character);
  await page.context().tracing.start({screenshots:true,snapshots:true});
  const entered=await page.evaluate(()=>__stairs.game);report.stages.push({phase:'entered',game:entered});
  await page.screenshot({path:out+'/entered.png'});
  assert.ok(Math.abs(entered.pose.y-start.y)<.1,'login must retain the authored stair surface: '+JSON.stringify(entered.pose));
  const move=async(destination,phase)=>{
   const ack=await page.evaluate(()=>__stairs.game.acknowledgedMove??0),first=report.wire.length;
   await page.evaluate(destination=>__playableRuntime.session({kind:'gameplay',command:{kind:'move',destination}}),destination);
   await page.waitForFunction(ack=>__stairs.game.acknowledgedMove>ack,ack,{timeout:10000});
   await page.waitForFunction(destination=>!__stairs.game.moving&&Math.abs(__stairs.game.pose.z-destination.z)<.1&&__stairs.game.pendingMoves===0,destination,{timeout:15000});
   const game=await page.evaluate(()=>__stairs.game);report.stages.push({phase,game,wireStart:first,wireEnd:report.wire.length});
   assert.equal(game.error,null);assert.ok(Math.abs(game.pose.y-destination.y)<.1,phase+' surface height');assert.ok(game.navigationOwner,phase+' retained mesh owner');
   const frames=report.wire.slice(first),receipts=frames.filter(f=>f.direction==='receive'&&f.opcode===10).map(f=>JSON.parse(Buffer.from(f.payload).toString()));
   assert.ok(receipts.some(r=>r.accepted&&Math.abs(r.world.spawn.z-destination.z)<.1),'server accepted requested endpoint');
   // This connection's production move protocol is request 9 / receipt 10.
   // B738 is broadcast to peer viewers, so local acceptance cannot attest it.
   assert.ok(frames.some(f=>f.direction==='send'&&f.opcode===9),'actual movement request reached socket');
   await page.screenshot({path:out+'/'+phase+'.png'});
  };
  await move({...start,y:1090.5145930961428,z:670},'descended');
  await move(start,'ascended');
  // Fresh authenticated admission exercises persistence and spawn repair again.
  await page.evaluate(()=>__playableRuntime.session({kind:'logout'}));await page.waitForFunction(()=>__playableRuntime.sessionState()?.phase==='signed-out');
  await bootPlayableSession(page,character);
  const reentered=await page.evaluate(()=>__stairs.game);report.stages.push({phase:'reentered',game:reentered});
  assert.ok(Math.abs(reentered.pose.y-start.y)<.1);assert.ok(Math.abs(reentered.pose.z-start.z)<.1);
  await move({...start,y:1090.5145930961428,z:670},'descended-after-reload');
 }catch(error){failure=error;}
 finally{
  if(page){report.observed=await page.evaluate(()=>__stairs).catch(()=>null);await page.screenshot({path:out+'/final.png'}).catch(()=>{});await page.context().tracing.stop({path:out+'/trace.zip'}).catch(()=>{});await page.evaluate(()=>__playableRuntime.session({kind:'logout'})).catch(()=>{});await page.waitForFunction(()=>__playableRuntime.sessionState()?.phase==='signed-out',null,{timeout:10000}).catch(()=>{});}
  if(browser)await browser.close();
  try{report.restored=await reset(original,'stair-audit-restore',mode);}catch(error){failure??=error;report.restoreError=String(error);}
  await writeFile(out+'/incident.json',JSON.stringify({...report,verdict:failure?'FAIL':'PASS SUCCESS',failure:failure?.stack},null,2));
 }
 if(failure)throw failure;
});
