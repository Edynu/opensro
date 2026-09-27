import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
// Optional frozen admission oracle for controlled baseline/candidate tests.
// Reuses the test's owned page; no alternate browser or server is created.
export async function uiAdmissionReference(page){
 const file=process.env.SRO_UI_ADMISSION_REFERENCE;if(!file)return async()=>{};
 const source=await readFile(file,'utf8');
 if(!source.includes('export function prepareUi(')||source.includes('createUiPreparation'))throw Error('Expected pre-retention UI admission source');
 const {code}=await transform(source+'\nexport function createUiPreparation(){return {prepare:scene=>{globalThis.__uiReferenceAdmissions=(globalThis.__uiReferenceAdmissions??0)+1;return scene?prepareUi(scene):null;},reset(){}};}',{loader:'ts',format:'esm'});
 await page.route('**/src/engine/foundation/ui/ui.ts*',route=>route.fulfill({status:200,contentType:'application/javascript',body:code}));
 return async()=>assert.ok(await page.evaluate(()=>globalThis.__uiReferenceAdmissions>0),'Frozen admission oracle was not exercised');
}
