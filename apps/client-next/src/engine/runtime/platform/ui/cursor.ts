// Retail 0xA15AF0 uses SetCursor. Give the browser the
// extracted cursor and hotspot; it owns pointer presentation independently of
// game frames outside editor interaction. Admit the image on editor hover,
// before a click can focus it and before Windows can hide the native pointer.
// Keep that owner through focused editing/selection; never hand off on keys.
export function createCursor(){
 const lifetime=new AbortController(),style=document.createElement("style"),typing=document.createElement("img");
 style.textContent='html,html *{cursor:url("/assets/cursors/sro_client_cursor_0x95.cur") 2 1,auto!important}html[data-sro-cursor-mode="editing"],html[data-sro-cursor-mode="editing"] *{cursor:none!important}';
 typing.alt="";typing.setAttribute("aria-hidden","true");typing.dataset.typingCursor="";typing.hidden=true;
 typing.style.cssText="position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647;image-rendering:pixelated;will-change:transform";
 let point:readonly [number,number]|null=null;
 let worldCursor=0x95,shownCursor=0x95,mouseButtons=0;
 function world(){
  const value=worldCursor===0x99&&(mouseButtons&1)?0x9a:worldCursor;if(value===shownCursor)return;shownCursor=value;
  const hotspot=value===0x98?'2 26':value===0x99?'9 6':value===0x9a?'9 4':value===0xa1?'0 0':value===0xa3?'15 15':'2 1';
  document.documentElement.dataset.sroWorldCursor=value.toString(16);
  style.textContent=`html,html *{cursor:url("/assets/cursors/sro_client_cursor_0x${value.toString(16)}.cur") ${hotspot},auto!important}html[data-sro-cursor-mode="editing"],html[data-sro-cursor-mode="editing"] *{cursor:none!important}`;
 }
 function editable(target:EventTarget|null){
  if(target instanceof HTMLInputElement)return !target.disabled&&['text','search','url','tel','email','password','number','date','datetime-local','month','time','week'].includes(target.type);
  if(target instanceof HTMLTextAreaElement)return !target.disabled;
  return target instanceof HTMLElement&&target.isContentEditable;
 }
 function present(target:EventTarget|null=document.activeElement){
  // Focus is not the start of an editor gesture: pointer entry precedes it.
  // Hit-test the current point rather than retaining a potentially removed UI
  // element or trusting event.target while an element owns pointer capture.
  const hovered=point?document.elementFromPoint(point[0],point[1]):null;
  const editing=!!point&&!document.hidden&&typing.complete&&typing.naturalWidth>0&&(editable(target)||editable(hovered));
  if(editing){const transform=`translate(${point![0]-2}px, ${point![1]-1}px)`;if(typing.style.transform!==transform)typing.style.transform=transform;}
  if(typing.hidden===editing)typing.hidden=!editing;
  if(editing){if(document.documentElement.dataset.sroCursorMode!=='editing')document.documentElement.dataset.sroCursorMode='editing';}
  else if(document.documentElement.dataset.sroCursorMode)delete document.documentElement.dataset.sroCursorMode;
 }
 function leave(){point=null;mouseButtons=0;world();present();}
 function pointer(event:PointerEvent){
  if(event.pointerType!=="mouse"){if(event.type==='pointerdown')leave();return;}
  point=[event.clientX,event.clientY];mouseButtons=event.buttons;world();present();
 }
 typing.addEventListener('load',()=>present(),{signal:lifetime.signal});
 typing.addEventListener('error',()=>present(),{signal:lifetime.signal});
 window.addEventListener("pointerover",pointer,{signal:lifetime.signal,capture:true});
 window.addEventListener("pointermove",pointer,{signal:lifetime.signal,capture:true});
 window.addEventListener("pointerdown",pointer,{signal:lifetime.signal,capture:true});
 window.addEventListener("pointerup",pointer,{signal:lifetime.signal,capture:true});
 window.addEventListener('focusin',event=>present(event.target),{signal:lifetime.signal});
 window.addEventListener('focusout',event=>present(event.relatedTarget),{signal:lifetime.signal});
 window.addEventListener("pointercancel",leave,{signal:lifetime.signal});
 window.addEventListener("blur",leave,{signal:lifetime.signal});
 document.documentElement.addEventListener("pointerleave",leave,{signal:lifetime.signal});
 document.addEventListener("visibilitychange",()=>{if(document.hidden)leave();},{signal:lifetime.signal});
 document.head.append(style);document.body.append(typing);
 typing.src="/assets/cursors/sro_client_cursor_0x95.cur";
 return {world(value:import('@/engine/foundation/ui/world-cursor').WorldCursor){worldCursor=value;world(); },dispose(){lifetime.abort();typing.remove();style.remove();delete document.documentElement.dataset.sroCursorMode;delete document.documentElement.dataset.sroWorldCursor;}};
}
