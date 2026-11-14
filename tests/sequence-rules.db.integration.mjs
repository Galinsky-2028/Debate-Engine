import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import pg from "pg";
import {preserveQualifyingSequence} from "../lib/server/sequence-manifests.ts";
import {effectiveBranchRules,proposeBranchRules,acceptBranchRules,listBranchRules} from "../lib/server/branch-rules.ts";
import {extendObligationForOutage} from "../lib/server/outage-adjustments.ts";
import {formatProblems} from "../packages/domain/modalities.ts";
import {deadlineJobKey} from "../packages/domain/deadlines.ts";
import {runBatch} from "../scripts/deadline-worker.mjs";

if(!process.env.DATABASE_URL)throw Error("An isolated PostgreSQL DATABASE_URL is required.");
async function denied(db,sql,args,expected=["23514","55000","23503","P0001"]){
 await db.query("SAVEPOINT adversarial_check");
 let error;
 try{await db.query(sql,args)}catch(e){error=e}
 await db.query("ROLLBACK TO SAVEPOINT adversarial_check");
 await db.query("RELEASE SAVEPOINT adversarial_check");
 assert.ok(error,"Expected the database to refuse "+sql);
 assert.ok(expected.includes(error.code),"Unexpected refusal: "+error.code+" "+error.message);
}
async function rejectsHttp(db,fn,status){
 await db.query("SAVEPOINT http_check");
 let error;
 try{await fn()}catch(e){error=e}
 await db.query("ROLLBACK TO SAVEPOINT http_check");
 await db.query("RELEASE SAVEPOINT http_check");
 assert.ok(error,"Expected a refusal");
 assert.equal(error.status,status,error.message);
}
async function makeActor(db,election,label){
 const subject="fixture-subject-"+randomUUID();
 const account=(await db.query(
  "INSERT INTO accounts(identity_provider,external_subject,display_name) VALUES('neon-auth',$1,$2) RETURNING id",[subject,label])).rows[0].id;
 const id=(await db.query(
  "INSERT INTO candidacies(account_id,election_id,public_name,verification_status) VALUES($1,$2,$3,'verified') RETURNING id",
  [account,election,label])).rows[0].id;
 return {id,subject,account};
}
async function speech(db,{debate,branch,candidate,parent,kind,text,rulesVersion=1,formatIssues=[]}){
 return (await db.query(
  "INSERT INTO submissions(debate_id,branch_id,candidacy_id,parent_submission_id,kind,modality,written_content,rules_version,format_issues) VALUES($1,$2,$3,$4,$5,'writing',$6,$7,$8::jsonb) RETURNING id",
  [debate,branch||null,candidate,parent||null,kind,text,rulesVersion,JSON.stringify(formatIssues)])).rows[0].id;
}
const publish=(db,sid)=>db.query("UPDATE submissions SET published_at=clock_timestamp() WHERE id=$1",[sid]);
const ask=async(db,sid,by,text)=>(await db.query("INSERT INTO questions(submission_id,asked_by_candidacy_id,ordinal,question_text,written_anchor) VALUES($1,$2,1,$3,'char:0') RETURNING id",[sid,by,text])).rows[0].id;
const answer=(db,sid,q)=>db.query("INSERT INTO answers(submission_id,question_id,written_anchor) VALUES($1,$2,'char:0')",[sid,q]);
const assess=async(db,q,sid,by,decision,reasoning)=>(await db.query("INSERT INTO assessments(question_id,answer_submission_id,reviewer_candidacy_id,decision,reasoning) VALUES($1,$2,$3,$4,$5) RETURNING id",[q,sid,by,decision,reasoning])).rows[0].id;
async function fixtureDebate(db){
 const office=(await db.query("INSERT INTO offices(slug,title,jurisdiction) VALUES($1,'Fictional council seat','Fictional') RETURNING id",["pde-seq-"+randomUUID()])).rows[0].id;
 const election=(await db.query("INSERT INTO election_cycles(office_id,election_date,label) VALUES($1,'2032-11-02','Fictional sequence election') RETURNING id",[office])).rows[0].id;
 const a=await makeActor(db,election,"Fixture Candidate A"),b=await makeActor(db,election,"Fixture Candidate B"),c=await makeActor(db,election,"Fixture Candidate C");
 const debate=(await db.query(
  "INSERT INTO debates(election_id,originator_candidacy_id,title,proposition,max_response_seconds,reply_window_hours,allowed_modalities) VALUES($1,$2,'Synthetic transit debate','A fictional proposal for testing only',300,48,ARRAY['writing']::text[]) RETURNING id",
  [election,a.id])).rows[0].id;
 const opening=await speech(db,{debate,candidate:a.id,kind:"opening",text:"Fictional opening. How would you fund the transit plan?"});
 const qA=await ask(db,opening,a.id,"How would you fund the transit plan?");
 await publish(db,opening);
 await db.query("UPDATE debates SET status='published',published_at=now() WHERE id=$1",[debate]);
 const bb=(await db.query("INSERT INTO debate_branches(debate_id,responder_candidacy_id) VALUES($1,$2) RETURNING id",[debate,b.id])).rows[0].id;
 const cc=(await db.query("INSERT INTO debate_branches(debate_id,responder_candidacy_id) VALUES($1,$2) RETURNING id",[debate,c.id])).rows[0].id;
 return {election,a,b,c,debate,opening,qA,bb,cc};
}
const manifests=async(db,branch)=>(await db.query("SELECT id,revision,submission_ids,manifest_sha256 FROM qualifying_sequence_manifests WHERE branch_id=$1 ORDER BY revision",[branch])).rows;

