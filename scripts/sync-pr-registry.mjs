#!/usr/bin/env node
/**
 * Refreshes the dated GitHub observation inside the single canonical plan, registry/prs.json.
 * It reads no other plan file. It may only: replace `pullRequests` with authoritative REST data,
 * append a merged PR to a unit's `prs` when the PR title starts with that unit's exact stable ID,
 * and recompute each unit's `openPullRequests`. Every other document and unit field — acceptance,
 * acceptanceNote, state, implementation, dependencies, operational gates — is preserved verbatim.
 */
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {parsePrRegistry,titleWorkUnitIds} from "../registry/pr-contract.mjs";
const PROTECTED=["id","title","origin","state","implementation","acceptance","acceptanceNote","contributingPrs","priorEvidencePrs","dependsOn","externalDependencies","externalPrerequisites"];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const ascending=(a,b)=>a-b;
export function toRecord(repository,p){
 if(!p||!Number.isSafeInteger(p.number)||p.number<1||typeof p.title!=="string")throw Error("Unexpected GitHub pull request record.");
 return {id:p.id,number:p.number,title:p.title,url:"https://github.com/"+repository+"/pull/"+p.number,state:p.state,draft:p.draft===true,
  createdAt:p.created_at,updatedAt:p.updated_at,closedAt:p.closed_at??null,mergedAt:p.merged_at??null,
  headSha:p.head?.sha??null,baseRef:p.base?.ref??null,mergeCommitSha:p.merge_commit_sha??null};
}
export function mergeRegistry(old,githubPullRequests,observedAt){
 if(!old||old.schemaVersion!==1||old.planVerified!==true||!Array.isArray(old.units)||!old.units.length||old.units.length!==old.plannedPrCount||!Array.isArray(old.pullRequests))
  throw Error("Unverified plan or changed plan denominator: refuse to overwrite registry.");
 const pullRequests=githubPullRequests.map(p=>toRecord(old.repository,p)).sort((a,b)=>b.number-a.number);
 const observed=new Set(pullRequests.map(p=>p.number));
 // GitHub never deletes pull requests. A shorter listing is partial data, not evidence.
 const missing=old.pullRequests.filter(p=>!observed.has(p.number)).map(p=>p.number);
 if(missing.length)throw Error("GitHub listing omits previously recorded pull requests: "+missing.join(", "));
 const explicit=new Set(old.units.flatMap(u=>[...(u.prs??[]),...(u.contributingPrs??[]),...(u.priorEvidencePrs??[])]));
 const units=old.units.map(unit=>{
  const titled=pullRequests.filter(p=>titleWorkUnitIds(p.title).includes(unit.id));
  // Only merged work becomes a durable mapping, and never a PR a human already mapped anywhere.
  const additions=titled.filter(p=>p.mergedAt!==null&&!explicit.has(p.number)).map(p=>p.number);
  const prs=additions.length?[...new Set([...unit.prs,...additions])].sort(ascending):unit.prs;
  const linked=new Set([...prs,...titled.filter(p=>!explicit.has(p.number)||unit.prs.includes(p.number)).map(p=>p.number)]);
  const openPullRequests=pullRequests.filter(p=>p.state==="open"&&linked.has(p.number)).map(p=>p.number).sort(ascending);
  const next={...unit,prs,openPullRequests};
  for(const key of PROTECTED)if(!same(next[key],unit[key]))throw Error("Protected field "+key+" changed for "+unit.id);
  return next;
 });
 const next={...old,observedAt,units,pullRequests};
 // Only move observedAt when the authoritative PR data or an exact-ID mapping changes.
 if(same({...old,observedAt:null},{...next,observedAt:null}))return {changed:false,registry:old};
 parsePrRegistry(JSON.stringify(next),old.repository);
 return {changed:true,registry:next};
}
export async function listGithubPullRequests({repo,token,fetchImpl=fetch}){
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))
  throw Error("Invalid repo name.");
 const results=[];
 for(let page=1;page<=100;page++){
  const url="https://api.github.com/repos/"+repo+"/pulls?state=all&per_page=100&page="+page;
  const response=await fetchImpl(url,{headers:{
   Accept:"application/vnd.github+json",Authorization:"Bearer "+token,
   "X-GitHub-Api-Version":"2022-11-28","User-Agent":"public-debate-engine-pr-sync"
  }});
  if(!response.ok)throw Error("GitHub API failed on page "+page+": HTTP "+response.status);
  const rows=await response.json();
  if(!Array.isArray(rows))throw Error("Unexpected GitHub pull request response.");
  results.push(...rows);
  if(rows.length<100)return results;
 }
 throw Error("PR registry exceeds the protected 10,000 PR pagination limit.");
}
async function main(){
 const token=process.env.GITHUB_TOKEN;
 if(!token)throw Error("Authenticated GITHUB_TOKEN is required.");
 const path=resolve(process.cwd(),"registry","prs.json");
 const body=await readFile(path,"utf8");
 const repo=process.env.GITHUB_REPOSITORY;
 // The stored registry must already satisfy the shared contract for exactly this repository.
 const prior=parsePrRegistry(body,repo).document;
 const prs=await listGithubPullRequests({repo,token});
 const result=mergeRegistry(prior,prs,new Date().toISOString().replace(/\.\d{3}Z$/,"Z"));
 if(result.changed)await writeFile(path,JSON.stringify(result.registry,null,2)+"\n");
 console.log(result.changed?"Updated machine-readable PR registry from GitHub.":"PR registry already current.");
 console.log(JSON.stringify({repo,observedPullRequests:prs.length,plannedUnits:prior.plannedPrCount,changed:result.changed}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 main().catch(e=>{console.error(e instanceof Error?e.message:"Unexpected registry sync error.");process.exitCode=1});
}
