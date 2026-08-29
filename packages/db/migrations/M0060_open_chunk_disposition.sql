BEGIN;

-- A PositionV2 account can exist after an extension or first add-liquidity
-- child.  It is therefore not evidence that every economic OPEN child landed.
-- Keep one authoritative, append-safe projection per planned child so recovery
-- can distinguish an unknown send from a proven no-effect expiration.
CREATE TABLE IF NOT EXISTS execution.open_chunk_dispositions(
  plan_id text NOT NULL REFERENCES execution.transaction_plans(plan_id),
  transaction_id text NOT NULL,
  sequence integer NOT NULL CHECK(sequence > 0),
  kind text NOT NULL,
  disposition text NOT NULL CHECK(disposition IN (
    'PENDING','SIGNING','SIGNED','SUBMITTED','CONFIRMED',
    'UNKNOWN_SUBMISSION','PROVEN_NOT_LANDED','FAILED_PRE_SIGN',
    'EXPIRED_PRE_SUBMISSION'
  )),
  signature text,
  last_valid_block_height bigint,
  observed_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(plan_id,transaction_id)
);
CREATE INDEX IF NOT EXISTS open_chunk_dispositions_plan_sequence_idx
  ON execution.open_chunk_dispositions(plan_id,sequence,transaction_id);

COMMIT;
