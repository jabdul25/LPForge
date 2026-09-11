import assert from 'node:assert/strict';
import test from 'node:test';
import {phase7AlertFingerprint,postTradeSettlementAlert,renderPhase7TelegramAlert,serializePhase7Alert} from '../.build/packages/phase7-alerting/src/index.js';
import {parseDeploymentPolicy} from '../.build/packages/deployment-policy/src/index.js';
import {settlementFinalizationConfig} from '../.build/packages/phase6-live-worker/src/index.js';

const base=()=>({
  lifecycleId:'lifecycle:position-1234567890',settlementId:'settlement:lifecycle:position-1234567890:v1',settlementVersion:1,
  positionAddress:'7fhXb33ogYqTvUYhfVud9iPrTt61ffWHFaaj8j2cj4Dy',poolAddress:'pool-1234567890',poolDisplay:'TOKEN / SOL',entryPlanId:'plan-entry',closePlanId:'plan-close',
  openedAt:'2026-09-11T09:14:00.000Z',settledAt:'2026-09-11T10:02:00.000Z',capitalLamports:30_000_000n,realizedPnlLamports:1_850_000n,realizedReturnFraction:.0616666667,
  peakMfeFraction:.0642,lpFeesLamports:1_180_000n,inventoryPnlLamports:-1_470_000n,transactionCostsLamports:-120_000n,
  protection:{ts5:'CONFIRMED',oorP4:'NOT_TRIGGERED',triggerPeakFraction:.0642,triggerReturnFraction:.0073,closeDecisionReturnFraction:.0061,exitReasonCodes:['PROFIT_RETENTION_TS5_CONFIRMED']},
  execution:{decisionAt:'2026-09-11T10:00:00.000Z',planCreatedAt:'2026-09-11T10:00:02.100Z',submittedAt:'2026-09-11T10:00:07.900Z',confirmedAt:'2026-09-11T10:00:08.300Z'},
  running:{settled:31,wins:20,losses:11,breakEven:0,netPnlLamports:-2_810_000n,grossProfitLamports:32_249_943n,grossLossLamports:-35_059_943n,avgWinnerReturnFraction:.0537,avgLoserReturnFraction:-.1063},
  provenance:{policyVersion:'post-trade-reporting-v1',policyHash:'policy-hash',releaseSha:'release-sha',accountingVersion:'gross-sol-instruction-flows-v1'},
});

test('canonical settlement report renders a compact WIN from structured canonical evidence',()=>{
  const alert=postTradeSettlementAlert(base()),rendered=renderPhase7TelegramAlert(alert);
  assert.equal(alert.code,'POSITION_SETTLED_REPORT');assert.equal(alert.entityId,'POST_TRADE_REPORT:lifecycle:position-1234567890:1');
  assert.match(rendered,/^✅ LPFORGE — Position Settled/m);assert.match(rendered,/Result: WIN/);assert.match(rendered,/Realized PnL: \+0\.001850 SOL/);assert.match(rendered,/Peak MFE: \+6\.42%/);assert.match(rendered,/Tx Costs: -0\.000120 SOL/);assert.match(rendered,/TS-5: CONFIRMED/);assert.match(rendered,/OOR-P4: Not triggered/);assert.match(rendered,/Decision → Plan: 2\.1s/);assert.match(rendered,/Wins \/ Losses: 20 \/ 11/);assert.doesNotMatch(rendered,/Entity:|Reference:/);
});

test('loss and break-even reports use their own result icons without changing canonical result data',()=>{
  const loss=base();loss.realizedPnlLamports=-410_000n;loss.realizedReturnFraction=-.0137;
  const even=base();even.realizedPnlLamports=0n;even.realizedReturnFraction=0;
  assert.match(renderPhase7TelegramAlert(postTradeSettlementAlert(loss)),/^❌ LPFORGE — Position Settled/);assert.match(renderPhase7TelegramAlert(postTradeSettlementAlert(loss)),/Result: LOSS/);
  assert.match(renderPhase7TelegramAlert(postTradeSettlementAlert(even)),/^⚪ LPFORGE — Position Settled/);assert.match(renderPhase7TelegramAlert(postTradeSettlementAlert(even)),/Result: BREAK-EVEN/);
});

