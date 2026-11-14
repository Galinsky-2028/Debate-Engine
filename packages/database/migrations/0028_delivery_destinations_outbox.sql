-- PDE-14 / PDE-23: candidate-owned verified delivery destinations and an honest, per-destination outbox.
-- No recipient lists: every destination is exactly one webhook URL or one mailbox owned by one candidacy.
CREATE TABLE IF NOT EXISTS delivery_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidacy_id uuid NOT NULL REFERENCES candidacies(id),
  created_by_account_id uuid NOT NULL REFERENCES accounts(id),
  kind text NOT NULL CHECK (kind IN ('webhook','email')),
  purposes text[] NOT NULL CHECK (cardinality(purposes) BETWEEN 1 AND 2 AND purposes <@ ARRAY['notifications','distribution']::text[]),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120 AND label !~ '[\r\n]'),
  address text NOT NULL CHECK (length(address) BETWEEN 3 AND 500 AND address !~ '[\s,;<>]'),
  -- Stored server-side to sign outgoing requests; returned exactly once at creation and never listed.
  signing_secret text,
  verification_token_sha256 char(64),
  verification_expires_at timestamptz,
  verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='webhook' AND address ~ '^https?://' AND signing_secret IS NOT NULL AND length(signing_secret) >= 43)
      OR (kind='email' AND address ~ '^[^@]+@[^@]+\.[^@]+$' AND signing_secret IS NULL)),
  CHECK (verified_at IS NULL OR verified_at >= created_at),
  CHECK (disabled_at IS NULL OR disabled_at >= created_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_destinations_active_unique
  ON delivery_destinations(candidacy_id, kind, lower(address)) WHERE disabled_at IS NULL;
CREATE INDEX IF NOT EXISTS delivery_destinations_candidacy_idx ON delivery_destinations(candidacy_id, created_at);

CREATE OR REPLACE FUNCTION public.pde_delivery_destination_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Delivery destinations are disabled, never deleted (delivery history references them).'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM candidacies c WHERE c.id=NEW.candidacy_id AND c.account_id=NEW.created_by_account_id AND c.verification_status='verified') THEN
      RAISE EXCEPTION 'Only the verified candidacy owner may add a delivery destination.';
    END IF;
    PERFORM 1 FROM candidacies WHERE id=NEW.candidacy_id FOR UPDATE;
    IF (SELECT count(*) FROM delivery_destinations d WHERE d.candidacy_id=NEW.candidacy_id AND d.disabled_at IS NULL) >= 10 THEN
      RAISE EXCEPTION 'A candidacy may have at most 10 active delivery destinations.';
    END IF;
    IF NEW.verified_at IS NOT NULL OR NEW.disabled_at IS NOT NULL THEN RAISE EXCEPTION 'A new destination starts unverified and active.'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.id<>OLD.id OR NEW.candidacy_id<>OLD.candidacy_id OR NEW.created_by_account_id<>OLD.created_by_account_id OR NEW.kind<>OLD.kind
     OR NEW.address<>OLD.address OR NEW.signing_secret IS DISTINCT FROM OLD.signing_secret OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Destination identity, address and secret are immutable; add a new destination instead.';
  END IF;
  IF OLD.disabled_at IS NOT NULL AND (NEW.disabled_at IS DISTINCT FROM OLD.disabled_at OR NEW.verified_at IS DISTINCT FROM OLD.verified_at) THEN
    RAISE EXCEPTION 'A disabled destination cannot be re-enabled or re-verified.';
  END IF;
  IF OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
    RAISE EXCEPTION 'Verification time is permanent.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pde_delivery_destination_guard ON delivery_destinations;
CREATE TRIGGER pde_delivery_destination_guard BEFORE INSERT OR UPDATE OR DELETE ON delivery_destinations
  FOR EACH ROW EXECUTE FUNCTION public.pde_delivery_destination_guard();

-- Additive outbox extension. Existing rows keep their states; 'failed' remains "attempt failed, retry scheduled".
ALTER TABLE outgoing_actions
  ADD COLUMN IF NOT EXISTS destination_id uuid REFERENCES delivery_destinations(id),
  ADD COLUMN IF NOT EXISTS owner_candidacy_id uuid REFERENCES candidacies(id),
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES debate_branches(id),
  ADD COLUMN IF NOT EXISTS debate_id uuid REFERENCES debates(id),
  ADD COLUMN IF NOT EXISTS subject_kind text,
  ADD COLUMN IF NOT EXISTS subject_id uuid,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS dead_at timestamptz;
ALTER TABLE outgoing_actions DROP CONSTRAINT IF EXISTS outgoing_actions_state_check;
ALTER TABLE outgoing_actions ADD CONSTRAINT outgoing_actions_state_check
  CHECK (state IN ('pending','sending','accepted','delivered','failed','dead'));
-- Keep any pre-existing rows valid under the evidence rules below.
UPDATE outgoing_actions SET accepted_at=COALESCE(last_attempt_at,created_at) WHERE state='accepted' AND accepted_at IS NULL;
UPDATE outgoing_actions SET lease_token=gen_random_uuid(),lease_expires_at=now() WHERE state='sending' AND lease_token IS NULL;
ALTER TABLE outgoing_actions ADD CONSTRAINT outgoing_actions_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 100);
ALTER TABLE outgoing_actions ADD CONSTRAINT outgoing_actions_evidence_check CHECK (
  (state <> 'delivered' OR delivered_at IS NOT NULL) AND
  (state NOT IN ('accepted','delivered') OR accepted_at IS NOT NULL) AND
  (delivered_at IS NULL OR state = 'delivered') AND
  (state <> 'sending' OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)));
