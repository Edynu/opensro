import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transform} from 'esbuild';
import {profileSourceMap} from '../../tools/lib/profile-source-map.mjs';

test('release CPU locations map to archived TS and unmapped spans stay unmapped',async()=>{
 const built=await transform('export function known(){\n return 7;\n}\n',{loader:'ts',minify:true,sourcefile:'fixture.ts',sourcemap:'external'});
 const lookup=profileSourceMap(JSON.parse(built.map)),column=built.code.indexOf('return');
 assert.ok(column>=0);const result=lookup(0,column);assert.equal(result.source,'fixture.ts');assert.equal(result.line,1);
 const gap=profileSourceMap({version:3,sources:['fixture.ts'],names:[],mappings:'AAAA,K'});
 assert.equal(gap(0,4).source,'fixture.ts');assert.equal(gap(0,5),null);assert.equal(gap(2,0),null);
 assert.throws(()=>profileSourceMap({version:3,sources:[],mappings:'?'}),/Invalid source-map/);
});
