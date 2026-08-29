import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { createPostgresStore } from '../.build/packages/db/src/index.js';
import { buildReset3cSharedEvidenceReference, compactReset3cRawContract } from '../.build/packages/phase3-forward-validation/src/index.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL required');
const parsed = new URL(connectionString);
if (parsed.pathname !== '/lpforge_m0053_compaction_verify') throw new Error('LPFORGE_RESET3C_STORAGE_VERIFY_DATABASE_REQUIRED');
const hash = value => createHash('sha256').update(value).digest('hex');
const stamp = '2026-08-28T00:00:00.000Z';
const candidate = { id: 'candidate-storage-v2', strategy: 'CURVE', orientation: 'BALANCED', lowerBinId: 84, upperBinId: 115, centerBinId: 100, perBinWeights: Array.from({ length: 32 }, (_, index) => ({ binId: 84 + index, weight: 1 / 32 })) };
const frame = minute => ({ observedAt: new Date(Date.parse(stamp) + minute * 60_000).toISOString(), activeBinId: 100, bins: Array.from({ length: 32 }, (_, index) => ({ binId: 84 + index, price: '1', amountX: '100000000', amountY: '0', liquiditySupply: '1000000000000000000' })) });
const shared = { candidateUniverseEvidence: { version: 'reset3c-universe-v1', capitalLamports: '1000000000', frames: Array.from({ length: 120 }, (_, minute) => frame(minute)), events: [{ signature: 'storage-event', eventIndex: 0, stamp: { observedAt: stamp } }], costs: { transactionFeeValue: '0.00001' }, candidates: [candidate], simulations: [], ranking: { winner: candidate.id, rankings: [] }, qualification: { verdict: 'QUALIFIED', globalAdjustmentWeight: .5 }, economics: { expectedNetLpValue: .001 } } };
const policy = { status: 'OWNERSHIP_LIMIT', bindingConstraint: 'OWNERSHIP_CAP', proposedCapitalLamports: '1000000000', allocatedCapitalLamports: '1000000000', ownershipProfile: { resultingOwnershipBps: 900 }, canonicalPosition: { lowerBinId: 84, upperBinId: 115 }, perBinSupport: [{ binId: 84, ownershipBps: 900 }] };
const mechanical = { mechanicallyConstructible: true, allocatedCapitalLamports: '1000000000', capitalUtilizationBps: 10000, maxOwnershipBps: 900, canonicalPosition: policy.canonicalPosition, ownershipProfile: policy.ownershipProfile, currentPolicyFeasibility: policy };
function rawV1(recommendationId, candidateId = candidate.id) { return { version: 'reset3c-universe-v1', universeManifestHash: hash(`manifest:${recommendationId}`), expectedCandidateCount: 2, capturedCandidateCount: 2, universeComplete: true, evidenceCutoffAt: stamp, frozenDecision: { recommendationId, decisionId: `decision:${recommendationId}`, poolAddress: 'pool-storage', decisionTimestamp: stamp, capitalLamports: '1000000000', selectedCandidate: { ...candidate, id: candidateId } }, frames: shared.candidateUniverseEvidence.frames, events: shared.candidateUniverseEvidence.events, candidate: { ...candidate, id: candidateId }, legacyEconomics: { candidateId, feeValue: .001, inventoryChangeValue: -.0002, totalCostValue: .0001, netValue: .0007 }, canonicalEconomics: { userSelectedCapitalLamports: '1000000000', allocatedCapitalLamports: '1000000000', expectedFeePnlSol: .001, expectedInventoryEffectSol: -.0002, expectedCostsSol: .0001, expectedNetPnlSol: .0007, expectedNetReturnBps: 7 }, mechanicalConstructibility: mechanical, currentPolicy: policy, rankingFacts: { candidateId, rank: 2, utility: .7 }, qualificationFacts: shared.candidateUniverseEvidence.qualification, globalEconomics: shared.candidateUniverseEvidence.economics }; }
async function main() {
  const db = new Client({ connectionString });
  await db.connect();
  try {
    await db.query("insert into protocol.tokens(mint,decimals) values('token-storage-x',9),('token-storage-y',9) on conflict do nothing");
    await db.query("insert into protocol.pools(address,token_x_mint,token_y_mint,bin_step) values('pool-storage','token-storage-x','token-storage-y',1) on conflict do nothing");
    for (const recommendationId of ['storage-v1', 'storage-v2']) await db.query("insert into research.shadow_recommendations(recommendation_id,pool_address,decision_at,expires_at,state,no_trade,market_context_hash,candidate_count,ranking,economics,reason_codes,payload) values($1,'pool-storage',$2::timestamptz,$2::timestamptz + interval '5 minutes','NO_TRADE',true,'storage-context',2,'{}'::jsonb,'{}'::jsonb,'[]'::jsonb,$3::jsonb) on conflict do nothing", [recommendationId, stamp, JSON.stringify(shared)]);
    const store = await createPostgresStore(connectionString);
    try {
      const v1 = rawV1('storage-v1', 'candidate-storage-v1');
      const reference = await buildReset3cSharedEvidenceReference({ recommendationId: 'storage-v2', shadowRecommendationPayload: shared });
      const v2 = compactReset3cRawContract(rawV1('storage-v2'), reference);
      const common = { proposedCapitalLamports: '1000000000', allocatedCapitalLamports: '1000000000', capitalContractHash: hash('capital'), positionContractHash: hash('position'), capitalFeasibilityStatus: 'OWNERSHIP_LIMIT', bindingConstraint: 'OWNERSHIP_CAP', sourceSha: 'a'.repeat(40), buildId: 'b'.repeat(64), policyHash: 'c'.repeat(64), migrationHead: 'M0055_reset3c_shared_shadow_evidence_immutability.sql', evidenceManifestHash: hash('manifest') , provenance: { authority: 'RESEARCH_ONLY_NO_POLICY_MUTATION' } };
      const insertV1 = { capitalEvaluationId: 'storage-evaluation-v1', recommendationId: 'storage-v1', decisionId: 'decision:storage-v1', candidateId: 'candidate-storage-v1', ...common, rawContract: v1, contentHash: hash(JSON.stringify(v1)) };
      const insertV2 = { capitalEvaluationId: 'storage-evaluation-v2', recommendationId: 'storage-v2', decisionId: 'decision:storage-v2', candidateId: 'candidate-storage-v2', ...common, rawContract: v2, contentHash: hash(JSON.stringify(v2)) };
      assert.equal(await store.insertVariableCapitalEvaluation(insertV1), 'INSERTED');
      assert.equal(await store.insertVariableCapitalEvaluation(insertV2), 'INSERTED');
      assert.equal(await store.insertVariableCapitalEvaluation(insertV2), 'IDEMPOTENT');
      await assert.rejects(() => store.insertVariableCapitalEvaluation({ ...insertV2, contentHash: hash('conflict') }), /LPFORGE_VARIABLE_CAPITAL_EVIDENCE_CONFLICT/);
      const due = await store.loadDueCandidateCounterfactualOutcomes('2026-08-29T00:00:00.000Z', 200);
      const v2Due = due.filter(row => row.capitalEvaluationId === 'storage-evaluation-v2');
      assert.equal(v2Due.length, 3);
      assert.deepEqual(v2Due.map(row => row.horizonMinutes).sort((a, b) => a - b), [30, 60, 120]);
      assert.ok(v2Due.every(row => row.rawContract.frames.length === 120 && row.rawContract.currentPolicy.status === 'OWNERSHIP_LIMIT'));
      const sizes = await db.query("select capital_evaluation_id,pg_column_size(raw_contract)::bigint bytes,evaluation_schema_version from research.variable_capital_evaluations where capital_evaluation_id in ('storage-evaluation-v1','storage-evaluation-v2') order by capital_evaluation_id");
      const bytes = Object.fromEntries(sizes.rows.map(row => [row.capital_evaluation_id, Number(row.bytes)]));
      assert.equal(sizes.rows[1].evaluation_schema_version, 'reset3c-universe-v2-compact');
      assert.ok(bytes['storage-evaluation-v2'] < bytes['storage-evaluation-v1'] * .4);
      const finalized = { capitalEvaluationId: 'storage-evaluation-v2', horizonMinutes: 30, outcomeModelVersion: 'phase3-forward-outcome-v2', state: 'FINAL', resultHash: hash('result'), reasonCodes: [], realized: { realizedFeeValue: .001, realizedInventoryPnl: -.0002, realizedTotalCost: .0001, realizedNetValue: .0007 }, payload: { namespace: 'COUNTERFACTUAL_CANONICAL' }, attemptedAt: '2026-08-29T00:30:00.000Z', retryCount: 1, terminalAt: '2026-08-29T00:30:00.000Z' };
      assert.equal(await store.persistCandidateCounterfactualOutcome(finalized), 'APPLIED');
      assert.equal(await store.persistCandidateCounterfactualOutcome(finalized), 'IDEMPOTENT');
      await assert.rejects(() => store.persistCandidateCounterfactualOutcome({ ...finalized, resultHash: hash('conflicting-result') }), /LPFORGE_COUNTERFACTUAL_OUTCOME_CONFLICT/);
      await assert.rejects(() => db.query("update research.shadow_recommendations set state='ENTRY_READY' where recommendation_id='storage-v2'"), /append-only/);
      console.log(JSON.stringify({ status: 'PASS', rows: 2, queueRows: 6, v1RawBytes: bytes['storage-evaluation-v1'], v2RawBytes: bytes['storage-evaluation-v2'], reductionPct: Number(((1 - bytes['storage-evaluation-v2'] / bytes['storage-evaluation-v1']) * 100).toFixed(2)) }));
    } finally { await store.close(); }
  } finally { await db.end(); }
}
await main();
