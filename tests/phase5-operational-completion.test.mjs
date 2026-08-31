import test from 'node:test';import assert from 'node:assert/strict';
import {evaluateOperationalCycle,deriveAggregateRateEvidence,deriveEventPathRateEvidence,resolvePhase4DataCompleteness,OPERATIONAL_COMPLETION_POLICY_V1} from '../.build/packages/operational-runtime/src/index.js';
import {percentagePointsToFraction} from '../.build/packages/discovery-metrics/src/index.js';
import {fixtureBins,fixtureDataApiPool,fixturePool,fixtureSwaps} from '../.build/packages/test-fixtures/src/index.js';
const at='2026-08-12T12:00:00Z';const pool={...fixturePool,stamp:{...fixturePool.stamp,observedAt:at}};const bins=fixtureBins.map(b=>({...b,stamp:{...b.stamp,observedAt:at}}));
test('canonical fee/TVL percentage points convert once to decimal fractions',()=>{
 assert.equal(percentagePointsToFraction(.02),.0002);
 assert.equal(percentagePointsToFraction(.5),.005);
 assert.equal(percentagePointsToFraction(1),.01);
 assert.equal(percentagePointsToFraction(0),0);
 assert.equal(percentagePointsToFraction(undefined),undefined);
 assert.equal(percentagePointsToFraction(-.02),undefined);
});
test('aggregate economics converts canonical percentage points and prevents the 100x fee-rate error',()=>{
 const assessment={toxicityProbability:.2};const r=deriveAggregateRateEvidence({...fixtureDataApiPool,fee_tvl_ratio:{'1h':.02}},assessment,OPERATIONAL_COMPLETION_POLICY_V1);
 assert.equal(r.fidelity,'AGGREGATE_ESTIMATE');assert.equal(r.feeRatePerCapitalHour,.0002);assert.equal(r.uncertainty,.55);
 assert.equal(.03*r.feeRatePerCapitalHour,.000006,'0.03 SOL at 0.02% hourly fee/TVL is 0.000006 SOL, not 0.000600 SOL');
});
test('aggregate fee fallback does not double-convert direct fees divided by TVL',()=>{
 const assessment={toxicityProbability:.2};const r=deriveAggregateRateEvidence({address:'fallback',tvl:100_000,fees:{'1h':20}},assessment,OPERATIONAL_COMPLETION_POLICY_V1);
 assert.equal(r.feeRatePerCapitalHour,.0002);
});
test('event-path rate evidence is unchanged by aggregate percentage-point conversion',()=>{
 const assessment={toxicityProbability:.2};const r=deriveEventPathRateEvidence({fidelity:'EVENT_PATH_ESTIMATE',effectiveSampleCount:7,feeRatePerCapitalHour:.0002,uncertainty:.4,evidenceAgeSeconds:30,rawObservationCount:24,independentEpisodeCount:7,feeObservationCount:12,eventPathObservationCount:12},assessment,OPERATIONAL_COMPLETION_POLICY_V1);
 assert.equal(r.fidelity,'EVENT_PATH_ESTIMATE');assert.equal(r.feeRatePerCapitalHour,.0002);assert.equal(r.uncertainty,.4);
});
test('operational cycle warms instead of fabricating history',async()=>{const r=await evaluateOperationalCycle({observedAt:at,pool,bins,dataApiPool:fixtureDataApiPool,history:{marketObservations:[],activeBins:[],binFrames:[],swapEvents:[]},protocolCompatible:true,walletCapital:1});assert.equal(r.phase3Status,'WARMING');assert.equal(r.phase4Status,'WARMING');assert.equal(r.phase5Status,'NOT_REACHED');});
test('Phase 4 consumes collector-proven backfill plus live confirmation without lowering its .60 threshold',()=>{
 const mature=resolvePhase4DataCompleteness(.23,{state:'MATURE',historicalState:'MATURE',liveConfirmationState:'CONFIRMED'});
 assert.equal(mature.value,.60);assert.equal(mature.source,'BACKFILL_PLUS_LIVE_CONFIRMATION');
 for(const incomplete of [{state:'WARMING',historicalState:'MATURE',liveConfirmationState:'CONFIRMED'},{state:'MATURE',historicalState:'WARMING',liveConfirmationState:'CONFIRMED'},{state:'MATURE',historicalState:'MATURE',liveConfirmationState:'WARMING'}]){const r=resolvePhase4DataCompleteness(.23,incomplete);assert.equal(r.value,.23);assert.equal(r.source,'CURRENT_STREAM');}
});

