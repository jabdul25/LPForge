import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketContext } from '../.build/packages/market-context/src/index.js';
import { computeStructureFeatures } from '../.build/packages/structure-features/src/index.js';
import { classifyRegime } from '../.build/packages/regime/src/index.js';

async function assess(prices){const start=Date.parse('2026-08-13T12:00:00Z'),rows=prices.map((price,i)=>({observedAt:new Date(start+i*60_000).toISOString(),price,activeBinId:Math.round(price),twoWayRatio:.7,localLiquidity:1000})),context=await buildMarketContext('P',rows.at(-1).observedAt,rows),structure=computeStructureFeatures({context,observations:rows});return classifyRegime({context,structure});}

test('four-hour structural context changes regime evidence while the recent path is identical',async()=>{
 const recent=Array.from({length:31},(_,i)=>120-i*.08+(i>22?(i-22)*.035:0));
 const bullish=await assess([...Array.from({length:210},(_,i)=>100+i*.10),...recent]);
 const bearish=await assess([...Array.from({length:210},(_,i)=>150-i*.16),...recent]);
 assert.ok(Number(bullish.evidence.return4h)>0);assert.ok(Number(bearish.evidence.return4h)<0);
 assert.ok(bullish.rawScores.CONTROLLED_PULLBACK>bearish.rawScores.CONTROLLED_PULLBACK,'downtrend context cannot make the same small bounce a healthier pullback');
 assert.ok(bearish.rawScores.TREND_DOWN>bullish.rawScores.TREND_DOWN);
});

test('fresh breakdown still dominates an older bullish context',async()=>{
 const prices=[...Array.from({length:210},(_,i)=>100+i*.15),...Array.from({length:31},(_,i)=>131-(i*i)*.08)];
 const r=await assess(prices),m=Object.fromEntries(r.probabilities.map(x=>[x.label,x.probability]));
 assert.ok(m.FREEFALL>m.CONTROLLED_PULLBACK||m.TREND_DOWN>m.CONTROLLED_PULLBACK);
});
