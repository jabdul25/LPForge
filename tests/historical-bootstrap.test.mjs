import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBackfillQuality, assessHistoryMaturity, deriveEventPathEconomicEstimate } from '../.build/packages/active-candidate-evidence/src/index.js';
import { buildMarketContext } from '../.build/packages/market-context/src/index.js';
import { ENTRY_RESEARCH_POLICY_V1, evaluateEntry } from '../.build/packages/entry-intelligence/src/index.js';

const at='2026-08-13T18:00:00.000Z',ms=Date.parse(at),iso=x=>new Date(x).toISOString();
const fees=(count,start=ms-60*60_000)=>Array.from({length:count},(_,i)=>({timestamp:Math.floor((start+i*5*60_000)/1000),fees:5,protocol_fees:.5,volume:500}));
const history=(count=61)=>{const rows=Array.from({length:count},(_,i)=>({observedAt:iso(ms-(count-1-i)*60_000),price:1+i*.001,activeBinId:100+(i%3),volume:100,feeValue:1,twoWayRatio:.7,localLiquidity:10000}));return{marketObservations:rows,activeBins:rows.map(x=>({observedAt:x.observedAt,activeBinId:x.activeBinId})),binFrames:rows.map(x=>({observedAt:x.observedAt,activeBinId:x.activeBinId,bins:[]})),swapEvents:rows.map((x,i)=>({signature:`sig-${i}`,eventIndex:0,pool:'P',stamp:{observedAt:x.observedAt}}))};};
const historicMarket=()=>Array.from({length:13},(_,i)=>({observedAt:iso(ms-60*60_000+i*5*60_000),sourceType:'HISTORICAL_API_BACKFILL',sourceProvider:'METEORA_DATA_API',price:1+i*.01,activeBinId:100+i,resolutionMs:5*60_000,volume:100,feeValue:1,localLiquidity:10000}));
const liveMarket=(minutes=10)=>Array.from({length:minutes*2+1},(_,i)=>({observedAt:iso(ms-minutes*60_000+i*30_000),sourceType:'LIVE_OBSERVED',sourceProvider:'METEORA_API+RPC',price:1,activeBinId:110,resolutionMs:30_000,volume:100,feeValue:1,localLiquidity:10000}));

test('old pool bootstraps immediately from real historical market time, then requires live confirmation',async()=>{
 const q=assessBackfillQuality({requestedMinutes:90,feeBuckets:fees(19,ms-90*60_000),ohlcvBuckets:fees(19,ms-90*60_000),swapEventCount:25});
 assert.equal(q.quality,'SUFFICIENT'); assert.equal(q.coveredMinutes,90); assert.ok(q.independent15mEpisodes>=6);
 const waiting=await assessHistoryMaturity({poolAddress:'P',assessedAt:at,history:history(),historicalMarket:historicMarket(),liveMarket:liveMarket(9),liveConfirmationMinutes:10});
 assert.equal(waiting.historicalState,'MATURE'); assert.equal(waiting.liveConfirmationState,'WARMING'); assert.equal(waiting.state,'WARMING');
 const mature=await assessHistoryMaturity({poolAddress:'P',assessedAt:at,history:history(),historicalMarket:historicMarket(),liveMarket:liveMarket(10),liveConfirmationMinutes:10});
 assert.equal(mature.historicalState,'MATURE');assert.equal(mature.liveConfirmationState,'CONFIRMED');assert.equal(mature.state,'MATURE');
});

test('young pool cannot fabricate 90 minutes and backfill uses market time rather than ingestion time',async()=>{
 const q=assessBackfillQuality({requestedMinutes:90,feeBuckets:fees(5,ms-20*60_000),ohlcvBuckets:fees(5,ms-20*60_000),swapEventCount:3});
 assert.equal(q.quality,'PARTIAL');assert.ok(q.coveredMinutes<=20);
 const context=await buildMarketContext('P',at,[{observedAt:iso(ms-60*60_000),price:1,activeBinId:1,resolutionMs:5*60_000},{observedAt:iso(ms-55*60_000),price:1,activeBinId:1,resolutionMs:5*60_000}]);
 assert.ok(context.horizons['1h'].completeness<.60,'two genuine 5m buckets are not expanded into 60 samples');
});

test('historical OHLCV contributes real price-time completeness without fabricating active-bin movement',async()=>{
 const candles=Array.from({length:13},(_,i)=>({observedAt:iso(ms-60*60_000+i*5*60_000),price:1+i*.01,resolutionMs:5*60_000,volume:100}));
 const context=await buildMarketContext('P',at,candles);
 assert.ok(context.horizons['1h'].completeness>=.60,'genuine five-minute OHLCV covers its real market interval');
 assert.equal(context.horizons['1h'].netBins,0,'price candles never invent active-bin movement');
 const maturity=await assessHistoryMaturity({poolAddress:'P',assessedAt:at,history:history(),historicalMarket:candles.map(x=>({...x,sourceType:'HISTORICAL_API_BACKFILL',sourceProvider:'METEORA_DATA_API'})),liveMarket:liveMarket(10),liveConfirmationMinutes:10});
 assert.equal(maturity.historicalState,'MATURE');
});

