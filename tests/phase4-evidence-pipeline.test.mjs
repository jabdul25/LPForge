import test from 'node:test';
import assert from 'node:assert/strict';
import {assessHistoryMaturity,deriveEventPathEconomicEstimate,collectActiveCandidateEvidence,selectActiveCandidateCollectionSlice,requiredActiveCandidateCollectionCapacity,calculateServiceableActiveCandidateCapacity,calculateCompletionAwareCollectionSliceSize,completionAwareCollectorDelayMs,assessCollectorRevisitBudget} from '../.build/packages/active-candidate-evidence/src/index.js';
import {estimateOpportunityEconomics} from '../.build/packages/opportunity/src/index.js';
import {evaluateEntry,ENTRY_RESEARCH_POLICY_V1} from '../.build/packages/entry-intelligence/src/index.js';
import {ACTIVE_EVIDENCE_LEASE_TIMEOUT_MS,EVIDENCE_CONTINUITY_TRACKING_CAP,EVIDENCE_CONTINUITY_TRACKING_TTL_MS,EVIDENCE_CONTINUITY_SERVICE_HEADROOM_MS,evidenceContinuityDeadlines,LIVE_EVIDENCE_MIN_ACTIVE_DWELL_MS,POST_EVIDENCE_EVALUATION_WINDOW_MS,compareContinuityMaturityPriority,continuityMaturityPriority,dynamicLiveEvidenceAdmissionCapacity,evidenceContinuityTrackingExpiresAt,freshDiscoveryEconomicPriority,freshLiveEvidenceEconomicQuality,isEvidenceMaturityNoTrade,isLiveEvidenceAdmissionTerminal,isLiveEvidenceAdmissionTerminalForCurrentLease,isLiveEvidenceLeaseActive,isPhase3ReadyConsumptionPending,isPostEvidenceEvaluationEligible,liveEvidenceLeaseExpiresAt,liveEvidenceLeaseReleaseReason,selectLiveEvidenceAdmissionCandidates} from '../.build/packages/db/src/index.js';
import {decisionTimeEconomicEvidenceAgeSeconds,hasPhase3FreshHistoricalEvidence,summarizePhase3RecentLiveObservations} from '../.build/packages/operational-runtime/src/index.js';

const at='2026-08-13T16:00:00.000Z',atMs=Date.parse(at);
const history=(count=61,strideMs=60_000)=>{const market=Array.from({length:count},(_,i)=>({observedAt:new Date(atMs-(count-1-i)*strideMs).toISOString(),price:1+i*.0001,activeBinId:10+(i%2),volume:100,feeValue:1,twoWayRatio:.7,localLiquidity:100000}));return{marketObservations:market,activeBins:market.map(x=>({observedAt:x.observedAt,activeBinId:x.activeBinId})),binFrames:market.map(x=>({observedAt:x.observedAt,activeBinId:x.activeBinId,bins:[]})),swapEvents:market.map((x,i)=>({pool:'P',signature:`s${i}`,eventIndex:0,stamp:{observedAt:x.observedAt}}))};};
const feeBuckets=(count)=>Array.from({length:count},(_,i)=>({timestamp:Math.floor((atMs-(count-1-i)*5*60_000)/1000),fees:10,protocol_fees:1,volume:1000}));
const episodeFeeBuckets=(episodeCount,perEpisode=4)=>Array.from({length:episodeCount*perEpisode},(_,i)=>{const episode=Math.floor(i/perEpisode),within=i%perEpisode,minutesAgo=44-episode*15-within;return{timestamp:Math.floor((atMs-minutesAgo*60_000)/1000),fees:10,protocol_fees:1,volume:1000};});

