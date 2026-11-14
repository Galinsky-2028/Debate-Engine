import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {policyHash,policyManifestDigest,validatePolicyManifest,type PolicyManifest} from "../packages/domain/policy.ts";
import {lineDiff,diffCounts,branchAgreement,agreementRecordLabel,agreementRecordSentence,agreementFeedItems,futureUseNotice,policyAcceptanceEventKind} from "../packages/domain/policy-view.ts";

// The exact digest formula shipped before scoped proposals existed.
const legacy=(body:string,attachments:string[])=>createHash("sha256").update(JSON.stringify({body:body.replace(/\r\n/g,"\n"),attachments:[...attachments].sort()})).digest("hex");
const body="Fund the rural broadband program through existing appropriations.";
const base:PolicyManifest={body,scope:"full",addressedQuestionIds:[],changesSummary:"",remainingDisagreements:"",attachmentSha256:[]};
const q1="11111111-1111-4111-8111-111111111111",q2="22222222-2222-4222-8222-222222222222";
const sha1="a".repeat(64),sha2="b".repeat(64);

test("legacy full-scope digests are byte-for-byte unchanged",()=>{
 assert.equal(policyHash(body,[]),legacy(body,[]));
 assert.equal(policyHash(body+"\r\nSecond line",[sha2,sha1]),legacy(body+"\r\nSecond line",[sha2,sha1]));
 assert.equal(policyManifestDigest(base),legacy(body,[]));
 assert.equal(policyManifestDigest({...base,attachmentSha256:[sha1]}),legacy(body,[sha1]));
});
test("every scoped field enters the digest, so prior acceptance can never carry over",()=>{
 const d=policyManifestDigest(base);
 const variants:PolicyManifest[]=[
  {...base,scope:"partial",remainingDisagreements:"Funding source"},
  {...base,addressedQuestionIds:[q1]},
  {...base,changesSummary:"Drops the new tax."},
  {...base,remainingDisagreements:"Timeline"},
  {...base,attachmentSha256:[sha1]},
  {...base,body:body+" Amended."}
 ];
 const digests=new Set([d,...variants.map(policyManifestDigest)]);
 assert.equal(digests.size,variants.length+1);
 // Changing only an attachment (same text) is a different version.
 assert.notEqual(policyManifestDigest({...base,attachmentSha256:[sha1]}),policyManifestDigest({...base,attachmentSha256:[sha2]}));
 // Changing only scope (same text and notes) is a different version.
 const partial={...base,remainingDisagreements:"Timeline"};
 assert.notEqual(policyManifestDigest(partial),policyManifestDigest({...partial,scope:"partial"}));
});
test("digest is independent of list ordering but not of list contents",()=>{
 assert.equal(policyManifestDigest({...base,addressedQuestionIds:[q1,q2]}),policyManifestDigest({...base,addressedQuestionIds:[q2,q1]}));
 assert.notEqual(policyManifestDigest({...base,addressedQuestionIds:[q1,q2]}),policyManifestDigest({...base,addressedQuestionIds:[q1]}));
});
test("partial proposals must state remaining disagreements; lists are validated",()=>{
 assert.deepEqual(validatePolicyManifest(base),[]);
 assert.ok(validatePolicyManifest({...base,scope:"partial"}).some(x=>/disagreements/.test(x)));
 assert.deepEqual(validatePolicyManifest({...base,scope:"partial",remainingDisagreements:"Funding"}),[]);
 assert.ok(validatePolicyManifest({...base,addressedQuestionIds:[q1,q1]}).length>0);
 assert.ok(validatePolicyManifest({...base,addressedQuestionIds:["not-a-uuid"]}).length>0);
 assert.ok(validatePolicyManifest({...base,attachmentSha256:["XYZ"]}).length>0);
 assert.ok(validatePolicyManifest({...base,body:"short"}).length>0);
});
test("line diff reports additions, removals and unchanged lines",()=>{
 const lines=lineDiff("a\nb\nc\nd","a\nB\nc\nd\ne");
 assert.deepEqual(lines,[{kind:"same",text:"a"},{kind:"removed",text:"b"},{kind:"added",text:"B"},{kind:"same",text:"c"},{kind:"same",text:"d"},{kind:"added",text:"e"}]);
 assert.deepEqual(diffCounts(lines),{added:2,removed:1,unchanged:3});
 assert.deepEqual(lineDiff("same\r\ntext","same\ntext").map(x=>x.kind),["same","same"]);
 assert.deepEqual(diffCounts(lineDiff("","x")),{added:1,removed:1,unchanged:0});
});
test("A and B endorsing different versions is an explicit mismatch, never an agreement",()=>{
 const r=branchAgreement([{id:"v1",scope:"full",activeApprovers:["A"],historicalApprovers:["A"]},{id:"v2",scope:"full",activeApprovers:["B"],historicalApprovers:["B"]}],"A","B");
 assert.equal(r.status,"different_versions");assert.equal(r.resolved,false);
 assert.match(r.label,/no joint agreement — candidates endorsed different versions/i);
});
test("a joint partial agreement is partial only and never resolves the debate",()=>{
 const r=branchAgreement([{id:"v1",scope:"partial",activeApprovers:["A","B"],historicalApprovers:["A","B"]}],"A","B");
 assert.equal(r.status,"joint_partial");assert.equal(r.resolved,false);assert.match(r.label,/partial/i);
 const full=branchAgreement([{id:"v1",scope:"full",activeApprovers:["A","B"],historicalApprovers:["A","B"]}],"A","B");
 assert.equal(full.status,"joint_full");assert.equal(full.resolved,true);
 assert.equal(policyAcceptanceEventKind(true,"partial",null),"policy_partially_accepted_jointly");
 assert.equal(policyAcceptanceEventKind(true,"full","withdraw"),"policy_jointly_accepted");
 assert.equal(policyAcceptanceEventKind(false,"partial",null),"policy_accepted");
 assert.equal(policyAcceptanceEventKind(false,"full","withdraw"),"policy_reaffirmed");
});
test("withdrawn, one-sided and third-candidate endorsements are reported honestly",()=>{
 assert.equal(branchAgreement([{id:"v1",scope:"full",activeApprovers:["B"],historicalApprovers:["A","B"]}],"A","B").status,"withdrawn");
 assert.equal(branchAgreement([{id:"v1",scope:"full",activeApprovers:["A","C"],historicalApprovers:["A","C"]}],"A","B").status,"one_sided");
 assert.equal(branchAgreement([],"A","B").status,"none");
});
test("withdrawn agreements keep their history but are never advertised as current",()=>{
 const current={scope:"full" as const,currentlyJoint:true};
 const withdrawn={scope:"partial" as const,currentlyJoint:false,withdrawnAt:"2026-11-01T10:00:00Z",withdrawnBy:"Fictional Candidate A"};
 assert.equal(agreementRecordLabel(current),"Joint policy agreement");
 assert.match(agreementRecordLabel(withdrawn),/^Withdrawn — no longer a current agreement/);
 assert.match(agreementRecordSentence({...withdrawn,originator:"A",contender:"B"}),/withdrew support on 2026-11-01/);
 const items=agreementFeedItems({...withdrawn,policyVersionId:"v",title:"T",originator:"A",contender:"B",lastJointAt:"2026-10-01T00:00:00Z"});
 assert.equal(items.length,2);assert.match(items[0].title,/Support withdrawn from partial policy agreement/);
 assert.match(items[1].title,/^Withdrawn/);
 assert.equal(agreementFeedItems({...current,policyVersionId:"v",title:"T",originator:"A",contender:"B",lastJointAt:"2026-10-01T00:00:00Z"}).length,1);
});
test("future-use notice never promises retrieval of distributed copies",()=>{
 const n=futureUseNotice("Fictional Candidate B","2026-11-02T00:00:00Z");
 assert.match(n,/2026-11-02/);assert.match(n,/remains public/);assert.match(n,/cannot be recalled/);
});
