import {publicInvitations,invitableCandidacies} from "../../../lib/server/invitations";
import InviteForm from "./invite-form";
/** Plan section 5: invitation states come from provider evidence only. Uninvited verified candidates may still respond. */
export default async function InvitationStatus({debateId,originatorId}:{debateId:string;originatorId:string}){
 const [invitations,invitable]=await Promise.all([publicInvitations(debateId).catch(()=>null),invitableCandidacies(debateId).catch(()=>[])]);
 if(invitations===null)return null;
 return <section className="workspace-panel" aria-labelledby="invitations-heading"><h2 id="invitations-heading">Direct invitations</h2>
  {invitations.length===0?<p>No candidate has been individually invited. Verified candidates for the same office may respond under the published rules.</p>:
   <ul>{invitations.map(i=><li key={i.id}><strong>{i.invitedName}</strong> — {i.label}</li>)}</ul>}
  <p className="small-label">An invitation counts as sent only when a delivery provider accepted it. Candidates who were not invited, or whose invitation was never sent, are never described as unresponsive. A response clock starts only with that provider evidence and is recorded with the review and reply clocks below.</p>
  <InviteForm debateId={debateId} originatorId={originatorId} candidates={invitable}/>
 </section>;
}
