import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('insertBins conflict target matches protocol.bin_snapshots primary key', async () => {
  const source = await readFile(new URL('../packages/db/src/index.ts', import.meta.url), 'utf8');
  assert.match(source, /ON CONFLICT\(pool_address,bin_id,observed_at\) DO NOTHING/);
  assert.doesNotMatch(source, /ON CONFLICT\(pool_address,bin_id,chain_slot,observed_at\) DO NOTHING/);
});
