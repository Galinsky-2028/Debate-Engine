import {obligationStateLabel as label} from "../../../packages/domain/deadlines";
type Obligation={id:string;branch_id:string|null;from_invitation?:boolean;obligated_name?:string|null;obligated_candidacy_id:string;obligation_type:string;opened_at:string|Date;effective_due_at:string|Date|null;received_at:string|Date|null;state:string};
type Extension={id:string;obligation_id:string;seconds:number;public_reason:string;created_at:string|Date};
const utc=(v:string|Date)=>new Date(v).toISOString().replace("T"," ").slice(0,16)+" UTC";
function duration(seconds:number){const d=Math.floor(seconds/86400),h=Math.floor(seconds%86400/3600),m=Math.floor(seconds%3600/60);return [d&&d+" d",h&&h+" h",m&&m+" min"].filter(Boolean).join(" ")||seconds+" s";}
/** Public review/reply clocks with every documented outage extension shown next to its obligation. */
export default function ObligationLedger({obligations,extensions,branches,names}:{obligations:Obligation[];extensions:Extension[];branches:Array<{id:string;contender_name:string}>;names:Record<string,string>}){
 if(!obligations.length)return null;
 return <section className="source-list" aria-labelledby="obligations-heading"><h2 id="obligations-heading">Review and reply clocks</h2>
  <p>Server-recorded deadlines in UTC. A missed deadline is not a concession. A clock closed by the candidates' recorded joint agreement is not a missed deadline. Platform outage extensions are listed with their public reason.</p>
  <ul>{obligations.map(o=>{const ext=extensions.filter(x=>x.obligation_id===o.id);return <li key={o.id} id={"obligation-"+o.id}>
   <strong>{names[o.obligated_candidacy_id]||o.obligated_name||"Candidate"}</strong> · {o.from_invitation?"response to the direct invitation":<>{o.obligation_type==="review"?"review":"reply"} on the branch with {branches.find(b=>b.id===o.branch_id)?.contender_name||"a contender"}</>} · {label(o.state)}
   {o.effective_due_at?<> · due <time dateTime={new Date(o.effective_due_at).toISOString()}>{utc(o.effective_due_at)}</time></>:" · no fixed deadline"}
   {ext.length>0&&<ul>{ext.map(x=><li key={x.id}>Deadline extended by {duration(Number(x.seconds))} ({x.seconds} seconds) for a documented platform outage on {utc(x.created_at)}: {x.public_reason}</li>)}</ul>}
  </li>;})}</ul>
 </section>;
}
