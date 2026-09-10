import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {formatTelegramPositionDetail,formatTelegramPositionSummaries,resolveTelegramPositionAddress,shortenTelegramPositionAddress} from '../.build/packages/telegram-operator-format/src/index.js';

const now=Date.parse('2026-09-07T05:00:00.000Z');
const position={
  position_address:'5odbT7abcdefghijkmnopqrstuvwxyz123456789jT2X',pool_address:'EAf6shtt8QGJ7UiSRrDc6pzwXKEmb5s7tCCpSDe5zpzZ',
  strategy:'BID_ASK',orientation:'ONE_SIDED_Y',lower_bin_id:-1381,upper_bin_id:-1347,observation_active_bin_id:-1352,
  initial_capital_lamports:'30000000',entered_at:'2026-09-07T01:36:00.000Z',lifecycle_state:'OPEN',reconciliation_status:'MATCH',
  observation_observed_at:'2026-09-07T04:59:42.000Z',chain_observed_at:'2026-09-07T04:59:42.000Z',observation_range_state:'IN_RANGE',observation_stale_data:false,
  valuation_observed_at:'2026-09-07T04:59:42.000Z',valuation_state:'AVAILABLE',current_economic_value_usd:'4.8142',net_pnl_usd:'0.2725',net_return_fraction:'0.0600',fee_value_lamports:'260000',
  lp_mtm_observed_at:'2026-09-07T04:59:42.000Z',lp_mtm_state:'AVAILABLE',lp_current_position_value_usd:'4.8142',lp_net_pnl_usd:'0.2725',lp_net_return_fraction:'0.0600',lp_peak_return_fraction:'0.0721'
};

