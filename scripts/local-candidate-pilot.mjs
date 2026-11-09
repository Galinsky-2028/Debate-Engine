#!/usr/bin/env node
/** Disposable local copy of the existing signed-session browser pilot. Never alters real auth. */
import {mkdtemp,cp,symlink,readFile,open,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import https from 'node:https';
import net from 'node:net';

const source=process.cwd();
const directory=await mkdtemp('/tmp/pde-local-pilot-');
const excluded=new Set(['.git','.next','node_modules','.env','.env.local','.env.production']);
await cp(source,directory,{recursive:true,filter:path=>{const name=path.split('/').at(-1);return !excluded.has(name)&&(!name.startsWith('.env')||name==='.env.example')}});
await symlink(resolve(source,'node_modules'),join(directory,'node_modules'),'dir');
const env={...process.env,PDE_LOCAL_PILOT_RUN:'true',PDE_LOCAL_PILOT_DIRECTORY:directory,
 DATABASE_URL:'postgresql://debate_ci:test_only_password@localhost:5432/debate_ci',
 PDE_BROWSER_URL:'https://127.0.0.1:3443',PDE_CI_AUTH_KEY:randomBytes(32).toString('hex'),NEXT_TELEMETRY_DISABLED:'1'};
delete env.GITHUB_ACTIONS;delete env.PDE_CI_PILOT_RUN;
delete env.NEON_AUTH_BASE_URL;delete env.NEON_AUTH_COOKIE_SECRET;
async function run(command,args,log){
 const file=await open(join(directory,log),'w');
 try{
  const child=spawn(command,args,{cwd:directory,env,stdio:['ignore',file.fd,file.fd]});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});
  if(code!==0)throw Error(log+' failed; inspect '+join(directory,log));
 }finally{await file.close()}
}
for(const port of [3100,3443]){
 const occupied=await new Promise(resolve=>{
  const socket=net.connect({host:'127.0.0.1',port});
  socket.once('connect',()=>{socket.destroy();resolve(true)});
  socket.once('error',()=>resolve(false));
 });
 if(occupied)throw Error('Pilot port '+port+' is already in use; existing services were left alone.');
}
console.log('Fictional candidate pilot copy and logs: '+directory);
await run('npm',['run','db:migrate'],'migrate.log');
await run('node',['scripts/install-ci-pilot-auth.mjs'],'fixture.log');
await run('npm',['run','build','--','--webpack'],'build.log');
await run('openssl',['req','-x509','-nodes','-newkey','rsa:2048','-days','1','-subj','/CN=localhost',
 '-addext','subjectAltName=IP:127.0.0.1,DNS:localhost','-keyout',join(directory,'test-key.pem'),'-out',join(directory,'test-cert.pem')],'certificate.log');
env.PDE_LOCAL_PILOT_TLS_KEY=join(directory,'test-key.pem');
env.PDE_LOCAL_PILOT_TLS_CERT=join(directory,'test-cert.pem');
const servers=[],logs=[];
try{
 for(const [command,args,name] of [['npm',['run','start','--','--port','3100'],'server.log'],['node',['scripts/ci-local-https-proxy.mjs'],'proxy.log']]){
  const log=await open(join(directory,name),'w');logs.push(log);
  servers.push(spawn(command,args,{cwd:directory,env,stdio:['ignore',log.fd,log.fd],detached:true}));
 }
 const ca=await readFile(env.PDE_LOCAL_PILOT_TLS_CERT);
 let ready=false;
 for(let attempt=0;attempt<100;attempt++){
  ready=await new Promise(resolve=>{
   const request=https.get(env.PDE_BROWSER_URL,{ca},response=>{response.resume();resolve(response.statusCode===200)});
   request.setTimeout(2000,()=>request.destroy());request.once('error',()=>resolve(false));
  });
  if(ready)break;
  if(servers.some(p=>p.exitCode!==null))break;
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 if(!ready)throw Error('Pilot did not become ready; inspect logs in '+directory);
 await run('node',['scripts/browser-two-candidate-pilot.mjs'],'pilot.log');
 console.log(await readFile(join(directory,'pilot.log'),'utf8'));
}finally{
 for(const child of servers){if(child.exitCode===null)try{process.kill(-child.pid,'SIGTERM')}catch{}}
 for(const log of logs)await log.close();
 await unlink(join(directory,'test-key.pem')).catch(()=>{});
}
