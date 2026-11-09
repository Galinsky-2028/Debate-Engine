"use client";
import {useEffect,useState,type FormEvent} from "react";
type Mode='video'|'audio'|'writing';
type Branch={id:string;contender_name:string;responder_candidacy_id:string};
type Candidate={id:string;public_name:string;verification_status:string};
type Rules={revision:number;max_response_seconds:number;reply_window_hours:number|null;allowed_modalities:Mode[]};
type Proposal={id:string;proposer:string;base_revision:number;max_response_seconds:number;reply_window_hours:number|null;allowed_modalities:Mode[];content_sha256:string;approvers:string[];activated_revision:number|null};
export default function BranchRules({branches,originatorId}:{branches:Branch[];originatorId:string}){
 const [branchId,setBranchId]=useState(branches[0]?.id||'');
 const [candidates,setCandidates]=useState<Candidate[]>([]),[candidateId,setCandidateId]=useState('');
 const [rules,setRules]=useState<Rules|null>(null),[proposals,setProposals]=useState<Proposal[]>([]);
 const [seconds,setSeconds]=useState('300'),[hours,setHours]=useState('72'),[media,setMedia]=useState<Mode[]>(['writing']);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[confirmation,setConfirmation]=useState<string|null>(null);
 useEffect(()=>{fetch('/api/account/me',{cache:'no-store'}).then(r=>r.json()).then(j=>setCandidates((j.candidacies||[]).filter((c:Candidate)=>c.verification_status==='verified'))).catch(()=>{})},[]);
 useEffect(()=>{
  if(!branchId)return;const controller=new AbortController();setRules(null);setProposals([]);setConfirmation(null);setCandidateId('');
  fetch('/api/branches/'+branchId+'/rules',{cache:'no-store',signal:controller.signal}).then(async r=>{
   const data=await r.json();if(!r.ok)throw Error(data.error||'Cannot load branch rules.');return data;
  }).then(data=>{setRules(data.current);setProposals(data.proposals);setSeconds(String(data.current.max_response_seconds));setHours(data.current.reply_window_hours===null?'':String(data.current.reply_window_hours));setMedia(data.current.allowed_modalities)})
   .catch(error=>{if(!controller.signal.aborted)setNotice(error.message)});
  return ()=>controller.abort();
 },[branchId]);
 const branch=branches.find(b=>b.id===branchId);
 const allowed=candidates.filter(c=>c.id===originatorId||c.id===branch?.responder_candidacy_id);
 async function reload(){const response=await fetch('/api/branches/'+branchId+'/rules',{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error);setRules(data.current);setProposals(data.proposals)}
 async function propose(event:FormEvent){
  event.preventDefault();if(!rules)return;setBusy(true);setNotice('');
  try{
   const response=await fetch('/api/branches/'+branchId+'/rules',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({candidacyId:candidateId,baseRevision:rules.revision,maxResponseSeconds:Number(seconds),replyWindowHours:hours.trim()===''?null:Number(hours),allowedModalities:media})});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Rule proposal failed.');await reload();setNotice('Proposal published. Both participants must separately approve this exact version before it takes effect.');
  }catch(error){setNotice(error instanceof Error?error.message:'Rule proposal failed.')}finally{setBusy(false)}
 }
 async function approve(proposal:Proposal){
  if(confirmation!==proposal.id){setConfirmation(proposal.id);return}
  setBusy(true);setNotice('');
  try{
   const response=await fetch('/api/branches/'+branchId+'/rules/'+proposal.id+'/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({candidacyId:candidateId,sha256:proposal.content_sha256})});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Approval failed.');await reload();setConfirmation(null);setNotice(result.activated?'Both participants approved. The new rules apply to future contributions and obligations; existing deadlines remain unchanged.':'Approval recorded. The other participant must approve this exact proposal.');
  }catch(error){setNotice(error instanceof Error?error.message:'Approval failed.')}finally{setBusy(false)}
 }
 if(!branches.length)return null;
 return <section className="policy-convergence branch-rules" aria-label="Mutually approved branch rules"><h2>Rules both candidates agree to</h2>
  <p>The opening rules remain public. Changes to response limits, reply windows and allowed media require both branch participants to approve the same proposal. Earlier contributions and deadlines remain unchanged.</p>
  <label>Rules for branch<select disabled={busy} value={branchId} onChange={e=>{setBranchId(e.target.value);setNotice('')}}>{branches.map(b=><option key={b.id} value={b.id}>{b.contender_name}</option>)}</select></label>
  {rules&&<p>Current version {rules.revision}: {rules.max_response_seconds} seconds per audio/video response; {rules.reply_window_hours===null?'no fixed reply deadline':rules.reply_window_hours+' hours to reply'}; {rules.allowed_modalities.join(', ')}.</p>}
  {allowed.length>0&&<label>Your candidacy for rule changes<select disabled={busy} value={candidateId} onChange={e=>{setCandidateId(e.target.value);setConfirmation(null)}}><option value="">Select branch participant</option>{allowed.map(c=><option key={c.id} value={c.id}>{c.public_name}</option>)}</select></label>}
  {!rules?<p role="status">{notice?'Branch rules are unavailable.':'Loading branch rules…'}</p>:proposals.length===0?<p>No rule changes have been proposed.</p>:proposals.map(p=><article key={p.id} className="mini-card"><h3>{p.activated_revision?`Published rules version ${p.activated_revision}`:'Rule change proposal'}</h3><p>Proposed by {p.proposer} from version {p.base_revision}.</p>
   <p>{p.max_response_seconds} seconds; {p.reply_window_hours===null?'no fixed deadline':p.reply_window_hours+' hours to reply'}; {p.allowed_modalities.join(', ')}.</p>
   <p>{p.approvers.length} of 2 participant approvals. {!p.activated_revision&&rules&&p.base_revision!==rules.revision?'Based on superseded rules; a new proposal is required.':''}</p>
   <p style={{overflowWrap:'anywhere'}}>Exact proposal SHA-256: <code>{p.content_sha256}</code></p>
   {candidateId&&!p.activated_revision&&p.base_revision===rules?.revision&&<button type="button" disabled={busy||p.approvers.includes(candidateId)} onClick={()=>approve(p)}>{p.approvers.includes(candidateId)?'Your approval is recorded':confirmation===p.id?'Confirm approval of these exact rules':'Review and approve these rules'}</button>}
  </article>)}
  {allowed.length>0&&rules&&<form className="action-form" onSubmit={propose}><h3>Propose future rules</h3>
   <label>Proposed audio/video response limit (seconds)<input required type="number" min="1" max="7200" value={seconds} onChange={e=>setSeconds(e.target.value)}/></label>
   <label>Proposed reply window (hours; blank for no fixed deadline)<input type="number" min="1" max="720" value={hours} onChange={e=>setHours(e.target.value)}/></label>
   <fieldset><legend>Proposed contribution media</legend>{(['video','audio','writing'] as const).map(mode=><label key={mode} className="checkline"><input type="checkbox" checked={media.includes(mode)} onChange={e=>setMedia(e.target.checked?[...media,mode]:media.filter(m=>m!==mode))}/>{mode}</label>)}</fieldset>
   <button className="button button-dark" disabled={busy||!candidateId||!media.length}>Publish rule proposal for mutual review</button>
  </form>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
