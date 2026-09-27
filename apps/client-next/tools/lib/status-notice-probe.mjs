import {writeFile} from 'node:fs/promises';
// Synthetic notices at the UiView boundary, in an isolated release build only.
// Packet decoding is covered separately; this does not pretend to be a live spawn.
export async function probeStatusNotices(page,directory){
 const rows=[];
 for(let repeat=0;repeat<2;repeat++)for(const [name,key,nativeType,args,bannerOnly] of [
  ['unique','UIIT_MSG_APPEAR_UNIC',0,['Cerberus']],
  ['ch-armor','UIIT_MSG_STRGERR_CANT_MIX_EXCLUSIVE_ARMOR_TYPE',5],
  ['eu-armor','UIIT_MSG_STRGERR_EU_CANT_MIX_EXCLUSIVE_ARMOR_TYPE',5],
  ['insufficient-mp','UIIT_SKILL_USE_FAIL_NOTENOUGHMP',0,undefined,true],
 ]){
  await page.evaluate(({key,nativeType,args,sequence,bannerOnly})=>{globalThis.__worldProbeUiProducts.start();globalThis.__statusNoticeProbe=[{key,nativeType,arguments:args,sequence,value:0,...(bannerOnly?{banner:true,bannerOnly:true}:{})}];},{key,nativeType,args,bannerOnly,sequence:1000000+rows.length});
  await page.waitForFunction(()=>globalThis.__worldProbeUiProducts.stats().products.length>0,null,{timeout:15000});
  await page.waitForTimeout(300);
  const state=await page.evaluate(()=>({products:globalThis.__worldProbeUiProducts.stats(),ui:globalThis.__worldProbeUiStats(),phase:globalThis.__worldProbeRoot.sessionState()?.phase}));
  if(state.phase!=='world'||state.ui.error||state.products.truncated)throw Error('Status presentation failed: '+JSON.stringify(state.ui));
  await page.screenshot({path:`${directory}/status-${repeat}-${name}.png`});rows.push({repeat,name,...state});
 }
 await page.evaluate(()=>{delete globalThis.__statusNoticeProbe;globalThis.__worldProbeUiProducts.pause();});
 await writeFile(directory+'/status-notices.json',JSON.stringify({scope:'Synthetic notice presentation in authenticated scratch world',rows}));
 return {captures:rows.length,scope:'Synthetic presentation; not server packet injection'};
}
