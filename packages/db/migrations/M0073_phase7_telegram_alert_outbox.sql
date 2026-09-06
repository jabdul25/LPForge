BEGIN;

CREATE TABLE IF NOT EXISTS execution.phase7_telegram_alert_outbox(
  alert_id text PRIMARY KEY,
  fingerprint text NOT NULL UNIQUE,
  code text NOT NULL,
  severity text NOT NULL CHECK(severity IN ('INFO','WARNING','CRITICAL')),
  entity_type text NOT NULL CHECK(entity_type IN ('POSITION','PLAN','POOL','RUNTIME')),
  entity_id text NOT NULL,
  transition_key text,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK(status IN ('PENDING','DISPATCHING','SENT','RETRY_PENDING','FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phase7_telegram_alert_outbox_dispatch_idx
  ON execution.phase7_telegram_alert_outbox(status,next_attempt_at,observed_at);

COMMIT;
