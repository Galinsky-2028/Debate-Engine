import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import pg from "pg";
import {policyHash,policyManifestDigest} from "../packages/domain/policy.ts";
import {branchAgreement} from "../packages/domain/policy-view.ts";
import {JOINT_AGREEMENT_RECORDS_SQL,ENDORSEMENT_HISTORY_SQL} from "../lib/server/policy-agreement-sql.ts";
import {debateFixture,refused} from "./policy-media-fixture.mjs";

if(!process.env.DATABASE_URL)throw Error("Requires disposable PostgreSQL.");
const INSERT="INSERT INTO policy_versions(branch_id,proposed_by_candidacy_id,content_sha256,policy_body,parent_version_id,scope,addressed_question_ids,changes_summary,remaining_disagreements,attachment_document_ids) VALUES($1,$2,$3,$4,$5,$6,$7::uuid[],$8,$9,$10::uuid[]) RETURNING id";
async function propose(db,{branch,by,body,parent=null,scope="full",questions=[],changes="",remaining="",docs=[]}){
 const shas=docs.length?(await db.query("SELECT sha256 FROM submission_documents WHERE id=ANY($1::uuid[])",[docs])).rows.map(x=>x.sha256):[];
 const digest=policyManifestDigest({body,scope,addressedQuestionIds:questions,changesSummary:changes,remainingDisagreements:remaining,attachmentSha256:shas});
 const id=(await db.query(INSERT,[branch,by,digest,body,parent,scope,questions,changes,remaining,docs])).rows[0].id;
 return {id,digest};
}
async function endorse(db,version,candidate,action="accept"){
 if(action==="accept")await db.query("INSERT INTO policy_acceptances(policy_version_id,content_sha256,candidacy_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[version.id,version.digest,candidate]);
 await db.query("INSERT INTO policy_endorsement_events(policy_version_id,content_sha256,candidacy_id,action) VALUES($1,$2,$3,$4)",[version.id,version.digest,candidate,action]);
}
// The production public listing query (app/api/branches/[id]/policies) feeding the shared status rule.
async function listingStatus(db,f){
 const source=await readFile("app/api/branches/[id]/policies/route.ts","utf8");
 const sql=source.match(/database\(\)\.query\(`([\s\S]*?)`,\[id\]\)/)[1];
 const rows=(await db.query(sql,[f.branchAB])).rows;
 return {rows,agreement:branchAgreement(rows.map(v=>({id:v.id,scope:v.scope,activeApprovers:v.active_approvers,historicalApprovers:v.historical_approvers})),f.a,f.b)};
}
async function withFixture(run){
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query("BEGIN");
 try{await run(db,await debateFixture(db));}finally{await db.query("ROLLBACK");await db.end();}
}

test("legacy rows default to full scope and keep their original digest",()=>withFixture(async(db,f)=>{
 const body="A fictional full policy without any scoped extras.";
 const legacy=(await db.query("INSERT INTO policy_versions(branch_id,proposed_by_candidacy_id,content_sha256,policy_body) VALUES($1,$2,$3,$4) RETURNING *",[f.branchAB,f.a,policyHash(body,[]),body])).rows[0];
 assert.equal(legacy.scope,"full");assert.deepEqual(legacy.addressed_question_ids,[]);assert.deepEqual(legacy.attachment_document_ids,[]);
 assert.equal(legacy.changes_summary,"");assert.equal(legacy.remaining_disagreements,"");
 assert.equal(policyManifestDigest({body:legacy.policy_body,scope:legacy.scope,addressedQuestionIds:legacy.addressed_question_ids,changesSummary:legacy.changes_summary,
  remainingDisagreements:legacy.remaining_disagreements,attachmentSha256:[]}),legacy.content_sha256);
}));

test("database trigger enforces scope validity as defense in depth",()=>withFixture(async(db,f)=>{
 const body="A fictional partial proposal about phased transit funding.";
 const row=(extra)=>[f.branchAB,f.a,"f".repeat(64),body,null,"full",[],"","",[]].map((x,i)=>i in extra?extra[i]:x);
 await refused(db,INSERT,row({5:"partial"}));                                  // partial without remaining disagreements
 await refused(db,INSERT,row({5:"partial",8:"   "}));
 await refused(db,INSERT,row({5:"everything"}));
 await refused(db,INSERT,row({6:[f.qC]}));                                     // question from another branch
 await refused(db,INSERT,row({6:[f.qB,f.qB]}));                                // duplicate question
 await refused(db,INSERT,row({9:[f.draftDoc]}));                               // unpublished document
 await refused(db,INSERT,row({9:[f.docA,f.docA]}));
 const other=await propose(db,{branch:f.branchAC,by:f.a,body:"A fictional proposal in the other branch."});
 await refused(db,INSERT,row({4:other.id}));                                   // parent from another branch
 const ok=await propose(db,{branch:f.branchAB,by:f.b,body,scope:"partial",questions:[f.qOpening,f.qB],remaining:"Toll timing remains disputed.",docs:[f.docA,f.docB],changes:"A drops the levy; B accepts phasing."});
 await refused(db,"UPDATE policy_versions SET scope='full' WHERE id=$1",[ok.id],["55000"]);
 await refused(db,"UPDATE policy_versions SET attachment_document_ids='{}' WHERE id=$1",[ok.id],["55000"]);
}));

test("A and B accept different policy versions: no joint agreement, mismatch explicit",()=>withFixture(async(db,f)=>{
 const v1=await propose(db,{branch:f.branchAB,by:f.a,body:"Fictional version one: fund transit with bonds."});
 const v2=await propose(db,{branch:f.branchAB,by:f.b,body:"Fictional version two: fund transit with fees.",parent:v1.id});
 await endorse(db,v1,f.a);await endorse(db,v2,f.b);
 const {agreement}=await listingStatus(db,f);
 assert.equal(agreement.status,"different_versions");assert.equal(agreement.resolved,false);
 assert.match(agreement.label,/candidates endorsed different versions/);
 assert.equal((await db.query(JOINT_AGREEMENT_RECORDS_SQL,[f.branchAB])).rowCount,0,"Mismatched endorsements never appear as an agreement in press, feed or kit.");
 // Endorsing v2 with v1's digest is impossible.
 await refused(db,"INSERT INTO policy_acceptances(policy_version_id,content_sha256,candidacy_id) VALUES($1,$2,$3)",[v2.id,v1.digest,f.a],["23503"]);
}));

test("both accept a scoped partial agreement: partial only, unresolved questions stay visible",()=>withFixture(async(db,f)=>{
 const v=await propose(db,{branch:f.branchAB,by:f.a,body:"Fictional partial agreement: both support phased construction.",scope:"partial",
  questions:[f.qB],remaining:"Funding source is still disputed.",docs:[f.docA]});
 await endorse(db,v,f.a);await endorse(db,v,f.b);
 const {rows,agreement}=await listingStatus(db,f);
 assert.equal(agreement.status,"joint_partial");assert.equal(agreement.resolved,false);
 assert.deepEqual(agreement.jointFullVersionIds,[]);
 const listed=rows.find(r=>r.id===v.id);
 assert.equal(listed.scope,"partial");assert.equal(listed.remaining_disagreements,"Funding source is still disputed.");
 assert.deepEqual(listed.attachments.map(x=>x.sha256),["1".repeat(64)]);
 const record=(await db.query(JOINT_AGREEMENT_RECORDS_SQL,[f.branchAB])).rows[0];
 assert.equal(record.scope,"partial");assert.equal(record.currently_joint,true);
 // The opening question is not addressed and therefore remains open.
 assert.ok(!record.addressed_question_ids.includes(f.qOpening));
}));

test("a changed attachment or scope is a new version; prior acceptance never carries over",()=>withFixture(async(db,f)=>{
 const body="Fictional policy text that stays identical across versions.";
 const v1=await propose(db,{branch:f.branchAB,by:f.a,body,docs:[f.docA]});
 const v2=await propose(db,{branch:f.branchAB,by:f.a,body,docs:[f.docB],parent:v1.id});
 const v3=await propose(db,{branch:f.branchAB,by:f.a,body,docs:[f.docA],scope:"partial",remaining:"Timeline.",parent:v1.id});
 assert.equal(new Set([v1.digest,v2.digest,v3.digest]).size,3);
 assert.equal(v1.digest,policyHash(body,["1".repeat(64)]),"A full-scope proposal with only attachments uses the legacy digest form.");
 await endorse(db,v1,f.a);await endorse(db,v1,f.b);
 assert.equal((await db.query("SELECT count(*)::int n FROM policy_acceptances WHERE policy_version_id=ANY($1::uuid[])",[[v2.id,v3.id]])).rows[0].n,0);
 await refused(db,"INSERT INTO policy_endorsement_events(policy_version_id,content_sha256,candidacy_id,action) VALUES($1,$2,$3,'accept')",[v2.id,v2.digest,f.a]);
 // Third candidate (other branch) cannot endorse.
 await refused(db,"INSERT INTO policy_acceptances(policy_version_id,content_sha256,candidacy_id) VALUES($1,$2,$3)",[v1.id,v1.digest,f.c]);
}));

test("withdrawn support is reported honestly by the shared press/feed/kit query and the history stays visible",()=>withFixture(async(db,f)=>{
 const v=await propose(db,{branch:f.branchAB,by:f.a,body:"Fictional full agreement on transit funding."});
 await endorse(db,v,f.a);await endorse(db,v,f.b);
 let record=(await db.query(JOINT_AGREEMENT_RECORDS_SQL,[f.branchAB])).rows[0];
 assert.equal(record.currently_joint,true);assert.equal(record.withdrawn_at,null);
 await endorse(db,v,f.a,"withdraw");
 // The legacy first-acceptance join would still (wrongly) call this agreed.
 assert.equal((await db.query("SELECT count(*)::int n FROM policy_acceptances WHERE policy_version_id=$1",[v.id])).rows[0].n,2);
 record=(await db.query(JOINT_AGREEMENT_RECORDS_SQL,[f.branchAB])).rows[0];
 assert.equal(record.currently_joint,false);assert.ok(record.withdrawn_at);assert.equal(record.withdrawn_by,"Fictional Candidate A");
 const all=(await db.query(JOINT_AGREEMENT_RECORDS_SQL,[null])).rows.find(r=>r.policy_version_id===v.id);
 assert.equal(all.currently_joint,false,"Feed and press page (all branches) see the withdrawal too.");
 const history=(await db.query(ENDORSEMENT_HISTORY_SQL,[[v.id]])).rows.map(x=>x.candidate_name+":"+x.action);
 assert.deepEqual(history,["Fictional Candidate A:accept","Fictional Candidate B:accept","Fictional Candidate A:withdraw"]);
 assert.equal((await listingStatus(db,f)).agreement.status,"withdrawn");
 // One-sided acceptance alone never produced a record.
 const lone=await propose(db,{branch:f.branchAB,by:f.b,body:"Fictional one-sided proposal for comparison."});
 await endorse(db,lone,f.b);
 assert.ok(!(await db.query(JOINT_AGREEMENT_RECORDS_SQL,[f.branchAB])).rows.some(r=>r.policy_version_id===lone.id));
 // Reaffirmation restores the current agreement.
 await endorse(db,v,f.a);
 assert.equal((await db.query(JOINT_AGREEMENT_RECORDS_SQL,[f.branchAB])).rows[0].currently_joint,true);
}));

test("press kit, RSS feed and press page all derive status from the shared endorsement-event query",async()=>{
 for(const path of ["lib/server/press-kit.ts","app/feed.xml/route.ts","app/press/page.tsx"]){
  const source=await readFile(path,"utf8");
  assert.ok(source.includes("JOINT_AGREEMENT_RECORDS_SQL"),path+" must use the endorsement-event agreement query");
  assert.ok(!source.includes("policy_acceptances"),path+" must not decide current agreement from first acceptances");
 }
 const kit=await readFile("lib/server/press-kit.ts","utf8");
 for(const field of ["remainingDisagreements","addressedQuestions","unaddressedQuestions","attachments","endorsementHistory","futureUseNotices"])assert.ok(kit.includes(field),"press kit includes "+field);
 const shared=await readFile("lib/server/policy-agreement-sql.ts","utf8");
 assert.match(shared,/policy_endorsement_events/);
});