test('active candidate collector partitions twelve pools across three four-pool cycles',()=>{
 const pools=Array.from({length:12},(_,i)=>({poolAddress:`P${String(i).padStart(2,'0')}`,state:'ACTIVE_CANDIDATE'})),interval=60_000;
 const batches=[0,1,2].map(offset=>selectActiveCandidateCollectionSlice(pools,4,new Date(atMs+offset*interval).toISOString(),interval));
 assert.deepEqual(batches.map(batch=>batch.length),[4,4,4]);
 assert.equal(new Set(batches.flat().map(x=>x.poolAddress)).size,12);
 assert.equal(new Set(batches.flat().map(x=>x.poolAddress)).size,batches.flat().length,'no address is repeated before the round completes');
});
test('dynamic collector capacity preserves the 180-second coverage target',()=>{
 assert.equal(requiredActiveCandidateCollectionCapacity(12,60_000),4);
 assert.equal(requiredActiveCandidateCollectionCapacity(25,60_000),9);
 assert.equal(requiredActiveCandidateCollectionCapacity(40,60_000),14);
});
test('completion-aware collection services both ACTIVE leases within the existing revisit budget',()=>{
 const slice=calculateCompletionAwareCollectionSliceSize({activePoolCount:2,serviceableCapacity:2,p95PoolCollectionMs:90_000,maxConcurrentPoolReads:1,revisitBudgetMs:180_000,hardCap:30});
 assert.equal(slice,2);
 const budget=assessCollectorRevisitBudget({activePoolCount:2,collectionSliceSize:slice,maxConcurrentPoolReads:1,p95PoolCollectionMs:90_000,revisitBudgetMs:180_000});
 assert.deepEqual(budget,{projectedRevisitMs:180_000,capacityViolation:false});
});
test('evidence-maturity NO_TRADE is eligible for two bounded continuity lanes through its existing replay horizon',()=>{
 assert.equal(EVIDENCE_CONTINUITY_TRACKING_CAP,2);
 assert.equal(EVIDENCE_CONTINUITY_TRACKING_TTL_MS,60*60_000);
 assert.equal(isEvidenceMaturityNoTrade('NO_TRADE',['RANGE_SURVIVAL_EVIDENCE_INSUFFICIENT']),true);
 assert.equal(isEvidenceMaturityNoTrade('NO_TRADE',['NON_POSITIVE_RISK_ADJUSTED_EV']),false);
 assert.equal(Date.parse(evidenceContinuityTrackingExpiresAt(at))-Date.parse(at),60*60_000);
});
test('two continuity lanes use the unchanged 450-second hard gap rather than consuming an economic slot',()=>{
 const budget=assessCollectorRevisitBudget({activePoolCount:4,collectionSliceSize:4,maxConcurrentPoolReads:1,p95PoolCollectionMs:90_000,revisitBudgetMs:450_000});
 assert.equal(budget.capacityViolation,false);
 assert.equal(budget.projectedRevisitMs,360_000);
 assert.equal(calculateServiceableActiveCandidateCapacity({p3BudgetRps:3,estimatedP3CallsPerPool:12,p95PoolCollectionMs:90_000,maxConcurrentPoolReads:1,targetCoverageMs:180_000,serviceabilitySafetyMargin:.70,hardCap:30}),2);
});
test('maturity-aware continuity priority retains a BUTTHOLE-like near-confirmed tracker over an immature newcomer',()=>{
 const now='2026-08-13T16:00:00.000Z',nowMs=Date.parse(now);
 const near=continuityMaturityPriority({poolAddress:'BUTTHOLE',observedAt:now,liveObservationTimes:[285,180,90,0].map(seconds=>new Date(nowMs-seconds*1000).toISOString()),tierARank:1,candidateUtility:.001,trackingStartedAt:'2026-08-13T15:55:00.000Z'});
 const newcomer=continuityMaturityPriority({poolAddress:'NEW',observedAt:now,liveObservationTimes:[90,0].map(seconds=>new Date(nowMs-seconds*1000).toISOString()),tierARank:20,candidateUtility:0,trackingStartedAt:'2026-08-13T15:59:00.000Z'});
 assert.equal(near.validObservationCount,4);assert.equal(near.validObservationSpanMs,285_000);assert.equal(near.confirmationRemainingMs,315_000);
 assert.ok(compareContinuityMaturityPriority(near,newcomer)<0);
});
test('anchor, observation span, Tier-A rank, utility, and deterministic ties order continuity trackers canonically',()=>{
 const now='2026-08-13T16:00:00.000Z',nowMs=Date.parse(now),times=seconds=>seconds.map(x=>new Date(nowMs-x*1000).toISOString());
 const anchored=continuityMaturityPriority({poolAddress:'ANCHOR',observedAt:now,liveObservationTimes:times([620,300,120,0]),tierARank:9,candidateUtility:0});
 const unanchored=continuityMaturityPriority({poolAddress:'NO_ANCHOR',observedAt:now,liveObservationTimes:times([300,120,0]),tierARank:1,candidateUtility:9});
 assert.equal(anchored.anchorPresent,true);assert.ok(compareContinuityMaturityPriority(anchored,unanchored)<0);
 const ranked=continuityMaturityPriority({poolAddress:'RANKED',observedAt:now,liveObservationTimes:times([285,180,90,0]),tierARank:1,candidateUtility:0});
 const lowerRank=continuityMaturityPriority({poolAddress:'LOWER',observedAt:now,liveObservationTimes:times([285,180,90,0]),tierARank:2,candidateUtility:9});
 assert.ok(compareContinuityMaturityPriority(ranked,lowerRank)<0);
 const higherUtility=continuityMaturityPriority({poolAddress:'UTILITY',observedAt:now,liveObservationTimes:times([285,180,90,0]),tierARank:1,candidateUtility:2});
 assert.ok(compareContinuityMaturityPriority(higherUtility,ranked)<0);
 const alpha=continuityMaturityPriority({poolAddress:'ALPHA',observedAt:now,liveObservationTimes:times([285,180,90,0]),tierARank:1,candidateUtility:2,trackingStartedAt:'2026-08-13T15:55:00.000Z'});
 const beta=continuityMaturityPriority({poolAddress:'BETA',observedAt:now,liveObservationTimes:times([285,180,90,0]),tierARank:1,candidateUtility:2,trackingStartedAt:'2026-08-13T15:55:00.000Z'});
 assert.ok(compareContinuityMaturityPriority(alpha,beta)<0);
});
test('cap two remains safe while cap three has no 450-second scheduling headroom',()=>{
 const capTwo=assessCollectorRevisitBudget({activePoolCount:4,collectionSliceSize:4,maxConcurrentPoolReads:1,p95PoolCollectionMs:90_000,revisitBudgetMs:450_000});
 const capThree=assessCollectorRevisitBudget({activePoolCount:5,collectionSliceSize:5,maxConcurrentPoolReads:1,p95PoolCollectionMs:90_000,revisitBudgetMs:450_000});
 assert.deepEqual(capTwo,{projectedRevisitMs:360_000,capacityViolation:false});
 assert.deepEqual(capThree,{projectedRevisitMs:450_000,capacityViolation:false});
 assert.equal(EVIDENCE_CONTINUITY_TRACKING_CAP,2,'the production continuity cap remains two');
});
test('completion accounting never adds a nominal sleep after an overrun',()=>{
 assert.equal(completionAwareCollectorDelayMs({passStartedAtMs:0,passCompletedAtMs:108_000,nominalIntervalMs:60_000}),0);
 assert.equal(completionAwareCollectorDelayMs({passStartedAtMs:0,passCompletedAtMs:45_000,nominalIntervalMs:60_000}),15_000);
});
test('slow measured reads reduce effective serviceability and expose a revisit violation instead of admitting more leases',()=>{
 const serviceable=calculateServiceableActiveCandidateCapacity({p3BudgetRps:3,estimatedP3CallsPerPool:12,p95PoolCollectionMs:100_000,maxConcurrentPoolReads:1,targetCoverageMs:180_000,serviceabilitySafetyMargin:.70,hardCap:30});
 assert.equal(serviceable,1);
 const slice=calculateCompletionAwareCollectionSliceSize({activePoolCount:2,serviceableCapacity:serviceable,p95PoolCollectionMs:100_000,maxConcurrentPoolReads:1,revisitBudgetMs:180_000,hardCap:30});
 assert.equal(slice,1);
 assert.equal(assessCollectorRevisitBudget({activePoolCount:2,collectionSliceSize:slice,maxConcurrentPoolReads:1,p95PoolCollectionMs:100_000,revisitBudgetMs:180_000}).capacityViolation,true);
});
test('completion-aware rotation is restart-safe and cannot permanently bias the first active pool',()=>{
 const pools=['A','B'].map(poolAddress=>({poolAddress,state:'ACTIVE_CANDIDATE'}));
 const beforeRestart=selectActiveCandidateCollectionSlice(pools,1,'2026-08-13T16:00:00.000Z',60_000),afterRestart=selectActiveCandidateCollectionSlice(pools,1,'2026-08-13T16:01:00.000Z',60_000);
 assert.deepEqual(new Set([...beforeRestart,...afterRestart].map(x=>x.poolAddress)),new Set(['A','B']));
});
test('cap two with one RPC reader collects both active leases in the same completion-aware pass',async()=>{
 const candidates=['A','B'].map(poolAddress=>({poolAddress,state:'ACTIVE_CANDIDATE',tier:'A',priorityScore:1,lastSeenAt:at,payload:{}})),writes=[];
 const store={listDiscoveryCandidates:async()=>candidates,insertPoolSnapshot:async()=>{},insertBins:async()=>{},insertDataApiPool:async()=>{},insertOhlcv:async()=>{},insertFeeVolumeObservations:async()=>{},loadFeeVolumeObservations:async()=>feeBuckets(48).map(x=>({bucketAt:new Date(x.timestamp*1000).toISOString(),fees:x.fees,protocolFees:x.protocol_fees,volume:x.volume})),insertCandidateMarketObservations:async()=>{},loadCandidateMarketObservations:async()=>[{observedAt:at,sourceType:'HISTORICAL_API_BACKFILL',sourceProvider:'test',price:1,resolutionMs:300000}],loadActiveCandidateBackfill:async()=>({last_successful_at:at}),upsertActiveCandidateBackfill:async()=>{},insertSwapEvent:async()=>{},loadOperationalHistory:async()=>history(61),upsertActiveCandidateHistoryMaturity:async()=>{},insertEconomicEstimate:async()=>{},recordActiveCandidateEvidenceCollectorPass:async x=>writes.push(x)};
 const api={getPool:async address=>({address,tvl:100000}),getHistoricalVolume:async()=>({data:feeBuckets(48)}),getOhlcv:async()=>({data:[]})},adapter={getPool:async address=>({address,activeBinId:1}),getBinsAroundActive:async()=>[],decodeEvents:async()=>[]},rpc={getSignaturesForAddress:async()=>[],getTransaction:async()=>null};
 const result=await collectActiveCandidateEvidence({api,adapter,rpc,store,observedAt:new Date().toISOString(),policy:{maxConcurrentPoolReads:1,p95PoolCollectionMs:90_000,liveConfirmationTargetCoverageMs:180_000}});
 assert.equal(result.serviceableCapacity,2);assert.equal(result.collectionSliceSize,2);assert.equal(result.results.length,2);assert.equal(result.capacityViolation,false);assert.equal(writes.length,1);
});
test('two continuity trackers preserve full-frame collection through cooldown without becoming economic leases',async()=>{
 const candidates=[
  {poolAddress:'A',state:'ACTIVE_CANDIDATE',tier:'A',priorityScore:2,lastSeenAt:at,payload:{}},
  {poolAddress:'B',state:'ACTIVE_CANDIDATE',tier:'A',priorityScore:1,lastSeenAt:at,payload:{}},
  {poolAddress:'CONT_A',state:'QUALIFIED',tier:'A',priorityScore:0,lastSeenAt:at,payload:{evidenceContinuityTrackingState:'TRACKING'}},
  {poolAddress:'CONT_B',state:'QUALIFIED',tier:'A',priorityScore:0,lastSeenAt:at,payload:{evidenceContinuityTrackingState:'TRACKING'}},
 ],live=[],continuity=[];
 const store={listDiscoveryCandidates:async()=>candidates,reconcileLiveEvidenceAdmission:async()=>({}),reconcileEvidenceContinuityTracking:async()=>({capacity:2,trackedPoolAddresses:['CONT_A','CONT_B'],expiredPoolAddresses:[],evictedPoolAddresses:['CONT_C']}),insertPoolSnapshot:async()=>{},insertBins:async()=>{},insertDataApiPool:async()=>{},insertOhlcv:async()=>{},insertFeeVolumeObservations:async()=>{},loadFeeVolumeObservations:async()=>feeBuckets(48).map(x=>({bucketAt:new Date(x.timestamp*1000).toISOString(),fees:x.fees,protocolFees:x.protocol_fees,volume:x.volume})),insertCandidateMarketObservations:async()=>{},loadCandidateMarketObservations:async()=>[{observedAt:at,sourceType:'HISTORICAL_API_BACKFILL',sourceProvider:'test',price:1,resolutionMs:300000}],loadActiveCandidateBackfill:async()=>({last_successful_at:at}),upsertActiveCandidateBackfill:async()=>{},insertSwapEvent:async()=>{},loadOperationalHistory:async()=>history(61),upsertActiveCandidateHistoryMaturity:async()=>{},insertEconomicEstimate:async()=>{},recordLiveEvidenceCollectionOutcome:async x=>live.push(x),recordEvidenceContinuityCollectionOutcome:async x=>continuity.push(x),recordActiveCandidateEvidenceCollectorPass:async()=>{}};
 const api={getPool:async address=>({address,tvl:100000}),getHistoricalVolume:async()=>({data:feeBuckets(48)}),getOhlcv:async()=>({data:[]})},adapter={getPool:async address=>({address,activeBinId:1}),getBinsAroundActive:async()=>[],decodeEvents:async()=>[]},rpc={getSignaturesForAddress:async()=>[],getTransaction:async()=>null};
 const result=await collectActiveCandidateEvidence({api,adapter,rpc,store,observedAt:new Date().toISOString(),policy:{maxConcurrentPoolReads:1,p95PoolCollectionMs:90_000,liveConfirmationTargetCoverageMs:180_000,liveConfirmationMaxGapMs:450_000}});
 assert.equal(result.serviceableCapacity,2);assert.equal(result.economicCollectionSliceSize,2);assert.equal(result.continuityCollectionSliceSize,2);assert.equal(result.collectionSliceSize,4);assert.equal(result.results.filter(x=>x.collectionTarget==='ACTIVE_ECONOMIC').length,2);assert.equal(result.results.filter(x=>x.collectionTarget==='EVIDENCE_CONTINUITY').length,2);assert.equal(live.length,2);assert.equal(continuity.length,2);assert.equal(result.continuity?.capacity,2);assert.deepEqual(result.continuity?.evictedPoolAddresses,['CONT_C']);assert.equal(result.capacityViolation,false);
});
test('serviceable admission is bounded by measured p95 collection cadence before RPC headroom',()=>{
 const capacity=calculateServiceableActiveCandidateCapacity({p3BudgetRps:3,estimatedP3CallsPerPool:12,p95PoolCollectionMs:90_000,maxConcurrentPoolReads:3,targetCoverageMs:180_000,serviceabilitySafetyMargin:.70,hardCap:30});
 assert.equal(capacity,6);
 assert.equal(calculateServiceableActiveCandidateCapacity({p3BudgetRps:3,estimatedP3CallsPerPool:12,p95PoolCollectionMs:90_000,maxConcurrentPoolReads:3,targetCoverageMs:180_000,serviceabilitySafetyMargin:.70,hardCap:4}),4);
});

