import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyExecution} from '../../tools/verify-execution.mjs';
test('native frame barriers require source seals, evidence and tests; unrelated async work stays forbidden',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sro-frame-barrier-'));
 const file='src/engine/runtime/runtime.ts',id=file+'#frame',source='async function frame() {}';
 const write=(file,text)=>{const p=path.join(root,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);};
 try{
  write(file,source);write('src/engine/ownership.json',JSON.stringify({modules:{},internals:{}}));write('proof.json',JSON.stringify({functions:[{va:0xAEBD90}]}));write('test.mjs','');
  const contract={capabilities:[],boundaries:[],sequences:[],frameBarriers:[{file,function:'frame',sourceSha256:createHash('sha256').update(source).digest('hex'),reason:'Native GPU visibility completion',evidence:'proof.json',nativeFunction:0xAEBD90,tests:['test.mjs']}]};write('execution-contract.json',JSON.stringify(contract));
  const graph={functions:[{id,file,name:'frame',async:true}],calls:[]};assert.deepEqual(verifyExecution(root,graph),[]);
  write(file,source+' changed');assert.ok(verifyExecution(root,graph).some(s=>s.includes('Unverified native frame barrier')));write(file,source);
  write('proof.json',JSON.stringify({functions:[]}));assert.ok(verifyExecution(root,graph).some(s=>s.includes('Missing native frame barrier evidence')));write('proof.json',JSON.stringify({functions:[{va:0xAEBD90}]}));
  fs.unlinkSync(path.join(root,'test.mjs'));assert.ok(verifyExecution(root,graph).some(s=>s.includes('Unverified native frame barrier')));write('test.mjs','');
  const other='src/engine/foundation/unapproved.ts#other';graph.functions.push({id:other,file:'src/engine/foundation/unapproved.ts',name:'other',async:true});graph.calls.push({caller:id,file,targets:[other],callbacks:[],expression:'other'});assert.ok(verifyExecution(root,graph).some(s=>s.includes('Async function in frame closure')&&s.includes('unapproved')));
 }finally{const resolved=fs.realpathSync(root),parent=fs.realpathSync(os.tmpdir());assert.equal(path.dirname(resolved),parent);assert.ok(path.basename(resolved).startsWith('sro-frame-barrier-'));fs.rmSync(resolved,{recursive:true,force:true});}
});
