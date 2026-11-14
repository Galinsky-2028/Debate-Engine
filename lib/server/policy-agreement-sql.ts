/**
 * PDE-19 shared read SQL (plain strings, importable by DB integration tests).
 * Agreement status is derived from the append-only policy_endorsement_events
 * stream — never from the immutable first-acceptance table alone — so a
 * withdrawn agreement is reported as withdrawn while its history stays visible.
 *
 * One row per policy version that was, at some point, endorsed by BOTH branch
 * participants at the same time. $1 = branch id, or NULL for every published branch.
 */
export const JOINT_AGREEMENT_RECORDS_SQL=`SELECT p.id AS policy_version_id,p.branch_id,p.scope,p.content_sha256,p.policy_body,p.changes_summary,
 p.remaining_disagreements,p.addressed_question_ids,p.attachment_document_ids,p.created_at,p.parent_version_id,
 author.public_name AS author_name,d.id AS debate_id,d.title,origin.public_name AS originator,responder.public_name AS contender,
 d.originator_candidacy_id,b.responder_candidacy_id,
 joint.first_joint_at,joint.last_joint_at,
 (cur_o.action='accept' AND cur_r.action='accept') AS currently_joint,
 CASE WHEN cur_o.action='accept' AND cur_r.action='accept' THEN NULL ELSE gone.occurred_at END AS withdrawn_at,
 CASE WHEN cur_o.action='accept' AND cur_r.action='accept' THEN NULL ELSE withdrawer.public_name END AS withdrawn_by
FROM policy_versions p
JOIN debate_branches b ON b.id=p.branch_id
JOIN debates d ON d.id=b.debate_id AND d.status='published'
JOIN candidacies author ON author.id=p.proposed_by_candidacy_id
JOIN candidacies origin ON origin.id=d.originator_candidacy_id
JOIN candidacies responder ON responder.id=b.responder_candidacy_id
JOIN LATERAL (
 SELECT min(e.occurred_at) AS first_joint_at,max(e.occurred_at) AS last_joint_at,max(e.event_order) AS last_joint_order
 FROM policy_endorsement_events e WHERE e.policy_version_id=p.id
  AND (SELECT x.action FROM policy_endorsement_events x WHERE x.policy_version_id=p.id AND x.candidacy_id=d.originator_candidacy_id AND x.event_order<=e.event_order ORDER BY x.event_order DESC LIMIT 1)='accept'
  AND (SELECT x.action FROM policy_endorsement_events x WHERE x.policy_version_id=p.id AND x.candidacy_id=b.responder_candidacy_id AND x.event_order<=e.event_order ORDER BY x.event_order DESC LIMIT 1)='accept'
) joint ON joint.first_joint_at IS NOT NULL
LEFT JOIN LATERAL (SELECT e.action FROM policy_endorsement_events e WHERE e.policy_version_id=p.id AND e.candidacy_id=d.originator_candidacy_id ORDER BY e.event_order DESC LIMIT 1) cur_o ON true
LEFT JOIN LATERAL (SELECT e.action FROM policy_endorsement_events e WHERE e.policy_version_id=p.id AND e.candidacy_id=b.responder_candidacy_id ORDER BY e.event_order DESC LIMIT 1) cur_r ON true
LEFT JOIN LATERAL (SELECT e.occurred_at,e.candidacy_id FROM policy_endorsement_events e WHERE e.policy_version_id=p.id AND e.action='withdraw' AND e.event_order>joint.last_joint_order ORDER BY e.event_order LIMIT 1) gone ON true
LEFT JOIN candidacies withdrawer ON withdrawer.id=gone.candidacy_id
WHERE ($1::uuid IS NULL OR p.branch_id=$1::uuid)
ORDER BY (cur_o.action='accept' AND cur_r.action='accept') DESC,joint.last_joint_at DESC,p.id DESC
LIMIT 200`;

/** Public, chronological endorsement history for one version (no account ids). */
export const ENDORSEMENT_HISTORY_SQL=`SELECT e.policy_version_id,c.public_name AS candidate_name,e.action,e.occurred_at
FROM policy_endorsement_events e JOIN candidacies c ON c.id=e.candidacy_id WHERE e.policy_version_id=ANY($1::uuid[]) ORDER BY e.event_order`;

/** Every current, unrevoked grant check reuses the database function from migration 0027. */
export const ARTIFACT_GRANTS_CURRENT_SQL="SELECT COALESCE(public.pde_artifact_edit_grants_current($1::uuid),false) AS current";

/** Released artifacts whose optional edit permission was later withdrawn (public: owner name and date only). */
export const FUTURE_USE_WITHDRAWALS_SQL=`SELECT a.id AS artifact_id,owner.public_name AS owner_name,min(r.revoked_at) AS revoked_at
FROM derivative_artifacts a
JOIN media_permissions p ON p.scope->>'artifactId'=a.id::text AND p.permission='edit'
JOIN media_permission_revocations r ON r.permission_id=p.id
JOIN candidacies owner ON owner.id=p.candidate_id
WHERE a.branch_id=$1 AND a.status='released'
GROUP BY a.id,owner.public_name ORDER BY min(r.revoked_at)`;