test('static policy monitoring does not consume dynamic active admission slots',()=>{
 assert.equal(dynamicLiveEvidenceAdmissionCapacity({serviceableCapacity:2,staticPolicyPoolCount:5}),2);
});

test('economic NO_TRADE remains eligible for reserve observation and later dynamic admission',()=>{
 assert.equal(isLiveEvidenceAdmissionTerminal('NO_TRADE'),false);
 assert.equal(isLiveEvidenceAdmissionTerminal('ENTRY_READY'),true);
 const candidate={poolAddress:'economic-no-trade',state:'QUALIFIED',priorityScore:1,firstSeenAt:at,matureForPhase3:false,phase3Terminal:isLiveEvidenceAdmissionTerminal('NO_TRADE')};
 assert.deepEqual(selectLiveEvidenceAdmissionCandidates([candidate],1).map(x=>x.poolAddress),['economic-no-trade']);
});

test('a completed and cooled QUALIFIED lease can begin fresh evidence despite an auditable prior ENTRY_READY',()=>{
 assert.equal(isLiveEvidenceAdmissionTerminalForCurrentLease({state:'ACTIVE_CANDIDATE',phase3Status:'ENTRY_READY'}),true);
 assert.equal(isLiveEvidenceAdmissionTerminalForCurrentLease({state:'QUALIFIED',phase3Status:'ENTRY_READY'}),false);
});

