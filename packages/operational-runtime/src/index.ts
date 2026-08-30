import { canonicalJson, sha256Hex, type BinLiquidityFact, type PoolStateFact, type SwapEventFact } from '../../domain/src/index.js';
import type { DataApiPool } from '../../data-api/src/index.js';
import { computeActiveBinMovement, computeBinWindowFeatures, computeFeeQuality, computeSwapFlowFeatures } from '../../features/src/index.js';
import { assessPool, poolInputFromDataApi, PHASE6_CANARY_POOL_POLICY_V1, type PoolAssessment } from '../../pool-intelligence/src/index.js';
import { buildShadowRecommendation, type ShadowRecommendation } from '../../shadow/src/index.js';
import { buildMarketContext, type MarketObservation } from '../../market-context/src/index.js';
import { computeStructureFeatures } from '../../structure-features/src/index.js';
import { computeEntryTimingFeatures } from '../../entry-features/src/index.js';
import { evaluateEntry, type EntryRecommendation } from '../../entry-intelligence/src/index.js';
import { allocateCapital, allocateProductionCapital, type CapitalAllocationResult, type ProductionCapitalPolicy } from '../../capital-allocation/src/index.js';
import { governMarketEntryRisk, type RiskDecision } from '../../risk-governor/src/index.js';
import { buildStrategyWeights, type RangeStrategyCandidate } from '../../rangeforge/src/index.js';
import { buildTransactionPlan } from '../../transaction-planner/src/index.js';
import type { TransactionPlan } from '../../execution-contracts/src/index.js';
import type { OpportunityRateEvidence, Phase3QualificationPolicyId } from '../../opportunity/src/index.js';
import type { RegimeHistorySample } from '../../regime/src/index.js';
import { quotePhase6ExactSolEntryFunding, type Phase6EntryFundingPlan } from '../../phase6-inventory-routing/src/index.js';
import type { SwapQuoteAssessment } from '../../phase6-swap-quote/src/index.js';

export interface OperationalHistory {
  marketObservations:MarketObservation[];
  activeBins:Array<{observedAt:string;activeBinId:number}>;
  binFrames:Array<{observedAt:string;activeBinId:number;bins:Array<{binId:number;price:string;amountX:string;amountY:string;liquiditySupply?:string}>}>;
  swapEvents:SwapEventFact[];
}
export interface OperationalRuntimePolicy {
  id:string;
  minMarketObservations:number;
  minActiveBinObservations:number;
  minBinFrames:number;
  horizonMinutes:number;
  thesisTtlMinutes:number;
  aggregateUncertainty:number;
  adverseInventoryRateFloor:number;
  repositionRatePerCapitalHour:number;
  tailRiskRatePerCapitalHour:number;
  executionCostFixed:number;
}
export const OPERATIONAL_COMPLETION_POLICY_V1:OperationalRuntimePolicy={id:'phase5-operational-completion-v1',minMarketObservations:12,minActiveBinObservations:12,minBinFrames:3,horizonMinutes:60,thesisTtlMinutes:5,aggregateUncertainty:.55,adverseInventoryRateFloor:.0005,repositionRatePerCapitalHour:.0005,tailRiskRatePerCapitalHour:.00035,executionCostFixed:.00001};
export type OperationalStatus='WARMING'|'NO_TRADE'|'WAIT'|'REJECT'|'ENTRY_READY'|'PLAN_PREPARED';
export const PHASE3_MIN_FRESH_LIVE_OBSERVATIONS=3;
export const PHASE3_RECENT_LIVE_OBSERVATION_WINDOW_MS=15*60_000;
export const PHASE3_MAX_LIVE_OBSERVATION_AGE_SECONDS=180;
export const PHASE3_MAX_LIVE_OBSERVATION_GAP_SECONDS=450;
export interface OperationalCycleInput {
  observedAt:string;
  pool:PoolStateFact;
  bins:BinLiquidityFact[];
  dataApiPool:DataApiPool;
  history:OperationalHistory;
  priorRegimeAssessments?:RegimeHistorySample[];
  protocolCompatible:boolean;
  walletCapital:number;
  ownerAddress?:string;
  replacementPositionAddress?:string;
  swapQuoteProvider?:{quote(input:{inputMint:string;outputMint:string;inputAmount:bigint;requiredOutputAmount:bigint}):Promise<SwapQuoteAssessment>};
  economicEvidence?:{fidelity:string;effectiveSampleCount:number;feeRatePerCapitalHour:number;uncertainty:number;evidenceAgeSeconds:number;rawObservationCount:number;independentEpisodeCount:number;feeObservationCount:number;eventPathObservationCount:number;sourceHashes?:Record<string,unknown>};
  evidenceMaturity?:{state:string;historicalState?:string;historicalBackfillQuality?:string;liveConfirmationState?:string;recentLiveObservationCount?:number;latestLiveObservationAgeSeconds?:number;maxRecentLiveObservationGapSeconds?:number;reasonCodes?:string[]};
  /** Production-only capital envelope.  When present, Phase 4's decision is
   * not re-scored by the legacy research allocator. */
  productionCapitalPolicy?:ProductionCapitalPolicy;
  productionPoolCapital?:number;
  /** Explicit execution-policy cap, not a RangeForge hard-coded limit. */
  maxRangeWidthBins?:number;
  /** Explicit and auditable Phase-3 economic-authority selection. */
  qualificationPolicy?:Phase3QualificationPolicyId;
  /** False means observe/shadow: do not quote, fund, or construct a plan. */
  planPreparationEnabled?:boolean;
  /** Explicit upstream reasons that prevent a new plan without changing the
   * market decision itself (for example, no free wallet capital or no slot). */
  planPreparationBlockReasonCodes?:readonly string[];
  policy?:OperationalRuntimePolicy;
}
export interface OperationalCycleResult {
  cycleId:string;
  poolAddress:string;
  observedAt:string;
  phase3Status:OperationalStatus;
  phase4Status:OperationalStatus;
  phase5Status:'NOT_REACHED'|'PREPARE_BLOCKED_PUBLIC_ADDRESSES'|'PLAN_PREPARED_BUILD_ONLY';
  poolAssessment:PoolAssessment;
  shadow?:ShadowRecommendation;
  entry?:EntryRecommendation;
  risk?:RiskDecision;
  allocation?:CapitalAllocationResult;
  entryFunding?:Phase6EntryFundingPlan;
  swapQuote?:SwapQuoteAssessment;
  plan?:TransactionPlan;
  reasonCodes:string[];
  evidence:{history:{market:number;activeBins:number;frames:number;swaps:number};rateEvidence:OpportunityRateEvidence;valuation:CandidateValuationCalibration;policyId:string};
}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
/**
 * Historical bootstrap is independently validated by the discovery collector:
 * genuine backfill must be mature and a separate live-confirmation window must
 * be confirmed.  Phase 4 consumes that proof for its unchanged completeness
 * requirement; timing-sensitive features continue to use the current stream.
 */
