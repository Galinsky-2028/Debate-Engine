-- Plan 11.2 and 12: distributing a released summary needs a separate, current (unrevoked) 'distribute' grant from
-- the original owner of every source video in the summary, in addition to the clip-scoped 'edit' grants.
-- Grants stay immutable media_permissions rows; withdrawals use media_permission_revocations (migration 0027).

-- Defense in depth for the grant itself: scope.artifactId must name a summary whose manifest uses this media asset.
-- Optional clipStart/clipEnd make it clip-scoped; without them it covers the owner's media in that artifact.
CREATE OR REPLACE FUNCTION public.pde_guard_distribute_permission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.permission<>'distribute' THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.scope)<>'object' OR NOT (NEW.scope ? 'artifactId') OR NOT EXISTS(
   SELECT 1 FROM derivative_artifacts a
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.source_manifest->'clips')='array' THEN a.source_manifest->'clips' ELSE '[]'::jsonb END) clip
   WHERE a.id::text=NEW.scope->>'artifactId' AND clip->>'mediaAssetId'=NEW.media_asset_id::text) THEN
  RAISE EXCEPTION 'A distribution permission must name a summary that uses this original video.' USING ERRCODE='23514';
 END IF;
 IF (NEW.scope ? 'clipStart' OR NEW.scope ? 'clipEnd') AND NOT (
   jsonb_typeof(NEW.scope->'clipStart')='number' AND jsonb_typeof(NEW.scope->'clipEnd')='number'
   AND (NEW.scope->>'clipStart')::numeric>=0 AND (NEW.scope->>'clipEnd')::numeric>(NEW.scope->>'clipStart')::numeric) THEN
  RAISE EXCEPTION 'A clip-scoped distribution permission needs a valid time range.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS pde_distribute_permission_scope ON media_permissions;
CREATE TRIGGER pde_distribute_permission_scope BEFORE INSERT ON media_permissions
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_distribute_permission();

-- One row per distinct source video of the summary: its owner and whether that owner's distribute grant is
-- 'current', 'withdrawn' (every matching grant was revoked) or 'missing' (never granted).
CREATE OR REPLACE FUNCTION public.pde_artifact_distribute_grant_status(artifact uuid)
RETURNS TABLE(media_asset_id uuid, owner_candidacy_id uuid, state text)
LANGUAGE sql STABLE AS $$
 WITH clips AS (
  SELECT a.id AS artifact_id,clip FROM derivative_artifacts a
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.source_manifest->'clips')='array' THEN a.source_manifest->'clips' ELSE '[]'::jsonb END) clip
  WHERE a.id=artifact),
 grants AS (
  SELECT p.id,p.media_asset_id,p.scope,EXISTS(SELECT 1 FROM media_permission_revocations r WHERE r.permission_id=p.id) AS revoked
  FROM media_permissions p JOIN media_assets m ON m.id=p.media_asset_id AND m.owner_candidacy_id=p.candidate_id
  WHERE p.permission='distribute' AND p.scope->>'artifactId'=artifact::text)
 SELECT m.id,m.owner_candidacy_id,
  CASE WHEN EXISTS(SELECT 1 FROM grants g WHERE g.media_asset_id=m.id AND NOT g.revoked AND NOT EXISTS(
     SELECT 1 FROM clips c WHERE c.clip->>'mediaAssetId'=m.id::text AND g.scope ? 'clipStart'
      AND NOT ((g.scope->>'clipStart')::numeric<=(c.clip->>'startSeconds')::numeric AND (g.scope->>'clipEnd')::numeric>=(c.clip->>'endSeconds')::numeric)))
    THEN 'current'
   WHEN EXISTS(SELECT 1 FROM grants g WHERE g.media_asset_id=m.id) THEN 'withdrawn'
   ELSE 'missing' END
 FROM media_assets m WHERE m.id::text IN (SELECT c.clip->>'mediaAssetId' FROM clips c)
$$;

CREATE OR REPLACE FUNCTION public.pde_artifact_distribute_grants_current(artifact uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM public.pde_artifact_distribute_grant_status(artifact))
  AND NOT EXISTS(SELECT 1 FROM public.pde_artifact_distribute_grant_status(artifact) s WHERE s.state<>'current')
$$;

-- Defense in depth: no outbox action that distributes a summary can be created without current edit AND distribute
-- grants from every source owner. Policy press-kit links (subject_kind 'policy_version') carry no source media.
CREATE OR REPLACE FUNCTION public.pde_guard_summary_distribution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action_type='distribution' AND NEW.subject_kind='derivative_artifact' AND (
   NOT COALESCE(public.pde_artifact_edit_grants_current(NEW.subject_id),false)
   OR NOT COALESCE(public.pde_artifact_distribute_grants_current(NEW.subject_id),false)) THEN
  RAISE EXCEPTION 'Every source owner must currently grant distribution of this summary.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS pde_summary_distribution_grants ON outgoing_actions;
CREATE TRIGGER pde_summary_distribution_grants BEFORE INSERT ON outgoing_actions
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_summary_distribution();

CREATE INDEX IF NOT EXISTS media_permissions_distribute_artifact_idx ON media_permissions((scope->>'artifactId')) WHERE permission='distribute';
