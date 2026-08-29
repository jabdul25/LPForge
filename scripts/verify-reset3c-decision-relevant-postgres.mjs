import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { createPostgresStore } from '../.build/packages/db/src/index.js';
import { buildReset3cValidationSharedEvidenceReference, compactReset3cDecisionRelevantRawContract } from '../.build/packages/phase3-forward-validation/src/index.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL required');
const parsed = new URL(connectionString);
if (parsed.pathname !== '/lpforge_reset3c_v3_verify') throw new Error('LPFORGE_RESET3C_V3_VERIFY_DATABASE_REQUIRED');
const hash = value => createHash('sha256').update(value).digest('hex');
const at = '2026-08-28T00:00:00.000Z';
const recommendationId = 'reset3c-v3-db-proof';

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("insert into protocol.tokens(mint,decimals) values('reset3c-v3-x',9),('reset3c-v3-y',9) on conflict do nothing");
    await client.query("insert into protocol.pools(address,token_x_mint,token_y_mint,bin_step) values('reset3c-v3-pool','reset3c-v3-x','reset3c-v3-y',20) on conflict do nothing");
    await client.query("insert into research.shadow_recommendations(recommendation_id,pool_address,decision_at,expires_at,state,no_trade,market_context_hash,candidate_count,ranking,economics,reason_codes,payload) values($1,'reset3c-v3-pool',$2::timestamptz,$2::timestamptz + interval '5 minutes','NO_TRADE',true,$3,2,'{}'::jsonb,'{}'::jsonb,'[]'::jsonb,'{}'::jsonb) on conflict do nothing", [recommendationId, at, hash('context')]);
    const universeRaw = { capitalLamports: '1000000000', frames: [{ observedAt: at, activeBinId: 100, bins: [] }], events: [], costs: {} };
    const candidate = { id: 'reset3c-v3-candidate', strategy: 'SPOT', orientation: 'ONE_SIDED_Y', lowerBinId: 99, upperBinId: 101, centerBinId: 100, perBinWeights: [{ binId: 100, weight: 1 }] };
    const frozenDecision = { recommendationId, decisionId: 'reset3c-v3-decision', poolAddress: 'reset3c-v3-pool', decisionTimestamp: at, capitalLamports: '1000000000', selectedCandidate: candidate, prediction: {}, phase4: {}, reasonCodes: [], marketContext: { observations: [{ at, price: 1 }] } };
    const { reference, temporarySharedEvidence } = await buildReset3cValidationSharedEvidenceReference({ recommendationId, universe: universeRaw, frozenDecision });
    const store = await createPostgresStore(connectionString);
    try {
      const universe = { recommendationId, decisionId: 'reset3c-v3-decision', decisionAt: at, samplingContractVersion: 'reset3c-validation-sampling-v1', storageContractVersion: 'reset3c-universe-v3-decision-relevant', capitalLamports: '1000000000', expectedCandidateCount: 2, capturedCandidateCount: 2, universeComplete: true, universeManifestHash: hash('universe'), detailedCandidateCount: 1, outcomeEligibleCandidateCount: 1, detailedCandidateIds: ['reset3c-v3-candidate'], selectionManifest: { detailedCandidates: [{ candidateId: 'reset3c-v3-candidate', reasonCodes: ['TOP_CANONICAL_EXPECTED_NET'] }] }, detailedSelectionManifestHash: hash('selection'), census: { candidates: [{ candidateId: 'reset3c-v3-candidate', detailedValidationSelected: true }, { candidateId: 'omitted', detailedValidationSelected: false }] }, sharedEvidenceHash: reference.sharedEvidenceHash, temporarySharedEvidence, contentHash: hash('content') };
      assert.equal(await store.insertReset3cValidationUniverse(universe), 'INSERTED');
      assert.equal(await store.insertReset3cValidationUniverse(universe), 'IDEMPOTENT');
      const rawContract = compactReset3cDecisionRelevantRawContract({ universeManifestHash: hash('manifest'), expectedCandidateCount: 2, capturedCandidateCount: 2, universeComplete: true, evidenceCutoffAt: at, frozenDecision, candidate, legacyEconomics: { netValue: .01 }, canonicalEconomics: { expectedNetPnlSol: .02 }, mechanicalConstructibility: { mechanicallyConstructible: true }, rankingFacts: { rank: 1 } }, reference, { samplingContractVersion: 'reset3c-validation-sampling-v1', detailedSelectionManifestHash: hash('selection'), detailedValidationReasons: ['TOP_CANONICAL_EXPECTED_NET'], outcomeEligible: true });
      const evaluation = { capitalEvaluationId: 'reset3c-v3-evaluation', recommendationId, decisionId: 'reset3c-v3-decision', candidateId: 'reset3c-v3-candidate', proposedCapitalLamports: '1000000000', capitalContractHash: hash('capital'), positionContractHash: hash('position'), capitalFeasibilityStatus: 'OWNERSHIP_LIMIT', bindingConstraint: 'OWNERSHIP_CAP', sourceSha: 'a'.repeat(40), buildId: 'b'.repeat(64), policyHash: 'c'.repeat(64), migrationHead: 'M0056_reset3c_decision_relevant_validation.sql', evidenceManifestHash: hash('manifest'), provenance: { authority: 'RESEARCH_ONLY_NO_POLICY_MUTATION' }, rawContract, contentHash: hash('evaluation') };
      assert.equal(await store.insertVariableCapitalEvaluation(evaluation), 'INSERTED');
      const omittedRecommendationId = 'reset3c-v3-omitted-proof';
      await client.query("insert into research.shadow_recommendations(recommendation_id,pool_address,decision_at,expires_at,state,no_trade,market_context_hash,candidate_count,ranking,economics,reason_codes,payload) values($1,'reset3c-v3-pool',$2::timestamptz,$2::timestamptz + interval '5 minutes','NO_TRADE',true,$3,2,'{}'::jsonb,'{}'::jsonb,'[]'::jsonb,'{}'::jsonb)", [omittedRecommendationId, at, hash('omitted-context')]);
      const omitted = { ...evaluation, capitalEvaluationId: 'reset3c-v3-omitted-evaluation', recommendationId: omittedRecommendationId, decisionId: 'reset3c-v3-omitted-decision', candidateId: 'omitted-candidate', rawContract: { ...rawContract, outcomeEligible: false, candidate: { ...candidate, id: 'omitted-candidate' } }, contentHash: hash('omitted-evaluation') };
      assert.equal(await store.insertVariableCapitalEvaluation(omitted), 'INSERTED');
      const omittedQueue = await client.query('select count(*)::int AS n from research.candidate_counterfactual_forward_outcomes where capital_evaluation_id=$1', [omitted.capitalEvaluationId]);
      assert.equal(omittedQueue.rows[0]?.n, 0, 'ordinary census-only candidates must not receive M0054 rows');
      const due = await store.loadDueCandidateCounterfactualOutcomes('2026-08-28T03:00:00.000Z', 200);
      assert.deepEqual(due.filter(row => row.capitalEvaluationId === evaluation.capitalEvaluationId).map(row => row.horizonMinutes).sort((a, b) => a - b), [30, 60, 120]);
      assert.deepEqual(due.find(row => row.capitalEvaluationId === evaluation.capitalEvaluationId)?.rawContract.frozenDecision, frozenDecision);
      for (const horizonMinutes of [30, 60, 120]) await store.persistCandidateCounterfactualOutcome({ capitalEvaluationId: evaluation.capitalEvaluationId, horizonMinutes, outcomeModelVersion: 'phase3-forward-outcome-v2', state: 'FINAL', resultHash: hash(`result:${horizonMinutes}`), reasonCodes: [], realized: { realizedFeeValue: .001, realizedInventoryPnl: -.0002, realizedTotalCost: .0001, realizedNetValue: .0007 }, payload: { namespace: 'COUNTERFACTUAL_CANONICAL' }, attemptedAt: '2026-08-28T03:00:00.000Z', retryCount: 0, terminalAt: '2026-08-28T03:00:00.000Z' });
      assert.equal(await store.markTerminalEligibleReset3cValidationUniverses('2026-08-28T03:01:00.000Z', 50), 1);
      assert.equal(await store.purgeTerminalEligibleReset3cValidationEvidence('2026-08-28T03:02:00.000Z', 50), 1);
      const after = await store.loadReset3cValidationUniverse(recommendationId);
      assert.equal(after?.lifecycle_state, 'PURGED');
      assert.equal(after?.temporary_shared_evidence, null);
      await assert.rejects(
        () => client.query('delete from research.reset3c_validation_universes where recommendation_id=$1', [recommendationId]),
        /reset3c validation universe deletion is prohibited/,
      );
      console.log(JSON.stringify({ status: 'PASS', fullCensusCandidates: 2, detailedCandidates: 1, m0054Rows: 3, terminalPurge: true }));
    } finally { await store.close(); }
  } finally { await client.end(); }
}

await main();
