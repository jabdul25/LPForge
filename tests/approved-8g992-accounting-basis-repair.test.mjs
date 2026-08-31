import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { TARGET, assertTarget } from '../scripts/approved-8g992-accounting-basis-repair.mjs';

test('8G992 repair is a one-position exact append-only allowlist', () => {
  assertTarget(TARGET);
  assert.equal(TARGET.positionAddress, '8G992HY1y4YBGxcHkL9DNXVKLAp7xk1AnD5ae9DwbjsQ');
  assert.equal(TARGET.configuredCapitalLamports - TARGET.actualFundedCapitalLamports, 5n);
  assert.equal(TARGET.expectedLatestNet + TARGET.removeNativeLamports - TARGET.basisAdjustmentLamports, TARGET.expectedV3Net);
  assert.equal(TARGET.expectedV3Net, -32_525n);
});

test('8G992 repair is execution-gated and preserves immutable prior settlements', () => {
  const source = fs.readFileSync('scripts/approved-8g992-accounting-basis-repair.mjs', 'utf8');
  assert.match(source, /LPFORGE_APPROVED_8G992_REPAIR_EXECUTE/);
  assert.match(source, /INSERT INTO execution\.position_cashflows/);
  assert.match(source, /INSERT INTO execution\.lifecycle_sol_settlements/);
  assert.match(source, /settlement_version,position_address/);
  assert.match(source, /ENTRY_BASIS_ROUNDING_CORRECTION/);
  assert.doesNotMatch(source, /UPDATE execution\.lifecycle_sol_settlements/);
  assert.doesNotMatch(source, /DELETE FROM execution\./);
  assert.doesNotMatch(source, /WHERE l\.status\s*=\s*'SOL_SETTLED'/);
});
