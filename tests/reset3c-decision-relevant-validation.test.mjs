import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  RESET3C_STORAGE_CONTRACT_V3,
  RESET3C_VALIDATION_SAMPLING_CONTRACT_V1,
  buildReset3cValidationSharedEvidenceReference,
  compactReset3cDecisionRelevantRawContract,
  reconstructReset3cRawContract,
  selectReset3cDecisionRelevantCandidates,
} from '../.build/packages/phase3-forward-validation/src/index.js';

const decisionAt = '2026-08-28T00:00:00.000Z';
const candidate = id => ({ id, family: 'BASE', strategy: 'CURVE', orientation: 'BALANCED', lowerBinId: 84, upperBinId: 115, centerBinId: 100, widthBins: 32, lowerOffsetBins: -16, upperOffsetBins: 15, lowerDistancePct: 0, upperDistancePct: 0, capitalFraction: 1, perBinWeights: [{ binId: 84, weight: 1 }], reasonCodes: [] });
const frame = { observedAt: decisionAt, activeBinId: 100, bins: [{ binId: 84, price: '1', amountX: '100000000', amountY: '0', liquiditySupply: '1000000000000000000' }] };

test('V3 selects every decision-relevant category deterministically and deduplicates reason codes', () => {
  const selected = selectReset3cDecisionRelevantCandidates({
    currentSelectedCandidateId: 'selected',
    candidates: [
      { candidateId: 'selected', mechanicallyConstructible: true, currentRank: 1, legacyExpectedNetPnl: .09, canonicalExpectedNetPnl: .01 },
      { candidateId: 'canonical', mechanicallyConstructible: true, currentRank: 2, legacyExpectedNetPnl: -.05, canonicalExpectedNetPnl: .12 },
      { candidateId: 'legacy-disagree', mechanicallyConstructible: true, currentRank: 3, legacyExpectedNetPnl: .08, canonicalExpectedNetPnl: -.08 },
      { candidateId: 'ownership', mechanicallyConstructible: true, currentPolicyStatus: 'OWNERSHIP_LIMIT', currentRank: 4, legacyExpectedNetPnl: .03, canonicalExpectedNetPnl: .07 },
      { candidateId: 'ordinary', mechanicallyConstructible: true, currentRank: 5, legacyExpectedNetPnl: -.01, canonicalExpectedNetPnl: -.01 },
      ...Array.from({ length: 25 }, (_, index) => ({ candidateId: `ordinary-${index}`, mechanicallyConstructible: true, currentRank: index + 6, legacyExpectedNetPnl: -.02, canonicalExpectedNetPnl: -.02 })),
    ],
  });
  assert.equal(selected.samplingContractVersion, RESET3C_VALIDATION_SAMPLING_CONTRACT_V1);
  assert.equal(selected.categoryWinners.CURRENT_SELECTED, 'selected');
  assert.equal(selected.categoryWinners.TOP_CURRENT_RANK, 'selected');
  assert.equal(selected.categoryWinners.TOP_LEGACY_EXPECTED_NET, 'selected');
  assert.equal(selected.categoryWinners.TOP_CANONICAL_EXPECTED_NET, 'canonical');
  assert.equal(selected.categoryWinners.MAX_LEGACY_POS_CANONICAL_NEG_DISAGREEMENT, 'legacy-disagree');
  assert.equal(selected.categoryWinners.MAX_LEGACY_NEG_CANONICAL_POS_DISAGREEMENT, 'canonical');
  assert.equal(selected.categoryWinners.TOP_CONSTRUCTIBLE_OWNERSHIP_LIMIT, 'ownership');
  assert.deepEqual(selected.detailedCandidates.find(row => row.candidateId === 'selected')?.reasonCodes, ['CURRENT_SELECTED', 'TOP_CURRENT_RANK', 'TOP_LEGACY_EXPECTED_NET']);
  assert.equal(selected.detailedCandidates.length, 4, 'overlapping categories must produce one detailed candidate');
  assert.equal(selected.detailedCandidates.some(row => row.candidateId.startsWith('ordinary-')), false, 'ordinary census candidates must not receive detailed outcomes');
});

