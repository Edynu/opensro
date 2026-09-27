import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';

test('keyed UI controls reconcile current behavior and retire their gestures',{timeout:45000},async()=>{
 const {browser,page}=await launchProbeBrowser();
 try{
  await holdProbeRuntime(page);await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createUiBridge}=await import('/src/engine/runtime/platform/ui/ui.ts');
   const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;left:0;top:0;pointer-events:none';document.body.append(canvas);
   const events=[],bridge=createUiBridge(canvas,event=>events.push(event),()=>{});
   const control={id:'probe-control',kind:'button',label:'Probe',rect:[20,20,100,24],draggable:false};
   const show=controls=>bridge.present({title:'Probe',message:'',controls});
   const element=()=>document.querySelector('[data-ui-id="probe-control"]');
   let perControlListeners=0;const original=EventTarget.prototype.addEventListener;
   EventTarget.prototype.addEventListener=function(...args){if(this instanceof HTMLElement&&this.dataset.uiId?.startsWith('probe-'))perControlListeners++;return original.apply(this,args);};
   try{
    show([control]);const button=element();button.setPointerCapture=()=>{};
    events.length=0;button.dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));const shift=events.find(e=>e.kind==='activate')?.shift;events.length=0;
    button.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,code:'Escape',key:'Escape'}));
    for(let i=0;i<4;i++)button.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,code:'Escape',key:'Escape',repeat:true}));
    const escapeKeys=events.filter(e=>e.kind==='key').map(e=>e.code);events.length=0;
    show([{...control,draggable:true}]);button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,button:0,clientX:20,clientY:20}));
    window.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:25,clientY:27}));
    const drag=events.find(e=>e.kind==='drag');show([]);events.length=0;
    window.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:30,clientY:30}));button.click();const retiredEvents=events.length;
    show([{...control,kind:'text',value:'abc',maxLength:3}]);const input=element();input.focus();input.setSelectionRange(1,2);
    show([{...control,kind:'text',value:'abc',maxLength:140}]);const preserved=input===element()&&document.activeElement===input&&input.selectionStart===1&&input.selectionEnd===2,limit=input.maxLength;
    show([{...control,kind:'password',value:'secret'}]);const password=element().type;
    show([{...control,kind:'button',disabled:true}]);events.length=0;element().dispatchEvent(new MouseEvent('click',{bubbles:true}));const disabledEvents=events.length;
    show([control]);const retained=element(),retainedHtml=retained.closest('section').outerHTML;let duplicateError='';
    try{show([{...control,label:'Must not partially publish'},{...control,rect:[300,300,16,16]}]);}catch(error){duplicateError=String(error);}
    const duplicateAtomic=element()===retained&&retained.closest('section').outerHTML===retainedHtml;
    const other={...control,id:'probe-overlay'};show([control,other]);show([other,control]);const order=Number(element().style.zIndex)>Number(document.querySelector('[data-ui-id="probe-overlay"]').style.zIndex);
    // Isolate the bridge above startup loading; invisible label ink must not enlarge its hit rectangle.
    const right={...control,id:'probe-right',label:'Rotate right',rect:[96,327,28,16]},reset={...control,id:'probe-reset',label:'Reset rotation',rect:[81,327,16,16]};show([right,reset]);document.querySelector('[data-ui-id="probe-right"]').closest('section').style.zIndex='2147483647';const rightBox=document.querySelector('[data-ui-id="probe-right"]').getBoundingClientRect(),hit=document.elementFromPoint(rightBox.x+rightBox.width/2,rightBox.y+rightBox.height/2)?.closest('[data-ui-id]')?.getAttribute('data-ui-id');
    show([control]);const observer=new MutationObserver(()=>{});observer.observe(element().closest('section'),{subtree:true,attributes:true,childList:true,characterData:true});
    for(let i=0;i<100;i++)show([structuredClone(control)]);
    const unchangedMutations=observer.takeRecords().length;
    show([{...control,label:'Changed',selected:true,rect:[21,22,101,25]}]);
    const changedMutations=observer.takeRecords().length,changedLabel=element().textContent,changedWidth=element().style.width;observer.disconnect();
    for(let i=0;i<100;i++){show([]);show([control]);}
    bridge.dispose();events.length=0;show([control]);window.dispatchEvent(new PointerEvent('pointerup'));const disposedEvents=events.length,remaining=!!element();
    return {duplicateError,duplicateAtomic,shift,hit,escapeKeys,unchangedMutations,changedMutations,changedLabel,changedWidth,drag,retiredEvents,preserved,limit,password,disabledEvents,order,perControlListeners,disposedEvents,remaining};
   }finally{EventTarget.prototype.addEventListener=original;bridge.dispose();canvas.remove();}
  });
  assert.match(result.duplicateError,/Duplicate UI control identity: probe-control/);assert.equal(result.duplicateAtomic,true);
  assert.equal(result.shift,true);assert.equal(result.hit,'probe-right');
  assert.deepEqual(result.escapeKeys,['Escape']);
  assert.equal(result.unchangedMutations,0);assert.ok(result.changedMutations>0);assert.equal(result.changedLabel,'Changed');assert.equal(result.changedWidth,'101px');
  assert.deepEqual(result.drag,{kind:'drag',id:'probe-control',dx:5,dy:7});assert.equal(result.retiredEvents,0);
  assert.equal(result.preserved,true);assert.equal(result.limit,140);assert.equal(result.password,'password');assert.equal(result.disabledEvents,0);
  assert.equal(result.order,true);assert.equal(result.perControlListeners,0);assert.equal(result.disposedEvents,0);assert.equal(result.remaining,false);
 }finally{await browser.close();}
});