test('operational decision may occur after current facts were observed',async()=>{const decisionAt='2026-08-12T12:00:05Z';const earlierPool={...pool,stamp:{...pool.stamp,observedAt:'2026-08-12T12:00:01Z'}};const earlierBins=bins.map(b=>({...b,stamp:{...b.stamp,observedAt:'2026-08-12T12:00:02Z'}}));const r=await evaluateOperationalCycle({observedAt:decisionAt,pool:earlierPool,bins:earlierBins,dataApiPool:fixtureDataApiPool,history:{marketObservations:[],activeBins:[],binFrames:[],swapEvents:[]},protocolCompatible:true,walletCapital:1});assert.equal(r.phase3Status,'WARMING');});
test('operational cycle still rejects a current pool fact observed after decision time',async()=>{const futurePool={...pool,stamp:{...pool.stamp,observedAt:'2026-08-12T12:00:01Z'}};await assert.rejects(()=>evaluateOperationalCycle({observedAt:at,pool:futurePool,bins,dataApiPool:fixtureDataApiPool,history:{marketObservations:[],activeBins:[],binFrames:[],swapEvents:[]},protocolCompatible:true,walletCapital:1}),/LOOKAHEAD_CURRENT_POOL/);});
test('operational cycle still rejects a current bin fact observed after decision time',async()=>{const futureBins=bins.map((b,i)=>i===0?({...b,stamp:{...b.stamp,observedAt:'2026-08-12T12:00:01Z'}}):b);await assert.rejects(()=>evaluateOperationalCycle({observedAt:at,pool,bins:futureBins,dataApiPool:fixtureDataApiPool,history:{marketObservations:[],activeBins:[],binFrames:[],swapEvents:[]},protocolCompatible:true,walletCapital:1}),/LOOKAHEAD_CURRENT_BIN/);});
test('operational cycle rejects lookahead history',async()=>{await assert.rejects(()=>evaluateOperationalCycle({observedAt:at,pool,bins,dataApiPool:fixtureDataApiPool,history:{marketObservations:[{observedAt:'2026-08-12T12:01:00Z',price:1,activeBinId:1}],activeBins:[],binFrames:[],swapEvents:[]},protocolCompatible:true,walletCapital:1}),/LOOKAHEAD_MARKET/);});
test('operational fixture reaches real P3 evaluation and carries its autonomous SOL funding decision when it selects an entry',async()=>{const start=Date.parse(at)-180*60000;const market=Array.from({length:181},(_,i)=>({observedAt:new Date(start+i*60000).toISOString(),price:100+Math.sin(i/12)*.3,activeBinId:fixturePool.activeBinId+Math.round(Math.sin(i/10)*3),volume:100,feeValue:.01,twoWayRatio:.8,localLiquidity:200000}));const activeBins=market.map(x=>({observedAt:x.observedAt,activeBinId:x.activeBinId}));const frames=[40,80,120,160].map(i=>({observedAt:market[i].observedAt,activeBinId:activeBins[i].activeBinId,bins:fixtureBins.map(b=>({binId:b.binId,price:b.price,amountX:b.amountX,amountY:b.amountY,...(b.liquiditySupply?{liquiditySupply:b.liquiditySupply}:{})}))}));const r=await evaluateOperationalCycle({observedAt:at,pool,bins,dataApiPool:fixtureDataApiPool,history:{marketObservations:market,activeBins,binFrames:frames,swapEvents:fixtureSwaps.map((e,i)=>({...e,stamp:{...e.stamp,observedAt:market[100+i].observedAt}}))},protocolCompatible:true,walletCapital:1,maxRangeWidthBins:61});assert.ok(r.shadow||r.reasonCodes.includes('CANDIDATE_REPLAY_ANCHOR_UNAVAILABLE'));assert.ok(['NO_TRADE','ENTRY_READY','PLAN_PREPARED'].includes(r.phase3Status)||r.phase3Status==='NO_TRADE');if(r.shadow?.thesis){assert.ok(r.entryFunding);assert.equal(r.entryFunding.strategy,r.shadow.thesis.selectedCandidate.strategy);if(r.entryFunding.strategy==='BID_ASK')assert.equal(r.entryFunding.solToPairedTokenLamports,0n);else if(r.entryFunding.orientation==='BALANCED')assert.equal(r.entryFunding.solToPairedTokenLamports,500_000_000n);else assert.ok(r.entryFunding.solToPairedTokenLamports<500_000_000n);}else assert.equal(r.entryFunding,undefined);assert.equal(r.plan,undefined);assert.notEqual(r.phase5Status,'PLAN_PREPARED_BUILD_ONLY');});
test('live operational path applies only the exact Phase 6 canonical USDC exception',async()=>{
  const canaryPoolAddress='5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6';
  const canonicalPool={...pool,address:canaryPoolAddress,tokenXMint:'So11111111111111111111111111111111111111112',tokenYMint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'};
  const apiPool={...fixtureDataApiPool,address:canaryPoolAddress,token_x:{address:'So11111111111111111111111111111111111111112',freeze_authority_disabled:true,is_verified:true,holders:1000000},token_y:{address:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',freeze_authority_disabled:false,is_verified:true,holders:1000000}};
  const r=await evaluateOperationalCycle({observedAt:at,pool:canonicalPool,bins,dataApiPool:apiPool,history:{marketObservations:[],activeBins:[],binFrames:[],swapEvents:[]},protocolCompatible:true,walletCapital:1});
  assert.equal(r.poolAssessment.policyId,'phase6-canary-pool-policy-v1');
  assert.ok(!r.poolAssessment.blockers.includes('FREEZE_AUTHORITY_ENABLED'));
  assert.ok(r.poolAssessment.warnings.includes('TRUSTED_FREEZE_AUTHORITY_EXCEPTION'));
  assert.equal(r.phase3Status,'WARMING');
});
