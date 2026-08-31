import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { REPAIR_TARGETS, approvedRepairCashflowId, assertExplicitAllowlist } from '../scripts/approved-historical-settlement-append-only-repair.mjs';

test('historical repair is a fixed three-position allowlist with exact approved net deltas', () => {
  assertExplicitAllowlist(REPAIR_TARGETS);
  assert.deepEqual(REPAIR_TARGETS.map((target) => target.key), ['BhhRQ', 'DrbJX', 'F3V7UH']);
  assert.deepEqual(REPAIR_TARGETS.map((target) => target.expectedV2Net), [320_468n, -406_220n, -115_822n]);
  assert.equal(REPAIR_TARGETS[2].effects.reduce((total, effect) => total + effect.lamports, 0n), 84_571_585n);
});

test('repair idempotency is signature-and-effect-bound and rejects duplicate keys', () => {
  const target = REPAIR_TARGETS[0], effect = target.effects[0];
  const id = approvedRepairCashflowId(`lifecycle:${target.positionAddress}`, effect);
  assert.match(id, /historical-chain-reconciliation:/);
  assert.match(id, new RegExp(effect.signature));
  assert.match(id, /TERMINAL_FEE_CLAIM/);
  assert.throws(() => assertExplicitAllowlist([...REPAIR_TARGETS, target]), /ALLOWLIST_COUNT_INVALID/);
});

test('repair utility is operator-gated, append-only, and cannot select settled rows dynamically', () => {
  const source = fs.readFileSync('scripts/approved-historical-settlement-append-only-repair.mjs', 'utf8');
  assert.match(source, /LPFORGE_APPROVED_HISTORICAL_REPAIR_EXECUTE/);
  assert.match(source, /INSERT INTO execution\.position_cashflows/);
  assert.match(source, /INSERT INTO execution\.lifecycle_sol_settlements/);
  assert.match(source, /Historical SOL_SETTLED rows intentionally retain owned_positions evidence/);
  assert.match(source, /raw JSON RPC/);
  assert.match(source, /SKIPPED_NO_EFFECT/);
  assert.match(source, /externalReconciliationInput/);
  assert.doesNotMatch(source, /UPDATE execution\.lifecycle_sol_settlements/);
  assert.doesNotMatch(source, /DELETE FROM execution\./);
  assert.doesNotMatch(source, /WHERE l\.status\s*=\s*'SOL_SETTLED'/);
});
