import assert from 'node:assert/strict';
import test from 'node:test';
import {classifyProductionPoolCandidate,deriveProductionPoolHistory,fairProductionPoolOrder,selectProductionGlobalWinner} from '../.build/packages/production-global-selection/src/index.js';

const cutoff='2026-08-31T20:00:00.000Z',started='2026-08-31T19:58:00.000Z';
const outcome=(x={})=>({lifecycleId:'hve',poolAddress:'EsR3',settledAt:'2026-08-31T19:00:00.000Z',realizedNetLamports:-1_925_242n,realizedReturnFraction:-.064174733,closeReason:'OOR_TOKEN_EXPOSURE',oorDirection:'BELOW_MIN',inventoryClassification:'OOR_TOKEN_EXPOSURE',grossFeesLamports:924_642n,...x});
const candidate=(pool,ev,opts={})=>classifyProductionPoolCandidate({cycleStartedAt:started,decisionCutoff:cutoff,candidate:{poolAddress:pool,operationalState:'ENTRY_READY',recommendationId:`r-${pool}`,thesisId:`t-${pool}`,candidateId:`c-${pool}`,decisionAt:'2026-08-31T19:59:00.000Z',expiresAt:'2026-08-31T20:04:00.000Z',phase3State:'ENTRY_READY',phase4State:'ENTRY_READY',capitalValue:.03,horizonMinutes:60,riskAdjustedExpectedNetEv:ev,history:deriveProductionPoolHistory({poolAddress:pool,asOf:cutoff,outcomes:opts.outcomes??[]}),...opts}});

