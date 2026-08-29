BEGIN;
CREATE TABLE IF NOT EXISTS operations.phase7_scale_decisions(
  decision_id text PRIMARY KEY,
  policy_hash text,
  observed_at timestamptz NOT NULL,
  decision text NOT NULL CHECK(decision IN ('APPROVE_STEP','HOLD','BLOCK')),
  current_exposure_lamports numeric NOT NULL CHECK(current_exposure_lamports>=0),
  approved_increase_lamports numeric NOT NULL CHECK(approved_increase_lamports>=0),
  approved_target_exposure_lamports numeric NOT NULL CHECK(approved_target_exposure_lamports>=0),
  approval_id text,
  reason_codes jsonb NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS phase7_scale_decisions_observed_idx ON operations.phase7_scale_decisions(observed_at DESC);
COMMIT;
