BEGIN;

-- Bounded lifecycle events only.  This is deliberately not an observation
-- stream: one deterministic event key per position/event type caps ordinary
-- storage at eleven rows for a lifecycle and keeps rapid runtime monitoring
-- out of PostgreSQL.
CREATE TABLE IF NOT EXISTS execution.position_health_events(
  event_key text PRIMARY KEY,
  position_address text NOT NULL REFERENCES execution.owned_positions(position_address),
  lpforge_position_id text NOT NULL,
  pool_address text NOT NULL,
  observed_at timestamptz NOT NULL,
  event_type text NOT NULL CHECK(event_type IN (
    'POSITION_ENTERED',
    'PEAK_MFE_REACHED',
    'LOWER_THIRD_ENTERED',
    'LOWER_EDGE_ENTERED',
    'BELOW_MIN_ENTERED',
    'RECLAIM_STARTED',
    'RECLAIM_CONFIRMED',
    'RECLAIM_FAILED',
    'HARD_STOP_TRIGGERED',
    'EMERGENCY_STOP_TRIGGERED',
    'SETTLED'
  )),
  live_pnl_fraction numeric,
  active_bin_id integer,
  range_state text NOT NULL CHECK(range_state IN (
    'IN_RANGE',
    'LOWER_THIRD',
    'LOWER_EDGE',
    'BELOW_MIN',
    'OOR_UPSIDE',
    'UNKNOWN'
  )),
  health_state text NOT NULL CHECK(health_state IN ('GREEN','YELLOW','ORANGE','RED')),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(jsonb_typeof(reason_codes)='array')
);

CREATE INDEX IF NOT EXISTS position_health_events_position_observed_idx
  ON execution.position_health_events(position_address,observed_at DESC);

CREATE INDEX IF NOT EXISTS position_health_events_type_observed_idx
  ON execution.position_health_events(event_type,observed_at DESC);

COMMIT;
