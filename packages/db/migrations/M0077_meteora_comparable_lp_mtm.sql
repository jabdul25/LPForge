BEGIN;

-- Keep LP-local UI-comparable performance distinct from managed-economic NAV.
-- This one-row-per-position state is intentionally bounded; high-frequency
-- chain observations remain in position_observations.
ALTER TABLE execution.position_exit_state
  ADD COLUMN IF NOT EXISTS lp_mtm_evidence_state text,
  ADD COLUMN IF NOT EXISTS lp_mtm_entry_value_usd numeric,
  ADD COLUMN IF NOT EXISTS lp_mtm_current_value_usd numeric,
  ADD COLUMN IF NOT EXISTS lp_mtm_net_pnl_usd numeric,
  ADD COLUMN IF NOT EXISTS lp_mtm_net_return_fraction numeric,
  ADD COLUMN IF NOT EXISTS lp_mtm_reported_return_fraction numeric,
  ADD COLUMN IF NOT EXISTS lp_mtm_peak_return_fraction numeric,
  ADD COLUMN IF NOT EXISTS lp_mtm_peak_value_usd numeric,
  ADD COLUMN IF NOT EXISTS lp_mtm_peak_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lp_mtm_pending_return_fraction numeric,
  ADD COLUMN IF NOT EXISTS lp_mtm_pending_value_usd numeric,
  ADD COLUMN IF NOT EXISTS lp_mtm_pending_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lp_mtm_pending_confirmations integer NOT NULL DEFAULT 0
    CHECK (lp_mtm_pending_confirmations >= 0);

COMMIT;
