import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildReset3cSharedEvidenceReference,
  buildReset3cValidationSharedEvidenceReference,
  compactReset3cRawContract,
  compactReset3cDecisionRelevantRawContract,
  matureFrozenPhase3ForwardOutcome,
  PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2,
  reconstructReset3cRawContract,
} from '../.build/packages/phase3-forward-validation/src/index.js';

const decisionAt = '2026-08-28T00:00:00.000Z';
const frame = minute => ({ observedAt: new Date(Date.parse(decisionAt) + minute * 60_000).toISOString(), activeBinId: 100, bins: Array.from({ length: 32 }, (_, index) => ({ binId: 84 + index, price: '1', amountX: '100000000', amountY: '0', liquiditySupply: '1000000000000000000' })) });
const candidate = { id: 'candidate-b', family: 'BASE', strategy: 'CURVE', orientation: 'BALANCED', lowerBinId: 84, upperBinId: 115, centerBinId: 100, widthBins: 32, lowerOffsetBins: -16, upperOffsetBins: 15, lowerDistancePct: 0, upperDistancePct: 0, capitalFraction: 1, perBinWeights: Array.from({ length: 32 }, (_, index) => ({ binId: 84 + index, weight: 1 / 32 })), reasonCodes: [] };
const policy = { status: 'OWNERSHIP_LIMIT', bindingConstraint: 'OWNERSHIP_CAP', proposedCapitalLamports: '1000000000', allocatedCapitalLamports: '1000000000', ownershipProfile: { resultingOwnershipBps: 901 }, canonicalPosition: { lowerBinId: 84, upperBinId: 115 }, perBinSupport: [{ binId: 84, ownershipBps: 901 }] };
const mechanical = { mechanicallyConstructible: true, allocatedCapitalLamports: '1000000000', capitalUtilizationBps: 10000, maxOwnershipBps: 901, canonicalPosition: policy.canonicalPosition, ownershipProfile: policy.ownershipProfile, currentPolicyFeasibility: policy };
const sharedPayload = {
  candidateUniverseEvidence: {
    version: 'reset3c-universe-v1', capitalLamports: '1000000000', frames: Array.from({ length: 121 }, (_, minute) => frame(minute)), events: [{ signature: 'shared-event', eventIndex: 0, pool: 'pool-storage', startBinId: 84, endBinId: 84, mmFee: '1000000', feesOnTokenX: true, stamp: { observedAt: '2026-08-28T00:01:00.000Z' } }], costs: { transactionFeeValue: '0.00001' }, candidates: [candidate], simulations: [], ranking: { winner: candidate.id, rankings: [] }, qualification: { verdict: 'QUALIFIED', globalAdjustmentWeight: 0.5 }, economics: { expectedNetLpValue: 0.001 },
  },
};
const v1 = {
  version: 'reset3c-universe-v1', universeManifestHash: 'manifest', expectedCandidateCount: 2, capturedCandidateCount: 2, universeComplete: true, evidenceCutoffAt: decisionAt,
  frozenDecision: { recommendationId: 'rec-storage', decisionId: 'decision-storage', poolAddress: 'pool-storage', decisionTimestamp: decisionAt, sourceSha: 'a'.repeat(40), buildId: 'b'.repeat(64), policyHash: 'c'.repeat(64), migrationHead: 'M0055_reset3c_shared_shadow_evidence_immutability.sql', capitalLamports: '1000000000', phase3State: 'WATCHING', phase3Outcome: 'NO_TRADE', reasonCodes: [], prediction: { rawUnitValueX: 1e-9, rawUnitValueY: 1e-9, expectedExecutionCost: .00001, expectedRepositionCost: 0, expectedTailRiskCost: 0 }, evidenceProvenance: {}, selectedCandidate: candidate, selectedCandidateKind: 'TOP_RANKED_COUNTERFACTUAL', wouldAugEraThesisSemanticsHaveCreatedThesis: true, phase4: { result: 'NOT_EVALUATED', readinessScore: null, timingConfidence: null, reasonCodes: [], diagnostics: {} } },
  frames: sharedPayload.candidateUniverseEvidence.frames, events: sharedPayload.candidateUniverseEvidence.events, candidate, legacyEconomics: { candidateId: candidate.id, feeValue: .001, inventoryChangeValue: -.0002, totalCostValue: .0001, netValue: .0007 }, canonicalEconomics: { userSelectedCapitalLamports: '1000000000', allocatedCapitalLamports: '1000000000', expectedFeePnlSol: .001, expectedInventoryEffectSol: -.0002, expectedCostsSol: .0001, expectedNetPnlSol: .0007, expectedNetReturnBps: 7 }, mechanicalConstructibility: mechanical, currentPolicy: policy, rankingFacts: { candidateId: candidate.id, rank: 2, utility: .7 }, qualificationFacts: sharedPayload.candidateUniverseEvidence.qualification, globalEconomics: sharedPayload.candidateUniverseEvidence.economics,
};

