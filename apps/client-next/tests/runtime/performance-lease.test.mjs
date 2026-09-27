import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {acquirePerformanceLease} from '../../tools/lib/performance-lease.mjs';

test('capture ownership excludes overlapping probes and releases without stale lock files',async()=>{
 const first=await acquirePerformanceLease({port:0,legacyCheck:false}),port=first.port;
 try{await assert.rejects(acquirePerformanceLease({port,legacyCheck:false}),/lease busy/);}finally{await first.release();}
 const next=await acquirePerformanceLease({port,legacyCheck:false});await next.release();
});

test('Windows preflight rejects a legacy probe that predates socket ownership',{skip:process.platform!=='win32'},async()=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)','profile-world.mjs'],{windowsHide:true,stdio:'ignore'});
 await once(child,'spawn');
 try{await assert.rejects(acquirePerformanceLease({port:0}),/Concurrent world probe PID/);}finally{const exited=once(child,'exit');child.kill();await exited;}
});