ALTER TABLE outgoing_actions ADD CONSTRAINT outgoing_actions_destination_key_check
  CHECK (destination_id IS NULL OR destination = 'destination:' || destination_id::text);
CREATE INDEX IF NOT EXISTS outgoing_actions_ready_idx
  ON outgoing_actions(next_attempt_at, id) WHERE state IN ('pending','failed','sending');
CREATE INDEX IF NOT EXISTS outgoing_actions_destination_idx ON outgoing_actions(destination_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outgoing_actions_subject_idx ON outgoing_actions(subject_kind, subject_id);

-- Success is terminal: a send recorded as accepted/delivered can never be made sendable again.
CREATE OR REPLACE FUNCTION public.pde_outgoing_action_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Outbox history is retained.'; END IF;
  IF NEW.action_type<>OLD.action_type OR NEW.destination<>OLD.destination OR NEW.dedupe_key<>OLD.dedupe_key
     OR NEW.payload<>OLD.payload OR NEW.destination_id IS DISTINCT FROM OLD.destination_id OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Outbox action content is immutable.';
  END IF;
  IF OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN RAISE EXCEPTION 'Provider acceptance evidence is permanent.'; END IF;
  IF OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN RAISE EXCEPTION 'Delivery evidence is permanent.'; END IF;
  IF OLD.state = NEW.state AND OLD.state IN ('accepted','delivered','dead','failed') THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.state='pending' AND NEW.state IN ('pending','sending','dead')) OR
    (OLD.state='sending' AND NEW.state IN ('sending','pending','accepted','delivered','failed','dead')) OR
    (OLD.state='failed' AND NEW.state IN ('sending','dead')) OR
    (OLD.state='accepted' AND NEW.state IN ('accepted','delivered')) OR
    (OLD.state='dead' AND NEW.state IN ('dead','pending'))
  ) THEN
    RAISE EXCEPTION 'Illegal outbox transition % -> %', OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pde_outgoing_action_guard ON outgoing_actions;
CREATE TRIGGER pde_outgoing_action_guard BEFORE UPDATE OR DELETE ON outgoing_actions
  FOR EACH ROW EXECUTE FUNCTION public.pde_outgoing_action_guard();

-- A destination may only receive actions of its owner (verification challenges excepted, which target the destination itself).
CREATE OR REPLACE FUNCTION public.pde_outgoing_action_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d delivery_destinations%ROWTYPE;
BEGIN
  IF NEW.destination_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO d FROM delivery_destinations WHERE id=NEW.destination_id;
  IF NEW.owner_candidacy_id IS DISTINCT FROM d.candidacy_id THEN RAISE EXCEPTION 'Outbox action owner must own the destination.'; END IF;
  IF d.disabled_at IS NOT NULL THEN RAISE EXCEPTION 'Destination is disabled.'; END IF;
  IF NEW.action_type <> 'destination_verification' AND d.verified_at IS NULL THEN RAISE EXCEPTION 'Destination is not verified.'; END IF;
  IF NEW.action_type = 'distribution' AND NOT ('distribution' = ANY(d.purposes)) THEN RAISE EXCEPTION 'Destination is not authorized for distribution.'; END IF;
  IF NEW.action_type IN ('notification','invitation') AND NOT ('notifications' = ANY(d.purposes)) THEN RAISE EXCEPTION 'Destination is not authorized for notifications.'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pde_outgoing_action_owner_guard ON outgoing_actions;
CREATE TRIGGER pde_outgoing_action_owner_guard BEFORE INSERT ON outgoing_actions
  FOR EACH ROW EXECUTE FUNCTION public.pde_outgoing_action_owner_guard();