test('confirmed mature QUALIFIED pool retains a bounded collector slot for fresh Phase-3 economics',()=>{
 const candidates=[
  {poolAddress:'ordinary-active',state:'ACTIVE_CANDIDATE',priorityScore:99,rank:1,firstSeenAt:'2026-08-13T15:00:00.000Z',matureForPhase3:false,phase3Terminal:false},
  {poolAddress:'mature-qualified',state:'QUALIFIED',priorityScore:1,rank:9,firstSeenAt:'2026-08-13T14:00:00.000Z',matureForPhase3:true,phase3Terminal:false},
  {poolAddress:'waiting-qualified',state:'QUALIFIED',priorityScore:98,rank:2,firstSeenAt:'2026-08-13T15:01:00.000Z',matureForPhase3:false,phase3Terminal:false},
 ];
 const admitted=selectLiveEvidenceAdmissionCandidates(candidates,1);
 assert.deepEqual(admitted.map(x=>x.poolAddress),['mature-qualified']);
 // With healthy serviceability the collector refreshes this slot before the
 // unchanged 300-second Phase-3 economics freshness boundary.
 assert.ok(decisionTimeEconomicEvidenceAgeSeconds({estimateAsOf:at,storedEvidenceAgeSeconds:0,decisionAt:'2026-08-13T16:04:59.000Z'})<=300);
 assert.ok(decisionTimeEconomicEvidenceAgeSeconds({estimateAsOf:at,storedEvidenceAgeSeconds:0,decisionAt:'2026-08-13T16:05:01.000Z'})>300);
});

test('terminal active release promotes one waiting qualified pool without over-admitting',()=>{
 const waiting=[
  {poolAddress:'terminal-active',state:'ACTIVE_CANDIDATE',priorityScore:99,rank:1,firstSeenAt:'2026-08-13T13:00:00.000Z',matureForPhase3:true,phase3Terminal:true},
  {poolAddress:'next-qualified',state:'QUALIFIED',priorityScore:20,rank:1,firstSeenAt:'2026-08-13T14:00:00.000Z',matureForPhase3:false,phase3Terminal:false},
  {poolAddress:'later-qualified',state:'QUALIFIED',priorityScore:10,rank:2,firstSeenAt:'2026-08-13T13:00:00.000Z',matureForPhase3:false,phase3Terminal:false},
 ];
 assert.deepEqual(selectLiveEvidenceAdmissionCandidates(waiting,1).map(x=>x.poolAddress),['next-qualified']);
 assert.equal(selectLiveEvidenceAdmissionCandidates(waiting,1).length,1,'waiting pools do not all become active when one slot frees');
});

