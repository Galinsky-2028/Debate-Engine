import "server-only";
import type {NextRequest} from "next/server";
import {HttpError} from "./http";
import {scheduledTokenValid} from "../../packages/domain/scheduled-token";
import {GITHUB_OIDC_ISSUER,OidcRejected,verifyGithubOidc,type GithubJwk} from "../../packages/domain/github-oidc";

/** The only workflow allowed to trigger scheduled operations: this repository's main-branch scheduler. */
export const SCHEDULER_IDENTITY={
 audience:"public-debate-engine-operations",repositoryId:"1413777544",repository:"Galinsky-2028/Debate-Engine",
 workflowPath:".github/workflows/scheduled-operations.yml",ref:"refs/heads/main",events:["schedule","workflow_dispatch"],
} as const;
let cache:{keys:GithubJwk[];fetchedAt:number}|null=null;
async function githubKeys(force=false){
 if(!force&&cache&&Date.now()-cache.fetchedAt<10*60*1000)return cache.keys;
 const r=await fetch(GITHUB_OIDC_ISSUER+"/.well-known/jwks",{signal:AbortSignal.timeout(10000),cache:"no-store"});
 if(!r.ok)throw new HttpError(503,"GitHub signing keys are unavailable.");
 const body=await r.json() as {keys?:GithubJwk[]};
 cache={keys:Array.isArray(body.keys)?body.keys:[],fetchedAt:Date.now()};
 return cache.keys;
}
/**
 * A machine caller proves itself either with a GitHub Actions OIDC token minted for this repository's scheduler
 * workflow on main (no stored secret), or with an optional long OPERATIONS_RUN_TOKEN for another scheduler.
 */
export async function requireScheduledCaller(request:NextRequest):Promise<"github_oidc"|"token">{
 const authorization=request.headers.get("authorization");
 if(scheduledTokenValid(process.env.OPERATIONS_RUN_TOKEN,authorization))return "token";
 const bearer=authorization?.startsWith("Bearer ")?authorization.slice(7):"";
 if(bearer.split(".").length===3){
  const now=Math.floor(Date.now()/1000);
  try{verifyGithubOidc(bearer,await githubKeys(),now,SCHEDULER_IDENTITY);return "github_oidc";}
  catch(e){
   if(e instanceof OidcRejected&&e.message==="Unknown signing key."){
    try{verifyGithubOidc(bearer,await githubKeys(true),now,SCHEDULER_IDENTITY);return "github_oidc";}catch{}
   }else if(!(e instanceof OidcRejected))throw e;
  }
 }
 throw new HttpError(401,"A valid scheduler identity is required.");
}