test('missing optional enrichment is rendered as n/a rather than invented zero',()=>{
  const report=base();delete report.peakMfeFraction;delete report.lpFeesLamports;delete report.inventoryPnlLamports;delete report.transactionCostsLamports;delete report.execution.decisionAt;delete report.execution.planCreatedAt;delete report.execution.submittedAt;delete report.execution.confirmedAt;report.protection={ts5:'UNAVAILABLE',oorP4:'UNAVAILABLE',exitReasonCodes:[]};
  const rendered=renderPhase7TelegramAlert(postTradeSettlementAlert(report));
  assert.match(rendered,/Peak MFE: +n\/a/);assert.match(rendered,/LP Fees: +n\/a/);assert.match(rendered,/TS-5: +n\/a/);assert.match(rendered,/Decision → Plan: +n\/a/);assert.match(rendered,/Exit reason: +n\/a/);
});

test('protection summaries distinguish OOR-P4 confirmation from an armed TS-5 watch',()=>{
  const oor=base();oor.protection={ts5:'NOT_TRIGGERED',oorP4:'CONFIRMED',exitReasonCodes:['PROFIT_RETENTION_OOR_P4_CONFIRMED']};
  const armed=base();armed.protection={ts5:'ARMED_NOT_CONFIRMED',oorP4:'NOT_TRIGGERED',exitReasonCodes:['EXIT_HARD_POSITION_STOP_LOSS']};
  assert.match(renderPhase7TelegramAlert(postTradeSettlementAlert(oor)),/OOR-P4: CONFIRMED/);assert.match(renderPhase7TelegramAlert(postTradeSettlementAlert(oor)),/Exit reason: PROFIT_RETENTION_OOR_P4_CONFIRMED/);
  assert.match(renderPhase7TelegramAlert(postTradeSettlementAlert(armed)),/TS-5: Armed, not confirmed/);assert.match(renderPhase7TelegramAlert(postTradeSettlementAlert(armed)),/Exit reason: EXIT_HARD_POSITION_STOP_LOSS/);
});

test('a superseding canonical settlement emits one versioned correction identity',()=>{
  const report=base();report.settlementVersion=2;report.settlementId='settlement:lifecycle:position-1234567890:v2';report.realizedPnlLamports=-410_000n;report.realizedReturnFraction=-.0136666667;report.correction={previousSettlementVersion:1,previousPnlLamports:1_850_000n,previousReturnFraction:.0616666667,reason:'ADDITIONAL_CONFIRMED_ATTRIBUTABLE_CASHFLOW'};
  const correction=postTradeSettlementAlert(report),same=postTradeSettlementAlert(report),normal=postTradeSettlementAlert(base()),rendered=renderPhase7TelegramAlert(correction);
  assert.equal(correction.code,'POSITION_SETTLEMENT_CORRECTED');assert.equal(correction.entityId,'POST_TRADE_REPORT:lifecycle:position-1234567890:2');assert.equal(phase7AlertFingerprint(correction),phase7AlertFingerprint(same));assert.notEqual(phase7AlertFingerprint(correction),phase7AlertFingerprint(normal));assert.match(rendered,/^♻️ LPFORGE — Post-Trade Report Corrected/);assert.match(rendered,/Settlement: v1 → v2/);assert.match(rendered,/Corrected PnL: -0\.000410 SOL/);assert.match(rendered,/ADDITIONAL_CONFIRMED_ATTRIBUTABLE_CASHFLOW/);
});

test('running statistics avoid Infinity when a selected canonical cohort has no realized losses',()=>{
  const report=base();report.running={settled:3,wins:3,losses:0,breakEven:0,netPnlLamports:3_000_000n,grossProfitLamports:3_000_000n,grossLossLamports:0n,avgWinnerReturnFraction:.03};
  const rendered=renderPhase7TelegramAlert(postTradeSettlementAlert(report));assert.match(rendered,/Profit factor: n\/a \(no realized losses\)/);assert.doesNotMatch(rendered,/Infinity|NaN/);
});

