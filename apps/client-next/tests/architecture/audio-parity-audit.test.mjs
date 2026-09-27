import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceSoundCandidates,classifySoundRow,audit} from '../../tools/audit-audio-parity.mjs';
import {itemSoundSource} from '../../tools/generate-item-sounds.mjs';
import fs from 'node:fs';
import {build} from 'esbuild';

test('sound census cannot count comments, a catalog or a dead documentation lane as a runtime producer',()=>{
 const input=`// play('SND_EQUIP');\nconst data={sound:'SND_EQUIP'};\nfunction accepted(){play('SND_POTION');}`;
 const candidates=sourceSoundCandidates(input,'src/engine/runtime/inventory.ts');
 assert.deepEqual(candidates.map(c=>[c.value,c.call]),[['SND_EQUIP',null],['SND_POTION','play']]);
 const state={itemCategories:new Set(),uiHandles:new Set(['SND_EQUIP']),animationCues:new Set(),sourceCandidates:candidates};
 const row={object:'UI',handle:'SND_EQUIP',publicPath:'/assets/audio/equip.wav'};
 assert.ok(classifySoundRow(row,state).reasons.includes('no-literal-production-producer'));
 const withProducer={...state,sourceCandidates:sourceSoundCandidates(`play('SND_EQUIP')`,'src/engine/runtime/inventory.ts')};
 assert.deepEqual(classifySoundRow(row,withProducer).reasons,[]);
 assert.ok(classifySoundRow(row,{...withProducer,uiHandles:new Set()}).reasons.includes('missing-production-catalog'));
});

test('ITEM category and resource gaps remain distinct; a WAV does not establish native reachability',()=>{
 const row={object:'ITEM',handle:'SND_EQUIP',event1:'TABLET',folder:'ui/',publicPath:'/assets/audio/tablet.wav'};
 const state={itemCategories:new Set(['SWORD']),uiHandles:new Set(),animationCues:new Set(),sourceCandidates:[]};
 assert.deepEqual(classifySoundRow(row,state).reasons,['unreachable-by-native-tid-selector']);
 assert.deepEqual(classifySoundRow({...row,event1:'SWORD',publicPath:null},state).reasons,['unresolved-asset']);
});

test('catalog generation preserves variant order and rejects newly introduced selector dimensions',()=>{
 const row={object:'ITEM',handle:'SND_EQUIP',skillId:'-',event1:'SWORD',event2:'-',event3:'-',volume:80,publicPath:'/assets/audio/a.wav'};
 const source=itemSoundSource(Buffer.from(JSON.stringify({rules:[row,{...row,publicPath:'/assets/audio/b.wav'}]})));
 assert.ok(source.indexOf('a.wav')<source.indexOf('b.wav'));
 assert.throws(()=>itemSoundSource(Buffer.from(JSON.stringify({rules:[{...row,event2:'NEW'}]}))),/dimensions/);
 assert.throws(()=>itemSoundSource(Buffer.from(JSON.stringify({rules:[{...row,publicPath:'/assets/audio/../wrong'}]}))),/path/);
});

test('a no-op producer bridge is detected even when the handle, WAV and inventory mutation survive',async()=>{
 async function run(mutate){
  const result=await build({entryPoints:['src/engine/runtime/simulation/worker/session/world/core.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'producer-mutation',setup(b){b.onLoad({filter:/[\\/]gameplay[\\/]gameplay\.ts$/},args=>{let contents=fs.readFileSync(args.path,'utf8');if(mutate){const anchor='cue=>playItem(cue,soundClock)';assert.ok(contents.includes(anchor),'mutation must bind the actual producer bridge');contents=contents.replace(anchor,'cue=>{}');}return {contents,loader:'ts'};});}}]});
  const {createWorldCore}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
  const core=createWorldCore(()=>{}),drain=()=>{const b=core.take();if(b)core.ack(b.sequence);return b?.events??[];};
  const body=Buffer.alloc(18);body.writeUInt32LE(1);body.writeUInt32LE(50,13);
  core.bootstrap({protocolVersion:2,nativeResult:1,refObjSnapshot:[],character:{name:'fixture'},localPlayerEntry:{modelRef:1933,startProfile:{regionId:257,x:0,y:0,z:0,angle:0}},inventorySlotCount:45,equipmentSlotCount:13,refItemSnapshot:[{refObjId:1,typeFlags:0x132c}],equipItems:[{slot:13,refObjId:1,body:[...body]}]});drain();
  core.receive({opcode:0xb06d,payload:Uint8Array.of(1,0,13,6,1,0,0)},10);core.step(10,false);return drain();
 }
 const good=await run(false),bad=await run(true);
 const acceptance=events=>assert.equal(events.filter(e=>e.kind==='item-sound').length,1,'accepted B06D must emit ITEM audio');
 acceptance(good);assert.throws(()=>acceptance(bad),/accepted B06D/);
 assert.equal(bad.find(e=>e.kind==='gameplay').state.inventory[0].slot,6,'visual state alone would have passed the old check');
});

test('whole-surface audit reports removed assets and generated selector drift without claiming unrun closure',async()=>{
 const report=await audit({assetExists:p=>!p.endsWith('/itsword.wav'),sourceRead:p=>fs.readFileSync(p,'utf8')+(p.endsWith('item-sound-catalog.ts')?'\n// changed generation':'')});
 assert.ok(report.issues.some(x=>x.kind==='missing-published-assets'&&x.paths.some(p=>p.endsWith('/itsword.wav'))));
 assert.ok(report.issues.some(x=>x.kind==='item-catalog-drift'));
 assert.ok(report.nativeCallsites.some(x=>x.status==='declared-regression-not-run'));
 assert.equal(report.nativeCallsites.some(x=>x.status==='production-regression-covered'),false);
 assert.ok(report.open.nativeCallsites>0);
});
