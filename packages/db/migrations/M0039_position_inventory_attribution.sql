BEGIN;

-- Lots record the position-owned source of wallet inventory.  They never use
-- the owner's aggregate token balance, because that balance can include
-- manual inventory and inventory owned by other positions.
CREATE TABLE IF NOT EXISTS execution.position_inventory_lots(
  lot_id text PRIMARY KEY,
  position_address text NOT NULL,
  plan_id text NOT NULL REFERENCES execution.transaction_plans(plan_id),
  owner_address text NOT NULL,
  pool_address text NOT NULL,
  token_mint text NOT NULL,
  token_side text NOT NULL CHECK(token_side IN ('X','Y')),
  source_event text NOT NULL CHECK(source_event IN ('OPEN_RESIDUAL','FEE_CLAIM','REDUCE_WITHDRAWAL','CLOSE_WITHDRAWAL','RECOVERY_RESIDUAL','RESHAPE_SETTLEMENT')),
  source_cashflow_id text REFERENCES execution.position_cashflows(cashflow_id),
  raw_amount numeric(78,0) NOT NULL CHECK(raw_amount>0),
  remaining_raw_amount numeric(78,0) NOT NULL CHECK(remaining_raw_amount>=0 AND remaining_raw_amount<=raw_amount),
  decimals integer NOT NULL CHECK(decimals>=0 AND decimals<=255),
  acquired_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('OPEN','PARTIALLY_SETTLED','SETTLED','TRANSFERRED')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS position_inventory_lots_position_mint_status_idx
  ON execution.position_inventory_lots(position_address,token_mint,status,acquired_at);
CREATE INDEX IF NOT EXISTS position_inventory_lots_owner_mint_status_idx
  ON execution.position_inventory_lots(owner_address,token_mint,status,acquired_at);

-- The balance projection above is a convenience, not the only record of
-- ownership.  Every creation, settlement, or lifecycle transfer has its own
-- immutable event row and carries the plan/signature evidence that caused it.
CREATE TABLE IF NOT EXISTS execution.position_inventory_lot_events(
  event_id text PRIMARY KEY,
  lot_id text NOT NULL REFERENCES execution.position_inventory_lots(lot_id),
  plan_id text REFERENCES execution.transaction_plans(plan_id),
  event_type text NOT NULL CHECK(event_type IN ('CREATED','SETTLED','TRANSFERRED')),
  raw_amount numeric(78,0) NOT NULL CHECK(raw_amount>0),
  remaining_raw_amount numeric(78,0) NOT NULL CHECK(remaining_raw_amount>=0),
  observed_at timestamptz NOT NULL,
  transaction_signature text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS position_inventory_lot_events_lot_time_idx
  ON execution.position_inventory_lot_events(lot_id,observed_at,event_id);

COMMIT;
