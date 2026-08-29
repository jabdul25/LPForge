import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('packages/db/src/index.ts', 'utf8');
const method = name => {
  const start = source.indexOf(`async ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = source.indexOf('\n    async ', start + 1);
  return source.slice(start, end === -1 ? undefined : end);
};

const selectEligible = (rows, limit) => rows
  .filter(row => row.lifecycleState === 'ACTIVE' && row.eligible)
  .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.recommendationId.localeCompare(right.recommendationId))
  .slice(0, limit)
  .map(row => row.recommendationId);

test('M0056 selects terminal-eligible universes before applying its bounded batch', () => {
  const mark = method('markTerminalEligibleReset3cValidationUniverses');
  assert.doesNotMatch(mark, /WITH due AS \(SELECT recommendation_id FROM research\.reset3c_validation_universes WHERE lifecycle_state='ACTIVE'[\s\S]*?LIMIT \$2\), eligible/i);
  assert.match(mark, /WITH eligible AS \(SELECT u\.recommendation_id FROM research\.reset3c_validation_universes u WHERE u\.lifecycle_state='ACTIVE'[\s\S]*?ORDER BY u\.created_at,u\.recommendation_id LIMIT \$2\)/);
  const rows = [
    { recommendationId: 'A', createdAt: '2026-08-28T00:00:00.000Z', lifecycleState: 'ACTIVE', eligible: false },
    { recommendationId: 'B', createdAt: '2026-08-28T00:01:00.000Z', lifecycleState: 'ACTIVE', eligible: false },
    { recommendationId: 'C', createdAt: '2026-08-28T00:02:00.000Z', lifecycleState: 'ACTIVE', eligible: true },
    { recommendationId: 'D', createdAt: '2026-08-28T00:03:00.000Z', lifecycleState: 'ACTIVE', eligible: true },
  ];
  assert.deepEqual(selectEligible(rows, 2), ['C', 'D']);
});

test('M0056 bounded selection passes a leading noneligible set without an unbounded batch', () => {
  const rows = [
    ...Array.from({ length: 20 }, (_, index) => ({ recommendationId: `blocked-${index}`, createdAt: `2026-08-27T${String(index).padStart(2, '0')}:00:00.000Z`, lifecycleState: 'ACTIVE', eligible: false })),
    ...Array.from({ length: 5 }, (_, index) => ({ recommendationId: `eligible-${index}`, createdAt: `2026-08-28T01:00:0${index}.000Z`, lifecycleState: 'ACTIVE', eligible: true })),
  ];
  assert.deepEqual(selectEligible(rows, 3), ['eligible-0', 'eligible-1', 'eligible-2']);
  assert.equal(selectEligible(rows, 3).length, 3);
});

test('M0056 keeps pending, missing-hash, and integrity-conflicted outcomes fail closed', () => {
  const mark = method('markTerminalEligibleReset3cValidationUniverses');
  const purge = method('purgeTerminalEligibleReset3cValidationEvidence');
  for (const sql of [mark, purge]) {
    assert.match(sql, /o\.result_hash IS NULL/);
    assert.match(sql, /o\.state='FINAL' OR \(o\.state='INSUFFICIENT_EVIDENCE' AND o\.terminal_at IS NOT NULL\)/);
    assert.doesNotMatch(sql, /FAILED_DATA_INTEGRITY' OR/);
  }
  assert.match(mark, /jsonb_array_elements_text\(u\.detailed_candidate_ids\)/);
  assert.match(purge, /u\.temporary_shared_evidence IS NOT NULL/);
});

test('M0056 purge rechecks eligibility and only clears temporary reconstruction evidence', () => {
  const purge = method('purgeTerminalEligibleReset3cValidationEvidence');
  assert.match(purge, /WHERE u\.lifecycle_state='TERMINAL_ELIGIBLE'[\s\S]*?ORDER BY u\.terminal_eligible_at,u\.recommendation_id LIMIT \$2/);
  assert.match(purge, /SET lifecycle_state='PURGED',temporary_shared_evidence=NULL,purged_at=\$1::timestamptz/);
  assert.doesNotMatch(purge, /DELETE\s+FROM/i);
  assert.doesNotMatch(purge, /UPDATE\s+research\.(?:variable_capital_evaluations|candidate_counterfactual_forward_outcomes)/i);
});