function semantic(value) {
  const copy = structuredClone(value);
  delete copy.version;
  delete copy.storageContractVersion;
  delete copy.sharedEvidenceReference;
  return copy;
}

test('M0053 V2 stores shared universe evidence once and reconstructs the V1 semantic contract exactly', async () => {
  const reference = await buildReset3cSharedEvidenceReference({ recommendationId: 'rec-storage', shadowRecommendationPayload: sharedPayload });
  const compact = compactReset3cRawContract(v1, reference);
  const restored = await reconstructReset3cRawContract({ rawContract: compact, shadowRecommendationPayload: sharedPayload });
  assert.deepEqual(semantic(restored), semantic(v1));
  assert.equal(restored.canonicalEconomics.expectedNetPnlSol, v1.canonicalEconomics.expectedNetPnlSol);
  assert.equal(restored.frozenDecision.capitalLamports, '1000000000');
  assert.equal(restored.mechanicalConstructibility.mechanicallyConstructible, true);
  assert.equal(restored.currentPolicy.status, 'OWNERSHIP_LIMIT');
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(v1)) * .4, 'candidate row must materially shrink');
});

test('M0053 V2 fails closed if immutable shared evidence is absent or changes', async () => {
  const reference = await buildReset3cSharedEvidenceReference({ recommendationId: 'rec-storage', shadowRecommendationPayload: sharedPayload });
  const compact = compactReset3cRawContract(v1, reference);
  await assert.rejects(() => reconstructReset3cRawContract({ rawContract: compact }), /LPFORGE_RESET3C_SHARED_EVIDENCE_REFERENCE_INVALID/);
  const altered = structuredClone(sharedPayload);
  altered.candidateUniverseEvidence.frames[0].activeBinId = 999;
  await assert.rejects(() => reconstructReset3cRawContract({ rawContract: compact, shadowRecommendationPayload: altered }), /LPFORGE_RESET3C_SHARED_EVIDENCE_HASH_MISMATCH/);
});

test('M0053 V1 and compact V2 reconstruct identical canonical 30m/60m/120m outcomes', async () => {
  const reference = await buildReset3cSharedEvidenceReference({ recommendationId: 'rec-storage', shadowRecommendationPayload: sharedPayload });
  const restored = await reconstructReset3cRawContract({ rawContract: compactReset3cRawContract(v1, reference), shadowRecommendationPayload: sharedPayload });
  for (const horizonMinutes of [30, 60, 120]) {
    const input = { horizonMinutes, outcomeModelVersion: PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2, frames: v1.frames, events: v1.events, now: new Date(Date.parse(decisionAt) + 121 * 60_000).toISOString(), enforcePriceTakingOwnershipCap: false };
    const before = await matureFrozenPhase3ForwardOutcome({ ...input, decision: v1.frozenDecision });
    const after = await matureFrozenPhase3ForwardOutcome({ ...input, decision: restored.frozenDecision });
    assert.deepEqual(after, before, `${horizonMinutes}m realization must be storage-shape invariant`);
  }
});

