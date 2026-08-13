BEGIN;
CREATE TABLE IF NOT EXISTS operations.phase7_operator_actions(
  action_id text PRIMARY KEY,
  operator_id text NOT NULL,
  action text NOT NULL,
  requested_at timestamptz NOT NULL,
  approval_id text NOT NULL,
  reason text NOT NULL,
  target_type text,
  target_id text,
  before_hash text NOT NULL,
  after_hash text NOT NULL,
  result text NOT NULL CHECK(result IN ('APPLIED','WORKFLOW_REQUESTED')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phase7_operator_actions_requested_idx ON operations.phase7_operator_actions(requested_at DESC);
COMMIT;
