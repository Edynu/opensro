import {writeFile} from 'node:fs/promises';
// Read-only visual audit: opens owned windows on the authenticated scratch session.
export async function probeUiWindows(page,directory){
 const rows=[];
 for(const [key,panel] of [['KeyI','Inventory'],['KeyC','Character'],['KeyS','Skills'],['KeyA','Actions'],['KeyP','Party'],['KeyQ','Quests']]){
  console.log('ui-window:'+panel);await page.keyboard.press(key);
  await page.waitForFunction(panel=>{const s=globalThis.__worldProbeUiStats?.();return s?.panel===panel&&!s.windowMissing?.length&&s.windowReady;},panel,{timeout:15000});
  await page.waitForTimeout(300);
  const state=await page.evaluate(()=>({ui:globalThis.__worldProbeUiStats?.(),phase:globalThis.__worldProbeRoot.sessionState()?.phase,controls:[...document.querySelectorAll('[data-ui-id]')].map(n=>({id:n.getAttribute('data-ui-id'),text:n.textContent,rect:n.getBoundingClientRect().toJSON()}))}));
  if(state.phase!=='world'||state.ui.error)throw Error('UI audit owner failed: '+JSON.stringify(state));
  await page.screenshot({path:directory+'/ui-'+panel.toLowerCase()+'.png'});rows.push({panel,...state});await page.keyboard.press(key);
 }
 await writeFile(directory+'/ui-windows.json',JSON.stringify({verdict:'CAPTURED',rows},null,2));return rows.map(row=>({panel:row.panel,error:row.ui.error}));
}
