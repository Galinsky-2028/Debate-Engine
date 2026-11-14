// Plan sections 5, 7, 8: obligations superseded by a recorded joint full-scope agreement (migration 0032).
// Explicitly fictional fixtures. Transactional tests roll back; the worker test commits unique fictional data.
import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import pg from "pg";
import {policyManifestDigest} from "../packages/domain/policy.ts";
import {debateFixture,refused} from "./policy-media-fixture.mjs";
import {runDeadlineJobs} from "../scripts/deadline-worker.mjs";

if(!process.env.DATABASE_URL)throw Error("Requires disposable PostgreSQL.");
const INSERT_POLICY="INSERT INTO policy_versions(branch_id,proposed_by_candidacy_id,content_sha256,policy_body,scope,remaining_disagreements) VALUES($1,$2,$3,$4,$5,$6) RETURNING id";
async function propose(db,branch,by,body,scope="full"){
 const remaining=scope==="partial"?"Fictional toll timing remains disputed.":"";
 const digest=policyManifestDigest({body,scope,addressedQuestionIds:[],changesSummary:"",remainingDisagreements:remaining,attachmentSha256:[]});
 return {id:(await db.query(INSERT_POLICY,[branch,by,digest,body,scope,remaining])).rows[0].id,digest};
}
async function endorse(db,version,candidate,action="accept"){
 if(action==="accept")await db.query("INSERT INTO policy_acceptances(policy_version_id,content_sha256,candidacy_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[version.id,version.digest,candidate]);
 await db.query("INSERT INTO policy_endorsement_events(policy_version_id,content_sha256,candidacy_id,action) VALUES($1,$2,$3,$4)",[version.id,version.digest,candidate,action]);
}
async function obligation(db,{debate,branch,source,obligated,type="reply",openedAgoHours=2,dueAgoHours=1,received=false}){
 const row=(await db.query(`INSERT INTO reply_obligations(debate_id,branch_id,source_submission_id,obligated_candidacy_id,obligation_type,opened_at,due_at,received_at,processed_at)
  VALUES($1,$2,$3,$4,$5,now()-$6*interval '1 hour',now()-$7*interval '1 hour',CASE WHEN $8 THEN now()-$7*interval '1 hour'-interval '1 minute' END,CASE WHEN $8 THEN now()-$7*interval '1 hour'-interval '1 minute' END) RETURNING id,due_at`,
  [debate,branch,source,obligated,type,openedAgoHours,dueAgoHours,received])).rows[0];
 const due=row.due_at.toISOString();
 await db.query("INSERT INTO durable_jobs(job_type,dedupe_key,arguments,available_at) VALUES('obligation_deadline',$1,$2::jsonb,now()) ON CONFLICT(job_type,dedupe_key) DO NOTHING",
  [`obligation:${row.id}:deadline:${due}`,JSON.stringify({obligationId:row.id,effectiveDueAt:due})]);
 return row.id;
}
const supersede=async(db,version)=>(await db.query("SELECT public.pde_supersede_obligations_by_agreement($1) AS n",[version.id])).rows[0].n;
// The production public read model (lib/server/public-debates.ts) for the obligation ledger.
async function publicStates(db,debate){
 const source=await readFile("lib/server/public-debates.ts","utf8");
 const sql=source.match(/database\(\)\.query\("(WITH projected AS \(SELECT ro\.\*[\s\S]*?)",\[debateId\]\)/)[1];
 return Object.fromEntries((await db.query(sql,[debate])).rows.map(r=>[r.id,r.state]));
}
async function withFixture(run){
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query("BEGIN");
 try{await run(db,await debateFixture(db));}finally{await db.query("ROLLBACK");await db.end();}
}

test("a joint partial agreement does not supersede; a joint full agreement closes only open obligations on its branch",()=>withFixture(async(db,f)=>{
 const openReply=await obligation(db,{debate:f.debate,branch:f.branchAB,source:f.responseB,obligated:f.a});
 const openReview=await obligation(db,{debate:f.debate,branch:f.branchAB,source:f.responseB,obligated:f.a,type:"review",dueAgoHours:-5});
 const received=await obligation(db,{debate:f.debate,branch:f.branchAB,source:f.opening,obligated:f.b,received:true});
 const otherBranch=await obligation(db,{debate:f.debate,branch:f.branchAC,source:f.responseC,obligated:f.a});
 const before=(await db.query("SELECT received_at FROM reply_obligations WHERE id=$1",[received])).rows[0].received_at;

 const partial=await propose(db,f.branchAB,f.a,"A fictional partial transit agreement.","partial");
 await endorse(db,partial,f.a);await endorse(db,partial,f.b);
 assert.equal(await supersede(db,partial),0,"a joint partial agreement does not resolve the debate");
 await refused(db,"INSERT INTO obligation_supersessions(obligation_id,policy_version_id) VALUES($1,$2)",[openReply,partial.id]);

 const full=await propose(db,f.branchAB,f.b,"A fictional full transit agreement.");
 await endorse(db,full,f.a);
 assert.equal(await supersede(db,full),0,"one endorsement is not an agreement");
 await refused(db,"INSERT INTO obligation_supersessions(obligation_id,policy_version_id) VALUES($1,$2)",[openReply,full.id]);
 await endorse(db,full,f.b);
 assert.equal(await supersede(db,full),2);
 assert.equal(await supersede(db,full),0,"idempotent");
 const rows=(await db.query("SELECT obligation_id,policy_version_id FROM obligation_supersessions WHERE obligation_id=ANY($1::uuid[]) ORDER BY obligation_id",[[openReply,openReview,received,otherBranch]])).rows;
 assert.deepEqual(rows.map(r=>r.obligation_id).sort(),[openReply,openReview].sort());
 assert.ok(rows.every(r=>r.policy_version_id===full.id));
 assert.equal(String((await db.query("SELECT received_at FROM reply_obligations WHERE id=$1",[received])).rows[0].received_at),String(before),"a received obligation is untouched");
 const events=(await db.query("SELECT payload FROM publication_events WHERE debate_id=$1 AND kind='obligations_superseded_by_agreement'",[f.debate])).rows;
 assert.equal(events.length,1);
 assert.equal(events[0].payload.count,2);assert.equal(events[0].payload.policyVersionId,full.id);
 assert.equal(events[0].payload.label,"Closed by the candidates' recorded agreement");

 const states=await publicStates(db,f.debate);
 assert.equal(states[openReply],"superseded_by_agreement","past due but superseded: never overdue");
 assert.equal(states[openReview],"superseded_by_agreement");
 assert.equal(states[received],"fulfilled_on_time");
 assert.equal(states[otherBranch],"overdue","another branch is unaffected");

 // Adversarial: received obligations, other branches, mutation and later receipt are refused.
 await refused(db,"INSERT INTO obligation_supersessions(obligation_id,policy_version_id) VALUES($1,$2)",[received,full.id]);
 await refused(db,"INSERT INTO obligation_supersessions(obligation_id,policy_version_id) VALUES($1,$2)",[otherBranch,full.id]);
 await refused(db,"UPDATE obligation_supersessions SET superseded_at=now()-interval '1 day' WHERE obligation_id=$1",[openReply],["55000"]);
 await refused(db,"DELETE FROM obligation_supersessions WHERE obligation_id=$1",[openReply],["55000"]);
 await refused(db,"DELETE FROM reply_obligations WHERE id=$1",[openReply],["23503"]);
 await refused(db,"UPDATE reply_obligations SET received_at=now() WHERE id=$1",[openReply]);
}));

test("withdrawal keeps the historical supersession and reopens nothing; new obligations open normally",()=>withFixture(async(db,f)=>{
 const open=await obligation(db,{debate:f.debate,branch:f.branchAB,source:f.responseB,obligated:f.a});
 const full=await propose(db,f.branchAB,f.a,"A fictional full agreement to withdraw.");
 await endorse(db,full,f.a);await endorse(db,full,f.b);
 assert.equal(await supersede(db,full),1);
 await endorse(db,full,f.b,"withdraw");
 assert.equal((await db.query("SELECT count(*)::int n FROM obligation_supersessions WHERE obligation_id=$1",[open])).rows[0].n,1);
 const later=await obligation(db,{debate:f.debate,branch:f.branchAB,source:f.opening,obligated:f.b,type:"review",dueAgoHours:-10});
 assert.equal(await supersede(db,full),0,"a withdrawn agreement supersedes nothing new");
 await refused(db,"INSERT INTO obligation_supersessions(obligation_id,policy_version_id) VALUES($1,$2)",[later,full.id]);
 const states=await publicStates(db,f.debate);
 assert.equal(states[open],"superseded_by_agreement");
 assert.equal(states[later],"open");
 // Reaffirmation makes the agreement current again and closes the newer open obligation.
 await endorse(db,full,f.b);
 assert.equal(await supersede(db,full),1);
 assert.equal((await publicStates(db,f.debate))[later],"superseded_by_agreement");
}));

test("the deadline worker completes a superseded job without an overdue event or notification",async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
 try{
  const f=await debateFixture(pool);
  const account=(await pool.query("SELECT account_id FROM candidacies WHERE id=$1",[f.a])).rows[0].account_id;
  const dest=(await pool.query("INSERT INTO delivery_destinations(candidacy_id,created_by_account_id,kind,purposes,label,address) VALUES($1,$2,'email',ARRAY['notifications'],'Fictional inbox',$3) RETURNING id",
   [f.a,account,`fictional-${f.debate.slice(0,8)}@example.org`])).rows[0].id;
  await pool.query("UPDATE delivery_destinations SET verified_at=now() WHERE id=$1",[dest]);
  const superseded=await obligation(pool,{debate:f.debate,branch:f.branchAB,source:f.responseB,obligated:f.a});
  const control=await obligation(pool,{debate:f.debate,branch:f.branchAC,source:f.responseC,obligated:f.a});
  const full=await propose(pool,f.branchAB,f.a,"A fictional full agreement before the worker runs.");
  await endorse(pool,full,f.a);await endorse(pool,full,f.b);
  assert.equal(await supersede(pool,full),1);
  await runDeadlineJobs(pool,100);
  await runDeadlineJobs(pool,100);
  const job=(await pool.query("SELECT state FROM durable_jobs WHERE job_type='obligation_deadline' AND arguments->>'obligationId'=$1",[superseded])).rows[0];
  assert.equal(job.state,"completed");
  const overdue=async id=>(await pool.query("SELECT count(*)::int n FROM publication_events WHERE kind='obligation_overdue' AND object_id=$1",[id])).rows[0].n;
  const notices=async id=>(await pool.query("SELECT count(*)::int n FROM outgoing_actions WHERE subject_kind='obligation' AND subject_id=$1",[id])).rows[0].n;
  assert.equal(await overdue(superseded),0,"no overdue event for a superseded obligation");
  assert.equal(await notices(superseded),0,"no overdue notification for a superseded obligation");
  assert.equal(await overdue(control),1,"the unrelated branch still records its overdue event once");
  assert.equal(await notices(control),1);
 }finally{await pool.end();}
});
