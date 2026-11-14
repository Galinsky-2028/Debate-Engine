// Plan 11.2 and 12: separate 'distribute' grants for released summaries (migration 0033). No "server-only" import so
// the DB integration tests exercise this code; routes and lib/server/distributions.ts call it inside transaction(...).
import type {PoolClient} from "pg";
import {HttpError} from "./http-error.ts";

type Db = Pick<PoolClient, "query">;
export type DistributePermissionState = "current" | "withdrawn" | "missing";
export type DistributePermissionStatus = {mediaAssetId: string; ownerCandidacyId: string; ownerName: string; state: DistributePermissionState};

/** Per source video of the summary: its owner (public name) and whether that owner's distribute grant is current. */
export async function distributePermissionStatus(db: Db, artifactId: string): Promise<DistributePermissionStatus[]> {
  const r = await db.query<{media_asset_id: string; owner_candidacy_id: string; owner_name: string; state: DistributePermissionState}>(
    `SELECT s.media_asset_id,s.owner_candidacy_id,c.public_name AS owner_name,s.state
     FROM public.pde_artifact_distribute_grant_status($1::uuid) s JOIN candidacies c ON c.id=s.owner_candidacy_id
     ORDER BY c.public_name,s.media_asset_id`, [artifactId]);
  return r.rows.map(x => ({mediaAssetId: x.media_asset_id, ownerCandidacyId: x.owner_candidacy_id, ownerName: x.owner_name, state: x.state}));
}

/** Neutral explanation naming each owner whose distribution permission is missing or withdrawn; null when all are current. */
export function missingDistributePermissionMessage(status: readonly DistributePermissionStatus[]): string | null {
  if (!status.length) return "This summary has no source videos to authorize; it cannot be distributed.";
  const gaps = new Map<string, DistributePermissionState>();
  for (const s of status) if (s.state !== "current" && gaps.get(s.ownerName) !== "missing") gaps.set(s.ownerName, s.state);
  if (!gaps.size) return null;
  const parts = [...gaps].map(([name, state]) => state === "withdrawn" ? `${name} withdrew distribution permission` : `${name} has not granted distribution permission`);
  return `This summary cannot be distributed: ${parts.join("; ")}. Approving the edit is a separate permission from distributing the result.`;
}

/**
 * The verified original owner grants permission to distribute ONE summary that uses their published video.
 * Scope is {artifactId}; the artifact must be on a branch of the same debate and its manifest must use this video.
 */
export async function grantDistributePermission(db: Db, input: {mediaId: string; candidateId: string; authSubject: string; artifactId: string}) {
  const owner = await db.query<{account_id: string}>(
    `SELECT a.id AS account_id FROM media_assets m JOIN submissions s ON s.media_asset_id=m.id JOIN candidacies c ON c.id=m.owner_candidacy_id
     JOIN accounts a ON a.id=c.account_id
     WHERE m.id=$1 AND s.published_at IS NOT NULL AND m.owner_candidacy_id=$2 AND a.external_subject=$3 AND a.identity_provider='neon-auth'
       AND c.verification_status='verified' LIMIT 1 FOR UPDATE OF m`,
    [input.mediaId, input.candidateId, input.authSubject]);
  if (!owner.rowCount) throw new HttpError(403, "Only the verified original owner may grant distribution permission.");
  const artifact = await db.query<{branch_id: string; debate_id: string; status: string}>(
    `SELECT a.branch_id,b.debate_id,a.status FROM derivative_artifacts a JOIN debate_branches b ON b.id=a.branch_id
     JOIN submissions s ON s.media_asset_id=$2 AND s.debate_id=b.debate_id AND s.published_at IS NOT NULL
     WHERE a.id=$1 AND (s.branch_id=b.id OR s.kind='opening')
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.source_manifest->'clips')='array' THEN a.source_manifest->'clips' ELSE '[]'::jsonb END) clip
                   WHERE clip->>'mediaAssetId'=$2::text) LIMIT 1`,
    [input.artifactId, input.mediaId]);
  if (!artifact.rowCount) throw new HttpError(400, "The summary and this video do not share a debate branch, or the summary does not use this video.");
  const existing = await db.query(
    `SELECT 1 FROM media_permissions p WHERE p.media_asset_id=$1 AND p.candidate_id=$2 AND p.permission='distribute' AND p.scope->>'artifactId'=$3::text
       AND NOT p.scope ? 'clipStart' AND NOT EXISTS (SELECT 1 FROM media_permission_revocations r WHERE r.permission_id=p.id)`,
    [input.mediaId, input.candidateId, input.artifactId]);
  if (existing.rowCount) throw new HttpError(409, "You already currently grant distribution of this summary.");
  const permission = await db.query<{id: string; granted_at: Date}>(
    "INSERT INTO media_permissions(candidate_id,media_asset_id,permission,scope) VALUES($1,$2,'distribute',$3::jsonb) RETURNING id,granted_at",
    [input.candidateId, input.mediaId, JSON.stringify({artifactId: input.artifactId})]);
  const a = artifact.rows[0];
  await db.query("INSERT INTO publication_events(debate_id,branch_id,actor_candidacy_id,kind,object_id,payload) VALUES($1,$2,$3,'media_distribution_permission_granted',$4,$5::jsonb)",
    [a.debate_id, a.branch_id, input.candidateId, permission.rows[0].id, JSON.stringify({artifactId: input.artifactId, permission: "distribute"})]);
  await db.query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id,context) VALUES($1,'media_distribution_permission_granted','media_permission',$2,$3::jsonb)",
    [owner.rows[0].account_id, permission.rows[0].id, JSON.stringify({mediaAssetId: input.mediaId, artifactId: input.artifactId})]);
  return {permissionId: permission.rows[0].id, grantedAt: permission.rows[0].granted_at, artifactStatus: a.status};
}
