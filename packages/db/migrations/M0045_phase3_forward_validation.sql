BEGIN;

CREATE TABLE IF NOT EXISTS research.phase3_forward_decisions(
  recommendation_id text PRIMARY KEY REFERENCES research.shadow_recommendations(recommendation_id),
  decision_id text NOT NULL UNIQUE,
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  decision_at timestamptz NOT NULL,
  source_sha text NOT NULL,
  build_id text NOT NULL,
  policy_hash text NOT NULL,
  migration_head text NOT NULL,
  capital_lamports numeric(30,0) NOT NULL,
  selected_candidate_kind text NOT NULL CHECK(selected_candidate_kind IN ('RANKING_WINNER','TOP_RANKED_COUNTERFACTUAL','NONE')),
  strategy text,
  orientation text,
  range_family text,
  active_bin_id_at_decision integer NOT NULL,
  lower_bin_id integer,
  upper_bin_id integer,
  included_bin_count integer,
  candidate_weights jsonb NOT NULL DEFAULT '[]'::jsonb,
  prediction jsonb NOT NULL,
  evidence_provenance jsonb NOT NULL,
  phase3_state text NOT NULL,
  phase3_outcome text NOT NULL CHECK(phase3_outcome IN ('NO_TRADE','WATCHING','ENTRY_READY')),
  reason_codes jsonb NOT NULL,
  would_aug_era_thesis_semantics_have_created_thesis boolean NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(source_sha ~ '^[0-9a-f]{40}$'),
  CHECK(build_id ~ '^[0-9a-f]{64}$'),
  CHECK(policy_hash ~ '^[0-9a-f]{64}$'),
  CHECK(migration_head ~ '^M[0-9]{4}_.+\.sql$')
);

CREATE INDEX IF NOT EXISTS phase3_forward_decisions_due_idx ON research.phase3_forward_decisions(decision_at ASC);
CREATE INDEX IF NOT EXISTS phase3_forward_decisions_pool_time_idx ON research.phase3_forward_decisions(pool_address,decision_at DESC);

CREATE OR REPLACE FUNCTION research.reject_phase3_forward_decision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'phase3_forward_decisions are immutable';
END;
$$;
DROP TRIGGER IF EXISTS trg_phase3_forward_decisions_immutable ON research.phase3_forward_decisions;
CREATE TRIGGER trg_phase3_forward_decisions_immutable BEFORE UPDATE OR DELETE ON research.phase3_forward_decisions FOR EACH ROW EXECUTE FUNCTION research.reject_phase3_forward_decision_mutation();

CREATE TABLE IF NOT EXISTS research.phase3_forward_outcomes(
  recommendation_id text NOT NULL REFERENCES research.phase3_forward_decisions(recommendation_id),
  horizon_minutes integer NOT NULL CHECK(horizon_minutes IN (30,60,120)),
  outcome_model_version text NOT NULL,
  state text NOT NULL CHECK(state IN ('PENDING','INSUFFICIENT_EVIDENCE','FINAL','FAILED_DATA_INTEGRITY')),
  evidence_hash text,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  realized jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  matured_at timestamptz,
  PRIMARY KEY(recommendation_id,horizon_minutes,outcome_model_version),
  CHECK((state='FINAL') = (realized IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS phase3_forward_outcomes_due_idx ON research.phase3_forward_outcomes(state,horizon_minutes,created_at ASC);

COMMIT;
