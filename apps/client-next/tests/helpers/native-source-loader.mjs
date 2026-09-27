// Standalone regression support for Node >=22.16, without workspace bundlers.
// Register only in this test worker; application imports are not rewritten.
import {registerHooks,stripTypeScriptTypes} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const sourceRoot=new URL('../../src/',import.meta.url);
registerHooks({
 resolve(specifier,context,nextResolve){
  let target;
  if(specifier.startsWith('@/'))target=new URL(specifier.slice(2),sourceRoot);
  else if(specifier.startsWith('.')&&context.parentURL?.endsWith('.ts'))target=new URL(specifier,context.parentURL);
  if(target&&!/\.[a-z]+$/i.test(target.pathname)){
   const direct=new URL(target.href+'.ts'),index=new URL(target.href+'/index.ts');
   if(existsSync(fileURLToPath(direct)))target=direct;
   else if(existsSync(fileURLToPath(index)))target=index;
  }
  return nextResolve(target?.href??specifier,context);
 },
 load(url,context,nextLoad){
  if(url.startsWith(sourceRoot.href)&&url.endsWith('.ts'))return {
   format:'module',shortCircuit:true,
   source:stripTypeScriptTypes(readFileSync(fileURLToPath(url),'utf8'),{mode:'transform',sourceUrl:url})
  };
  return nextLoad(url,context);
 }
});
