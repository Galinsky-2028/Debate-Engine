"use client";
import Link from "next/link";
import {useEffect,useState,type FormEvent} from "react";
import {restrictionCategories,restrictionCategoryLabels} from "../../../../packages/domain/restrictions";
import {SUSPENSION_CONFIRMATION} from "../../../../packages/domain/suspension";
type Event={id:string;eventType:string;reasonCategory:string;publicNotice:string;privateBasis:string|null;independentReview:boolean;occurredAt:string};
type Row={account_id:string;display_name:string;status:string;events:Event[]};
export default function AccountSuspensionPage(){
 const[rows,setRows]=useState<Row[]>([]),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const[accountId,setAccountId]=useState(""),[reasonCategory,setReasonCategory]=useState("malware_or_security"),[publicNotice,setPublicNotice]=useState(""),[privateBasis,setPrivateBasis]=useState(""),[confirmation,setConfirmation]=useState("");
 const[notices,setNotices]=useState<Record<string,string>>({});
 async function refresh(){const r=await fetch("/api/admin/accounts/suspensions",{cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.error||"Suspensions unavailable.");setRows(d.accounts||[]);}
 useEffect(()=>{refresh().catch(e=>setMessage(e instanceof Error?e.message:"Unable to load."));},[]);
 async function post(url:string,body:unknown,done:string){setBusy(true);setMessage("");
  try{const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||"Request failed.");setMessage(done);await refresh();return true;}
  catch(e){setMessage(e instanceof Error?e.message:"Request failed.");return false;}finally{setBusy(false);}}
 async function suspend(event:FormEvent){event.preventDefault();
  if(await post("/api/admin/accounts/"+encodeURIComponent(accountId.trim())+"/suspend",{reasonCategory,publicNotice,privateBasis:privateBasis||null,confirmation},"Account suspended. Its published record is unchanged.")){setAccountId("");setPublicNotice("");setPrivateBasis("");setConfirmation("");}}
 function reinstate(id:string){return post("/api/admin/accounts/"+id+"/reinstate",{publicNotice:notices[id]||""},"Account reinstated.");}
 return <div className="interior-page"><p className="eyebrow dark">PLATFORM ADMIN / ACCOUNTS</p><h1>Account<br/><em>suspension.</em></h1>
 <p className="interior-lead">Suspension stops an account from acting on the platform. It never removes, hides or rewrites a published contribution or its attribution. Grounds are limited to the published restriction categories, the public notice appears on the candidate&apos;s public record, and you cannot suspend or reinstate your own account. When more than one administrator is configured, a different administrator must reinstate an account you suspended.</p>
 <form className="action-form workspace-panel" onSubmit={suspend}><h2>Suspend an account</h2>
  <label>Account ID<input required value={accountId} onChange={e=>setAccountId(e.target.value)}/></label>
  <label>Ground<select value={reasonCategory} onChange={e=>setReasonCategory(e.target.value)}>{restrictionCategories.map(c=><option key={c} value={c}>{restrictionCategoryLabels[c]}</option>)}</select></label>
  <label>Public notice (20–1000 characters)<textarea required minLength={20} maxLength={1000} value={publicNotice} onChange={e=>setPublicNotice(e.target.value)}/></label>
  <label>Private basis (optional, administrators only, never public)<textarea maxLength={4000} value={privateBasis} onChange={e=>setPrivateBasis(e.target.value)}/></label>
  <label>Type {SUSPENSION_CONFIRMATION} to confirm<input required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
  <button className="button button-dark" disabled={busy}>Suspend account ↗</button></form>
 {message&&<p role="status" className="form-alert">{message}</p>}
 <section className="workspace-panel"><h2>Suspension history</h2>{rows.length===0?<p>No account has been suspended.</p>:rows.map(r=><article className="mini-card" key={r.account_id}>
  <p className="small-label">{r.status.toUpperCase()} · {r.account_id}</p><h3>{r.display_name}</h3>
  <ol>{r.events.map(e=><li key={e.id}><strong>{e.eventType}</strong> · {new Date(e.occurredAt).toLocaleString("en-US")} · {restrictionCategoryLabels[e.reasonCategory as keyof typeof restrictionCategoryLabels]||e.reasonCategory}{e.eventType==="reinstated"&&<> · {e.independentReview?"independent of the suspending administrator":"same administrator"}</>}<p>Public: {e.publicNotice}</p>{e.privateBasis&&<p>Private: {e.privateBasis}</p>}</li>)}</ol>
  {r.status==="suspended"&&<div className="action-form"><label>Public reason for reinstatement (20–1000 characters)<textarea minLength={20} maxLength={1000} value={notices[r.account_id]||""} onChange={e=>setNotices({...notices,[r.account_id]:e.target.value})}/></label>
   <button type="button" disabled={busy} onClick={()=>reinstate(r.account_id)}>Reinstate account</button></div>}
 </article>)}</section>
 <p><Link href="/workspace" className="inline-arrow">Return to workspace</Link></p></div>;
}