test("A0/B1/A2 manifests are append-only, survive reversal; branch rules need both participants and apply prospectively",async()=>{
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query("BEGIN");
 try{
  const {a,b,c,debate,opening,qA,bb,cc}=await fixtureDebate(db);
  // B1 is public as soon as it is published, but never appears in a manifest alone.
  const b1=await speech(db,{debate,branch:bb,candidate:b.id,parent:opening,kind:"response",text:"A fictional bond measure. Would you publish the ridership data?"});
  await answer(db,b1,qA);const qB=await ask(db,b1,b.id,"Would you publish the ridership data?");
  await publish(db,b1);
  assert.equal(await preserveQualifyingSequence(db,bb),null);
  await assess(db,qA,b1,a.id,"answered","B answered my funding question.");
  assert.equal(await preserveQualifyingSequence(db,bb),null);
  assert.equal((await manifests(db,bb)).length,0,"B1 alone never appears in a manifest");
  const a2=await speech(db,{debate,branch:bb,candidate:a.id,parent:b1,kind:"reply",text:"Yes, monthly. How would you audit the bond?"});
  await answer(db,a2,qB);const q3=await ask(db,a2,a.id,"How would you audit the bond?");
  await publish(db,a2);
  assert.equal(await preserveQualifyingSequence(db,bb),null,"B has not yet accepted A2's reciprocal answer");
  await denied(db,"INSERT INTO qualifying_sequence_manifests(branch_id,revision,submission_ids,manifest_sha256) VALUES($1,1,$2::uuid[],repeat('a',64))",[bb,[opening,b1,a2]]);
  await assess(db,qB,a2,b.id,"answered","A answered my ridership question.");
  const first=await preserveQualifyingSequence(db,bb);
  assert.equal(first.revision,1);
  assert.deepEqual(first.submission_ids,[opening,b1,a2]);
  assert.equal(first.manifest_sha256,createHash("sha256").update([opening,b1,a2].join(",")).digest("hex"));
  assert.equal((await db.query("SELECT count(*)::int AS n FROM publication_events WHERE kind='qualifying_sequence_published' AND object_id=$1",[first.id])).rows[0].n,1);
  assert.equal(await preserveQualifyingSequence(db,bb),null,"Materialization is idempotent");
  await denied(db,"UPDATE qualifying_sequence_manifests SET submission_ids=$2::uuid[] WHERE id=$1",[first.id,[opening,b1,a2]]);
  await denied(db,"DELETE FROM qualifying_sequence_manifests WHERE id=$1",[first.id]);
  await denied(db,"INSERT INTO qualifying_sequence_manifests(branch_id,revision,submission_ids,manifest_sha256) VALUES($1,2,$2::uuid[],repeat('a',64))",[bb,[opening,b1,a2]]);
  await denied(db,"INSERT INTO qualifying_sequence_manifests(branch_id,revision,submission_ids,manifest_sha256) VALUES($1,1,$2::uuid[],repeat('a',64))",[cc,[opening,b1,a2]]);

  // A later reversal is public but does not delete or rewrite revision 1.
  await assess(db,qA,b1,a.id,"not_answered","On reflection I dispute the funding answer.");
  assert.equal(await preserveQualifyingSequence(db,bb),null);
  assert.deepEqual((await manifests(db,bb)).map(m=>m.submission_ids),[[opening,b1,a2]]);

  // B3 is a closing contender turn with no new question; ~200 words complies with version 1 (750 words).
  const longText=Array(200).fill("audit").join(" ");
  const b3=await speech(db,{debate,branch:bb,candidate:b.id,parent:a2,kind:"reply",text:longText,
   formatIssues:formatProblems({modality:"writing",allowed:["writing"],durationSeconds:null,maxResponseSeconds:300,writtenContent:longText,firstResponse:false,questionCount:0})});
  await answer(db,b3,q3);await publish(db,b3);
  assert.deepEqual((await db.query("SELECT format_issues FROM submissions WHERE id=$1",[b3])).rows[0].format_issues,[]);
  const a4=await speech(db,{debate,branch:bb,candidate:a.id,parent:b3,kind:"reply",text:"Thank you; my closing statement."});
  await publish(db,a4);
  await assess(db,q3,b3,a.id,"answered","B answered my audit question.");
  const second=await preserveQualifyingSequence(db,bb);
  assert.equal(second.revision,2,"New exchanges extend the preserved prefix despite the reversal");
  assert.deepEqual(second.submission_ids,[opening,b1,a2,b3,a4]);
  assert.deepEqual((await manifests(db,bb)).map(m=>m.revision),[1,2]);

  // Branch rules: version 1 is the debate's original rules.
  const before=await effectiveBranchRules(db,bb);
  assert.deepEqual([before.revision,before.max_response_seconds,before.reply_window_hours],[1,300,48]);
  const obligation=(await db.query("INSERT INTO reply_obligations(debate_id,branch_id,source_submission_id,obligated_candidacy_id,obligation_type,opened_at,due_at) VALUES($1,$2,$3,$4,'reply',now(),now()+interval '48 hours') RETURNING id,due_at",[debate,bb,a4,b.id])).rows[0];
  const stale=await proposeBranchRules(db,{branchId:bb,candidateId:b.id,authSubject:b.subject,baseRevision:1,maxResponseSeconds:240,replyWindowHours:null});
  const proposal=await proposeBranchRules(db,{branchId:bb,candidateId:a.id,authSubject:a.subject,baseRevision:1,maxResponseSeconds:60,replyWindowHours:24});
  assert.match(proposal.sha256,/^[a-f0-9]{64}$/);assert.notEqual(proposal.sha256,"0".repeat(64));
  // Accepted only by its proposer: no effect.
  assert.equal((await acceptBranchRules(db,{branchId:bb,proposalId:proposal.proposalId,candidateId:a.id,authSubject:a.subject,sha256:proposal.sha256})).activated,false);
  assert.equal((await effectiveBranchRules(db,bb)).revision,1);
  await denied(db,"INSERT INTO branch_rule_versions(branch_id,revision,proposal_id) VALUES($1,2,$2)",[bb,proposal.proposalId]);
  await denied(db,"INSERT INTO submissions(debate_id,branch_id,candidacy_id,parent_submission_id,kind,modality,written_content,rules_version) VALUES($1,$2,$3,$4,'reply','writing','Claiming unaccepted rules.',2)",[debate,bb,b.id,a4]);
  // A third candidate, impersonation and a wrong digest are refused.
  await rejectsHttp(db,()=>acceptBranchRules(db,{branchId:bb,proposalId:proposal.proposalId,candidateId:c.id,authSubject:c.subject,sha256:proposal.sha256}),403);
  await rejectsHttp(db,()=>acceptBranchRules(db,{branchId:bb,proposalId:proposal.proposalId,candidateId:b.id,authSubject:a.subject,sha256:proposal.sha256}),403);
  await rejectsHttp(db,()=>acceptBranchRules(db,{branchId:bb,proposalId:proposal.proposalId,candidateId:b.id,authSubject:b.subject,sha256:"e".repeat(64)}),409);
  await denied(db,"INSERT INTO branch_rule_approvals(proposal_id,content_sha256,candidacy_id) VALUES($1,$2,$3)",[proposal.proposalId,proposal.sha256,c.id]);
  // Mutual acceptance activates version 2.
  const activated=await acceptBranchRules(db,{branchId:bb,proposalId:proposal.proposalId,candidateId:b.id,authSubject:b.subject,sha256:proposal.sha256});
  assert.deepEqual([activated.activated,activated.revision],[true,2]);
  assert.equal((await acceptBranchRules(db,{branchId:bb,proposalId:proposal.proposalId,candidateId:b.id,authSubject:b.subject,sha256:proposal.sha256})).alreadyActivated,true);
  const after=await effectiveBranchRules(db,bb);
  assert.deepEqual([after.revision,after.max_response_seconds,after.reply_window_hours],[2,60,24]);
  await rejectsHttp(db,()=>acceptBranchRules(db,{branchId:bb,proposalId:stale.proposalId,candidateId:a.id,authSubject:a.subject,sha256:stale.sha256}),409);
  await rejectsHttp(db,()=>proposeBranchRules(db,{branchId:bb,candidateId:b.id,authSubject:b.subject,baseRevision:1,maxResponseSeconds:90,replyWindowHours:12}),409);
  // The next contribution records version 2; the earlier one keeps version 1 and its format status.
  await denied(db,"INSERT INTO submissions(debate_id,branch_id,candidacy_id,parent_submission_id,kind,modality,written_content,rules_version) VALUES($1,$2,$3,$4,'reply','writing','A stale draft under version 1.',1)",[debate,bb,b.id,a4]);
  const b5Issues=formatProblems({modality:"writing",allowed:["writing"],durationSeconds:null,maxResponseSeconds:after.max_response_seconds,writtenContent:longText,firstResponse:false,questionCount:0});
  assert.ok(b5Issues.some(x=>x.includes("150 words")),"The same length is judged by the new limit only for new contributions");
  const b5=await speech(db,{debate,branch:bb,candidate:b.id,parent:a4,kind:"reply",text:longText,rulesVersion:2,formatIssues:b5Issues});
  assert.equal((await db.query("SELECT rules_version FROM submissions WHERE id=$1",[b5])).rows[0].rules_version,2);
  const earlier=(await db.query("SELECT rules_version,format_issues FROM submissions WHERE id=$1",[b3])).rows[0];
  assert.deepEqual([earlier.rules_version,earlier.format_issues],[1,[]]);
  assert.equal((await db.query("SELECT due_at FROM reply_obligations WHERE id=$1",[obligation.id])).rows[0].due_at.getTime(),obligation.due_at.getTime(),"Existing deadlines are not rewritten");
  // Rule history is immutable and public.
  await denied(db,"UPDATE branch_rule_proposals SET max_response_seconds=30 WHERE id=$1",[proposal.proposalId]);
  await denied(db,"DELETE FROM branch_rule_approvals WHERE proposal_id=$1",[proposal.proposalId]);
  await denied(db,"DELETE FROM branch_rule_versions WHERE branch_id=$1",[bb]);
  const listed=await listBranchRules(db,bb);
  assert.equal(listed.proposals.find(p=>p.id===proposal.proposalId).activated_revision,2);
  // A third candidate's branch is unaffected.
  const other=await effectiveBranchRules(db,cc);
  assert.deepEqual([other.revision,other.max_response_seconds,other.reply_window_hours],[1,300,48]);
  const c1=await speech(db,{debate,branch:cc,candidate:c.id,parent:opening,kind:"response",text:"A fictional alternative. What about fares?"});
  assert.equal((await db.query("SELECT rules_version FROM submissions WHERE id=$1",[c1])).rows[0].rules_version,1);
 }finally{
  await db.query("ROLLBACK").catch(()=>{});
  await db.end();
 }
});

