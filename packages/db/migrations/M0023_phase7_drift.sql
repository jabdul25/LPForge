BEGIN;
CREATE TABLE IF NOT EXISTS operations.phase7_drift_assessments(
  assessment_id text PRIMARY KEY,
  policy_hash text,
  observed_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('STABLE','WATCH','BLOCK')),
  sample_count integer NOT NULL CHECK(sample_count>=0),
  reason_codes jsonb NOT NULL,
  deltas jsonb NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS phase7_drift_assessments_observed_idx ON operations.phase7_drift_assessments(observed_at DESC);
COMMIT;
