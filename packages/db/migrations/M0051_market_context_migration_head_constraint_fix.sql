-- M0050 used a SQL regex escape sequence that PostgreSQL interpreted as a
-- literal backslash followed by a wildcard. Keep M0050 immutable and repair
-- the additive telemetry extension with a canonical migration-head pattern.
-- This changes no decision, outcome, or pre-existing evidence row.
BEGIN;

ALTER TABLE research.market_context_telemetry_snapshots
  DROP CONSTRAINT IF EXISTS market_context_telemetry_snapshot_decision_migration_head_check;

ALTER TABLE research.market_context_telemetry_snapshots
  ADD CONSTRAINT market_context_telemetry_snapshot_decision_migration_head_check
  CHECK(decision_migration_head ~ '^M[0-9]{4}_.+[.]sql$');

COMMIT;
