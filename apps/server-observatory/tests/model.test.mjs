import {test} from 'node:test';
import assert from 'node:assert/strict';
import {coordinates,census,historySample,escape} from '../public/model.js';
import {createSource} from '../server/source.mjs';
test('coordinates use native world origin and isolate indoor space',()=>{
 assert.deepEqual(coordinates({region:25416,x:703,z:1575}),{x:-12025.7,y:1501.5,indoor:false});
 assert.deepEqual(coordinates({region:0x8001,x:20,z:30}),{x:2,y:3,indoor:true});
});
test('census filters include party grades without losing base grade',()=>{
 const rows=[{name:'Manyang',gid:1,ref:2,region:3,rarity:0},{name:'Unique',gid:2,ref:3,region:4,rarity:3},{name:'Party Giant',gid:3,ref:4,region:5,rarity:20}];
 assert.equal(census(rows).length,3);assert.equal(census(rows,'','4')[0].gid,3);assert.equal(census(rows,'unique')[0].gid,2);assert.equal(census(rows,'','other').length,0);
 assert.equal(escape('<script>"'),'&lt;script&gt;&quot;');
});
test('rates reset on restart rather than creating negative throughput',()=>{
 const data={capturedAt:'2026-09-12T00:00:02Z',uptimeSeconds:2,transport:{tick_last_ms:1,bytes_out:100,bytes_in:20},runtime:{metrics:{'/memory/classes/heap/objects:bytes':1048576}},players:[]};
 assert.equal(historySample(data).outRate,null);
 assert.equal(historySample(data,{at:Date.parse('2026-09-12T00:00:00Z'),uptime:1,bytes:50,inBytes:10}).outRate,25);
 assert.equal(historySample(data,{at:0,uptime:100,bytes:500}).outRate,null);
});
test('concurrent tabs share one bounded upstream capture; failures remain failures',async()=>{
 let calls=0,now=0;const shards=[{id:'test',name:'Test',url:'http://127.0.0.1:8792'}];
 const source=createSource(shards,async()=>{calls++;return new Response(JSON.stringify({version:1,shard:'test',capturedAt:new Date().toISOString(),players:[],population:{monsters:[]}}));},()=>now);
 const results=await Promise.all(Array.from({length:10},()=>source.snapshot()));assert.equal(calls,1);assert.ok(results.every(r=>r.shards[0].connected));now=3000;await source.snapshot();assert.equal(calls,2);
 const failed=createSource(shards,async()=>new Response('',{status:503}));assert.equal((await failed.snapshot()).shards[0].connected,false);
});
