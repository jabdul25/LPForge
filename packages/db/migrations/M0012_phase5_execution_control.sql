BEGIN;
CREATE SCHEMA IF NOT EXISTS execution;
CREATE TABLE IF NOT EXISTS execution.intents(
  intent_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  action text NOT NULL,
  pool_address text NOT NULL REFERENCES protocol.pools(address),
  owner_address text NOT NULL,
  position_address text,
  thesis_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  CHECK(expires_at > observed_at)
);
CREATE TABLE IF NOT EXISTS execution.transaction_plans(
  plan_id text PRIMARY KEY,
  intent_id text NOT NULL REFERENCES execution.intents(intent_id),
  cluster text NOT NULL CHECK(cluster IN ('devnet','mainnet-beta')),
  state text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  CHECK(expires_at > created_at)
);
CREATE TABLE IF NOT EXISTS execution.transaction_steps(
  transaction_id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES execution.transaction_plans(plan_id),
  sequence integer NOT NULL CHECK(sequence>0),
  kind text NOT NULL,
  state text NOT NULL,
  required_signers jsonb NOT NULL,
  metadata jsonb NOT NULL,
  UNIQUE(plan_id,sequence)
);
CREATE TABLE IF NOT EXISTS execution.simulations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id text NOT NULL REFERENCES execution.transaction_steps(transaction_id),
  simulated_at timestamptz NOT NULL,
  fresh_until timestamptz NOT NULL,
  ok boolean NOT NULL,
  units_consumed integer,
  logs jsonb NOT NULL,
  error text,
  payload jsonb NOT NULL,
  UNIQUE(transaction_id,simulated_at),
  CHECK(fresh_until > simulated_at),
  CHECK(units_consumed IS NULL OR units_consumed>=0)
);
CREATE TABLE IF NOT EXISTS execution.risk_permits(
  permit_id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES execution.transaction_plans(plan_id),
  decision text NOT NULL CHECK(decision IN ('APPROVE','BLOCK','EMERGENCY')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz,
  reason_codes jsonb NOT NULL,
  payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS execution.submission_attempts(
  attempt_id text PRIMARY KEY,
  transaction_id text NOT NULL REFERENCES execution.transaction_steps(transaction_id),
  idempotency_key text NOT NULL,
  attempt integer NOT NULL CHECK(attempt>0),
  state text NOT NULL CHECK(state IN ('PREPARED','SENT','UNKNOWN','EXPIRED','FAILED')),
  signed_payload_fingerprint text NOT NULL,
  blockhash text NOT NULL,
  last_valid_block_height bigint NOT NULL CHECK(last_valid_block_height>=0),
  signature text UNIQUE,
  prepared_at timestamptz NOT NULL,
  submitted_at timestamptz,
  payload jsonb NOT NULL,
  UNIQUE(transaction_id,attempt),
  UNIQUE(idempotency_key,attempt)
);
CREATE TABLE IF NOT EXISTS execution.confirmations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id text NOT NULL REFERENCES execution.submission_attempts(attempt_id),
  signature text,
  status text NOT NULL CHECK(status IN ('PROCESSED','CONFIRMED','FINALIZED','EXPIRED','FAILED','UNKNOWN')),
  observed_at timestamptz NOT NULL,
  slot bigint,
  error text,
  payload jsonb NOT NULL,
  UNIQUE(attempt_id,observed_at,status)
);
CREATE INDEX IF NOT EXISTS execution_submission_idempotency_idx ON execution.submission_attempts(idempotency_key,state);
CREATE INDEX IF NOT EXISTS execution_confirmation_signature_idx ON execution.confirmations(signature,observed_at DESC);
COMMIT;
