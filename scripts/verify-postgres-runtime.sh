#!/usr/bin/env bash
set -euo pipefail

PG_BIN_DIR="${PG_BIN_DIR:-}"
if [[ -n "$PG_BIN_DIR" ]]; then
  PSQL="$PG_BIN_DIR/psql"; CREATEDB="$PG_BIN_DIR/createdb"; DROPDB="$PG_BIN_DIR/dropdb"
else
  PSQL="${PSQL_BIN:-psql}"; CREATEDB="${CREATEDB_BIN:-createdb}"; DROPDB="${DROPDB_BIN:-dropdb}"
fi
for b in "$PSQL" "$CREATEDB" "$DROPDB"; do [[ -x "$b" ]] || command -v "$b" >/dev/null || { echo "Missing PostgreSQL binary: $b" >&2; exit 2; }; done

DB="lpforge_runtime_contract_${$}"
cleanup(){ "$DROPDB" --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
"$CREATEDB" "$DB"

migration_count=0
for f in packages/db/migrations/*.sql; do
  migration_count=$((migration_count+1))
  bn=$(basename "$f")
  echo "Applying $bn"
  "$PSQL" -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null
  sum=$(sha256sum "$f" | awk '{print $1}')
  "$PSQL" -v ON_ERROR_STOP=1 -d "$DB" -c "INSERT INTO governance.schema_migrations(version,checksum) VALUES ('$bn','$sum') ON CONFLICT(version) DO NOTHING" >/dev/null
done

"$PSQL" -v ON_ERROR_STOP=1 -d "$DB" <<'SQL' >/dev/null
INSERT INTO protocol.tokens(mint,decimals,symbol) VALUES ('X',9,'X'),('Y',6,'Y');
INSERT INTO protocol.pools(address,token_x_mint,token_y_mint,bin_step,function_type,collect_fee_mode) VALUES('POOL1','X','Y',10,'LiquidityMining','InputOnly');
INSERT INTO protocol.bin_snapshots(pool_address,bin_id,chain_slot,price,amount_x,amount_y,liquidity_supply,fee_amount_x_per_token_stored,fee_amount_y_per_token_stored,observed_at,source)
VALUES('POOL1',0,100,1,100,200,300,0,0,'2026-08-12T12:35:00Z','TEST') ON CONFLICT(pool_address,bin_id,observed_at) DO NOTHING;
INSERT INTO protocol.bin_snapshots(pool_address,bin_id,chain_slot,price,amount_x,amount_y,liquidity_supply,fee_amount_x_per_token_stored,fee_amount_y_per_token_stored,observed_at,source)
VALUES('POOL1',0,100,1,100,200,300,0,0,'2026-08-12T12:35:00Z','TEST') ON CONFLICT(pool_address,bin_id,observed_at) DO NOTHING;
INSERT INTO protocol.positions(address,pool_address,owner,lower_bin_id,upper_bin_id,last_seen_at) VALUES('POS1','POOL1','OWNER',-10,10,now());
INSERT INTO protocol.position_snapshots(position_address,pool_address,chain_slot,total_x,total_y,fee_x,fee_y,observed_at,source,raw) VALUES('POS1','POOL1',101,1000,2000,10,20,now(),'TEST','{}');
INSERT INTO protocol.swap_events(signature,event_index,pool_address,chain_slot,observed_at,start_bin_id,end_bin_id,swap_for_y,amount_in,amount_left,amount_out,fee_bps,mm_fee,protocol_fee,limit_order_fee,host_fee,fees_on_input,fees_on_token_x,payload)
VALUES('SIG1',0,'POOL1',102,now(),0,2,true,1000,0,990,30,8,1,0,0,true,true,'{}');
INSERT INTO features.feature_snapshots(pool_address,schema_version,source_watermark,freshness,missing,features,canonical_hash,created_at) VALUES('POOL1','v1','{}','GOOD','[]','{}','hash1',now());
INSERT INTO research.pool_assessments(pool_address,policy_id,eligibility,pool_quality_score,economic_quality_score,flow_quality_score,liquidity_quality_score,token_risk_score,toxicity_probability,archetype,assessed_at) VALUES('POOL1','policy','ELIGIBLE',80,75,70,85,10,.2,'MATURE_DEEP',now());
INSERT INTO research.shadow_recommendations(recommendation_id,pool_address,decision_at,expires_at,state,no_trade,market_context_hash,candidate_count,ranking,economics,reason_codes,payload) VALUES('REC1','POOL1',now(),now()+interval '5 min','ENTRY_READY',false,'ctx',3,'{}','{}','[]','{}');
INSERT INTO research.lp_theses(thesis_id,recommendation_id,pool_address,observed_at,expires_at,selected_candidate_id,thesis) VALUES('TH1','REC1','POOL1',now(),now()+interval '5 min','CAND1','{}');
INSERT INTO accounting.paper_positions(paper_position_id,pool_address,thesis_id,candidate_id,state,capital,lower_bin_id,upper_bin_id,opened_at,payload) VALUES('PAPER1','POOL1','TH1','CAND1','OPEN',1,-10,10,now(),'{}');
INSERT INTO research.management_decisions(management_decision_id,paper_position_id,observed_at,action,forward_ev,reason_codes,payload) VALUES('MGMT1','PAPER1',now(),'HOLD',.01,'[]','{}');
SQL

bin_count=$("$PSQL" -At -d "$DB" -c "SELECT count(*) FROM protocol.bin_snapshots WHERE pool_address='POOL1' AND bin_id=0")
[[ "$bin_count" == "1" ]] || { echo "Bin idempotency failed: count=$bin_count" >&2; exit 1; }

table_count=$("$PSQL" -At -d "$DB" -c "SELECT count(*) FROM pg_tables WHERE schemaname IN ('protocol','market','features','accounting','governance','research')")
[[ "$table_count" -ge 32 ]] || { echo "Expected >=32 LPForge tables, found $table_count" >&2; exit 1; }

set +e
"$PSQL" -v ON_ERROR_STOP=1 -d "$DB" -c "UPDATE governance.schema_migrations SET checksum='bad' WHERE version='M0010_phase4_paper_management.sql'" >/dev/null 2>&1; r1=$?
"$PSQL" -v ON_ERROR_STOP=1 -d "$DB" -c "INSERT INTO accounting.paper_positions(paper_position_id,pool_address,thesis_id,candidate_id,state,capital,lower_bin_id,upper_bin_id,payload) VALUES('BAD','POOL1','TH1','C','OPEN',1,10,-10,'{}')" >/dev/null 2>&1; r2=$?
"$PSQL" -v ON_ERROR_STOP=1 -d "$DB" -c "INSERT INTO research.pool_assessments(pool_address,policy_id,eligibility,pool_quality_score,economic_quality_score,flow_quality_score,liquidity_quality_score,token_risk_score,toxicity_probability,archetype,assessed_at) VALUES('POOL1','p','WATCH',50,50,50,50,50,1.5,'X',now())" >/dev/null 2>&1; r3=$?
set -e
[[ $r1 -ne 0 && $r2 -ne 0 && $r3 -ne 0 ]] || { echo "Expected database guard rejection failed r1=$r1 r2=$r2 r3=$r3" >&2; exit 1; }

echo "POSTGRES_RUNTIME_OK tables=$table_count migrations=$migration_count bin_idempotency=PASS guards=PASS"
