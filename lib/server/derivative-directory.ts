import "server-only";
import {database} from "./db";
import {getAuthenticatedUser} from "../auth/server";
import {HttpError} from "./http";
import {FUTURE_USE_WITHDRAWALS_SQL} from "./policy-agreement-sql";
import {distributePermissionStatus} from "./distribute-permissions";
type Artifact={id:string;status:string;output_sha256:string;manifest_sha256:string;
 source_manifest:{clips:Array<{mediaAssetId:string;startSeconds:number;endSeconds:number}>;
  outputKind:string;releaseTitle:string;captions:string[]};
 rendered_at:string|null;duration_seconds:string|null;has_file:boolean;created_at:string;restriction:Record<string,unknown>|null};
export async function branchArtifactDirectory(branchId:string){
 const branch=await database().query<{id:string;debate_id:string;originator_candidacy_id:string;responder_candidacy_id:string}>(
 "SELECT b.id,b.debate_id,d.originator_candidacy_id,b.responder_candidacy_id FROM debate_branches b JOIN debates d ON d.id=b.debate_id WHERE b.id=$1 AND d.status='published'",[branchId]);
 if(!branch.rowCount)throw new HttpError(404,"Debate branch not found.");
 const user=await getAuthenticatedUser();
 let participantId:string|null=null;
 if(user?.emailVerified){
  const result=await database().query<{id:string}>(
   "SELECT c.id FROM candidacies c JOIN accounts a ON a.id=c.account_id WHERE c.id=ANY(ARRAY[$1::uuid,$2::uuid]) AND a.identity_provider='neon-auth' AND a.external_subject=$3 AND c.verification_status='verified' LIMIT 1",
   [branch.rows[0].originator_candidacy_id,branch.rows[0].responder_candidacy_id,user.id]);
  participantId=result.rows[0]?.id||null;
 }
 const artifacts=await database().query<Artifact>(
  "SELECT a.id,a.status,a.output_sha256,a.manifest_sha256,CASE WHEN a.status='released' AND pde_active_restriction_case('derivative',a.id) IS NOT NULL THEN jsonb_build_object('clips','[]'::jsonb,'outputKind',a.source_manifest->'outputKind','releaseTitle','Restricted summary','captions','[]'::jsonb,'withheld',true) ELSE a.source_manifest END AS source_manifest,CASE WHEN a.status='released' THEN pde_public_restriction('derivative',a.id) END AS restriction,a.created_at,a.rendered_at,a.duration_seconds,(a.rendered_storage_key IS NOT NULL) AS has_file FROM derivative_artifacts a WHERE a.branch_id=$1 AND ($2::boolean OR a.status='released') ORDER BY a.created_at DESC,a.id DESC LIMIT 100",
  [branchId,Boolean(participantId)]
 );
 type Grant={artifact_id:string;permission_id:string;media_asset_id:string;candidate_id:string;scope:unknown;granted_at:string;revoked_at:string|null};
 let permissions:Grant[]=[];
 let approvals:Array<{artifact_id:string;candidacy_id:string}>=[];
 let distributionGrants:Grant[]=[];
 const distributionPermissions:Record<string,Array<{mediaAssetId:string;ownerCandidacyId:string;ownerName:string;state:string}>>={};
 if(participantId&&artifacts.rows.length){
  const results=await Promise.all([
   database().query<Grant>(
    "SELECT a.id AS artifact_id,p.id AS permission_id,p.media_asset_id,p.candidate_id,p.scope,p.granted_at,r.revoked_at FROM media_permissions p JOIN derivative_artifacts a ON p.scope->>'artifactId'=a.id::text LEFT JOIN media_permission_revocations r ON r.permission_id=p.id WHERE a.branch_id=$1 AND p.permission='edit' ORDER BY p.granted_at",[branchId]),
   database().query<{artifact_id:string;candidacy_id:string}>(
    "SELECT x.artifact_id,x.candidacy_id FROM derivative_approvals x JOIN derivative_artifacts a ON a.id=x.artifact_id WHERE a.branch_id=$1",[branchId]),
   database().query<Grant>(
    "SELECT a.id AS artifact_id,p.id AS permission_id,p.media_asset_id,p.candidate_id,p.scope,p.granted_at,r.revoked_at FROM media_permissions p JOIN derivative_artifacts a ON p.scope->>'artifactId'=a.id::text LEFT JOIN media_permission_revocations r ON r.permission_id=p.id WHERE a.branch_id=$1 AND p.permission='distribute' ORDER BY p.granted_at",[branchId])
  ]);
  permissions=results[0].rows;approvals=results[1].rows;distributionGrants=results[2].rows;
  // Plan 11.2/12: which source owner's separate distribution permission is current, missing or withdrawn.
  for(const a of artifacts.rows.filter(x=>x.status==="released"))
   distributionPermissions[a.id]=(await distributePermissionStatus(database(),a.id)).map(x=>({mediaAssetId:x.mediaAssetId,ownerCandidacyId:x.ownerCandidacyId,ownerName:x.ownerName,state:x.state}));
 }
 // Public: released summaries whose owner later withdrew permission for future uses (name and date only).
 const futureUseWithdrawals=artifacts.rows.some(a=>a.status==="released")
  ?(await database().query<{artifact_id:string;owner_name:string;revoked_at:string}>(FUTURE_USE_WITHDRAWALS_SQL,[branchId])).rows:[];
 return {branch:branch.rows[0],participantId,artifacts:artifacts.rows,
  ownerConsentGrants:permissions,candidateOutputApprovals:approvals,futureUseWithdrawals,distributionGrants,distributionPermissions};
}
