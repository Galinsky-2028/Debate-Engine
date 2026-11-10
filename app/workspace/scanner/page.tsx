'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
export default function ScannerSetup(){
 const [online,setOnline]=useState(false),[message,setMessage]=useState('Checking scanner…');
 useEffect(()=>{
  async function refresh(){try{const r=await fetch('/api/admin/scanner',{cache:'no-store'});const j=await r.json();if(!r.ok)throw Error(j.error);setOnline(j.online);setMessage(j.online?'Scanner connected. Video uploads are available.':'Scanner offline. Start it on your laptop to accept video uploads.');}catch(e){setMessage(e instanceof Error?e.message:'Could not check scanner.');}}
  void refresh();const timer=setInterval(refresh,10000);return()=>clearInterval(timer);
 },[]);
 return <div className="interior-page"><p className="eyebrow dark">PLATFORM ADMINISTRATION</p><h1>Your laptop.<br/><em>Your scanner.</em></h1>
  <p className="interior-lead">Run the trusted safety worker on a Mac, Windows, or Linux computer. It checks uploaded originals without a paid hosting service. Keep it running while accepting uploads.</p>
  <p role="status">{online?'● ':''}{message}</p>
  <ol>
   <li>Install <a href="https://docs.docker.com/get-started/get-docker/" target="_blank" rel="noreferrer">Docker Desktop or Docker Engine</a> and start it.</li>
   <li>Download the <a href="https://github.com/Galinsky-2028/Debate-Engine/archive/refs/heads/main.zip">platform source ZIP</a> and extract it.</li>
   <li><a href="/api/admin/scanner?download=1" className="inline-arrow">Download scanner.env ↗</a> into that extracted folder. This is a private pairing credential: keep it out of shared folders and source control.</li>
   <li>Open Terminal, PowerShell, or your Linux terminal in the extracted folder and run:</li>
  </ol>
  <pre><code>docker compose -f compose.scanner.yaml up --build</code></pre>
  <p>The first start downloads official malware signatures and may take a few minutes. Allow 2 GB of memory. There are no incoming laptop ports, database credentials, or storage credentials to configure. When the scanner stops or the laptop sleeps, new uploads pause and saved uploads can resume.</p>
  <p>This is the platform operator’s safety worker. A candidate’s local preparation is separate: candidates cannot approve their own files for publication by changing a local scan result.</p>
  <p><Link href="/workspace" className="inline-arrow">Return to workspace ↗</Link></p>
 </div>;
}
