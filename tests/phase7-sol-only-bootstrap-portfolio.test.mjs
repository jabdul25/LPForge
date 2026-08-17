import assert from 'node:assert/strict';
import test from 'node:test';
import {assessPortfolioValuationCoverage} from '../.build/packages/phase7-production-service/src/index.js';

const facts={deployedLamports:0n,pendingReservedLamports:0n,pendingExecutionCount:0,unresolvedReconciliationDebt:0,poolExposureLamports:{},poolPendingLamports:{},tokenExposureLamports:{},tokenPendingLamports:{}};
const bootstrap=(extra={})=>({walletBalanceLamports:143_945_302n,walletTokenAccountCount:0,positionCount:0,inventoryLotCount:0,...facts,...extra});

test('P7 accepts a positively established native-SOL-only bootstrap portfolio without a WSOL price',()=>{
  assert.deepEqual(assessPortfolioValuationCoverage(bootstrap()),{mode:'SOL_ONLY_BOOTSTRAP',requiresSolPrice:false});
});
test('P7 bootstrap retains the native wallet balance for lamport-denominated reserve governance',()=>{
  const coverage=assessPortfolioValuationCoverage(bootstrap());
  assert.equal(coverage.requiresSolPrice,false);
  assert.equal(bootstrap().walletBalanceLamports-10_000_000n,133_945_302n);
});
test('P7 fails closed without a price when an SPL token account exists',()=>{
  assert.throws(()=>assessPortfolioValuationCoverage(bootstrap({walletTokenAccountCount:1})),/P7_PORTFOLIO_INVENTORY_VALUATION_MISSING/);
});
test('P7 fails closed without a price when an LP position exists',()=>{
  assert.throws(()=>assessPortfolioValuationCoverage(bootstrap({positionCount:1,deployedLamports:1n})),/P7_PORTFOLIO_INVENTORY_VALUATION_MISSING/);
});
test('P7 fails closed without a price when attributable inventory remains',()=>{
  assert.throws(()=>assessPortfolioValuationCoverage(bootstrap({inventoryLotCount:1,tokenExposureLamports:{mint:1n}})),/P7_PORTFOLIO_INVENTORY_VALUATION_MISSING/);
});
test('P7 fails closed when the native wallet fact is unavailable',()=>{
  assert.throws(()=>assessPortfolioValuationCoverage(bootstrap({walletBalanceLamports:undefined})),/P7_PORTFOLIO_WALLET_FACTS_UNAVAILABLE/);
});