test('M0053 V3 reconstructs the same canonical 30m/60m/120m outcomes while frozen decision context is temporary', async () => {
  const universe = { capitalLamports: '1000000000', frames: v1.frames, events: v1.events, costs: sharedPayload.candidateUniverseEvidence.costs };
  const { reference, temporarySharedEvidence } = await buildReset3cValidationSharedEvidenceReference({
    recommendationId: 'rec-storage', universe, frozenDecision: v1.frozenDecision,
  });
  const compact = compactReset3cDecisionRelevantRawContract(v1, reference, {
    samplingContractVersion: 'reset3c-validation-sampling-v1',
    detailedSelectionManifestHash: 'd'.repeat(64),
    detailedValidationReasons: ['TOP_CANONICAL_EXPECTED_NET'],
    outcomeEligible: true,
  });
  assert.equal(compact.frozenDecision.marketContext, undefined);
  const restored = await reconstructReset3cRawContract({ rawContract: compact, temporarySharedEvidence });
  assert.deepEqual(restored.frozenDecision, v1.frozenDecision);
  for (const horizonMinutes of [30, 60, 120]) {
    const input = { horizonMinutes, outcomeModelVersion: PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2, frames: v1.frames, events: v1.events, now: new Date(Date.parse(decisionAt) + 121 * 60_000).toISOString(), enforcePriceTakingOwnershipCap: false };
    const before = await matureFrozenPhase3ForwardOutcome({ ...input, decision: v1.frozenDecision });
    const after = await matureFrozenPhase3ForwardOutcome({ ...input, decision: restored.frozenDecision });
    assert.deepEqual(after, before, `${horizonMinutes}m realization must be V3 storage-shape invariant`);
  }
});

test('V2 reader remains compatible while the V3 writer uses decision-relevant temporary evidence without authority imports', async () => {
  const [operator, db, learner] = await Promise.all([
    readFile('apps/operator/src/main.ts', 'utf8'),
    readFile('packages/db/src/index.ts', 'utf8'),
    readFile('apps/discovery-learning/src/main.ts', 'utf8'),
  ]);
  assert.match(operator, /compactReset3cDecisionRelevantRawContract\(v1Raw,sharedEvidenceReference/);
  assert.match(operator, /buildReset3cValidationSharedEvidenceReference/);
  assert.match(operator, /insertReset3cValidationUniverse/);
  assert.match(operator, /outcomeRows=rows/);
  assert.match(db, /FROM research\.shadow_recommendations WHERE recommendation_id=ANY\(\$1::text\[\]\)/);
  assert.match(db, /research\.reset3c_validation_universes/);
  assert.match(db, /outcomeEligible/);
  assert.match(learner, /reset3cReconstructionFailure/);
  for (const source of [operator, db, learner]) {
    assert.doesNotMatch(source, /rankCandidates\(/);
    assert.doesNotMatch(source, /enable.*execution|execution.*enable/i);
  }
});

test('M0055 makes the existing shared snapshot immutable without rewriting M0053 or M0054 evidence', async () => {
  const migration = await readFile('packages/db/migrations/M0055_reset3c_shared_shadow_evidence_immutability.sql', 'utf8');
  assert.match(migration, /trg_shadow_recommendations_immutable/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON research\.shadow_recommendations/);
  assert.doesNotMatch(migration, /ALTER TABLE research\.variable_capital_evaluations/i);
  assert.doesNotMatch(migration, /ALTER TABLE research\.candidate_counterfactual_forward_outcomes/i);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|TRUNCATE)\s+research\.(?:variable_capital_evaluations|candidate_counterfactual_forward_outcomes)/i);
});
