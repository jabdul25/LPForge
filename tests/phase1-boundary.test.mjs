import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Phase 1 env forbids signer material and defaults live signing off', async () => {
  const env = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(env, /^LIVE_SIGNING=false$/m);
  for (const forbidden of ['PRIVATE_KEY=', 'SEED_PHRASE=', 'WALLET_SECRET=']) {
    assert.equal(env.includes(forbidden), false, `forbidden key present: ${forbidden}`);
  }
});

test('Phase 1 config source rejects enabling live signing', async () => {
  const src = await readFile(new URL('../packages/config/src/index.ts', import.meta.url), 'utf8');
  assert.match(src, /LPFORGE_PHASE1_LIVE_SIGNING_PROHIBITED/);
});
