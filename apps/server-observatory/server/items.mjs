import {readFile} from 'node:fs/promises';

export function itemIconPath(icon){
 const path=String(icon??'').replaceAll('\\','/').replace(/\.ddj$/i,'.png');
 return /^item\/[a-z0-9_/-]+\.png$/i.test(path)&&!path.includes('..')?path:null;
}
export function createItems(){
 let pending;
 async function load(){
  if(!pending)pending=Promise.all([
   readFile(new URL('../temp/artifacts/items.json',import.meta.url),'utf8'),
   readFile(new URL('../../../.generated/client-public/assets/text/textdataname.en.json',import.meta.url),'utf8'),
  ]).then(([raw,names])=>{
   const data=JSON.parse(raw),text=JSON.parse(names).entries;
   if(data.version!==1||!Array.isArray(data.items)||data.items.length>65536)throw Error('Invalid item catalog');
   const ids=new Set();for(const item of data.items){
    if(!Number.isSafeInteger(item.id)||item.id<=0||ids.has(item.id)||!/^ITEM_[A-Z0-9_]+$/i.test(item.codename))throw Error('Invalid item identity');ids.add(item.id);
    item.iconPath=itemIconPath(item.icon);item.icon=item.iconPath?'/api/item-icon/'+item.id:'';
    item.description=text[item.descriptionSymbol]??'';
   }
   return data;
  }).catch(error=>{pending=null;throw error;});
  return pending;
 }
 return {async catalog(){const data=await load();return {...data,items:data.items.map(({iconPath,...item})=>item)};},async icon(id){
  const item=(await load()).items.find(item=>item.id===id);if(!item?.iconPath)return null;
  try{return await readFile(new URL('../../../.generated/client-public/assets/images/Media_extracted/icon/'+item.iconPath,import.meta.url));}catch(error){if(error.code==='ENOENT')return null;throw error;}
 }};
}
