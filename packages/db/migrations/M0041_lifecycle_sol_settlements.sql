BEGIN;

-- A PositionV2 address is not an economic terminal boundary by itself.  This
-- durable identity owns every plan/cashflow/inventory link for one lifecycle.
CREATE TABLE IF NOT EXISTS execution.position_lifecycles(
  lifecycle_id text PRIMARY KEY,
  position_address text NOT NULL UNIQUE,
  entry_plan_id text REFERENCES execution.transaction_plans(plan_id),
  owner_address text NOT NULL,
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  predecessor_lifecycle_id text REFERENCES execution.position_lifecycles(lifecycle_id),
  status text NOT NULL CHECK(status IN ('OPEN','CLOSED','SOL_SETTLED','RECONCILIATION_REQUIRED')),
  created_at timestamptz NOT NULL,
  settled_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS position_lifecycles_owner_pool_idx ON execution.position_lifecycles(owner_address,pool_address,created_at);

-- Existing production facts are backfilled without claiming that they are
-- settled.  New code attaches a plan at every entry/management boundary.
INSERT INTO execution.position_lifecycles(lifecycle_id,position_address,entry_plan_id,owner_address,pool_address,status,created_at,payload)
SELECT 'lifecycle:'||o.position_address,o.position_address,o.entry_plan_id,o.owner_address,o.pool_address,
       CASE WHEN o.lifecycle_state='CLOSED' THEN 'CLOSED' WHEN o.lifecycle_state='RECONCILIATION_REQUIRED' THEN 'RECONCILIATION_REQUIRED' ELSE 'OPEN' END,
       o.entered_at,jsonb_build_object('backfilled_from_owned_position',true)
FROM execution.owned_positions o
ON CONFLICT(position_address) DO NOTHING;

CREATE TABLE IF NOT EXISTS execution.lifecycle_plan_links(
  lifecycle_id text NOT NULL REFERENCES execution.position_lifecycles(lifecycle_id),
  plan_id text NOT NULL REFERENCES execution.transaction_plans(plan_id),
  role text NOT NULL CHECK(role IN ('ENTRY','MANAGEMENT','CLOSE','RECOVERY')),
  linked_at timestamptz NOT NULL,
  PRIMARY KEY(lifecycle_id,plan_id)
);

INSERT INTO execution.lifecycle_plan_links(lifecycle_id,plan_id,role,linked_at)
SELECT l.lifecycle_id,o.entry_plan_id,'ENTRY',o.entered_at
FROM execution.owned_positions o JOIN execution.position_lifecycles l ON l.position_address=o.position_address
WHERE o.entry_plan_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE execution.position_cashflows ADD COLUMN IF NOT EXISTS lifecycle_id text REFERENCES execution.position_lifecycles(lifecycle_id);
UPDATE execution.position_cashflows c SET lifecycle_id=l.lifecycle_id FROM execution.position_lifecycles l WHERE l.position_address=c.position_address AND c.lifecycle_id IS NULL;
CREATE INDEX IF NOT EXISTS position_cashflows_lifecycle_observed_idx ON execution.position_cashflows(lifecycle_id,observed_at,cashflow_id);

ALTER TABLE execution.position_inventory_lots ADD COLUMN IF NOT EXISTS lifecycle_id text REFERENCES execution.position_lifecycles(lifecycle_id);
UPDATE execution.position_inventory_lots i SET lifecycle_id=l.lifecycle_id FROM execution.position_lifecycles l WHERE l.position_address=i.position_address AND i.lifecycle_id IS NULL;
CREATE INDEX IF NOT EXISTS position_inventory_lots_lifecycle_idx ON execution.position_inventory_lots(lifecycle_id,status,acquired_at);

CREATE TABLE IF NOT EXISTS execution.lifecycle_sol_settlements(
  settlement_id text PRIMARY KEY,
  lifecycle_id text NOT NULL REFERENCES execution.position_lifecycles(lifecycle_id),
  settlement_version integer NOT NULL DEFAULT 1 CHECK(settlement_version>0),
  position_address text NOT NULL,
  owner_address text NOT NULL,
  pool_address text NOT NULL,
  entry_plan_id text,
  total_sol_in_lamports bigint NOT NULL,
  total_sol_out_lamports bigint NOT NULL,
  rent_locked_lamports bigint NOT NULL,
  rent_recovered_lamports bigint NOT NULL,
  net_rent_cost_lamports bigint NOT NULL,
  realized_sol_pnl_lamports bigint NOT NULL,
  cashflow_count integer NOT NULL,
  inventory_lot_count integer NOT NULL,
  child_transaction_count integer NOT NULL,
  position_checked_at timestamptz NOT NULL,
  position_checked_slot bigint,
  reconciliation_verified_at timestamptz NOT NULL,
  source_commit text,
  policy_hash text,
  migration_head text,
  build_id text,
  settlement_version_label text NOT NULL DEFAULT 'gross-sol-instruction-flows-v1',
  evidence_hash text NOT NULL,
  settled_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(lifecycle_id,settlement_version)
);

CREATE OR REPLACE FUNCTION execution.prevent_lifecycle_settlement_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LPFORGE_SETTLEMENT_IMMUTABLE';
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS lifecycle_sol_settlements_immutable ON execution.lifecycle_sol_settlements;
CREATE TRIGGER lifecycle_sol_settlements_immutable BEFORE UPDATE OR DELETE ON execution.lifecycle_sol_settlements FOR EACH ROW EXECUTE FUNCTION execution.prevent_lifecycle_settlement_mutation();

ALTER TABLE execution.owned_positions DROP CONSTRAINT IF EXISTS owned_positions_lifecycle_state_check;
ALTER TABLE execution.owned_positions ADD CONSTRAINT owned_positions_lifecycle_state_check CHECK(lifecycle_state IN ('OPEN','CLOSING','CLOSED','SOL_SETTLED','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN','ABORTED'));

COMMIT;
