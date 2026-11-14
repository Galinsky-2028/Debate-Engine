"use client";
import {useState,type FormEvent} from "react";
/** Appeal form; the server accepts it only from the account that published the restricted item. */
export default function RestrictionAppeal({caseId}:{caseId:string}){
 const[open,setOpen]=useState(false),[statement,setStatement]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function submit(event:FormEvent){event.preventDefault();setBusy(true);setMessage("");
  try{const r=await fetch("/api/restrictions/"+caseId+"/appeal",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({statement})});const d=await r.json();
   if(!r.ok)throw Error(d.error||"Appeal could not be submitted.");setStatement("");setMessage("Appeal submitted. Your statement stays private to platform administrators; the public history shows only that an appeal was made.");}
  catch(e){setMessage(e instanceof Error?e.message:"Appeal failed.");}finally{setBusy(false);}}
 if(!open)return <p><button type="button" onClick={()=>setOpen(true)}>I published this item — appeal the restriction</button></p>;
 return <form className="action-form" onSubmit={submit}>
  <label>Private appeal statement (25–4000 characters, seen only by platform administrators)<textarea required minLength={25} maxLength={4000} value={statement} onChange={e=>setStatement(e.target.value)}/></label>
  <button className="button button-dark" disabled={busy}>Submit appeal ↗</button>
  {message&&<p role="status" className="form-alert">{message}</p>}
 </form>;
}
