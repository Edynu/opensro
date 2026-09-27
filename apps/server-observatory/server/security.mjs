export function allowedRequest(req,port){
 const hosts=[`127.0.0.1:${port}`,`localhost:${port}`];
 return hosts.includes(req.headers.host)&&(!req.headers.origin||hosts.map(h=>'http://'+h).includes(req.headers.origin))&&req.headers['sec-fetch-site']!=='cross-site'&&!req.headers.forwarded&&!req.headers['x-forwarded-for'];
}
