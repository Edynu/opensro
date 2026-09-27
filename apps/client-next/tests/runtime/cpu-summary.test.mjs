import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('negative profiler deltas require explicit frequency mode and never become durations',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sro-cpu-summary-'));
 try{
 const file=join(dir,'profile.json');writeFileSync(file,JSON.stringify({nodes:[{id:1,callFrame:{functionName:'work',url:'',lineNumber:0,columnNumber:0}}],samples:[1,1,1],timeDeltas:[100,-20,50]}));
 const run=(...args)=>spawnSync(process.execPath,['tools/summarize-cpu.mjs',file,...args],{encoding:'utf8'});
 assert.notEqual(run().status,0);
 const counts=run('--counts-only');assert.equal(counts.status,0,counts.stderr);assert.match(counts.stdout,/3 samples work/);assert.match(counts.stdout,/"negativeDeltas":1/);assert.doesNotMatch(counts.stdout,/\d ms work/);
 writeFileSync(file,JSON.stringify({samples:[1],timeDeltas:[]}));assert.notEqual(run('--counts-only').status,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
