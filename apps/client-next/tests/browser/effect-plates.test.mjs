import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';

test('published plate effect remains visible through camera rotation and expires',{timeout:60000},async()=>{
 const {browser,page}=await launchProbeBrowser();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createAssets}=await import('/src/engine/runtime/assets/assets.ts');
   const {assetRequestBudget}=await import('/src/engine/foundation/assets/asset-budget.ts');
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const assets=createAssets(),canvas=document.createElement('canvas');document.body.append(canvas);const renderer=createRenderer(canvas);
   const output=document.createElement('canvas');output.width=output.height=192;const context=output.getContext('2d');
   const path='/assets/effects/programs.json#system%2Fsystem_untouchable.efp';
   try{
    const id=assets.request(new URL(path,location.origin).href,assetRequestBudget('effect'),'effect'),deadline=performance.now()+30000;let decoded;
    while(!(decoded=assets.take(id))){if(performance.now()>deadline)throw new Error('Effect admission deadline');await new Promise(requestAnimationFrame);}
    if(decoded.kind!=='character')throw new Error(decoded.error??'Unexpected effect result');
    const primitives=decoded.model.primitives.length,billboards=decoded.model.primitives.filter(p=>p.billboard==='camera').length;
    renderer.setCharacterModel(path,decoded.model,decoded.images);renderer.setWorld({id:'plate',originRegion:257,warnings:[],groups:[]});
    const actor={gid:1,model:path,pose:{regionId:257,x:0,y:0,z:0,yaw:1},clip:'effect',time:.2,loop:false,scale:1};
    async function sample(eye,actors){
     renderer.setWorldCamera({originRegion:257,eye,target:[0,0,0],fov:1,near:.1,far:500});renderer.setCharacterActors(actors);
     for(let i=0;i<120;i++){renderer.frame({width:192,height:192},0);if(renderer.error())throw new Error(renderer.error());if(renderer.phase()==='running')break;await new Promise(requestAnimationFrame);}
     await new Promise(requestAnimationFrame);renderer.frame({width:192,height:192},0);
     const bitmap=await createImageBitmap(canvas);context.drawImage(bitmap,0,0);bitmap.close();return {pixels:[...context.getImageData(0,0,192,192).data],png:output.toDataURL()};
    }
    const before=await sample([0,0,-100],[]),front=await sample([0,0,-100],[actor]),side=await sample([100,0,0],[actor]),expired=await sample([100,0,0],[{...actor,time:3}]);
    const paired=await sample([0,0,-100],[{...actor,time:3},{...actor,gid:2}]);
    const difference=(a,b)=>a.pixels.reduce((n,v,i)=>n+Number(v!==b.pixels[i]),0);
    return {primitives,billboards,independentAgeDifference:difference(paired,front),frontChanged:difference(front,before),sideChanged:difference(side,before),orbitDifference:difference(front,side),expiredDifference:difference(expired,before),images:{before:before.png,front:front.png,side:side.png,expired:expired.png,paired:paired.png}};
   }finally{renderer.dispose();assets.dispose();canvas.remove();}
  });
  const output='temp/artifacts/bugs/effect-plates';await mkdir(output,{recursive:true});
  for(const [name,png] of Object.entries(result.images))await writeFile(`${output}/${name}.png`,Buffer.from(png.split(',')[1],'base64'));
  const {images,...report}=result;await writeFile(`${output}/result.json`,JSON.stringify({...report,errors},null,2)+'\n');
  assert.deepEqual(errors,[]);assert.equal(result.primitives,1);assert.equal(result.billboards,1);
  assert.ok(result.frontChanged>100);assert.ok(result.sideChanged>100);
  assert.equal(result.independentAgeDifference,0,'An expired first instance must not hide a younger instance in the same draw');
  assert.ok(result.orbitDifference<result.frontChanged*.05,JSON.stringify(report));assert.equal(result.expiredDifference,0);
 }finally{await browser.close();}
});
