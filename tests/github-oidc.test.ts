import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {verifyGithubOidc,OidcRejected,GITHUB_OIDC_ISSUER,jwksFetchNeeded,JWKS_CACHE_MS,JWKS_FORCED_REFRESH_MIN_MS} from "../packages/domain/github-oidc.ts";
const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const other=generateKeyPairSync("rsa",{modulusLength:2048});
const keys=[{...publicKey.export({format:"jwk"}),kid:"k1"}];
const expect={audience:"public-debate-engine-operations",repositoryId:"1413777544",repository:"Galinsky-2028/Debate-Engine",
 workflowPath:".github/workflows/scheduled-operations.yml",ref:"refs/heads/main",events:["schedule","workflow_dispatch"]};
const now=1_800_000_000;
const good={iss:GITHUB_OIDC_ISSUER,aud:expect.audience,iat:now-10,nbf:now-10,exp:now+300,repository_id:"1413777544",
 repository:expect.repository,ref:expect.ref,workflow_ref:expect.repository+"/"+expect.workflowPath+"@"+expect.ref,event_name:"schedule"};
const enc=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString("base64url");
function jwt(claims:Record<string,unknown>,key=privateKey,kid="k1",alg="RS256"){
 const head=enc({alg,kid,typ:"JWT"})+"."+enc(claims);
 return head+"."+sign("RSA-SHA256",Buffer.from(head),key).toString("base64url");
}
test("accepts only the main-branch scheduler workflow of this repository",()=>{
 assert.equal(verifyGithubOidc(jwt(good),keys,now,expect).event_name,"schedule");
 assert.ok(verifyGithubOidc(jwt({...good,event_name:"workflow_dispatch"}),keys,now,expect));
});
test("rejects forged, foreign, stale or mis-scoped tokens",()=>{
 const bad:Array<[string,string]>=[
  [jwt(good,other.privateKey),"signature"],[jwt(good,privateKey,"k2"),"unknown key"],[jwt(good,privateKey,"k1","HS256"),"alg"],
  [jwt({...good,iss:"https://evil.example"}),"issuer"],[jwt({...good,aud:"other"}),"audience"],
  [jwt({...good,exp:now-120}),"expired"],[jwt({...good,iat:now+600}),"future"],
  [jwt({...good,repository_id:"1"}),"repo id"],[jwt({...good,repository:"someone/Debate-Engine"}),"repo name"],
  [jwt({...good,ref:"refs/heads/feature",workflow_ref:expect.repository+"/"+expect.workflowPath+"@refs/heads/feature"}),"branch"],
  [jwt({...good,workflow_ref:expect.repository+"/.github/workflows/ci.yml@refs/heads/main"}),"workflow"],
  [jwt({...good,event_name:"pull_request"}),"event"],["a.b",""],["x.y.z","garbage"],
 ];
 for(const [token,label] of bad)assert.throws(()=>verifyGithubOidc(token,keys,now,expect),OidcRejected,label);
 const [h,,s]=jwt(good).split(".");
 assert.throws(()=>verifyGithubOidc(h+"."+enc({...good,repository_id:"1"})+"."+s,keys,now,expect),OidcRejected,"tampered payload");
});

test("an unknown key forces at most one GitHub key fetch a minute",()=>{
 const t=1_000_000;
 assert.equal(jwksFetchNeeded(null,t,false),true);
 assert.equal(jwksFetchNeeded(t,t+1000,false),false);
 assert.equal(jwksFetchNeeded(t,t+JWKS_CACHE_MS,false),true);
 assert.equal(jwksFetchNeeded(t,t+1000,true),false); // repeated bogus key ids cannot hammer GitHub
 assert.equal(jwksFetchNeeded(t,t+JWKS_FORCED_REFRESH_MIN_MS,true),true);
});
