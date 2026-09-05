BEGIN;

ALTER TABLE execution.production_global_pool_candidates
  ADD COLUMN IF NOT EXISTS selection_tier text,
  ADD COLUMN IF NOT EXISTS selection_state text,
  ADD COLUMN IF NOT EXISTS selection_dynamic_eligible boolean NOT NULL DEFAULT false;

COMMIT;
