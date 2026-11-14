import {createHash} from "node:crypto";
/**
 * PDE-19: the exact, immutable content a candidate endorses.
 * Every field below enters the digest, so a different scope, question list,
 * summary, disagreement note or attachment is a different version and can
 * never inherit an earlier acceptance.
 */
export type PolicyScope="full"|"partial";
export interface PolicyManifest {
  body:string;
  scope:PolicyScope;
  addressedQuestionIds:readonly string[];
  changesSummary:string;
  remainingDisagreements:string;
  /** SHA-256 of each attached, already published supporting document. */
  attachmentSha256:readonly string[];
}
export const POLICY_LIMITS={bodyMin:20,bodyMax:50000,noteMax:10000,questions:50,attachments:20} as const;
const SHA=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function normalizePolicyText(text:string):string{return text.replace(/\r\n/g,"\n");}
export function validatePolicyManifest(m:PolicyManifest):string[]{
  const problems:string[]=[];
  const body=normalizePolicyText(m.body).trim();
  if(body.length<POLICY_LIMITS.bodyMin||body.length>POLICY_LIMITS.bodyMax)problems.push("Policy must be between 20 and 50,000 characters.");
  if(m.scope!=="full"&&m.scope!=="partial")problems.push("Scope must be full or partial.");
  if(m.changesSummary.length>POLICY_LIMITS.noteMax)problems.push("The summary of changes is limited to 10,000 characters.");
  if(m.remainingDisagreements.length>POLICY_LIMITS.noteMax)problems.push("Remaining disagreements are limited to 10,000 characters.");
  if(m.scope==="partial"&&!m.remainingDisagreements.trim())problems.push("A partial proposal must state the disagreements that remain.");
  if(m.addressedQuestionIds.length>POLICY_LIMITS.questions)problems.push("At most 50 addressed questions may be listed.");
  if(m.addressedQuestionIds.some(x=>!UUID.test(x)))problems.push("Addressed questions must be identified by UUID.");
  if(new Set(m.addressedQuestionIds.map(x=>x.toLowerCase())).size!==m.addressedQuestionIds.length)problems.push("An addressed question may be listed only once.");
  if(m.attachmentSha256.length>POLICY_LIMITS.attachments)problems.push("At most 20 supporting documents may be attached.");
  if(m.attachmentSha256.some(x=>!SHA.test(x)))problems.push("Attachment digests must be lowercase SHA-256 values.");
  return problems;
}
/**
 * Canonical digest. A full-scope manifest with no questions, notes or
 * attachments serializes exactly as the original `{body,attachments}` form,
 * so every digest issued before scoped proposals existed stays valid.
 */
export function policyManifestDigest(m:PolicyManifest):string{
  const body=normalizePolicyText(m.body);
  const attachments=[...m.attachmentSha256].sort();
  const changesSummary=normalizePolicyText(m.changesSummary).trim();
  const remainingDisagreements=normalizePolicyText(m.remainingDisagreements).trim();
  const addressedQuestionIds=m.addressedQuestionIds.map(x=>x.toLowerCase()).sort();
  const extended=m.scope!=="full"||addressedQuestionIds.length>0||changesSummary!==""||remainingDisagreements!=="";
  const canonical=extended
    ?{body,attachments,scope:m.scope,addressedQuestionIds,changesSummary,remainingDisagreements}
    :{body,attachments};
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
/** Original two-argument digest, kept byte-for-byte compatible. */
export function policyHash(body:string,attachments:readonly string[]):string{
  return policyManifestDigest({body,scope:"full",addressedQuestionIds:[],changesSummary:"",remainingDisagreements:"",attachmentSha256:attachments});
}
