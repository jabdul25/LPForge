import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V1,
  PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2,
  buildPhase3ForwardEpisodeCalibration,
  freezePhase3ForwardDecision,
  matureFrozenPhase3ForwardOutcome,
} from '../.build/packages/phase3-forward-validation/src/index.js';

const start = '2026-08-23T00:00:00.000Z';
const at = minute => new Date(Date.parse(start) + minute * 60_000).toISOString();
const artifact = { sourceSha: 'a'.repeat(40), buildId: 'b'.repeat(64), policyHash: 'c'.repeat(64), migrationHead: 'M0048_phase3_forward_outcome_v2_capital_constrained.sql' };
const simulation = { candidateId: 'v2', strategy: 'CURVE', orientation: 'BALANCED', activeDurationMs: 0, inactiveDurationMs: 0, unobservedDurationMs: 0, occupancyCoverageRatio: 0, occupancyState: 'INSUFFICIENT_EVIDENCE', lowerExitCount: 0, upperExitCount: 0, feeValue: 0, inventoryChangeValue: 0, grossValueChange: 0, totalCostValue: 0, netValue: 0, feeToAdverseInventoryRatio: null, fidelity: 'EVENT_PATH_ESTIMATE', valueUnit: 'TOKEN_X', capitalValue: .03, startInventoryValue: .03, normalizationScale: 1, unitScaleValid: true, evidenceActionable: true, warnings: [] };

function candidate(width = 33) {
  const bins = Array.from({ length: width }, (_, index) => 100 + index);
  return {
    id: `v2-${width}`, family: 'BASE', lowerBinId: bins[0], upperBinId: bins.at(-1), centerBinId: bins[Math.floor(width / 2)], widthBins: width,
    lowerOffsetBins: -Math.floor(width / 2), upperOffsetBins: Math.floor(width / 2), lowerDistancePct: 0, upperDistancePct: 0,
    strategy: 'CURVE', orientation: 'BALANCED', capitalFraction: 1,
    perBinWeights: bins.map(binId => ({ binId, weight: 1 / width })), reasonCodes: [],
  };
}
function recommendation(id, selectedCandidate = candidate()) {
  return {
    recommendationId: id, phase: 'P3', recommendationOnly: true, decisionAt: start, expiresAt: at(5), pool: 'pool-v2', state: 'WATCHING', noTrade: true, marketContextHash: 'context',
    regime: { transitionRisk: .2 }, economics: { expectedFeeValue: -.00001, expectedInventoryPnl: -.00001, expectedExecutionCost: .00001, expectedRepositionCost: .00001, expectedTailRiskCharge: .00001, expectedNetLpValue: -.00004, expectedActiveTimeRatio: .6, forecastUncertainty: .7, evidenceFidelity: 'EVENT_PATH_ESTIMATE' },
    uncertaintyLineage: { evidenceUncertainty: .2, forecastUncertainty: .7, components: { evidence: .2 } }, candidateCount: 1, simulations: [simulation], ranking: { winner: 'NO_TRADE', rankings: [{ candidateId: selectedCandidate.id, utility: -.01 }], reasonCodes: [] },
    forwardValidation: { version: 'phase3-forward-decision-v1', horizonMinutes: 30, capitalValue: .03, capitalLamports: '30000000', activeBinIdAtDecision: selectedCandidate.centerBinId, rawUnitValueX: .000001, rawUnitValueY: .000001, costs: { compositionFeeValue: '0', transactionFeeValue: '.00001', slippageValue: '0', rebalanceCostValue: '.00001', otherCostValue: '.00001' }, selectedCandidateKind: 'TOP_RANKED_COUNTERFACTUAL', selectedCandidate, selectedSimulation: simulation, selectedSurvival: { survivalProbability: .9 }, evidence: { replayAnchorAt: start, replayEvidenceWatermark: start, historicalFrameHash: 'frame', historicalEventHash: 'event' }, wouldAugEraThesisSemanticsHaveCreatedThesis: true },
    reasonCodes: ['SHADOW_NO_TRADE'],
  };
}
function frame(minute, selectedCandidate, liquiditySupply = '1000000000000000000', amountX = '1000000000') {
  return {
    observedAt: at(minute), activeBinId: selectedCandidate.centerBinId,
    bins: selectedCandidate.perBinWeights.map(weight => ({ binId: weight.binId, price: '1', amountX, amountY: '0', liquiditySupply })),
  };
}
async function mature(id, selectedCandidate, options = {}) {
  const decision = freezePhase3ForwardDecision({ recommendation: recommendation(id, selectedCandidate), artifact });
  const frames = Array.from({ length: 31 }, (_, minute) => frame(minute, selectedCandidate, options.liquiditySupply, options.amountX));
  const events = [{ signature: 'capital-event', eventIndex: 0, pool: 'pool-v2', startBinId: selectedCandidate.lowerBinId, endBinId: selectedCandidate.lowerBinId, mmFee: '1000000', feesOnTokenX: true, stamp: { source: 'FIXTURE', observedAt: at(1) }, raw: {} }];
  return { decision, v1: await matureFrozenPhase3ForwardOutcome({ decision, horizonMinutes: 30, outcomeModelVersion: PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V1, frames, events, now: at(31) }), v2: await matureFrozenPhase3ForwardOutcome({ decision, horizonMinutes: 30, outcomeModelVersion: PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2, frames, events, now: at(31) }) };
}

