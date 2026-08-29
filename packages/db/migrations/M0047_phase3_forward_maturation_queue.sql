BEGIN;

-- Forward outcomes are shadow-only, but their queue must distinguish newly
-- due work from retriable evidence gaps. A closed future window can receive
-- delayed historical ingestion, so retryable gaps are scheduled explicitly
-- and bounded rather than consuming every scheduler batch forever.
ALTER TABLE research.phase3_forward_outcomes
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
  ADD COLUMN IF NOT EXISTS terminal_at timestamptz;

-- Existing FINAL rows are already terminal calibration evidence. Existing
-- insufficient rows retain a NULL next_retry_at so they are eligible once
-- after newly due PENDING work, then receive bounded retry scheduling.
UPDATE research.phase3_forward_outcomes
  SET terminal_at=COALESCE(terminal_at,matured_at,created_at)
  WHERE state='FINAL' AND terminal_at IS NULL;

CREATE INDEX IF NOT EXISTS phase3_forward_outcomes_retry_queue_idx
  ON research.phase3_forward_outcomes(state,next_retry_at,horizon_minutes,created_at)
  WHERE terminal_at IS NULL;

COMMIT;