test('fresh comparable economics rank fee quality, inventory risk, then uncertainty without becoming an admission gate',()=>{
 const base={state:'QUALIFIED',priorityScore:10,firstSeenAt:'2026-08-13T14:00:00.000Z',matureForPhase3:false,phase3Terminal:false};
 const quality=(fee,inventory,uncertainty)=>({eventPathAsOf:'2026-08-13T15:59:00.000Z',forecastAsOf:'2026-08-13T15:59:30.000Z',feeRatePerCapitalHour:fee,adverseInventoryPressure:inventory,forecastUncertainty:uncertainty});
 assert.deepEqual(selectLiveEvidenceAdmissionCandidates([{...base,poolAddress:'low-fee',economicQuality:quality(.001,.2,.2)},{...base,poolAddress:'high-fee',economicQuality:quality(.002,.9,.9)}],1).map(x=>x.poolAddress),['high-fee']);
 assert.deepEqual(selectLiveEvidenceAdmissionCandidates([{...base,poolAddress:'higher-inventory-risk',economicQuality:quality(.002,.8,.2)},{...base,poolAddress:'lower-inventory-risk',economicQuality:quality(.002,.2,.9)}],1).map(x=>x.poolAddress),['lower-inventory-risk']);
 assert.deepEqual(selectLiveEvidenceAdmissionCandidates([{...base,poolAddress:'higher-uncertainty',economicQuality:quality(.002,.2,.8)},{...base,poolAddress:'lower-uncertainty',economicQuality:quality(.002,.2,.3)}],1).map(x=>x.poolAddress),['lower-uncertainty']);
});

test('economic admission preserves bounded bootstrap access and rejects stale economic ranking facts',()=>{
 const base={state:'QUALIFIED',priorityScore:10,firstSeenAt:'2026-08-13T14:00:00.000Z',matureForPhase3:false,phase3Terminal:false};
 const quality={eventPathAsOf:'2026-08-13T15:59:00.000Z',forecastAsOf:'2026-08-13T15:59:30.000Z',feeRatePerCapitalHour:.002,adverseInventoryPressure:.2,forecastUncertainty:.3};
 assert.equal(freshLiveEvidenceEconomicQuality(quality,at)?.feeRatePerCapitalHour,.002);
 assert.equal(freshLiveEvidenceEconomicQuality({eventPathAsOf:'2026-08-13T15:59:00.000Z',forecastAsOf:'2026-08-13T15:59:30.000Z',feeRatePerCapitalHour:.002},at)?.feeRatePerCapitalHour,.002,'fresh event-path fee quality remains rankable when optional secondary risk metadata has not yet been produced');
 assert.equal(freshLiveEvidenceEconomicQuality({...quality,forecastAsOf:'2026-08-13T15:00:00.000Z'},at)?.feeRatePerCapitalHour,.002,'the separately collected risk descriptor cannot make fresh event-path economics unusable');
 assert.equal(freshLiveEvidenceEconomicQuality({...quality,eventPathAsOf:'2026-08-13T15:54:59.000Z'},at),undefined,'stale event-path evidence cannot rank admission');
 const selected=selectLiveEvidenceAdmissionCandidates([{...base,poolAddress:'bootstrap',rank:1},{...base,poolAddress:'economic',rank:2,economicQuality:quality}],2);
 assert.deepEqual(selected.map(x=>x.poolAddress),['bootstrap','economic']);
 assert.equal(selected.length,2,'economic preference cannot exceed bounded capacity');
});

test('fresh discovery economics can safely replace a sufficiently old lower-priority active lease',()=>{
 const base={priorityScore:10,firstSeenAt:'2026-08-13T14:00:00.000Z',matureForPhase3:false,phase3Terminal:false};
 const selected=selectLiveEvidenceAdmissionCandidates([
  {...base,poolAddress:'incumbent',state:'ACTIVE_CANDIDATE',evidenceLeaseActive:true,activeDwellMs:LIVE_EVIDENCE_MIN_ACTIVE_DWELL_MS+1,economicPriority:30,evidencePriority:30},
  {...base,poolAddress:'challenger',state:'QUALIFIED',economicPriority:60,evidencePriority:60},
 ],1);
 assert.deepEqual(selected.map(x=>x.poolAddress),['challenger']);
});

test('live-evidence replacement honors hysteresis, dwell, and critical-consumption protection',()=>{
 const base={priorityScore:10,firstSeenAt:'2026-08-13T14:00:00.000Z',matureForPhase3:false,phase3Terminal:false};
 const near=selectLiveEvidenceAdmissionCandidates([
  {...base,poolAddress:'incumbent',state:'ACTIVE_CANDIDATE',evidenceLeaseActive:true,activeDwellMs:LIVE_EVIDENCE_MIN_ACTIVE_DWELL_MS+1,evidencePriority:50},
  {...base,poolAddress:'near',state:'QUALIFIED',evidencePriority:61},
 ],1);
 assert.deepEqual(near.map(x=>x.poolAddress),['incumbent']);
 const protectedSelected=selectLiveEvidenceAdmissionCandidates([
  {...base,poolAddress:'critical',state:'ACTIVE_CANDIDATE',evidenceLeaseActive:true,activeDwellMs:LIVE_EVIDENCE_MIN_ACTIVE_DWELL_MS+1,protectedCriticalConsumption:true,evidencePriority:10},
  {...base,poolAddress:'high',state:'QUALIFIED',evidencePriority:99},
 ],1);
 assert.deepEqual(protectedSelected.map(x=>x.poolAddress),['critical']);
});

