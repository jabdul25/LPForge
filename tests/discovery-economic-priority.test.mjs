import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryEconomicPriority,discoveryPoolMetricPatch,feeEfficiencyScorePct,mergeDiscoveryMetrics,ratioPct,standardPoolDiscoveryMetrics} from '../.build/packages/discovery-metrics/src/index.js';

const at='2026-08-23T00:00:00.000Z';
const base={ratioUnit:'PERCENTAGE_POINTS',source:'METEORA_DISCOVERY_API',ingestedAt:at};

test('canonical fee ratios use percentage points for provider and fallback paths',()=>{
 assert.equal(ratioPct(500,100_000),.5);
 const provider=standardPoolDiscoveryMetrics({address:'provider',tvl:100_000,fees:{'30m':500},fee_tvl_ratio:{'30m':.5}},at);
 const fallback=standardPoolDiscoveryMetrics({address:'fallback',tvl:100_000,fees:{'30m':500}},at);
 assert.equal(provider.feeTotalTvlRatio30mPct,.5);
 assert.equal(fallback.feeTotalTvlRatio30mPct,.5);
 assert.equal(ratioPct(0,100_000),0);
 assert.equal(ratioPct(10,100_000),.01);
 assert.equal(ratioPct(1_000,100_000),1);
 assert.equal(ratioPct(10_000,100_000),10);
 assert.equal(ratioPct(500,0),undefined);
 assert.equal(ratioPct(500,undefined),undefined);
 assert.equal(standardPoolDiscoveryMetrics({address:'invalid',tvl:null,fees:{'30m':500}},at).feeTotalTvlRatio30mPct,undefined);
});

test('Meteora active-TVL enrichment preserves canonical percentage-point values and provenance',()=>{
 const patch=discoveryPoolMetricPatch({pool_address:'P',tvl:100_000,active_tvl:25_000,fee:125,volume:10_000,swap_count:33,fee_tvl_ratio:.125,fee_active_tvl_ratio:.5,updated_at:'2026-08-23T00:00:00Z'},'30m',at);
 const merged=mergeDiscoveryMetrics({...base,totalTvlUsd:100_000},[patch]);
 assert.equal(merged.ratioUnit,'PERCENTAGE_POINTS');
 assert.equal(merged.activeTvlUsd,25_000);
 assert.equal(merged.feeTotalTvlRatio30mPct,.125);
 assert.equal(merged.feeActiveTvlRatio30mPct,.5);
 assert.equal(merged.source,'METEORA_DISCOVERY_API');
 assert.equal(merged.sourceObservedAt,at);
});

test('bounded fee score remains monotone and discriminative across the operating domain',()=>{
 const values=[.01,.05,.1,.3,.5,1,2,5,10,20];
 const scores=values.map(feeEfficiencyScorePct);
 for(let i=1;i<scores.length;i++)assert.ok(scores[i]>scores[i-1],`${values[i]}% must score above ${values[i-1]}%`);
 assert.equal(feeEfficiencyScorePct(0),0);
 assert.ok(scores[4]-scores[0]>.1,'ordinary fee values must not collapse into one saturated bucket');
});

test('economic priority rewards persistent fee efficiency but suppresses a high-ratio active-liquidity dust pool',()=>{
 const dust={...base,activeTvlUsd:700,fees30mUsd:300,fees1hUsd:500,fees24hUsd:3_000,volume30mUsd:3_000,volume1hUsd:6_000,volume24hUsd:40_000,swapCount30m:10,swapCount1h:25,swapCount24h:180,feeActiveTvlRatio30mPct:42.8,feeActiveTvlRatio1hPct:71.4,feeActiveTvlRatio24hPct:35,feeTotalTvlRatio30mPct:.2,feeTotalTvlRatio1hPct:.3,feeTotalTvlRatio24hPct:.15};
 const robust={...base,activeTvlUsd:80_000,fees30mUsd:1_000,fees1hUsd:2_000,fees24hUsd:18_000,volume30mUsd:25_000,volume1hUsd:60_000,volume24hUsd:500_000,swapCount30m:125,swapCount1h:260,swapCount24h:1_900,feeActiveTvlRatio30mPct:1.25,feeActiveTvlRatio1hPct:2.5,feeActiveTvlRatio24hPct:1.7,feeTotalTvlRatio30mPct:.6,feeTotalTvlRatio1hPct:1.2,feeTotalTvlRatio24hPct:.9};
 assert.ok(discoveryEconomicPriority(robust)>discoveryEconomicPriority(dust),'extreme ratios on dust active liquidity cannot dominate robust persistent economics');
});
