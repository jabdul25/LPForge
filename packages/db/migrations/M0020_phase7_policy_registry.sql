BEGIN;
CREATE TABLE IF NOT EXISTS operations.phase7_policy_versions(
  policy_hash text PRIMARY KEY,
  policy_id text NOT NULL,
  version text NOT NULL,
  parent_policy_hash text,
  code_commit text NOT NULL,
  feature_schema_hash text NOT NULL,
  config_hash text NOT NULL,
  status text NOT NULL CHECK(status IN ('CANDIDATE','FROZEN_LIMITED_LIVE','PRODUCTION','RETIRED')),
  created_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  UNIQUE(policy_id,version)
);
CREATE TABLE IF NOT EXISTS operations.phase7_promotion_bundles(
  bundle_hash text PRIMARY KEY,
  policy_hash text NOT NULL REFERENCES operations.phase7_policy_versions(policy_hash),
  target text NOT NULL CHECK(target IN ('LIMITED_LIVE','PRODUCTION')),
  complete boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS phase7_promotion_policy_idx ON operations.phase7_promotion_bundles(policy_hash,created_at DESC);
COMMIT;
