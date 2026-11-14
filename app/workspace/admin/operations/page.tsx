"use client";
import Link from "next/link";
import {useCallback,useEffect,useState} from "react";
type Row={state:string;n:number;oldest_seconds:number|null;job_type?:string;action_type?:string};
type Dead={id:string;action_type:string;attempts:number;max_attempts:number;last_error:string|null;dead_at:string|null;destination_kind:string|null};
type Snapshot={generatedAt:string;jobs:{backlog:Row[];oldestPendingSeconds:number|null;recentFailures:Array<{id:string;job_type:string;attempt_count:number;last_error:string|null}>};
 outbox:{backlog:Row[];oldestPendingSeconds:number|null;failedCount:number;deadCount:number;providerUnconfiguredCount:number;deadLetters:Dead[]};
 scannerHeartbeatAgeSeconds:number|null;automaticProcessing?:boolean;scheduledRunner?:{configured:boolean;lastRunAt:string|null;runsLastHour:number};storage:{usedBytes:number;budgetBytes:number|null;remainingBytes:number|null;newUploadsAllowed:boolean};
 rendering:{usedSecondsToday:number;budgetSecondsPerDay:number|null;optionalRendersAllowed:boolean};destinations:{unverified:number;verified:number;disabled:number};emailProviderConfigured:boolean;workerNote:string};
const age=(s:number|null)=>s===null?"none":s<120?s+" s":s<7200?Math.round(s/60)+" min":Math.round(s/3600)+" h";
const bytes=(n:number|null)=>n===null?"no budget configured":(n/1024/1024/1024).toFixed(2)+" GiB";
export default function OperationsPage(){
 const[data,setData]=useState<Snapshot|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{try{const r=await fetch("/api/admin/operations",{cache:"no-store"});const j=await r.json();if(!r.ok)throw Error(j.error||"Could not load operations.");setData(j);}catch(e){setMessage(e instanceof Error?e.message:"Could not load operations.");}},[]);
 useEffect(()=>{void load();},[load]);
 async function post(url:string,done:(j:Record<string,unknown>)=>string){setBusy(true);setMessage("");try{const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});const j=await r.json();if(!r.ok)throw Error(j.error||"Request failed.");setMessage(done(j));}catch(e){setMessage(e instanceof Error?e.message:"Request failed.");}finally{setBusy(false);void load();}}
 return <div className="interior-page"><p className="eyebrow dark">PLATFORM ADMINISTRATION / OPERATIONS</p><h1>Queues, failures<br/><em>and budgets.</em></h1>
  <p className="interior-lead">This deployment has no background worker. Deadline checks and deliveries run in small batches after requests, from a laptop with <code>npm run worker:outbox</code>, or with the button below.</p>
  <button className="button button-dark" disabled={busy} onClick={()=>post("/api/admin/operations/run",j=>"Ran "+String(j.deadlineJobs)+" deadline job(s); outbox: "+JSON.stringify(j.outbox)+(j.deadlineError?" · deadline error: "+String(j.deadlineError):"")+(j.outboxError?" · outbox error: "+String(j.outboxError):""))}>Run pending jobs now ↗</button>
  {message&&<p role="status">{message}</p>}
  {data&&<>
   <section className="workspace-panel"><h2>Health</h2><ul>
    <li>Scanner heartbeat: {data.scannerHeartbeatAgeSeconds===null?"never seen":age(data.scannerHeartbeatAgeSeconds)+" ago"}</li>
    <li>Automatic processing: {data.automaticProcessing?"on — deliveries run right after the action that queued them; nothing runs on a schedule":"off — nothing runs until you press Run pending jobs now"}</li>
    <li>Manual workflow runs: {data.scheduledRunner?.lastRunAt?"last ran "+new Date(data.scheduledRunner.lastRunAt).toLocaleString():"never run"}</li>
    <li>Email provider: {data.emailProviderConfigured?"configured":"not configured — email stays queued, never reported sent"}</li>
    <li>Media storage: {bytes(data.storage.usedBytes)} used of {bytes(data.storage.budgetBytes)} · new uploads {data.storage.newUploadsAllowed?"allowed":"PAUSED (budget exhausted)"}</li>
    <li>Rendering today: {Math.round(data.rendering.usedSecondsToday)} s of {data.rendering.budgetSecondsPerDay===null?"no budget configured":data.rendering.budgetSecondsPerDay+" s"} · optional renders {data.rendering.optionalRendersAllowed?"allowed":"PAUSED (budget exhausted)"}</li>
    <li>Destinations: {data.destinations.verified} verified, {data.destinations.unverified} unverified, {data.destinations.disabled} disabled</li>
   </ul></section>
   <section className="workspace-panel"><h2>Durable jobs</h2><p>Oldest due job waiting: {age(data.jobs.oldestPendingSeconds)}</p>
    <table><thead><tr><th scope="col">Type</th><th scope="col">State</th><th scope="col">Count</th></tr></thead><tbody>{data.jobs.backlog.map(r=><tr key={r.job_type+r.state}><td>{r.job_type}</td><td>{r.state}</td><td>{r.n}</td></tr>)}</tbody></table>
    {data.jobs.recentFailures.length>0&&<><h3>Recent failures</h3><ul>{data.jobs.recentFailures.map(f=><li key={f.id}>{f.job_type} · attempts {f.attempt_count} · {f.last_error||"no error recorded"}</li>)}</ul></>}</section>
   <section className="workspace-panel"><h2>Outbox</h2><p>Oldest pending: {age(data.outbox.oldestPendingSeconds)} · retrying: {data.outbox.failedCount} · dead letters: {data.outbox.deadCount} · waiting for an email provider: {data.outbox.providerUnconfiguredCount}</p>
    <table><thead><tr><th scope="col">Action</th><th scope="col">State</th><th scope="col">Count</th></tr></thead><tbody>{data.outbox.backlog.map(r=><tr key={(r.action_type||"")+r.state}><td>{r.action_type}</td><td>{r.state}</td><td>{r.n}</td></tr>)}</tbody></table>
    <h3>Dead letters</h3>{data.outbox.deadLetters.length===0?<p>None.</p>:<ul>{data.outbox.deadLetters.map(d=><li key={d.id}>{d.action_type} → {d.destination_kind||"legacy"} · {d.attempts}/{d.max_attempts} attempts · {d.last_error||"no error recorded"} <button className="button" disabled={busy} onClick={()=>post("/api/admin/operations/outbox/"+d.id+"/retry",()=>"Requeued with three more attempts.")}>Retry</button></li>)}</ul>}
   </section>
   <p className="small-label">Snapshot {new Date(data.generatedAt).toLocaleString()} · {data.workerNote}</p>
  </>}
  <p><Link href="/workspace" className="inline-arrow">Return to workspace</Link></p>
 </div>;
}
