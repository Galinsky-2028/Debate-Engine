import Link from "next/link";
import {database} from "../../lib/server/db";
import {JOINT_AGREEMENT_RECORDS_SQL} from "../../lib/server/policy-agreement-sql";
import {agreementRecordLabel,agreementRecordSentence,type AgreementScope} from "../../packages/domain/policy-view";
import DistributionCount from "./distribution-count";
export const dynamic="force-dynamic";
type Release={branch_id:string;debate_id:string;title:string;originator:string;contender:string;content_sha256:string;policy_version_id:string;
 scope:AgreementScope;currently_joint:boolean;withdrawn_at:string|null;withdrawn_by:string|null;last_joint_at:string;remaining_disagreements:string};
async function releases(){
 // Status is derived from the latest endorsement event per candidate (never the first-acceptance table alone).
 const result=await database().query<Release>(JOINT_AGREEMENT_RECORDS_SQL,[null]);
 const seen=new Set<string>();
 // Rows are ordered current-first, then most recent; show one record per branch.
 return result.rows.filter(x=>!seen.has(x.branch_id)&&seen.add(x.branch_id))
  .sort((a,b)=>Number(b.currently_joint)-Number(a.currently_joint)||new Date(b.last_joint_at).getTime()-new Date(a.last_joint_at).getTime());
}
export default async function PressPage(){
 let items:Release[]=[];let available=true;try{items=await releases();}catch{available=false;}
 return <div className="interior-page"><p className="eyebrow dark">PUBLIC DEBATE / MEDIA LIBRARY</p><h1>Agreements<br/><em>on the record.</em></h1>
 <p className="interior-lead">When opposing candidates jointly accept a policy, their exact agreement and the complete original public debate remain accessible to everyone. Partial agreements are labelled as partial, and withdrawn support is shown as withdrawn with its history preserved.</p>
 {!available?<p role="status">The press archive is currently unavailable.</p>:items.length===0?<section className="empty-record"><div><h2>No joint agreements have been published yet.</h2><p>This section will display agreements only after both participants have approved the same policy.</p></div></section>:
 <div className="debate-grid">{items.map(x=>{const status={scope:x.scope,currentlyJoint:x.currently_joint,withdrawnAt:x.withdrawn_at,withdrawnBy:x.withdrawn_by};
  return <article className="debate-card" key={x.branch_id}><p className="small-label">{agreementRecordLabel(status).toUpperCase()}</p><h2>{x.title}</h2><p>{agreementRecordSentence({...status,originator:x.originator,contender:x.contender})}</p>
  {x.scope==="partial"&&<p><strong>Remaining disagreements:</strong> {x.remaining_disagreements}</p>}
  <DistributionCount branchId={x.branch_id}/><div className="press-links"><Link className="inline-arrow" href={"/debates/"+x.debate_id}>Full public record ↗</Link><a className="inline-arrow" href={"/api/branches/"+x.branch_id+"/press-kit?format=zip"}>Download evidence package ↗</a><a className="inline-arrow" href={"/api/branches/"+x.branch_id+"/press-kit?format=json"}>Machine-readable manifest ↗</a></div></article>;})}</div>}
 </div>;
}
