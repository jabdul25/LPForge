import test from 'node:test';
import assert from 'node:assert/strict';
import {assessHistoryMaturity,deriveEventPathEconomicEstimate,collectActiveCandidateEvidence,selectActiveCandidateCollectionSlice} from '../.build/packages/active-candidate-evidence/src/index.js';
import {estimateOpportunityEconomics} from '../.build/packages/opportunity/src/index.js';
import {evaluateEntry,ENTRY_RESEARCH_POLICY_V1} from '../.build/packages/entry-intelligence/src/index.js';

const at='2026-08-13T16:00:00.000Z',atMs=Date.parse(at);
const history=(count=61,strideMs=60_000)=>{const market=Array.from({length:count},(_,i)=>({observedAt:new Date(atMs-(count-1-i)*strideMs).toISOString(),price:1+i*.0001,activeBinId:10+(i%2),volume:100,feeValue:1,twoWayRatio:.7,localLiquidity:100000}));return{marketObservations:market,activeBins:market.map(x=>({observedAt:x.observedAt,activeBinId:x.activeBinId})),binFrames:market.map(x=>({observedAt:x.observedAt,activeBinId:x.activeBinId,bins:[]})),swapEvents:market.map((x,i)=>({pool:'P',signature:`s${i}`,eventIndex:0,stamp:{observedAt:x.observedAt}}))};};
const feeBuckets=(count)=>Array.from({length:count},(_,i)=>({timestamp:Math.floor((atMs-(count-1-i)*5*60_000)/1000),fees:10,protocol_fees:1,volume:1000}));

test('active candidate collector rotates bounded slices instead of repeatedly sweeping the first pools',()=>{
 const pools=['A','B','C','D'].map(poolAddress=>({poolAddress})),interval=60_000;
 const first=selectActiveCandidateCollectionSlice(pools,1,'2026-08-13T16:00:00.000Z',interval),second=selectActiveCandidateCollectionSlice(pools,1,'2026-08-13T16:01:00.000Z',interval),third=selectActiveCandidateCollectionSlice(pools,1,'2026-08-13T16:02:00.000Z',interval),fourth=selectActiveCandidateCollectionSlice(pools,1,'2026-08-13T16:03:00.000Z',interval);
 assert.deepEqual(new Set([...first,...second,...third,...fourth].map(x=>x.poolAddress)),new Set(['A','B','C','D']));
});

