BEGIN;

CREATE TABLE IF NOT EXISTS operations.phase7_live_portfolio_risk_state(
  owner_address text PRIMARY KEY,
  day_start timestamptz NOT NULL,
  daily_start_equity_lamports bigint NOT NULL CHECK(daily_start_equity_lamports >= 0),
  peak_equity_lamports bigint NOT NULL CHECK(peak_equity_lamports >= 0),
  current_equity_lamports bigint NOT NULL CHECK(current_equity_lamports >= 0),
  observed_at timestamptz NOT NULL,
  valuation_state text NOT NULL CHECK(valuation_state IN ('RECONCILED','UNAVAILABLE')),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMIT;
