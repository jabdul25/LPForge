BEGIN;
CREATE TABLE IF NOT EXISTS features.feature_snapshots(id bigserial PRIMARY KEY,pool_address text NOT NULL REFERENCES protocol.pools(address),schema_version text NOT NULL,source_watermark jsonb NOT NULL,freshness text NOT NULL CHECK(freshness IN('GOOD','DEGRADED','BAD')),missing jsonb NOT NULL DEFAULT '[]'::jsonb,features jsonb NOT NULL,canonical_hash text NOT NULL,created_at timestamptz NOT NULL,UNIQUE(pool_address,schema_version,canonical_hash));
CREATE TABLE IF NOT EXISTS accounting.position_valuations(id bigserial PRIMARY KEY,position_address text NOT NULL,pool_address text NOT NULL,chain_slot bigint,observed_at timestamptz NOT NULL,valuation jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS position_valuations_pos_time_idx ON accounting.position_valuations(position_address,observed_at DESC);
COMMIT;
