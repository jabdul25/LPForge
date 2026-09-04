import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketContext } from '../.build/packages/market-context/src/index.js';
import { generateRangeUniverse, generateStrategyCandidates, resolveFinalRangeWidthBins } from '../.build/packages/rangeforge/src/index.js';

const structure={volatilityState:'LOW',trendDirection:0,trendEfficiency:0};
const regime={transitionRisk:0};
const context=(h15,h1)=>({horizons:{'15m':h15,'1h':h1}});
const horizon=(net,maxAnchor,absolute=maxAnchor)=>({netBins:net,maxAnchorDisplacementBins:maxAnchor,absoluteBins:absolute,binVelocityPerMinute:absolute/60,returnPct:0});
function universe(c,{minimum=35,maximum=100}={}){
  return generateRangeUniverse({activeBinId:1000,binStep:80,horizonMinutes:60,context:c,structure,regime,minWidthBins:minimum,maxWidthBins:maximum,enforceRequiredWidth:true});
}

test('market context preserves cumulative travel telemetry but derives a bounded anchor excursion',async()=>{
  const bins=[0,20,2,22,4,21];
  const observations=bins.map((activeBinId,i)=>({observedAt:new Date(Date.UTC(2026,0,1,0,i*10)).toISOString(),price:1,activeBinId,resolutionMs:60_000}));
  const c=await buildMarketContext('choppy','2026-01-01T01:00:00.000Z',observations);
  assert.equal(c.horizons['1h'].absoluteBins,93);
  assert.equal(c.horizons['1h'].maxAnchorDisplacementBins,22);
});

test('choppy reversal width tracks bounded excursion while a trend retains its real displacement',()=>{
  const choppy=universe(context(horizon(0,22,75),horizon(21,22,75)));
  const trend=universe(context(horizon(-20,20,20),horizon(-40,40,40)));
  assert.ok(choppy.volatilityRequiredWidthBins < 100);
  assert.ok(trend.volatilityRequiredWidthBins > choppy.volatilityRequiredWidthBins);
  assert.equal(trend.finalMinimumWidthBins,Math.max(35,trend.volatilityRequiredWidthBins,trend.survivalHorizonRequiredWidthBins));
});

test('resolved production width is never amplified by a family label',()=>{
  const u=universe(context(horizon(0,20),horizon(0,47))); // 47*.75*.9 -> 65 inclusive bins
  assert.equal(u.finalMinimumWidthBins,65);
  assert.deepEqual([...new Set(u.candidates.map((candidate)=>candidate.widthBins))],[65]);
  assert.equal(u.candidates.find((candidate)=>candidate.family==='DEFENSIVE').widthBins,65);
});

test('floor, mid-zone and true cap cases use one canonical resolver',()=>{
  const resolve=(v,s)=>resolveFinalRangeWidthBins({minimumIncludedBins:35,volatilityRequiredWidthBins:v,survivalHorizonRequiredWidthBins:s,maximumWidthBins:100});
  assert.equal(resolve(20,28),35);
  assert.equal(resolve(56,72),72);
  assert.throws(()=>resolve(112,83),/RANGE_REQUIRED_WIDTH_EXCEEDS_MAXIMUM/);
});

test('skewed geometries retain the resolved inclusive total',()=>{
  const u=universe(context(horizon(0,20),horizon(0,47))); // 65 bins
  assert.equal(u.finalMinimumWidthBins,65);
  for(const c of generateStrategyCandidates({universe:u,strategies:['CURVE'],orientations:['SKEWED_Y','SKEWED_X']})){
    assert.equal(c.upperBinId-c.lowerBinId+1,65);
    assert.equal(c.widthBins,65);
  }
});

test('bin step changes price distance, not the resolved bin count',()=>{
  for(const binStep of [50,80,100,125]){
    const u=generateRangeUniverse({activeBinId:1000,binStep,horizonMinutes:60,context:context(horizon(0,20),horizon(0,47)),structure,regime,minWidthBins:35,maxWidthBins:100,enforceRequiredWidth:true});
    assert.equal(u.finalMinimumWidthBins,65);
  }
});
