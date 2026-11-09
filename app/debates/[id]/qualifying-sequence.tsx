import {branchSequence} from "../../../packages/domain/sequence";
import PublishedContribution from "./published-contribution";
type Data={originatorId:string;branches:Array<{id:string;contender_name:string;responder_candidacy_id:string}>;
 sequenceManifests?:Array<{id:string;branch_id:string;revision:number;submission_ids:string[];manifest_sha256:string;created_at:string}>;
 submissions:Array<{id:string;candidate_name:string;branch_id:string|null;parent_submission_id:string|null;candidacy_id:string;kind:string;published_at:string;media_asset_id:string|null;modality?:string;written_content?:string|null;format_issues?:string[]}>;
 questions:Array<{id:string;submission_id:string;asked_by_candidacy_id:string;question_text:string}>;
 answers:Array<{question_id:string;submission_id:string;video_timestamp_seconds:string|number}>;
 assessments:Array<{id:string;question_id:string;answer_submission_id:string;reviewer_candidacy_id:string;decision:string;reasoning:string;created_at:string}>;
};
export default function QualifyingSequence({data}: {data:Data}){
 const original=data.submissions.find(s=>s.kind==="opening");
 return <section className="qualifying-player" aria-label="Qualifying debate sequences">
  <h2>Qualifying debate sequences</h2>
  <p>Only completed reciprocal exchanges appear here. Every contribution outside this sequence remains fully available in the complete public record below.</p>
  {data.branches.length===0?<p>No candidate-to-candidate exchange has been published yet.</p>:data.branches.map(b=>{
   const result=branchSequence(data.originatorId,b.id,b.responder_candidacy_id,data.submissions,data.questions,data.answers,data.assessments);
   const history=(data.sequenceManifests||[]).filter(m=>m.branch_id===b.id).sort((a,b)=>b.revision-a.revision);
   const latest=history[0];
   const sequenceIds=latest?.submission_ids||result.qualifyingSubmissionIds;
   return <article key={b.id} className="qualifying-branch"><h3>Debate with {b.contender_name}</h3>
    <p className="small-label">{sequenceIds.length} contributions in the qualifying sequence{latest?` · Published version ${latest.revision}`:" · Current assessment projection"}</p>
    {latest&&<p>Published exchanges remain in this sequence. Later assessments and objections remain visible in the complete record.</p>}
    <ol className="qualified-videos">{sequenceIds.map(sid=>{
      const s=data.submissions.find(s=>s.id===sid);if(!s)return null;
      return <li key={sid}><p>{s.kind==="opening"?"Opening proposal":"Qualifying response"} — <strong>{s.candidate_name}</strong></p>
      <PublishedContribution submission={s}/>
      <a href={"#contribution-"+s.id}>View this video's complete record and questions ↓</a></li>;
    })}</ol>
    {history.length>0&&<details><summary>Published sequence history ({history.length} versions)</summary>{history.map(m=><article key={m.id} id={"sequence-"+m.id}>
      <h4>Version {m.revision}</h4><p>Published {new Date(m.created_at).toISOString()}</p>
      <ol>{m.submission_ids.map(id=><li key={id}><a href={"#contribution-"+id}>{data.submissions.find(s=>s.id===id)?.candidate_name||"Contribution"} — complete record</a></li>)}</ol>
      <p>Manifest SHA-256: <code style={{overflowWrap:"anywhere"}}>{m.manifest_sha256}</code></p>
    </article>)}</details>}
    {result.exchanges.filter(e=>e.state!=="qualified").map(e=><div className="pending-exchange" key={e.responseId}><p><strong>Pending / outside qualifying sequence:</strong> {e.state.replaceAll("_"," ")}.</p><p>{e.reason}</p><a href={"#contribution-"+e.responseId}>View the full contender response and any assessment ↗</a>{e.originatorReplyId&&<p><a href={"#contribution-"+e.originatorReplyId}>View the originator reply ↗</a></p>}</div>)}
   </article>;
  })}
  {!original&&<p>The original presentation is not currently available.</p>}
 </section>;
}
