import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import pg from "pg";
import {branchSequence} from "../packages/domain/sequence.ts";

if(!process.env.DATABASE_URL)throw Error("An isolated PostgreSQL DATABASE_URL is required.");
async function denied(db,sql,args,expected=["23514","55000","23503"]){
 await db.query("SAVEPOINT adversarial_check");
 let error;
 try{await db.query(sql,args)}catch(e){error=e}
 await db.query("ROLLBACK TO SAVEPOINT adversarial_check");
 await db.query("RELEASE SAVEPOINT adversarial_check");
 assert.ok(error,"Expected the database to refuse "+sql);
 assert.ok(expected.includes(error.code),"Unexpected refusal: "+error.message);
}
async function makeActor(db,election,label){
 const account=(await db.query(
  "INSERT INTO accounts(identity_provider,external_subject,display_name) VALUES('fixture',$1,$2) RETURNING id",
  [randomUUID(),label])).rows[0].id;
 return (await db.query(
  "INSERT INTO candidacies(account_id,election_id,public_name,verification_status) VALUES($1,$2,$3,'verified') RETURNING id",
  [account,election,label])).rows[0].id;
}
async function speech(db,{debate,branch,candidate,parent,kind,text}){
 const result=await db.query(
  "INSERT INTO submissions(debate_id,branch_id,candidacy_id,parent_submission_id,kind,modality,written_content) VALUES($1,$2,$3,$4,$5,'writing',$6) RETURNING id",
  [debate,branch||null,candidate,parent||null,kind,text]);
 return result.rows[0].id;
}
async function publish(db,sid){
 await db.query("UPDATE submissions SET published_at=now() WHERE id=$1",[sid]);
}
test("three candidate, two branch reciprocal pilot: permanent nonqualifying replies, only reciprocal qualifying use, versioned agreement and corrections",async()=>{
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});
 await db.connect();await db.query("BEGIN");
 try{
  const office=(await db.query(
   "INSERT INTO offices(slug,title,jurisdiction) VALUES($1,'Fictional legislative office','Fictional') RETURNING id",
   ["pde-pilot-"+randomUUID()])).rows[0].id;
  const election=(await db.query(
   "INSERT INTO election_cycles(office_id,election_date,label) VALUES($1,'2032-11-02','Fictional pilot election') RETURNING id",
   [office])).rows[0].id;
  const a=await makeActor(db,election,"Fixture Candidate A");
  const b=await makeActor(db,election,"Fixture Candidate B");
  const c=await makeActor(db,election,"Fixture Candidate C");
  const debate=(await db.query(
   "INSERT INTO debates(election_id,originator_candidacy_id,title,proposition,max_response_seconds,reply_window_hours,allowed_modalities) VALUES($1,$2,'Synthetic fiscal policy debate','A transparent policy proposal',300,48,ARRAY['writing']::text[]) RETURNING id",
   [election,a])).rows[0].id;
  const opening=await speech(db,{debate,candidate:a,kind:"opening",text:"I propose publishing all fiscal assumptions. Candidate B and C, how would you implement that standard?"});
  const qA=(await db.query(
   "INSERT INTO questions(submission_id,asked_by_candidacy_id,ordinal,question_text,written_anchor) VALUES($1,$2,1,'How would you implement that standard?','char:2') RETURNING id",
   [opening,a])).rows[0].id;
  await publish(db,opening);
  await db.query("UPDATE debates SET status='published',published_at=now() WHERE id=$1",[debate]);
  const bb=(await db.query("INSERT INTO debate_branches(debate_id,responder_candidacy_id) VALUES($1,$2) RETURNING id",[debate,b])).rows[0].id;
  const cc=(await db.query("INSERT INTO debate_branches(debate_id,responder_candidacy_id) VALUES($1,$2) RETURNING id",[debate,c])).rows[0].id;
  const answerB=await speech(db,{debate,branch:bb,candidate:b,parent:opening,kind:"response",
   text:"I would publish each assumption in public documents and invite independent review. Would you include an audit ledger?"});
  await db.query("INSERT INTO answers(submission_id,question_id,written_anchor) VALUES($1,$2,'char:3')",[answerB,qA]);
  const qB=(await db.query(
   "INSERT INTO questions(submission_id,asked_by_candidacy_id,ordinal,question_text,written_anchor) VALUES($1,$2,1,'Would you include an audit ledger?','char:70') RETURNING id",
   [answerB,b])).rows[0].id;
  await publish(db,answerB);
  const answerC=await speech(db,{debate,branch:cc,candidate:c,parent:opening,kind:"response",
   text:"I disagree with the initial proposal and prefer an alternative public spending dashboard instead."});
  await publish(db,answerC);
  // A questioner's assessment is an attributed opinion, not a platform decision.
  const assessment=(await db.query(
   "INSERT INTO assessments(question_id,answer_submission_id,reviewer_candidacy_id,decision,reasoning) VALUES($1,$2,$3,'answered','B answered my published implementation question.') RETURNING id",
   [qA,answerB,a])).rows[0].id;
  const replyA=await speech(db,{debate,branch:bb,candidate:a,parent:answerB,kind:"reply",
   text:"Yes. The audit ledger would preserve each approved amendment and its timestamp for public inspection."});
  await db.query("INSERT INTO answers(submission_id,question_id,written_anchor) VALUES($1,$2,'char:0')",[replyA,qB]);
  const nextQuestion=(await db.query("INSERT INTO questions(submission_id,asked_by_candidacy_id,ordinal,question_text,written_anchor) VALUES($1,$2,1,'How should the next audit be scheduled?','char:0') RETURNING id",[replyA,a])).rows[0].id;
  await publish(db,replyA);
  await denied(db,"INSERT INTO qualifying_sequence_manifests(branch_id,revision,submission_ids) VALUES($1,1,$2::uuid[])",[bb,[opening,answerB,replyA]]);
  await db.query(
   "INSERT INTO assessments(question_id,answer_submission_id,reviewer_candidacy_id,decision,reasoning) VALUES($1,$2,$3,'answered','A answered my audit ledger question.')",
   [qB,replyA,b]);
  const manifest=(await db.query("INSERT INTO qualifying_sequence_manifests(branch_id,revision,submission_ids) VALUES($1,1,$2::uuid[]) RETURNING *",[bb,[opening,answerB,replyA]])).rows[0];
  assert.equal(manifest.manifest_sha256,createHash('sha256').update([opening,answerB,replyA].join(',')).digest('hex'));
  await denied(db,"UPDATE qualifying_sequence_manifests SET revision=2 WHERE id=$1",[manifest.id]);
  await denied(db,"DELETE FROM qualifying_sequence_manifests WHERE id=$1",[manifest.id]);
  await denied(db,"INSERT INTO qualifying_sequence_manifests(branch_id,revision,submission_ids) VALUES($1,2,$2::uuid[])",[bb,[opening,answerB,replyA]]);
  await denied(db,"INSERT INTO qualifying_sequence_manifests(branch_id,revision,submission_ids) VALUES($1,1,$2::uuid[])",[cc,[opening,answerB,replyA]]);
  const submissions=(await db.query(
   "SELECT id,branch_id,parent_submission_id,candidacy_id,kind,published_at,format_issues FROM submissions WHERE debate_id=$1 AND published_at IS NOT NULL ORDER BY published_at,id",
   [debate])).rows.map(s=>({...s,published_at:new Date(s.published_at).toISOString()}));
  const questions=(await db.query(
   "SELECT id,submission_id,asked_by_candidacy_id,question_text FROM questions WHERE submission_id=ANY($1::uuid[])",
   [submissions.map(s=>s.id)])).rows;
  const answers=(await db.query(
   "SELECT question_id,submission_id,video_timestamp_seconds,written_anchor FROM answers WHERE submission_id=ANY($1::uuid[])",
   [submissions.map(s=>s.id)])).rows;
  const reviews=(await db.query(
   "SELECT id,question_id,answer_submission_id,reviewer_candidacy_id,decision,reasoning,created_at FROM assessments WHERE answer_submission_id=ANY($1::uuid[])",
   [submissions.map(s=>s.id)])).rows.map(x=>({...x,created_at:new Date(x.created_at).toISOString()}));
  assert.equal(submissions.length,4,"Each original, rival response and reply remains publicly recorded.");
  const qualifying=branchSequence(a,bb,b,submissions,questions,answers,reviews);
  assert.deepEqual(qualifying.qualifyingSubmissionIds,[opening,answerB,replyA]);
  assert.equal(qualifying.exchanges[0].state,"qualified");
  const other=branchSequence(a,cc,c,submissions,questions,answers,reviews);
  assert.deepEqual(other.qualifyingSubmissionIds,[opening],"Unassessed C response is preserved but not included in A/B qualifying sequence.");
  assert.notEqual(other.exchanges[0].state,"qualified");
  await denied(db,"INSERT INTO assessments(question_id,answer_submission_id,reviewer_candidacy_id,decision,reasoning) VALUES($1,$2,$3,'answered','Third-party manipulation')",
   [qA,answerB,c]);
  await denied(db,"DELETE FROM submissions WHERE id=$1",[answerC]);
  await denied(db,"UPDATE submissions SET written_content='rewritten' WHERE id=$1",[answerC]);

  // A later reassessment is public, but cannot erase a published sequence or stop a new exchange.
  const reverse=(await db.query("INSERT INTO assessments(question_id,answer_submission_id,reviewer_candidacy_id,decision,reasoning,supersedes_assessment_id) VALUES($1,$2,$3,'not_answered','I now dispute the original implementation answer.',$4) RETURNING event_order",[qA,answerB,a,assessment])).rows[0];
  assert.ok(reverse.event_order);
  const responseNext=await speech(db,{debate,branch:bb,candidate:b,parent:replyA,kind:'reply',text:'A quarterly independent audit. Will you publish its timing?'});
  await db.query("INSERT INTO answers(submission_id,question_id,written_anchor) VALUES($1,$2,'char:0')",[responseNext,nextQuestion]);
  const reciprocalNext=(await db.query("INSERT INTO questions(submission_id,asked_by_candidacy_id,ordinal,question_text,written_anchor) VALUES($1,$2,1,'Will you publish the audit timing?','char:0') RETURNING id",[responseNext,b])).rows[0].id;
  await publish(db,responseNext);
  const replyNext=await speech(db,{debate,branch:bb,candidate:a,parent:responseNext,kind:'reply',text:'Yes, all audit dates will be published in advance.'});
  await db.query("INSERT INTO answers(submission_id,question_id,written_anchor) VALUES($1,$2,'char:0')",[replyNext,reciprocalNext]);
  await publish(db,replyNext);
  await db.query("INSERT INTO assessments(question_id,answer_submission_id,reviewer_candidacy_id,decision,reasoning) VALUES($1,$2,$3,'answered','The audit schedule question is answered.')",[nextQuestion,responseNext,a]);
  await denied(db,"INSERT INTO qualifying_sequence_manifests(branch_id,revision,submission_ids) VALUES($1,2,$2::uuid[])",[bb,[opening,answerB,replyA,responseNext,replyNext]]);
  await db.query("INSERT INTO assessments(question_id,answer_submission_id,reviewer_candidacy_id,decision,reasoning) VALUES($1,$2,$3,'answered','The publication timing question is answered.')",[reciprocalNext,replyNext,b]);
  await db.query("INSERT INTO qualifying_sequence_manifests(branch_id,revision,submission_ids) VALUES($1,2,$2::uuid[])",[bb,[opening,answerB,replyA,responseNext,replyNext]]);
  const history=(await db.query("SELECT revision,submission_ids FROM qualifying_sequence_manifests WHERE branch_id=$1 ORDER BY revision",[bb])).rows;
  assert.deepEqual(history.map(m=>m.submission_ids.length),[3,5]);
  assert.deepEqual(history[0].submission_ids,[opening,answerB,replyA]);
  await denied(db,"INSERT INTO qualifying_sequence_manifests(branch_id,revision,submission_ids) VALUES($1,3,$2::uuid[])",[bb,[opening,answerB,replyA]]);

  // Historical joint agreement may later be withdrawn without deleting the original approval.
  const policyHash="b".repeat(64);
  const policy=(await db.query(
   "INSERT INTO policy_versions(branch_id,proposed_by_candidacy_id,content_sha256,policy_body) VALUES($1,$2,$3,'Both participants endorse an audit ledger.') RETURNING id",
   [bb,a,policyHash])).rows[0].id;
  for(const candidate of [a,b]){
   await db.query("INSERT INTO policy_acceptances(policy_version_id,content_sha256,candidacy_id) VALUES($1,$2,$3)",[policy,policyHash,candidate]);
   await db.query("INSERT INTO policy_endorsement_events(policy_version_id,content_sha256,candidacy_id,action) VALUES($1,$2,$3,'accept')",[policy,policyHash,candidate]);
  }
  await db.query("INSERT INTO policy_endorsement_events(policy_version_id,content_sha256,candidacy_id,action) VALUES($1,$2,$3,'withdraw')",[policy,policyHash,a]);
  let latest=(await db.query(
   "SELECT DISTINCT ON (candidacy_id) candidacy_id,action FROM policy_endorsement_events WHERE policy_version_id=$1 ORDER BY candidacy_id,event_order DESC",[policy])).rows;
  assert.equal(latest.filter(x=>x.action==="accept").length,1,"Withdrawn support cannot be reported as current unanimous agreement.");
  await db.query("INSERT INTO policy_endorsement_events(policy_version_id,content_sha256,candidacy_id,action) VALUES($1,$2,$3,'accept')",[policy,policyHash,a]);
  latest=(await db.query(
   "SELECT DISTINCT ON (candidacy_id) candidacy_id,action FROM policy_endorsement_events WHERE policy_version_id=$1 ORDER BY candidacy_id,event_order DESC",[policy])).rows;
  assert.equal(latest.filter(x=>x.action==="accept").length,2,"Explicit reaffirmation is allowed.");
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM policy_acceptances WHERE policy_version_id=$1",[policy])).rows[0].n,2);
  await denied(db,"INSERT INTO policy_acceptances(policy_version_id,content_sha256,candidacy_id) VALUES($1,$2,$3)",[policy,policyHash,c]);
  const correction=(await db.query(
   "INSERT INTO submission_corrections(submission_id,candidacy_id,correction_body) VALUES($1,$2,'I clarify that my proposal includes public budget version history.') RETURNING id",
   [answerB,b])).rows[0].id;
  await denied(db,"DELETE FROM submission_corrections WHERE id=$1",[correction]);
  await denied(db,"INSERT INTO submission_corrections(submission_id,candidacy_id,correction_body) VALUES($1,$2,'An unauthorized change by another participant is forbidden.')",[answerB,a]);
  assert.ok((await db.query("SELECT 1 FROM assessments WHERE id=$1",[assessment])).rowCount,"Assessment remains attributed in original record.");
  assert.ok((await db.query("SELECT 1 FROM submissions WHERE id=$1",[answerC])).rowCount,"Unqualified contender response stays archived.");
  // Mutual future rules cannot be activated by one participant or rewrite old submissions.
  const ruleHash='d'.repeat(64);
  await denied(db,"INSERT INTO branch_rule_proposals(branch_id,proposed_by_candidacy_id,base_revision,max_response_seconds,reply_window_hours,allowed_modalities,content_sha256) VALUES($1,$2,1,120,24,ARRAY['writing'],$3)",[bb,c,ruleHash]);
  const proposal=(await db.query("INSERT INTO branch_rule_proposals(branch_id,proposed_by_candidacy_id,base_revision,max_response_seconds,reply_window_hours,allowed_modalities,content_sha256) VALUES($1,$2,1,120,24,ARRAY['writing'],$3) RETURNING id",[bb,a,ruleHash])).rows[0].id;
  await denied(db,"INSERT INTO branch_rule_versions(branch_id,revision,proposal_id) VALUES($1,2,$2)",[bb,proposal]);
  await denied(db,"INSERT INTO branch_rule_approvals(proposal_id,content_sha256,candidacy_id) VALUES($1,$2,$3)",[proposal,'e'.repeat(64),b]);
  await denied(db,"INSERT INTO branch_rule_approvals(proposal_id,content_sha256,candidacy_id) VALUES($1,$2,$3)",[proposal,ruleHash,c]);
  await db.query("INSERT INTO branch_rule_approvals(proposal_id,content_sha256,candidacy_id) VALUES($1,$2,$3)",[proposal,ruleHash,a]);
  await denied(db,"INSERT INTO branch_rule_versions(branch_id,revision,proposal_id) VALUES($1,2,$2)",[bb,proposal]);
  await db.query("INSERT INTO branch_rule_approvals(proposal_id,content_sha256,candidacy_id) VALUES($1,$2,$3)",[proposal,ruleHash,b]);
  await denied(db,"INSERT INTO branch_rule_versions(branch_id,revision,proposal_id) VALUES($1,2,$2)",[cc,proposal]);
  await db.query("INSERT INTO branch_rule_versions(branch_id,revision,proposal_id) VALUES($1,2,$2)",[bb,proposal]);
  await denied(db,"UPDATE branch_rule_proposals SET max_response_seconds=60 WHERE id=$1",[proposal]);
  await denied(db,"DELETE FROM branch_rule_approvals WHERE proposal_id=$1",[proposal]);
  await denied(db,"DELETE FROM branch_rule_versions WHERE branch_id=$1",[bb]);
  await denied(db,"INSERT INTO branch_rule_proposals(branch_id,proposed_by_candidacy_id,base_revision,max_response_seconds,allowed_modalities,content_sha256) VALUES($1,$2,1,120,ARRAY['writing'],$3)",[bb,a,ruleHash]);
  await denied(db,"INSERT INTO submissions(debate_id,branch_id,candidacy_id,parent_submission_id,kind,modality,written_content,rules_version) VALUES($1,$2,$3,$4,'reply','writing','A stale draft must be reviewed under the new rules.',1)",[debate,bb,b,replyNext]);
  assert.equal((await db.query('SELECT rules_version FROM submissions WHERE id=$1',[answerB])).rows[0].rules_version,1);
 }finally{
  await db.query("ROLLBACK").catch(()=>{});
  await db.end();
 }
},{timeout:60000});
