BEGIN;

CREATE TABLE IF NOT EXISTS execution.capital_reservations(
  plan_id text PRIMARY KEY REFERENCES execution.transaction_plans(plan_id),
  owner_address text NOT NULL,
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  token_mint text NOT NULL REFERENCES protocol.tokens(mint),
  capital_lamports bigint NOT NULL CHECK(capital_lamports > 0),
  state text NOT NULL CHECK(state IN ('RESERVED','SUBMITTED','DEPLOYED','RELEASED')),
  reserved_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS execution_capital_reservations_owner_state_idx
  ON execution.capital_reservations(owner_address,state,reserved_at DESC);
CREATE INDEX IF NOT EXISTS execution_capital_reservations_pool_state_idx
  ON execution.capital_reservations(pool_address,state);

COMMIT;
