import { canonicalJson, sha256Hex, type BinLiquidityFact, type PoolStateFact, type SwapEventFact } from '../../domain/src/index.js';
import type { DataApiPool } from '../../data-api/src/index.js';
import { computeActiveBinMovement, computeBinWindowFeatures, computeFeeQuality, computeSwapFlowFeatures } from '../../features/src/index.js';
import { assessPool, poolInputFromDataApi, PHASE6_CANARY_POOL_POLICY_V1, type PoolAssessment } from '../../pool-intelligence/src/index.js';
import { buildShadowRecommendation, type ShadowRecommendation } from '../../shadow/src/index.js';
import { buildMarketContext, type MarketObservation } from '../../market-context/src/index.js';
import { computeStructureFeatures } from '../../structure-features/src/index.js';
import { computeEntryTimingFeatures } from '../../entry-features/src/index.js';
import { evaluateEntry, type EntryRecommendation } from '../../entry-intelligence/src/index.js';
import { allocateCapital, type CapitalAllocationResult } from '../../capital-allocation/src/index.js';
import { governRisk, type RiskDecision } from '../../risk-governor/src/index.js';
import { buildStrategyWeights, type RangeStrategyCandidate } from '../../rangeforge/src/index.js';
import { buildTransactionPlan } from '../../transaction-planner/src/index.js';
import type { TransactionPlan } from '../../execution-contracts/src/index.js';
import type { OpportunityRateEvidence } from '../../opportunity/src/index.js';
import type { RegimeHistorySample } from '../../regime/src/index.js';
import { planPhase6SolEntryFunding, type Phase6EntryFundingPlan } from '../../phase6-inventory-routing/src/index.js';

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
  plan?:TransactionPlan;
  reasonCodes:string[];
  evidence:{history:{market:number;activeBins:number;frames:number;swaps:number};rateEvidence:OpportunityRateEvidence;valuation:CandidateValuationCalibration;policyId:string};
}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
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
function candidateFromThesis(thesis:NonNullable<ShadowRecommendation['thesis']>):RangeStrategyCandidate{
  const s=thesis.selectedCandidate; const width=Math.max(1,s.widthBins); const center=s.centerBinId; const family=(s.id.toUpperCase().includes('DEFENSIVE')?'DEFENSIVE':s.id.toUpperCase().includes('WIDE')?'WIDE':s.id.toUpperCase().includes('NARROW')?'NARROW':'BASE') as RangeStrategyCandidate['family'];
  const geometry={id:s.id,family,lowerBinId:s.lowerBinId,upperBinId:s.upperBinId,centerBinId:center,widthBins:width,lowerOffsetBins:s.lowerBinId-center,upperOffsetBins:s.upperBinId-center,lowerDistancePct:0,upperDistancePct:0,reasonCodes:['OPERATIONAL_SELECTED_CANDIDATE']};
  const strategy=s.strategy as RangeStrategyCandidate['strategy'];
  const orientation=s.orientation as RangeStrategyCandidate['orientation'];return{...geometry,strategy,orientation,capitalFraction:s.capitalFraction,perBinWeights:buildStrategyWeights(geometry,strategy,orientation)};
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
  const rateEvidence=deriveAggregateRateEvidence(input.dataApiPool,poolAssessment,p);
  const valuation=deriveCandidateValuationCalibration(input.pool,input.dataApiPool,input.bins);
  const reasonCodes:string[]=[];
  const ready=input.history.marketObservations.length>=p.minMarketObservations&&input.history.activeBins.length>=p.minActiveBinObservations&&input.history.binFrames.length>=p.minBinFrames;
  const base={poolAddress:input.pool.address,observedAt:input.observedAt,poolAssessment,evidence:{history:{market:input.history.marketObservations.length,activeBins:input.history.activeBins.length,frames:input.history.binFrames.length,swaps:input.history.swapEvents.length},rateEvidence,valuation,policyId:p.id}};
  if(!ready){reasonCodes.push('OPERATIONAL_FORWARD_HISTORY_WARMING');const core={...base,phase3Status:'WARMING' as const,phase4Status:'WARMING' as const,phase5Status:'NOT_REACHED' as const,reasonCodes};return{cycleId:await sha256Hex(canonicalJson(core)),...core};}
  const market=[...input.history.marketObservations];const last=market.at(-1);if(!last||Date.parse(last.observedAt)<Date.parse(input.observedAt)){market.push({observedAt:input.observedAt,price:numeric(input.dataApiPool.current_price,1),activeBinId:input.pool.activeBinId,volume:numeric(input.dataApiPool.volume?.['5m']),feeValue:numeric(input.dataApiPool.fees?.['5m']),twoWayRatio:flow.twoWayRatio,localLiquidity:numeric(input.dataApiPool.tvl)});}
  const expiresAt=new Date(Date.parse(input.observedAt)+p.thesisTtlMinutes*60000).toISOString();
  const shadow=await buildShadowRecommendation({pool:input.pool.address,decisionAt:input.observedAt,expiresAt,activeBinId:input.pool.activeBinId,binStep:input.pool.binStep,horizonMinutes:p.horizonMinutes,capitalValue:input.walletCapital,currentObservations:market,historicalActiveBins:input.history.activeBins,historicalFrames:input.history.binFrames,historicalEvents:input.history.swapEvents,priorRegimeAssessments:input.priorRegimeAssessments??[],poolAssessment,rateEvidence,binFeatures:bin,flowFeatures:flow,totalPositionShareRaw:1000n,rawUnitValueX:valuation.rawUnitValueX,rawUnitValueY:valuation.rawUnitValueY,costs:{transactionFeeValue:String(p.executionCostFixed)},strategyOrientations:{SPOT:['BALANCED'],CURVE:['BALANCED','SKEWED_Y'],BID_ASK:['ONE_SIDED_Y']},capitalFractions:[1]});
  if(!shadow.thesis){reasonCodes.push(...shadow.reasonCodes,'OPERATIONAL_NO_TRADE');const core={...base,phase3Status:'NO_TRADE' as const,phase4Status:'NO_TRADE' as const,phase5Status:'NOT_REACHED' as const,shadow,reasonCodes:[...new Set(reasonCodes)].sort()};return{cycleId:await sha256Hex(canonicalJson(core)),...core};}
  const context=await buildMarketContext(input.pool.address,input.observedAt,market);const structure=computeStructureFeatures({context,observations:market,bin,flow});const candidate=candidateFromThesis(shadow.thesis);const entryFeatures=computeEntryTimingFeatures({context,regime:shadow.regime,structure,pool:poolAssessment,candidate,activeBinId:input.pool.activeBinId,...(market.slice(0,-1).at(-1)?.twoWayRatio!==undefined?{previousTwoWayRatio:market.slice(0,-1).at(-1)!.twoWayRatio}:{} )});const entry=evaluateEntry({features:entryFeatures,economics:shadow.economics,thesis:shadow.thesis,observedAt:input.observedAt,expiresAt});
  const risk=governRisk({now:input.observedAt,protocolCompatible:input.protocolCompatible,criticalDataObservedAt:input.pool.stamp.observedAt,dailyDrawdownFraction:0,rollingDrawdownFraction:0,tokenExposureFraction:0,poolExposureFraction:0,referenceDivergenceBps:0,liquidityChangeFraction:0,reconciliationRequired:false,signerHealthy:true});
  const allocation=allocateCapital({walletCapital:input.walletCapital,requests:[{id:`alloc-${shadow.thesis.thesisId}`,pool:input.pool.address,token:input.dataApiPool.token_y?.address??input.pool.tokenYMint,requested:input.walletCapital*shadow.thesis.selectedCandidate.capitalFraction,confidence:entry.confidence,expectedNetValueRate:shadow.economics.expectedNetLpValue/Math.max(input.walletCapital,Number.EPSILON),downsideRisk:clamp(entryFeatures.dangerousRegimeMass)}]});
  const capitalLamports=BigInt(Math.max(1,Math.floor(allocation.totalAllocated*1_000_000_000)));
  const entryFunding=planPhase6SolEntryFunding({strategy:candidate.strategy,orientation:candidate.orientation,capitalLamports,activeBinId:input.pool.activeBinId,lowerBinId:candidate.lowerBinId,upperBinId:candidate.upperBinId,perBinWeights:candidate.perBinWeights});
  let phase4Status:OperationalStatus=entry.decision==='ENTRY_READY'&&risk.decision==='APPROVE'&&allocation.totalAllocated>0?'ENTRY_READY':entry.decision;
  let phase5Status:OperationalCycleResult['phase5Status']='NOT_REACHED';let plan:TransactionPlan|undefined;
  if(phase4Status==='ENTRY_READY'){
    if(!input.ownerAddress||!input.replacementPositionAddress){phase5Status='PREPARE_BLOCKED_PUBLIC_ADDRESSES';reasonCodes.push('OPERATIONAL_P5_PUBLIC_ADDRESSES_REQUIRED');}
    else {plan=buildTransactionPlan({action:'OPEN',cluster:'mainnet-beta',ownerAddress:input.ownerAddress,poolAddress:input.pool.address,replacementPositionAddress:input.replacementPositionAddress,thesisId:shadow.thesis.thesisId,candidateId:candidate.id,observedAt:input.observedAt,expiresAt,capitalLamports,lowerBinId:entryFunding.lowerBinId,upperBinId:entryFunding.upperBinId,strategy:entryFunding.strategy,metadata:{authority:'BUILD_ONLY',operationalCompletion:true,entryFunding:{orientation:entryFunding.orientation,pairedTokenTargetBps:entryFunding.pairedTokenTargetBps,solForLpLamports:entryFunding.solForLpLamports.toString(),solToPairedTokenLamports:entryFunding.solToPairedTokenLamports.toString(),reasonCodes:entryFunding.reasonCodes}}});phase5Status='PLAN_PREPARED_BUILD_ONLY';phase4Status='PLAN_PREPARED';reasonCodes.push('OPERATIONAL_P5_PLAN_BUILD_ONLY');}
  }
  reasonCodes.push(...entry.reasonCodes,...risk.reasonCodes,...entryFunding.reasonCodes);const core={...base,phase3Status:'ENTRY_READY' as const,phase4Status,phase5Status,shadow,entry,risk,allocation,entryFunding,...(plan?{plan}:{}),reasonCodes:[...new Set(reasonCodes)].sort()};return{cycleId:await sha256Hex(canonicalJson(core)),...core};
}