test("outage extensions move effective deadlines visibly and reschedule deadline jobs without duplicating overdue events",async()=>{
 // The worker uses its own connections, so these clearly fictional fixtures are committed.
 const url=process.env.DATABASE_URL;
 const db=new pg.Client({connectionString:url});
 await db.connect();
 const worker=()=>runBatch(new pg.Pool({connectionString:url,max:2}));
 try{
  await db.query("BEGIN");
  const {a,b,debate,opening,qA,bb}=await fixtureDebate(db);
  const b1=await speech(db,{debate,branch:bb,candidate:b.id,parent:opening,kind:"response",text:"A fictional answer. What is your timeline?"});
  await answer(db,b1,qA);await ask(db,b1,b.id,"What is your timeline?");await publish(db,b1);
  const o=(await db.query("INSERT INTO reply_obligations(debate_id,branch_id,source_submission_id,obligated_candidacy_id,obligation_type,opened_at,due_at) VALUES($1,$2,$3,$4,'reply',now()-interval '50 hours',now()-interval '2 hours') RETURNING id,due_at",[debate,bb,b1,a.id])).rows[0];
  const due=o.due_at.toISOString();
  await db.query("INSERT INTO durable_jobs(job_type,dedupe_key,arguments,available_at) VALUES('obligation_deadline',$1,$2::jsonb,$3)",[deadlineJobKey(o.id,due),JSON.stringify({obligationId:o.id,effectiveDueAt:due}),due]);
  // A duplicate job for the same deadline (e.g. replayed enqueue under another key).
  await db.query("INSERT INTO durable_jobs(job_type,dedupe_key,arguments,available_at) VALUES('obligation_deadline',$1,$2::jsonb,$3)",["duplicate:"+o.id,JSON.stringify({obligationId:o.id}),due]);
  const admin=(await db.query("INSERT INTO accounts(identity_provider,external_subject,display_name) VALUES('fixture',$1,'Fixture administrator') RETURNING id",["admin-"+randomUUID()])).rows[0].id;
  const fulfilled=(await db.query("INSERT INTO reply_obligations(debate_id,branch_id,source_submission_id,obligated_candidacy_id,obligation_type,opened_at,due_at,received_at,processed_at) VALUES($1,$2,$3,$4,'review',now()-interval '3 hours',now()-interval '2 hours',now()-interval '1 hour',now()-interval '1 hour') RETURNING id",[debate,bb,b1,a.id])).rows[0].id;
  await db.query("COMMIT");

  const overdue=async()=>(await db.query("SELECT payload FROM publication_events WHERE kind='obligation_overdue' AND object_id=$1 ORDER BY published_at",[o.id])).rows;
  const effective=async()=>(await db.query("SELECT ro.due_at+COALESCE((SELECT sum(seconds) FROM obligation_outage_adjustments WHERE obligation_id=ro.id),0)*interval '1 second' AS e FROM reply_obligations ro WHERE id=$1",[o.id])).rows[0].e;
  await worker();await worker();
  assert.equal((await overdue()).length,1,"Duplicate deadline job execution records a single overdue event");

  const reason="Fictional upload service outage between 10:00 and 10:01 UTC prevented replies.";
  await db.query("BEGIN");
  for(const bad of [{seconds:59,publicReason:reason},{seconds:2592001,publicReason:reason},{seconds:600,publicReason:"too short"}])
   await rejectsHttp(db,()=>extendObligationForOutage(db,{obligationId:o.id,adminAccountId:admin,...bad}),400);
  await rejectsHttp(db,()=>extendObligationForOutage(db,{obligationId:fulfilled,adminAccountId:admin,seconds:600,publicReason:reason}),409);
  // A small extension after the overdue event: the deadline is still past, so a NEW job runs now.
  const small=await extendObligationForOutage(db,{obligationId:o.id,adminAccountId:admin,seconds:60,publicReason:reason});
  await db.query("COMMIT");
  assert.equal(small.effectiveDueAt,new Date(o.due_at.getTime()+60000).toISOString());
  assert.equal((await effective()).toISOString(),small.effectiveDueAt,"Extension moves the effective due time");
  const job=(await db.query("SELECT state,dedupe_key FROM durable_jobs WHERE id=$1",[small.deadlineJobId])).rows[0];
  assert.deepEqual(job,{state:"queued",dedupe_key:deadlineJobKey(o.id,small.effectiveDueAt)},"Extension after an overdue event yields a new deadline job");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM publication_events WHERE kind='obligation_deadline_extended' AND object_id=$1",[o.id])).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_events WHERE action='obligation_outage_extension' AND target_id=$1 AND actor_account_id=$2",[o.id,admin])).rows[0].n,1);
  await worker();await worker();
  assert.equal((await db.query("SELECT state FROM durable_jobs WHERE id=$1",[small.deadlineJobId])).rows[0].state,"completed");
  const events=await overdue();
  assert.equal(events.length,2,"The extended deadline was missed again: recorded once for the new effective time");
  assert.equal(new Date(events[1].payload.effectiveDueAt).toISOString(),small.effectiveDueAt);

  // A large extension puts the deadline in the future: the obligation is open again, its job waits.
  await db.query("BEGIN");
  const large=await extendObligationForOutage(db,{obligationId:o.id,adminAccountId:admin,seconds:4*3600,publicReason:reason});
  await db.query("COMMIT");
  assert.ok(new Date(large.effectiveDueAt).getTime()>Date.now());
  await worker();
  assert.equal((await db.query("SELECT state FROM durable_jobs WHERE id=$1",[large.deadlineJobId])).rows[0].state,"queued");
  assert.equal((await overdue()).length,2);
  const visible=(await db.query("SELECT seconds,public_reason FROM obligation_outage_adjustments WHERE obligation_id=$1 ORDER BY created_at",[o.id])).rows;
  assert.deepEqual(visible.map(x=>x.seconds),[60,14400]);
  assert.ok(visible.every(x=>x.public_reason===reason));
  await assert.rejects(db.query("DELETE FROM obligation_outage_adjustments WHERE obligation_id=$1",[o.id]));
 }finally{
  await db.query("ROLLBACK").catch(()=>{});
  await db.end();
 }
});
