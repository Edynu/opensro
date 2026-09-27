import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
test('all six published absorption effects render and retire through the real GPU owner',{timeout:90000},async()=>{
 const {browser,page}=await launchProbeBrowser(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createAssets}=await import('/src/engine/runtime/assets/assets.ts'),{createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const assets=createAssets(),canvas=document.createElement('canvas');document.body.append(canvas);const renderer=createRenderer(canvas),output=document.createElement('canvas');output.width=output.height=192;const context=output.getContext('2d');
   const rows=[];
   try{
    renderer.setWorld({id:'orbs',originRegion:257,warnings:[],groups:[]});renderer.setWorldCamera({originRegion:257,eye:[0,0,-12],target:[0,0,0],fov:1,near:.1,far:100});
    async function sample(actors){renderer.setCharacterActors(actors);for(let i=0;i<120;i++){renderer.frame({width:192,height:192},0);if(renderer.error())throw Error(renderer.error());if(renderer.phase()==='running')break;await new Promise(requestAnimationFrame);}await new Promise(requestAnimationFrame);renderer.frame({width:192,height:192},0);const bitmap=await createImageBitmap(canvas);context.drawImage(bitmap,0,0);bitmap.close();return {pixels:[...context.getImageData(0,0,192,192).data],png:output.toDataURL()};}
    const empty=await sample([]),difference=(a,b)=>a.pixels.reduce((n,v,i)=>n+Number(v!==b.pixels[i]),0);
    for(const name of ['hwan_g','hwan_y','hwan_v','hwn_blue_indraft','hwn_red_indraft','hwn_violet_indraft']){
     const path='/assets/effects/programs.json#'+encodeURIComponent('battle/'+name+'.efp'),request=assets.request(new URL(path,location.origin).href,32<<20,'effect');let decoded;const deadline=performance.now()+30000;
     while(!(decoded=assets.take(request))){if(performance.now()>deadline)throw Error('Orb admission deadline');await new Promise(requestAnimationFrame);}if(decoded.kind!=='character')throw Error(decoded.error??'Orb decode failed');
     renderer.setCharacterModel(path,decoded.model,decoded.images);const actor={gid:1,model:path,pose:{regionId:257,x:0,y:0,z:0,yaw:0},clip:'effect',time:0,loop:false,scale:1};
     let visible;for(let n=0;n<5;n++)visible=await sample([{...actor,time:n*.05,pose:{...actor.pose,x:n*.3-1}}]);
     if(name==='hwan_g'){
      const trail=path+':trail';
      // Isolate linked geometry from the bright central plates. It uses the
      // renderer's white fallback so texture residency cannot mask geometry bugs.
      renderer.setCharacterModel(trail,{...decoded.model,primitives:decoded.model.primitives.filter(p=>p.ribbon).map(p=>({...p,image:-1})),images:[]},[]);
      let ribbon;for(let n=0;n<5;n++)ribbon=await sample([{...actor,model:trail,time:n*.05,pose:{...actor.pose,x:n-2}}]);
      if(difference(ribbon,empty)<10)throw Error('Linked trail produced no pixels');
     }
     const expired=await sample([{...actor,time:decoded.model.clips[0].duration+.1}]);
     rows.push({name,changed:difference(visible,empty),expired:difference(expired,empty),png:visible.png});await sample([]);
    }return rows;
   }finally{renderer.dispose();assets.dispose();canvas.remove();}
  });
  await mkdir('temp/artifacts/bugs/absorption-orbs',{recursive:true});for(const row of result)await writeFile('temp/artifacts/bugs/absorption-orbs/'+row.name+'.png',Buffer.from(row.png.split(',')[1],'base64'));
  await writeFile('temp/artifacts/bugs/absorption-orbs/result.json',JSON.stringify({errors,rows:result.map(({png,...row})=>row)},null,2));
  assert.deepEqual(errors,[]);for(const row of result){assert.ok(row.changed>10,row.name+' must produce pixels');assert.equal(row.expired,0,row.name+' must retire');}
 }finally{await browser.close();}
});
