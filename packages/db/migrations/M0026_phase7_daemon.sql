BEGIN;
CREATE TABLE IF NOT EXISTS operations.phase7_runtime_leases(
  runtime_id text PRIMARY KEY,
  holder_id text NOT NULL,
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  generation integer NOT NULL CHECK(generation>=1)
);
CREATE TABLE IF NOT EXISTS operations.phase7_runtime_cycles(
  cycle_key text PRIMARY KEY,
  runtime_id text NOT NULL,
  instance_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  plan text NOT NULL CHECK(plan IN ('RECOVER_ONLY','OBSERVE_ONLY','DECISION_CYCLE','HOLD')),
  economic_action_key text UNIQUE,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS phase7_runtime_cycles_observed_idx ON operations.phase7_runtime_cycles(observed_at DESC);
COMMIT;