test('telegram positions reports no live positions without external dependencies',()=>{
  assert.equal(formatTelegramPositionSummaries({positions:[]}), 'No live LPForge positions.');
});
test('telegram close resolution accepts the displayed ordinal, canonical address, or exact displayed alias',()=>{
  const second={...position,position_address:'7t477abcdefghijkmnopqrstuvwxyz123456789fHYs'};
  assert.equal(resolveTelegramPositionAddress({target:'1',positions:[position,second]}),position.position_address);
  assert.equal(resolveTelegramPositionAddress({target:'2',positions:[position,second]}),second.position_address);
  assert.throws(()=>resolveTelegramPositionAddress({target:'3',positions:[position,second]}),/LPFORGE_TELEGRAM_LIVE_POSITION_NOT_FOUND/);
  assert.equal(resolveTelegramPositionAddress({target:position.position_address,positions:[position]}),position.position_address);
  assert.equal(resolveTelegramPositionAddress({target:'5odbT7…jT2X',positions:[position]}),position.position_address);
  assert.throws(()=>resolveTelegramPositionAddress({target:'5odbT7',positions:[position]}),/LPFORGE_TELEGRAM_LIVE_POSITION_NOT_FOUND/);
  assert.throws(()=>resolveTelegramPositionAddress({target:'5odbT7…jT2X',positions:[position,{...position}]}),/LPFORGE_TELEGRAM_LIVE_POSITION_AMBIGUOUS/);
});
test('telegram positions renders the persisted Meteora-compatible control PnL without external calls',()=>{
  const rendered=formatTelegramPositionSummaries({positions:[position],maxOpenPositions:2,nowMs:now});
  assert.match(rendered,/📊 LPForge Positions — 1 open \/ 2 max/);assert.match(rendered,/5odbT7…jT2X/);assert.match(rendered,/EAf6sh…zpzZ/);
  assert.match(rendered,/🟢 In range · Open/);assert.match(rendered,/Current PnL: \+6\.00% · Meteora-compatible/);assert.match(rendered,/Peak PnL: \+7\.21%/);
  assert.match(rendered,/Fees earned: 0\.000260 SOL/);assert.match(rendered,/Range: -1381 → -1347/);assert.match(rendered,/Current bin: -1352/);assert.match(rendered,/Opened: 3h 24m ago/);assert.match(rendered,/Updated: 18s ago/);
  assert.doesNotMatch(rendered,/Economic MTM/);assert.doesNotMatch(rendered,/Capital:/);
});
test('telegram position detail keeps LP and economic accounting explicitly distinct',()=>{
  const rendered=formatTelegramPositionDetail({position,index:1,nowMs:now});
  assert.match(rendered,/BID_ASK · ONE_SIDED_Y/);assert.match(rendered,/Capital: 0\.030000 SOL/);
  assert.match(rendered,/Current PnL: \+\$0\.2725 \(\+6\.00%\)/);assert.match(rendered,/Source: Meteora-compatible/);assert.match(rendered,/Peak PnL: \+7\.21%/);assert.match(rendered,/Economic MTM: \+\$0\.2725 \(\+6\.00%\)/);
});
test('telegram positions formats two independently valued positions and policy capacity',()=>{
  const second={...position,position_address:'7t477abcdefghijkmnopqrstuvwxyz123456789fHYs',pool_address:'PoolBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',orientation:'SKEWED_Y',net_pnl_usd:'-0.0078',net_return_fraction:'-0.0017'};
  const rendered=formatTelegramPositionSummaries({positions:[position,second],maxOpenPositions:2,nowMs:now});
  assert.match(rendered,/2 open \/ 2 max/);assert.match(rendered,/7t477a…fHYs/);assert.match(rendered,/Current PnL: \+6\.00%/);
});
test('stale or missing LP valuation is unavailable rather than a stale marked fact',()=>{
  const stale=formatTelegramPositionSummaries({positions:[{...position,observation_stale_data:true,valuation_state:'STALE'}],nowMs:now});
  assert.match(stale,/CHAIN DATA STALE/);assert.match(stale,/Current PnL: unavailable/);assert.doesNotMatch(stale,/\+\$0\.2725/);
  const missing=formatTelegramPositionSummaries({positions:[{...position,lp_mtm_state:'UNAVAILABLE',lp_net_return_fraction:null}],nowMs:now});
  assert.match(missing,/Current PnL: unavailable/);
  const chainStale=formatTelegramPositionSummaries({positions:[{...position,chain_truth_fresh:false}],nowMs:now});
  assert.match(chainStale,/CHAIN DATA STALE/);assert.match(chainStale,/Current PnL: unavailable/);
});
test('zero PnL, unavailable fees, OOR and reconciliation state remain explicit',()=>{
  const rendered=formatTelegramPositionSummaries({positions:[{...position,lp_net_return_fraction:0,fee_value_lamports:null,oor_range_state:'OUT_OF_RANGE',lifecycle_state:'RECONCILIATION_REQUIRED',reconciliation_status:'UNKNOWN'}],nowMs:now});
  assert.match(rendered,/Current PnL: \+0\.00%/);assert.match(rendered,/Fees earned: unavailable/);assert.match(rendered,/🔴 Out of range/);assert.match(rendered,/Reconciliation Required \/ Unknown/);
});
test('formatter remains bounded and presentation-only',async()=>{
  const rendered=formatTelegramPositionSummaries({positions:Array.from({length:80},(_,i)=>({...position,position_address:`position-${i}-${position.position_address}`})),maxOpenPositions:80,nowMs:now});
  assert.ok(rendered.length<=3900);assert.match(rendered,/additional positions omitted/);
  const source=await readFile('packages/telegram-operator-format/src/index.ts','utf8');
  assert.doesNotMatch(source,/^import\s/m);assert.doesNotMatch(source,/\bfetch\s*\(|https?:\/\//i);
  assert.equal(shortenTelegramPositionAddress(position.position_address),'5odbT7…jT2X');
});
test('telegram operator uses the bounded DB summary reader for /positions',async()=>{
  const source=await readFile('apps/telegram-operator/src/main.ts','utf8');
  const db=await readFile('packages/db/src/index.ts','utf8');
  assert.match(source,/parsed\.name==='\/positions'\)\{const max=maxOpenPositions\(\);response=formatTelegramPositionSummaries\(\{positions:await store\.loadTelegramOperatorPositionSummaries\(\)/);
  assert.match(source,/parsed\.name==='\/position'/);assert.match(source,/formatTelegramPositionDetail/);
  assert.match(source,/\['\/positions','\/position'\]\.includes\(parsed\.name\)/);
  assert.match(source,/resolveTelegramPositionAddress\(\{target,positions\}\)/);
  assert.match(source,/position <number> — detailed position accounting/);
  assert.match(source,/close <position number\|all>/);
  assert.match(source,/await persist\('ACCEPTED','Command accepted\.'/);
  assert.match(db,/telegram_operator_commands\.status='ACCEPTED' AND EXCLUDED\.status IN \('ACCEPTED','COMPLETED','FAILED'\)/);
  assert.match(db,/FROM operations\.telegram_operator_commands WHERE status<>'ACCEPTED'/);
  // The summary projection reads persisted receipt/control-PnL diagnostics from
  // the latest observation. Keep that JSON column in the LATERAL projection:
  // otherwise PostgreSQL rejects the presentation-only /positions query.
  assert.match(db,/SELECT observed_at,active_bin_id,range_state,stale_data,payload\s+FROM execution\.position_observations/);
  assert.match(db,/obs\.payload->'receiptLpMtm'/);
});
