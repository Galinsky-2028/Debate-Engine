import test from "node:test";
import assert from "node:assert/strict";
import {reconcileRoadmap,reconcileCanonicalRegistry} from "../scripts/sync-roadmap-evidence.mjs";
const meta={repository:"acme/project",planVerified:true,plannedPrCount:2};
const roadmap={...meta,production_ready:false,operationalAcceptance:{securityReview:"pending"},milestones:[
 {id:"PDE-36",title:"Written revisions",state:"approved_not_started",implementation:"not_started",acceptance:"pending",acceptanceNote:"Browser pilot pending",pullRequests:[],openPullRequests:[]},
 {id:"PDE-44",title:"Independent review",state:"approved_not_started",implementation:"not_started",acceptance:"pending",acceptanceNote:"Not approved",pullRequests:[],openPullRequests:[]}
]};
const registry={...meta,units:[{id:"PDE-36",prs:[4,8]},{id:"PDE-44",prs:[9]}],
 pullRequests:[
  {number:4,state:"closed",mergedAt:"2026-10-11T12:00:00Z",url:"https://github.com/acme/project/pull/4"},
  {number:8,state:"open",mergedAt:null,url:"https://github.com/acme/project/pull/8"},
  {number:9,state:"closed",mergedAt:null,url:"https://github.com/acme/project/pull/9"}
 ]};
test("real merged work changes not-started to partial without marking accepted",()=>{
 const r=reconcileRoadmap(roadmap,registry);
 assert.equal(r.modifiedMilestones,1);
 assert.equal(r.roadmap.milestones[0].implementation,"partial");
 assert.equal(r.roadmap.milestones[0].acceptance,"pending");
 assert.equal(r.roadmap.milestones[0].acceptanceNote,"Browser pilot pending");
 assert.deepEqual(r.roadmap.milestones[0].openPullRequests,["https://github.com/acme/project/pull/8"]);
 assert.equal(r.roadmap.milestones[1].implementation,"not_started");
 assert.equal(r.roadmap.production_ready,false);
});
test("reconciliation is idempotent and cannot change denominator",()=>{
 const first=reconcileRoadmap(roadmap,registry).roadmap;
 assert.equal(reconcileRoadmap(first,registry).changed,false);
 assert.throws(()=>reconcileRoadmap({...roadmap,plannedPrCount:3},registry));
});
test('canonical reconciliation updates units without recreating a retired roadmap or duplicating PR links',()=>{
 const canonical={...registry,production_ready:false,operationalAcceptance:{securityReview:'pending'},units:roadmap.milestones.map((m,i)=>({...m,prs:registry.units[i].prs}))};
 const first=reconcileCanonicalRegistry(canonical);
 assert.equal(first.registry.units[0].implementation,'partial');
 assert.equal(first.registry.units[0].acceptance,'pending');
 assert.deepEqual(first.registry.units[0].openPullRequests,['https://github.com/acme/project/pull/8']);
 assert.equal(Object.hasOwn(first.registry.units[0],'pullRequests'),true);
 const withoutLinks={...canonical,units:canonical.units.map(({pullRequests,...u})=>u)};
 const next=reconcileCanonicalRegistry(withoutLinks).registry;
 assert.equal(Object.hasOwn(next.units[0],'pullRequests'),false);
 assert.equal(reconcileCanonicalRegistry(next).changed,false);
 assert.equal(next.production_ready,false);
 assert.equal(next.operationalAcceptance.securityReview,'pending');
 assert.equal(Object.hasOwn(next,'milestones'),false);
});
