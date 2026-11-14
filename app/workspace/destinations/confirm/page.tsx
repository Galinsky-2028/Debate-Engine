"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
/** Confirmation requires a deliberate button press, so automated link scanners cannot confirm a mailbox. */
export default function ConfirmDestination(){
 const[d,setD]=useState(""),[t,setT]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{const p=new URLSearchParams(window.location.search);setD(p.get("d")||"");setT(p.get("t")||"");},[]);
 async function confirmIt(){setBusy(true);setMessage("");try{const r=await fetch("/api/destinations/"+encodeURIComponent(d)+"/confirm",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:t})});const j=await r.json();if(!r.ok)throw Error(j.error||"Confirmation failed.");setMessage("Confirmed. This address can now receive the notices its candidate chose.");}catch(e){setMessage(e instanceof Error?e.message:"Confirmation failed.");}finally{setBusy(false);}}
 return <div className="interior-page"><p className="eyebrow dark">DESTINATION CONFIRMATION</p><h1>Confirm this<br/><em>address.</em></h1>
  <p className="interior-lead">A verified candidate asked to send debate notices to this mailbox. Confirm only if you control it and want those notices.</p>
  <button className="button button-dark" disabled={busy||!d||!t} onClick={confirmIt}>Confirm address ↗</button>
  {message&&<p role="status">{message}</p>}
  <p><Link href="/" className="inline-arrow">Public Debate Engine home</Link></p>
 </div>;
}
