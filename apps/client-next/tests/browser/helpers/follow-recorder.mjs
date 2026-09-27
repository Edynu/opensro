import assert from 'node:assert/strict';
import {installPursuitRecorder} from './pursuit-recorder.mjs';

// The normal label projection only visits actors whose names the HUD shows.
// Project the bounded fixture identities too, retain diagnostic anchors, then
// restore exactly the originally requested result. No draw, actor or packet
// state is changed; hidden monster-name preferences cannot hide the evidence.
export async function installFollowRecorder(page){
 const instrumentation=await installPursuitRecorder(page,[0xb419,0xb6a0]);
	await page.route('**/runtime/input/input.ts*',async route=>{
	 const response=await route.fetch(),body=await response.text(),camera=/return \{\s*yaw,\s*pitch,\s*distance\s*\};/;
	 assert.match(body,camera,'camera observation owner changed');
	 await route.fulfill({response,body:body.replace(camera,'globalThis.__followCamera={yaw,pitch,distance}; $&')});
	});
 await page.route('**/renderer/characters/characters.ts*',async route=>{
  const response=await route.fetch(),body=await response.text();
  const method=/(labelAnchors\(origin,\s*view,\s*width,\s*height,\s*gids\)\s*\{[\s\S]*?)(return result;)/;
  assert.match(body,method,'fixture projection owner changed');
  const observed=body.replace(method,(_match,code)=>{
   assert.match(code,/for\s*\(const gid of gids\)/,'projection iterator changed');
   let instrumented=code.replace(/for\s*\(const gid of gids\)/,'const diagnostics={}; for (const gid of new Set([...gids,...(globalThis.__followObservedGids??[])]))');
   // Renderer poses are mutable owner objects: observations must copy values.
   instrumented=instrumented.replace('const actor = rows.get(gid);','const actor = rows.get(gid); const diagnostic=diagnostics[gid]={actor:!!actor,pose:actor?{...actor.pose}:null,model:actor?.model};');
   instrumented=instrumented.replace('const resource = models.get(body.model);','const resource = models.get(body.model); diagnostic.loaded=!!resource;');
   instrumented=instrumented.replace('const w = clip[3];','diagnostic.clip=clip; diagnostic.point=[x,y,z]; const w = clip[3];');
   assert.match(instrumented,/diagnostic.clip=clip/,'projection diagnostics owner changed');
   return instrumented+`
    const stamp=performance.now();
    globalThis.__followVisible={at:stamp,anchors:Object.fromEntries(result),diagnostics};
    const samples=globalThis.__followRenderSamples??=[];
    if(stamp-(samples.at(-1)?.at??-1000)>=100){
      const actors={};for(const gid of globalThis.__followObservedGids??[]){
        if(result.has(gid))actors[gid]={anchor:result.get(gid),...diagnostics[gid]};
      }
      samples.push({at:stamp,origin:performance.timeOrigin,actors});if(samples.length>2000)samples.shift();
    }
    for(const gid of result.keys())if(!gids.has(gid))result.delete(gid); return result;`;
  });
  await route.fulfill({response,body:observed});
 });
 return instrumentation;
}
