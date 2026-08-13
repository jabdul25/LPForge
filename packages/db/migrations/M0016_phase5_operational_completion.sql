BEGIN;
CREATE SCHEMA IF NOT EXISTS operations;

CREATE TABLE IF NOT EXISTS operations.forward_cycles(
  cycle_id text PRIMARY KEY,
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  observed_at timestamptz NOT NULL,
  phase3_status text NOT NULL,
  phase4_status text NOT NULL,
  phase5_status text NOT NULL,
  recommendation_id text,
  thesis_id text,
  entry_decision text,
  plan_id text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forward_cycles_pool_time_idx ON operations.forward_cycles(pool_address,observed_at DESC);

CREATE TABLE IF NOT EXISTS operations.runtime_heartbeats(
  runtime_id text PRIMARY KEY,
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  observed_at timestamptz NOT NULL,
  status text NOT NULL,
  cycle_id text,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS operations.devnet_validation_runs(
  run_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  rpc_url text NOT NULL,
  stage text NOT NULL,
  status text NOT NULL,
  signature text,
  slot bigint,
  payload jsonb NOT NULL,
  PRIMARY KEY(run_id,stage)
);
CREATE INDEX IF NOT EXISTS devnet_validation_runs_time_idx ON operations.devnet_validation_runs(observed_at DESC);

COMMIT;
