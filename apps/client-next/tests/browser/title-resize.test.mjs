import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';

test('resizing preserves plain retail title bars and the fitted server hit targets',{timeout:90000},async()=>{
 const {browser,page}=await launchProbeBrowser({viewport:{width:1024,height:768}});
 const failures=[],results=[];page.on('pageerror',e=>failures.push(e.message));
 const control=id=>page.locator(`[data-ui-id="${id}"]`);
 await mkdir('temp/artifacts/title-resize',{recursive:true});
 try{
  await page.goto(CLIENT_NEXT_BASE_URL);await control('frontend:reveal').click({timeout:30000});await control('account').waitFor({timeout:15000});
  await page.waitForFunction(()=>/UI: 0 pending images; 0 failed images/.test(document.querySelector('output')?.textContent));
  await control('account').fill('resize-probe');
  for(const [width,height]of [[497,741],[2240,900],[900,360],[320,700],[1024,768]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(750);
   assert.equal(await control('account').inputValue(),'resize-probe');
   const shot=await page.screenshot({path:`temp/artifacts/title-resize/${width}x${height}.png`});
   const badge=await page.evaluate(async({png,width,height})=>{
    const b=await createImageBitmap(await(await fetch('data:image/png;base64,'+png)).blob());const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');ctx.drawImage(b,0,0);b.close();
    const data=ctx.getImageData(0,0,width,height).data;let x0=width,y0=height,x1=0,y1=0,count=0;
    for(let y=0;y<height*150/1200;y++)for(let x=Math.floor(width*.55);x<width;x++){const i=(y*width+x)*4;if(data[i]>210&&data[i+1]>170&&data[i+2]<30){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);count++;}}
    return {width:x1-x0+1,height:y1-y0+1,count};
   },{png:shot.toString('base64'),width,height});
   assert.equal(badge.count,0,`Unexpected Korean rating badge at ${width}x${height}`);
   const boxes=[];for(const id of ['account','password','native:servers','login','logout']){const box=await control(id).boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=height,`${id} outside resized viewport`);boxes.push(box);}
   const connect=boxes[3];assert.ok(Math.abs(connect.width/connect.height-91/41)<.001,'Button scales uniformly');
   await control('native:servers').click();await control('native:server-cancel').waitFor();await page.waitForTimeout(550);
   const cancel=await control('native:server-cancel').boundingBox();assert.ok(cancel.y+cancel.height<height);
   await control('native:server-cancel').click();await control('account').waitFor();
   results.push({width,height,badge,connect,cancel});
  }
  assert.deepEqual(failures,[]);await writeFile('temp/artifacts/title-resize/result.json',JSON.stringify({verdict:'PASS',results,failures},null,2));
 }finally{await browser.close();}
});
