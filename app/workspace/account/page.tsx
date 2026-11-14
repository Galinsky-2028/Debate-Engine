"use client";
import Link from "next/link";
import {useEffect,useState,type FormEvent} from "react";
import {ACCOUNT_CLOSURE_CONFIRMATION,WITHDRAWAL_CONFIRMATION,withdrawalLabel} from "../../../packages/domain/restrictions";
type Candidacy={id:string;public_name:string;label:string;office_title:string;withdrawn_at:string|null};
export default function AccountPage(){
 const[candidacies,setCandidacies]=useState<Candidacy[]>([]),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[closed,setClosed]=useState(false);
 const[closeText,setCloseText]=useState(""),[withdrawText,setWithdrawText]=useState<Record<string,string>>({}),[statement,setStatement]=useState<Record<string,string>>({});
 async function refresh(){const r=await fetch("/api/account/me",{cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.error||"Account unavailable.");setCandidacies(d.candidacies||[]);}
 useEffect(()=>{refresh().catch(e=>setMessage(e instanceof Error?e.message:"Unable to load."));},[]);
 async function withdraw(id:string){setBusy(true);setMessage("");
  try{const r=await fetch("/api/candidacies/"+id+"/withdraw",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({confirmation:withdrawText[id]||"",statement:statement[id]||null})});const d=await r.json();if(!r.ok)throw Error(d.error||"Withdrawal failed.");setMessage("Withdrawal recorded. Your earlier contributions remain public and attributed.");await refresh();}
  catch(e){setMessage(e instanceof Error?e.message:"Withdrawal failed.");}finally{setBusy(false);}}
 async function close(event:FormEvent){event.preventDefault();setBusy(true);setMessage("");
  try{const r=await fetch("/api/account/close",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({confirmation:closeText})});const d=await r.json();if(!r.ok)throw Error(d.error||"Closure failed.");setClosed(true);setMessage("Account closed. Private drafts and private assistant data were erased; published contributions remain public and attributed.");}
  catch(e){setMessage(e instanceof Error?e.message:"Closure failed.");}finally{setBusy(false);}}
 return <div className="interior-page"><p className="eyebrow dark">ACCOUNT / WITHDRAWAL AND CLOSURE</p><h1>Leaving the<br/><em>record intact.</em></h1>
 <p className="interior-lead">Withdrawing a candidacy or closing your account never removes what you already published. Your contributions, questions, assessments and agreements stay attributed in the permanent public record.</p>
 <section className="workspace-panel"><h2>Withdraw a candidacy</h2><p>A withdrawn candidacy cannot start debates or publish new contributions. Its profile shows the withdrawal date. Withdrawal is final.</p>
 {candidacies.length===0?<p>No candidacies on this account.</p>:candidacies.map(c=><article className="mini-card" key={c.id}><strong>{c.public_name} · {c.office_title} · {c.label}</strong>
  {c.withdrawn_at?<p>{withdrawalLabel(c.withdrawn_at)}</p>:<div className="action-form">
   <label>Optional public statement (up to 1000 characters)<textarea maxLength={1000} value={statement[c.id]||""} onChange={e=>setStatement({...statement,[c.id]:e.target.value})}/></label>
   <label>Type {WITHDRAWAL_CONFIRMATION} to confirm<input value={withdrawText[c.id]||""} onChange={e=>setWithdrawText({...withdrawText,[c.id]:e.target.value})}/></label>
   <button type="button" disabled={busy||withdrawText[c.id]!==WITHDRAWAL_CONFIRMATION} onClick={()=>withdraw(c.id)}>Withdraw from this election</button></div>}
 </article>)}</section>
 <form className="action-form workspace-panel" onSubmit={close}><h2>Close account</h2>
  <p>Closing is final. It revokes campaign access you hold or granted, erases your private drafts, private assistant reports and feedback, and blocks all future changes from this account. Published records are not deleted.</p>
  <label>Type {ACCOUNT_CLOSURE_CONFIRMATION} to confirm<input value={closeText} onChange={e=>setCloseText(e.target.value)}/></label>
  <button className="button button-dark" disabled={busy||closed||closeText!==ACCOUNT_CLOSURE_CONFIRMATION}>Close my account</button></form>
 {message&&<p role="status" className="form-alert">{message}</p>}
 <p><Link href="/workspace/privacy" className="inline-arrow">← Private data controls</Link></p></div>;
}
