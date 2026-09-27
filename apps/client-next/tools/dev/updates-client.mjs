// Independent of the game runtime so diagnostics survive a failed renderer.
export function installDevUpdates(boot,endpoint){
 // Normal play keeps its loaded source snapshot without development chrome.
 if(!new URLSearchParams(location.search).has('diagnostics'))return ()=>{};
 let state={kind:'current'},acked=boot.generation,first=true,flight=null,timer=null,node=null;
 const loaded=new Set(['/src/bootstrap.ts','/index.html','/']);
 const pathname=value=>{try{return new URL(value,location.origin).pathname;}catch{return null;}};
 const remember=entries=>{for(const entry of entries)loaded.add(pathname(entry.name));};
 remember(performance.getEntriesByType('resource'));
 const observer=new PerformanceObserver(list=>remember(list.getEntries()));observer.observe({type:'resource',buffered:true});
 function clear(){node?.remove();node=null;}
 function dismiss(){state={kind:'dismissed'};dispose();}
 function button(label,action){const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='font:inherit;padding:7px 12px;border:1px solid #be9560;border-radius:6px;background:#fff3dc;color:#251b10;cursor:pointer;pointer-events:auto';b.addEventListener('click',e=>{e.stopPropagation();action();});return b;}
 function show(reason,urgent=false){
  if(state.kind==='dismissed'||state.kind==='disposed')return;
  if(state.kind==='notice'&&state.urgent&&!urgent)return;
  if(state.kind==='notice'&&state.reason===reason&&state.urgent===urgent)return;
  state={kind:'notice',reason,urgent};clear();
  node=document.createElement('section');node.dataset.devUpdate=urgent?'overlay':'banner';node.setAttribute('role',urgent?'dialog':'status');node.setAttribute('aria-label','Development update');
  node.style.cssText='position:fixed;z-index:2147483647;font:13px/1.5 system-ui;color:#fff3dc;box-sizing:border-box;'+(urgent?'inset:0;background:#101014ed;display:grid;place-content:center;padding:24px;':'top:96px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100vw - 24px);background:#241e17f5;border:1px solid #be9560;border-radius:9px;padding:10px;box-shadow:0 4px 18px #0008;pointer-events:none;');
  const panel=document.createElement('div');panel.style.cssText='max-width:640px;display:flex;align-items:center;gap:12px';
  const text=document.createElement('span');text.textContent=`${urgent?'This dev tab is stale':'Dev update available'}: ${reason}. Reload when you are ready.`;panel.append(text);
  text.style.cssText='min-width:0;flex:1;overflow-wrap:anywhere';
  const actions=document.createElement('div');actions.style.cssText='display:flex;align-items:center;gap:8px;flex:none';
  const reload=button('Reload',()=>{reload.disabled=true;reload.textContent='Reloading…';location.reload();});reload.style.whiteSpace='nowrap';reload.dataset.devUpdateReload='';actions.append(reload);
  const close=button('×',dismiss);close.setAttribute('aria-label','Dismiss update for this page');actions.append(close);panel.append(actions);node.append(panel);
  // Keep pointer and keyboard events on the development controls out of gameplay.
  for(const event of ['pointerdown','pointerup','mousedown','mouseup','keydown','keyup'])panel.addEventListener(event,e=>e.stopPropagation());
  (document.body??document.documentElement).append(node);
 }
 async function poll(){
  if(flight||state.kind==='dismissed'||state.kind==='disposed')return;
  const controller=new AbortController();flight=controller;const deadline=setTimeout(()=>controller.abort(),5000);
  try{const response=await fetch(`${endpoint}?since=${acked}`,{cache:'no-store',signal:controller.signal});if(!response.ok)return;const value=await response.json();
   if(controller.signal.aborted||state.kind==='dismissed'||state.kind==='disposed')return;
   if(!value||typeof value.sessionId!=='string'||!Number.isSafeInteger(value.generation)||value.generation<0||typeof value.resources!=='string')return;
   if(value.sessionId!==boot.sessionId)show('the dev server restarted',first);
   else if(value.resources!==boot.resources)show('generated resources changed',true);
   else if(value.generation>acked){
    const relevant=!Array.isArray(value.changed)||value.changed.some(p=>typeof p!=='string'||pathname(p)===null||loaded.has(pathname(p)));
    if(relevant)show('loaded source changed',first);else acked=value.generation;
   }
   first=false;
  }catch{/* Offline/restarting is not proof of staleness. */}finally{clearTimeout(deadline);if(flight===controller)flight=null;}
 }
 function focus(){if(document.visibilityState==='visible')void poll();}
 function error(){if(state.kind==='notice')show(state.reason,true);}
 function dispose(){if(state.kind!=='dismissed')state={kind:'disposed'};clearInterval(timer);flight?.abort();observer.disconnect();clear();document.removeEventListener('visibilitychange',focus);window.removeEventListener('focus',focus);window.removeEventListener('error',error);window.removeEventListener('unhandledrejection',error);window.removeEventListener('pagehide',dispose);}
 document.addEventListener('visibilitychange',focus);window.addEventListener('focus',focus);window.addEventListener('error',error);window.addEventListener('unhandledrejection',error);window.addEventListener('pagehide',dispose);
 timer=setInterval(()=>void poll(),4000);void poll();return dispose;
}
