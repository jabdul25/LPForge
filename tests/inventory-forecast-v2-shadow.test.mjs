import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  INVENTORY_FORECAST_V2_MODEL_VERSION,
  buildInventoryForecastV2ManifestEntry,
  buildInventoryForecastV2ValidationReport,
  inventoryForecastV2ContentHash,
  inventoryForecastV2ValidationRowFromStored,
  planProspectiveInventoryForecastV2,
  verifyInventoryForecastV2ManifestChain,
} from '../.build/packages/inventory-forecast-v2/src/index.js';
import { deriveCapitalConstrainedForwardPosition, freezePhase3ForwardDecision } from '../.build/packages/phase3-forward-validation/src/index.js';

const start='2026-08-26T00:00:00.000Z';
const at=minute=>new Date(Date.parse(start)+minute*60_000).toISOString();
const artifact={sourceSha:'a'.repeat(40),buildId:'b'.repeat(64),policyHash:'c'.repeat(64),migrationHead:'M0052_inventory_forecast_v2_prospective_shadow.sql'};
const candidate={id:'forecast-v2-candidate',family:'BASE',lowerBinId:100,upperBinId:132,centerBinId:116,widthBins:33,lowerOffsetBins:-16,upperOffsetBins:16,lowerDistancePct:.1,upperDistancePct:.1,strategy:'CURVE',orientation:'BALANCED',capitalFraction:1,perBinWeights:Array.from({length:33},(_,index)=>({binId:100+index,weight:1/33})),reasonCodes:[]};
const horizon=(name)=>({horizon:name,samples:8,startAt:at(-15),endAt:start,returnPct:.1,maxDrawdownPct:-.1,realizedVolatility:.2,priceRangePct:.3,netBins:2,absoluteBins:4,binVelocityPerMinute:.1,directionalEfficiency:.5,volumeTotal:10,feeTotal:.01,twoWayRatioMean:.7,localLiquidityChangePct:0,completeness:1});
const marketContext=()=>({schemaVersion:'phase3-decision-market-context-v1',decisionContextCutoff:start,sourceFreshnessBoundaryMs:180000,raw:{marketObservations:[{observedAt:at(-1),price:100,activeBinId:116,volume:1,feeValue:.01,twoWayRatio:.7,localLiquidity:1000}],poolAssessmentEvidence:{}},derived:{marketContext:{pool:'pool-v2-shadow',decisionAt:start,schemaVersion:'phase3-market-context-v1',horizons:{'5m':horizon('5m'),'15m':horizon('15m'),'30m':horizon('30m'),'1h':horizon('1h'),'4h':horizon('4h')},sourceObservationCount:1,hash:'market-context'},structure:{},regime:{primary:'CONSOLIDATION',transitionRisk:.2},regimeHistory:{},poolQualityShadow:{}},provenance:{marketContextModelVersion:'phase3-market-context-v1',structureModelVersion:'phase3-structure-features-v1',regimeModelVersion:'phase3-regime-v1',sourceObservationCount:1,sourceObservedAtMax:at(-1)}});
function recommendation(){return{recommendationId:'forecast-v2-rec',phase:'P3',recommendationOnly:true,decisionAt:start,expiresAt:at(5),pool:'pool-v2-shadow',state:'WATCHING',noTrade:true,marketContextHash:'market-context',regime:{transitionRisk:.2},economics:{expectedFeeValue:0,expectedInventoryPnl:0,expectedExecutionCost:0,expectedRepositionCost:0,expectedTailRiskCharge:0,expectedNetLpValue:0,expectedActiveTimeRatio:.5,forecastUncertainty:.2,evidenceFidelity:'EVENT_PATH_ESTIMATE'},qualification:{policyId:'candidate-primary-risk-adjusted-v1',economicAuthority:'CANDIDATE_PRIMARY',candidateExpectedNetEV:0,globalExpectedNetEV:0,globalAdjustmentWeight:.5,globalRiskAdjustment:0,riskAdjustedExpectedNetEV:0,uncertainty:.2,uncertaintyAuthority:'SOFT_CONTEXT',hardBlockReasons:[],softRiskReasons:[]},uncertaintyLineage:{evidenceUncertainty:.1,forecastUncertainty:.2,components:{}},candidateCount:1,simulations:[],ranking:{winner:'NO_TRADE',rankings:[{candidateId:candidate.id,utility:0}],reasonCodes:[]},forwardValidation:{version:'phase3-forward-decision-v1',horizonMinutes:60,capitalValue:.03,capitalLamports:'30000000',activeBinIdAtDecision:116,rawUnitValueX:.000001,rawUnitValueY:.000001,costs:{compositionFeeValue:'0',transactionFeeValue:'0',slippageValue:'0',rebalanceCostValue:'0',otherCostValue:'0'},selectedCandidateKind:'TOP_RANKED_COUNTERFACTUAL',selectedCandidate:candidate,evidence:{replayEvidenceWatermark:start,historicalFrameHash:'frame',historicalEventHash:'event'},poolQualityShadow:{},wouldAugEraThesisSemanticsHaveCreatedThesis:true},reasonCodes:[],decisionTimeMarketContext:marketContext()};}
function frame(minute,activeBinId,amountX){return{observedAt:at(minute),activeBinId,bins:candidate.perBinWeights.map(weight=>({binId:weight.binId,price:'1',amountX:String(amountX),amountY:'0',liquiditySupply:'1000000000000000000'}))};}
function input(overrides={}){const decision=freezePhase3ForwardDecision({recommendation:recommendation(),artifact});return{telemetryEpisodeId:'post-entry-v2:forecast-v2-rec',decision,poolIdentity:{tokenYMint:'So11111111111111111111111111111111111111112',firstSeenAt:at(-120)},historicalFrames:[frame(-20,90,900000000),frame(-10,140,1100000000),frame(0,116,1000000000)],...overrides};}

