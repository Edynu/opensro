import {writeFile} from 'node:fs/promises';
// Scratch-only authenticated profile harness supplies this page. All writes use
// real native controls; the runtime accessor is read-only evidence.
export async function probeParty(page,directory){
 const report={};const read=()=>page.evaluate(()=>({phase:__worldProbeRoot.sessionState().phase,state:__worldProbeRoot.gameplay().partyMatching,error:__worldProbeRoot.gameplay().error}));
 const click=id=>page.locator(`[data-ui-id="${id}"]`).click();
 await page.keyboard.press('KeyE');await page.waitForFunction(()=>__worldProbeRoot.gameplay().partyMatching?.pending===null,null,{timeout:10000});report.before=await read();
 if(report.before.state.own)throw Error('Scratch character already owns a party listing; refusing to replace it');
 try{
  await click('party-match:18');await page.locator('[data-ui-id="party-form-title"]').fill('Party workflow probe');await click('party-form-confirm');
  await page.waitForFunction(()=>__worldProbeRoot.gameplay().partyMatching.own?.title==='Party workflow probe',null,{timeout:10000});report.registered=await read();
  await page.screenshot({path:directory+'/party-registered.png'});
  await click('party-match:19');await page.locator('[data-ui-id="party-form-title"]').fill('Party workflow modified');await click('party-form-confirm');
  await page.waitForFunction(()=>__worldProbeRoot.gameplay().partyMatching.own?.title==='Party workflow modified',null,{timeout:10000});report.modified=await read();
  await click('party-match:56');await page.waitForFunction(()=>!__worldProbeRoot.gameplay().partyMatching.pending,null,{timeout:10000});
  report.refreshed=await read();if(report.refreshed.state.page!==1||!report.refreshed.state.rows.some(r=>r.id===report.registered.state.own.id&&r.title==='Party workflow modified'))throw Error('Listing refresh did not restore own row on first native page');
  await click('party-match:20');await click('party-form-confirm');await page.waitForFunction(()=>!__worldProbeRoot.gameplay().partyMatching.own&&!__worldProbeRoot.gameplay().partyMatching.pending,null,{timeout:10000});report.deleted=await read();
  if(report.deleted.phase!=='world'||report.deleted.error)throw Error('Party workflow left healthy world');report.verdict='PASS';
 }finally{
  const current=await read();if(current.state.own?.id===report.registered?.state.own?.id&&!current.state.pending){await page.keyboard.press('Escape');await page.keyboard.press('KeyE');await page.waitForFunction(()=>!__worldProbeRoot.gameplay().partyMatching.pending,null,{timeout:10000});await click('party-match:20');await click('party-form-confirm');await page.waitForFunction(()=>!__worldProbeRoot.gameplay().partyMatching.own,null,{timeout:10000});}
  await writeFile(directory+'/party.json',JSON.stringify(report,null,2));
 }
 return report;
}
