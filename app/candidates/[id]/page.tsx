import {notFound} from "next/navigation";
import Link from "next/link";
import {candidateProfile} from "../../../lib/server/discovery";
import {withdrawalLabel} from "../../../packages/domain/restrictions";
export const dynamic="force-dynamic";
export default async function CandidatePage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const result=await candidateProfile(id).catch(()=>null);if(!result)notFound();
 const {candidate:c,contributions}=result;
 return <div className="interior-page"><p className="eyebrow dark">CANDIDATE PUBLIC RECORD</p><h1>{c.public_name}</h1><p className="interior-lead">{c.office_title} · {c.election_label} · {c.affiliation||"Affiliation not supplied"} · Current verification status: {c.verification_status}</p>
 {c.suspension_notice&&<div className="record-explainer" role="note"><strong>This account is suspended by the platform administrators.</strong><p>{c.suspension_notice}</p><p>Suspension stops the account from acting. Every published contribution stays attributed and public.</p></div>}
 {c.withdrawn_at&&<div className="record-explainer" role="note"><strong>{withdrawalLabel(c.withdrawn_at)}.</strong>{c.withdrawal_statement&&<p>Candidate statement: {c.withdrawal_statement}</p>}<p>Every earlier contribution stays attributed and public. Reply obligations that were open at withdrawal remain listed as open; they are not treated as concessions or as answers.</p></div>}
 <section className="record-section-list"><h2>Published debate contributions</h2><p>Every published response by this candidate appears here, including contributions excluded from the qualifying sequence.</p>
 {contributions.length?contributions.map(s=><article className="mini-card" key={s.submission_id}><p className="small-label">{s.kind.toUpperCase()} · {new Date(s.published_at).toLocaleDateString("en-US")}</p><h3>{s.title}</h3><Link className="inline-arrow" href={"/debates/"+s.id}>View complete public record ↗</Link></article>):<p>This candidate has not published any debate videos yet.</p>}</section>
 <Link href="/candidates" className="inline-arrow">← Candidate directory</Link></div>;
}
