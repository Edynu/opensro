import fs from 'node:fs';
import {root,main} from './project.mjs';

// Keep generated output in temp/ and prevent new root-level catch-all folders.
// node_modules is package-manager owned and ignored like a hidden folder.
export function verifyLayout(base=root){
 const allowed=new Set(['src','tests','tools','docs','temp']);
 const folders=fs.readdirSync(base,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&!entry.name.startsWith('.')&&entry.name!=='node_modules');
 const issues=folders.filter(entry=>!allowed.has(entry.name)).map(entry=>`Unexpected root folder ${entry.name}; use an existing owner or temp/ for generated output`);
 if(folders.length>5)issues.push(`Project root has ${folders.length} visible folders; maximum is 5`);
 return issues;
}
if(process.argv[1]===import.meta.filename)main(()=>verifyLayout());
