import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJournal,hotspots,journalView,alerts} from '../public/operations.js';
const unique={gid:1,name:'Cerberus',rarity:3,hp:100,region:100,target:5};
const snapshot=(time,monsters=[],extra={})=>({capturedAt:new Date(time*1000).toISOString(),uptimeSeconds:time,players:[],population:{monsters},...extra});
test('journal baselines, deduplicates, bounds history and does not invent kills',()=>{
 const j=createJournal(2);j.observe('a',snapshot(10));assert.equal(j.rows('a').length,0);
 j.observe('a',snapshot(12,[unique]));j.observe('a',snapshot(12,[unique]));assert.equal(j.rows('a').length,1);
 j.observe('a',snapshot(14));assert.match(j.rows('a')[0].message,/cause unknown/);
 j.observe('a',snapshot(16,[],{uptimeSeconds:1}));assert.equal(j.rows('a').length,2);assert.match(j.rows('a')[0].message,/restarted/);
 assert.deepEqual(j.rows('other'),[]);
});
test('partial census cannot produce false unique departures',()=>{
 const j=createJournal();j.observe('a',snapshot(10,[unique]));j.observe('a',snapshot(12,[],{population:{monsters:[],truncated:true}}));assert.equal(j.rows('a').length,0);
});
test('hotspots rank players first and exclude dead uniques from living encounters',()=>{
 const rows=hotspots(snapshot(1,[unique,{...unique,gid:2,region:101,hp:0}],{players:[{region:101}]}));
 assert.equal(rows[0].id,101);assert.equal(rows[0].uniques,0);assert.equal(rows[1].engaged,1);
});
test('operator text escapes entities and reports unresolved storage errors',()=>{
 assert.ok(journalView([{at:0,message:'<script>'}]).includes('&lt;script&gt;'));
 assert.match(alerts({connected:true},{capturedAt:new Date().toISOString(),population:{},storage:{FailedWrites:2}}),/Persistence/);
 assert.match(alerts({connected:true},{capturedAt:new Date().toISOString(),population:{},storage:{LastError:'disk'}}),/Persistence/);
});
