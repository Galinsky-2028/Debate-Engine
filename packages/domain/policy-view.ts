/**
 * PDE-19 presentation rules shared by the server, press material and the
 * browser. No Node-only imports: this file is bundled into client components.
 */
export type AgreementScope="full"|"partial";
export type DiffLine={kind:"same"|"added"|"removed";text:string};
const MAX_DIFF_CELLS=2_000_000;
/** Line-level difference between a parent version and its successor (longest common subsequence). */
export function lineDiff(before:string,after:string):DiffLine[]{
  const a=before.replace(/\r\n/g,"\n").split("\n"),b=after.replace(/\r\n/g,"\n").split("\n");
  let start=0;
  while(start<a.length&&start<b.length&&a[start]===b[start])start++;
  let endA=a.length,endB=b.length;
  while(endA>start&&endB>start&&a[endA-1]===b[endB-1]){endA--;endB--;}
  const out:DiffLine[]=a.slice(0,start).map(text=>({kind:"same" as const,text}));
  const x=a.slice(start,endA),y=b.slice(start,endB);
  if(x.length*y.length>MAX_DIFF_CELLS||x.length===0||y.length===0){
    // Too large for an exact alignment (or nothing to align): report the changed block honestly as replaced.
    for(const text of x)out.push({kind:"removed",text});
    for(const text of y)out.push({kind:"added",text});
  }else{
    const width=y.length+1,table=new Uint32Array((x.length+1)*width);
    for(let i=x.length-1;i>=0;i--)for(let j=y.length-1;j>=0;j--)
      table[i*width+j]=x[i]===y[j]?table[(i+1)*width+j+1]+1:Math.max(table[(i+1)*width+j],table[i*width+j+1]);
    let i=0,j=0;
    while(i<x.length&&j<y.length){
      if(x[i]===y[j]){out.push({kind:"same",text:x[i]});i++;j++;}
      else if(table[(i+1)*width+j]>=table[i*width+j+1]){out.push({kind:"removed",text:x[i]});i++;}
      else{out.push({kind:"added",text:y[j]});j++;}
    }
    for(;i<x.length;i++)out.push({kind:"removed",text:x[i]});
    for(;j<y.length;j++)out.push({kind:"added",text:y[j]});
  }
  for(const text of a.slice(endA))out.push({kind:"same",text});
  return out;
}
export function diffCounts(lines:readonly DiffLine[]){
  return {added:lines.filter(x=>x.kind==="added").length,removed:lines.filter(x=>x.kind==="removed").length,
    unchanged:lines.filter(x=>x.kind==="same").length};
}
export type VersionEndorsement={
  id:string;scope:AgreementScope;
  /** Candidacies whose latest endorsement event is an acceptance. */
  activeApprovers:readonly string[];
  /** Candidacies with an immutable first acceptance, whether or not still current. */
  historicalApprovers:readonly string[];
};
export type BranchAgreementStatus="joint_full"|"joint_partial"|"different_versions"|"one_sided"|"withdrawn"|"none";
export type BranchAgreement={
  status:BranchAgreementStatus;
  /** True only for a current joint agreement on a full-scope version. */
  resolved:boolean;
  jointFullVersionIds:string[];
  jointPartialVersionIds:string[];
  /** Versions both candidates once accepted that are not jointly endorsed now. */
  formerlyAcceptedByBothVersionIds:string[];
  label:string;
  detail:string;
};
const TEXT:Record<BranchAgreementStatus,{label:string;detail:string}>={
  joint_full:{label:"Joint agreement",
    detail:"Both candidates currently endorse the same full-scope policy version. The platform reports that agreement; it does not certify the policy as correct."},
  joint_partial:{label:"Partial agreement only",
    detail:"Both candidates currently endorse the same partial-scope version. It does not resolve the debate: the stated remaining disagreements and any unaddressed questions stay open."},
  different_versions:{label:"No joint agreement — candidates endorsed different versions",
    detail:"Each candidate currently endorses a version the other has not endorsed. Endorsements of different versions never combine into an agreement."},
  one_sided:{label:"No joint agreement — only one candidate currently endorses a version",
    detail:"One endorsement cannot resolve the debate. The other candidate has not endorsed that exact version."},
  withdrawn:{label:"No current joint agreement — earlier support was withdrawn",
    detail:"A version both candidates had accepted is no longer endorsed by both. The original acceptances remain in the public record."},
  none:{label:"No joint agreement",detail:"No policy version is currently endorsed by a candidate in this branch."}
};
/** Honest branch-level status. Acceptances of different versions are reported as a mismatch, never merged. */
export function branchAgreement(versions:readonly VersionEndorsement[],originatorId:string,responderId:string):BranchAgreement{
  const both=(ids:readonly string[])=>ids.includes(originatorId)&&ids.includes(responderId);
  const joint=versions.filter(v=>both(v.activeApprovers));
  const jointFullVersionIds=joint.filter(v=>v.scope==="full").map(v=>v.id);
  const jointPartialVersionIds=joint.filter(v=>v.scope!=="full").map(v=>v.id);
  const formerlyAcceptedByBothVersionIds=versions.filter(v=>both(v.historicalApprovers)&&!both(v.activeApprovers)).map(v=>v.id);
  const originatorActive=versions.some(v=>v.activeApprovers.includes(originatorId));
  const responderActive=versions.some(v=>v.activeApprovers.includes(responderId));
  const status:BranchAgreementStatus=jointFullVersionIds.length?"joint_full"
    :jointPartialVersionIds.length?"joint_partial"
    :originatorActive&&responderActive?"different_versions"
    :formerlyAcceptedByBothVersionIds.length?"withdrawn"
    :originatorActive||responderActive?"one_sided":"none";
  return {status,resolved:status==="joint_full",jointFullVersionIds,jointPartialVersionIds,
    formerlyAcceptedByBothVersionIds,...TEXT[status]};
}
export type AgreementRecordStatus={scope:AgreementScope;currentlyJoint:boolean;withdrawnAt?:string|Date|null;withdrawnBy?:string|null};
function day(value:string|Date|null|undefined){
  const date=value?new Date(value):null;
  return date&&Number.isFinite(date.valueOf())?date.toISOString().slice(0,10):"an unrecorded date";
}
/** Short label for a version that was jointly accepted at some time. */
export function agreementRecordLabel(r:AgreementRecordStatus):string{
  const kind=r.scope==="partial"?"Partial policy agreement (does not resolve the debate)":"Joint policy agreement";
  if(r.currentlyJoint)return kind;
  return "Withdrawn — no longer a current agreement. Formerly: "+kind.charAt(0).toLowerCase()+kind.slice(1);
}
export function agreementRecordSentence(r:AgreementRecordStatus&{originator:string;contender:string}):string{
  const scope=r.scope==="partial"
    ?"accepted the same partial-scope policy version. It is a partial agreement only: remaining disagreements are stated in the record and the debate is not resolved."
    :"accepted the same full-scope policy version.";
  const withdrawn=r.currentlyJoint?"":" "+(r.withdrawnBy||"A participant")+" withdrew support on "+day(r.withdrawnAt)
    +", so this is not a current agreement. The original acceptances remain part of the public history.";
  return r.originator+" and "+r.contender+" "+scope+withdrawn;
}
export type FeedAgreement=AgreementRecordStatus&{policyVersionId:string;title:string;originator:string;contender:string;lastJointAt:string|Date};
/** Feed items: the agreement itself, plus a separate dated notice when support was later withdrawn. */
export function agreementFeedItems(r:FeedAgreement):Array<{id:string;title:string;description:string;publishedAt:string}>{
  const tail=" Read the full unedited debate and source materials.";
  const items=[{id:"urn:public-debate-engine:policy:"+r.policyVersionId,
    title:agreementRecordLabel(r)+": "+r.title,
    description:agreementRecordSentence(r)+tail,
    publishedAt:new Date(r.lastJointAt).toISOString()}];
  if(!r.currentlyJoint&&r.withdrawnAt)items.unshift({id:"urn:public-debate-engine:policy:"+r.policyVersionId+":withdrawn",
    title:"Support withdrawn from "+(r.scope==="partial"?"partial ":"")+"policy agreement: "+r.title,
    description:(r.withdrawnBy||"A participant")+" withdrew support on "+day(r.withdrawnAt)
      +". The version is no longer jointly endorsed; the earlier acceptances by "+r.originator+" and "+r.contender+" remain in the public history."+tail,
    publishedAt:new Date(r.withdrawnAt).toISOString()});
  return items;
}
/** Wording for a released summary whose editing permission was later withdrawn. Never promises retrieval. */
export function futureUseNotice(owner:string,revokedAt:string|Date):string{
  return owner+" withdrew permission for future uses of their excerpt on "+day(revokedAt)
    +". This already released summary remains public; copies already distributed elsewhere cannot be recalled.";
}
/** Publication event kind for an acceptance. A joint partial agreement is never reported as a full joint acceptance. */
export function policyAcceptanceEventKind(jointlyAgreed:boolean,scope:AgreementScope,previous:string|null){
  if(jointlyAgreed)return scope==="partial"?"policy_partially_accepted_jointly":"policy_jointly_accepted";
  return previous?"policy_reaffirmed":"policy_accepted";
}
