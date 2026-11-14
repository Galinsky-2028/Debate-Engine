import React from "react";
import {publicRestrictions} from "../../../lib/server/restrictions";
import RestrictionAppeal from "./restriction-appeal";
const eventLabels:Record<string,string>={opened:"Restriction opened",appealed:"Appeal submitted",upheld:"Appeal reviewed — restriction upheld",lifted:"Restriction lifted"};
/** Public restriction history for a debate. Renders nothing when there are no cases. */
export default async function RestrictionHistory({debateId}:{debateId:string}){
 const cases=await publicRestrictions(debateId).catch(()=>[]);
 if(!cases.length)return null;
 return <section className="record-section-list" aria-labelledby="restriction-history-heading">
  <h2 id="restriction-history-heading">Exceptional platform restrictions</h2>
  <p>Platform safety administrators may withhold an item's media or text only under the published restriction categories. Candidates cannot restrict each other. Restricted items stay listed and counted; every step below is permanent.</p>
  {cases.map(c=><article className="mini-card" id={"restriction-"+c.caseId} key={c.caseId}>
   <p className="small-label">{c.categoryLabel.toUpperCase()} · {c.targetKind.toUpperCase()} · {c.status==="active"?"ACTIVE":"LIFTED"}</p>
   <ol>{c.events.map((e,i)=><li key={i}><strong>{eventLabels[e.eventType]||e.eventType}</strong> · {new Date(e.occurredAt).toLocaleString("en-US",{timeZone:"UTC"})} UTC{(e.eventType==="upheld"||e.eventType==="lifted")&&<> · {e.independentReview?"decided by a different administrator than the opener":"decided by the opening administrator (no second administrator available)"}</>}<p>{e.publicNotice}</p></li>)}</ol>
   {c.status==="active"&&c.targetKind==="submission"&&<p><a className="inline-arrow" href={"#contribution-"+c.targetId}>Restricted contribution in the record ↑</a></p>}
   {c.status==="active"&&<RestrictionAppeal caseId={c.caseId}/>}
  </article>)}
 </section>;
}
