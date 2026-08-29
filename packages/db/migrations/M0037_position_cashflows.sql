BEGIN;

CREATE TABLE IF NOT EXISTS execution.position_cashflows(
  cashflow_id text PRIMARY KEY,
  position_address text NOT NULL,
  plan_id text NOT NULL REFERENCES execution.transaction_plans(plan_id),
  flow_type text NOT NULL CHECK(flow_type IN ('OPEN_CONTRIBUTION','ADD_CONTRIBUTION','FEE_CLAIM','REWARD_CLAIM','REDUCE_WITHDRAWAL','CLOSE_WITHDRAWAL','SWAP_COST','TX_COST','RENT_LOCK','RENT_RECOVERY')),
  observed_at timestamptz NOT NULL,
  lamports bigint,
  token_mint text,
  token_amount_raw text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS position_cashflows_position_observed_idx ON execution.position_cashflows(position_address,observed_at);

COMMIT;
