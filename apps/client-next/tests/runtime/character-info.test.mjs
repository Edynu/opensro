import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveCharacterInfoRows} from '../../../../scripts/build/shared/characterInfo.mjs';
test('native contexts resolve direct, one original-object hop, then first registered default',()=>{
 const authored=[{codename:'UNREGISTERED',heightFactor:99},{codename:'DEFAULT',heightFactor:1},{codename:'DIRECT',heightFactor:2}];
 const rows=new Map([['DEFAULT',['1','1','DEFAULT','','xxx']],['DIRECT',['1','2','DIRECT','','DEFAULT']],['LINK',['1','3','LINK','','DIRECT']],['CHAIN',['1','4','CHAIN','','LINK']],['NPC',['1','5','NPC','','xxx']],['DISABLED',['0','6','DISABLED','','DIRECT']]]);
 const actual=resolveCharacterInfoRows(authored,rows);
 assert.deepEqual(actual.map(r=>[r.codename,r.contextCodename,r.heightFactor]),[['DEFAULT','DEFAULT',1],['DIRECT','DIRECT',2],['LINK','DIRECT',2],['CHAIN','DEFAULT',1],['NPC','DEFAULT',1]]);
 assert.throws(()=>resolveCharacterInfoRows([],rows),/No registered/);
});
