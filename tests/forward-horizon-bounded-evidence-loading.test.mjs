import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { operationalHistoryWindow } from '../.build/packages/db/src/index.js';
import {
  PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2,
  freezePhase3ForwardDecision,
  matureFrozenPhase3ForwardOutcome,
  phase3ForwardOutcomeResultHash,
} from '../.build/packages/phase3-forward-validation/src/index.js';

const start = '2026-08-23T00:00:00.000Z';
const at = minute => new Date(Date.parse(start) + minute * 60_000).toISOString();

const artifact = {
  sourceSha: 'a'.repeat(40),
  buildId: 'b'.repeat(64),
  policyHash: 'c'.repeat(64),
  migrationHead: 'M0051_market_context_migration_head_constraint_fix.sql',
};
const candidate = () => {
  const bins = Array.from({ length: 33 }, (_, index) => 100 + index);
  return {
    id: 'horizon-window-v2', family: 'BASE', lowerBinId: bins[0], upperBinId: bins.at(-1), centerBinId: bins[16], widthBins: bins.length,
    lowerOffsetBins: -16, upperOffsetBins: 16, lowerDistancePct: 0, upperDistancePct: 0,
    strategy: 'CURVE', orientation: 'BALANCED', capitalFraction: 1,
    perBinWeights: bins.map(binId => ({ binId, weight: 1 / bins.length })), reasonCodes: [],
  };
};
const simulation = {
  candidateId: 'horizon-window-v2', strategy: 'CURVE', orientation: 'BALANCED', activeDurationMs: 0, inactiveDurationMs: 0, unobservedDurationMs: 0, occupancyCoverageRatio: 0, occupancyState: 'INSUFFICIENT_EVIDENCE', lowerExitCount: 0, upperExitCount: 0, feeValue: 0, inventoryChangeValue: 0, grossValueChange: 0, totalCostValue: 0, netValue: 0, feeToAdverseInventoryRatio: null, fidelity: 'EVENT_PATH_ESTIMATE', valueUnit: 'TOKEN_X', capitalValue: .03, startInventoryValue: .03, normalizationScale: 1, unitScaleValid: true, evidenceActionable: true, warnings: [],
};
const decision = () => {
  const selectedCandidate = candidate();
  return freezePhase3ForwardDecision({
    artifact,
    recommendation: {
      recommendationId: 'horizon-window-decision', phase: 'P3', recommendationOnly: true, decisionAt: start, expiresAt: at(5), pool: 'pool-horizon-window', state: 'WATCHING', noTrade: true, marketContextHash: 'context',
      regime: { transitionRisk: .2 },
      economics: { expectedFeeValue: -.00001, expectedInventoryPnl: -.00001, expectedExecutionCost: .00001, expectedRepositionCost: .00001, expectedTailRiskCharge: .00001, expectedNetLpValue: -.00004, expectedActiveTimeRatio: .6, forecastUncertainty: .7, evidenceFidelity: 'EVENT_PATH_ESTIMATE' },
      uncertaintyLineage: { evidenceUncertainty: .2, forecastUncertainty: .7, components: { evidence: .2 } }, candidateCount: 1,
      simulations: [{ ...simulation, candidateId: selectedCandidate.id }],
      ranking: { winner: 'NO_TRADE', rankings: [{ candidateId: selectedCandidate.id, utility: -.01 }], reasonCodes: [] },
      forwardValidation: {
        version: 'phase3-forward-decision-v1', horizonMinutes: 30, capitalValue: .03, capitalLamports: '30000000', activeBinIdAtDecision: selectedCandidate.centerBinId, rawUnitValueX: .000001, rawUnitValueY: .000001,
        costs: { compositionFeeValue: '0', transactionFeeValue: '.00001', slippageValue: '0', rebalanceCostValue: '.00001', otherCostValue: '.00001' },
        selectedCandidateKind: 'TOP_RANKED_COUNTERFACTUAL', selectedCandidate, selectedSimulation: { ...simulation, candidateId: selectedCandidate.id }, selectedSurvival: { survivalProbability: .9 },
        evidence: { replayAnchorAt: start, replayEvidenceWatermark: start, historicalFrameHash: 'frame', historicalEventHash: 'event' }, wouldAugEraThesisSemanticsHaveCreatedThesis: true,
      },
      reasonCodes: ['SHADOW_NO_TRADE'],
    },
  });
};
const frame = minute => {
  const selectedCandidate = candidate();
  return {
    observedAt: at(minute), activeBinId: selectedCandidate.centerBinId,
    bins: selectedCandidate.perBinWeights.map(weight => ({ binId: weight.binId, price: '1', amountX: '1000000000', amountY: '0', liquiditySupply: '1000000000000000000' })),
  };
};
const frozenWindowFrames = (frames, window) => frames.filter(value => value.observedAt >= window.since && value.observedAt <= window.through);
const event = () => ({ signature: 'horizon-window-event', eventIndex: 0, pool: 'pool-horizon-window', startBinId: 100, endBinId: 100, mmFee: '1000000', feesOnTokenX: true, stamp: { source: 'FIXTURE', observedAt: at(1) }, raw: {} });

