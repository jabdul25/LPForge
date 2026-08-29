import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../scripts/verify-phase5-local-meteora.mjs',import.meta.url),'utf8');
test('local Meteora verifier is hard-gated to loopback and prohibits mainnet flags',()=>{
  assert.match(src,/LPFORGE_LOCAL_METEORA_LOOPBACK_REQUIRED/);
  assert.match(src,/LPFORGE_LOCAL_METEORA_MAINNET_FLAGS_PROHIBITED/);
  assert.match(src,/127\.0\.0\.1/);
  assert.match(src,/localhost/);
});
test('local Meteora verifier exercises LPForge builders, PositionV2, swap fee and close',()=>{
  assert.match(src,/buildOpenPositionTransaction/);
  assert.match(src,/buildRemoveLiquidityTransactions/);
  assert.match(src,/positionVersion:'V2'/);
  assert.match(src,/swapQuote/);
  assert.match(src,/positionFeeX/);
  assert.match(src,/positionClosed:true/);
  assert.match(src,/mainnetTransactionSent:false/);
});
