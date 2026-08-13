BEGIN;
CREATE TABLE IF NOT EXISTS market.data_api_pool_snapshots(id bigserial PRIMARY KEY,pool_address text NOT NULL,observed_at timestamptz NOT NULL,payload jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS data_api_pool_time_idx ON market.data_api_pool_snapshots(pool_address,observed_at DESC);
CREATE TABLE IF NOT EXISTS market.ohlcv(pool_address text NOT NULL,timeframe text NOT NULL,bucket_time timestamptz NOT NULL,open numeric NOT NULL,high numeric NOT NULL,low numeric NOT NULL,close numeric NOT NULL,volume numeric NOT NULL,origin text NOT NULL,observed_at timestamptz NOT NULL,PRIMARY KEY(pool_address,timeframe,bucket_time,origin));
CREATE TABLE IF NOT EXISTS market.external_prices(asset text NOT NULL,quote text NOT NULL,source text NOT NULL,price numeric NOT NULL,source_time timestamptz,observed_at timestamptz NOT NULL,confidence numeric,PRIMARY KEY(asset,quote,source,observed_at));
COMMIT;
