BEGIN;
CREATE TABLE IF NOT EXISTS operations.phase7_promotion_decisions(
  decision_id text PRIMARY KEY,
  policy_hash text NOT NULL,
  target text NOT NULL CHECK(target IN ('LIMITED_LIVE','PRODUCTION')),
  operational_status text NOT NULL CHECK(operational_status IN ('PASS','HOLD','BLOCK')),
  promotion text NOT NULL,
  observed_at timestamptz NOT NULL,
  reason_codes jsonb NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS phase7_promotion_decisions_policy_idx ON operations.phase7_promotion_decisions(policy_hash,observed_at DESC);
COMMIT;
