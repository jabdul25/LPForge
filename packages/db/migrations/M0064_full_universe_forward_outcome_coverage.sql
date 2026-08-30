BEGIN;

-- M0062 keeps the frozen candidate universe.  This compact manifest records
-- whether every candidate, rather than only the historical decision-relevant
-- subset, has reached a terminal canonical outcome at each horizon.
CREATE TABLE IF NOT EXISTS research.candidate_universe_forward_outcome_coverage(
 recommendation_id text NOT NULL REFERENCES research.candidate_universe_rerank_retention(recommendation_id),
 horizon_minutes integer NOT NULL CHECK(horizon_minutes IN (30,60,120)),
 outcome_model_version text NOT NULL,
 expected_candidate_count integer NOT NULL CHECK(expected_candidate_count>=0),
 evaluated_candidate_count integer NOT NULL DEFAULT 0 CHECK(evaluated_candidate_count>=0),
 terminal_candidate_count integer NOT NULL DEFAULT 0 CHECK(terminal_candidate_count>=0),
 valid_candidate_count integer NOT NULL DEFAULT 0 CHECK(valid_candidate_count>=0),
 insufficient_candidate_count integer NOT NULL DEFAULT 0 CHECK(insufficient_candidate_count>=0),
 invalid_candidate_count integer NOT NULL DEFAULT 0 CHECK(invalid_candidate_count>=0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(recommendation_id,horizon_minutes,outcome_model_version),
 CHECK(evaluated_candidate_count<=expected_candidate_count),
 CHECK(terminal_candidate_count<=evaluated_candidate_count),
 CHECK(valid_candidate_count+insufficient_candidate_count+invalid_candidate_count=terminal_candidate_count)
);

CREATE INDEX IF NOT EXISTS candidate_universe_forward_outcome_coverage_ready_idx
 ON research.candidate_universe_forward_outcome_coverage(outcome_model_version,horizon_minutes,terminal_candidate_count,expected_candidate_count,recommendation_id);

COMMIT;
