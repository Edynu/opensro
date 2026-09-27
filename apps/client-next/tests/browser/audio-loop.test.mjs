import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';

test('bounded loop endpoint preserves PCM across buffer lengths, sample rates and retail wind files',{timeout:60000},async()=>{
 const {browser,page}=await launchProbeBrowser();
 try{
  await page.route(CLIENT_NEXT_BASE_URL+'/audio-lab.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>audio lab</title>'}));
  await page.goto(CLIENT_NEXT_BASE_URL+'/audio-lab.html');
  const rows=await page.evaluate(async()=>{
   const {audioLoopEnd}=await import('/src/engine/foundation/audio/loop.ts'),rows=[];
   async function render(buffer,label,iterations=4){
    const ctx=new OfflineAudioContext(buffer.numberOfChannels,buffer.length*iterations,buffer.sampleRate),source=ctx.createBufferSource();
    source.buffer=buffer;source.loop=true;source.loopEnd=audioLoopEnd(buffer.length,buffer.sampleRate);source.connect(ctx.destination);source.start(0);
    const output=await ctx.startRendering();let maxError=0;
    for(let c=0;c<buffer.numberOfChannels;c++){const expected=buffer.getChannelData(c),actual=output.getChannelData(c);for(let i=0;i<actual.length;i++){const error=Math.abs(actual[i]-expected[i%buffer.length]);maxError=Math.max(maxError,error);}}
    rows.push({label,rate:buffer.sampleRate,length:buffer.length,channels:buffer.numberOfChannels,iterations,maxError});
   }
   for(const rate of [22050,44100,48000,96000])for(const length of [1,67,128,129,1486,65201,443526]){
    const buffer=new AudioBuffer({numberOfChannels:2,length,sampleRate:rate});let seed=7;
    for(let c=0;c<2;c++){const pcm=buffer.getChannelData(c);for(let i=0;i<length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pcm[i]=seed/0x100000000-.5;}}
    await render(buffer,'synthetic');
   }
   for(const rate of [44100,48000,96000]){
    const decoder=new OfflineAudioContext(1,1,rate);
    for(const file of ['night_wind.wav','day_wind.wav','dd_mainwind.wav','sea_wave1.wav']){
     const response=await fetch('/assets/audio/sfx/prim/snd/env/'+file);if(!response.ok)throw Error('Missing retail loop '+file);
     await render(await decoder.decodeAudioData(await response.arrayBuffer()),file);
    }
   }
   return rows;
  });
  await mkdir('temp/artifacts/audio-beep',{recursive:true});await writeFile('temp/artifacts/audio-beep/loop-pcm-parity.json',JSON.stringify({browser:browser.version(),rows},null,2));
  assert.equal(rows.length,40);for(const row of rows)assert.ok(row.maxError<1e-6,JSON.stringify(row));
 }finally{await browser.close();}
});

test('production night ambience advances across three wraps and stops on reset',{timeout:60000},async()=>{
 const {browser,page}=await launchProbeBrowser({extraBrowserArgs:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
 try{
  await page.route(CLIENT_NEXT_BASE_URL+'/audio-lab.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>audio lab</title>'}));
  await page.goto(CLIENT_NEXT_BASE_URL+'/audio-lab.html');
  const result=await page.evaluate(async()=>{
   const {createAssets}=await import('/src/engine/runtime/assets/assets.ts');
   const {createAudio}=await import('/src/engine/runtime/audio/audio.ts');
   const {createPresentationRandom}=await import('/src/engine/runtime/random/random.ts');
   const originalStart=AudioBufferSourceNode.prototype.start,loops=[];
   AudioBufferSourceNode.prototype.start=function(...args){
    if(this.loop){const analyser=this.context.createAnalyser();analyser.fftSize=2048;this.connect(analyser);loops.push({source:this,analyser,started:this.context.currentTime,ended:false});this.addEventListener('ended',()=>loops.find(l=>l.source===this).ended=true);}
    return originalStart.apply(this,args);
   };
   const assets=createAssets(),audio=createAudio(assets,location.origin+'/',createPresentationRandom(7),Math.trunc(performance.now())>>>0);
   const samples=[],deadline=performance.now()+45000;let bucket=-1;
   try{
    audio.unlock();
    while(true){
     const now=performance.now();if(now>deadline)throw Error('Night loop did not complete three cycles before deadline');
     audio.world({regionId:165|(97<<8),x:960,y:0,z:960,angle:0},{day:0,hour:22,minute:0,receivedAtMs:0},0);
     audio.step(now/1000,[317760,60,187120]);
     const loop=loops[0];
     if(loop){
      const elapsed=loop.source.context.currentTime-loop.started,currentBucket=Math.floor(elapsed*10);
      if(currentBucket!==bucket){
       bucket=currentBucket;const pcm=new Float32Array(loop.analyser.fftSize);loop.analyser.getFloatTimeDomainData(pcm);
       let power=0,difference=0;for(let i=128;i<pcm.length;i++){power+=pcm[i]**2;difference+=(pcm[i]-pcm[i-128])**2;}
       samples.push({elapsed,rms:Math.sqrt(power/(pcm.length-128)),repeatError:power?difference/power:0});
      }
      if(elapsed>loop.source.buffer.duration*3+.2)break;
     }
     await new Promise(requestAnimationFrame);
    }
    audio.reset();audio.world(null,undefined,0);
    const endDeadline=performance.now()+2000;
    while(!loops.every(l=>l.ended)){if(performance.now()>endDeadline)throw Error('Reset did not stop loop');await new Promise(requestAnimationFrame);}
    return {error:audio.error(),samples,loops:loops.map(l=>({length:l.source.buffer.length,rate:l.source.buffer.sampleRate,duration:l.source.buffer.duration,loopEnd:l.source.loopEnd,ended:l.ended}))};
   }finally{audio.dispose();assets.dispose();AudioBufferSourceNode.prototype.start=originalStart;}
  });
  await mkdir('temp/artifacts/audio-beep',{recursive:true});
  await writeFile('temp/artifacts/audio-beep/production-loop.json',JSON.stringify({browser:browser.version(),...result},null,2));
  assert.equal(result.error,null);assert.equal(result.loops.length,1);
  assert.equal(result.loops[0].ended,true);
  const afterWrap=result.samples.filter(s=>s.elapsed>result.loops[0].duration+.1);
  assert.ok(afterWrap.length>50,'must measure actual output well beyond the first wrap');
  assert.ok(afterWrap.every(s=>s.rms>1e-5),'wind must stay audible');
  assert.ok(afterWrap.every(s=>s.repeatError>.01),'wind must not repeat one render quantum as a continuous beep');
 }finally{await browser.close();}
});
