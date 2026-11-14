"use client";
import Link from "next/link";
import {useEffect,useState,type FormEvent} from "react";
type Obligation={id:string;debate_id:string;debate_title:string;obligation_type:string;obligated_candidate:string;due_at:string|null;effective_due_at:string|null;extension_seconds:number;state:string};
const utc=(v:string|null)=>v?new Date(v).toISOString().replace("T"," ").slice(0,16)+" UTC":"no fixed deadline";
export default function ObligationAdminPage(){
 const [items,setItems]=useState<Obligation[]|null>(null),[selected,setSelected]=useState(""),[hours,setHours]=useState("24"),[reason,setReason]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 async function load(){const r=await fetch("/api/admin/obligations",{cache:"no-store"});const j=await r.json();if(!r.ok)throw Error(j.error||"Obligations are unavailable.");setItems(j.obligations);}
 useEffect(()=>{load().catch(e=>{setItems([]);setMessage(e.message);});},[]);
 async function submit(event:FormEvent){
  event.preventDefault();setBusy(true);setMessage("");
  try{const r=await fetch("/api/admin/obligations/"+selected+"/outage-adjustments",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({seconds:Math.round(Number(hours)*3600),publicReason:reason})});
   const j=await r.json();if(!r.ok)throw Error(j.error||"Extension failed.");setMessage("Extension published. New effective due time: "+utc(j.effectiveDueAt)+".");setReason("");await load();}
  catch(e){setMessage(e instanceof Error?e.message:"Extension failed.");}finally{setBusy(false);}
 }
 return <div className="interior-page"><p className="eyebrow dark">PLATFORM ADMIN / DEADLINES</p><h1>Documented outage<br/><em>extensions.</em></h1>
  <p className="interior-lead">Extend an open or overdue review/reply clock only for a documented platform outage. Every extension is permanent, audited and shown publicly with its reason next to the obligation.</p>
  <section className="workspace-panel"><h2>Open and overdue obligations</h2>
   {items===null?<p role="status">Loading…</p>:items.length===0?<p>No open or overdue obligations.</p>:items.map(o=><article className="mini-card" key={o.id}>
    <strong>{o.debate_title}</strong><p>{o.obligated_candidate} · {o.obligation_type} · {o.state==="overdue"?"No response received by the due date":"Response due"} · {utc(o.effective_due_at)}{o.extension_seconds>0?` (includes ${o.extension_seconds} seconds of outage extensions)`:""}</p>
    <p><Link className="inline-arrow" href={"/debates/"+o.debate_id+"#obligations-heading"}>Public record ↗</Link></p>
   </article>)}
  </section>
  <form className="action-form" onSubmit={submit}><h2>Add an extension</h2>
   <label>Obligation<select required value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select an obligation with a deadline</option>{(items||[]).filter(o=>o.due_at).map(o=><option key={o.id} value={o.id}>{o.debate_title} — {o.obligated_candidate} — {o.obligation_type} — {utc(o.effective_due_at)}</option>)}</select></label>
   <label>Extension in hours (1 minute to 30 days)<input required type="number" min={1/60} max={720} step="any" value={hours} onChange={e=>setHours(e.target.value)}/></label>
   <label>Public reason (20–1000 characters, published verbatim)<textarea required minLength={20} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <button className="button button-dark" disabled={busy||!selected}>Publish extension ↗</button>
  </form>
  {message&&<p role="status">{message}</p>}
  <p><Link href="/workspace" className="inline-arrow">Return to workspace</Link></p></div>;
}
