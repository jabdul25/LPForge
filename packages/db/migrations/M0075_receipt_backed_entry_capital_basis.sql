BEGIN;

-- Entry capital has two deliberately separate scopes.  The LP-position basis
-- is the receipt-backed value actually placed in the PositionV2; the managed
-- contribution also includes attributable entry inventory retained outside the
-- PositionV2.  Costs and recoverable account rent are never part of either
-- capital denominator.  Rows are immutable/versioned so a later parser repair
-- adds evidence rather than rewriting a historical receipt classification.
CREATE TABLE IF NOT EXISTS execution.position_entry_basis_reconciliations(
  basis_id text PRIMARY KEY,
  position_address text NOT NULL REFERENCES execution.owned_positions(position_address),
  entry_plan_id text NOT NULL REFERENCES execution.transaction_plans(plan_id),
  classification_version integer NOT NULL CHECK(classification_version > 0),
  basis_state text NOT NULL CHECK(basis_state IN ('PROVEN','INCOMPLETE')),
  requested_liquidity_capital_lamports numeric(30,0) NOT NULL CHECK(requested_liquidity_capital_lamports >= 0),
  lp_position_principal_lamports numeric(30,0),
  managed_economic_contribution_lamports numeric(30,0),
  execution_cost_lamports numeric(30,0) NOT NULL DEFAULT 0 CHECK(execution_cost_lamports >= 0),
  recoverable_rent_debits_lamports numeric(30,0) NOT NULL DEFAULT 0 CHECK(recoverable_rent_debits_lamports >= 0),
  recoverable_rent_refunds_lamports numeric(30,0) NOT NULL DEFAULT 0 CHECK(recoverable_rent_refunds_lamports >= 0),
  unclassified_lamports numeric(30,0) NOT NULL DEFAULT 0 CHECK(unclassified_lamports >= 0),
  receipt_provenance jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(position_address,classification_version)
);

CREATE INDEX IF NOT EXISTS position_entry_basis_latest_idx
  ON execution.position_entry_basis_reconciliations(position_address,classification_version DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS position_entry_basis_plan_idx
  ON execution.position_entry_basis_reconciliations(entry_plan_id,classification_version DESC);

-- A correction is an append-only, receipt-proven delta to a legacy
-- OPEN_CONTRIBUTION.  Negative values are intentional and reduce an earlier
-- contaminated basis; historical rows are never rewritten.
ALTER TABLE execution.position_cashflows
  DROP CONSTRAINT IF EXISTS position_cashflows_flow_type_check;
ALTER TABLE execution.position_cashflows
  ADD CONSTRAINT position_cashflows_flow_type_check CHECK (flow_type IN (
    'OPEN_CONTRIBUTION','ENTRY_BASIS_CORRECTION','ADD_CONTRIBUTION',
    'FEE_CLAIM','REWARD_CLAIM','REDUCE_WITHDRAWAL','CLOSE_WITHDRAWAL',
    'SWAP_PROCEEDS','SWAP_COST','TX_COST','RENT_LOCK','RENT_RECOVERY'
  ));

COMMIT;
