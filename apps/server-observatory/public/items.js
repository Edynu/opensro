import {escape,fmt} from './model.js';
import {category,filterItems,itemCommand,parameterLimit,stackable,requirements} from './item-model.js';
const $=id=>document.getElementById(id);
let catalog=null,pending=false,page=0,selected=null;
const pageSize=24;
const icon=item=>item.icon?`<img src="${escape(item.icon)}" alt="" loading="lazy" width="32" height="32">`:'<span aria-hidden="true">◇</span>';
function facts(item){return [category(item),({0:'Chinese',1:'European',3:'All races'})[item.country]??'Race '+item.country,...requirements(item),...(item.requiredStr>0?['STR '+item.requiredStr]:[]),...(item.requiredInt>0?['INT '+item.requiredInt]:[]),...(['HP','MP'].flatMap(stat=>[...(item['recovery'+stat]>0?[`Restores ${fmt(item['recovery'+stat])} ${stat}`]:[]),...(item['recovery'+stat+'Percent']>0?[`Restores ${item['recovery'+stat+'Percent']}% ${stat}`]:[])]))];}
function draw(){
 if(!catalog)return;const rows=filterItems(catalog.items,$('item-search').value,$('item-category').value);page=Math.min(page,Math.max(0,Math.ceil(rows.length/pageSize)-1));
 $('item-count').textContent=`${fmt(rows.length)} matches · ${fmt(catalog.items.length)} server references`;
 $('item-page').textContent=`${page+1} / ${Math.max(1,Math.ceil(rows.length/pageSize))}`;$('item-prev').disabled=page===0;$('item-next').disabled=(page+1)*pageSize>=rows.length;
 $('item-rows').innerHTML=rows.slice(page*pageSize,(page+1)*pageSize).map(item=>`<tr><td><button class="item-identity" data-item="${item.id}" aria-describedby="item-tip-${item.id}"><span class="item-icon">${icon(item)}</span><span><strong>${escape(item.name||item.codename)}</strong><small>${escape(item.codename)}</small></span></button><div class="item-tooltip" role="tooltip" id="item-tip-${item.id}"><strong>${escape(item.name||item.codename)}</strong><p>${escape(facts(item).join(' · '))}</p><p>${escape(item.description.replace(/<[^>]*>/g,''))}</p><small>Reference ${item.id} · ${stackable(item)?'Stack '+item.maxStack:'Equipment plus parameter'}</small></div></td><td><span class="tag">${escape(category(item))}</span></td><td>${item.id}</td><td>${stackable(item)?fmt(item.maxStack):'—'}</td><td><button class="button" data-item="${item.id}">Build command <span aria-hidden="true">↗</span></button></td></tr>`).join('')||'<tr><td colspan="5" class="item-empty">No items match. Try a name, codename, or reference ID.</td></tr>';
}
async function load(){if(catalog||pending)return;pending=true;$('item-load').textContent='Opening the item archive…';try{const response=await fetch('/api/items');if(!response.ok)throw Error('The item archive is unavailable. Generate the server catalog and retry.');catalog=await response.json();$('item-load').textContent=`v1.150 · Exported ${new Date(catalog.generatedAt).toLocaleString()} · Shared server catalog`;$('item-retry').hidden=true;draw();}catch(error){$('item-load').textContent=error.message;$('item-retry').hidden=false;}finally{pending=false;}}
function preview(){if(!selected)return;const command=itemCommand(selected,$('item-amount').value);$('item-command').value=command??'';$('item-copy').disabled=!command;$('item-copy-status').textContent=command?'':`Enter a whole number from ${stackable(selected)?1:0} to ${parameterLimit(selected)}.`;}
function open(id){selected=catalog.items.find(item=>item.id===id);if(!selected)return;const item=selected;
 $('item-detail').innerHTML=`<div class="eyebrow">THE ITEM ARCHIVE / #${item.id}</div><div class="item-detail-heading"><span class="item-icon large">${icon(item)}</span><div><h2 id="item-title">${escape(item.name||item.codename)}</h2><code>${escape(item.codename)}</code></div></div><div class="item-facts">${facts(item).map(f=>`<span>${escape(f)}</span>`).join('')}</div><p class="item-description">${escape(item.description.replace(/<[^>]*>/g,''))||'No authored description is available for this item.'}</p>`;
 $('item-amount-label').textContent=stackable(item)?'Quantity':'Equipment plus level';$('item-amount').min=stackable(item)?1:0;$('item-amount').max=parameterLimit(item);$('item-amount').value=stackable(item)?Math.min(50,parameterLimit(item)):0;
 $('item-parameter-help').textContent=stackable(item)?`Stack capacity ${item.maxStack}. A single command accepts up to ${parameterLimit(item)}.`:'0 creates an unenhanced item. The client accepts 0–12; server factory limits still apply.';
 preview();$('item-dialog').showModal();
}
document.querySelector('[data-view="items"]').addEventListener('click',load);
$('item-retry').addEventListener('click',load);
for(const id of ['item-search','item-category'])$(id).addEventListener('input',()=>{page=0;draw();});
for(const [id,delta] of [['item-prev',-1],['item-next',1]])$(id).addEventListener('click',()=>{page+=delta;draw();});
$('item-shortcuts').addEventListener('click',event=>{const query=event.target.closest('[data-query]')?.dataset.query;if(query===undefined)return;$('item-search').value=query;$('item-category').value='';page=0;draw();});
$('item-rows').addEventListener('click',event=>{const id=event.target.closest('[data-item]')?.dataset.item;if(id)open(Number(id));});
$('item-rows').addEventListener('error',event=>{if(event.target.tagName==='IMG'){event.target.hidden=true;event.target.parentElement.classList.add('missing-icon');}},true);
$('item-close').addEventListener('click',()=>$('item-dialog').close());$('item-amount').addEventListener('input',preview);
$('item-copy').addEventListener('click',async()=>{const command=itemCommand(selected,$('item-amount').value);if(!command)return;try{await navigator.clipboard.writeText(command);$('item-copy-status').textContent='Copied. Paste into the in-game GM console.';}catch{$('item-command').focus();$('item-command').select();$('item-copy-status').textContent='Press Ctrl+C to copy the selected command.';}});
