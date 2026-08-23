BEGIN;

-- A final forward outcome is immutable calibration evidence.  Bind it to the
-- complete calculated result, not only to the source-frame evidence hash.
ALTER TABLE research.phase3_forward_outcomes
  ADD COLUMN IF NOT EXISTS result_hash text;

CREATE INDEX IF NOT EXISTS phase3_forward_outcomes_model_idx ON research.phase3_forward_outcomes(outcome_model_version,horizon_minutes,state);

COMMIT;
