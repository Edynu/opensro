import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {stdout}=await promisify(execFile)('go',['run','./cmd/tools/sro-item-catalog'],{cwd:fileURLToPath(new URL('../../server/',import.meta.url)),maxBuffer:32<<20,windowsHide:true});
const data=JSON.parse(stdout);if(data.version!==1||!data.items?.length)throw Error('Invalid item export');
const dir=new URL('../temp/artifacts/',import.meta.url);await mkdir(dir,{recursive:true});
await writeFile(new URL('items.tmp.json',dir),JSON.stringify(data));await rename(new URL('items.tmp.json',dir),new URL('items.json',dir));
console.log(`Exported ${data.items.length} server item references.`);
