// Transaction core: no "server-only" import so the DB integration tests exercise this exact code.
// Only server modules (continuation publication, assessments) call it, inside their transaction.
import type {PoolClient} from "pg";
import {branchSequence,type PublishedSubmission,type PublishedQuestion,type PublishedAnswer,type PublishedAssessment} from "../../packages/domain/sequence.ts";

type Db=Pick<PoolClient,"query">;
export type ManifestRow={id:string;branch_id:string;revision:number;submission_ids:string[];manifest_sha256:string;created_at:Date};

/**
 * Append the next qualifying-sequence manifest revision when the branch's completed exchange units
 * now extend beyond the latest published revision. Earlier revisions are passed as a preserved prefix,
 * so a later reassessment never removes an exchange that was already published in a manifest.
 * Returns the new revision, or null when nothing new qualifies.
 */
export async function preserveQualifyingSequence(db:Db,branchId:string):Promise<ManifestRow|null>{
 const branch=await db.query<{originator_candidacy_id:string;responder_candidacy_id:string;debate_id:string}>(
  "SELECT d.originator_candidacy_id,b.responder_candidacy_id,b.debate_id FROM debate_branches b JOIN debates d ON d.id=b.debate_id WHERE b.id=$1 AND d.status='published' FOR UPDATE OF b",[branchId]);
 if(!branch.rowCount)return null;
 const b=branch.rows[0];
 const submissions=await db.query<PublishedSubmission>(
  "SELECT id,branch_id,parent_submission_id,candidacy_id,kind,published_at,format_issues FROM submissions WHERE debate_id=$1 AND published_at IS NOT NULL AND (branch_id=$2 OR kind='opening') ORDER BY published_at,id",[b.debate_id,branchId]);
 const ids=submissions.rows.map(s=>s.id);
 const [questions,answers,assessments,previous]=[
  await db.query<PublishedQuestion>("SELECT id,submission_id,asked_by_candidacy_id,question_text FROM questions WHERE submission_id=ANY($1::uuid[])",[ids]),
  await db.query<PublishedAnswer>("SELECT question_id,submission_id,video_timestamp_seconds,written_anchor FROM answers WHERE submission_id=ANY($1::uuid[])",[ids]),
  await db.query<PublishedAssessment>("SELECT id,question_id,answer_submission_id,reviewer_candidacy_id,decision,reasoning,created_at,event_order FROM assessments WHERE answer_submission_id=ANY($1::uuid[])",[ids]),
  await db.query<{submission_ids:string[];revision:number}>("SELECT submission_ids,revision FROM qualifying_sequence_manifests WHERE branch_id=$1 ORDER BY revision DESC LIMIT 1",[branchId]),
 ];
 const latest=previous.rows[0];
 const qualified=branchSequence(b.originator_candidacy_id,branchId,b.responder_candidacy_id,
  submissions.rows,questions.rows,answers.rows,assessments.rows,latest?.submission_ids||[]).qualifyingSubmissionIds;
 if(qualified.length<3||qualified.length<=(latest?.submission_ids.length||0))return null;
 if(latest&&!latest.submission_ids.every((id,i)=>qualified[i]===id))return null;
 // The database trigger independently re-validates the appended exchanges. If it disagrees with the
 // projection, the publication or assessment itself must still succeed: the public record is primary,
 // and the page honestly keeps showing the latest published revision plus the current projection.
 await db.query("SAVEPOINT pde_sequence_manifest");
 try{
  const made=await db.query<ManifestRow>(
   "INSERT INTO qualifying_sequence_manifests(branch_id,revision,submission_ids) VALUES($1,$2,$3::uuid[]) RETURNING id,branch_id,revision,submission_ids,manifest_sha256,created_at",
   [branchId,(latest?.revision||0)+1,qualified]);
  await db.query("RELEASE SAVEPOINT pde_sequence_manifest");
  const row=made.rows[0];
  await db.query("INSERT INTO publication_events(debate_id,branch_id,kind,object_id,payload) VALUES($1,$2,'qualifying_sequence_published',$3,$4::jsonb)",
   [b.debate_id,branchId,row.id,JSON.stringify({revision:row.revision,submissionIds:row.submission_ids,manifestSha256:row.manifest_sha256})]);
  return row;
 }catch(error){
  await db.query("ROLLBACK TO SAVEPOINT pde_sequence_manifest");
  await db.query("RELEASE SAVEPOINT pde_sequence_manifest");
  if((error as {code?:string}).code!=="23514")throw error;
  console.error("Qualifying sequence manifest refused by database validation",branchId);
  return null;
 }
}
