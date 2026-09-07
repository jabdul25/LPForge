BEGIN;

-- Telegram is a remote operator console, never a signing authority.  These
-- rows are the durable, replay-safe command audit and workflow hand-off.
CREATE TABLE IF NOT EXISTS operations.telegram_operator_commands(
  telegram_update_id bigint PRIMARY KEY,
  chat_id text NOT NULL,
  operator_id text,
  command text NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('ACCEPTED','REJECTED','COMPLETED','FAILED')),
  response text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations.telegram_operator_pool_blocks(
  pool_address text PRIMARY KEY,
  status text NOT NULL CHECK(status IN ('ACTIVE','REMOVED')),
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL,
  reason text NOT NULL,
  source_update_id bigint REFERENCES operations.telegram_operator_commands(telegram_update_id),
  removed_by text,
  removed_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_operator_pool_blocks_active_idx
  ON operations.telegram_operator_pool_blocks(status,requested_at DESC);

CREATE TABLE IF NOT EXISTS operations.telegram_operator_close_requests(
  request_id text PRIMARY KEY,
  position_address text NOT NULL,
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('PENDING','PLANNED','REJECTED','COMPLETED','CANCELLED')),
  reason text NOT NULL,
  source_update_id bigint REFERENCES operations.telegram_operator_commands(telegram_update_id),
  plan_id text,
  resolved_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS telegram_operator_close_requests_one_active_position
  ON operations.telegram_operator_close_requests(position_address)
  WHERE status IN ('PENDING','PLANNED');
CREATE INDEX IF NOT EXISTS telegram_operator_close_requests_pending_idx
  ON operations.telegram_operator_close_requests(status,requested_at ASC);

COMMIT;
