import {createServer} from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// An OS-owned localhost socket is released even if a probe crashes. No stale
// lock deletion, PID reuse assumptions, or interference with another browser.
export async function acquirePerformanceLease({port=5199,legacyCheck=true}={}){
 const server=createServer(socket=>socket.end('SRO performance capture in progress\n'));
 await new Promise((resolve,reject)=>{
  server.once('error',error=>reject(error.code==='EADDRINUSE'?Error(`Performance capture lease busy on localhost:${port}; finish the other probe before collecting timings`):error));
  server.listen({host:'127.0.0.1',port,exclusive:true},resolve);
 });
 server.unref();
 const release=()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 try{
  // Also detect probes launched before this guard was installed. Do not expose
  // command lines (which can contain credentials), and never terminate them.
  if(legacyCheck&&process.platform==='win32'){
   const command=`$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains('profile-world.mjs') } | ForEach-Object { $_.ProcessId }) | ConvertTo-Json -Compress`;
   const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000,maxBuffer:65536});
   const value=stdout.trim()?JSON.parse(stdout):[],ids=Array.isArray(value)?value:[value];
   if(ids.length)throw Error(`Concurrent world probe PID(s) ${ids.join(', ')}; timings would be contaminated`);
  }
  return {port:server.address().port,release};
 }catch(error){await release();throw error;}
}
