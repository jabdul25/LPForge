BEGIN;

-- One provider budget is shared by every LPForge process.  The counter is
-- deliberately stored in PostgreSQL rather than process memory: PM2 workers,
-- recovery and discovery must not each believe they own the provider limit.
CREATE TABLE IF NOT EXISTS execution.rpc_provider_budget_state(
  provider_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  p0_count integer NOT NULL DEFAULT 0 CHECK(p0_count>=0),
  p1_count integer NOT NULL DEFAULT 0 CHECK(p1_count>=0),
  p2_count integer NOT NULL DEFAULT 0 CHECK(p2_count>=0),
  p3_count integer NOT NULL DEFAULT 0 CHECK(p3_count>=0),
  p4_count integer NOT NULL DEFAULT 0 CHECK(p4_count>=0),
  pressure_until timestamptz,
  pressure_level integer NOT NULL DEFAULT 0 CHECK(pressure_level>=0),
  last_429_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS execution.rpc_provider_metrics(
  provider_key text NOT NULL,
  priority text NOT NULL CHECK(priority IN ('P0_EXECUTION_CRITICAL','P1_RECOVERY_CRITICAL','P2_POSITION_MANAGEMENT','P3_DISCOVERY','P4_BACKFILL')),
  method text NOT NULL,
  requests_total bigint NOT NULL DEFAULT 0 CHECK(requests_total>=0),
  granted_total bigint NOT NULL DEFAULT 0 CHECK(granted_total>=0),
  queued_total bigint NOT NULL DEFAULT 0 CHECK(queued_total>=0),
  dropped_total bigint NOT NULL DEFAULT 0 CHECK(dropped_total>=0),
  retry_total bigint NOT NULL DEFAULT 0 CHECK(retry_total>=0),
  http_429_total bigint NOT NULL DEFAULT 0 CHECK(http_429_total>=0),
  wait_ms_total bigint NOT NULL DEFAULT 0 CHECK(wait_ms_total>=0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(provider_key,priority,method)
);
CREATE INDEX IF NOT EXISTS rpc_provider_metrics_updated_idx ON execution.rpc_provider_metrics(provider_key,updated_at DESC);

CREATE OR REPLACE FUNCTION execution.rpc_metric_event(
  p_provider_key text,
  p_priority text,
  p_method text,
  p_event text,
  p_wait_ms integer DEFAULT 0
) RETURNS void AS $$
BEGIN
  INSERT INTO execution.rpc_provider_metrics(provider_key,priority,method,requests_total,granted_total,queued_total,dropped_total,retry_total,http_429_total,wait_ms_total,updated_at)
  VALUES(
    p_provider_key,p_priority,p_method,
    CASE WHEN p_event='REQUEST' THEN 1 ELSE 0 END,
    CASE WHEN p_event='GRANTED' THEN 1 ELSE 0 END,
    CASE WHEN p_event='QUEUED' THEN 1 ELSE 0 END,
    CASE WHEN p_event='DROPPED' THEN 1 ELSE 0 END,
    CASE WHEN p_event='RETRY' THEN 1 ELSE 0 END,
    CASE WHEN p_event='HTTP_429' THEN 1 ELSE 0 END,
    GREATEST(0,p_wait_ms),clock_timestamp()
  )
  ON CONFLICT(provider_key,priority,method) DO UPDATE SET
    requests_total=execution.rpc_provider_metrics.requests_total+EXCLUDED.requests_total,
    granted_total=execution.rpc_provider_metrics.granted_total+EXCLUDED.granted_total,
    queued_total=execution.rpc_provider_metrics.queued_total+EXCLUDED.queued_total,
    dropped_total=execution.rpc_provider_metrics.dropped_total+EXCLUDED.dropped_total,
    retry_total=execution.rpc_provider_metrics.retry_total+EXCLUDED.retry_total,
    http_429_total=execution.rpc_provider_metrics.http_429_total+EXCLUDED.http_429_total,
    wait_ms_total=execution.rpc_provider_metrics.wait_ms_total+EXCLUDED.wait_ms_total,
    updated_at=EXCLUDED.updated_at;
END;
$$ LANGUAGE plpgsql;

-- P0 always retains explicit capacity. P1, P2, P3 and P4 each receive a
-- progressively smaller lane so lower-priority work cannot fill the global
-- provider window while execution or recovery is idle.
CREATE OR REPLACE FUNCTION execution.acquire_rpc_permit(
  p_provider_key text,
  p_priority text,
  p_method text,
  p_total_rps integer,
  p_p0_reserve integer,
  p_p1_reserve integer,
  p_p2_limit integer,
  p_p3_limit integer,
  p_p4_limit integer
) RETURNS TABLE(granted boolean, wait_ms integer, pressure boolean) AS $$
DECLARE
  v execution.rpc_provider_budget_state%ROWTYPE;
  now_at timestamptz:=clock_timestamp();
  elapsed_ms integer;
  total_count integer;
  background_count integer;
  lane_count integer;
  lane_limit integer;
BEGIN
  IF p_priority NOT IN ('P0_EXECUTION_CRITICAL','P1_RECOVERY_CRITICAL','P2_POSITION_MANAGEMENT','P3_DISCOVERY','P4_BACKFILL') THEN
    RAISE EXCEPTION 'LPFORGE_RPC_PRIORITY_INVALID:%',p_priority;
  END IF;
  IF p_total_rps<1 OR p_p0_reserve<0 OR p_p1_reserve<0 OR p_p0_reserve+p_p1_reserve>=p_total_rps THEN
    RAISE EXCEPTION 'LPFORGE_RPC_BUDGET_INVALID';
  END IF;
  PERFORM execution.rpc_metric_event(p_provider_key,p_priority,p_method,'REQUEST',0);
  INSERT INTO execution.rpc_provider_budget_state(provider_key,window_started_at)
  VALUES(p_provider_key,now_at) ON CONFLICT(provider_key) DO NOTHING;
  SELECT * INTO v FROM execution.rpc_provider_budget_state AS state WHERE state.provider_key=p_provider_key FOR UPDATE;
  IF v.window_started_at<=now_at-interval '1 second' THEN
    v.window_started_at:=now_at;
    v.p0_count:=0; v.p1_count:=0; v.p2_count:=0; v.p3_count:=0; v.p4_count:=0;
  END IF;
  -- A provider-pressure event immediately sheds bulk/discovery work.  P0/P1
  -- retain their reserved lane so confirmation and recovery are never queued
  -- behind the very background traffic that caused the 429.
  IF v.pressure_until IS NOT NULL AND v.pressure_until>now_at
     AND p_priority IN ('P2_POSITION_MANAGEMENT','P3_DISCOVERY','P4_BACKFILL') THEN
    granted:=false;
    wait_ms:=GREATEST(1,CEIL(EXTRACT(EPOCH FROM(v.pressure_until-now_at))*1000)::integer);
    pressure:=true;
    UPDATE execution.rpc_provider_budget_state AS state SET window_started_at=v.window_started_at,p0_count=v.p0_count,p1_count=v.p1_count,p2_count=v.p2_count,p3_count=v.p3_count,p4_count=v.p4_count,updated_at=now_at WHERE state.provider_key=p_provider_key;
    PERFORM execution.rpc_metric_event(p_provider_key,p_priority,p_method,'QUEUED',wait_ms);
    RETURN NEXT; RETURN;
  END IF;
  total_count:=v.p0_count+v.p1_count+v.p2_count+v.p3_count+v.p4_count;
  background_count:=v.p2_count+v.p3_count+v.p4_count;
  lane_count:=CASE p_priority WHEN 'P0_EXECUTION_CRITICAL' THEN v.p0_count WHEN 'P1_RECOVERY_CRITICAL' THEN v.p1_count WHEN 'P2_POSITION_MANAGEMENT' THEN v.p2_count WHEN 'P3_DISCOVERY' THEN v.p3_count ELSE v.p4_count END;
  lane_limit:=CASE p_priority
    WHEN 'P0_EXECUTION_CRITICAL' THEN p_total_rps
    WHEN 'P1_RECOVERY_CRITICAL' THEN p_total_rps-p_p0_reserve
    WHEN 'P2_POSITION_MANAGEMENT' THEN LEAST(p_p2_limit,p_total_rps-p_p0_reserve-p_p1_reserve)
    WHEN 'P3_DISCOVERY' THEN LEAST(p_p3_limit,p_total_rps-p_p0_reserve-p_p1_reserve)
    ELSE LEAST(p_p4_limit,p_total_rps-p_p0_reserve-p_p1_reserve)
  END;
  IF total_count<p_total_rps AND lane_count<lane_limit
     AND (p_priority IN ('P0_EXECUTION_CRITICAL','P1_RECOVERY_CRITICAL') OR background_count<p_total_rps-p_p0_reserve-p_p1_reserve) THEN
    IF p_priority='P0_EXECUTION_CRITICAL' THEN v.p0_count:=v.p0_count+1;
    ELSIF p_priority='P1_RECOVERY_CRITICAL' THEN v.p1_count:=v.p1_count+1;
    ELSIF p_priority='P2_POSITION_MANAGEMENT' THEN v.p2_count:=v.p2_count+1;
    ELSIF p_priority='P3_DISCOVERY' THEN v.p3_count:=v.p3_count+1;
    ELSE v.p4_count:=v.p4_count+1;
    END IF;
    UPDATE execution.rpc_provider_budget_state AS state SET window_started_at=v.window_started_at,p0_count=v.p0_count,p1_count=v.p1_count,p2_count=v.p2_count,p3_count=v.p3_count,p4_count=v.p4_count,updated_at=now_at WHERE state.provider_key=p_provider_key;
    granted:=true; wait_ms:=0; pressure:=false;
    PERFORM execution.rpc_metric_event(p_provider_key,p_priority,p_method,'GRANTED',0);
    RETURN NEXT; RETURN;
  END IF;
  elapsed_ms:=GREATEST(0,FLOOR(EXTRACT(EPOCH FROM(now_at-v.window_started_at))*1000)::integer);
  granted:=false; wait_ms:=GREATEST(1,1000-elapsed_ms); pressure:=false;
  UPDATE execution.rpc_provider_budget_state AS state SET window_started_at=v.window_started_at,p0_count=v.p0_count,p1_count=v.p1_count,p2_count=v.p2_count,p3_count=v.p3_count,p4_count=v.p4_count,updated_at=now_at WHERE state.provider_key=p_provider_key;
  PERFORM execution.rpc_metric_event(p_provider_key,p_priority,p_method,'QUEUED',wait_ms);
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION execution.report_rpc_pressure(
  p_provider_key text,
  p_priority text,
  p_method text,
  p_backoff_ms integer
) RETURNS void AS $$
DECLARE now_at timestamptz:=clock_timestamp();
BEGIN
  INSERT INTO execution.rpc_provider_budget_state(provider_key,window_started_at,pressure_until,pressure_level,last_429_at)
  VALUES(p_provider_key,now_at,now_at+make_interval(secs=>GREATEST(1,p_backoff_ms)/1000.0),1,now_at)
  ON CONFLICT(provider_key) DO UPDATE SET
    pressure_until=GREATEST(COALESCE(execution.rpc_provider_budget_state.pressure_until,now_at),now_at+make_interval(secs=>GREATEST(1,p_backoff_ms)/1000.0)),
    pressure_level=LEAST(10,execution.rpc_provider_budget_state.pressure_level+1),
    last_429_at=now_at,
    updated_at=now_at;
  PERFORM execution.rpc_metric_event(p_provider_key,p_priority,p_method,'HTTP_429',0);
END;
$$ LANGUAGE plpgsql;

COMMIT;
