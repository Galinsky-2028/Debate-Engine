import "server-only";
import type {PoolClient} from "pg";
import {branchSequence, type PublishedSubmission, type PublishedQuestion, type PublishedAnswer, type PublishedAssessment} from "../../packages/domain/sequence";

/** Called inside the publication/assessment transaction; readers never publish history. */
export async function preserveQualifyingSequence(db:PoolClient,branchId:string){
 const branch=await db.query<{originator_candidacy_id:string;responder_candidacy_id:string;debate_id:string}>(
  "SELECT d.originator_candidacy_id,b.responder_candidacy_id,b.debate_id FROM debate_branches b JOIN debates d ON d.id=b.debate_id WHERE b.id=$1 FOR UPDATE OF b",[branchId]);
 if(!branch.rowCount)return;
 const b=branch.rows[0];
 const submissions=await db.query<PublishedSubmission>("SELECT id,branch_id,parent_submission_id,candidacy_id,kind,published_at,format_issues FROM submissions WHERE debate_id=$1 AND published_at IS NOT NULL AND (branch_id=$2 OR kind='opening') ORDER BY published_at,id",[b.debate_id,branchId]);
 const ids=submissions.rows.map(s=>s.id);
 const questions=await db.query<PublishedQuestion>("SELECT id,submission_id,asked_by_candidacy_id,question_text FROM questions WHERE submission_id=ANY($1::uuid[])",[ids]);
 const answers=await db.query<PublishedAnswer>("SELECT question_id,submission_id,video_timestamp_seconds,written_anchor FROM answers WHERE submission_id=ANY($1::uuid[])",[ids]);
 const assessments=await db.query<PublishedAssessment>("SELECT id,question_id,answer_submission_id,reviewer_candidacy_id,decision,reasoning,created_at,event_order FROM assessments WHERE answer_submission_id=ANY($1::uuid[])",[ids]);
 const previous=await db.query<{submission_ids:string[];revision:number}>("SELECT submission_ids,revision FROM qualifying_sequence_manifests WHERE branch_id=$1 ORDER BY revision DESC LIMIT 1",[branchId]);
 const reviews=assessments.rows.map(a=>({...a,created_at:new Date(a.created_at).toISOString()}));
 const latest=previous.rows[0];
 const qualified=branchSequence(b.originator_candidacy_id,branchId,b.responder_candidacy_id,submissions.rows,questions.rows,answers.rows,reviews,latest?.submission_ids).qualifyingSubmissionIds;
 if(qualified.length<3||qualified.length<=(latest?.submission_ids.length||0))return;
 // An old disagreement cannot remove or replace a previously published exchange.
 if(latest&&!latest.submission_ids.every((id,i)=>qualified[i]===id))return;
 await db.query("INSERT INTO qualifying_sequence_manifests(branch_id,revision,submission_ids) VALUES($1,$2,$3::uuid[])",[branchId,(latest?.revision||0)+1,qualified]);
}
