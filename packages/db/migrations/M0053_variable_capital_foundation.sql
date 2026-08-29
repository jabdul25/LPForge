BEGIN;

-- VC-1: additive, research-only identity storage. Existing V2 outcomes and
-- M0049/M0050/M0052 identities remain untouched.
CREATE TABLE IF NOT EXISTS research.variable_capital_evaluations(
  capital_evaluation_id text PRIMARY KEY,
  recommendation_id text NOT NULL,
  decision_id text NOT NULL,
  candidate_id text NOT NULL,
  namespace text NOT NULL CHECK(namespace IN ('OBSERVED_CANONICAL','COUNTERFACTUAL_CANONICAL')),
  evaluation_schema_version text NOT NULL,
  proposed_capital_lamports numeric(30,0) NOT NULL CHECK(proposed_capital_lamports>0),
  allocated_capital_lamports numeric(30,0),
  candidate_capital_fraction_scaled numeric(30,0) NOT NULL,
  capital_contract_hash text NOT NULL,
  position_contract_hash text,
  capital_feasibility_status text NOT NULL CHECK(capital_feasibility_status IN ('FEASIBLE_PRICE_TAKING','FEASIBLE_NONLINEAR','CAPACITY_LIMITED','OWNERSHIP_LIMIT','LIQUIDITY_LIMIT','CAPITAL_UTILIZATION_FAILURE','GEOMETRY_INFEASIBLE','INVALID_CAPITAL','UNSUPPORTED_ORIENTATION','UNSUPPORTED','UNKNOWN')),
  maximum_feasible_capital_lamports numeric(30,0),
  binding_constraint text NOT NULL,
  source_sha text NOT NULL,
  build_id text NOT NULL,
  policy_hash text NOT NULL,
  migration_head text NOT NULL,
  evidence_manifest_hash text,
  provenance jsonb NOT NULL,
  raw_contract jsonb NOT NULL,
  content_hash text NOT NULL,
  authority text NOT NULL CHECK(authority='RESEARCH_ONLY_NO_POLICY_MUTATION'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(recommendation_id,candidate_id,namespace,capital_contract_hash,position_contract_hash,evaluation_schema_version),
  CHECK(capital_contract_hash ~ '^[0-9a-f]{64}$'),
  CHECK(position_contract_hash IS NULL OR position_contract_hash ~ '^[0-9a-f]{64}$'),
  CHECK(source_sha ~ '^[0-9a-f]{40}$'),
  CHECK(build_id ~ '^[0-9a-f]{64}$'),
  CHECK(policy_hash ~ '^[0-9a-f]{64}$'),
  CHECK(migration_head ~ '^M[0-9]{4}_.+[.]sql$'),
  CHECK(evidence_manifest_hash IS NULL OR evidence_manifest_hash ~ '^[0-9a-f]{64}$'),
  CHECK(content_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS variable_capital_evaluations_candidate_time_idx ON research.variable_capital_evaluations(candidate_id,created_at ASC);
CREATE INDEX IF NOT EXISTS variable_capital_evaluations_status_idx ON research.variable_capital_evaluations(capital_feasibility_status,created_at ASC);

CREATE OR REPLACE FUNCTION research.reject_variable_capital_evaluation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'variable capital research evidence is append-only';
END;
$$;
CREATE TRIGGER trg_variable_capital_evaluations_immutable
  BEFORE UPDATE OR DELETE ON research.variable_capital_evaluations
  FOR EACH ROW EXECUTE FUNCTION research.reject_variable_capital_evaluation_mutation();
REVOKE UPDATE, DELETE ON research.variable_capital_evaluations FROM PUBLIC;

COMMIT;
