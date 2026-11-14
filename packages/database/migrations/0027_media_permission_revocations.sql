-- PDE-20: future-use control of OPTIONAL media permissions (plan 11.2).
-- media_permissions rows stay immutable grants; a revocation is a separate,
-- append-only fact. Publication obligations ('archive','sequence') are not revocable.
CREATE TABLE media_permission_revocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 permission_id uuid NOT NULL UNIQUE REFERENCES media_permissions(id),
 candidate_id uuid NOT NULL REFERENCES candidacies(id),
 reason text CHECK (reason IS NULL OR length(reason)<=1000),
 revoked_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.pde_guard_media_permission_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(
   SELECT 1 FROM media_permissions p JOIN media_assets m ON m.id=p.media_asset_id
   WHERE p.id=NEW.permission_id AND p.candidate_id=NEW.candidate_id AND m.owner_candidacy_id=NEW.candidate_id) THEN
  RAISE EXCEPTION 'Only the original owner who granted a permission may revoke it.' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM media_permissions p WHERE p.id=NEW.permission_id AND p.permission IN ('edit','distribute')) THEN
  RAISE EXCEPTION 'Archive and sequence permissions given at publication are not revocable.' USING ERRCODE='23514';
 END IF;
 NEW.revoked_at:=now(); -- never backdated
 RETURN NEW;
END; $$;
CREATE TRIGGER pde_media_permission_revocation_owner BEFORE INSERT ON media_permission_revocations
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_media_permission_revocation();
CREATE TRIGGER pde_media_permission_revocations_immutable BEFORE UPDATE OR DELETE ON media_permission_revocations
 FOR EACH ROW EXECUTE FUNCTION public.pde_block_any_mutation();

-- True when every clip of the artifact's manifest is covered by a current
-- (unrevoked) clip-scoped edit grant from the source's original owner.
CREATE OR REPLACE FUNCTION public.pde_artifact_edit_grants_current(artifact uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT jsonb_typeof(a.source_manifest->'clips')='array'
   AND jsonb_array_length(a.source_manifest->'clips')>0
   AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(a.source_manifest->'clips') clip
    WHERE NOT EXISTS(
     SELECT 1 FROM media_permissions p JOIN media_assets m ON m.id=p.media_asset_id
     WHERE p.media_asset_id::text=clip->>'mediaAssetId' AND m.owner_candidacy_id=p.candidate_id
       AND p.permission='edit' AND p.scope->>'artifactId'=a.id::text
       AND (p.scope->>'clipStart')::numeric<=(clip->>'startSeconds')::numeric
       AND (p.scope->>'clipEnd')::numeric>=(clip->>'endSeconds')::numeric
       AND NOT EXISTS(SELECT 1 FROM media_permission_revocations r WHERE r.permission_id=p.id)))
 FROM derivative_artifacts a WHERE a.id=artifact
$$;
-- Defense in depth: no NEW render result, approval or release on a revoked grant.
-- An artifact that is already released keeps its status (no transition happens).
CREATE OR REPLACE FUNCTION public.pde_guard_artifact_grants() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='derivative_approvals' THEN
  IF NOT COALESCE(public.pde_artifact_edit_grants_current(NEW.artifact_id),false) THEN
   RAISE EXCEPTION 'An original owner has not granted, or has withdrawn, editing permission for this summary.' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('awaiting_approval','approved','released')
   AND NOT COALESCE(public.pde_artifact_edit_grants_current(NEW.id),false) THEN
  RAISE EXCEPTION 'An original owner has not granted, or has withdrawn, editing permission for this summary.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER pde_derivative_artifact_grants BEFORE UPDATE ON derivative_artifacts
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_artifact_grants();
CREATE TRIGGER pde_derivative_approval_grants BEFORE INSERT ON derivative_approvals
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_artifact_grants();
CREATE INDEX media_permissions_artifact_idx ON media_permissions((scope->>'artifactId')) WHERE permission='edit';