export function resolvePhase4DataCompleteness(current:number,evidenceMaturity?:OperationalCycleInput['evidenceMaturity']):{value:number;source:'CURRENT_STREAM'|'BACKFILL_PLUS_LIVE_CONFIRMATION'}{
 const mature=hasConfirmedEvidenceMaturity(evidenceMaturity);
 return mature?{value:Math.max(clamp(current),.60),source:'BACKFILL_PLUS_LIVE_CONFIRMATION'}:{value:clamp(current),source:'CURRENT_STREAM'};
}
/** An automatic capital-moving decision requires both historical maturity and
 * a separate current live confirmation.  A missing DB row is not evidence. */
export function hasConfirmedEvidenceMaturity(evidenceMaturity?:OperationalCycleInput['evidenceMaturity']):boolean{
 return evidenceMaturity?.state==='MATURE'&&evidenceMaturity.historicalState==='MATURE'&&evidenceMaturity.liveConfirmationState==='CONFIRMED';
}
export function summarizePhase3RecentLiveObservations(observedAt:string,observationTimes:readonly string[]){
 const decisionAt=Date.parse(observedAt),windowStart=decisionAt-PHASE3_RECENT_LIVE_OBSERVATION_WINDOW_MS;
 const times=observationTimes.map(value=>Date.parse(value)).filter(value=>Number.isFinite(value)&&value>=windowStart&&value<=decisionAt).sort((a,b)=>a-b);
 const latest=times.at(-1),gaps=times.slice(1).map((value,index)=>(value-times[index]!)/1000);
 return{recentLiveObservationCount:times.length,latestLiveObservationAgeSeconds:latest===undefined?Number.POSITIVE_INFINITY:Math.max(0,(decisionAt-latest)/1000),maxRecentLiveObservationGapSeconds:gaps.length===0?Number.POSITIVE_INFINITY:Math.max(...gaps)};
}
/**
 * Phase 3 needs trustworthy historical economics and current market facts;
 * it does not need the collector's longer continuity window to have finished.
 * That continuity signal is retained for Phase-4 completeness/readiness, and
 * stale current facts remain an absolute pre-Phase-3 block.
 */