test('shadow v2 creates three horizon-specific capital-constrained forecasts without mutating frozen authority inputs',()=>{
  const source=input(),before=structuredClone(source.decision),plan=planProspectiveInventoryForecastV2(source);
  assert.equal(plan.captureStatus,'OBSERVED');
  assert.equal(plan.provenance.inventoryForecastModelVersion,INVENTORY_FORECAST_V2_MODEL_VERSION);
  assert.deepEqual(source.decision,before,'shadow planner is pure relative to frozen decision authority');
  assert.deepEqual(Object.keys(plan.derivedForecast.forecasts),['30m','60m','120m']);
  assert.equal(plan.derivedForecast.scenarios.length,9);
  assert.equal(plan.derivedForecast.target,'canonical-v2-realized-inventory-pnl');
  assert.equal(plan.derivedForecast.unit,'SOL');
});

test('shadow v2 starting position is exactly the canonical V2 capital/geometry position',()=>{
  const source=input(),baseline=source.historicalFrames.at(-1),canonical=deriveCapitalConstrainedForwardPosition({decision:source.decision,candidate,baseline}),plan=planProspectiveInventoryForecastV2(source);
  assert.ok(canonical.position);
  assert.deepEqual(plan.derivedForecast.startingPosition.perBinParticipation,canonical.position.bins);
  assert.equal(plan.derivedForecast.startingPosition.allocatedCapitalLamports,canonical.position.allocatedCapitalLamports.toString());
  assert.equal(plan.derivedForecast.startingPosition.derivedPositionValueLamports,canonical.position.derivedPositionValueLamports.toString());
});

test('shadow v2 rejects post-decision frames and stale/future source evidence instead of looking ahead',()=>{
  const future=planProspectiveInventoryForecastV2({...input(),historicalFrames:[...input().historicalFrames,frame(1,117,1000000000)]});
  assert.equal(future.captureStatus,'SOURCE_TIMESTAMP_UNVERIFIED');
  assert.ok(future.reasonCodes.includes('INVENTORY_FORECAST_V2_LOOKAHEAD_BIN_FRAME_REJECTED'));
  const staleInput=input();staleInput.decision.marketContext.raw.marketObservations[0].observedAt=at(-4);
  const stale=planProspectiveInventoryForecastV2(staleInput);
  assert.equal(stale.captureStatus,'SOURCE_STALE');
});

test('WSOL-as-X is explicit fail-closed until canonical V2 realization supports that valuation orientation',()=>{
  const plan=planProspectiveInventoryForecastV2({...input(),poolIdentity:{tokenXMint:'So11111111111111111111111111111111111111112',tokenYMint:'other',firstSeenAt:at(-120)}});
  assert.equal(plan.captureStatus,'FORECAST_UNAVAILABLE');
  assert.ok(plan.reasonCodes.includes('INVENTORY_FORECAST_V2_CANONICAL_WSOL_AS_X_UNSUPPORTED'));
});

