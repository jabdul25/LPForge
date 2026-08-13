BEGIN;
CREATE TABLE IF NOT EXISTS operations.phase6_canary_sessions(
  session_id text PRIMARY KEY,
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  owner_address text NOT NULL,
  capital_lamports numeric NOT NULL CHECK(capital_lamports>=0),
  status text NOT NULL CHECK(status IN ('BUILD_ONLY','OPEN_SUBMITTED','OPEN_RECONCILED','MONITORING','CLOSE_SUBMITTED','CLOSED_RECONCILED','FAILED','HOLD')),
  opened_at timestamptz,
  closed_at timestamptz,
  open_signature text,
  close_signature text,
  open_reconciliation_status text,
  close_reconciliation_status text,
  execution_cost_lamports numeric NOT NULL DEFAULT 0 CHECK(execution_cost_lamports>=0),
  duplicate_submission_count integer NOT NULL DEFAULT 0 CHECK(duplicate_submission_count>=0),
  recovery_events integer NOT NULL DEFAULT 0 CHECK(recovery_events>=0),
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS phase6_canary_sessions_status_idx ON operations.phase6_canary_sessions(status,opened_at DESC);
CREATE TABLE IF NOT EXISTS operations.phase6_canary_observations(
  session_id text NOT NULL REFERENCES operations.phase6_canary_sessions(session_id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL,
  decision text NOT NULL,
  forward_ev double precision NOT NULL,
  in_range boolean NOT NULL,
  inventory_risk_fraction double precision NOT NULL CHECK(inventory_risk_fraction>=0 AND inventory_risk_fraction<=1),
  fees_accrued_value double precision NOT NULL,
  net_pnl_value double precision NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(session_id,observed_at)
);
CREATE TABLE IF NOT EXISTS operations.phase6_stage_evidence(
  evidence_id text PRIMARY KEY,
  stage text NOT NULL,
  status text NOT NULL CHECK(status IN ('PASS','HOLD','BLOCK')),
  observed_at timestamptz NOT NULL,
  evidence_hash text,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS phase6_stage_evidence_stage_idx ON operations.phase6_stage_evidence(stage,observed_at DESC);
COMMIT;
