BEGIN;

CREATE TABLE IF NOT EXISTS execution.plan_state_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id text NOT NULL REFERENCES execution.transaction_plans(plan_id),
  prior_state text,
  next_state text NOT NULL,
  observed_at timestamptz NOT NULL,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS execution_plan_state_events_plan_time_idx ON execution.plan_state_events(plan_id,observed_at);

CREATE TABLE IF NOT EXISTS execution.owned_positions(
  lpforge_position_id text PRIMARY KEY,
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  position_address text NOT NULL UNIQUE,
  owner_address text NOT NULL,
  strategy text NOT NULL,
  orientation text NOT NULL,
  lower_bin_id integer NOT NULL,
  upper_bin_id integer NOT NULL,
  active_bin_at_entry integer NOT NULL,
  initial_capital_lamports bigint NOT NULL CHECK(initial_capital_lamports>=0),
  entry_plan_id text REFERENCES execution.transaction_plans(plan_id),
  entry_signature text,
  entered_at timestamptz NOT NULL,
  lifecycle_state text NOT NULL CHECK(lifecycle_state IN ('OPEN','CLOSING','CLOSED','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN','ABORTED')),
  last_plan_id text REFERENCES execution.transaction_plans(plan_id),
  reconciliation_status text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS execution_owned_positions_open_pool_owner_idx
  ON execution.owned_positions(pool_address,owner_address)
  WHERE lifecycle_state IN ('OPEN','CLOSING','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN');

CREATE TABLE IF NOT EXISTS execution.position_observations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lpforge_position_id text NOT NULL REFERENCES execution.owned_positions(lpforge_position_id),
  observed_at timestamptz NOT NULL,
  active_bin_id integer,
  range_state text NOT NULL,
  token_x_amount text,
  token_y_amount text,
  unclaimed_fee_x text,
  unclaimed_fee_y text,
  wallet_truth jsonb NOT NULL,
  position_truth jsonb NOT NULL,
  management_context jsonb NOT NULL,
  reconciliation_debt boolean NOT NULL DEFAULT false,
  stale_data boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(lpforge_position_id,observed_at)
);
CREATE INDEX IF NOT EXISTS execution_position_observations_position_time_idx ON execution.position_observations(lpforge_position_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS execution.partial_entry_recovery(
  plan_id text PRIMARY KEY REFERENCES execution.transaction_plans(plan_id),
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  owner_address text NOT NULL,
  token_mint text NOT NULL,
  funding_transaction_id text NOT NULL REFERENCES execution.transaction_steps(transaction_id),
  funding_signature text NOT NULL,
  funded_at timestamptz NOT NULL,
  paired_token_amount text NOT NULL,
  intended_capital_lamports bigint NOT NULL CHECK(intended_capital_lamports>0),
  intended_range jsonb NOT NULL,
  state text NOT NULL CHECK(state IN ('ENTRY_FUNDED_NOT_OPEN','RESUME_OPEN','UNWIND_REQUIRED','UNWIND_SUBMITTED','RESOLVED','RECONCILIATION_REQUIRED')),
  wallet_truth jsonb NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS execution_transaction_plans_claim_idx ON execution.transaction_plans(cluster,state,expires_at,created_at);
CREATE INDEX IF NOT EXISTS execution_intents_action_position_idx ON execution.intents(action,pool_address,owner_address,position_address,expires_at);

COMMIT;
