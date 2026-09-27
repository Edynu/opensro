import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUiProductProbe} from '../../tools/lib/ui-product-probe.mjs';
test('UI product snapshots are bounded, detached and owned by the capture window',()=>{
 const probe=createUiProductProbe(),quad={rect:[0,0,1,1]};
 probe.record(1,1,[quad],{});assert.equal(probe.stats().products.length,0);
 probe.start();for(let i=0;i<30;i++){quad.rect[0]=i;probe.record(1,1,[quad],{});}
 const first=probe.stats();assert.equal(first.products.length,24);assert.equal(first.products[0].quads[0].rect[0],0);assert.equal(first.products[23].quads[0].rect[0],23);
 probe.pause();probe.record(1,1,[],{});assert.equal(probe.stats().products.length,24);
 probe.start();probe.record(1,1,[],{message:'x'.repeat(8*1024*1024)});assert.equal(probe.stats().truncated,true);assert.equal(probe.stats().products.length,0);
});
