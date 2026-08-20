import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionTimeEconomicEvidenceAgeSeconds,evaluateOperationalCycle,hasConfirmedEvidenceMaturity,hasPhase3FreshHistoricalEvidence} from '../.build/packages/operational-runtime/src/index.js';
import {fixtureBins,fixtureDataApiPool,fixturePool,fixtureSwaps} from '../.build/packages/test-fixtures/src/index.js';

const at='2026-08-12T12:00:00.000Z';
const pool={...fixturePool,stamp:{...fixturePool.stamp,observedAt:at}};
const bins=fixtureBins.map(bin=>({...bin,stamp:{...bin.stamp,observedAt:at}}));
const productionCapitalPolicy={id:'test',reserveCapital:0,maxPortfolioCapital:1,maxTokenCapital:1,targetInitialPosition:0.1,maxInitialPosition:0.1,minInitialPosition:0.01};
const base={observedAt:at,pool,bins,dataApiPool:fixtureDataApiPool,history:{marketObservations:[],activeBins:[],binFrames:[],swapEvents:[]},protocolCompatible:true,walletCapital:1,productionCapitalPolicy,productionPoolCapital:1,planPreparationEnabled:true};
const freshHistory={marketObservations:Array.from({length:12},(_,i)=>({observedAt:new Date(Date.parse(at)-(11-i)*60_000).toISOString(),price:1+(i%3)*.001,activeBinId:100+(i%2),volume:100,feeValue:1,localLiquidity:100000})),activeBins:Array.from({length:12},(_,i)=>({observedAt:new Date(Date.parse(at)-(11-i)*60_000).toISOString(),activeBinId:100+(i%2)})),binFrames:Array.from({length:12},(_,i)=>({observedAt:new Date(Date.parse(at)-(11-i)*60_000).toISOString(),activeBinId:100+(i%2),bins:fixtureBins})),swapEvents:fixtureSwaps};

test('automatic capital path fails closed when maturity evidence is absent',async()=>{
 const result=await evaluateOperationalCycle(base);
 assert.equal(result.phase3Status,'WARMING');
 assert.ok(result.reasonCodes.includes('OPERATIONAL_EVIDENCE_MATURITY_MISSING'));
});

const phase3Fresh={state:'WARMING',historicalState:'MATURE',historicalBackfillQuality:'SUFFICIENT',liveConfirmationState:'PENDING',recentLiveObservationCount:3,latestLiveObservationAgeSeconds:120};

test('automatic capital path permits historically sufficient evidence with a few fresh live observations',async()=>{
 assert.equal(hasConfirmedEvidenceMaturity({state:'MATURE',historicalState:'MATURE',liveConfirmationState:'CONFIRMED'}),true);
 assert.equal(hasConfirmedEvidenceMaturity({state:'MATURE',historicalState:'MATURE',liveConfirmationState:'WARMING'}),false);
 assert.equal(hasPhase3FreshHistoricalEvidence(phase3Fresh),true);
 assert.equal(hasPhase3FreshHistoricalEvidence({...phase3Fresh,state:'MATURE',liveConfirmationState:'CONFIRMED'}),true);
 const result=await evaluateOperationalCycle({...base,evidenceMaturity:phase3Fresh});
 assert.equal(result.phase3Status,'WARMING');
 assert.ok(result.reasonCodes.includes('OPERATIONAL_ECONOMIC_EVIDENCE_MISSING'));
});

test('Phase 3 freshness admission fails closed for stale live facts or insufficient historical backfill',()=>{
 assert.equal(hasPhase3FreshHistoricalEvidence({...phase3Fresh,latestLiveObservationAgeSeconds:181}),false);
 assert.equal(hasPhase3FreshHistoricalEvidence({...phase3Fresh,historicalBackfillQuality:'PARTIAL'}),false);
 assert.equal(hasPhase3FreshHistoricalEvidence({...phase3Fresh,recentLiveObservationCount:2}),false);
});

test('partial live confirmation preserves its state while fresh historical evidence reaches a real Phase-3 outcome',async()=>{
 const result=await evaluateOperationalCycle({...base,history:freshHistory,evidenceMaturity:phase3Fresh,economicEvidence:{fidelity:'EVENT_PATH_ESTIMATE',effectiveSampleCount:7,feeRatePerCapitalHour:.001,uncertainty:.4,evidenceAgeSeconds:30,rawObservationCount:24,independentEpisodeCount:7,feeObservationCount:12,eventPathObservationCount:12}});
 assert.notEqual(result.phase3Status,'WARMING');
 assert.equal(result.evidence.maturity.liveConfirmationState,'PENDING');
});

test('stale event-path economics still blocks Phase 3 after freshness admission',async()=>{
 const result=await evaluateOperationalCycle({...base,history:freshHistory,evidenceMaturity:phase3Fresh,economicEvidence:{fidelity:'EVENT_PATH_ESTIMATE',effectiveSampleCount:7,feeRatePerCapitalHour:.001,uncertainty:.4,evidenceAgeSeconds:301,rawObservationCount:24,independentEpisodeCount:7,feeObservationCount:12,eventPathObservationCount:12}});
 assert.equal(result.phase3Status,'WARMING');
 assert.ok(result.reasonCodes.includes('OPERATIONAL_ECONOMIC_EVIDENCE_STALE'));
});

test('economic evidence age is recalculated at the decision timestamp',()=>{
 assert.equal(decisionTimeEconomicEvidenceAgeSeconds({estimateAsOf:'2026-08-12T12:00:00.000Z',storedEvidenceAgeSeconds:30,decisionAt:'2026-08-12T12:04:31.000Z'}),301);
 assert.equal(decisionTimeEconomicEvidenceAgeSeconds({estimateAsOf:'invalid',storedEvidenceAgeSeconds:0,decisionAt:at}),Infinity);
});
