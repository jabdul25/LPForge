import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildMarketContextManifestEntry,
  marketContextContentHash,
  planProspectiveMarketContextSnapshot,
  verifyMarketContextManifestChain,
} from '../.build/packages/market-context-telemetry/src/index.js';
import { freezePhase3ForwardDecision } from '../.build/packages/phase3-forward-validation/src/index.js';

const start='2026-08-26T00:00:00.000Z';
const at=minute=>new Date(Date.parse(start)+minute*60_000).toISOString();
const h=(horizon='5m')=>({horizon,samples:4,startAt:at(-5),endAt:start,returnPct:.2,maxDrawdownPct:-.1,realizedVolatility:.12,priceRangePct:.3,netBins:2,absoluteBins:4,binVelocityPerMinute:.8,directionalEfficiency:.5,volumeTotal:12,feeTotal:.02,twoWayRatioMean:.7,localLiquidityChangePct:.1,completeness:1});
const decisionTimeContext=(overrides={})=>({
  schemaVersion:'phase3-decision-market-context-v1',
  decisionContextCutoff:start,
  sourceFreshnessBoundaryMs:180000,
  raw:{marketObservations:[{observedAt:at(-1),price:100,activeBinId:101,volume:5,feeValue:.01,twoWayRatio:.7,localLiquidity:1000}],binFeatures:{binCount:9,liquiditySkew:.1,nonEmptyRatio:.8,maxConsecutiveEmpty:1},flowFeatures:{swaps:3,twoWayRatio:.7,netDirection:.2,meanBinsCrossed:1,totalMmFeeRaw:'7'},poolAssessmentEvidence:{tvl:1000,fee1hTvl:.03}},
  derived:{marketContext:{pool:'pool-m0050',decisionAt:start,schemaVersion:'phase3-market-context-v1',horizons:{'5m':h('5m'),'15m':h('15m'),'30m':h('30m'),'1h':h('1h'),'4h':h('4h')},sourceObservationCount:1,hash:'context'},structure:{trendDirection:1,trendEfficiency:.4,impulseStrength:.2,retracementDepth:.1,compressionScore:.3,expansionScore:.2,supportIntegrity:.7,reclaimScore:.6,downsideAcceleration:.1,upsideAcceleration:.2,binVelocityAcceleration:.1,flowTwoWay:.7,flowDirection:.2,liquidityGapRisk:.1,liquiditySkewAbs:.1,volatilityState:'LOW',structureQuality:.7,reasonCodes:[]},regime:{primary:'CONSOLIDATION',probabilities:[{label:'CONSOLIDATION',probability:.6}],confidence:.6,stability:.3,transitionRisk:.2,observedAt:start,reasonCodes:[],rawScores:{CONSOLIDATION:.6},evidence:{return5m:.2}},regimeHistory:{samples:3,labelChanges:0,flappingRate:0,meanProbabilityDrift:0,stableDurationMinutes:10,continuityBreaks:0,continuityFingerprint:'x',downsideTransitionRisk:.1,recoveryLikelihood:.2,transitionRisk:.2},poolQualityShadow:{version:'pool-quality-prospective-shadow-v1',membership:{CONTROL:true,A:true,B:true,C:true},poolQualityScore:80,economicQualityScore:80,liquidityQualityScore:80,flowQualityScore:80,toxicityProbability:.2,fee1hTvl:.03,fee24hTvl:.02}},
  provenance:{marketContextModelVersion:'phase3-market-context-v1',structureModelVersion:'phase3-structure-features-v1',regimeModelVersion:'phase3-regime-v1',sourceObservationCount:1,sourceObservedAtMax:at(-1)},
  ...overrides,
});
const candidate={id:'m0050-candidate',family:'BASE',lowerBinId:100,upperBinId:102,centerBinId:101,widthBins:3,lowerOffsetBins:-1,upperOffsetBins:1,lowerDistancePct:.1,upperDistancePct:.1,strategy:'CURVE',orientation:'BALANCED',capitalFraction:1,perBinWeights:[{binId:101,weight:1}],reasonCodes:[]};
const decision=(marketContext=decisionTimeContext())=>({recommendationId:'m0050-rec',decisionId:'phase3-forward:m0050-rec',poolAddress:'pool-m0050',decisionTimestamp:start,sourceSha:'a'.repeat(40),buildId:'b'.repeat(64),policyHash:'c'.repeat(64),migrationHead:'M0050_prospective_market_context_telemetry.sql',capitalLamports:'30000000',phase3State:'QUALIFIED',phase3Outcome:'ENTRY_READY',reasonCodes:[],prediction:{},evidenceProvenance:{},selectedCandidate:candidate,selectedCandidateKind:'RANKING_WINNER',wouldAugEraThesisSemanticsHaveCreatedThesis:true,phase4:{result:'ENTRY_READY',readinessScore:.8,timingConfidence:.15,reasonCodes:[],diagnostics:{immediateOorRisk:.1}},marketContext});

