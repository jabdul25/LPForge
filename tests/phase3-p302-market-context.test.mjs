import test from 'node:test';import assert from 'node:assert/strict';import { buildMarketContext } from '../.build/packages/market-context/src/index.js';
const start=Date.parse('2026-08-12T10:00:00Z');
const rows=Array.from({length:61},(_,i)=>({observedAt:new Date(start+i*60000).toISOString(),price:100+i*.1,activeBinId:100+i%8,volume:10+i,feeValue:.01,twoWayRatio:.5,localLiquidity:1000+i*2}));
test('P3-02 builds deterministic multi-horizon context without future data',async()=>{const decision=rows.at(-1).observedAt;const a=await buildMarketContext('pool',decision,rows),b=await buildMarketContext('pool',decision,rows);assert.equal(a.hash,b.hash);assert.equal(a.horizons['5m'].samples,6);assert.equal(a.horizons['1h'].samples,61);assert.ok(a.horizons['1h'].returnPct>0);assert.ok(a.horizons['1h'].completeness>0.9);});
test('P3-02 rejects lookahead observations',async()=>{await assert.rejects(()=>buildMarketContext('pool',rows[10].observedAt,rows),/LPFORGE_LOOKAHEAD/);});
