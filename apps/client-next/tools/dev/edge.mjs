import {readFileSync} from 'node:fs';

// Development and preview web edge, the same contract as the production edge
// in docs/HOSTING.md: /api reaches Agent, and every shard whose catalog
// publicTransportUrl is a route reaches its GameWorld through this origin.

// Each route serves <route>/transport/* (socket and references) from the
// shard's own transportUrl, so pages dial their origin from any host or scheme.
export function shardRoutes(catalogFile){
 let catalog;
 try{catalog=JSON.parse(readFileSync(catalogFile,'utf8'));}
 catch(cause){throw Error(`Shard catalog ${catalogFile} is unreadable; set SRO_SHARD_CATALOG`,{cause});}
 return Object.fromEntries(catalog.shards.filter(shard=>shard.publicTransportUrl?.startsWith('/')).map(({publicTransportUrl:route,transportUrl:target})=>[`${route}/transport`,{
  target,ws:true,changeOrigin:true,
  rewrite:path=>path.slice(route.length),
  configure:relaySameOrigin
 }]));
}

// The edge vouches for its own pages: a request whose Origin is this server
// reaches loopback-only upstream policies as a local caller, without Origin.
// Any other Origin is forwarded untouched and meets the upstream allowlist.
export function relaySameOrigin(proxy){
 const relay=(proxyReq,req)=>{const origin=req.headers.origin;if(origin&&origin.toLowerCase()===ownOrigin(req))proxyReq.removeHeader('origin');};
 proxy.on('proxyReq',relay);
 proxy.on('proxyReqWs',relay);
}

// HTTP/2 names the authority in pseudo-headers; HTTP/1.1 and upgrades use Host.
function ownOrigin(req){
 const host=req.headers[':authority']??req.headers.host,scheme=req.headers[':scheme']??(req.socket.encrypted?'https':'http');
 return host?`${scheme}://${host}`.toLowerCase():null;
}

// `pnpm dev:https` certificate: an explicit pair (mkcert, trusted wherever its
// CA is installed), or null for @vitejs/plugin-basic-ssl's self-signed one.
export function tlsCertificate(env){
 const {SRO_DEV_TLS_CERT:cert,SRO_DEV_TLS_KEY:key}=env;
 if(!cert&&!key)return null;
 if(!cert||!key)throw Error('Set both SRO_DEV_TLS_CERT and SRO_DEV_TLS_KEY');
 return {cert:readFileSync(cert),key:readFileSync(key)};
}