test('historical maturity is assessed at the historical high-water mark while fresh live confirmation proves now',async()=>{
 const historic=Array.from({length:13},(_,i)=>({observedAt:iso(ms-70*60_000+i*5*60_000),sourceType:'HISTORICAL_API_BACKFILL',sourceProvider:'METEORA_DATA_API',price:1+i*.01,resolutionMs:5*60_000}));
 const live=Array.from({length:21},(_,i)=>({observedAt:iso(ms-10*60_000+i*30_000),sourceType:'LIVE_OBSERVED',sourceProvider:'METEORA_API+RPC',price:1.2,activeBinId:110,resolutionMs:30_000}));
 const maturity=await assessHistoryMaturity({poolAddress:'P',assessedAt:at,history:history(),historicalMarket:historic,liveMarket:live,liveConfirmationMinutes:10});
 assert.equal(maturity.historicalState,'MATURE');assert.equal(maturity.liveConfirmationState,'CONFIRMED');assert.equal(maturity.state,'MATURE');
});

test('live confirmation requires both observation density and bounded gaps, not wall-clock time alone',async()=>{
 const historic=historicMarket();
 const sparse=Array.from({length:3},(_,i)=>({observedAt:iso(ms-(10-i*5)*60_000),sourceType:'LIVE_OBSERVED',sourceProvider:'METEORA_API+RPC',price:1,activeBinId:110,resolutionMs:30_000}));
 const tooFew=await assessHistoryMaturity({poolAddress:'P',assessedAt:at,history:history(),historicalMarket:historic,liveMarket:sparse,liveConfirmationMinutes:10,liveConfirmationMinObservations:4,liveConfirmationMaxGapMs:180_000});
 assert.equal(tooFew.liveConfirmationState,'WARMING');assert.ok(tooFew.reasonCodes.includes('ENTRY_LIVE_CONFIRMATION_INSUFFICIENT_OBSERVATIONS'));
 const gapped=[10,6,2,0].map(minutesAgo=>({observedAt:iso(ms-minutesAgo*60_000),sourceType:'LIVE_OBSERVED',sourceProvider:'METEORA_API+RPC',price:1,activeBinId:110,resolutionMs:30_000}));
 const gap=await assessHistoryMaturity({poolAddress:'P',assessedAt:at,history:history(),historicalMarket:historic,liveMarket:gapped,liveConfirmationMinutes:10,liveConfirmationMinObservations:4,liveConfirmationMaxGapMs:180_000});
 assert.equal(gap.liveConfirmationState,'WARMING');assert.ok(gap.reasonCodes.includes('ENTRY_LIVE_CONFIRMATION_GAP'));
 const confirmed=await assessHistoryMaturity({poolAddress:'P',assessedAt:at,history:history(),historicalMarket:historic,liveMarket:liveMarket(10),liveConfirmationMinutes:10,liveConfirmationMinObservations:4,liveConfirmationMaxGapMs:180_000});
 assert.equal(confirmed.liveConfirmationState,'CONFIRMED');
});

test('a timestamp-at-start five-minute historical bucket covers its genuine closing interval',async()=>{
 const historic=Array.from({length:13},(_,i)=>({observedAt:iso(ms-65*60_000+i*5*60_000),sourceType:'HISTORICAL_API_BACKFILL',sourceProvider:'METEORA_DATA_API',price:1+i*.01,resolutionMs:5*60_000}));
 const maturity=await assessHistoryMaturity({poolAddress:'P',assessedAt:at,history:history(),historicalMarket:historic,liveMarket:liveMarket(10),liveConfirmationMinutes:10});
 assert.equal(maturity.historicalState,'MATURE');assert.equal(maturity.state,'MATURE');
});

test('hybrid historical plus live economic evidence promotes only with non-overlapping market-time episodes',async()=>{
 const h=history(91),hybrid=[...Array.from({length:10},(_,i)=>({timestamp:Math.floor((ms-90*60_000+i*10*60_000)/1000),fees:5,protocol_fees:.5,volume:500})),...fees(2,ms-5*60_000)];
 const r=await deriveEventPathEconomicEstimate({poolAddress:'P',asOf:at,dataApiPool:{address:'P',tvl:100000},feeBuckets:hybrid,history:h});
 assert.equal(r.fidelity,'EVENT_PATH_ESTIMATE');assert.ok(r.independentEpisodeCount>=6);assert.ok(r.uncertainty<=.72);
 const duplicated=await deriveEventPathEconomicEstimate({poolAddress:'P',asOf:at,dataApiPool:{address:'P',tvl:100000},feeBuckets:Array.from({length:12},()=>fees(1,ms-5*60_000)[0]),history:h});
 assert.equal(duplicated.fidelity,'AGGREGATE_ESTIMATE','overlapping duplicate buckets do not create independent evidence');
});

test('historical strength never clears a current flow/reclaim/regime timing gate and thresholds are unchanged',()=>{
 assert.equal(ENTRY_RESEARCH_POLICY_V1.minDataCompleteness,.60);assert.equal(ENTRY_RESEARCH_POLICY_V1.maxUncertainty,.72);assert.equal(ENTRY_RESEARCH_POLICY_V1.minReadiness,.60);
 const r=evaluateEntry({features:{downsideDeceleration:.9,supportReclaimStrength:.2,twoWayFlowStrength:.1,flowRecovery:0,regimeStability:.1,volatilityExpansionRisk:.1,immediateOorRisk:.1,dataCompleteness:1,dangerousRegimeMass:.1,poolToxicity:.1,referenceDivergenceRisk:.1,downsidePressure:.1},economics:{expectedNetLpValue:.1,uncertainty:.2},thesis:{thesisId:'P'},observedAt:at,expiresAt:iso(ms+60_000)});
 assert.equal(r.decision,'WAIT');assert.ok(r.waitReasons.includes('WAIT_FLOW_NOT_RECOVERED'));assert.ok(r.waitReasons.includes('WAIT_RECLAIM_NOT_CONFIRMED'));assert.ok(r.waitReasons.includes('WAIT_REGIME_UNSTABLE'));
});
