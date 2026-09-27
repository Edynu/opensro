// Native icon paths are relative to Media/icon. Never let metadata escape it.
export function iconPath(value:string|undefined):string|null{
 if(!value||value.toLowerCase()==='xxx')return null;
 const path=value.replaceAll('\\','/').toLowerCase();
 if(!/^[a-z0-9_/-]+\.ddj$/.test(path)||path.startsWith('/')||path.split('/').some(p=>!p||p==='..'))return null;
 return '/assets/images/Media_extracted/icon/'+path.slice(0,-4)+'.png';
}
