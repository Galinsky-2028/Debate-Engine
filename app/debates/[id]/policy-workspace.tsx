"use client";
import {useCallback,useEffect,useState,type FormEvent} from "react";
import {lineDiff,diffCounts,type BranchAgreement} from "../../../packages/domain/policy-view";
type Branch={id:string;contender_name:string};
type Attachment={id:string;label:string;filename:string;sha256:string};
type Question={id:string;question_text:string;ordinal:number;asked_by:string};
type Version={id:string;content_sha256:string;policy_body:string;created_at:string;proposer:string;approval_count:number;historical_approval_count:number;
 active_approvers:string[];historical_approvers:string[];parent_version_id:string|null;scope:"full"|"partial";addressed_question_ids:string[];
 changes_summary:string;remaining_disagreements:string;attachments:Attachment[]};
type Candidacy={id:string;public_name:string;verification_status:string};
type Listing={policies:Version[];questions:Question[];documents:Attachment[];agreement:BranchAgreement|null};
function ParentDiff({parent,child}:{parent:Version;child:Version}){
 const lines=lineDiff(parent.policy_body,child.policy_body),n=diffCounts(lines);
 return <details><summary>Changes from the parent version ({n.added} line(s) added, {n.removed} removed)</summary>
  <pre className="policy-copy" aria-label="Line differences from the parent version">{lines.map((l,i)=><div key={i}>{l.kind==="added"?"+ ":l.kind==="removed"?"− ":"  "}{l.text}{l.kind==="added"?"  [added]":l.kind==="removed"?"  [removed]":""}</div>)}</pre>
  {(parent.scope!==child.scope)&&<p>Scope changed from {parent.scope} to {child.scope}.</p>}
 </details>;
}
export default function PolicyWorkspace({branches}:{branches:Branch[]}){
 const[branchId,setBranchId]=useState(branches[0]?.id||"");
 const[data,setData]=useState<Listing>({policies:[],questions:[],documents:[],agreement:null});
 const[candidates,setCandidates]=useState<Candidacy[]>([]);
 const[candidateId,setCandidateId]=useState("");
 const[body,setBody]=useState("");
 const[scope,setScope]=useState<"full"|"partial">("full");
 const[changes,setChanges]=useState("");
 const[remaining,setRemaining]=useState("");
 const[addressed,setAddressed]=useState<string[]>([]);
 const[attachments,setAttachments]=useState<string[]>([]);
 const[parentId,setParentId]=useState<string|null>(null);
 const[message,setMessage]=useState("");
 const[busy,setBusy]=useState(false);
 const[confirmed,setConfirmed]=useState<string|null>(null);
 const load=useCallback(async()=>{
  if(!branchId)return;
  const j=await fetch("/api/branches/"+branchId+"/policies",{cache:"no-store"}).then(r=>r.json());
  setData({policies:j.policies||[],questions:j.questions||[],documents:j.documents||[],agreement:j.agreement||null});
 },[branchId]);
 useEffect(()=>{fetch("/api/account/me",{cache:"no-store"}).then(r=>r.json()).then(j=>setCandidates((j.candidacies||[]).filter((x:Candidacy)=>x.verification_status==="verified"))).catch(()=>{})},[]);
 useEffect(()=>{load().catch(()=>setMessage("Could not load proposals."))},[load]);
 const toggle=(list:string[],id:string)=>list.includes(id)?list.filter(x=>x!==id):[...list,id];
 function counterpropose(v:Version){
  setParentId(v.id);setBody(v.policy_body);setScope(v.scope);setChanges("");setRemaining(v.remaining_disagreements);
  setAddressed(v.addressed_question_ids);setAttachments(v.attachments.map(a=>a.id));
  setMessage("Form prefilled from the selected version. Publishing creates a NEW version; no earlier acceptance carries over.");
 }
 async function submit(e:FormEvent){
  e.preventDefault();setBusy(true);setMessage("");
  try{const r=await fetch("/api/branches/"+branchId+"/policies",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({candidacyId:candidateId,policyBody:body,parentVersionId:parentId,scope,changesSummary:changes,remainingDisagreements:remaining,addressedQuestionIds:addressed,attachmentDocumentIds:attachments})});const j=await r.json();if(!r.ok)throw Error(j.error||"Proposal failed.");
   setBody("");setChanges("");setRemaining("");setAddressed([]);setAttachments([]);setParentId(null);setScope("full");
   setMessage((j.scope==="partial"?"Partial-scope":"Full-scope")+" policy version published with immutable digest "+j.sha256+".");await load();
  }catch(e){setMessage(e instanceof Error?e.message:"Proposal failed.");}finally{setBusy(false);}
 }
 async function decide(v:Version,action:"accept"|"withdraw"){
  const key=action+":"+v.id;
  if(confirmed!==key){setConfirmed(key);return;}
  setBusy(true);setMessage("");
  try{const r=await fetch("/api/branches/"+branchId+"/policies/"+v.id+"/"+action,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({candidacyId:candidateId,sha256:v.content_sha256})});const j=await r.json();if(!r.ok)throw Error(j.error||"Approval failed.");
   setMessage(action==="withdraw"?"Support withdrawn. The historical acceptance is still public.":j.jointlyAgreed?(j.scope==="partial"?"Both candidates now endorse this PARTIAL version. It is a partial agreement only; the debate is not resolved.":"Both candidates currently endorse this exact full-scope policy version."):"Endorsement recorded. Waiting for the other candidate.");setConfirmed(null);await load();
  }catch(e){setMessage(e instanceof Error?e.message:"Approval failed.");}finally{setBusy(false);}
 }
 if(!branches.length)return null;
 const {policies,questions,documents,agreement}=data;
 const byId=new Map(policies.map(v=>[v.id,v]));
 const questionText=(id:string)=>questions.find(q=>q.id===id)?.question_text||"Question "+id;
 return <section className="policy-convergence"><p className="small-label">TOWARD A BETTER POLICY</p><h2>Can the disagreement lead somewhere?</h2><p>A joint agreement requires both candidates to endorse exactly the same version — its text, scope, addressed questions, notes and attachments. A partial-scope version stays partial. No one can approve another candidate’s position or change a published proposal. A later withdrawal changes current support but preserves the original acceptance.</p>
  <label className="policy-branch">Debate branch <select value={branchId} onChange={e=>{setBranchId(e.target.value);setConfirmed(null);setParentId(null);}}>{branches.map(b=><option key={b.id} value={b.id}>{b.contender_name}</option>)}</select></label>
  {agreement&&<div className="record-explainer" role="status"><strong>{agreement.label}</strong><p>{agreement.detail}</p></div>}
  <div className="policy-list">{policies.length===0?<p>No policy synthesis proposals have been published for this branch.</p>:policies.map(v=>{
   const parent=v.parent_version_id?byId.get(v.parent_version_id):undefined;
   const unaddressed=questions.filter(q=>!v.addressed_question_ids.includes(q.id));
   const jointNow=agreement?.jointFullVersionIds.includes(v.id)||agreement?.jointPartialVersionIds.includes(v.id);
   return <article key={v.id}><p className="small-label">PROPOSED BY {v.proposer} · {new Date(v.created_at).toLocaleDateString("en-US")} · {v.scope==="partial"?"PARTIAL SCOPE":"FULL SCOPE"}{jointNow?(v.scope==="partial"?" · PARTIAL AGREEMENT ONLY":" · JOINT AGREEMENT"):""}</p>
    <h3>{v.scope==="partial"?"Partial policy version":"Policy version"}</h3>
    {v.parent_version_id&&<p>Counterproposal to version <code>{v.parent_version_id.slice(0,8)}</code>{parent?" by "+parent.proposer:""}.</p>}
    <p className="policy-copy">{v.policy_body}</p>
    {parent&&<ParentDiff parent={parent} child={v}/>}
    {v.changes_summary&&<><h4>What changed from both prior positions</h4><p>{v.changes_summary}</p></>}
    <h4>Questions this version addresses</h4>{v.addressed_question_ids.length===0?<p>None listed.</p>:<ul>{v.addressed_question_ids.map(id=><li key={id}>{questionText(id)}</li>)}</ul>}
    {v.scope==="partial"&&<><h4>Remaining disagreements (unresolved)</h4><p>{v.remaining_disagreements}</p>
     <h4>Questions not addressed by this partial version</h4>{unaddressed.length===0?<p>None.</p>:<ul>{unaddressed.map(q=><li key={q.id}>{q.question_text}</li>)}</ul>}</>}
    {v.attachments.length>0&&<><h4>Attached supporting documents (part of the digest)</h4><ul>{v.attachments.map(a=><li key={a.id}><a href={"/api/documents/"+a.id+"/download"}>{a.label} — {a.filename} ↗</a> <small>SHA-256 {a.sha256}</small></li>)}</ul></>}
    <p className="policy-digest">SHA-256: <code>{v.content_sha256}</code></p><p>{v.approval_count} current endorsement(s) · {v.historical_approval_count} historical candidate acceptance(s)</p>
    {candidates.length>0&&<button type="button" disabled={busy||!candidateId} onClick={()=>decide(v,v.active_approvers.includes(candidateId)?"withdraw":"accept")}>{v.active_approvers.includes(candidateId)?(confirmed==="withdraw:"+v.id?"Confirm withdrawal; preserve history":"Withdraw my support"):(confirmed==="accept:"+v.id?(v.scope==="partial"?"Confirm endorsement of this exact PARTIAL version":"Confirm this exact version is our jointly preferred solution"):"Endorse this policy version")}</button>}
    {candidates.length>0&&<button type="button" className="link-button" disabled={busy} onClick={()=>counterpropose(v)}>Counterpropose from this version</button>}
   </article>;})}</div>
  {candidates.length>0&&<form className="action-form" onSubmit={submit}><h3>{parentId?"Counterpropose a new version":"Propose a policy that resolves the disagreement"}</h3>
   {parentId&&<p>Based on version <code>{parentId.slice(0,8)}</code>. <button type="button" className="link-button" onClick={()=>setParentId(null)}>Start fresh instead</button></p>}
   <label>Your verified candidacy<select required value={candidateId} onChange={e=>setCandidateId(e.target.value)}><option value="">Choose candidacy</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.public_name}</option>)}</select></label>
   <label>Scope<select value={scope} onChange={e=>setScope(e.target.value==="partial"?"partial":"full")}><option value="full">Full — intended to resolve the stated disagreement</option><option value="partial">Partial — agreement on some provisions only</option></select></label>
   <label>Complete policy text<textarea minLength={20} required maxLength={50000} value={body} onChange={e=>setBody(e.target.value)}/></label>
   <label>What changed from both prior positions<textarea maxLength={10000} value={changes} onChange={e=>setChanges(e.target.value)}/></label>
   <label>Remaining disagreements{scope==="partial"?" (required for a partial proposal)":""}<textarea maxLength={10000} required={scope==="partial"} value={remaining} onChange={e=>setRemaining(e.target.value)}/></label>
   <fieldset><legend>Questions this version addresses</legend>{questions.length===0?<p>No published questions in this branch.</p>:questions.map(q=><label className="checkline" key={q.id}><input type="checkbox" checked={addressed.includes(q.id)} onChange={()=>setAddressed(toggle(addressed,q.id))}/>{q.question_text} <small>({q.asked_by})</small></label>)}</fieldset>
   <fieldset><legend>Attach published supporting documents</legend>{documents.length===0?<p>No published supporting documents in this debate.</p>:documents.map(d=><label className="checkline" key={d.id}><input type="checkbox" checked={attachments.includes(d.id)} onChange={()=>setAttachments(toggle(attachments,d.id))}/>{d.label} — {d.filename} <small>SHA-256 {d.sha256.slice(0,12)}…</small></label>)}</fieldset>
   <button className="button button-dark" disabled={busy}>Publish immutable policy version ↗</button></form>}
  {message&&<p role="status" className="form-alert">{message}</p>}
 </section>;
}
