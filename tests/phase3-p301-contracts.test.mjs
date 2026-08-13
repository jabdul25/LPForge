import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('P3-01 contracts define recommendation-only Phase 3 boundary', async () => {
  const contracts = await readFile(new URL('../packages/contracts/src/index.ts', import.meta.url),'utf8');
  const policy = await readFile(new URL('../packages/policy/src/index.ts', import.meta.url),'utf8');
  const config = await readFile(new URL('../packages/config/src/index.ts', import.meta.url),'utf8');
  for (const label of ['SIDEWAYS','CONTROLLED_PULLBACK','BREAKOUT_CONTROLLED_PULLBACK','FREEFALL','TRANSITION','UNKNOWN']) assert.match(contracts,new RegExp(label));
  assert.match(contracts,/recommendationOnly: true/);
  assert.match(policy,/strategyExecutionEnabled: false/);
  assert.match(policy,/transactionBuildEnabled: false/);
  assert.match(config,/automatic_entry/);
  assert.match(config,/shadow_recommendations/);
});
