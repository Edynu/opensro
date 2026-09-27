// Runs through the caller's scratch-account session and normal UI input owner.
export async function probeGuideUi(page,directory){
 const control=id=>page.locator(`[data-ui-id="${id}"]`),rows=[];
 if(!await control('guide-drag').count())await page.keyboard.press('h');
 await control('guide-drag').waitFor({timeout:20000});
 if(!await control('guide-tab:general').count())await control('guide-sidebar').click();
 await control('guide-tab:general').waitFor({timeout:20000});
 await page.screenshot({path:`${directory}/guide-help.png`});
 for(const tab of ['events','quests','general']){
  await page.evaluate(()=>{const samples=[];globalThis.__guideUiSamples=samples;globalThis.__guideUiSampling=true;function tick(){samples.push({present:!!document.querySelector('[data-ui-id="guide-drag"]'),time:performance.now()});if(globalThis.__guideUiSampling)requestAnimationFrame(tick);}requestAnimationFrame(tick);});
  await control('guide-tab:'+tab).click();
  await page.waitForFunction(()=>/UI: 0 pending images; 0 failed images/.test(document.querySelector('output')?.textContent??''));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const samples=await page.evaluate(()=>{globalThis.__guideUiSampling=false;return globalThis.__guideUiSamples;});
  if(samples.some(row=>!row.present))throw Error(`Guide disappeared during ${tab} transition`);
  rows.push({tab,frames:samples.length,missingFrames:samples.filter(row=>!row.present).length});
  await page.screenshot({path:`${directory}/guide-${tab}.png`});
 }
 await control('guide-tab:quests').click();
 await page.waitForFunction(()=>/UI: 0 pending images; 0 failed images/.test(document.querySelector('output')?.textContent??'')&&document.querySelector('[data-ui-id="guide-group:100000"]'));
 const categories=await page.locator('[data-ui-id^="guide-group:"]').count();
 await control('guide-group:100000').click();
 const article=page.locator('[data-ui-id^="guide-article:"]').first();await article.waitFor({timeout:10000});await article.click();
 await page.waitForFunction(()=>/UI: 0 pending images; 0 failed images/.test(document.querySelector('output')?.textContent??''));
 await page.screenshot({path:`${directory}/quest-article.png`});
 const selectedArticle=await article.getAttribute('data-ui-id');
 const labels=await page.locator('[data-ui-id^="guide-tab:"]').allTextContents();
 const bounds=await control('guide-drag').boundingBox();
 await control('close').click();return {rows,labels,bounds,categories,selectedArticle};
}
