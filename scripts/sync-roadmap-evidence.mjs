#!/usr/bin/env node
/** GitHub PR evidence -> roadmap implementation metadata, without changing acceptance. */
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
export function reconcileRoadmap(roadmap,registry){
 if(!roadmap?.planVerified||!registry?.planVerified||
  roadmap.repository!==registry.repository||
  roadmap.plannedPrCount!==registry.plannedPrCount||
  roadmap.milestones?.length!==roadmap.plannedPrCount||
  registry.units?.length!==roadmap.plannedPrCount)
  throw Error("Roadmap and PR evidence must be verified and share the same fixed plan.");
 const prs=new Map(registry.pullRequests.map(p=>[p.number,p]));
 const units=new Map(registry.units.map(u=>[u.id,u]));
 let changes=0;
 const milestones=roadmap.milestones.map(m=>{
  const nums=units.get(m.id)?.prs||[];
  const links=[...(m.pullRequests||[])];
  const active=[];
  const merged=[];
  for(const num of nums){
   const pr=prs.get(num);
   if(!pr)continue;
   if(pr.mergedAt){merged.push(pr);if(!links.includes(pr.url))links.push(pr.url)}
   if(pr.state==="open"){active.push(pr.url);if(!links.includes(pr.url))links.push(pr.url)}
  }
  const next={...m,pullRequests:links,openPullRequests:active};
  // A merged implementation PR provides source evidence of partial progress,
  // NEVER proof that all requirements or release acceptance are complete.
  if(merged.length&&next.implementation==="not_started")next.implementation="partial";
  if(merged.length&&["approved_not_started","pending","implementation_open"].includes(next.state))
   next.state="implementation_partially_merged_operational_acceptance_pending";
  else if(active.length&&!merged.length&&["approved_not_started","pending"].includes(next.state))
   next.state="implementation_open";
  // Always preserve independent acceptance and acceptanceNote verbatim.
  if(next.acceptance!==m.acceptance||next.acceptanceNote!==m.acceptanceNote)throw Error("Acceptance fields changed unexpectedly.");
  if(JSON.stringify(next)!==JSON.stringify(m))changes++;
  return next;
 });
 return {changed:changes>0,modifiedMilestones:changes,roadmap:{...roadmap,milestones}};
}
export function reconcileCanonicalRegistry(registry){
 const outcome=reconcileRoadmap({...registry,milestones:registry.units},registry);
 const units=outcome.roadmap.milestones.map((unit,i)=>{
  const next={...unit};
  // Canonical units already reference PR numbers; do not duplicate every URL.
  if(!Object.hasOwn(registry.units[i],'pullRequests'))delete next.pullRequests;
  return next;
 });
 const changed=JSON.stringify(units)!==JSON.stringify(registry.units);
 return {changed,modifiedMilestones:units.filter((u,i)=>JSON.stringify(u)!==JSON.stringify(registry.units[i])).length,registry:{...registry,units}};
}
async function main(){
 const root=resolve(process.cwd(),"registry");
 const registry=JSON.parse(await readFile(resolve(root,"prs.json"),"utf8"));
 const outcome=reconcileCanonicalRegistry(registry);
 if(outcome.changed)await writeFile(resolve(root,"prs.json"),JSON.stringify(outcome.registry,null,2)+"\n");
 console.log(JSON.stringify({changed:outcome.changed,modifiedMilestones:outcome.modifiedMilestones,
  accepted:outcome.registry.units.filter(m=>m.acceptance==="accepted").length,
  planned:outcome.registry.plannedPrCount}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 main().catch(e=>{console.error(e.message);process.exitCode=1});
}
