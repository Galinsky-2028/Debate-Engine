import "server-only";
import {database,transaction} from "./db";
import {HttpError} from "./http";

/** PDE-20: the verified original owner's own grants for one media asset, with revocation state. */
export async function ownMediaPermissions(input:{mediaId:string;authSubject:string}){
 const owner=await database().query<{candidate_id:string}>(
  "SELECT m.owner_candidacy_id AS candidate_id FROM media_assets m JOIN candidacies c ON c.id=m.owner_candidacy_id JOIN accounts a ON a.id=c.account_id WHERE m.id=$1 AND a.identity_provider='neon-auth' AND a.external_subject=$2 AND c.verification_status='verified'",
  [input.mediaId,input.authSubject]);
 if(!owner.rowCount)throw new HttpError(403,"Only the verified original owner may view these permissions.");
 const rows=await database().query<{id:string;permission:string;scope:unknown;granted_at:string;revoked_at:string|null;revocation_reason:string|null;artifact_status:string|null}>(
  "SELECT p.id,p.permission,p.scope,p.granted_at,r.revoked_at,r.reason AS revocation_reason,a.status AS artifact_status FROM media_permissions p LEFT JOIN media_permission_revocations r ON r.permission_id=p.id LEFT JOIN derivative_artifacts a ON a.id::text=p.scope->>'artifactId' WHERE p.media_asset_id=$1 AND p.candidate_id=$2 ORDER BY p.granted_at,p.id",
  [input.mediaId,owner.rows[0].candidate_id]);
 return {candidateId:owner.rows[0].candidate_id,permissions:rows.rows.map(x=>({...x,
  revocable:(x.permission==="edit"||x.permission==="distribute")&&!x.revoked_at,
  effect:x.revoked_at?(x.artifact_status==="released"
   ?"Already released before withdrawal: stays public with a dated notice. Distributed copies cannot be recalled."
   :x.permission==="distribute"?"Withdrawn: this permission can no longer authorize distribution of the summary."
   :"Withdrawn: this permission can no longer authorize rendering, approval or release."):null}))};
}

/**
 * Revoke an OPTIONAL grant ('edit' or 'distribute') for future uses. Archive and
 * sequence grants made at publication are not revocable (plan 11.2). Already
 * released artifacts stay released; the platform never promises retrieval of copies.
 */
export async function revokeMediaPermission(input:{mediaId:string;permissionId:string;authSubject:string;reason:string|null}){
 if(input.reason!==null&&input.reason.length>1000)throw new HttpError(400,"A reason is limited to 1,000 characters.");
 return transaction(async db=>{
  const grant=await db.query<{candidate_id:string;account_id:string;permission:string;artifact_id:string|null}>(
   "SELECT p.candidate_id,c.account_id,p.permission,p.scope->>'artifactId' AS artifact_id FROM media_permissions p JOIN media_assets m ON m.id=p.media_asset_id AND m.owner_candidacy_id=p.candidate_id JOIN candidacies c ON c.id=p.candidate_id AND c.verification_status='verified' JOIN accounts a ON a.id=c.account_id WHERE p.id=$1 AND p.media_asset_id=$2 AND a.identity_provider='neon-auth' AND a.external_subject=$3 FOR UPDATE OF m",
   [input.permissionId,input.mediaId,input.authSubject]);
  if(!grant.rowCount)throw new HttpError(403,"Only the verified owner who granted this permission may withdraw it.");
  const g=grant.rows[0];
  if(g.permission!=="edit"&&g.permission!=="distribute")
   throw new HttpError(409,"Archive and sequence permissions given at publication cannot be withdrawn; the original stays in the public record.");
  const already=await db.query("SELECT 1 FROM media_permission_revocations WHERE permission_id=$1",[input.permissionId]);
  if(already.rowCount)throw new HttpError(409,"This permission was already withdrawn.");
  const row=await db.query<{id:string;revoked_at:Date}>(
   "INSERT INTO media_permission_revocations(permission_id,candidate_id,reason) VALUES($1,$2,$3) RETURNING id,revoked_at",
   [input.permissionId,g.candidate_id,input.reason]);
  const artifact=g.artifact_id&&/^[0-9a-f-]{36}$/i.test(g.artifact_id)
   ?(await db.query<{status:string;debate_id:string;branch_id:string}>("SELECT a.status,b.debate_id,a.branch_id FROM derivative_artifacts a JOIN debate_branches b ON b.id=a.branch_id WHERE a.id=$1",[g.artifact_id])).rows[0]:undefined;
  const debate=artifact?{debate_id:artifact.debate_id,branch_id:artifact.branch_id}
   :(await db.query<{debate_id:string;branch_id:string|null}>("SELECT debate_id,branch_id FROM submissions WHERE media_asset_id=$1 AND published_at IS NOT NULL ORDER BY published_at LIMIT 1",[input.mediaId])).rows[0];
  const alreadyReleased=artifact?.status==="released";
  // Public event: owner, date and effect only. The optional reason stays with the owner.
  if(debate)await db.query("INSERT INTO publication_events(debate_id,branch_id,actor_candidacy_id,kind,object_id,payload) VALUES($1,$2,$3,'media_permission_revoked',$4,$5::jsonb)",
   [debate.debate_id,debate.branch_id,g.candidate_id,input.permissionId,JSON.stringify({permission:g.permission,artifactId:g.artifact_id,
    revokedAt:row.rows[0].revoked_at,alreadyReleased,futureUsesOnly:true,retrievalOfDistributedCopiesPromised:false})]);
  await db.query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id,context) VALUES($1,'media_permission_revoked','media_permission',$2,$3::jsonb)",
   [g.account_id,input.permissionId,JSON.stringify({mediaAssetId:input.mediaId,permission:g.permission})]);
  return {revocationId:row.rows[0].id,permissionId:input.permissionId,revokedAt:row.rows[0].revoked_at,alreadyReleased,
   effect:g.permission==="distribute"
    ?"The summary can no longer be distributed on your behalf; queued deliveries are stopped and copies already distributed cannot be recalled."
    :alreadyReleased?"The already released summary stays public with a dated notice; copies already distributed cannot be recalled."
    :"This permission can no longer authorize rendering, approval or release."};
 });
}
