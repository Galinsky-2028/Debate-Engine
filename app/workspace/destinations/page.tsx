"use client";
import Link from "next/link";
import {useCallback,useEffect,useState,type FormEvent} from "react";
type Candidate={id:string;public_name:string;verification_status:string};
type Destination={id:string;kind:string;label:string;address:string;purposes:string[];status:string;created_at:string;verified_at:string|null;disabled_at:string|null};
type Delivery={id:string;action_type:string;labelText:string;destination_label:string;attempts:number;last_error:string|null;created_at:string;accepted_at:string|null;delivered_at:string|null;next_attempt_at:string;state:string};
const when=(v:string|null)=>v?new Date(v).toLocaleString():"—";
export default function DestinationsPage(){
 const[candidates,setCandidates]=useState<Candidate[]>([]),[candidacyId,setCandidacyId]=useState("");
 const[destinations,setDestinations]=useState<Destination[]>([]),[deliveries,setDeliveries]=useState<Delivery[]>([]),[emailProvider,setEmailProvider]=useState(true);
 const[kind,setKind]=useState("webhook"),[label,setLabel]=useState(""),[address,setAddress]=useState(""),[notify,setNotify]=useState(true),[distribute,setDistribute]=useState(false);
 const[secret,setSecret]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const[branchId,setBranchId]=useState(""),[subjectKind,setSubjectKind]=useState("policy"),[subjectId,setSubjectId]=useState(""),[chosen,setChosen]=useState<string[]>([]);
 useEffect(()=>{fetch("/api/account/me",{cache:"no-store"}).then(r=>r.json()).then(j=>{const v=(j.candidacies||[]).filter((c:Candidate)=>c.verification_status==="verified");setCandidates(v);if(v[0])setCandidacyId(v[0].id);}).catch(()=>setMessage("Sign in with a verified candidacy to manage destinations."));},[]);
 const refresh=useCallback(async()=>{if(!candidacyId)return;const r=await fetch("/api/destinations?candidacyId="+candidacyId,{cache:"no-store"});const j=await r.json();if(!r.ok){setMessage(j.error||"Could not load destinations.");return;}setDestinations(j.destinations);setDeliveries(j.deliveries);setEmailProvider(j.emailProviderConfigured);},[candidacyId]);
 useEffect(()=>{void refresh();},[refresh]);
 async function call(url:string,body?:unknown){setBusy(true);setMessage("");try{const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body??{})});const j=await r.json();if(!r.ok)throw Error(j.error||"Request failed.");return j;}catch(e){setMessage(e instanceof Error?e.message:"Request failed.");return null;}finally{setBusy(false);void refresh();}}
 async function add(e:FormEvent){e.preventDefault();setSecret("");const purposes=[notify&&"notifications",distribute&&"distribution"].filter(Boolean);
  const j=await call("/api/destinations",{candidacyId,kind,label,address,purposes});
  if(j){setLabel("");setAddress("");if(j.signingSecret)setSecret(j.signingSecret);setMessage(kind==="webhook"?"Webhook added. Copy the signing secret now, configure your endpoint to echo the challenge, then press Verify.":"Email destination added: "+(j.emailVerification||j.destination.status)+".");}}
 async function distributeNow(e:FormEvent){e.preventDefault();
  const j=await call("/api/branches/"+branchId+"/distributions",{candidacyId,destinationIds:chosen,...(subjectKind==="policy"?{policyVersionId:subjectId}:{artifactId:subjectId})});
  if(j)setMessage(`${j.queued} new delivery request(s) queued. States below update only from provider evidence.`);}
 const active=destinations.filter(d=>!d.disabled_at);
 return <div className="interior-page"><p className="eyebrow dark">CANDIDATE WORKSPACE / DESTINATIONS</p><h1>Where notices<br/><em>reach you.</em></h1>
  <p className="interior-lead">Add up to 10 of your own destinations: one signed webhook URL or one email address each. Nothing is sent to a destination until it is verified, and delivery states below are shown exactly as the provider reported them.</p>
  {!emailProvider&&<p className="form-alert" role="status">No email provider is configured on this platform. Email destinations stay unverified and email notices stay queued — never reported as sent.</p>}
  {candidates.length>1&&<label>Candidacy<select value={candidacyId} onChange={e=>setCandidacyId(e.target.value)}>{candidates.map(c=><option key={c.id} value={c.id}>{c.public_name}</option>)}</select></label>}
  {message&&<p role="status">{message}</p>}
  {secret&&<div className="workspace-panel" role="status"><p className="small-label">SIGNING SECRET — SHOWN ONCE</p><p><code>{secret}</code></p><p>Verify each request: HMAC-SHA256 of <code>timestamp.eventId.body</code> with this secret must equal the <code>X-PDE-Signature</code> header (<code>v1=…</code>). Reject timestamps older than 5 minutes and event ids you already processed.</p></div>}
  <form className="action-form" onSubmit={add}><h2>Add a destination</h2>
   <label>Type<select value={kind} onChange={e=>setKind(e.target.value)}><option value="webhook">Signed webhook (HTTPS)</option><option value="email">Email address</option></select></label>
   <label>Label<input required maxLength={120} value={label} onChange={e=>setLabel(e.target.value)}/></label>
   <label>{kind==="webhook"?"HTTPS URL":"One email address"}<input required maxLength={500} type={kind==="webhook"?"url":"email"} value={address} onChange={e=>setAddress(e.target.value)}/></label>
   <fieldset><legend>Use for</legend><label><input type="checkbox" checked={notify} onChange={e=>setNotify(e.target.checked)}/> Deadline notices and invitations</label><label><input type="checkbox" checked={distribute} onChange={e=>setDistribute(e.target.checked)}/> Distributing jointly approved agreements and summaries</label></fieldset>
   <button className="button button-dark" disabled={busy||!candidacyId||(!notify&&!distribute)||active.length>=10}>Add destination ↗</button>
  </form>
  <section className="workspace-panel"><h2>Your destinations</h2>{destinations.length===0?<p>No destinations yet.</p>:destinations.map(d=><article className="mini-card" key={d.id}>
   <p className="small-label">{d.kind.toUpperCase()} · {d.status.toUpperCase()}</p><h3>{d.label}</h3><p>{d.address}</p><p>Purposes: {d.purposes.join(", ")}</p>
   {!d.disabled_at&&!d.verified_at&&<button className="button" disabled={busy} onClick={async()=>{const j=await call("/api/destinations/"+d.id+"/verify");if(j)setMessage(j.verified?"Destination verified.":j.status);}}>{d.kind==="webhook"?"Verify (send challenge)":"Send confirmation link"}</button>}
   {!d.disabled_at&&<button className="button" disabled={busy} onClick={async()=>{if(confirm("Disable this destination? Queued deliveries to it will fail and it cannot be re-enabled.")){await call("/api/destinations/"+d.id+"/disable");}}}>Disable</button>}
  </article>)}</section>
  <form className="action-form" onSubmit={distributeNow}><h2>Distribute an agreement or approved summary</h2>
   <p>Only a policy both participants currently accept, or a summary file both participants approved and released, can be sent — and only to your own verified distribution destinations. The message contains public links and SHA-256 digests only. IDs appear in the branch press-kit manifest.</p>
   <label>Branch ID<input required value={branchId} onChange={e=>setBranchId(e.target.value.trim())}/></label>
   <label>What to send<select value={subjectKind} onChange={e=>setSubjectKind(e.target.value)}><option value="policy">Jointly accepted policy (press kit link)</option><option value="artifact">Released summary video</option></select></label>
   <label>{subjectKind==="policy"?"Policy version ID":"Summary artifact ID"}<input required value={subjectId} onChange={e=>setSubjectId(e.target.value.trim())}/></label>
   <fieldset><legend>Destinations</legend>{active.filter(d=>d.verified_at&&d.purposes.includes("distribution")).map(d=><label key={d.id}><input type="checkbox" checked={chosen.includes(d.id)} onChange={e=>setChosen(e.target.checked?[...chosen,d.id]:chosen.filter(x=>x!==d.id))}/> {d.label}</label>)}</fieldset>
   <button className="button button-dark" disabled={busy||!chosen.length}>Queue distribution ↗</button>
  </form>
  <section className="workspace-panel"><h2>Delivery history</h2>{deliveries.length===0?<p>Nothing has been queued.</p>:<table><thead><tr><th scope="col">Kind</th><th scope="col">Destination</th><th scope="col">State</th><th scope="col">Attempts</th><th scope="col">Queued</th><th scope="col">Provider accepted</th><th scope="col">Delivered</th><th scope="col">Last error</th></tr></thead>
   <tbody>{deliveries.map(x=><tr key={x.id}><td>{x.action_type.replace(/_/g," ")}</td><td>{x.destination_label}</td><td>{x.labelText}{(x.state==="failed")&&<> · next {when(x.next_attempt_at)}</>}</td><td>{x.attempts}</td><td>{when(x.created_at)}</td><td>{when(x.accepted_at)}</td><td>{when(x.delivered_at)}</td><td>{x.last_error||"—"}</td></tr>)}</tbody></table>}</section>
  <p><Link href="/workspace" className="inline-arrow">Return to workspace</Link></p>
 </div>;
}
