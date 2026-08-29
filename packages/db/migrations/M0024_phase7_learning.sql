BEGIN;
CREATE TABLE IF NOT EXISTS research.phase7_learning_proposals(
  proposal_id text PRIMARY KEY,
  source_policy_hash text NOT NULL,
  scope text NOT NULL,
  trigger text NOT NULL,
  hypothesis text NOT NULL,
  status text NOT NULL CHECK(status='RESEARCH_PROPOSAL'),
  created_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS research.phase7_learning_decisions(
  proposal_id text NOT NULL REFERENCES research.phase7_learning_proposals(proposal_id),
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  decision text NOT NULL CHECK(decision IN ('EXPERIMENT_ELIGIBLE','HOLD','BLOCK')),
  reason_codes jsonb NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(proposal_id,evaluated_at)
);
COMMIT;