test('manifest/content hashes are deterministic and remain anchored to M0049 header evidence',async()=>{
  const plan=planProspectiveInventoryForecastV2(input()),hash=await inventoryForecastV2ContentHash(plan);
  const entry=await buildInventoryForecastV2ManifestEntry({telemetryEpisodeId:plan.telemetryEpisodeId,predictionId:'inventory-forecast-v2:test',capturedAt:at(1),sourceVersion:'a'.repeat(40),collectorVersion:'test',contentHash:hash,previousHash:'d'.repeat(64),captureStatus:plan.captureStatus});
  assert.equal(await verifyInventoryForecastV2ManifestChain({episodeHeaderHash:'d'.repeat(64),entry}),true);
  assert.equal(await verifyInventoryForecastV2ManifestChain({episodeHeaderHash:'e'.repeat(64),entry}),false);
});

test('future validation framework compares v2, v1, and zero without creating a validation conclusion',()=>{
  const report=buildInventoryForecastV2ValidationReport([{poolAddress:'a',decisionAt:start,horizonMinutes:30,predictedInventoryPnlSol:.01,v1PredictedInventoryPnlSol:-.01,realizedInventoryPnlSol:.02,strategy:'CURVE',orientation:'BALANCED',widthBucket:'21-49',regime:'RANGE',volatilityState:'CALM'},{poolAddress:'b',decisionAt:'2026-08-27T00:01:00.000Z',horizonMinutes:30,predictedInventoryPnlSol:-.01,v1PredictedInventoryPnlSol:.01,realizedInventoryPnlSol:-.02,strategy:'CURVE',orientation:'BALANCED',widthBucket:'21-49',regime:'RANGE',volatilityState:'CALM'}]);
  assert.equal(report.validationStatus,'PROSPECTIVE_VALIDATION_REQUIRED');
  assert.deepEqual(report.comparators,['inventory-forecast-v2-shadow-v1','inventory-forecast-v1','BASELINE_ZERO']);
  assert.equal(report.byHorizon['30m'].rawEpisodeWeighted.v2.spearman,1);
  assert.equal(report.byHorizon['30m'].strata.strategy.CURVE.samples,2);
  assert.equal(report.byHorizon['30m'].timeBalanced.groups,2);
  const normalized=inventoryForecastV2ValidationRowFromStored({pool_address:'pool',decision_at:start,horizon_minutes:30,realized_inventory_pnl:.2,v1_predicted_inventory_pnl:.1,raw_frozen_inputs:{selectedCandidate:{strategy:'CURVE',orientation:'BALANCED',widthBins:33},decisionMarketContext:{derivedRegime:{primaryRegime:'RANGE',transitionRisk:.2},derivedMarketContext:{volatility:{state:'CALM'}}}},derived_forecast:{forecasts:{'30m':{predictedInventoryPnlSol:.1}}}});
  assert.equal(normalized?.widthBucket,'21-49');assert.equal(normalized?.regime,'RANGE');assert.equal(normalized?.volatilityState,'CALM');
});

test('M0052 shadow storage is append-only, versioned, and excludes historical backfill',async()=>{
  const migration=await readFile('packages/db/migrations/M0052_inventory_forecast_v2_prospective_shadow.sql','utf8');
  for(const name of ['inventory_forecast_v2_activation','inventory_forecast_v2_predictions','inventory_forecast_v2_manifest','inventory_forecast_v2_capture_audit'])assert.match(migration,new RegExp(name));
  assert.match(migration,/PRE_ACTIVATION_NOT_APPLICABLE/);
  assert.match(migration,/BEFORE UPDATE OR DELETE/);
  assert.match(migration,/REVOKE UPDATE, DELETE/);
  assert.doesNotMatch(migration,/UPDATE research\.phase3_forward_decisions/);
  assert.doesNotMatch(migration,/INSERT INTO research\.phase3_forward_outcomes/);
  const recorder=await readFile('apps/discovery-learning/src/inventory-forecast-v2-capture.ts', 'utf8');
  assert.ok(recorder.includes('const m0052Index=migrations.indexOf(M0052_MIGRATION);'));
  assert.ok(recorder.includes('migrations.indexOf(migrationHead)<m0052Index'));
  assert.ok(!recorder.includes('migrationHead!==M0052_MIGRATION'));
});
