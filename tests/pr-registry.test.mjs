import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mergeRegistry,listGithubPullRequests} from "../scripts/sync-pr-registry.mjs";
import {parsePrRegistry} from "../registry/pr-contract.mjs";
const make=(n,title="PDE-17: Filter public debates",over={})=>({id:1000+n,number:n,title,html_url:"https://github.com/acme/demo/pull/"+n,state:"closed",draft:false,created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:01:00Z",closed_at:"2026-01-01T00:01:00Z",merged_at:"2026-01-01T00:01:00Z",head:{sha:"abc"},base:{ref:"main"},merge_commit_sha:"xyz",...over});
const open={state:"open",closed_at:null,merged_at:null};
const unmerged={merged_at:null};
const unit=(id,title,prs,extra={})=>({id,title,origin:"original",prs,state:"implementation_partially_merged_operational_acceptance_pending",pr:null,implementation:"partial",acceptance:"pending",openPullRequests:[],acceptanceNote:"Browser pilot pending for "+id,dependsOn:[],externalDependencies:[],externalPrerequisites:[],...extra});
const old={title:"Demo",production_ready:false,operationalAcceptance:{securityReview:"pending"},repository:"acme/demo",planVerified:true,plannedPrCount:2,schemaVersion:1,roadmapVersion:6,observedAt:"2026-01-01T00:00:00Z",
 units:[unit("PDE-17","Public debate discovery",[1]),unit("PDE-30","Production handoff",[],{dependsOn:["PDE-17"],externalPrerequisites:["Owner approval"]})],pullRequests:[]};
const NOW="2026-02-01T00:00:00Z",LATER="2026-03-01T00:00:00Z";
test("maps merged PRs by exact leading stable ID and preserves every unit and document field",()=>{
 const {registry:r,changed}=mergeRegistry(old,[make(1),make(60),make(61,"PDE-30: improve handoff")],NOW);
 assert.equal(changed,true);assert.equal(r.plannedPrCount,2);assert.equal(r.observedAt,NOW);
 assert.deepEqual(r.units[0].prs,[1,60]);assert.deepEqual(r.units[1].prs,[61]);
 assert.equal(r.pullRequests[0].number,61);
 assert.equal(r.pullRequests[0].url,"https://github.com/acme/demo/pull/61");
 for(const [index,before] of old.units.entries()){
  const {prs:_a,openPullRequests:_b,...kept}=r.units[index];const {prs:_c,openPullRequests:_d,...expected}=before;
  assert.deepEqual(kept,expected);
  assert.deepEqual(Object.keys(r.units[index]),Object.keys(before));
 }
 const {observedAt:_e,units:_f,pullRequests:_g,...envelope}=r;const {observedAt:_h,units:_i,pullRequests:_j,...original}=old;
 assert.deepEqual(envelope,original);
 assert.equal(r.production_ready,false);
 assert.doesNotThrow(()=>parsePrRegistry(JSON.stringify(r),"acme/demo"));
});
test("observedAt moves only when the GitHub observation or a mapping changed",()=>{
 const a=mergeRegistry(old,[make(1),make(60)],NOW).registry;
 const b=mergeRegistry(a,[make(1),make(60)],LATER);
 assert.equal(b.changed,false);
 assert.equal(b.registry.observedAt,NOW);
 assert.equal(b.registry,a);
});
test("mentions, ordinals, unknown IDs and closed-unmerged PRs never create a mapping",()=>{
 const r=mergeRegistry(old,[make(1),make(70,"Follow-up for PDE-17 and PDE-30"),make(71,"Fix PDE-30"),make(72,"PDE-99: unknown unit"),make(73,"PDE-30: abandoned",unmerged),make(74,"17: ordinal only")],NOW).registry;
 assert.deepEqual(r.units[0].prs,[1]);assert.deepEqual(r.units[1].prs,[]);
 assert.deepEqual(r.units[1].openPullRequests,[]);
 assert.equal(r.pullRequests.length,6);
});
test("an explicitly mapped PR is not re-mapped to another unit by its title",()=>{
 const r=mergeRegistry(old,[make(1,"PDE-30: handoff notes that a human mapped to PDE-17")],NOW).registry;
 assert.deepEqual(r.units[0].prs,[1]);assert.deepEqual(r.units[1].prs,[]);
});
test("open follow-ups are reported separately and cleared after they close",()=>{
 const opened=mergeRegistry(old,[make(1),make(80,"PDE-30: handoff draft",{...open,draft:true})],NOW).registry;
 assert.deepEqual(opened.units[1].prs,[]);
 assert.deepEqual(opened.units[1].openPullRequests,[80]);
 assert.equal(opened.units[1].acceptance,"pending");
 const merged=mergeRegistry(opened,[make(1),make(80,"PDE-30: handoff draft")],LATER).registry;
 assert.deepEqual(merged.units[1].prs,[80]);
 assert.deepEqual(merged.units[1].openPullRequests,[]);
 assert.equal(merged.units[1].acceptance,"pending");
 assert.equal(merged.units[1].acceptanceNote,"Browser pilot pending for PDE-30");
 const abandoned=mergeRegistry(opened,[make(1),make(80,"PDE-30: handoff draft",unmerged)],LATER).registry;
 assert.deepEqual(abandoned.units[1].prs,[]);
 assert.deepEqual(abandoned.units[1].openPullRequests,[]);
});
test("unverified plans, changed denominators, partial listings and invalid results are refused",()=>{
 assert.throws(()=>mergeRegistry({...old,plannedPrCount:44},[],NOW),/denominator/);
 assert.throws(()=>mergeRegistry({...old,planVerified:false},[],NOW),/Unverified/);
 const current=mergeRegistry(old,[make(1),make(60)],NOW).registry;
 assert.throws(()=>mergeRegistry(current,[make(60)],LATER),/omits previously recorded/);
 assert.throws(()=>mergeRegistry(old,[make(1),make(1)],NOW),/Invalid, duplicate, or contradictory/);
 assert.throws(()=>mergeRegistry(old,[make(1,"PDE-17: contradictory",{state:"open"})],NOW),/Invalid, duplicate, or contradictory/);
});
test("reads multiple pages, rejects GitHub API failures and never swallows partial data",async()=>{
 const fake=async url=>({ok:true,json:async()=>new URL(url).searchParams.get("page")==="1"?Array.from({length:100},(_,i)=>make(i+1)):[make(101)]});
 const r=await listGithubPullRequests({repo:"acme/demo",token:"test",fetchImpl:fake});
 assert.equal(r.length,101);
 await assert.rejects(listGithubPullRequests({repo:"acme/demo",token:"test",fetchImpl:async()=>({ok:false,status:403})}));
});
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("the committed registry is valid for the transferred repository and is the only active plan",()=>{
 const body=read("registry/prs.json");
 const {document}=parsePrRegistry(body,"Galinsky-2028/Debate-Engine");
 assert.equal(document.units.length,44);
 assert.ok(document.previousRepositoryNames.includes("neophilism/Debate-Engine"));
 assert.ok(document.pullRequests.every(pr=>pr.url==="https://github.com/Galinsky-2028/Debate-Engine/pull/"+pr.number));
 assert.throws(()=>parsePrRegistry(body,"neophilism/Debate-Engine"));
 const retired=JSON.parse(read("registry/roadmap.json"));
 assert.equal(retired.repository,document.repository);
 assert.equal(retired.deprecated,true);
 assert.equal(Object.hasOwn(retired,"milestones"),false);
 const sync=read("scripts/sync-pr-registry.mjs");
 assert.doesNotMatch(sync,/roadmap\.json/);
 const scripts=JSON.parse(read("package.json")).scripts;
 assert.equal(Object.hasOwn(scripts,"roadmap:sync"),false);
});
test("PDE-32 keeps one product name and one canonical plan after the repository transfer",()=>{
 const readme=read("README.md");
 const handoff=read("docs/CURRENT_STATUS_AND_HANDOFF.md");
 const transition=read("docs/REPOSITORY_NAME_TRANSITION.md");
 assert.match(readme,/^# Public Debate Engine/m);
 assert.match(readme,/Full 44-unit development plan/);
 assert.match(readme,/Canonical 44-unit PR registry/);
 assert.match(handoff,/\*\*Product:\*\* Public Debate Engine/);
 assert.match(handoff,/registry\/prs\.json/);
 assert.match(transition,/canonical `registry\/prs\.json`/);
 assert.match(transition,/repository now lives at `Galinsky-2028\/Debate-Engine`/);
 assert.match(transition,/GitHub redirects the old `neophilism\/Debate-Engine` path/);
 assert.match(transition,/owner decision that has not been made/);
 assert.doesNotMatch(transition,/currently hosted GitHub repository slug is `neophilism/);
 assert.doesNotMatch(readme,/Full 30-milestone/);
 assert.doesNotMatch(handoff,/See `registry\/roadmap\.json` for each milestone/);
});