test('V2 loader has an explicit bounded timestamp branch while legacy callers retain their existing bounded-recency branch', async () => {
  const source = await readFile('packages/db/src/index.ts', 'utf8');
  const startAt = source.indexOf('const stamps = window.through');
  const endAt = source.indexOf('const stampValues = stamps.rows.map', startAt);
  assert.ok(startAt >= 0 && endAt > startAt);
  const section = source.slice(startAt, endAt);
  assert.match(section, /observed_at>=\$2 AND observed_at<=\$3 ORDER BY observed_at ASC/);
  assert.doesNotMatch(section, /observed_at>=\$2 AND observed_at<=\$3 ORDER BY observed_at ASC LIMIT/);
  assert.match(section, /observed_at>=\$2 ORDER BY observed_at DESC LIMIT \$3/);
  const main = await readFile('apps/discovery-learning/src/main.ts', 'utf8');
  assert.match(main, /loadOperationalHistory\(decision\.poolAddress,new Date\(start-15\*60_000\)\.toISOString\(\),2000,new Date\(start\+row\.horizonMinutes\*60_000\)\.toISOString\(\)\)/);
});

for (const horizon of [30, 60, 120]) {
  test(`${horizon}m V2 evidence window preserves baseline and every in-horizon frame while excluding later frames`, () => {
    const window = operationalHistoryWindow(at(-15), at(horizon));
    const frames = Array.from({ length: 8 * 60 + 16 }, (_, index) => frame(index - 15));
    const selected = frozenWindowFrames(frames, window);
    assert.equal(window.since, at(-15));
    assert.equal(window.through, at(horizon));
    assert.equal(selected[0].observedAt, at(-15));
    assert.equal(selected.at(-1).observedAt, at(horizon));
    assert.equal(selected.length, horizon + 16);
    assert.ok(selected.every((value, index) => index === 0 || selected[index - 1].observedAt < value.observedAt));
    assert.equal(selected.some(value => value.observedAt > at(horizon)), false);
  });
}

test('delay invariance: later wall-clock frames cannot displace frozen 30m V2 evidence or economics', async () => {
  const window = operationalHistoryWindow(at(-15), at(30));
  const immediateSource = Array.from({ length: 46 }, (_, index) => frame(index - 15));
  const delayedSource = [...immediateSource, ...Array.from({ length: 8 * 60 - 30 }, (_, index) => frame(31 + index))];
  const immediateFrames = frozenWindowFrames(immediateSource, window);
  const delayedFrames = frozenWindowFrames(delayedSource, window);
  assert.deepEqual(delayedFrames, immediateFrames);
  const frozen = decision();
  const immediate = await matureFrozenPhase3ForwardOutcome({ decision: frozen, horizonMinutes: 30, outcomeModelVersion: PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2, frames: immediateFrames, events: [event()], now: at(31) });
  const delayed = await matureFrozenPhase3ForwardOutcome({ decision: frozen, horizonMinutes: 30, outcomeModelVersion: PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2, frames: delayedFrames, events: [event()], now: at(8 * 60) });
  assert.equal(immediate.state, 'FINAL');
  assert.deepEqual(delayed, immediate);
  assert.equal(await phase3ForwardOutcomeResultHash(delayed), await phase3ForwardOutcomeResultHash(immediate));
});

test('post-horizon source frames cannot affect an already-valid V2 result', async () => {
  const window = operationalHistoryWindow(at(-15), at(30));
  const source = Array.from({ length: 8 * 60 + 16 }, (_, index) => frame(index - 15));
  const selected = frozenWindowFrames(source, window);
  const frozen = decision();
  const outcome = await matureFrozenPhase3ForwardOutcome({ decision: frozen, horizonMinutes: 30, outcomeModelVersion: PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2, frames: selected, events: [event()], now: at(31) });
  assert.equal(outcome.state, 'FINAL');
  assert.equal(selected.some(value => value.observedAt > at(30)), false);
  assert.equal(outcome.realized.coverageRatio, 1);
});

test('operational history rejects an invalid or inverted immutable window', () => {
  assert.throws(() => operationalHistoryWindow('not-a-time', at(30)), /SINCE_INVALID/);
  assert.throws(() => operationalHistoryWindow(at(30), at(29)), /THROUGH_INVALID/);
});