test('V3 NO_TRADE selection remains adjudicable and mechanical winners get a constructible forward fallback', () => {
  const selected = selectReset3cDecisionRelevantCandidates({
    candidates: [
      { candidateId: 'unconstructible-top', mechanicallyConstructible: false, currentRank: 1, legacyExpectedNetPnl: .2, canonicalExpectedNetPnl: null },
      { candidateId: 'constructible-next', mechanicallyConstructible: true, currentRank: 2, legacyExpectedNetPnl: .1, canonicalExpectedNetPnl: .03 },
      { candidateId: 'canonical-top', mechanicallyConstructible: true, currentRank: 3, legacyExpectedNetPnl: -.02, canonicalExpectedNetPnl: .11 },
    ],
  });
  assert.equal(selected.categoryWinners.TOP_CURRENT_RANK, 'unconstructible-top');
  assert.equal(selected.categoryWinners.TOP_LEGACY_EXPECTED_NET, 'unconstructible-top');
  assert.equal(selected.categoryWinners.TOP_CANONICAL_EXPECTED_NET, 'canonical-top');
  assert.ok(selected.detailedCandidates.some(row => row.candidateId === 'constructible-next' && row.reasonCodes.includes('TOP_CURRENT_RANK_FALLBACK_CONSTRUCTIBLE')));
  assert.ok(selected.detailedCandidates.some(row => row.candidateId === 'constructible-next' && row.reasonCodes.includes('TOP_LEGACY_EXPECTED_NET_FALLBACK_CONSTRUCTIBLE')));
});

test('V3 records an unavailable disagreement winner and validates the next constructible disagreement candidate', () => {
  const selected = selectReset3cDecisionRelevantCandidates({
    candidates: [
      { candidateId: 'unavailable-disagreement', mechanicallyConstructible: false, currentRank: 1, legacyExpectedNetPnl: .4, canonicalExpectedNetPnl: -.4 },
      { candidateId: 'constructible-disagreement', mechanicallyConstructible: true, currentRank: 2, legacyExpectedNetPnl: .2, canonicalExpectedNetPnl: -.1 },
    ],
  });
  assert.equal(selected.categoryWinners.MAX_LEGACY_POS_CANONICAL_NEG_DISAGREEMENT, 'unavailable-disagreement');
  assert.ok(selected.detailedCandidates.find(row => row.candidateId === 'constructible-disagreement')?.reasonCodes.includes('MAX_LEGACY_POS_CANONICAL_NEG_DISAGREEMENT_FALLBACK_CONSTRUCTIBLE'));
});

