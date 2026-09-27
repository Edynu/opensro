import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {loadShards,createSource} from './source.mjs';
import {allowedRequest} from './security.mjs';
import {createItems} from './items.mjs';

const port=Number(process.env.SRO_OBSERVATORY_PORT??5190);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid dashboard port');
const shards=await loadShards(new URL('../../server/config/shards.json',import.meta.url));
const source=createSource(shards),publicRoot=new URL('../public/',import.meta.url);
const items=createItems();
const files=new Map([['/','index.html'],['/app.js','app.js'],['/styles.css','styles.css'],['/view.js','view.js'],['/model.js','model.js'],['/operations.js','operations.js'],['/theme.css','theme.css']]);
for(const file of ['items.js','item-model.js','items.css'])files.set('/'+file,file);
const server=createServer(async(req,res)=>{
 try{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  if(!allowedRequest(req,port)){res.writeHead(403);res.end('Local operator access only');return;}
  if(req.method!=='GET'){res.writeHead(405);res.end('Read-only dashboard');return;}
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path==='/api/snapshot'){const data=await source.snapshot();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;}
  if(path==='/api/items'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await items.catalog()));return;}
  if(/^\/api\/item-icon\/\d+$/.test(path)){const image=await items.icon(Number(path.split('/').at(-1)));if(!image){res.writeHead(404);res.end('Icon unavailable');return;}res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control','private, max-age=3600');res.end(image);return;}
  const file=files.get(path);if(!file){res.writeHead(404);res.end('Not found');return;}
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(await readFile(new URL(file,publicRoot)));
 }catch(error){console.error('Dashboard request failed:',error.message);if(!res.headersSent)res.writeHead(500);res.end('Dashboard request failed');}
});
server.requestTimeout=10000;server.headersTimeout=10000;
server.listen(port,'127.0.0.1',()=>console.log(`Silkroad Observatory • http://localhost:${port} • ${shards.length} shards`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