test('post-trade reports remain comfortably within Telegram limits with bounded reason data',()=>{
  const report=base();report.protection.exitReasonCodes=Array.from({length:50},(_,i)=>`REASON_${i}`);assert.ok(renderPhase7TelegramAlert(postTradeSettlementAlert(report)).length<=4096);
});

test('structured lamport evidence serializes safely into the durable outbox payload',()=>{
  const payload=serializePhase7Alert(postTradeSettlementAlert(base()));
  assert.match(payload,/"capitalLamports":"30000000"/);assert.match(payload,/"realizedPnlLamports":"1850000"/);
});

test('the versioned reporting cohort is validated by deployment policy rather than a source literal',()=>{
  const policy={schemaVersion:1,policyId:'test',status:'ENABLED',approvalTtlMs:15000,minDevnetConfirmedRuns:3,maxActionsPerDay:3,maxOpenPositions:2,pools:[],productionAdmission:{enabled:true,eligibleTiers:['A'],maxCandidates:1,maxCandidateAgeMs:60000,maxCapitalSol:'0.5',maxOpenPositions:2},settlement:{residualDustThresholdUsd:0},postTradeReporting:{enabled:true,policyVersion:'post-trade-reporting-v1',runningStatsStartAt:'2026-09-01T00:00:00.000Z'}};
  assert.equal(parseDeploymentPolicy(policy).postTradeReporting?.runningStatsStartAt,'2026-09-01T00:00:00.000Z');
  assert.throws(()=>parseDeploymentPolicy({...policy,postTradeReporting:{...policy.postTradeReporting,runningStatsStartAt:'not-a-time'}}),/POST_TRADE_REPORTING/);
});

test('the worker builds the report only after immutable settlement and finalized fee attribution',async()=>{
  const source=await import('node:fs/promises').then(fs=>fs.readFile('packages/phase6-live-worker/src/index.ts','utf8'));
  const settlement=source.indexOf('persistLifecycleSolSettlement'),fees=source.indexOf('finalizeCloseFeeAttribution',settlement),report=source.indexOf('loadCanonicalPostTradeReport',fees),compact=source.indexOf('compactPositionManagementDecisionAudit',report),queue=source.indexOf('queuePositionSettledAlert(postTradeReport)',compact);
  assert.ok(settlement>=0&&fees>settlement&&report>fees&&compact>report&&queue>compact,'settlement → attribution → report snapshot → compaction → outbox queue');
  assert.match(source,/postTradeSettlementAlert\(report\)/);assert.match(source,/\.catch\(\(\)=>\{\}\)/);
});

test('reconciliation-only settlement carries the same post-trade reporting policy as a direct close',async()=>{
  const policy={enabled:true,policyVersion:'post-trade-reporting-v1',runningStatsStartAt:'2026-09-01T00:00:00.000Z'};
  const finalization=settlementFinalizationConfig({rpcUrl:'http://rpc',residualDustThresholdUsd:0,meteoraDataApiUrl:'http://api',dataApiMaxRps:25,httpTimeoutMs:10_000,policyHash:'policy-hash',postTradeReporting:policy});
  assert.deepEqual(finalization.postTradeReporting,policy);
  const [worker,execution]=await Promise.all([
    import('node:fs/promises').then(fs=>fs.readFile('packages/phase6-live-worker/src/index.ts','utf8')),
    import('node:fs/promises').then(fs=>fs.readFile('apps/execution/src/main.ts','utf8')),
  ]);
  assert.match(worker,/postTradeReporting\?: NonNullable<LiveWorkerConfig\["postTradeReporting"\]>/);
  assert.equal((worker.match(/config:settlementFinalizationConfig\(input\)/g)??[]).length,3,'every reconciliation settlement route retains the reporting policy');
  assert.match(execution,/postTradeReporting:config\.postTradeReporting/,'P6 recovery receives the validated canonical policy');
});
