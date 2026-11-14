"use client";
import {useEffect,useState,type FormEvent} from "react";
type Candidate={id:string;public_name:string};
export default function InviteForm({debateId,originatorId,candidates}:{debateId:string;originatorId:string;candidates:Candidate[]}){
 const[mine,setMine]=useState(false),[invited,setInvited]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{fetch("/api/account/me",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(j=>setMine(Boolean(j?.candidacies?.some((c:{id:string;verification_status:string})=>c.id===originatorId&&c.verification_status==="verified")))).catch(()=>{});},[originatorId]);
 if(!mine||!candidates.length)return null;
 async function invite(e:FormEvent){e.preventDefault();setBusy(true);setMessage("");
  try{const r=await fetch("/api/debates/"+debateId+"/invitations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({candidacyId:originatorId,invitedCandidacyId:invited})});const j=await r.json();if(!r.ok)throw Error(j.error||"Invitation failed.");setMessage(j.status);}
  catch(err){setMessage(err instanceof Error?err.message:"Invitation failed.");}finally{setBusy(false);}}
 return <form className="action-form" onSubmit={invite}><h3>Invite a verified candidate</h3>
  <p>The invitation goes only to the invited candidate's own verified notification destinations. If they have none, it stays a draft and is shown as not sent.</p>
  <label>Candidate<select required value={invited} onChange={e=>setInvited(e.target.value)}><option value="">Choose a verified candidate</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.public_name}</option>)}</select></label>
  <button className="button button-dark" disabled={busy||!invited}>Draft and send invitation ↗</button>{message&&<p role="status">{message}</p>}</form>;
}
