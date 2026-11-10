#!/usr/bin/env node
import {inspectScannerJob,validateScannerJob} from '../packages/media/laptop-worker.ts';
import {probeClamd} from '../packages/media/clamav.ts';
const origin=process.env.PDE_APP_URL;
const token=process.env.PDE_SCANNER_TOKEN||'';
const socket=process.env.CLAMD_SOCKET_PATH||'/run/clamav/clamd.ctl';
if(!origin||new URL(origin).origin!==origin||!origin.startsWith('https://')||token.length<64)throw Error('Download scanner.env from your administrator workspace before starting.');
let stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;});
async function post(path,body){
 const result=await fetch(origin+path,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!result.ok)throw Error('Platform scanner request failed: HTTP '+result.status);
 return result.json();
}
console.log('Paired laptop scanner started. Keep this running to accept uploads.');
while(!stopping){
 try{
  if(!await probeClamd(socket))throw Error('Local malware scanner is offline.');
  const {job}=await post('/api/scanner/jobs',{});
  if(job){
   validateScannerJob(job);
   let verdict='unavailable';
   try{verdict=await inspectScannerJob(job,socket);}catch{console.error('Original could not be safely scanned; no clean result issued.');}
   await post('/api/scanner/jobs/'+job.id,{sha256:job.sha256,leaseToken:job.leaseToken,verdict});
   console.log(verdict==='clean'?'Original scanned clean.':verdict==='detected'?'Unsafe original rejected.':'Scan will retry.');
  }
 }catch(e){console.error(e instanceof Error?e.message:'Scanner temporarily unavailable.');}
 await new Promise(resolve=>setTimeout(resolve,3000));
}