test('V2 capital-constrained position uses the frozen 0.03 SOL exactly once for fees and inventory', async () => {
  const { v1, v2 } = await mature('508afae9-reproduction', candidate(33));
  assert.equal(v1.outcomeModelVersion, PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V1);
  assert.equal(v2.outcomeModelVersion, PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2);
  assert.equal(v2.state, 'FINAL');
  assert.equal(v2.realized.frozenCapitalLamports, '30000000');
  assert.equal(v2.realized.allocatedCapitalLamports, '30000000');
  assert.ok(BigInt(v2.realized.derivedPositionValueLamports) <= 30000000n);
  assert.ok(BigInt(v2.realized.derivedPositionValueLamports) * 10000n >= 30000000n * 9950n);
  assert.equal(v2.realized.participationModel, 'CAPITAL_CONSTRAINED_V2');
  assert.equal(v2.realized.perBinParticipation.reduce((sum, row) => sum + BigInt(row.allocatedCapitalLamports), 0n), 30000000n);
  assert.ok(v2.realized.perBinParticipation.every(row => row.effectiveOwnershipBps <= 500));
  assert.ok(v2.realized.realizedFeeValue < .00001, 'a 0.03 SOL position cannot claim a material pool-wide fee fraction');
  assert.notDeepEqual(v1.realized, v2.realized, 'V1 remains a distinct immutable model');
});



test('V2 rejects a narrow frozen range that would exceed the price-taking participation cap', async () => {
  const { v2 } = await mature('5a4e0873-reproduction', candidate(1), { amountX: '100000000' });
  assert.equal(v2.state, 'INSUFFICIENT_EVIDENCE');
  assert.ok(v2.reasonCodes.includes('FORWARD_V2_NOT_PRICE_TAKING'));
});

test('V2 fails closed for zero/near-zero frozen bin liquidity and never amplifies per-bin weights', async () => {
  const { v2 } = await mature('17ce1138-reproduction', candidate(33), { liquiditySupply: '0' });
  assert.equal(v2.state, 'INSUFFICIENT_EVIDENCE');
  assert.ok(v2.reasonCodes.includes('FORWARD_V2_BIN_LIQUIDITY_UNAVAILABLE'));
});

test('V2 episode calibration collapses overlapping decision windows deterministically', () => {
  const makeRow = (id, minute, net) => {
    const decision = freezePhase3ForwardDecision({ recommendation: { ...recommendation(id), decisionAt: at(minute) }, artifact });
    return { decision, outcome: { recommendationId: id, horizonMinutes: 30, outcomeModelVersion: PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2, state: 'FINAL', reasonCodes: [], realized: { realizedNetValue: net } } };
  };
  const rows = [makeRow('episode-0', 0, .001), makeRow('episode-10', 10, .001), makeRow('episode-31', 31, -.001)];
  const report = buildPhase3ForwardEpisodeCalibration(rows, { outcomeModelVersion: PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2 });
  assert.equal(report.summary.predictions, 2);
  assert.equal(report.summary.final, 2);
});

test('V2 retries are terminal when frozen capital cannot support a price-taking position', async () => {
  const { deriveForwardMaturationRetryPlan } = await import('../.build/apps/discovery-learning/src/forward-maturation-scheduler.js');
  const retry = deriveForwardMaturationRetryPlan({ priorState: 'PENDING', resultState: 'INSUFFICIENT_EVIDENCE', reasonCodes: ['FORWARD_V2_NOT_PRICE_TAKING'], retryCount: 0, attemptedAt: at(31) });
  assert.equal(retry.terminal, true);
  assert.equal(retry.nextRetryAt, undefined);
});

test('V2 rejects bigint values outside exact valuation precision instead of silently rounding them', async () => {
  const { v2 } = await mature('490bd97e-reproduction', candidate(33), { amountX: '9007199254740992' });
  assert.equal(v2.state, 'INSUFFICIENT_EVIDENCE');
  assert.ok(v2.reasonCodes.includes('FORWARD_V2_BIN_LIQUIDITY_UNAVAILABLE'));
});

test('counterfactual V2 preserves an ownership-limited constructible position without clipping', async () => {
  const c=candidate(1), decision=freezePhase3ForwardDecision({recommendation:recommendation('counterfactual-policy',c),artifact});
  const frames=Array.from({length:121},(_,minute)=>frame(minute,c,'1000000000000000000','100000000'));
  const events=[{signature:'counterfactual-event',eventIndex:0,pool:'pool-v2',startBinId:c.lowerBinId,endBinId:c.lowerBinId,mmFee:'1000000',feesOnTokenX:true,stamp:{source:'FIXTURE',observedAt:at(1)},raw:{}}];
  const strict=await matureFrozenPhase3ForwardOutcome({decision,horizonMinutes:30,outcomeModelVersion:PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2,frames,events,now:at(121)});
  const outcomes=await Promise.all([30,60,120].map(horizonMinutes=>matureFrozenPhase3ForwardOutcome({decision,horizonMinutes, outcomeModelVersion:PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2,frames,events,now:at(121),enforcePriceTakingOwnershipCap:false})));
  assert.equal(strict.state,'INSUFFICIENT_EVIDENCE');
  assert.deepEqual(outcomes.map(x=>x.state),['FINAL','FINAL','FINAL']);
  assert.ok(outcomes.every(x=>x.realized.frozenCapitalLamports==='30000000'&&x.realized.maxEffectiveOwnershipBps>500));
});
