/**
 * Public restriction read SQL, shared by server code and DB integration tests so
 * the tests exercise the exact production statements. Public fields only: no
 * account ids and never the private basis.
 */
export const PUBLIC_RESTRICTION_HISTORY_SQL=`SELECT rc.id AS case_id,rc.target_kind,rc.target_id,rc.reason_category,rc.status,rc.opened_at,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('eventType',e.event_type,'publicNotice',e.public_notice,'independentReview',e.independent_review,'occurredAt',e.occurred_at) ORDER BY e.event_order),'[]'::jsonb)
  FROM restriction_events e WHERE e.case_id=rc.id) AS events
 FROM restriction_cases rc JOIN debates d ON d.id=rc.debate_id
 WHERE rc.debate_id=$1 AND d.status='published' ORDER BY rc.opened_at,rc.id`;

export const ACTIVE_PUBLIC_RESTRICTION_SQL="SELECT pde_public_restriction($1,$2::uuid) AS restriction";

/** Public submission rows for a debate: restricted text is withheld, the row stays. */
export const PUBLIC_DEBATE_SUBMISSIONS_SQL="SELECT s.id,s.debate_id,s.branch_id,s.candidacy_id,s.parent_submission_id,s.kind,s.created_at,s.published_at,s.format_issues,s.modality,CASE WHEN pde_active_restriction_case('submission',s.id) IS NULL THEN s.written_content END AS written_content,c.public_name AS candidate_name,m.id AS media_asset_id,m.duration_seconds,pde_public_restriction('submission',s.id) AS restriction FROM submissions s JOIN candidacies c ON c.id=s.candidacy_id LEFT JOIN media_assets m ON m.id=s.media_asset_id WHERE s.debate_id=$1 AND s.published_at IS NOT NULL ORDER BY s.published_at,s.id";
