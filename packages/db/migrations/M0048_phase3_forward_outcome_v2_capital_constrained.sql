BEGIN;

-- V2 is a distinct, capital-constrained research model.  V1 rows are never
-- modified; every historic frozen decision receives its own independent V2
-- pending row for bounded historical maturation.
INSERT INTO research.phase3_forward_outcomes(
  recommendation_id,
  horizon_minutes,
  outcome_model_version,
  state,
  payload
)
SELECT
  decision.recommendation_id,
  horizon.horizon_minutes,
  'phase3-forward-outcome-v2',
  'PENDING',
  jsonb_build_object(
    'participationModel', 'CAPITAL_CONSTRAINED_V2',
    'authority', 'RESEARCH_ONLY_NO_POLICY_MUTATION'
  )
FROM research.phase3_forward_decisions AS decision
CROSS JOIN (VALUES (30), (60), (120)) AS horizon(horizon_minutes)
ON CONFLICT(recommendation_id,horizon_minutes,outcome_model_version) DO NOTHING;

CREATE INDEX IF NOT EXISTS phase3_forward_outcomes_model_horizon_state_idx
  ON research.phase3_forward_outcomes(outcome_model_version,horizon_minutes,state,created_at);

COMMIT;
