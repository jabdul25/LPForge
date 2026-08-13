import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Phase 5 Devnet lifecycle funds a new receiver at the chain rent-exempt minimum',()=>{
  const source=fs.readFileSync(new URL('../apps/devnet/src/main.ts', import.meta.url),'utf8');
  assert.match(source,/getMinimumBalanceForRentExemption\(0,'confirmed'\)/);
  assert.match(source,/validationTransferLamports=Math\.max\(1,receiverRentExemptLamports\)/);
  assert.doesNotMatch(source,/lamports:1\}\)\)/);
});
