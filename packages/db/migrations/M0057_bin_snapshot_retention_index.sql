BEGIN;

-- The existing pool/time indexes remain required by live history reads.  This
-- narrow global timestamp index is only the access path for bounded retention
-- batches; it avoids a recurring table-wide scan of every pool's snapshots.
CREATE INDEX IF NOT EXISTS bin_snapshots_observed_at_idx
  ON protocol.bin_snapshots(observed_at ASC);

COMMIT;
