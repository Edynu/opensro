import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {profileSourceMap} from '../lib/profile-source-map.mjs';
import {sha,safeName} from './policy.mjs';
export async function symbolicate(privateRoot,releaseId,script,line,column){
 const descriptor=JSON.parse(await readFile(path.join(privateRoot,'debug.json'),'utf8'));if(descriptor.releaseId!==releaseId)throw Error('Debug artifacts belong to another release');
 const name=safeName(script.replace(/^\//,'')+'.map'),expected=descriptor.maps[name];if(!expected)throw Error('No private map for this chunk');
 const bytes=await readFile(path.join(privateRoot,'maps',name));if(sha(bytes)!==expected)throw Error('Private map integrity mismatch');
 if(!Number.isInteger(line)||!Number.isInteger(column)||line<1||column<1)throw Error('Expected 1-based generated line and column');
 return profileSourceMap(JSON.parse(bytes))(line-1,column-1);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [directory,id,script,line,column]=process.argv.slice(2);console.log(await symbolicate(directory,id,script,Number(line),Number(column)));
}