test('Phase-4 history maturity uses existing .60 threshold and can mature naturally',async()=>{
 const cold=await assessHistoryMaturity({poolAddress:'P',assessedAt:at,history:history(8)}),warm=await assessHistoryMaturity({poolAddress:'P',assessedAt:at,history:history(61)});
 assert.equal(cold.state,'WARMING');assert.ok(cold.completeness1h<.60);
 assert.equal(warm.state,'MATURE');assert.ok(warm.completeness5m>=.60&&warm.completeness15m>=.60&&warm.completeness1h>=.60);
});
test('event-path economics remain conservative when cold and clear uncertainty with mature independent evidence',async()=>{
 const low=await deriveEventPathEconomicEstimate({poolAddress:'P',asOf:at,dataApiPool:{address:'P',tvl:100000},feeBuckets:feeBuckets(2),history:history(2)});
 const mature=await deriveEventPathEconomicEstimate({poolAddress:'P',asOf:at,dataApiPool:{address:'P',tvl:100000},feeBuckets:feeBuckets(48),history:history(48,5*60_000)});
 assert.equal(low.fidelity,'AGGREGATE_ESTIMATE');assert.equal(mature.fidelity,'EVENT_PATH_ESTIMATE');assert.ok(mature.effectiveSampleCount<48,'effective samples are episode-aware, not raw minute counts');
 const economics=estimateOpportunityEconomics({capitalValue:1,horizonMinutes:60,rates:{feeRatePerCapitalHour:mature.feeRatePerCapitalHour,adverseInventoryRatePerCapitalHour:.0005,repositionRatePerCapitalHour:.0005,tailRiskRatePerCapitalHour:.00035,executionCostFixed:.00001,sampleCount:mature.effectiveSampleCount,uncertainty:mature.uncertainty,fidelity:'EVENT_PATH_ESTIMATE'},pool:{economicQualityScore:80,flowQualityScore:80,liquidityQualityScore:80,toxicityProbability:.1},regime:{confidence:.45,transitionRisk:.05,probabilities:[{label:'SIDEWAYS',probability:.45},{label:'CONSOLIDATION',probability:.25},{label:'RECOVERY',probability:.15},{label:'TREND_DOWN',probability:.10},{label:'UNKNOWN',probability:.05}],stability:.20},regimeHistory:{transitionRisk:.05,flappingRate:.01,stableDurationMinutes:120},structure:{structureQuality:.8,downsideAcceleration:.1}});
 assert.ok(economics.uncertainty<=.72,`mature event path uncertainty ${economics.uncertainty}`);assert.equal(economics.evidenceUncertainty,mature.uncertainty);assert.equal(economics.forecastUncertainty,economics.uncertainty);assert.equal(economics.forecastUncertaintyComponents.evidence,mature.uncertainty);assert.equal('effectiveSample' in economics.forecastUncertaintyComponents,false,'sample depth is represented only by evidence uncertainty');
});
test('bounded collector observes every active candidate and production-monitored supplemental pool while one failure does not starve peers',async()=>{
 const writes=[];const candidates=['A','B','C'].map(poolAddress=>({poolAddress,state:'ACTIVE_CANDIDATE',tier:'A',priorityScore:1,lastSeenAt:at,payload:{}}));
 let historicalRequests=0;const store={listDiscoveryCandidates:async()=>candidates,insertPoolSnapshot:async()=>{},insertBins:async()=>{},insertDataApiPool:async()=>{},insertOhlcv:async()=>{},insertFeeVolumeObservations:async()=>{},loadFeeVolumeObservations:async()=>feeBuckets(48).map(x=>({bucketAt:new Date(x.timestamp*1000).toISOString(),fees:x.fees,protocolFees:x.protocol_fees,volume:x.volume})),insertCandidateMarketObservations:async()=>{},loadCandidateMarketObservations:async()=>[],loadActiveCandidateBackfill:async()=>({last_successful_at:at}),upsertActiveCandidateBackfill:async()=>{},insertSwapEvent:async()=>{},loadOperationalHistory:async pool=>history(61),upsertActiveCandidateHistoryMaturity:async x=>writes.push(x),insertEconomicEstimate:async()=>{}};
 const api={getPool:async address=>{if(address==='B')throw new Error('slow pool failure');return{address,tvl:100000};},getHistoricalVolume:async()=>{historicalRequests++;return{data:feeBuckets(48)};},getOhlcv:async()=>({data:[]})};
 const adapter={getPool:async address=>({address,activeBinId:1}),getBinsAroundActive:async()=>[],decodeEvents:async()=>[]};const rpc={getSignaturesForAddress:async()=>[],getTransaction:async()=>null};
 const result=await collectActiveCandidateEvidence({api,adapter,rpc,store,observedAt:at,policy:{maxConcurrentPoolReads:2,supplementalPoolAddresses:['MANUAL']}});
 assert.equal(result.results.length,4);assert.equal(result.results.filter(x=>x.status==='PASS').length,3);assert.equal(result.results.find(x=>x.poolAddress==='B').status,'DEGRADED');assert.ok(result.results.some(x=>x.poolAddress==='MANUAL'));assert.equal(writes.length,4);assert.ok(historicalRequests>0,'a prior backfill record without persisted historical price evidence is repaired');
});
test('collector uses its completed pool-read timestamp for both live evidence and maturity assessment',async()=>{
 const liveWrites=[],maturityWrites=[],now=new Date().toISOString(),futureEventAt=new Date(Date.now()+30_000).toISOString(),operationalHistory=history(61);operationalHistory.swapEvents.push({pool:'P',signature:'newest',eventIndex:0,stamp:{observedAt:futureEventAt}});
 const store={listDiscoveryCandidates:async()=>[{poolAddress:'P',state:'ACTIVE_CANDIDATE',tier:'A',priorityScore:1,lastSeenAt:at,payload:{}}],insertPoolSnapshot:async()=>{},insertBins:async()=>{},insertDataApiPool:async()=>{},insertOhlcv:async()=>{},insertFeeVolumeObservations:async()=>{},loadFeeVolumeObservations:async()=>feeBuckets(48).map(x=>({bucketAt:new Date(x.timestamp*1000).toISOString(),fees:x.fees,protocolFees:x.protocol_fees,volume:x.volume})),insertCandidateMarketObservations:async x=>liveWrites.push(x),loadCandidateMarketObservations:async()=>[{observedAt:at,sourceType:'HISTORICAL_API_BACKFILL',sourceProvider:'test',price:1,resolutionMs:300000}],loadActiveCandidateBackfill:async()=>({last_successful_at:now}),upsertActiveCandidateBackfill:async()=>{},insertSwapEvent:async()=>{},loadOperationalHistory:async()=>operationalHistory,upsertActiveCandidateHistoryMaturity:async x=>maturityWrites.push(x),insertEconomicEstimate:async()=>{}};
 const api={getPool:async address=>({address,tvl:100000}),getHistoricalVolume:async()=>({data:feeBuckets(48)}),getOhlcv:async()=>({data:[]})},adapter={getPool:async address=>({address,activeBinId:1}),getBinsAroundActive:async()=>[],decodeEvents:async()=>[]},rpc={getSignaturesForAddress:async()=>[],getTransaction:async()=>null};
 const result=await collectActiveCandidateEvidence({api,adapter,rpc,store,observedAt:at,policy:{maxConcurrentPoolReads:1}});
 assert.equal(result.results[0].status,'PASS');assert.equal(liveWrites.length,1);assert.equal(maturityWrites.length,1);const observedAt=liveWrites[0].rows[0].observedAt,assessedAt=maturityWrites[0].assessedAt;assert.ok(Date.parse(assessedAt)>=Date.parse(observedAt));assert.ok(Date.parse(assessedAt)>=Date.parse(futureEventAt),'assessment includes all evidence read during the cycle instead of treating its newest event as lookahead');
});
test('Phase-4 thresholds remain unchanged and missing flow is not treated as healthy',()=>{
 assert.deepEqual(ENTRY_RESEARCH_POLICY_V1,{id:'entry-research-v1',minReadiness:.60,minDataCompleteness:.60,maxDownsidePressure:.72,maxDangerousRegimeMass:.48,maxToxicity:.62,maxReferenceDivergenceRisk:.60,maxImmediateOorRisk:.65,minExpectedNetValue:0,maxUncertainty:.72});
 const features={downsideDeceleration:.9,supportReclaimStrength:.8,twoWayFlowStrength:0,flowRecovery:0,regimeStability:.8,volatilityExpansionRisk:.1,immediateOorRisk:.1,dataCompleteness:1,dangerousRegimeMass:.1,poolToxicity:.1,referenceDivergenceRisk:.1,downsidePressure:.1};
 const r=evaluateEntry({features,economics:{expectedNetLpValue:.02,uncertainty:.2},thesis:{thesisId:'t'},observedAt:at,expiresAt:'2026-08-13T16:05:00.000Z'});assert.equal(r.decision,'WAIT');assert.ok(r.waitReasons.includes('WAIT_FLOW_NOT_RECOVERED'));
});