test('V3 temporary shared evidence reconstructs exact candidate inputs before terminal purge and fails closed afterwards', async () => {
  const universe = { capitalLamports: '1000000000', frames: [frame], events: [], costs: { transactionFeeValue: '0.00001' } };
  const frozenDecision = { recommendationId: 'rec-v3', decisionId: 'decision-v3', poolAddress: 'pool', decisionTimestamp: decisionAt, sourceSha: 'a'.repeat(40), buildId: 'b'.repeat(64), policyHash: 'c'.repeat(64), migrationHead: 'M0056_reset3c_decision_relevant_validation.sql', capitalLamports: '1000000000', phase3State: 'NO_TRADE', phase3Outcome: 'NO_TRADE', reasonCodes: [], prediction: {}, evidenceProvenance: {}, marketContext: { observations: [{ at: decisionAt, price: 42 }] }, selectedCandidate: candidate('selected'), selectedCandidateKind: 'TOP_RANKED_COUNTERFACTUAL', wouldAugEraThesisSemanticsHaveCreatedThesis: false, phase4: { result: 'NOT_EVALUATED', readinessScore: null, timingConfidence: null, reasonCodes: [], diagnostics: {} } };
  const { reference, temporarySharedEvidence } = await buildReset3cValidationSharedEvidenceReference({ recommendationId: 'rec-v3', universe, frozenDecision });
  const raw = compactReset3cDecisionRelevantRawContract({ universeManifestHash: 'manifest', expectedCandidateCount: 3, capturedCandidateCount: 3, universeComplete: true, evidenceCutoffAt: decisionAt, frozenDecision, candidate: candidate('selected'), legacyEconomics: { netValue: .01 }, canonicalEconomics: { expectedNetPnlSol: .02 }, mechanicalConstructibility: { mechanicallyConstructible: true, currentPolicyFeasibility: { status: 'OWNERSHIP_LIMIT' } }, rankingFacts: { rank: 1 } }, reference, { samplingContractVersion: RESET3C_VALIDATION_SAMPLING_CONTRACT_V1, detailedSelectionManifestHash: 'd'.repeat(64), detailedValidationReasons: ['TOP_CONSTRUCTIBLE_OWNERSHIP_LIMIT'], outcomeEligible: true });
  const restored = await reconstructReset3cRawContract({ rawContract: raw, temporarySharedEvidence });
  assert.equal(raw.version, RESET3C_STORAGE_CONTRACT_V3);
  assert.equal(raw.frozenDecision.marketContext, undefined);
  assert.deepEqual(temporarySharedEvidence.frozenDecision.marketContext, frozenDecision.marketContext);
  assert.equal(raw.storageRepresentationVersion, 'reset3c-v3-shared-frozen-decision-v2');
  assert.equal(restored.frozenDecision.selectedCandidate.id, 'selected');
  assert.deepEqual(restored.frozenDecision, frozenDecision);
  assert.deepEqual(restored.frames, [frame]);
  assert.deepEqual(restored.events, []);
  // V3 rows captured before the representation split retain frozenDecision
  // inline and must remain readable with their original shared record.
  const old = await buildReset3cValidationSharedEvidenceReference({ recommendationId: 'rec-v3-old', universe });
  const legacyV3 = { ...raw, frozenDecision, sharedEvidenceReference: old.reference };
  const legacyRestored = await reconstructReset3cRawContract({ rawContract: legacyV3, temporarySharedEvidence: old.temporarySharedEvidence });
  assert.deepEqual(legacyRestored.frozenDecision, frozenDecision);
  await assert.rejects(() => reconstructReset3cRawContract({ rawContract: raw }), /LPFORGE_RESET3C_VALIDATION_SHARED_EVIDENCE_PURGED/);
});

test('M0056 retains a compact permanent census, gates purge on terminal outcomes, and leaves old evidence immutable', async () => {
  const [migration, operator, db, learner] = await Promise.all([
    readFile('packages/db/migrations/M0056_reset3c_decision_relevant_validation.sql', 'utf8'),
    readFile('apps/operator/src/main.ts', 'utf8'),
    readFile('packages/db/src/index.ts', 'utf8'),
    readFile('apps/discovery-learning/src/main.ts', 'utf8'),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS research\.reset3c_validation_universes/);
  assert.match(migration, /ACTIVE','TERMINAL_ELIGIBLE','PURGED/);
  assert.match(migration, /temporary_shared_evidence IS NULL/);
  assert.match(migration, /TG_OP='DELETE'/);
  assert.match(migration, /toast\.autovacuum_vacuum_scale_factor=0\.02/);
  assert.doesNotMatch(migration, /(?:DELETE|TRUNCATE|UPDATE)\s+research\.(?:variable_capital_evaluations|candidate_counterfactual_forward_outcomes|shadow_recommendations)/i);
  assert.match(operator, /selectReset3cDecisionRelevantCandidates/);
  assert.match(operator, /outcomeRows=rows/);
  assert.match(operator, /shadowPayloadForPersistence/);
  assert.match(db, /markTerminalEligibleReset3cValidationUniverses/);
  assert.match(db, /purgeTerminalEligibleReset3cValidationEvidence/);
  assert.match(db, /outcomeEligible/);
  assert.match(learner, /deriveForwardMaturationRetryPlan/);
  assert.match(learner, /purgeTerminalEligibleReset3cValidationEvidence/);
  for (const source of [operator, db, learner]) assert.doesNotMatch(source, /rankCandidates\(/);
});