test('M0050 freezes raw and derived decision-time context with normalized facts',async()=>{
  const plan=planProspectiveMarketContextSnapshot({telemetryEpisodeId:'post-entry-v2:m0050-rec',decision:decision()});
  assert.equal(plan.captureStatus,'OBSERVED');
  assert.equal(plan.rawPayload.marketObservations.length,1);
  assert.ok(plan.facts.some(f=>f.layer==='RAW_FACT'&&f.key.includes('realizedVolatility')));
  assert.ok(plan.facts.some(f=>f.layer==='DERIVED_INTERPRETATION'&&f.key.includes('regime.primary')));
  const hash=await marketContextContentHash(plan);
  const entry=await buildMarketContextManifestEntry({telemetryEpisodeId:plan.telemetryEpisodeId,marketContextModelVersion:'phase3-decision-market-context-capture-v1',snapshotId:'snapshot',sequenceNumber:1,capturedAt:at(1),contentHash:hash,previousHash:'d'.repeat(64),captureStatus:plan.captureStatus,collectorVersion:'test',sourceVersion:'a'.repeat(40)});
  assert.equal(await verifyMarketContextManifestChain({episodeHeaderHash:'d'.repeat(64),entry}),true);
  assert.equal(await verifyMarketContextManifestChain({episodeHeaderHash:'e'.repeat(64),entry}),false);
});

test('M0050 rejects future-timestamp evidence without interpolation',()=>{
  const context=decisionTimeContext();
  context.raw.marketObservations[0].observedAt=at(1);
  const plan=planProspectiveMarketContextSnapshot({telemetryEpisodeId:'post-entry-v2:future',decision:decision(context)});
  assert.equal(plan.captureStatus,'SOURCE_TIMESTAMP_UNVERIFIED');
  assert.deepEqual(plan.rawPayload.marketObservations,[]);
  assert.ok(plan.reasonCodes.includes('M0050_LOOKAHEAD_SOURCE_REJECTED'));
});

test('M0050 records existing-freshness-boundary staleness explicitly',()=>{
  const context=decisionTimeContext();
  context.raw.marketObservations[0].observedAt=at(-4);
  const plan=planProspectiveMarketContextSnapshot({telemetryEpisodeId:'post-entry-v2:stale',decision:decision(context)});
  assert.equal(plan.captureStatus,'SOURCE_STALE');
  assert.equal(plan.availability.market,'SOURCE_STALE');
});

test('M0050 is a research attachment and leaves frozen decision economics invariant',()=>{
  const recommendation={recommendationId:'invariant-rec',phase:'P3',recommendationOnly:true,decisionAt:start,expiresAt:at(5),pool:'pool-m0050',state:'WATCHING',noTrade:true,marketContextHash:'context',regime:{transitionRisk:.2},economics:{expectedFeeValue:.1,expectedInventoryPnl:.01,expectedExecutionCost:.001,expectedRepositionCost:.001,expectedTailRiskCharge:.001,expectedNetLpValue:.107,expectedActiveTimeRatio:.6,forecastUncertainty:.2,evidenceFidelity:'EVENT_PATH_ESTIMATE'},uncertaintyLineage:{evidenceUncertainty:.1,forecastUncertainty:.2,components:{}},candidateCount:1,simulations:[],ranking:{winner:'NO_TRADE',rankings:[]},forwardValidation:{version:'phase3-forward-decision-v1',horizonMinutes:30,capitalValue:.03,capitalLamports:'30000000',activeBinIdAtDecision:101,rawUnitValueX:1,rawUnitValueY:1,costs:{compositionFeeValue:'0',transactionFeeValue:'0',slippageValue:'0',rebalanceCostValue:'0',otherCostValue:'0'},selectedCandidateKind:'NONE',evidence:{replayEvidenceWatermark:start,historicalFrameHash:'frame',historicalEventHash:'event'},poolQualityShadow:{version:'pool-quality-prospective-shadow-v1',membership:{CONTROL:true,A:true,B:true,C:true},poolQualityScore:80,economicQualityScore:80,liquidityQualityScore:80,flowQualityScore:80,toxicityProbability:.2,fee1hTvl:.03,fee24hTvl:.02},wouldAugEraThesisSemanticsHaveCreatedThesis:false},reasonCodes:[]};
  const artifact={sourceSha:'a'.repeat(40),buildId:'b'.repeat(64),policyHash:'c'.repeat(64),migrationHead:'M0050_prospective_market_context_telemetry.sql'};
  const before=freezePhase3ForwardDecision({recommendation,artifact});
  const after=freezePhase3ForwardDecision({recommendation:{...recommendation,decisionTimeMarketContext:decisionTimeContext()},artifact});
  for(const key of ['recommendationId','decisionId','poolAddress','decisionTimestamp','capitalLamports','phase3State','phase3Outcome','prediction','selectedCandidateKind','reasonCodes'])assert.deepEqual(after[key],before[key],key);
  assert.ok(after.marketContext);
});

test('M0050 migration is append-only and never backfills M0049',async()=>{
  const migration=await readFile('packages/db/migrations/M0050_prospective_market_context_telemetry.sql','utf8');
  for(const table of ['market_context_telemetry_activation','market_context_telemetry_snapshots','market_context_telemetry_facts','market_context_telemetry_manifest','market_context_telemetry_capture_audit'])assert.match(migration,new RegExp(table));
  assert.match(migration,/PRE_ACTIVATION_NOT_APPLICABLE/);
  assert.match(migration,/BEFORE UPDATE OR DELETE/);
  assert.match(migration,/REVOKE UPDATE, DELETE/);
  assert.doesNotMatch(migration,/INSERT INTO research\\.post_entry_telemetry_episodes/);
});
