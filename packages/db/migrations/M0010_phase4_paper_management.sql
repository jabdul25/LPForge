BEGIN;
CREATE TABLE IF NOT EXISTS research.entry_evaluations(
  entry_evaluation_id text PRIMARY KEY, thesis_id text NOT NULL, pool_address text NOT NULL REFERENCES protocol.pools(address), observed_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  decision text NOT NULL, readiness_score numeric NOT NULL CHECK(readiness_score BETWEEN 0 AND 1), confidence numeric NOT NULL CHECK(confidence BETWEEN 0 AND 1), reason_codes jsonb NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS research.risk_decisions(
  risk_decision_id text PRIMARY KEY, observed_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, scope text NOT NULL, decision text NOT NULL, reason_codes jsonb NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS accounting.paper_positions(
  paper_position_id text PRIMARY KEY, pool_address text NOT NULL REFERENCES protocol.pools(address), thesis_id text NOT NULL, candidate_id text NOT NULL, state text NOT NULL, capital numeric NOT NULL CHECK(capital>=0), lower_bin_id integer NOT NULL, upper_bin_id integer NOT NULL,
  opened_at timestamptz, closed_at timestamptz, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CHECK(lower_bin_id<=upper_bin_id)
);
CREATE TABLE IF NOT EXISTS accounting.paper_position_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), paper_position_id text NOT NULL REFERENCES accounting.paper_positions(paper_position_id), observed_at timestamptz NOT NULL, prior_state text, next_state text NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS paper_position_events_position_time_idx ON accounting.paper_position_events(paper_position_id,observed_at DESC);
CREATE TABLE IF NOT EXISTS research.management_decisions(
  management_decision_id text PRIMARY KEY, paper_position_id text NOT NULL REFERENCES accounting.paper_positions(paper_position_id), observed_at timestamptz NOT NULL, action text NOT NULL, forward_ev numeric NOT NULL, alternative_ev numeric, reason_codes jsonb NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS research.capital_allocations(
  allocation_id text PRIMARY KEY, observed_at timestamptz NOT NULL, pool_address text NOT NULL REFERENCES protocol.pools(address), requested numeric NOT NULL, allocated numeric NOT NULL CHECK(allocated>=0), payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS research.paper_portfolio_snapshots(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), portfolio_id text NOT NULL, observed_at timestamptz NOT NULL, total_value numeric NOT NULL, cash_value numeric NOT NULL, deployed_value numeric NOT NULL, open_positions integer NOT NULL CHECK(open_positions>=0), payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS paper_portfolio_snapshots_time_idx ON research.paper_portfolio_snapshots(portfolio_id,observed_at DESC);
COMMIT;
