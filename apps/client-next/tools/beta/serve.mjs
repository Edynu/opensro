import http from 'node:http';
import https from 'node:https';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assetEncoding} from '../published-assets.mjs';
import {verifyDirectory} from './policy.mjs';
// Deployment adapter: only manifest routes can read files. Neither the working
// directory nor a Vite development middleware is mounted. Verify before listen.
export async function serveBeta({root,port=0,host='127.0.0.1',apiTarget,publicOrigin}){
 const manifest=await verifyDirectory(root),routes=new Map(manifest.routes.map(r=>[r.url,r]));
 const target=apiTarget?new URL(apiTarget):null;
 const publicSite=publicOrigin?new URL(publicOrigin):null;
 if(publicSite&&(publicSite.protocol!=='https:'||publicSite.username||publicSite.password||publicSite.pathname!=='/'||publicSite.search||publicSite.hash))throw Error('Expected public HTTPS origin');
 if(target&&(!['http:','https:'].includes(target.protocol)||target.username||target.password||target.pathname!=='/'))throw Error('Expected trusted API origin');
 const server=http.createServer((req,res)=>{
  let name;try{name=decodeURIComponent(new URL(req.url,'http://release.invalid').pathname);}catch{res.writeHead(400);res.end();return;}
  res.setHeader('X-Content-Type-Options','nosniff');
  if(publicSite&&req.headers.host!==publicSite.host){res.writeHead(400);res.end();return;}
  if(name.startsWith('/api/')){
   if(!target||name.includes('//')||/^\/api\/(?:development|debug)(?:\/|$)/.test(name)){res.writeHead(404);res.end();return;}
   const headers={...req.headers};for(const k of Object.keys(headers))if(k.startsWith('x-forwarded-')||k==='forwarded')delete headers[k];
   headers['x-forwarded-host']=publicSite?.host??req.headers.host;headers['x-forwarded-proto']=publicSite?'https':'http';headers['x-forwarded-for']=req.socket.remoteAddress;
   // Assign pathname rather than resolving a network-path reference. A request
   // such as /api//other-host must never change the configured upstream origin.
   const upstream=new URL(target);upstream.pathname=name.slice(4);upstream.search=new URL(req.url,'http://release.invalid').search;
   const proxy=(target.protocol==='https:'?https:http).request(upstream,{method:req.method,headers,timeout:30000},up=>{res.writeHead(up.statusCode,{...up.headers,'cache-control':'no-store'});up.pipe(res);});
   proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});proxy.on('timeout',()=>proxy.destroy());req.on('aborted',()=>proxy.destroy());req.pipe(proxy);return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
  const original=routes.get(name==='/'?'/index.html':name);
  let r=original;
  if(!r){res.writeHead(404,{'Cache-Control':'no-store'});res.end();return;}
  const encoding=assetEncoding(req.headers['accept-encoding'],!!r.gzip&&!req.headers.range||!!r.encoding);
  if(encoding===null||r.encoding&&encoding!==r.encoding){res.writeHead(406);res.end();return;}
  if(r.gzip){res.setHeader('Vary','Accept-Encoding');if(encoding==='gzip')r={...r,...r.gzip,encoding:'gzip'};}
  const etag='"'+manifest.releaseId+'-'+r.file.split('/').at(-1)+'-'+r.offset+'-'+r.length+'"';
  res.setHeader('ETag',etag);res.setHeader('Cache-Control',/[-/][a-fA-F0-9_-]{8,}\.(?:js|css|bin|gz)$/.test(name)?'public, max-age=31536000, immutable':'no-cache');res.setHeader('Content-Type',r.mime??'application/octet-stream');
  if(String(req.headers['if-none-match']??'').split(',').some(tag=>tag.trim()==='*'||tag.trim().replace(/^W\//,'')===etag)){res.writeHead(304);res.end();return;}
  let start=0,end=r.length-1;
  if(r.encoding){res.setHeader('Content-Encoding',r.encoding);res.setHeader('Vary','Accept-Encoding');}
  if(req.headers.range&&(!req.headers['if-range']||req.headers['if-range']===etag)){
   const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match||r.encoding){res.writeHead(416,{'Content-Range':`bytes */${r.length}`});res.end();return;}
   start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=r.length){res.writeHead(416,{'Content-Range':`bytes */${r.length}`});res.end();return;}
   res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${r.length}`);
  }
  res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',Math.max(0,end-start+1));
  if(req.method==='HEAD'||!r.length){res.end();return;}
  const stream=createReadStream(path.join(root,r.file),{start:r.offset+start,end:r.offset+end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 return {server,manifest,url:`http://${host}:${server.address().port}`,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw Error('Usage: serve.mjs PACKAGE (SRO_BETA_PORT / SRO_AGENT_PROXY_TARGET)');
 const service=await serveBeta({root:path.resolve(process.argv[2]),port:Number(process.env.SRO_BETA_PORT??4180),apiTarget:process.env.SRO_AGENT_PROXY_TARGET,publicOrigin:process.env.SRO_BETA_PUBLIC_ORIGIN});console.log(service.url);
}