test('active WARMING continuity trackers retain both slots through economic rotation while a third pool waits',()=>{
 const base={priorityScore:10,firstSeenAt:'2026-08-13T14:00:00.000Z',matureForPhase3:false,phase3Terminal:false,state:'ACTIVE_CANDIDATE',evidenceLeaseActive:true,activeDwellMs:LIVE_EVIDENCE_MIN_ACTIVE_DWELL_MS+1,protectedCriticalConsumption:true};
 const selected=selectLiveEvidenceAdmissionCandidates([
  {...base,poolAddress:'warming-a',evidencePriority:10},
  {...base,poolAddress:'warming-b',evidencePriority:11},
  {...base,poolAddress:'waiting-c',state:'QUALIFIED',evidenceLeaseActive:false,protectedCriticalConsumption:false,evidencePriority:99},
 ],2);
 assert.deepEqual(new Set(selected.map(x=>x.poolAddress)),new Set(['warming-a','warming-b']));
 assert.equal(selected.includes(selected.find(x=>x.poolAddress==='waiting-c')),false,'the waiting pool cannot displace a protected WARMING episode');
});

test('discovery economic priority has explicit bounded freshness',()=>{
 assert.equal(freshDiscoveryEconomicPriority({priority:75,observedAt:'2026-08-13T15:55:00.000Z'},at),75);
 assert.equal(freshDiscoveryEconomicPriority({priority:75,observedAt:'2026-08-13T15:49:59.999Z'},at),undefined);
 assert.equal(freshDiscoveryEconomicPriority({priority:75,observedAt:'not-a-date'},at),undefined);
});

test('active candidate collector has no starvation across repeated rounds',()=>{
 const pools=['A','B','C','D'].map(poolAddress=>({poolAddress})),interval=60_000;
 const first=selectActiveCandidateCollectionSlice(pools,1,'2026-08-13T16:00:00.000Z',interval),second=selectActiveCandidateCollectionSlice(pools,1,'2026-08-13T16:01:00.000Z',interval),third=selectActiveCandidateCollectionSlice(pools,1,'2026-08-13T16:02:00.000Z',interval),fourth=selectActiveCandidateCollectionSlice(pools,1,'2026-08-13T16:03:00.000Z',interval);
 assert.deepEqual(new Set([...first,...second,...third,...fourth].map(x=>x.poolAddress)),new Set(['A','B','C','D']));
});

test('new active candidates join the next deterministic collection round fairly',()=>{
 const interval=60_000,initial=Array.from({length:8},(_,i)=>({poolAddress:`P${i}`,state:'ACTIVE_CANDIDATE'})),joined=[...initial,{poolAddress:'P8',state:'ACTIVE_CANDIDATE'}];
 const batches=[0,1,2].map(offset=>selectActiveCandidateCollectionSlice(joined,4,new Date(atMs+offset*interval).toISOString(),interval));
 assert.ok(batches.flat().some(x=>x.poolAddress==='P8'));
 assert.equal(new Set(batches.flat().map(x=>x.poolAddress)).size,9);
});