export function hasPhase3FreshHistoricalEvidence(evidenceMaturity?:OperationalCycleInput['evidenceMaturity']):boolean{
 return evidenceMaturity?.historicalState==='MATURE'
  &&evidenceMaturity.historicalBackfillQuality==='SUFFICIENT'
  &&Number.isFinite(evidenceMaturity.latestLiveObservationAgeSeconds)
  &&Number(evidenceMaturity.latestLiveObservationAgeSeconds)<=PHASE3_MAX_LIVE_OBSERVATION_AGE_SECONDS
  &&Number(evidenceMaturity.recentLiveObservationCount??0)>=PHASE3_MIN_FRESH_LIVE_OBSERVATIONS
  &&Number.isFinite(evidenceMaturity.maxRecentLiveObservationGapSeconds)
  &&Number(evidenceMaturity.maxRecentLiveObservationGapSeconds)<PHASE3_MAX_LIVE_OBSERVATION_GAP_SECONDS;
}
/** Stored evidence age is a fact at estimate creation, not at decision time. */
export function decisionTimeEconomicEvidenceAgeSeconds(input:{estimateAsOf:string;storedEvidenceAgeSeconds:number;decisionAt:string}):number{
 const estimateMs=Date.parse(input.estimateAsOf),decisionMs=Date.parse(input.decisionAt);
 if(!Number.isFinite(estimateMs)||!Number.isFinite(decisionMs)||!Number.isFinite(input.storedEvidenceAgeSeconds)||input.storedEvidenceAgeSeconds<0)return Number.POSITIVE_INFINITY;
 return Math.max(0,input.storedEvidenceAgeSeconds+(decisionMs-estimateMs)/1000);
}
function numeric(v:unknown,fallback=0){const n=Number(v);return Number.isFinite(n)?n:fallback;}
const WRAPPED_SOL_MINT='So11111111111111111111111111111111111111112';
const CANONICAL_USDC_MINT='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
function knownDecimals(mint:string|undefined):number|undefined{return mint===WRAPPED_SOL_MINT?9:mint===CANONICAL_USDC_MINT?6:undefined;}
export interface CandidateValuationCalibration {valueUnit:'TOKEN_X';rawUnitValueX:number;rawUnitValueY:number;tokenXDecimals:number;tokenYDecimals:number;quotePerTokenX:number;valid:boolean;source:string;reasonCodes:string[];}
export function deriveCandidateValuationCalibration(pool:PoolStateFact,dataApiPool:DataApiPool,bins:BinLiquidityFact[]):CandidateValuationCalibration{
  const tokenXMint=dataApiPool.token_x?.address??pool.tokenXMint,tokenYMint=dataApiPool.token_y?.address??pool.tokenYMint;
  const dx=dataApiPool.token_x?.decimals??knownDecimals(tokenXMint),dy=dataApiPool.token_y?.decimals??knownDecimals(tokenYMint);
  const activePrice=numeric(bins.find(b=>b.binId===pool.activeBinId)?.price,NaN);const apiPrice=numeric(dataApiPool.current_price,NaN);const quotePerTokenX=apiPrice>0?apiPrice:activePrice;
  const valid=Number.isInteger(dx)&&Number.isInteger(dy)&&dx!>=0&&dy!>=0&&quotePerTokenX>0;
  const reasonCodes:string[]=[];if(!Number.isInteger(dx)||dx!<0)reasonCodes.push('VALUATION_TOKEN_X_DECIMALS_MISSING');if(!Number.isInteger(dy)||dy!<0)reasonCodes.push('VALUATION_TOKEN_Y_DECIMALS_MISSING');if(!(quotePerTokenX>0))reasonCodes.push('VALUATION_REFERENCE_PRICE_MISSING');
  return{valueUnit:'TOKEN_X',rawUnitValueX:valid?10**(-dx!):0,rawUnitValueY:valid?(10**(-dy!))/quotePerTokenX:0,tokenXDecimals:dx??-1,tokenYDecimals:dy??-1,quotePerTokenX:quotePerTokenX>0?quotePerTokenX:0,valid,source:apiPrice>0?'METEORA_DATA_API_CURRENT_PRICE':'ACTIVE_BIN_PRICE_FALLBACK',reasonCodes};
}
export function deriveAggregateRateEvidence(pool:DataApiPool,assessment:PoolAssessment,policy:OperationalRuntimePolicy=OPERATIONAL_COMPLETION_POLICY_V1):OpportunityRateEvidence{
  const tvl=Math.max(0,numeric(pool.tvl));
  const ratio1h=numeric(pool.fee_tvl_ratio?.['1h'],NaN);
  const fee1h=numeric(pool.fees?.['1h']);
  const feeRate=Number.isFinite(ratio1h)&&ratio1h>=0?ratio1h:(tvl>0?fee1h/tvl:0);
  const adverse=Math.max(policy.adverseInventoryRateFloor,.0005+assessment.toxicityProbability*.003);
  return{feeRatePerCapitalHour:Math.max(0,feeRate),adverseInventoryRatePerCapitalHour:adverse,repositionRatePerCapitalHour:policy.repositionRatePerCapitalHour,tailRiskRatePerCapitalHour:policy.tailRiskRatePerCapitalHour,executionCostFixed:policy.executionCostFixed,sampleCount:Math.max(1,Object.values(pool.fees??{}).filter(v=>typeof v==='number').length),uncertainty:policy.aggregateUncertainty,fidelity:'AGGREGATE_ESTIMATE'};
}
export function deriveEventPathRateEvidence(evidence:NonNullable<OperationalCycleInput['economicEvidence']>,assessment:PoolAssessment,policy:OperationalRuntimePolicy=OPERATIONAL_COMPLETION_POLICY_V1):OpportunityRateEvidence{
 return{feeRatePerCapitalHour:Math.max(0,evidence.feeRatePerCapitalHour),adverseInventoryRatePerCapitalHour:Math.max(policy.adverseInventoryRateFloor,.0005+assessment.toxicityProbability*.003),repositionRatePerCapitalHour:policy.repositionRatePerCapitalHour,tailRiskRatePerCapitalHour:policy.tailRiskRatePerCapitalHour,executionCostFixed:policy.executionCostFixed,sampleCount:Math.max(1,evidence.effectiveSampleCount),uncertainty:clamp(evidence.uncertainty),fidelity:'EVENT_PATH_ESTIMATE'};
}
function candidateFromThesis(thesis:NonNullable<ShadowRecommendation['thesis']>):RangeStrategyCandidate{
  const s=thesis.selectedCandidate; const width=Math.max(1,s.widthBins); const center=s.centerBinId; const family=(s.id.toUpperCase().includes('DEFENSIVE')?'DEFENSIVE':s.id.toUpperCase().includes('WIDE')?'WIDE':s.id.toUpperCase().includes('NARROW')?'NARROW':'BASE') as RangeStrategyCandidate['family'];
  const geometry={id:s.id,family,lowerBinId:s.lowerBinId,upperBinId:s.upperBinId,centerBinId:center,widthBins:width,lowerOffsetBins:s.lowerBinId-center,upperOffsetBins:s.upperBinId-center,lowerDistancePct:0,upperDistancePct:0,reasonCodes:['OPERATIONAL_SELECTED_CANDIDATE']};
  const strategy=s.strategy as RangeStrategyCandidate['strategy'];
  const orientation=s.orientation as RangeStrategyCandidate['orientation'];return{...geometry,strategy,orientation,capitalFraction:s.capitalFraction,perBinWeights:s.perBinWeights};
}
export async function evaluateOperationalCycle(input:OperationalCycleInput):Promise<OperationalCycleResult>{
  const p=input.policy??OPERATIONAL_COMPLETION_POLICY_V1;
  const decisionMs=Date.parse(input.observedAt);
  if(!Number.isFinite(decisionMs))throw new Error('LPFORGE_OPERATIONAL_DECISION_TIME_INVALID');
  const poolObservedMs=Date.parse(input.pool.stamp.observedAt);
  if(!Number.isFinite(poolObservedMs))throw new Error('LPFORGE_OPERATIONAL_CURRENT_POOL_TIME_INVALID');
  if(poolObservedMs>decisionMs)throw new Error('LPFORGE_OPERATIONAL_LOOKAHEAD_CURRENT_POOL');
  for(const b of input.bins){const observedMs=Date.parse(b.stamp.observedAt);if(!Number.isFinite(observedMs))throw new Error('LPFORGE_OPERATIONAL_CURRENT_BIN_TIME_INVALID');if(observedMs>decisionMs)throw new Error('LPFORGE_OPERATIONAL_LOOKAHEAD_CURRENT_BIN');}
  for(const x of input.history.marketObservations)if(Date.parse(x.observedAt)>decisionMs)throw new Error('LPFORGE_OPERATIONAL_LOOKAHEAD_MARKET');
  for(const x of input.history.activeBins)if(Date.parse(x.observedAt)>decisionMs)throw new Error('LPFORGE_OPERATIONAL_LOOKAHEAD_ACTIVE_BIN');
  const bin=computeBinWindowFeatures(input.bins,input.pool.activeBinId);
  const movement=computeActiveBinMovement(input.history.activeBins.map(x=>({binId:x.activeBinId,observedAt:x.observedAt})));
  const flow=computeSwapFlowFeatures(input.history.swapEvents);
  const fee=computeFeeQuality(input.dataApiPool);
  const poolAssessment=assessPool(poolInputFromDataApi(input.dataApiPool,{bin,movement,flow,fee},{protocolCompatible:input.protocolCompatible,dataFreshness:'GOOD',observedAt:input.observedAt,dataAgeSeconds:0,functionType:input.pool.functionType==='UNDETERMINED'?'UNKNOWN':input.pool.functionType}),PHASE6_CANARY_POOL_POLICY_V1);
  const freshEventPathEvidence=input.economicEvidence?.fidelity==='EVENT_PATH_ESTIMATE'&&Number.isFinite(input.economicEvidence.evidenceAgeSeconds)&&input.economicEvidence.evidenceAgeSeconds<=300;
  const rateEvidence=freshEventPathEvidence?deriveEventPathRateEvidence(input.economicEvidence!,poolAssessment,p):deriveAggregateRateEvidence(input.dataApiPool,poolAssessment,p);
  const valuation=deriveCandidateValuationCalibration(input.pool,input.dataApiPool,input.bins);
  const reasonCodes:string[]=[];
  const ready=input.history.marketObservations.length>=p.minMarketObservations&&input.history.activeBins.length>=p.minActiveBinObservations&&input.history.binFrames.length>=p.minBinFrames;
  const base={poolAddress:input.pool.address,observedAt:input.observedAt,poolAssessment,evidence:{history:{market:input.history.marketObservations.length,activeBins:input.history.activeBins.length,frames:input.history.binFrames.length,swaps:input.history.swapEvents.length},rateEvidence,valuation,policyId:p.id,...(input.evidenceMaturity?{maturity:input.evidenceMaturity}:{})}};
  const automaticCapitalPath=Boolean(input.productionCapitalPolicy||input.planPreparationEnabled);
  if(automaticCapitalPath&&!hasPhase3FreshHistoricalEvidence(input.evidenceMaturity)){reasonCodes.push(input.evidenceMaturity?'OPERATIONAL_EVIDENCE_MATURITY_PENDING':'OPERATIONAL_EVIDENCE_MATURITY_MISSING',...(input.evidenceMaturity?.reasonCodes??[]));const core={...base,phase3Status:'WARMING' as const,phase4Status:'WARMING' as const,phase5Status:'NOT_REACHED' as const,...(input.evidenceMaturity?{evidenceMaturity:input.evidenceMaturity}:{}),reasonCodes:[...new Set(reasonCodes)].sort()};return{cycleId:await sha256Hex(canonicalJson(core)),...core};}
  if(input.evidenceMaturity?.state&&input.evidenceMaturity.state!=='MATURE'&&!hasPhase3FreshHistoricalEvidence(input.evidenceMaturity)){reasonCodes.push('OPERATIONAL_EVIDENCE_MATURITY_PENDING',...(input.evidenceMaturity.reasonCodes??[]));const core={...base,phase3Status:'WARMING' as const,phase4Status:'WARMING' as const,phase5Status:'NOT_REACHED' as const,evidenceMaturity:input.evidenceMaturity,reasonCodes:[...new Set(reasonCodes)].sort()};return{cycleId:await sha256Hex(canonicalJson(core)),...core};}
  if(automaticCapitalPath&&!freshEventPathEvidence){reasonCodes.push(input.economicEvidence?'OPERATIONAL_ECONOMIC_EVIDENCE_STALE':'OPERATIONAL_ECONOMIC_EVIDENCE_MISSING');const core={...base,phase3Status:'WARMING' as const,phase4Status:'WARMING' as const,phase5Status:'NOT_REACHED' as const,reasonCodes:[...new Set(reasonCodes)].sort()};return{cycleId:await sha256Hex(canonicalJson(core)),...core};}
  if(!ready){reasonCodes.push('OPERATIONAL_FORWARD_HISTORY_WARMING');const core={...base,phase3Status:'WARMING' as const,phase4Status:'WARMING' as const,phase5Status:'NOT_REACHED' as const,reasonCodes};return{cycleId:await sha256Hex(canonicalJson(core)),...core};}
  const market=[...input.history.marketObservations];const last=market.at(-1);if(!last||Date.parse(last.observedAt)<Date.parse(input.observedAt)){market.push({observedAt:input.observedAt,price:numeric(input.dataApiPool.current_price,1),activeBinId:input.pool.activeBinId,volume:numeric(input.dataApiPool.volume?.['5m']),feeValue:numeric(input.dataApiPool.fees?.['5m']),twoWayRatio:flow.twoWayRatio,localLiquidity:numeric(input.dataApiPool.tvl)});}
  const expiresAt=new Date(Date.parse(input.observedAt)+p.thesisTtlMinutes*60000).toISOString();
  // Production candidates are always evaluated at the configured exact target.
  // Capacity is checked separately before plan preparation, so a small wallet
  // becomes NO_TRADE rather than silently shrinking candidate economics.
  const decisionCapital=input.productionCapitalPolicy?input.productionCapitalPolicy.targetInitialPosition:input.walletCapital;
  let shadow:ShadowRecommendation;try{shadow=await buildShadowRecommendation({pool:input.pool.address,decisionAt:input.observedAt,expiresAt,activeBinId:input.pool.activeBinId,binStep:input.pool.binStep,horizonMinutes:p.horizonMinutes,capitalValue:decisionCapital,currentObservations:market,historicalActiveBins:input.history.activeBins,historicalFrames:input.history.binFrames,historicalEvents:input.history.swapEvents,priorRegimeAssessments:input.priorRegimeAssessments??[],poolAssessment,rateEvidence,binFeatures:bin,flowFeatures:flow,rawUnitValueX:valuation.rawUnitValueX,rawUnitValueY:valuation.rawUnitValueY,costs:{transactionFeeValue:String(p.executionCostFixed)},strategyOrientations:{SPOT:['BALANCED','SKEWED_Y','ONE_SIDED_Y'],CURVE:['BALANCED','SKEWED_Y','ONE_SIDED_Y'],BID_ASK:['BALANCED','SKEWED_Y','ONE_SIDED_Y']},capitalFractions:[1],...(input.maxRangeWidthBins!==undefined?{maxRangeWidthBins:input.maxRangeWidthBins}:{}),...(input.qualificationPolicy?{qualificationPolicy:input.qualificationPolicy}:{})});}catch(error){if(error instanceof Error&&error.message==='CANDIDATE_REPLAY_ANCHOR_UNAVAILABLE'){reasonCodes.push(error.message);const core={...base,phase3Status:'NO_TRADE' as const,phase4Status:'NO_TRADE' as const,phase5Status:'NOT_REACHED' as const,reasonCodes};return{cycleId:await sha256Hex(canonicalJson(core)),...core};}throw error;}
  if(!shadow.thesis){reasonCodes.push(...shadow.reasonCodes,'OPERATIONAL_NO_TRADE');const core={...base,phase3Status:'NO_TRADE' as const,phase4Status:'NO_TRADE' as const,phase5Status:'NOT_REACHED' as const,shadow,reasonCodes:[...new Set(reasonCodes)].sort()};return{cycleId:await sha256Hex(canonicalJson(core)),...core};}
  const context=await buildMarketContext(input.pool.address,input.observedAt,market);const structure=computeStructureFeatures({context,observations:market,bin,flow});const candidate=candidateFromThesis(shadow.thesis);const currentEntryFeatures=computeEntryTimingFeatures({context,regime:shadow.regime,regimeHistory:shadow.regimeHistory,structure,pool:poolAssessment,candidate,activeBinId:input.pool.activeBinId,...(market.slice(0,-1).at(-1)?.twoWayRatio!==undefined?{previousTwoWayRatio:market.slice(0,-1).at(-1)!.twoWayRatio}:{} )}),dataCompleteness=resolvePhase4DataCompleteness(currentEntryFeatures.dataCompleteness,input.evidenceMaturity),entryFeatures={...currentEntryFeatures,dataCompleteness:dataCompleteness.value};const evaluatedEntry=evaluateEntry({features:entryFeatures,economics:shadow.economics,thesis:shadow.thesis,observedAt:input.observedAt,expiresAt});const entry={...evaluatedEntry,diagnostics:{poolAddress:input.pool.address,dataCompleteness:entryFeatures.dataCompleteness,currentStreamDataCompleteness:currentEntryFeatures.dataCompleteness,dataCompletenessSource:dataCompleteness.source,completeness5m:context.horizons['5m'].completeness,completeness15m:context.horizons['15m'].completeness,completeness1h:context.horizons['1h'].completeness,economicsUncertainty:shadow.economics.uncertainty,economicsFidelity:shadow.economics.evidenceFidelity,economicsSampleCount:shadow.economics.evidenceSampleCount,economicsEffectiveSampleCount:input.economicEvidence?.effectiveSampleCount??0,economicEvidenceAgeSeconds:input.economicEvidence?.evidenceAgeSeconds??null,twoWayFlowStrength:entryFeatures.twoWayFlowStrength,swapEventCount:input.history.swapEvents.length,flowEvidenceState:input.history.swapEvents.length===0?'INSUFFICIENT':entryFeatures.twoWayFlowStrength<.42?'MEASURED_ONE_WAY':'MEASURED_TWO_WAY',supportReclaimStrength:entryFeatures.supportReclaimStrength,regimeStability:entryFeatures.regimeStability,regimeStabilitySource:'TEMPORAL_COHERENCE',regimeHistory:shadow.regimeHistory,regimeConfidence:shadow.regime.confidence,transitionRisk:shadow.regime.transitionRisk,downsideDeceleration:entryFeatures.downsideDeceleration,volatilityExpansionRisk:entryFeatures.volatilityExpansionRisk,immediateOorRisk:entryFeatures.immediateOorRisk,readinessScore:evaluatedEntry.readinessScore,thresholds:{dataCompleteness:.60,economicsUncertaintyMax:.72,twoWayFlowMin:.42,supportReclaimMin:.48,regimeStabilityMin:.30,readinessMin:.60},finalPhase4Action:evaluatedEntry.decision,...(input.history.swapEvents.length===0?{diagnosticReason:'WAIT_FLOW_EVIDENCE_INSUFFICIENT'}:{})}};
  const risk=governMarketEntryRisk({now:input.observedAt,protocolCompatible:input.protocolCompatible,criticalDataObservedAt:input.pool.stamp.observedAt});
  const allocation=input.productionCapitalPolicy&&input.productionPoolCapital!==undefined
    ?allocateProductionCapital({walletCapital:input.walletCapital,policy:input.productionCapitalPolicy,requests:[{id:`alloc-${shadow.thesis.thesisId}`,pool:input.pool.address,token:input.dataApiPool.token_x?.address??input.pool.tokenXMint,requested:input.productionCapitalPolicy.targetInitialPosition*shadow.thesis.selectedCandidate.capitalFraction,maxPoolCapital:input.productionPoolCapital,entryReady:entry.decision==='ENTRY_READY',expectedNetValue:shadow.thesis.expectedEconomics.netLpValue}]})
    :allocateCapital({walletCapital:input.walletCapital,requests:[{id:`alloc-${shadow.thesis.thesisId}`,pool:input.pool.address,token:input.dataApiPool.token_x?.address??input.pool.tokenXMint,requested:input.walletCapital*shadow.thesis.selectedCandidate.capitalFraction,confidence:entry.confidence,expectedNetValueRate:shadow.thesis.expectedEconomics.netLpValue/Math.max(input.walletCapital,Number.EPSILON),downsideRisk:clamp(entryFeatures.dangerousRegimeMass)}]});
  const exactProductionCapital=input.productionCapitalPolicy?.targetInitialPosition,allocationExact=exactProductionCapital===undefined||allocation.totalAllocated===0||allocation.totalAllocated===exactProductionCapital,entryPrerequisitesMet=entry.decision==='ENTRY_READY'&&risk.decision==='APPROVE'&&allocation.totalAllocated>0&&allocationExact;
  if(!entryPrerequisitesMet){if(entry.decision!=='ENTRY_READY')reasonCodes.push('OPERATIONAL_ENTRY_NOT_READY');if(risk.decision!=='APPROVE')reasonCodes.push('OPERATIONAL_RISK_NOT_APPROVED');if(!(allocation.totalAllocated>0))reasonCodes.push('OPERATIONAL_CAPITAL_ALLOCATION_ZERO');if(!allocationExact)reasonCodes.push('OPERATIONAL_EXACT_PRODUCTION_CAPITAL_REQUIRED');const core={...base,phase3Status:'ENTRY_READY' as const,phase4Status:entry.decision==='ENTRY_READY'?'WAIT' as const:entry.decision,phase5Status:'NOT_REACHED' as const,shadow,entry,risk,allocation,reasonCodes:[...new Set(reasonCodes)].sort()};return{cycleId:await sha256Hex(canonicalJson(core)),...core};}
  if(input.planPreparationEnabled===false){reasonCodes.push(...(input.planPreparationBlockReasonCodes?.length?input.planPreparationBlockReasonCodes:['OPERATIONAL_PLAN_DISPATCH_DISABLED']));const core={...base,phase3Status:'ENTRY_READY' as const,phase4Status:'ENTRY_READY' as const,phase5Status:'NOT_REACHED' as const,shadow,entry,risk,allocation,reasonCodes:[...new Set(reasonCodes)].sort()};return{cycleId:await sha256Hex(canonicalJson(core)),...core};}
  const capitalLamports=BigInt(Math.floor(allocation.totalAllocated*1_000_000_000)),activeBin=input.bins.find(binFact=>binFact.binId===input.pool.activeBinId);if(!activeBin)throw new Error('LPFORGE_OPERATIONAL_ACTIVE_BIN_LIQUIDITY_MISSING');
  const entryFunding=await quotePhase6ExactSolEntryFunding({strategy:candidate.strategy,orientation:candidate.orientation,capitalLamports,activeBinId:input.pool.activeBinId,binStep:input.pool.binStep,lowerBinId:candidate.lowerBinId,upperBinId:candidate.upperBinId,activeBinXAmount:activeBin.amountX,activeBinYAmount:activeBin.amountY,perBinWeights:candidate.perBinWeights});
  const requiresSwap=entryFunding.solToPairedTokenLamports>0n;let swapQuote:SwapQuoteAssessment|undefined;if(requiresSwap){if(input.swapQuoteProvider)swapQuote=await input.swapQuoteProvider.quote({inputMint:input.pool.tokenYMint,outputMint:input.pool.tokenXMint,inputAmount:entryFunding.solToPairedTokenLamports,requiredOutputAmount:entryFunding.totalPairedTokenRaw});else swapQuote={status:'UNAVAILABLE',reasonCodes:['P6_SWAP_QUOTE_PROVIDER_REQUIRED']};}
  const swapReady=!requiresSwap||swapQuote?.status==='APPROVED';let phase4Status:OperationalStatus=entry.decision==='ENTRY_READY'&&risk.decision==='APPROVE'&&allocation.totalAllocated>0&&swapReady?'ENTRY_READY':entry.decision==='ENTRY_READY'&&!swapReady?'WAIT':entry.decision;
  let phase5Status:OperationalCycleResult['phase5Status']='NOT_REACHED';let plan:TransactionPlan|undefined;
  if(phase4Status==='ENTRY_READY'){
    if(!input.ownerAddress){phase5Status='PREPARE_BLOCKED_PUBLIC_ADDRESSES';reasonCodes.push('OPERATIONAL_P5_OWNER_ADDRESS_REQUIRED');}
    else {plan=buildTransactionPlan({action:'OPEN',cluster:'mainnet-beta',ownerAddress:input.ownerAddress,poolAddress:input.pool.address,...(input.replacementPositionAddress?{replacementPositionAddress:input.replacementPositionAddress}:{}),thesisId:shadow.thesis.thesisId,candidateId:candidate.id,observedAt:input.observedAt,expiresAt,capitalLamports,lowerBinId:entryFunding.lowerBinId,upperBinId:entryFunding.upperBinId,activeBinId:input.pool.activeBinId,binStep:input.pool.binStep,strategy:entryFunding.strategy,...(input.maxRangeWidthBins!==undefined?{maxPositionWidthBins:input.maxRangeWidthBins}:{}),metadata:{authority:'AUTONOMOUS_DISPATCH',operationalCompletion:true,positionSigner:input.replacementPositionAddress?'EXTERNAL_POSITION_ADDRESS':'EPHEMERAL_POSITION_V2',entryFunding:{orientation:entryFunding.orientation,pairedTokenTargetBps:entryFunding.pairedTokenTargetBps,solForLpLamports:entryFunding.solForLpLamports.toString(),solToPairedTokenLamports:entryFunding.solToPairedTokenLamports.toString(),totalPairedTokenRaw:entryFunding.totalPairedTokenRaw.toString(),meteoraSdkVersion:entryFunding.sdkVersion,reasonCodes:entryFunding.reasonCodes}}});phase5Status='PLAN_PREPARED_BUILD_ONLY';phase4Status='PLAN_PREPARED';reasonCodes.push('OPERATIONAL_P5_AUTONOMOUS_PLAN_READY');}
  }
  reasonCodes.push(...entry.reasonCodes,...risk.reasonCodes,...entryFunding.reasonCodes,...(swapQuote?.reasonCodes??[]));const core={...base,phase3Status:'ENTRY_READY' as const,phase4Status,phase5Status,shadow,entry,risk,allocation,entryFunding,...(swapQuote?{swapQuote}:{}),...(plan?{plan}:{}),reasonCodes:[...new Set(reasonCodes)].sort()};return{cycleId:await sha256Hex(canonicalJson(core)),...core};
}
