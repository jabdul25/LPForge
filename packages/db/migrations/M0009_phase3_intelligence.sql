BEGIN;
CREATE TABLE IF NOT EXISTS research.regime_assessments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pool_address text NOT NULL REFERENCES protocol.pools(address), decision_at timestamptz NOT NULL,
  primary_regime text NOT NULL, probabilities jsonb NOT NULL, confidence numeric NOT NULL CHECK(confidence BETWEEN 0 AND 1), stability numeric NOT NULL CHECK(stability BETWEEN 0 AND 1), transition_risk numeric NOT NULL CHECK(transition_risk BETWEEN 0 AND 1), evidence jsonb NOT NULL DEFAULT '{}'::jsonb, recommendation_id text
);
CREATE INDEX IF NOT EXISTS regime_assessments_pool_time_idx ON research.regime_assessments(pool_address,decision_at DESC);
CREATE TABLE IF NOT EXISTS research.shadow_recommendations(
  recommendation_id text PRIMARY KEY, pool_address text NOT NULL REFERENCES protocol.pools(address), decision_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  state text NOT NULL, no_trade boolean NOT NULL, market_context_hash text NOT NULL, candidate_count integer NOT NULL CHECK(candidate_count>=0), ranking jsonb NOT NULL, economics jsonb NOT NULL, reason_codes jsonb NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shadow_recommendations_pool_time_idx ON research.shadow_recommendations(pool_address,decision_at DESC);
CREATE TABLE IF NOT EXISTS research.lp_theses(
  thesis_id text PRIMARY KEY, recommendation_id text NOT NULL REFERENCES research.shadow_recommendations(recommendation_id), pool_address text NOT NULL REFERENCES protocol.pools(address), observed_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, selected_candidate_id text NOT NULL, thesis jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
