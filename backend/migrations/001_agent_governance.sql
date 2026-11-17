-- Apply only to a dedicated non-production database after review.
-- Audit records are append-only; approval/hold/grant state is mutable only through
-- the trusted governance store. No agent-facing SQL access is permitted.

CREATE TABLE IF NOT EXISTS agent_service_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL CHECK (agent_id IN ('addy','iris','donny','axel','camden','boris')),
  credential_hash char(64) NOT NULL UNIQUE,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS agent_service_identities_active_idx
  ON agent_service_identities (agent_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_owner_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_subject text NOT NULL,
  action text NOT NULL,
  scope text NOT NULL,
  environment text NOT NULL,
  production_explicit boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS agent_owner_approvals_lookup_idx
  ON agent_owner_approvals (action, scope, environment, expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_iris_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iris_subject text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve','reapprove','hold','reject')),
  action text,
  scope text NOT NULL,
  reason text NOT NULL,
  evidence_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  consumed_at timestamptz,
  supersedes_id uuid REFERENCES agent_iris_decisions(id)
);
CREATE INDEX IF NOT EXISTS agent_iris_decisions_lookup_idx
  ON agent_iris_decisions (decision, action, scope, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_compliance_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iris_subject text NOT NULL,
  scope text NOT NULL,
  reason text NOT NULL,
  evidence_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  lifted_at timestamptz,
  lifted_by text,
  lift_decision_id uuid REFERENCES agent_iris_decisions(id)
);
CREATE INDEX IF NOT EXISTS agent_compliance_holds_active_idx
  ON agent_compliance_holds (scope) WHERE lifted_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_delegated_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grantor_subject text NOT NULL,
  grantee_agent text NOT NULL CHECK (grantee_agent IN ('addy','camden')),
  action text NOT NULL,
  scope text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS agent_delegated_grants_lookup_idx
  ON agent_delegated_grants (grantee_agent, action, scope, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_sandbox_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id text NOT NULL UNIQUE,
  environment text NOT NULL CHECK (environment = 'sandbox'),
  approved_by text NOT NULL,
  scope text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS agent_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  actor_agent text,
  actor_identity_id uuid REFERENCES agent_service_identities(id),
  action text,
  scope text,
  environment text,
  decision text NOT NULL,
  reason text NOT NULL,
  approval_id uuid REFERENCES agent_owner_approvals(id),
  iris_decision_id uuid REFERENCES agent_iris_decisions(id),
  grant_id uuid REFERENCES agent_delegated_grants(id),
  correlation_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_audit_events_correlation_idx
  ON agent_audit_events (correlation_id, created_at);
CREATE INDEX IF NOT EXISTS agent_audit_events_actor_idx
  ON agent_audit_events (actor_agent, created_at DESC);

CREATE OR REPLACE FUNCTION reject_agent_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'agent_audit_events is append-only';
END;
$$;
DROP TRIGGER IF EXISTS agent_audit_events_no_update ON agent_audit_events;
CREATE TRIGGER agent_audit_events_no_update
  BEFORE UPDATE OR DELETE ON agent_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_agent_audit_mutation();

-- The application DB role should receive INSERT/SELECT only on agent_audit_events.
-- Keep migration ownership and approval/grant administration in a separate operator role.
