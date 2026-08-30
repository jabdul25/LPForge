import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration=await readFile(new URL('../packages/db/migrations/M0062_candidate_universe_rerank_retention.sql',import.meta.url),'utf8');
const coverageMigration=await readFile(new URL('../packages/db/migrations/M0064_full_universe_forward_outcome_coverage.sql',import.meta.url),'utf8');
const db=await readFile(new URL('../packages/db/src/index.ts',import.meta.url),'utf8');
const operator=await readFile(new URL('../apps/operator/src/main.ts',import.meta.url),'utf8');
const learning=await readFile(new URL('../apps/discovery-learning/src/main.ts',import.meta.url),'utf8');

test('M0062 retains a complete immutable full candidate universe without market frames',()=>{
 assert.match(migration,/persisted_candidate_count=expected_candidate_count/);
 assert.match(migration,/jsonb_array_length\(candidate_facts->'candidates'\)=expected_candidate_count/);
 assert.match(migration,/candidate universe rerank permanent evidence is immutable/);
 assert.doesNotMatch(migration,/swap_events|bin_snapshots|temporary_shared_evidence/);
 assert.match(operator,/candidates:universe\.candidates,simulations:universe\.simulations,rankings:universe\.ranking\.rankings/);
});

test('M0062 is idempotent, versioned, and compacts only after mature outcomes',()=>{
 assert.match(db,/LPFORGE_CANDIDATE_UNIVERSE_RERANK_RETENTION_CONFLICT/);
 assert.match(db,/horizon_minutes IN \(30,60,120\)/);
 assert.match(db,/candidate_facts=NULL/);
 assert.match(operator,/LPFORGE_CANDIDATE_UNIVERSE_RETENTION_HOURS/);
 assert.match(operator,/feeEvidenceCalibration/);
  assert.match(learning,/compactEligibleCandidateUniverseRerankRetention/);
});

test('full-universe canonical coverage is bounded, oldest-first, and protects M0062 facts until every candidate horizon is terminal',()=>{
 assert.match(coverageMigration,/candidate_universe_forward_outcome_coverage/);
 assert.match(coverageMigration,/terminal_candidate_count/);
 assert.match(db,/loadFullUniverseOutcomeCoverageBackfill/);
 assert.match(db,/FULL_UNIVERSE_RERANK_COVERAGE/);
 assert.match(db,/terminal_candidate_count=c\.expected_candidate_count/);
 assert.match(learning,/backfillFullUniverseForwardOutcomeContracts/);
 assert.match(learning,/verifiedResearchArtifact/);
 assert.match(learning,/frozenDecisionSourceSha/);
 assert.match(learning,/LPFORGE_FULL_UNIVERSE_BACKFILL_MAX_CANDIDATES/);
 assert.match(learning,/LPFORGE_FULL_UNIVERSE_COUNTERFACTUAL_MAX_BATCH/);
 assert.match(learning,/rawContract\._queueRecommendationId/);
 assert.match(learning,/loadStaleCandidateUniverseForwardOutcomeCoverage/);
 assert.match(db,/_queueRecommendationId:String\(row\.recommendation_id\)/);
 assert.match(db,/terminal_candidate_count<>expected\.terminal_candidate_count/);
 assert.match(learning,/outcomeCreatedAt:universe\.decisionAt/);
 assert.match(db,/COALESCE\(\$3::timestamptz,now\(\)\)/);
 assert.match(operator,/const detailedRows=rows,outcomeRows=rows/);
});

test('retention capture cannot alter fee-evidence-calibration-v1 production economics',async()=>{
 const calibration=await readFile(new URL('../packages/fee-evidence-calibration/src/index.ts',import.meta.url),'utf8');
 assert.match(calibration,/fee-evidence-calibration-v1/);
 assert.match(calibration,/0\.46130841877268086/);
 assert.match(calibration,/-0\.0968457048995752/);
});
