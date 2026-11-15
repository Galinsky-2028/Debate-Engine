-- Account suspension and reinstatement by platform administrators.
-- Suspension stops an account from acting; it never removes, hides or rewrites a published
-- contribution or its attribution. Every step is an append-only, attributed event with a
-- public notice; the private basis is visible to administrators only.

CREATE TABLE IF NOT EXISTS account_suspension_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES accounts(id),
 event_type text NOT NULL CHECK (event_type IN ('suspended','reinstated')),
 reason_category text NOT NULL CHECK (reason_category IN ('malware_or_security','unlawful_content','private_information','legal_order','impersonation')),
 public_notice text NOT NULL CHECK (length(btrim(public_notice)) BETWEEN 20 AND 1000),
 private_basis text CHECK (private_basis IS NULL OR length(private_basis) <= 4000),
 actor_account_id uuid NOT NULL REFERENCES accounts(id),
 independent_review boolean NOT NULL DEFAULT false,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 CHECK (actor_account_id <> account_id)
);
CREATE INDEX IF NOT EXISTS account_suspension_events_account ON account_suspension_events(account_id, occurred_at);

CREATE TRIGGER pde_account_suspension_events_immutable BEFORE UPDATE OR DELETE ON account_suspension_events
 FOR EACH ROW EXECUTE FUNCTION public.pde_block_any_mutation();

-- The event must match the account's status change, so status and history cannot diverge.
CREATE OR REPLACE FUNCTION public.pde_guard_account_suspension_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status text;
BEGIN
 SELECT status INTO current_status FROM accounts WHERE id=NEW.account_id;
 IF NEW.event_type='suspended' AND current_status IS DISTINCT FROM 'suspended' THEN
  RAISE EXCEPTION 'Record a suspension only for a suspended account.' USING ERRCODE='23514';
 END IF;
 IF NEW.event_type='reinstated' AND current_status IS DISTINCT FROM 'active' THEN
  RAISE EXCEPTION 'Record a reinstatement only for a reinstated account.' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.actor_account_id AND status='active') THEN
  RAISE EXCEPTION 'Only an active administrator account may suspend or reinstate.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pde_account_suspension_event_guard BEFORE INSERT ON account_suspension_events
 FOR EACH ROW EXECUTE FUNCTION public.pde_guard_account_suspension_event();