test('production-monitored pools lead a round without starving active candidates',()=>{
 const interval=60_000,roundStart='1970-01-01T00:00:00.000Z',pools=[{poolAddress:'Z-monitor',state:'PRODUCTION_MONITORED'},...Array.from({length:7},(_,i)=>({poolAddress:`A${i}`,state:'ACTIVE_CANDIDATE'}))];
 const first=selectActiveCandidateCollectionSlice(pools,4,roundStart,interval),second=selectActiveCandidateCollectionSlice(pools,4,new Date(Date.parse(roundStart)+interval).toISOString(),interval);
 assert.equal(first[0].poolAddress,'Z-monitor');
 assert.equal(new Set([...first,...second].map(x=>x.poolAddress)).size,8);
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
test('event-path estimate requires three independent fifteen-minute episodes while retaining raw-evidence floors',async()=>{
 const twoEpisodes=await deriveEventPathEconomicEstimate({poolAddress:'P',asOf:at,dataApiPool:{address:'P',tvl:100000},feeBuckets:episodeFeeBuckets(2,6),history:history(61)});
 const threeEpisodes=await deriveEventPathEconomicEstimate({poolAddress:'P',asOf:at,dataApiPool:{address:'P',tvl:100000},feeBuckets:episodeFeeBuckets(3),history:history(61)});
 const insufficientFees=await deriveEventPathEconomicEstimate({poolAddress:'P',asOf:at,dataApiPool:{address:'P',tvl:100000},feeBuckets:episodeFeeBuckets(3).slice(0,11),history:history(61)});
 const insufficientPath=await deriveEventPathEconomicEstimate({poolAddress:'P',asOf:at,dataApiPool:{address:'P',tvl:100000},feeBuckets:episodeFeeBuckets(3),history:history(11)});
 assert.equal(twoEpisodes.independentEpisodeCount,2);assert.equal(twoEpisodes.fidelity,'AGGREGATE_ESTIMATE');
 assert.equal(threeEpisodes.independentEpisodeCount,3);assert.equal(threeEpisodes.fidelity,'EVENT_PATH_ESTIMATE');
 assert.equal(insufficientFees.fidelity,'AGGREGATE_ESTIMATE');assert.equal(insufficientPath.fidelity,'AGGREGATE_ESTIMATE');
});
test('bounded collector observes every active candidate and production-monitored supplemental pool while one failure does not starve peers',async()=>{
 const writes=[];const candidates=['A','B','C'].map(poolAddress=>({poolAddress,state:'ACTIVE_CANDIDATE',tier:'A',priorityScore:1,lastSeenAt:at,payload:{}}));
 let historicalRequests=0;const store={listDiscoveryCandidates:async()=>candidates,insertPoolSnapshot:async()=>{},insertBins:async()=>{},insertDataApiPool:async()=>{},insertOhlcv:async()=>{},insertFeeVolumeObservations:async()=>{},loadFeeVolumeObservations:async()=>feeBuckets(48).map(x=>({bucketAt:new Date(x.timestamp*1000).toISOString(),fees:x.fees,protocolFees:x.protocol_fees,volume:x.volume})),insertCandidateMarketObservations:async()=>{},loadCandidateMarketObservations:async()=>[],loadActiveCandidateBackfill:async()=>({last_successful_at:at}),upsertActiveCandidateBackfill:async()=>{},insertSwapEvent:async()=>{},loadOperationalHistory:async pool=>history(61),upsertActiveCandidateHistoryMaturity:async x=>writes.push(x),insertEconomicEstimate:async()=>{}};
 const api={getPool:async address=>{if(address==='B')throw new Error('slow pool failure');return{address,tvl:100000};},getHistoricalVolume:async()=>{historicalRequests++;return{data:feeBuckets(48)};},getOhlcv:async()=>({data:[]})};
 const adapter={getPool:async address=>({address,activeBinId:1}),getBinsAroundActive:async()=>[],decodeEvents:async()=>[]};const rpc={getSignaturesForAddress:async()=>[],getTransaction:async()=>null};
 const result=await collectActiveCandidateEvidence({api,adapter,rpc,store,observedAt:at,policy:{maxConcurrentPoolReads:2,p95PoolCollectionMs:10_000,liveConfirmationTargetCoverageMs:60_000,supplementalPoolAddresses:['MANUAL']}});
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

test('active evidence lease prevents incomplete evidence attempts from being preempted',()=>{
 const started='2026-08-13T16:00:00.000Z',expires=liveEvidenceLeaseExpiresAt(started);
 assert.equal(Date.parse(expires)-Date.parse(started),ACTIVE_EVIDENCE_LEASE_TIMEOUT_MS);
 assert.equal(isLiveEvidenceLeaseActive({startedAt:started,expiresAt:expires,failureCount:0},'2026-08-13T16:30:00.000Z'),true);
 assert.equal(isLiveEvidenceLeaseActive({startedAt:started,expiresAt:expires,failureCount:0},'2026-08-13T16:45:00.000Z'),false);
 const candidates=[
  {poolAddress:'leased-a',state:'ACTIVE_CANDIDATE',priorityScore:1,rank:99,firstSeenAt:started,matureForPhase3:false,phase3Terminal:false,evidenceLeaseActive:true},
  {poolAddress:'leased-b',state:'ACTIVE_CANDIDATE',priorityScore:1,rank:98,firstSeenAt:started,matureForPhase3:false,phase3Terminal:false,evidenceLeaseActive:true},
  {poolAddress:'higher-ranked-waiter',state:'QUALIFIED',priorityScore:999,rank:1,firstSeenAt:at,matureForPhase3:false,phase3Terminal:false},
 ];
 assert.deepEqual(new Set(selectLiveEvidenceAdmissionCandidates(candidates,2).map(x=>x.poolAddress)),new Set(['leased-a','leased-b']));
});

test('a newly admitted active candidate receives a bounded lease before its first collection',()=>{
 const started='2026-08-13T16:00:00.000Z',expires=liveEvidenceLeaseExpiresAt(started);
 assert.ok(expires);
 assert.equal(isLiveEvidenceLeaseActive({startedAt:started,expiresAt:expires,failureCount:0},'2026-08-13T16:00:01.000Z'),true);
 assert.equal(liveEvidenceLeaseReleaseReason({state:'ACTIVE_CANDIDATE',startedAt:started,expiresAt:expires,failureCount:0},'2026-08-13T16:00:01.000Z'),undefined);
});

test('completed, terminal, failed, or timed-out leases release a bounded slot to the next eligible waiter',()=>{
 const waiting=[
  {poolAddress:'released',state:'QUALIFIED',priorityScore:99,rank:1,firstSeenAt:at,matureForPhase3:false,phase3Terminal:false,admissionEligible:false},
  {poolAddress:'next-qualified',state:'QUALIFIED',priorityScore:20,rank:2,firstSeenAt:at,matureForPhase3:false,phase3Terminal:false},
  {poolAddress:'later-qualified',state:'QUALIFIED',priorityScore:10,rank:3,firstSeenAt:at,matureForPhase3:false,phase3Terminal:false},
 ];
 assert.deepEqual(selectLiveEvidenceAdmissionCandidates(waiting,1).map(x=>x.poolAddress),['next-qualified']);
 assert.equal(selectLiveEvidenceAdmissionCandidates([{...waiting[1],phase3Terminal:true},{...waiting[2]}],1)[0].poolAddress,'later-qualified');
});

test('lease release reasons are bounded to completion, terminal state, failure limit, or expiry',()=>{
 const started='2026-08-13T16:00:00.000Z',expires=liveEvidenceLeaseExpiresAt(started),base={state:'ACTIVE_CANDIDATE',startedAt:started,expiresAt:expires,failureCount:0};
 assert.equal(liveEvidenceLeaseReleaseReason(base,'2026-08-13T16:30:00.000Z'),undefined);
 assert.equal(liveEvidenceLeaseReleaseReason({...base,eventPathEstimateFresh:true},'2026-08-13T16:30:00.000Z'),undefined,'EVENT_PATH alone retains the ACTIVE lease');
 assert.equal(liveEvidenceLeaseReleaseReason({...base,eventPathEstimateFresh:true,phase3CurrentLiveReady:true},'2026-08-13T16:30:00.000Z'),undefined,'ready evidence retains the ACTIVE lease until real economics');
 assert.equal(isPhase3ReadyConsumptionPending({liveEvidencePhase3ConsumptionState:'PENDING',liveEvidencePhase3ReadyAt:'2026-08-13T16:20:00.000Z',liveEvidenceLeaseExpiresAt:expires},'2026-08-13T16:30:00.000Z'),true);
 assert.equal(liveEvidenceLeaseReleaseReason({...base,phase3Status:'NO_TRADE'},'2026-08-13T16:30:00.000Z'),'LIVE_EVIDENCE_LEASE_TERMINAL_PHASE3');
 assert.equal(liveEvidenceLeaseReleaseReason({...base,failureCount:3},'2026-08-13T16:30:00.000Z'),'LIVE_EVIDENCE_LEASE_COLLECTION_FAILURE_LIMIT');
 assert.equal(liveEvidenceLeaseReleaseReason(base,'2026-08-13T16:45:00.000Z'),'LIVE_EVIDENCE_LEASE_TIMEOUT');
});


test('lease completion reuses Phase-3 live readiness rather than releasing on event-path evidence alone',()=>{
 const assessedAt='2026-08-13T16:00:00.000Z',base={historicalState:'MATURE',historicalBackfillQuality:'SUFFICIENT'};
 const one=summarizePhase3RecentLiveObservations(assessedAt,['2026-08-13T15:59:30.000Z']);
 const two=summarizePhase3RecentLiveObservations(assessedAt,['2026-08-13T15:53:00.000Z','2026-08-13T15:59:30.000Z']);
 const three=summarizePhase3RecentLiveObservations(assessedAt,['2026-08-13T15:46:00.000Z','2026-08-13T15:52:30.000Z','2026-08-13T15:59:30.000Z']);
 const stale=summarizePhase3RecentLiveObservations(assessedAt,['2026-08-13T15:46:00.000Z','2026-08-13T15:52:30.000Z','2026-08-13T15:56:50.000Z']);
 const badGap=summarizePhase3RecentLiveObservations(assessedAt,['2026-08-13T15:45:00.000Z','2026-08-13T15:52:30.000Z','2026-08-13T15:59:30.000Z']);
 assert.equal(hasPhase3FreshHistoricalEvidence({...base,...one}),false);
 assert.equal(hasPhase3FreshHistoricalEvidence({...base,...two}),false);
 assert.equal(hasPhase3FreshHistoricalEvidence({...base,...three}),true);
 assert.equal(hasPhase3FreshHistoricalEvidence({...base,...stale}),false);
 assert.equal(hasPhase3FreshHistoricalEvidence({...base,...badGap}),false);
});

test('post-evidence handoff is bounded by existing economic freshness and does not occupy an ACTIVE slot',()=>{
 const eligibleAt='2026-08-13T16:00:00.000Z',expires=new Date(Date.parse(eligibleAt)+POST_EVIDENCE_EVALUATION_WINDOW_MS).toISOString(),payload={postEvidenceEvaluationState:'ELIGIBLE',postEvidenceEvaluationEligibleAt:eligibleAt,postEvidenceEvaluationExpiresAt:expires};
 assert.equal(POST_EVIDENCE_EVALUATION_WINDOW_MS,300_000);
 assert.equal(isPostEvidenceEvaluationEligible(payload,'2026-08-13T16:04:59.999Z'),true);
 assert.equal(isPostEvidenceEvaluationEligible(payload,expires),false);
 assert.equal(isPostEvidenceEvaluationEligible({postEvidenceEvaluationState:'COMPLETED',postEvidenceEvaluationExpiresAt:expires},eligibleAt),false);
});

test('retained continuity uses a successful-observation deadline with 150-second service headroom',()=>{
 const last='2026-09-04T21:58:57.543Z',deadlines=evidenceContinuityDeadlines(last,450_000);
 assert.equal(EVIDENCE_CONTINUITY_SERVICE_HEADROOM_MS,150_000);
 assert.equal(new Date(deadlines.logicalDeadlineAtMs).toISOString(),'2026-09-04T22:06:27.543Z');
 assert.equal(new Date(deadlines.internalServiceDeadlineAtMs).toISOString(),'2026-09-04T22:03:57.543Z');
 assert.ok(deadlines.internalServiceDeadlineAtMs<deadlines.logicalDeadlineAtMs);
});

test('earliest internal continuity deadline preempts later-maturing ordinary tracker priority',()=>{
 const now='2026-09-04T22:00:00.000Z';
 const urgent=continuityMaturityPriority({poolAddress:'54SBY',observedAt:now,liveObservationTimes:['2026-09-04T21:58:57.543Z'],tierARank:99,candidateUtility:-1});
 const ordinary=continuityMaturityPriority({poolAddress:'OTHER',observedAt:now,liveObservationTimes:['2026-09-04T21:59:57.543Z'],tierARank:1,candidateUtility:10});
 assert.ok(compareContinuityMaturityPriority(urgent,ordinary)<0);
});

test('admission recognizes only ACTIVE_CANDIDATE and QUALIFIED among collector state controls',()=>{
 const states=['ACTIVE_CANDIDATE','QUALIFIED','PREFILTERED','OBSERVING','WAITING'].map((state,index)=>({poolAddress:state,state,priorityScore:10-index,firstSeenAt:at,matureForPhase3:state==='QUALIFIED',phase3Terminal:false,admissionEligible:state==='ACTIVE_CANDIDATE'||state==='QUALIFIED'}));
 const eligible=states.filter(candidate=>candidate.admissionEligible);
 assert.deepEqual(new Set(selectLiveEvidenceAdmissionCandidates(eligible,2).map(candidate=>candidate.state)),new Set(['ACTIVE_CANDIDATE','QUALIFIED']));
 assert.deepEqual(states.filter(candidate=>!candidate.admissionEligible).map(candidate=>candidate.state),['PREFILTERED','OBSERVING','WAITING']);
});

test('fresh continuity anchor excludes pre-admission raw observations from maturity',async()=>{
 const live=[-11,-10,-9,-8,-1,0].map(minutes=>({observedAt:new Date(atMs+minutes*60_000).toISOString(),sourceType:'LIVE_OBSERVED',sourceProvider:'test',price:1,resolutionMs:60_000}));
 const baseline={poolAddress:'FRESH',assessedAt:at,history:history(61),liveMarket:live,liveConfirmationMinutes:10,liveConfirmationMinObservations:4,liveConfirmationMaxGapMs:450_000};
 const legacy=await assessHistoryMaturity(baseline);
 const anchored=await assessHistoryMaturity({...baseline,liveConfirmationEpisodeAnchorAt:new Date(atMs-60_000).toISOString()});
 assert.equal(legacy.liveConfirmationState,'CONFIRMED');
 assert.equal(anchored.liveConfirmationState,'WARMING');
 assert.ok(anchored.reasonCodes.includes('ENTRY_LIVE_CONFIRMATION_PENDING'));
});
