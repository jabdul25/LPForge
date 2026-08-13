BEGIN;
CREATE TABLE IF NOT EXISTS operations.phase7_stage_evidence(
  evidence_id text PRIMARY KEY,
  stage text NOT NULL,
  status text NOT NULL CHECK(status IN ('PASS','HOLD','BLOCK')),
  observed_at timestamptz NOT NULL,
  evidence_hash text,
  payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS operations.phase7_evidence_packs(
  pack_hash text PRIMARY KEY,
  pack_id text NOT NULL UNIQUE,
  source_commit text NOT NULL,
  policy_hash text NOT NULL,
  complete boolean NOT NULL,
  operational_pass boolean NOT NULL,
  created_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);
COMMIT;
