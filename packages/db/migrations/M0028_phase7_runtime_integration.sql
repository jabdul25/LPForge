BEGIN;
CREATE TABLE IF NOT EXISTS operations.phase7_health_assessments(
  assessment_id text PRIMARY KEY,
  runtime_id text NOT NULL,
  cycle_key text NOT NULL,
  observed_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('HEALTHY','DEGRADED','CRITICAL')),
  new_entries_allowed boolean NOT NULL,
  management_writes_allowed boolean NOT NULL,
  reason_codes jsonb NOT NULL,
  domain_status jsonb NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS phase7_health_assessments_observed_idx ON operations.phase7_health_assessments(observed_at DESC);
CREATE INDEX IF NOT EXISTS phase7_health_assessments_cycle_idx ON operations.phase7_health_assessments(cycle_key);

CREATE TABLE IF NOT EXISTS operations.phase7_incident_states(
  incident_id text PRIMARY KEY,
  incident_type text NOT NULL,
  severity text NOT NULL CHECK(severity IN ('WARNING','CRITICAL')),
  status text NOT NULL CHECK(status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  opened_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  resolved_at timestamptz,
  pool_address text,
  token_mint text,
  reason_codes jsonb NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS phase7_incident_states_status_idx ON operations.phase7_incident_states(status,observed_at DESC);

CREATE TABLE IF NOT EXISTS operations.phase7_control_decisions(
  decision_id text PRIMARY KEY,
  runtime_id text NOT NULL,
  cycle_key text NOT NULL,
  observed_at timestamptz NOT NULL,
  authority_mode text NOT NULL CHECK(authority_mode IN ('OBSERVE_ONLY','LIMITED_LIVE','PRODUCTION')),
  health_status text NOT NULL CHECK(health_status IN ('HEALTHY','DEGRADED','CRITICAL')),
  drift_status text NOT NULL CHECK(drift_status IN ('STABLE','WATCH','BLOCK')),
  safety_mode text NOT NULL CHECK(safety_mode IN ('NORMAL','ENTRIES_PAUSED','EMERGENCY_ONLY')),
  daemon_plan text NOT NULL CHECK(daemon_plan IN ('RECOVER_ONLY','OBSERVE_ONLY','DECISION_CYCLE','HOLD')),
  new_economic_action_allowed boolean NOT NULL,
  reason_codes jsonb NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS phase7_control_decisions_observed_idx ON operations.phase7_control_decisions(observed_at DESC);

CREATE TABLE IF NOT EXISTS operations.phase7_evidence_snapshots(
  snapshot_id text PRIMARY KEY,
  runtime_id text NOT NULL,
  cycle_key text NOT NULL,
  observed_at timestamptz NOT NULL,
  implementation_status text NOT NULL CHECK(implementation_status IN ('PASS','FAIL','UNKNOWN')),
  operational_status text NOT NULL CHECK(operational_status IN ('PASS','HOLD','BLOCK','UNKNOWN')),
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS phase7_evidence_snapshots_observed_idx ON operations.phase7_evidence_snapshots(observed_at DESC);
COMMIT;
