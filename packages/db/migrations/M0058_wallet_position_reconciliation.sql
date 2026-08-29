BEGIN;

-- A wallet-wide reconciliation sweep is a recovery/audit surface, not an
-- ownership grant.  Unknown signer-owned positions are recorded separately
-- from execution.owned_positions until immutable LPForge plan/journal
-- evidence proves that LPForge opened them.
CREATE TABLE IF NOT EXISTS execution.wallet_position_discoveries(
  owner_address text NOT NULL,
  position_address text NOT NULL,
  pool_address text,
  classification text NOT NULL CHECK(classification IN (
    'KNOWN_LPFORGE_POSITION',
    'UNKNOWN_WALLET_POSITION',
    'PENDING_LPFORGE_OPEN',
    'PENDING_LPFORGE_CLOSE',
    'HISTORICAL_EXTERNAL_POSITION',
    'AMBIGUOUS_POSITION',
    'DB_ONLY'
  )),
  lpforge_position_id text REFERENCES execution.owned_positions(lpforge_position_id),
  execution_plan_id text REFERENCES execution.transaction_plans(plan_id),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  last_reconciled_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(owner_address,position_address)
);
CREATE INDEX IF NOT EXISTS execution_wallet_position_discoveries_owner_class_time_idx
  ON execution.wallet_position_discoveries(owner_address,classification,last_reconciled_at DESC);

-- These are nullable because older evidence is immutable and did not retain
-- a confirmed slot.  New confirmation/recovery writes fill them when chain
-- truth supplies the value.
ALTER TABLE execution.owned_positions
  ADD COLUMN IF NOT EXISTS entry_slot bigint,
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz;

COMMIT;
