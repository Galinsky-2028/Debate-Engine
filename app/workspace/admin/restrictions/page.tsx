"use client";
import Link from "next/link";
import {useEffect,useState,type FormEvent} from "react";
import {restrictionCategories,restrictionCategoryLabels,restrictionTargetKinds} from "../../../../packages/domain/restrictions";
type Event={id:string;event_type:string;public_notice:string;private_basis:string|null;independent_review:boolean;occurred_at:string};
type Case={id:string;target_kind:string;target_id:string;debate_id:string;debate_title:string;reason_category:string;status:string;opened_at:string;events:Event[]};
export default function RestrictionAdminPage(){
 const[cases,setCases]=useState<Case[]>([]),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const[targetKind,setTargetKind]=useState("submission"),[targetId,setTargetId]=useState(""),[reasonCategory,setReasonCategory]=useState("malware_or_security"),[publicNotice,setPublicNotice]=useState(""),[privateBasis,setPrivateBasis]=useState("");
 const[reasons,setReasons]=useState<Record<string,string>>({});
 async function refresh(){const r=await fetch("/api/admin/restrictions",{cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.error||"Restriction cases unavailable.");setCases(d.cases||[]);}
 useEffect(()=>{refresh().catch(e=>setMessage(e instanceof Error?e.message:"Unable to load."));},[]);
 async function post(url:string,body:unknown,done:string){setBusy(true);setMessage("");
  try{const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||"Request failed.");setMessage(done);await refresh();return true;}
  catch(e){setMessage(e instanceof Error?e.message:"Request failed.");return false;}finally{setBusy(false);}}
 async function open(event:FormEvent){event.preventDefault();
  if(await post("/api/admin/restrictions",{targetKind,targetId,reasonCategory,publicNotice,privateBasis:privateBasis||null},"Restriction case opened. The item stays listed with the public notice.")){setTargetId("");setPublicNotice("");setPrivateBasis("");}}
 function decide(id:string,decision:"uphold"|"lift"){return post("/api/admin/restrictions/"+id+"/decide",{decision,publicReason:reasons[id]||""},decision==="lift"?"Restriction lifted; the item is fully restored and the history stays public.":"Appeal decided: restriction upheld.");}
 return <div className="interior-page"><p className="eyebrow dark">PLATFORM ADMIN / RESTRICTIONS</p><h1>Exceptional<br/><em>restrictions.</em></h1>
 <p className="interior-lead">Restrictions are limited to the published categories, withhold bytes only, and never delete or alter a published item. You cannot open or decide a case in a debate where you own or serve a participating campaign. When more than one administrator is configured, a different administrator must decide a case you opened.</p>
 <form className="action-form workspace-panel" onSubmit={open}><h2>Open a case</h2>
  <label>Target kind<select value={targetKind} onChange={e=>setTargetKind(e.target.value)}>{restrictionTargetKinds.map(k=><option key={k} value={k}>{k}</option>)}</select></label>
  <label>Target ID (published submission, supporting document or released derivative)<input required value={targetId} onChange={e=>setTargetId(e.target.value)}/></label>
  <label>Reason category<select value={reasonCategory} onChange={e=>setReasonCategory(e.target.value)}>{restrictionCategories.map(c=><option key={c} value={c}>{restrictionCategoryLabels[c]}</option>)}</select></label>
  <label>Public notice (20–1000 characters; describe the restriction without repeating the material)<textarea required minLength={20} maxLength={1000} value={publicNotice} onChange={e=>setPublicNotice(e.target.value)}/></label>
  <label>Private basis (optional, administrators only, never public)<textarea maxLength={4000} value={privateBasis} onChange={e=>setPrivateBasis(e.target.value)}/></label>
  <button className="button button-dark" disabled={busy}>Open restriction ↗</button></form>
 {message&&<p role="status" className="form-alert">{message}</p>}
 <section className="workspace-panel"><h2>Cases</h2>{cases.length===0?<p>No restriction cases.</p>:cases.map(c=>{const last=c.events.at(-1)?.event_type;return <article className="mini-card" key={c.id}>
  <p className="small-label">{c.status.toUpperCase()} · {restrictionCategoryLabels[c.reason_category as keyof typeof restrictionCategoryLabels]||c.reason_category} · {c.target_kind} {c.target_id}</p>
  <h3><Link href={"/debates/"+c.debate_id}>{c.debate_title}</Link></h3>
  <ol>{c.events.map(e=><li key={e.id}><strong>{e.event_type}</strong> · {new Date(e.occurred_at).toLocaleString("en-US")}{(e.event_type==="upheld"||e.event_type==="lifted")&&<> · {e.independent_review?"independent of opener":"same administrator as opener"}</>}<p>Public: {e.public_notice}</p>{e.private_basis&&<p>Private: {e.private_basis}</p>}</li>)}</ol>
  {c.status==="active"&&<div className="action-form"><label>Public reason for decision (20–1000 characters)<textarea minLength={20} maxLength={1000} value={reasons[c.id]||""} onChange={e=>setReasons({...reasons,[c.id]:e.target.value})}/></label>
   {last==="appealed"&&<button type="button" disabled={busy} onClick={()=>decide(c.id,"uphold")}>Uphold restriction</button>} <button type="button" disabled={busy} onClick={()=>decide(c.id,"lift")}>Lift restriction</button></div>}
 </article>;})}</section>
 <p><Link href="/workspace" className="inline-arrow">Return to workspace</Link></p></div>;
}
