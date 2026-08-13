BEGIN;
CREATE TABLE IF NOT EXISTS operations.phase7_disaster_recovery_evidence(
  evidence_id text PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('PASS','HOLD','BLOCK')),
  rpo_ms bigint NOT NULL CHECK(rpo_ms>=0),
  rto_ms bigint NOT NULL CHECK(rto_ms>=0),
  reason_codes jsonb NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS phase7_dr_observed_idx ON operations.phase7_disaster_recovery_evidence(observed_at DESC);
COMMIT;
