import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {bootPlayableSession} from './helpers/playable-session.mjs';

test('authenticated world starts regional music, returns to title music, and production audio switches city/special tracks',{timeout:180000},async()=>{
 const dir='apps/client-next/temp/artifacts/region-music';await mkdir(dir,{recursive:true});
 const {browser,page}=await launchProbeBrowser();const errors=[],requests=[];let tracing=false;
 page.on('pageerror',e=>errors.push(e.message));page.context().on('request',r=>{if(/\/assets\/audio\/music\//.test(r.url()))requests.push(new URL(r.url()).pathname);});
 try{
  await page.addInitScript(()=>{const NativeAudio=window.Audio;window.__music=[];window.__musicBlobs=new Map();const create=URL.createObjectURL;URL.createObjectURL=function(blob){const url=create.call(URL,blob);__musicBlobs.set(url,blob);return url;};window.Audio=function(...args){const el=new NativeAudio(...args);__music.push(el);return el;};});
  await bootPlayableSession(page,'asd2');await page.context().tracing.start({screenshots:true,snapshots:true});tracing=true;
  if(await page.locator('[data-ui-id="rebirth-point"]').count()){await page.locator('[data-ui-id="rebirth-point"]').click();await page.locator('[data-ui-id="rebirth-point"]').waitFor({state:'detached',timeout:30000});await page.waitForFunction(()=>/Frontend: world\n/.test(document.querySelector('output')?.textContent),null,{timeout:45000});}
  await page.waitForFunction(()=>__music.some(e=>!e.paused&&e.volume>0&&e.currentTime>1)&&document.querySelector('output')?.textContent.includes('music: playing'),null,{timeout:20000});
  const live=await page.evaluate(async()=>{
   const {decodeAudioRegions,ambientProfileName}=await import('/src/engine/foundation/audio/environment.ts');
   const [regions,profiles]=await Promise.all(['/assets/audio/regioninfo.json','/assets/audio/effectenvsnd.json'].map(async p=>(await fetch(p)).json()));
   const pose=__playableRuntime.gameplay().pose,name=ambientProfileName(decodeAudioRegions(regions),pose),profile=profiles.profiles.find(p=>p.name===name);
   const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(n=>n.toString(16).padStart(2,'0')).join('');
   const actual=__music.find(e=>!e.paused);
   return {pose,expected:profile.bgmPublicPath,expectedHash:await hash(await (await fetch(profile.bgmPublicPath)).arrayBuffer()),playingHash:await hash(await __musicBlobs.get(actual.src).arrayBuffer()),media:__music.map(e=>({paused:e.paused,volume:e.volume,time:e.currentTime,error:e.error?.message??null}))};
  });await writeFile(dir+'/incident.json',JSON.stringify({live,requests,errors},null,2));assert.equal(live.playingHash,live.expectedHash);assert.equal(live.media.filter(e=>!e.paused).length,1);assert.ok(live.media.every(e=>!e.error));
  await page.screenshot({path:dir+'/world.png'});
  if(await page.locator('[data-ui-id="rebirth-point"]').count()){await page.locator('[data-ui-id="rebirth-point"]').click();await page.locator('[data-ui-id="rebirth-point"]').waitFor({state:'detached',timeout:30000});await page.waitForFunction(()=>/Frontend: world\n/.test(document.querySelector('output')?.textContent),null,{timeout:45000});}
  await page.keyboard.press('Escape');await page.locator('[data-ui-id="system-restart"]').click();
  await page.waitForFunction(async()=>{if(__playableRuntime.sessionState()?.phase!=='character-select')return false;const el=__music.find(e=>!e.paused&&e.volume>0&&e.currentTime>1);if(!el)return false;const expected=new Uint8Array(await (await fetch('/assets/audio/music/maintheme_cut.mp3')).arrayBuffer()),actual=new Uint8Array(await __musicBlobs.get(el.src).arrayBuffer());return actual.length===expected.length&&actual.every((b,i)=>b===expected[i]);},null,{timeout:30000});
  // City/special branches below use the production audio owner and actual
  // retail assets, with controlled poses. They do not move a live character.
  const transitions=await page.evaluate(async()=>{
   __playableRuntime.dispose();
   const {createAudio}=await import('/src/engine/runtime/audio/audio.ts'),{createAssets}=await import('/src/engine/runtime/assets/assets.ts');
   const {createPresentationRandom}=await import('/src/engine/runtime/random/random.ts');
   const assets=createAssets(),audio=createAudio(assets,location.origin,createPresentationRandom(7));audio.unlock();audio.music(false,true);
   const rows=[];let pose={regionId:169|(97<<8),x:1800,y:0,z:1000,angle:0},mode=0;
   async function waitTrack(suffix){const end=performance.now()+20000;while(performance.now()<end){audio.world(pose,undefined,0,mode);audio.step(performance.now()/1000,[0,0,0]);if(audio.error())throw Error(audio.error());const path=audio.musicSnapshot().path;if(audio.musicStatus()==='playing'&&(suffix==='carol'?/event_carol_0[1-4]\.mp3$/.test(path):path?.endsWith(suffix))){rows.push(audio.musicSnapshot());return;}await new Promise(requestAnimationFrame);}throw Error('Music transition deadline '+JSON.stringify(audio.musicSnapshot()));}
   try{
    await waitTrack('jangan_town.mp3');pose={...pose,regionId:172|(94<<8),x:1000};await waitTrack('jangan_field.mp3');
    mode=1;await waitTrack('carol');mode=2;await waitTrack('shiningstar.mp3');mode=3;await waitTrack('fortress_war.mp3');mode=0;await waitTrack('jangan_field.mp3');
    audio.reset();const end=performance.now()+10000;while(audio.musicSnapshot().fading&&performance.now()<end){audio.step(performance.now()/1000,[0,0,0]);await new Promise(requestAnimationFrame);}rows.push(audio.musicSnapshot());return rows;
   }finally{audio.dispose();assets.dispose();}
  });
  assert.equal(transitions.length,7);assert.equal(transitions[0].loop,true);assert.ok(transitions.slice(2,5).every(t=>!t.loop));assert.equal(transitions[6].path,null);assert.deepEqual(errors,[]);
  await writeFile(dir+'/incident.json',JSON.stringify({live,transitions,requests,errors},null,2));
 }finally{try{if(tracing)await page.context().tracing.stop({path:dir+'/trace.zip'});}finally{await browser.close();}}
});
