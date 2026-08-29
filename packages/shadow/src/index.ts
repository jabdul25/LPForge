import { canonicalJson, sha256Hex, type SwapEventFact } from '../../domain/src/index.js';
import { assertNoLookahead } from '../../research/src/index.js';
import { buildMarketContext, type MarketContextSnapshot, type MarketObservation } from '../../market-context/src/index.js';
import { computeStructureFeatures, type StructureFeatureVector } from '../../structure-features/src/index.js';
import { classifyRegime, analyzeRegimeHistory, type RegimeAssessment, type RegimeHistorySample } from '../../regime/src/index.js';
import { assessControlledPullback, assessBreakoutControlledPullback } from '../../setup-specialists/src/index.js';
import { deriveQualificationEconomics, estimateOpportunityEconomics, deriveOpportunityProgress, deriveOutcomeDispersion, resolvePhase3QualificationPolicy, type CandidatePrimaryQualificationEconomics, type OpportunityRateEvidence, type Phase3QualificationPolicyId } from '../../opportunity/src/index.js';
import { generateRangeUniverse, generateStrategyCandidates, type RangeStrategyCandidate } from '../../rangeforge/src/index.js';
import { calculateMeteoraStrategyDistribution } from '../../meteora-execution/src/index.js';
import { fitRangeSurvivalModel, type ActiveBinObservation, type SurvivalForecast } from '../../range-survival/src/index.js';
import { deriveSyntheticPositionShareRaw, rebaseCandidateForReplay, simulateCandidateEconomics, type CandidateEconomicSimulation } from '../../candidate-simulator/src/index.js';
import { rankCandidates, type CandidateRankingResult } from '../../candidate-ranking/src/index.js';
import { generateLpThesis, type CandidateThesisEconomics, type MachineReadableLpThesis } from '../../thesis/src/index.js';
import type { PoolAssessment } from '../../pool-intelligence/src/index.js';
import type { BinWindowFeatures, SwapFlowFeatures } from '../../features/src/index.js';
import type { BinFrame, SimulationCostModel } from '../../simulator/src/index.js';

export interface ShadowRecommendationInput {
  pool:string;decisionAt:string;expiresAt:string;activeBinId:number;binStep:number;horizonMinutes:number;capitalValue:number;
  currentObservations:MarketObservation[];historicalActiveBins:ActiveBinObservation[];historicalFrames:BinFrame[];historicalEvents:SwapEventFact[];
  poolAssessment:PoolAssessment;rateEvidence:OpportunityRateEvidence;binFeatures?:BinWindowFeatures;flowFeatures?:SwapFlowFeatures;
  priorRegimeAssessments?:RegimeHistorySample[];totalPositionShareRaw?:bigint;rawUnitValueX:number;rawUnitValueY:number;costs?:SimulationCostModel;
  orientations?:RangeStrategyCandidate['orientation'][];strategies?:RangeStrategyCandidate['strategy'][];strategyOrientations?:Partial<Record<RangeStrategyCandidate['strategy'],RangeStrategyCandidate['orientation'][]>>;capitalFractions?:number[];maxRangeWidthBins?:number;qualificationPolicy?:Phase3QualificationPolicyId;
}
/**
 * Immutable, reporting-only pool-quality experiment. These labels are derived
 * solely from the assessment already available to Phase 3. They are never
 * supplied to qualification, candidate ranking, Phase 4, or execution.
 */
