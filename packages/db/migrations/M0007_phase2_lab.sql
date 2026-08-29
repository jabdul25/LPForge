BEGIN;
ALTER TABLE protocol.bin_snapshots ADD COLUMN IF NOT EXISTS fee_amount_x_per_token_stored numeric(78,0);
ALTER TABLE protocol.bin_snapshots ADD COLUMN IF NOT EXISTS fee_amount_y_per_token_stored numeric(78,0);
ALTER TABLE protocol.swap_events ADD COLUMN IF NOT EXISTS amount_left numeric(78,0);
ALTER TABLE protocol.swap_events ADD COLUMN IF NOT EXISTS fee_bps numeric(78,0);
ALTER TABLE protocol.swap_events ADD COLUMN IF NOT EXISTS fees_on_input boolean;
ALTER TABLE protocol.swap_events ADD COLUMN IF NOT EXISTS fees_on_token_x boolean;
CREATE TABLE IF NOT EXISTS research.simulation_runs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  simulator_version text NOT NULL,
  fidelity text NOT NULL,
  policy_id text,
  opened_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  lower_bin_id integer NOT NULL,
  upper_bin_id integer NOT NULL,
  input_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(lower_bin_id<=upper_bin_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS simulation_runs_input_hash_idx ON research.simulation_runs(input_hash,simulator_version);
CREATE TABLE IF NOT EXISTS research.forensic_episodes(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  episode_type text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  data_quality text NOT NULL,
  source_watermark jsonb NOT NULL DEFAULT '{}'::jsonb,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS research.counterfactual_results(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES research.forensic_episodes(id) ON DELETE CASCADE,
  label text NOT NULL,
  simulator_version text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(episode_id,label,simulator_version)
);
COMMIT;
