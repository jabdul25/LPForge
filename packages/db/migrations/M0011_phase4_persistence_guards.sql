BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS paper_position_events_cycle_uidx
  ON accounting.paper_position_events(paper_position_id,observed_at,event_type);
CREATE UNIQUE INDEX IF NOT EXISTS paper_portfolio_snapshots_observed_uidx
  ON research.paper_portfolio_snapshots(portfolio_id,observed_at);
COMMIT;