export interface PoolQualityProspectiveShadowSnapshot {
  version:'pool-quality-prospective-shadow-v1';
  membership:{CONTROL:true;A:boolean;B:boolean;C:boolean};
  poolQualityScore:number;
  economicQualityScore:number;
  liquidityQualityScore:number;
  flowQualityScore:number;
  toxicityProbability:number;
  fee1hTvl:number|null;
  fee24hTvl:number|null;
}
const finiteOrNull=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
export function derivePoolQualityProspectiveShadowSnapshot(pool:PoolAssessment):PoolQualityProspectiveShadowSnapshot {
  const fee1hTvl=finiteOrNull(pool.evidence.fee1hTvl),fee24hTvl=finiteOrNull(pool.evidence.fee24hTvl);
  const a=fee1hTvl!==null&&fee1hTvl>=.02;
  const b=a&&pool.economicQualityScore>=75;
  return {
    version:'pool-quality-prospective-shadow-v1',
    membership:{CONTROL:true,A:a,B:b,C:b&&pool.toxicityProbability<=.30},
    poolQualityScore:pool.poolQualityScore,
    economicQualityScore:pool.economicQualityScore,
    liquidityQualityScore:pool.liquidityQualityScore,
    flowQualityScore:pool.flowQualityScore,
    toxicityProbability:pool.toxicityProbability,
    fee1hTvl,
    fee24hTvl,
  };
}

/**
 * Immutable decision-time evidence only. This is deliberately outside the
 * recommendation-id core below: it is observability metadata and must never
 * alter candidate generation, qualification, ranking, or recommendation
 * identity. M0050 freezes this payload prospectively in research storage.
 */
export interface DecisionTimeMarketContextEvidence {
  schemaVersion:'phase3-decision-market-context-v1';
  decisionContextCutoff:string;
  /** Mirrors the existing Phase-3 live-observation freshness boundary. */
  sourceFreshnessBoundaryMs:number;
  raw:{
    marketObservations:MarketObservation[];
    binFeatures?:BinWindowFeatures;
    flowFeatures?:SwapFlowFeatures;
    poolAssessmentEvidence:Record<string,unknown>;
  };
  derived:{
    marketContext:MarketContextSnapshot;
    structure:StructureFeatureVector;
    regime:RegimeAssessment;
    regimeHistory:ReturnType<typeof analyzeRegimeHistory>;
    poolQualityShadow:PoolQualityProspectiveShadowSnapshot;
  };
  provenance:{
    marketContextModelVersion:string;
    structureModelVersion:string;
    regimeModelVersion:string;
    sourceObservationCount:number;
    sourceObservedAtMax?:string;
  };
}

