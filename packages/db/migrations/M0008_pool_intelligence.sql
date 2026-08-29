BEGIN;
CREATE TABLE IF NOT EXISTS research.pool_assessments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  policy_id text NOT NULL,
  feature_snapshot_id bigint,
  eligibility text NOT NULL CHECK(eligibility IN ('ELIGIBLE','WATCH','BLOCK')),
  pool_quality_score integer NOT NULL CHECK(pool_quality_score BETWEEN 0 AND 100),
  economic_quality_score integer NOT NULL CHECK(economic_quality_score BETWEEN 0 AND 100),
  flow_quality_score integer NOT NULL CHECK(flow_quality_score BETWEEN 0 AND 100),
  liquidity_quality_score integer NOT NULL CHECK(liquidity_quality_score BETWEEN 0 AND 100),
  token_risk_score integer NOT NULL CHECK(token_risk_score BETWEEN 0 AND 100),
  toxicity_probability numeric NOT NULL CHECK(toxicity_probability BETWEEN 0 AND 1),
  archetype text NOT NULL,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  assessed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS pool_assessments_pool_time_idx ON research.pool_assessments(pool_address,assessed_at DESC);
CREATE TABLE IF NOT EXISTS research.experiments(
  id text PRIMARY KEY,
  hypothesis text NOT NULL,
  primary_metric text NOT NULL,
  secondary_metrics jsonb NOT NULL,
  control_policy_id text NOT NULL,
  treatment_policy_id text NOT NULL,
  specification jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS research.experiment_results(
  experiment_id text NOT NULL REFERENCES research.experiments(id),
  run_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(experiment_id,run_hash)
);
COMMIT;