test('one best Candidate-Primary result per pool is globally ranked by comparable risk-adjusted net EV',()=>{
  const r=selectProductionGlobalWinner({decisionCutoff:cutoff,candidates:[candidate('A',.0001),candidate('B',.0003),candidate('C',.0002)]});
  assert.equal(r.outcome,'GLOBAL_WINNER');assert.equal(r.crossPoolMetricsComparable,true);assert.equal(r.winner?.poolAddress,'B');assert.deepEqual(r.ranked.map(x=>x.poolAddress),['B','C','A']);
});
test('P4 WAIT or REJECT cannot be emitted as a global winner even when rank one',()=>{
  const wait=candidate('A',.0003,{phase4State:'WAIT'}),reject=candidate('B',.0002,{phase4State:'REJECT'});
  const r=selectProductionGlobalWinner({decisionCutoff:cutoff,candidates:[wait,reject]});
  assert.equal(wait.state,'NO_VALID_CANDIDATE');assert.equal(reject.state,'NO_VALID_CANDIDATE');assert.equal(r.outcome,'GLOBAL_NO_TRADE');
  assert.ok(wait.reasonCodes.includes('GLOBAL_P4_NOT_ENTRY_READY'));
});
test('zero operational allocation or false final entry readiness cannot be emitted as a global winner',()=>{
  const zero=candidate('A',.0003,{operationalCapitalAllocated:0,operationalEntryReady:false});
  const r=selectProductionGlobalWinner({decisionCutoff:cutoff,candidates:[zero]});
  assert.equal(zero.state,'NO_VALID_CANDIDATE');assert.equal(r.outcome,'GLOBAL_NO_TRADE');
  assert.ok(zero.reasonCodes.includes('GLOBAL_OPERATIONAL_CAPITAL_ALLOCATION_ZERO'));
  assert.ok(zero.reasonCodes.includes('GLOBAL_OPERATIONAL_ENTRY_NOT_READY'));
});
test('missing, stale, or incompatible pool facts fail closed rather than falling back to a single probe',()=>{
  const stale=candidate('A',.1,{decisionAt:'2026-08-31T19:50:00.000Z'});assert.equal(stale.state,'EXCLUDED_STALE');
  const incomplete=selectProductionGlobalWinner({decisionCutoff:cutoff,candidates:[stale]});assert.equal(incomplete.outcome,'GLOBAL_NO_TRADE');
  const mismatch=selectProductionGlobalWinner({decisionCutoff:cutoff,candidates:[candidate('A',.1),candidate('B',.2,{capitalValue:.05})]});assert.equal(mismatch.outcome,'GLOBAL_NO_TRADE');assert.equal(mismatch.crossPoolMetricsComparable,false);
});
test('WARMING and NO_TRADE are canonical global states, not missing or stale candidates',()=>{
  const history=deriveProductionPoolHistory({poolAddress:'W',asOf:cutoff,outcomes:[]});
  const warming=classifyProductionPoolCandidate({cycleStartedAt:started,decisionCutoff:cutoff,candidate:{poolAddress:'W',operationalState:'WARMING',operationalReasonCodes:['OPERATIONAL_EVIDENCE_MATURITY_PENDING'],phase3State:'WARMING',phase4State:'WARMING',history}});
  const noTrade=classifyProductionPoolCandidate({cycleStartedAt:started,decisionCutoff:cutoff,candidate:{poolAddress:'N',operationalState:'NO_TRADE',operationalReasonCodes:['CANDIDATE_PRIMARY_NO_LOCALLY_ACTIONABLE_WINNER'],phase3State:'NO_TRADE',phase4State:'NO_TRADE',history:deriveProductionPoolHistory({poolAddress:'N',asOf:cutoff,outcomes:[]})}});
  assert.equal(warming.state,'WARMING');assert.ok(warming.reasonCodes.includes('OPERATIONAL_EVIDENCE_MATURITY_PENDING'));assert.equal(noTrade.state,'NO_TRADE');assert.ok(noTrade.reasonCodes.includes('CANDIDATE_PRIMARY_NO_LOCALLY_ACTIONABLE_WINNER'));
});
test('one ENTRY_READY candidate can rank while other pools are explicitly WARMING',()=>{
  const history=deriveProductionPoolHistory({poolAddress:'W',asOf:cutoff,outcomes:[]});
  const warming=classifyProductionPoolCandidate({cycleStartedAt:started,decisionCutoff:cutoff,candidate:{poolAddress:'W',operationalState:'WARMING',phase3State:'WARMING',phase4State:'WARMING',history}});
  const r=selectProductionGlobalWinner({decisionCutoff:cutoff,candidates:[candidate('A',.0003),warming]});
  assert.equal(r.outcome,'GLOBAL_WINNER');assert.equal(r.winner?.poolAddress,'A');
});
test('ENTRY_READY without its canonical capital record is explicitly rejected',()=>{
  const broken=candidate('A',.1,{capitalValue:undefined});
  assert.equal(broken.state,'NO_VALID_CANDIDATE');assert.ok(broken.reasonCodes.includes('GLOBAL_ENTRY_READY_METRICS_INCOMPLETE'));
});
test('authoritative corrected settlements are visible only after settlement and remain isolated per canonical pool',()=>{
  const hve=outcome(),history=deriveProductionPoolHistory({poolAddress:'EsR3',asOf:cutoff,outcomes:[hve,outcome({lifecycleId:'future',settledAt:'2026-08-31T20:01:00.000Z'}),outcome({lifecycleId:'other',poolAddress:'other',realizedNetLamports:320_468n})]});
  assert.deepEqual(history.sourceLifecycleIds,['hve']);assert.equal(history.lastRealizedNetLamports,-1_925_242n);assert.equal(history.recentTokenRiskCloseCount,1);assert.equal(deriveProductionPoolHistory({poolAddress:'other',asOf:cutoff,outcomes:[hve]}).entriesToday,0);
});
test('same-pool re-entry requires a post-settlement candidate but does not permanently ban the pool',()=>{
  const hve=outcome({settledAt:'2026-08-31T19:59:00.000Z'});const stale=candidate('EsR3',.5,{decisionAt:hve.settledAt,outcomes:[hve]});assert.equal(stale.state,'EXCLUDED_REENTRY_EVIDENCE');
  const fresh=candidate('EsR3',.5,{decisionAt:'2026-08-31T19:59:30.000Z',outcomes:[hve]});const r=selectProductionGlobalWinner({decisionCutoff:cutoff,candidates:[fresh,candidate('other',.1)]});assert.equal(r.winner?.poolAddress,'EsR3');
});
test('fair scheduler is deterministic, rotates, and has no duplicate pool starvation',()=>{
  const pools=['C','A','B','A'],one=fairProductionPoolOrder(pools,'cycle-1'),again=fairProductionPoolOrder(pools,'cycle-1'),two=fairProductionPoolOrder(pools,'cycle-2');assert.deepEqual(one,again);assert.equal(new Set(one).size,3);assert.equal(one.length,3);assert.equal(two.length,3);
});
