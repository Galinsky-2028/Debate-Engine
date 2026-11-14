#!/usr/bin/env node
/** Read-only smoke test of the live deployment (PDE_PREVIEW_URL). Never changes live data or sends a candidate invitation. */
import assert from "node:assert/strict";
const base=process.env.PDE_PREVIEW_URL;
if(!base?.startsWith("https://"))throw Error("Explicit HTTPS PDE_PREVIEW_URL is required.");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function check(path,expected,{method="GET",origin,validate=()=>{}}={}){
 let last;
 for(let attempt=0;attempt<14;attempt++){
  try{
   const r=await fetch(new URL(path,base),{method,headers:{...(origin?{origin}:{})},signal:AbortSignal.timeout(25000),cache:"no-store"});
   const data=await r.text();
   if(r.status===expected){
    validate(r,data);
    console.log("PASS",path,r.status);
    return;
   }
   last=Error("Expected "+expected+" at "+path+", got "+r.status+" : "+data.slice(0,200));
  }catch(e){last=e;}
  // A free Render instance can sleep, restart or be deploying. Retry within a bounded window.
  await sleep(15000);
 }
 throw last;
}
await check("/api/health",200,{validate:(_r,text)=>{
 const j=JSON.parse(text);
 assert.equal(j.status,"ok");
 assert.equal(j.service,"public-debate-engine");
 assert.match(j.version,/^(?:[0-9a-f]{7,40}|unknown)$/);
}});
await check("/api/ready",200,{validate:(_r,text)=>{
 const j=JSON.parse(text);
 assert.equal(j.status,"ready");
 assert.equal(j.database,"connected");
}});
await check("/api/capabilities",200,{validate:(_r,text)=>{
 const value=JSON.parse(text);
 assert.ok(["online","unavailable"].includes(value.mediaScanner));
 assert.ok(["blocked","available_for_validation"].includes(value.newMediaUploadPreflight));
 assert.equal(typeof value.mediaStorageConfigured,"boolean");
 assert.equal(value.productionMediaAcceptance,"pending");
}});
await check("/api/elections",200,{validate:(_r,text)=>assert.ok(Array.isArray(JSON.parse(text).elections))});
await check("/api/debates",200,{validate:(_r,text)=>assert.ok(Array.isArray(JSON.parse(text).debates))});
await check("/api/account/me",401);
await check("/api/admin/candidacies",401);
await check("/api/media/upload",403,{method:"POST",origin:"https://not-this-website.example"});
await check("/debates",200);
await check("/candidates",200);
await check("/press",200);
await check("/feed.xml",200,{validate:(r,text)=>{
 assert.match(r.headers.get("content-type")||"",/rss\+xml/);
 assert.match(text,/<rss version="2.0">/);
}});
await check("/robots.txt",200);
await check("/sitemap.xml",200);
console.log("Live deployment smoke checks passed.");
