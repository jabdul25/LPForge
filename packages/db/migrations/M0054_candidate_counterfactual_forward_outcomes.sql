BEGIN;
CREATE TABLE IF NOT EXISTS research.candidate_counterfactual_forward_outcomes(
 capital_evaluation_id text NOT NULL REFERENCES research.variable_capital_evaluations(capital_evaluation_id),
 horizon_minutes integer NOT NULL CHECK(horizon_minutes IN (30,60,120)),
 outcome_model_version text NOT NULL,
 namespace text NOT NULL CHECK(namespace='COUNTERFACTUAL_CANONICAL'),
 state text NOT NULL CHECK(state IN ('PENDING','INSUFFICIENT_EVIDENCE','FINAL','FAILED_DATA_INTEGRITY')),
 evidence_hash text,result_hash text,reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,realized jsonb,payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),matured_at timestamptz,last_attempt_at timestamptz,retry_count integer NOT NULL DEFAULT 0,next_retry_at timestamptz,terminal_at timestamptz,
 PRIMARY KEY(capital_evaluation_id,horizon_minutes,outcome_model_version)
);
CREATE INDEX IF NOT EXISTS candidate_counterfactual_forward_outcomes_due_idx ON research.candidate_counterfactual_forward_outcomes(state,next_retry_at,created_at);
COMMIT;
