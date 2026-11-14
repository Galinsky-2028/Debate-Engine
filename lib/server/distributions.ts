import "server-only";
import {database, transaction} from "./db";
import {HttpError} from "./http";
import {labelled, type DeliveryRow} from "./outbox";
import {enqueueAction, publicOrigin} from "../../packages/delivery/outbox-store.ts";
import {ARTIFACT_GRANTS_CURRENT_SQL} from "./policy-agreement-sql";
import {distributePermissionStatus, missingDistributePermissionMessage} from "./distribute-permissions";

async function participant(db: Pick<import("pg").PoolClient, "query">, branchId: string, candidacyId: string, authSubject: string) {
  const r = await db.query<{debate_id: string; title: string; originator_candidacy_id: string; responder_candidacy_id: string; account_id: string}>(
    `SELECT d.id AS debate_id,d.title,d.originator_candidacy_id,b.responder_candidacy_id,a.id AS account_id
     FROM debate_branches b JOIN debates d ON d.id=b.debate_id AND d.status='published'
     JOIN candidacies c ON c.id=$2 AND c.verification_status='verified' JOIN accounts a ON a.id=c.account_id
     WHERE b.id=$1 AND a.identity_provider='neon-auth' AND a.external_subject=$3 AND c.id IN (d.originator_candidacy_id,b.responder_candidacy_id)`,
    [branchId, candidacyId, authSubject]);
  if (!r.rowCount) throw new HttpError(403, "Only a verified participant in this branch may distribute its agreement or summary.");
  return r.rows[0];
}

/**
 * PDE-23: send a released (jointly approved) summary or a currently jointly endorsed policy's press-kit link to the
 * requesting participant's OWN verified distribution destinations. Payload: public URLs and SHA-256 digests only.
 */
export async function requestDistribution(input: {branchId: string; candidacyId: string; authSubject: string; artifactId: string | null; policyVersionId: string | null; destinationIds: string[]}) {
  if ((input.artifactId === null) === (input.policyVersionId === null)) throw new HttpError(400, "Provide exactly one of artifactId or policyVersionId.");
  const ids = [...new Set(input.destinationIds)];
  if (!ids.length || ids.length > 10) throw new HttpError(400, "Choose between 1 and 10 of your destinations.");
  const origin = publicOrigin();
  const result = await transaction(async db => {
    const p = await participant(db, input.branchId, input.candidacyId, input.authSubject);
    const debateUrl = origin + "/debates/" + p.debate_id;
    let subjectKind: "derivative_artifact" | "policy_version", subjectId: string, digest: string, data: Record<string, unknown>, subject: string, lines: string[];
    if (input.artifactId) {
      const a = await db.query<{output_sha256: string; duration_seconds: string | null}>(
        "SELECT output_sha256,duration_seconds FROM derivative_artifacts WHERE id=$1 AND branch_id=$2 AND status='released' AND rendered_storage_key IS NOT NULL",
        [input.artifactId, input.branchId]);
      if (!a.rowCount) throw new HttpError(409, "Only a summary released with both candidates' approval of the exact file can be distributed.");
      // A release does not authorize later distribution once a source owner withdrew editing permission for future
      // uses, or while an exceptional restriction is active on the summary.
      const future = await db.query<{current: boolean}>(ARTIFACT_GRANTS_CURRENT_SQL, [input.artifactId]);
      if (!future.rows[0]?.current) throw new HttpError(409, "A source owner withdrew permission for future uses of this summary; it can no longer be distributed.");
      // Plan 11.2/12: distribution is a separate permission. Every source owner must currently grant 'distribute'.
      const missing = missingDistributePermissionMessage(await distributePermissionStatus(db, input.artifactId));
      if (missing) throw new HttpError(409, missing);
      const restricted = await db.query("SELECT 1 FROM restriction_cases WHERE target_kind='derivative' AND target_id=$1 AND status='active'", [input.artifactId]);
      if (restricted.rowCount) throw new HttpError(451, "This summary is under an exceptional platform restriction and cannot be distributed.");
      subjectKind = "derivative_artifact"; subjectId = input.artifactId; digest = a.rows[0].output_sha256;
      const download = origin + "/api/branches/" + input.branchId + "/derivatives/" + input.artifactId + "/download";
      data = {kind: "released_summary", debateId: p.debate_id, branchId: input.branchId, title: p.title, artifactId: input.artifactId,
        sha256: digest, durationSeconds: a.rows[0].duration_seconds === null ? null : Number(a.rows[0].duration_seconds), downloadUrl: download, publicUrl: debateUrl};
      subject = "Jointly approved debate summary: " + p.title;
      lines = ["Both debate participants approved this exact summary file.", "Download: " + download, "SHA-256: " + digest, "Complete unedited public record: " + debateUrl];
    } else {
      const v = await db.query<{content_sha256: string}>(
        `SELECT p.content_sha256 FROM policy_versions p WHERE p.id=$1 AND p.branch_id=$2
          AND (SELECT e.action FROM policy_endorsement_events e WHERE e.policy_version_id=p.id AND e.candidacy_id=$3 ORDER BY e.event_order DESC LIMIT 1)='accept'
          AND (SELECT e.action FROM policy_endorsement_events e WHERE e.policy_version_id=p.id AND e.candidacy_id=$4 ORDER BY e.event_order DESC LIMIT 1)='accept'`,
        [input.policyVersionId, input.branchId, p.originator_candidacy_id, p.responder_candidacy_id]);
      if (!v.rowCount) throw new HttpError(409, "Only a policy version that both participants currently accept can be distributed.");
      subjectKind = "policy_version"; subjectId = input.policyVersionId!; digest = v.rows[0].content_sha256;
      const pressKit = origin + "/api/branches/" + input.branchId + "/press-kit?format=zip";
      data = {kind: "agreed_policy", debateId: p.debate_id, branchId: input.branchId, title: p.title, policyVersionId: subjectId,
        sha256: digest, pressKitUrl: pressKit, pressKitJsonUrl: origin + "/api/branches/" + input.branchId + "/press-kit?format=json", publicUrl: debateUrl};
      subject = "Jointly accepted policy: " + p.title;
      lines = ["Both debate participants accepted this exact policy version. The platform does not certify it as objectively best.",
        "Press kit: " + pressKit, "Policy SHA-256: " + digest, "Complete unedited public record: " + debateUrl];
    }
    const dests = await db.query<{id: string}>(
      "SELECT id FROM delivery_destinations WHERE id=ANY($1::uuid[]) AND candidacy_id=$2 AND verified_at IS NOT NULL AND disabled_at IS NULL AND 'distribution'=ANY(purposes)",
      [ids, input.candidacyId]);
    if (dests.rowCount !== ids.length) throw new HttpError(403, "Every destination must be one of your own verified, active distribution destinations.");
    const actions: Array<{destinationId: string; actionId: string | null; alreadyRequested: boolean}> = [];
    for (const d of dests.rows) {
      const r = await enqueueAction(db, {
        actionType: "distribution", destinationId: d.id, ownerCandidacyId: input.candidacyId, dedupeKey: `distribution:${subjectKind}:${subjectId}:${digest}`,
        debateId: p.debate_id, branchId: input.branchId, subjectKind, subjectId,
        payload: {type: "pde.distribution." + data.kind, data, email: {subject, text: lines.join("\n")}},
      });
      actions.push({destinationId: d.id, actionId: r.id, alreadyRequested: !r.created});
    }
    await db.query("INSERT INTO audit_events(actor_account_id,action,target_kind,target_id,context) VALUES($1,'distribution_requested',$2,$3,$4::jsonb)",
      [p.account_id, subjectKind, subjectId, JSON.stringify({branchId: input.branchId, destinations: ids.length, sha256: digest})]);
    return actions;
  });
  return {queued: result.filter(a => !a.alreadyRequested).length, actions: result};
}

