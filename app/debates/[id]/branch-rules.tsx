"use client";
import {useEffect,useState,type FormEvent} from "react";
type Branch={id:string;contender_name:string;responder_candidacy_id:string};
type Candidate={id:string;public_name:string;verification_status:string};
type Rules={revision:number;max_response_seconds:number;reply_window_hours:number|null};
type Proposal={id:string;proposer:string;proposed_by_candidacy_id:string;base_revision:number;max_response_seconds:number;reply_window_hours:number|null;content_sha256:string;accepted_by:string[];activated_revision:number|null};
const windowText=(h:number|null)=>h===null?"no fixed reply deadline":h+" hours to reply";
/** Either branch participant proposes; the other accepts the exact digest. Applies only to later contributions. */
export default function BranchRules({branches,originatorId}:{branches:Branch[];originatorId:string}){
 const [branchId,setBranchId]=useState(branches[0]?.id||"");
 const [candidates,setCandidates]=useState<Candidate[]>([]),[candidateId,setCandidateId]=useState("");
 const [rules,setRules]=useState<Rules|null>(null),[proposals,setProposals]=useState<Proposal[]>([]);
 const [seconds,setSeconds]=useState("300"),[hours,setHours]=useState("72");
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[confirming,setConfirming]=useState<string|null>(null);
 useEffect(()=>{fetch("/api/account/me",{cache:"no-store"}).then(r=>r.ok?r.json():{candidacies:[]}).then((j:{candidacies?:Candidate[]})=>setCandidates((j.candidacies||[]).filter((c:Candidate)=>c.verification_status==="verified"))).catch(()=>{});},[]);
 async function reload(id=branchId){
  const r=await fetch("/api/branches/"+id+"/rules",{cache:"no-store"});const data=await r.json();
  if(!r.ok)throw Error(data.error||"Branch rules are unavailable.");
  setRules(data.current);setProposals(data.proposals);setSeconds(String(data.current.max_response_seconds));setHours(data.current.reply_window_hours===null?"":String(data.current.reply_window_hours));
 }
 useEffect(()=>{if(!branchId)return;setRules(null);setProposals([]);setConfirming(null);reload(branchId).catch(e=>setNotice(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[branchId]);
 const branch=branches.find(b=>b.id===branchId);
 const mine=candidates.filter(c=>c.id===originatorId||c.id===branch?.responder_candidacy_id);
 async function propose(event:FormEvent){
  event.preventDefault();if(!rules)return;setBusy(true);setNotice("");
  try{
   const r=await fetch("/api/branches/"+branchId+"/rules",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({candidacyId:candidateId,baseRevision:rules.revision,maxResponseSeconds:Number(seconds),replyWindowHours:hours.trim()===""?null:Number(hours)})});
   const j=await r.json();if(!r.ok)throw Error(j.error||"Rule proposal failed.");await reload();
   setNotice("Proposal published with your acceptance. It takes effect only after the other participant accepts this exact proposal.");
  }catch(e){setNotice(e instanceof Error?e.message:"Rule proposal failed.");}finally{setBusy(false);}
 }
 async function accept(p:Proposal){
  if(confirming!==p.id){setConfirming(p.id);return;}
  setBusy(true);setNotice("");
  try{
   const r=await fetch("/api/branches/"+branchId+"/rules/"+p.id+"/accept",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({candidacyId:candidateId,sha256:p.content_sha256})});
   const j=await r.json();if(!r.ok)throw Error(j.error||"Acceptance failed.");await reload();setConfirming(null);
   setNotice(j.activated?"Both participants accepted. Version "+j.revision+" applies to later contributions on this branch; existing contributions and deadlines are unchanged.":"Acceptance recorded. The other participant must accept this exact proposal.");
  }catch(e){setNotice(e instanceof Error?e.message:"Acceptance failed.");}finally{setBusy(false);}
 }
 if(!branches.length)return null;
 return <section className="workspace-panel" aria-labelledby="branch-rules-heading"><p className="small-label">BRANCH RULES</p><h2 id="branch-rules-heading">Rules both candidates agreed to</h2>
  <p>Version 1 of every branch is the debate&apos;s original published rules. A change to the response limit or reply window needs both branch participants to accept the same proposal. It applies only to later contributions on that branch; earlier contributions, their format status and existing deadlines never change.</p>
  <form className="action-form" onSubmit={e=>e.preventDefault()}><label>Branch<select disabled={busy} value={branchId} onChange={e=>{setBranchId(e.target.value);setNotice("");}}>{branches.map(b=><option key={b.id} value={b.id}>{b.contender_name}</option>)}</select></label>
  {mine.length>0&&<label>Act as<select disabled={busy} value={candidateId} onChange={e=>{setCandidateId(e.target.value);setConfirming(null);}}><option value="">Select your candidacy</option>{mine.map(c=><option key={c.id} value={c.id}>{c.public_name}</option>)}</select></label>}</form>
  {rules?<p>In force: version {rules.revision} · {rules.max_response_seconds} seconds per audio/video response (written equivalent at 150 words per minute) · {windowText(rules.reply_window_hours)}.</p>:<p role="status">{notice||"Loading branch rules…"}</p>}
  {rules&&proposals.length===0&&<p>No rule changes have been proposed on this branch.</p>}
  {proposals.map(p=><article key={p.id} className="mini-card"><strong>{p.activated_revision?`Accepted by both · version ${p.activated_revision}`:p.base_revision!==rules?.revision?"Superseded proposal (not in force)":"Proposal awaiting the other participant (not in force)"}</strong>
   <p>Proposed by {p.proposer}, changing version {p.base_revision}: {p.max_response_seconds} seconds · {windowText(p.reply_window_hours)}.</p>
   <p>{p.accepted_by.length} of 2 participants accepted.</p>
   <p className="small-label" style={{overflowWrap:"anywhere"}}>Proposal SHA-256 {p.content_sha256}</p>
   {candidateId&&!p.activated_revision&&p.base_revision===rules?.revision&&<button type="button" className="button button-dark" disabled={busy||p.accepted_by.includes(candidateId)} onClick={()=>accept(p)}>{p.accepted_by.includes(candidateId)?"Your acceptance is recorded":confirming===p.id?"Confirm: accept exactly these rules":"Review and accept these rules"}</button>}
  </article>)}
  {mine.length>0&&rules&&<form className="action-form" onSubmit={propose}><h3>Propose rules for later contributions</h3>
   <label>Audio/video response limit (seconds)<input required type="number" min="1" max="7200" step="1" value={seconds} onChange={e=>setSeconds(e.target.value)}/></label>
   <label>Reply window in hours (leave blank for no fixed deadline)<input type="number" min="1" max="720" step="1" value={hours} onChange={e=>setHours(e.target.value)}/></label>
   <button className="button button-dark" disabled={busy||!candidateId}>Publish proposal for the other participant</button>
  </form>}
  {notice&&rules&&<p role="status">{notice}</p>}
 </section>;
}
