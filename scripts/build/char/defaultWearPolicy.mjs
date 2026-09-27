import fs from 'node:fs';
import path from 'node:path';
import {extractedRoot} from '../world/paths.mjs';
export function defaultWearLanguage(){
 const source=fs.readFileSync(path.join(extractedRoot,'Media_extracted/type.txt'),'utf8');
 const language=/^Language\s*=\s*"([^"]+)"/m.exec(source)?.[1];
 const code=['Korean','Chinese','Taiwan','Japan','English','Vietnam'].indexOf(language);
 if(code<0)throw Error('Missing native type.txt Language');
 return code;
}