export async function listDistributions(input: {branchId: string; candidacyId: string; authSubject: string}) {
  await participant(database(), input.branchId, input.candidacyId, input.authSubject);
  const rows = await database().query<DeliveryRow>(
    `SELECT o.id,o.action_type,o.state,o.attempts,o.max_attempts,o.last_error,o.created_at,o.last_attempt_at,o.accepted_at,o.delivered_at,o.next_attempt_at,
      o.destination_id,d.label AS destination_label,d.kind AS destination_kind,o.subject_kind,o.subject_id
     FROM outgoing_actions o JOIN delivery_destinations d ON d.id=o.destination_id
     WHERE o.action_type='distribution' AND o.branch_id=$1 AND o.owner_candidacy_id=$2 ORDER BY o.created_at DESC,o.id LIMIT 200`,
    [input.branchId, input.candidacyId]);
  // Per released summary: which source owner's distribution permission is current, missing or withdrawn.
  const released = await database().query<{id: string}>(
    "SELECT id FROM derivative_artifacts WHERE branch_id=$1 AND status='released' ORDER BY created_at DESC,id LIMIT 50", [input.branchId]);
  const summaryPermissions = [];
  for (const a of released.rows) {
    const owners = await distributePermissionStatus(database(), a.id);
    summaryPermissions.push({artifactId: a.id, distributePermissionsCurrent: missingDistributePermissionMessage(owners) === null,
      owners: owners.map(o => ({ownerName: o.ownerName, state: o.state}))});
  }
  return {distributions: rows.rows.map(labelled), summaryPermissions};
}

/** Public count derives only from provider-accepted or delivered evidence; queued or failed sends are never counted. */
export async function publicDistributionCount(branchId: string) {
  const r = await database().query<{n: number}>(
    "SELECT count(DISTINCT destination_id)::int AS n FROM outgoing_actions WHERE action_type='distribution' AND branch_id=$1 AND state IN ('accepted','delivered') AND accepted_at IS NOT NULL",
    [branchId]);
  return r.rows[0]?.n ?? 0;
}
