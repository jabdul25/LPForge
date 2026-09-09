-- A terminal SOL settlement may be corrected by a later, receipt-backed settlement
-- version.  Keep every original learning outcome immutable, and make the current
-- calibration projection follow the newest canonical settlement through an
-- append-only supersession relation.
BEGIN;

ALTER TABLE research.live_learning_outcomes
  DROP CONSTRAINT IF EXISTS live_learning_outcomes_lifecycle_id_key;

DROP INDEX IF EXISTS research.live_learning_outcomes_kind_entry_plan_uq;

CREATE TABLE IF NOT EXISTS research.live_learning_outcome_supersessions(
  supersession_id text PRIMARY KEY,
  predecessor_outcome_id text NOT NULL REFERENCES research.live_learning_outcomes(outcome_id),
  successor_outcome_id text NOT NULL REFERENCES research.live_learning_outcomes(outcome_id),
  lifecycle_id text NOT NULL REFERENCES execution.position_lifecycles(lifecycle_id),
  reason_code text NOT NULL,
  observed_at timestamptz NOT NULL,
  evidence_hash text NOT NULL,
  CHECK(predecessor_outcome_id <> successor_outcome_id),
  UNIQUE(predecessor_outcome_id),
  UNIQUE(successor_outcome_id)
);

CREATE INDEX IF NOT EXISTS live_learning_outcome_supersessions_lifecycle_idx
  ON research.live_learning_outcome_supersessions(lifecycle_id, observed_at DESC);

COMMIT;