export interface ShadowRecommendation {
  recommendationId:string;phase:'P3';recommendationOnly:true;decisionAt:string;expiresAt:string;pool:string;state:string;noTrade:boolean;
  marketContextHash:string;regime:RegimeAssessment;regimeHistory:ReturnType<typeof analyzeRegimeHistory>;pullback?:ReturnType<typeof assessControlledPullback>;breakoutPullback?:ReturnType<typeof assessBreakoutControlledPullback>;
  economics:ReturnType<typeof estimateOpportunityEconomics>;qualification:{policyId:Phase3QualificationPolicyId;economicAuthority:'GLOBAL_PRIMARY'|'CANDIDATE_PRIMARY';candidateExpectedNetEV?:number|undefined;globalExpectedNetEV:number;globalAdjustmentWeight:number;globalRiskAdjustment?:number|undefined;riskAdjustedExpectedNetEV?:number|undefined;uncertainty:number;uncertaintyAuthority:'HARD_VETO'|'SOFT_CONTEXT';hardBlockReasons:string[];softRiskReasons:string[];};uncertaintyLineage:{evidenceUncertainty:number;forecastUncertainty:number;components:ReturnType<typeof estimateOpportunityEconomics>['forecastUncertaintyComponents'];};candidateCount:number;simulations:CandidateEconomicSimulation[];ranking:CandidateRankingResult;
  /** Immutable, compact decision-time material for shadow-only forward validation. */
  forwardValidation:{version:'phase3-forward-decision-v1';horizonMinutes:number;capitalValue:number;capitalLamports:string;activeBinIdAtDecision:number;rawUnitValueX:number;rawUnitValueY:number;costs:Required<SimulationCostModel>;selectedCandidateKind:'RANKING_WINNER'|'TOP_RANKED_COUNTERFACTUAL'|'NONE';selectedCandidate?:RangeStrategyCandidate;selectedSimulation?:CandidateEconomicSimulation;selectedSurvival?:SurvivalForecast;evidence:{replayAnchorAt?:string;replayEvidenceWatermark:string;historicalFrameHash:string;historicalEventHash:string;latestFrameAt?:string;latestEventAt?:string;};poolQualityShadow:PoolQualityProspectiveShadowSnapshot;wouldAugEraThesisSemanticsHaveCreatedThesis:boolean;};
  thesis?:MachineReadableLpThesis;reasonCodes:string[];
  /** Research-only decision-time evidence; excluded from recommendation ID. */
  decisionTimeMarketContext?:DecisionTimeMarketContextEvidence;
  /** RESET-3C immutable sidecar input; excluded from recommendation identity and authority. */
  candidateUniverseEvidence?:{version:'reset3c-universe-v1';capitalLamports:string;frames:BinFrame[];events:SwapEventFact[];costs:Required<SimulationCostModel>;candidates:RangeStrategyCandidate[];simulations:CandidateEconomicSimulation[];ranking:CandidateRankingResult;qualification:Record<string,unknown>;economics:Record<string,unknown>;};
}
function assertFramesHistorical(decisionAt:string,frames:BinFrame[],events:SwapEventFact[]){const t=Date.parse(decisionAt);for(const f of frames)if(Date.parse(f.observedAt)>t)throw new Error(`LPFORGE_SHADOW_LOOKAHEAD_FRAME:${f.observedAt}`);for(const e of events)if(Date.parse(e.stamp.observedAt)>t)throw new Error(`LPFORGE_SHADOW_LOOKAHEAD_EVENT:${e.stamp.observedAt}`);}
function assertRegimeHistoryHistorical(decisionAt:string,history:RegimeHistorySample[]){const t=Date.parse(decisionAt);for(const r of history){const observed=Date.parse(r.observedAt);if(!Number.isFinite(observed))throw new Error(`LPFORGE_SHADOW_REGIME_HISTORY_TIME_INVALID:${r.observedAt}`);if(observed>t)throw new Error(`LPFORGE_SHADOW_LOOKAHEAD_REGIME:${r.observedAt}`);}}
function normalizeWeights(rows:Array<{binId:number;weight:number}>){const total=rows.reduce((sum,row)=>sum+row.weight,0);if(!(total>0))throw new Error('LPFORGE_SHADOW_METEORA_WEIGHTS_ZERO');return rows.map(row=>({binId:row.binId,weight:row.weight/total}));}
async function withMeteoraSdkWeights(candidate:RangeStrategyCandidate):Promise<RangeStrategyCandidate>{const distribution=await calculateMeteoraStrategyDistribution({strategy:candidate.strategy,activeBinId:candidate.centerBinId,lowerBinId:candidate.lowerBinId,upperBinId:candidate.upperBinId});const rows=distribution.bins.map(bin=>({binId:bin.binId,weight:candidate.orientation==='ONE_SIDED_Y'?bin.yAmountBps:bin.xAmountBps+bin.yAmountBps}));return{...candidate,perBinWeights:normalizeWeights(rows)};}
const raw=(value:string|undefined)=>{try{return BigInt(value??'0');}catch{return 0n;}};
function candidateCoverage(candidate:RangeStrategyCandidate,frame:BinFrame):boolean{
 const byBin=new Map(frame.bins.map(bin=>[bin.binId,bin]));let usable=false;
 for(const weight of candidate.perBinWeights){if(!(weight.weight>0))continue;const bin=byBin.get(weight.binId);if(!bin)return false;if(raw(bin.liquiditySupply)<=0n||!(raw(bin.amountX)>0n||raw(bin.amountY)>0n))return false;usable=true;}
 return usable;
}
export interface CandidateReplayPreparation {frames?:BinFrame[];reason?:'CANDIDATE_REPLAY_COVERAGE_INSUFFICIENT'|'CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT';}
export function prepareCandidateReplay(input:Pick<ShadowRecommendationInput,'historicalFrames'|'decisionAt'|'horizonMinutes'>,candidate:RangeStrategyCandidate):CandidateReplayPreparation{
 const frames=[...input.historicalFrames].filter(f=>Date.parse(f.observedAt)<=Date.parse(input.decisionAt)).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));const end=Date.parse(frames.at(-1)?.observedAt??''),horizon=input.horizonMinutes*60000;let continuityInsufficient=false;
 for(let i=frames.length-1;i>=0;i--){const anchor=frames[i]!,fixedReplayCandidate=rebaseCandidateForReplay(candidate,anchor.activeBinId);if(deriveSyntheticPositionShareRaw(anchor)<=0n||!candidateCoverage(fixedReplayCandidate,anchor))continue;const replay:BinFrame[]=[];for(const frame of frames.slice(i)){if(!candidateCoverage(fixedReplayCandidate,frame)){continuityInsufficient=true;break;}replay.push(frame);}if(replay.length&&Date.parse(replay.at(-1)!.observedAt)-Date.parse(anchor.observedAt)>=horizon)return{frames:replay};continuityInsufficient=true;}
 return{reason:continuityInsufficient?'CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT':'CANDIDATE_REPLAY_COVERAGE_INSUFFICIENT'};
}
function replayEvidenceInsufficient(candidate:RangeStrategyCandidate,capitalValue:number,reason:'CANDIDATE_REPLAY_COVERAGE_INSUFFICIENT'|'CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT'):CandidateEconomicSimulation{return{candidateId:candidate.id,strategy:candidate.strategy,orientation:candidate.orientation,activeDurationMs:0,inactiveDurationMs:0,unobservedDurationMs:0,occupancyCoverageRatio:0,occupancyState:'INSUFFICIENT_EVIDENCE',lowerExitCount:0,upperExitCount:0,feeValue:0,inventoryChangeValue:0,grossValueChange:0,totalCostValue:0,netValue:0,feeToAdverseInventoryRatio:null,fidelity:'EVENT_PATH_ESTIMATE',valueUnit:'TOKEN_X',capitalValue:capitalValue*candidate.capitalFraction,startInventoryValue:0,normalizationScale:0,unitScaleValid:false,evidenceActionable:false,warnings:[reason]};}
export async function buildShadowRecommendation(input:ShadowRecommendationInput):Promise<ShadowRecommendation>{
 assertNoLookahead(input.decisionAt,input.currentObservations);if(input.historicalActiveBins.some(x=>Date.parse(x.observedAt)>Date.parse(input.decisionAt)))throw new Error('LPFORGE_SHADOW_LOOKAHEAD_SURVIVAL');assertFramesHistorical(input.decisionAt,input.historicalFrames,input.historicalEvents);assertRegimeHistoryHistorical(input.decisionAt,input.priorRegimeAssessments??[]);
 const qualificationPolicy=resolvePhase3QualificationPolicy(input.qualificationPolicy);
 const context=await buildMarketContext(input.pool,input.decisionAt,input.currentObservations);const structure=computeStructureFeatures({context,observations:input.currentObservations,...(input.binFeatures?{bin:input.binFeatures}:{}),...(input.flowFeatures?{flow:input.flowFeatures}:{})});const regime=classifyRegime({context,structure});const regimeHistory=analyzeRegimeHistory([...(input.priorRegimeAssessments??[]),regime]);
 const pullback=assessControlledPullback({context,structure,regime,history:regimeHistory});const breakoutPullback=assessBreakoutControlledPullback({context,structure,regime,history:regimeHistory});
 const configuredWidth=input.maxRangeWidthBins??100;if(!Number.isInteger(configuredWidth)||configuredWidth<3||configuredWidth>1400)throw new Error('LPFORGE_SHADOW_RANGE_WIDTH_POLICY_INVALID');const universe=generateRangeUniverse({activeBinId:input.activeBinId,binStep:input.binStep,horizonMinutes:input.horizonMinutes,context,structure,regime,maxWidthBins:configuredWidth});const generatedCandidates=generateStrategyCandidates({universe,strategies:input.strategies??['SPOT','CURVE','BID_ASK'],orientations:input.orientations??['BALANCED'],...(input.strategyOrientations?{strategyOrientations:input.strategyOrientations}:{}),capitalFractions:input.capitalFractions??[1]});const candidates=await Promise.all(generatedCandidates.map(withMeteoraSdkWeights));
 const rangeShapes=candidates.map(c=>({id:c.id,lowerOffsetBins:c.lowerOffsetBins,upperOffsetBins:c.upperOffsetBins}));const survivalModel=fitRangeSurvivalModel({history:input.historicalActiveBins,fitThrough:input.decisionAt,horizonsMinutes:[input.horizonMinutes],ranges:rangeShapes,anchorStride:5,minimumFutureSamples:3});const sfByCandidate=new Map(survivalModel.forecasts.map(f=>[f.rangeId,f] as const));const survivalForecasts:Record<string,SurvivalForecast|undefined>={};for(const c of candidates){const sf=sfByCandidate.get(c.id);if(sf)survivalForecasts[c.id]=sf;}
 const replayAnchorByCandidate=new Map<string,string>();
 const simulations=candidates.map(candidate=>{const preparation=prepareCandidateReplay(input,candidate);if(!preparation.frames)return replayEvidenceInsufficient(candidate,input.capitalValue,preparation.reason??'CANDIDATE_REPLAY_COVERAGE_INSUFFICIENT');const replay=preparation.frames;replayAnchorByCandidate.set(candidate.id,replay[0]!.observedAt);const replayEvents=input.historicalEvents.filter(event=>Date.parse(event.stamp.observedAt)>=Date.parse(replay[0]!.observedAt));return simulateCandidateEconomics({candidate,pool:input.pool,frames:replay,events:replayEvents,totalPositionShareRaw:input.totalPositionShareRaw??deriveSyntheticPositionShareRaw(replay[0]!),rawUnitValueX:input.rawUnitValueX,rawUnitValueY:input.rawUnitValueY,capitalValue:input.capitalValue,...(input.costs?{costs:input.costs}:{})});});
 const outcomeDispersion=deriveOutcomeDispersion(simulations),economics=estimateOpportunityEconomics({capitalValue:input.capitalValue,horizonMinutes:input.horizonMinutes,rates:input.rateEvidence,pool:input.poolAssessment,regime,structure,regimeHistory,outcomeDispersion});
 const uncertainty=Object.fromEntries(candidates.map(c=>[c.id,economics.uncertainty]));
 // Candidate-primary deliberately selects from local replay/survival/evidence
 // first. globalActionable remains supplied for deterministic legacy behavior.
 const ranking=rankCandidates({candidates,simulations,survivalForecasts,uncertainty,globalActionable:economics.economicallyPositive,qualificationPolicyId:qualificationPolicy.id});
 const winner=ranking.winner==='NO_TRADE'?undefined:candidates.find(c=>c.id===ranking.winner);
 const winnerSimulation=winner?simulations.find(simulation=>simulation.candidateId===winner.id):undefined;
 const candidateEconomics:CandidateThesisEconomics|undefined=winnerSimulation?{feeValue:winnerSimulation.feeValue,inventoryPnl:winnerSimulation.inventoryChangeValue,executionCost:winnerSimulation.totalCostValue,repositionCost:0,tailRiskCost:0,netValue:winnerSimulation.netValue}:undefined;
 const qualificationEconomics:CandidatePrimaryQualificationEconomics=deriveQualificationEconomics(qualificationPolicy,economics,candidateEconomics?.netValue);
 const progress=deriveOpportunityProgress({pool:input.poolAssessment,economics,regime,now:input.decisionAt,expiresAt:input.expiresAt,qualificationPolicy,candidateQualification:qualificationEconomics,locallyActionableWinner:Boolean(winner&&winnerSimulation)});
 const winnerRanking=winner?ranking.rankings.find(row=>row.candidateId===winner.id):undefined;
 const hardReasonCodes=new Set(['CANDIDATE_REPLAY_COVERAGE_INSUFFICIENT','CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT','RANGE_SURVIVAL_EVIDENCE_INSUFFICIENT','RANK_EVIDENCE_NON_ACTIONABLE']);
 const hardBlockReasons=[...new Set([...(winnerRanking?.reasonCodes??[]).filter(reason=>hardReasonCodes.has(reason)),...(input.poolAssessment.eligibility==='BLOCK'?input.poolAssessment.blockers:[]),...(input.poolAssessment.dataQuality==='BAD'?['DATA_QUALITY_BAD']:[])])].sort();
 const softRiskReasons=progress.reasonCodes.filter(reason=>reason.endsWith('_SOFT')||reason==='GLOBAL_EV_NEGATIVE_RISK_ADJUSTED');
 const qualification={policyId:qualificationPolicy.id,economicAuthority:qualificationPolicy.economicAuthority,candidateExpectedNetEV:qualificationEconomics.candidateExpectedNetEV,globalExpectedNetEV:qualificationEconomics.globalExpectedNetEV,globalAdjustmentWeight:qualificationEconomics.globalAdjustmentWeight,globalRiskAdjustment:qualificationEconomics.globalRiskAdjustment,riskAdjustedExpectedNetEV:qualificationEconomics.riskAdjustedCandidateEV,uncertainty:economics.forecastUncertainty,uncertaintyAuthority:qualificationPolicy.globalUncertaintyHardVeto?'HARD_VETO' as const:'SOFT_CONTEXT' as const,hardBlockReasons,softRiskReasons};
 let thesis:MachineReadableLpThesis|undefined;if(winner&&winnerSimulation&&candidateEconomics&&progress.state==='QUALIFIED'){thesis=await generateLpThesis({pool:input.poolAssessment,regime,economics,candidate:winner,ranking,survival:Object.values(survivalForecasts).filter((x):x is SurvivalForecast=>Boolean(x)),observedAt:input.decisionAt,expiresAt:input.expiresAt,qualificationPolicy,qualificationEconomics,candidateEconomics,provenance:{marketContext:context.hash,rangeSurvival:survivalModel.version,qualificationPolicy:qualificationPolicy.id}});}
 const uncertaintyLineage={evidenceUncertainty:economics.evidenceUncertainty,forecastUncertainty:economics.forecastUncertainty,components:economics.forecastUncertaintyComponents},noTrade=!thesis;const coverageReasons=simulations.flatMap(simulation=>simulation.warnings.filter(warning=>warning==='CANDIDATE_REPLAY_COVERAGE_INSUFFICIENT'||warning==='CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT'));const reasonCodes=[...new Set([...progress.reasonCodes,...ranking.reasonCodes,...coverageReasons,...hardBlockReasons,...softRiskReasons,...(noTrade?['SHADOW_NO_TRADE']:['SHADOW_RECOMMENDATION'])])].sort();
 const selectedCandidateId=winner?.id??ranking.rankings.at(0)?.candidateId;
 const selectedCandidate=selectedCandidateId?candidates.find(candidate=>candidate.id===selectedCandidateId):undefined;
 const selectedSimulation=selectedCandidateId?simulations.find(simulation=>simulation.candidateId===selectedCandidateId):undefined;
 const selectedSurvival=selectedCandidateId?survivalForecasts[selectedCandidateId]:undefined;
 const frameRows=input.historicalFrames.filter(frame=>Date.parse(frame.observedAt)<=Date.parse(input.decisionAt));
 const eventRows=input.historicalEvents.filter(event=>Date.parse(event.stamp.observedAt)<=Date.parse(input.decisionAt));
 const selectedCandidateKind=(selectedCandidate?(winner?'RANKING_WINNER':'TOP_RANKED_COUNTERFACTUAL'):'NONE') as 'RANKING_WINNER'|'TOP_RANKED_COUNTERFACTUAL'|'NONE';
 const poolQualityShadow=derivePoolQualityProspectiveShadowSnapshot(input.poolAssessment);
 const forwardValidation={version:'phase3-forward-decision-v1' as const,horizonMinutes:input.horizonMinutes,capitalValue:input.capitalValue,capitalLamports:String(Math.max(0,Math.round(input.capitalValue*1_000_000_000))),activeBinIdAtDecision:input.activeBinId,rawUnitValueX:input.rawUnitValueX,rawUnitValueY:input.rawUnitValueY,costs:{compositionFeeValue:input.costs?.compositionFeeValue??'0',transactionFeeValue:input.costs?.transactionFeeValue??'0',slippageValue:input.costs?.slippageValue??'0',rebalanceCostValue:input.costs?.rebalanceCostValue??'0',otherCostValue:input.costs?.otherCostValue??'0'},selectedCandidateKind,...(selectedCandidate?{selectedCandidate}:{}),...(selectedSimulation?{selectedSimulation}:{}),...(selectedSurvival?{selectedSurvival}:{}),evidence:{replayEvidenceWatermark:input.decisionAt,historicalFrameHash:await sha256Hex(canonicalJson(frameRows)),historicalEventHash:await sha256Hex(canonicalJson(eventRows)),...(frameRows.at(-1)?{latestFrameAt:frameRows.at(-1)!.observedAt}:{}),...(eventRows.at(-1)?{latestEventAt:eventRows.at(-1)!.stamp.observedAt}:{}),...(selectedCandidateId&&replayAnchorByCandidate.get(selectedCandidateId)?{replayAnchorAt:replayAnchorByCandidate.get(selectedCandidateId)!}:{})},poolQualityShadow,wouldAugEraThesisSemanticsHaveCreatedThesis:Boolean(selectedCandidate&&economics.economicallyPositive&&!['REJECTED','EXPIRED','DATA_BLOCKED'].includes(progress.state))};
 const marketRows=input.currentObservations.filter(row=>Date.parse(row.observedAt)<=Date.parse(input.decisionAt)).map(row=>({...row}));
 const decisionTimeMarketContext:DecisionTimeMarketContextEvidence={schemaVersion:'phase3-decision-market-context-v1',decisionContextCutoff:input.decisionAt,sourceFreshnessBoundaryMs:180_000,raw:{marketObservations:marketRows,...(input.binFeatures?{binFeatures:{...input.binFeatures}}:{}),...(input.flowFeatures?{flowFeatures:{...input.flowFeatures}}:{}),poolAssessmentEvidence:JSON.parse(canonicalJson(input.poolAssessment.evidence)) as Record<string,unknown>},derived:{marketContext:context,structure,regime,regimeHistory,poolQualityShadow},provenance:{marketContextModelVersion:context.schemaVersion,structureModelVersion:'phase3-structure-features-v1',regimeModelVersion:'phase3-regime-v1',sourceObservationCount:marketRows.length,...(marketRows.at(-1)?{sourceObservedAtMax:marketRows.at(-1)!.observedAt}:{})}};
 // Keep the evidence attachment out of core, so the recommendation ID and
 // all decision semantics remain byte-for-byte based on the pre-M0050 core.
 const core={phase:'P3' as const,recommendationOnly:true as const,decisionAt:input.decisionAt,expiresAt:input.expiresAt,pool:input.pool,state:noTrade?progress.state:'ENTRY_READY',noTrade,marketContextHash:context.hash,regime,regimeHistory,pullback,breakoutPullback,economics,qualification,uncertaintyLineage,candidateCount:candidates.length,simulations,ranking,forwardValidation,...(thesis?{thesis}:{}),reasonCodes};const recommendationId=await sha256Hex(canonicalJson(core));const candidateUniverseEvidence={version:'reset3c-universe-v1' as const,capitalLamports:forwardValidation.capitalLamports,frames:frameRows.map(frame=>({...frame,bins:frame.bins.map(bin=>({...bin}))})),events:eventRows.map(event=>({...event,stamp:{...event.stamp}})),costs:forwardValidation.costs,candidates:candidates.map(candidate=>({...candidate,perBinWeights:candidate.perBinWeights.map(weight=>({...weight}))})),simulations:simulations.map(simulation=>({...simulation,warnings:[...simulation.warnings]})),ranking,qualification:JSON.parse(canonicalJson(qualification)) as Record<string,unknown>,economics:JSON.parse(canonicalJson(economics)) as Record<string,unknown>};return{recommendationId,...core,decisionTimeMarketContext,candidateUniverseEvidence};
}
