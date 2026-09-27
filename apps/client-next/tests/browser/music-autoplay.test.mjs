import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';

for(const allowed of [false,true])test(`title music ${allowed?'autoplays when permitted':'recovers from autoplay denial on a real gesture'}`,{timeout:60000},async()=>{
 const {browser,page}=await launchProbeBrowser({extraBrowserArgs:[`--autoplay-policy=${allowed?'no-user-gesture-required':'document-user-activation-required'}`]});
 try{
  await holdProbeRuntime(page);
  await page.addInitScript(()=>{
   globalThis.musicProbe={element:null,attempts:0,denials:0};
   const play=HTMLMediaElement.prototype.play;
   HTMLMediaElement.prototype.play=function(){const probe=globalThis.musicProbe;probe.element=this;probe.attempts++;return play.call(this).catch(error=>{if(error.name==='NotAllowedError')probe.denials++;throw error;});};
  });
  await page.goto(CLIENT_NEXT_BASE_URL);
  const cdp=await page.context().newCDPSession(page);
  // Ordinary Playwright evaluation grants transient activation in Chromium.
  // Every script here explicitly disables it, including read-only polling.
  const inspect=async waiting=>{
   const result=await cdp.send('Runtime.evaluate',{userGesture:false,awaitPromise:true,returnByValue:true,expression:`(async()=>{
    const deadline=performance.now()+30000;
    while(performance.now()<deadline){
     const probe=globalThis.musicProbe,e=probe?.element;
     if(e&&e.volume>0&&${waiting?'probe.denials>0&&e.paused':'!e.paused&&e.currentTime>.1'})return {paused:e.paused,time:e.currentTime,volume:e.volume,active:navigator.userActivation.hasBeenActive,attempts:probe.attempts,denials:probe.denials};
     await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw Error('Music did not reach expected playback state: '+document.querySelector('output')?.textContent);
   })()`});
   assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));return result.result.value;
  };
  const before=await inspect(!allowed);assert.equal(before.active,false);
  if(allowed){assert.equal(before.paused,false);assert.equal(before.denials,0);assert.equal(before.volume,Math.pow(10,-.7));}
  else{assert.equal(before.paused,true);assert.ok(before.denials>0);await page.mouse.click(4,4);const after=await inspect(false);assert.equal(after.active,true);assert.equal(after.paused,false);assert.equal(after.volume,Math.pow(10,-.7));}
 }finally{await browser.close();}
});
