import type { DataApiPool, HistoricalVolumePoint } from '../../data-api/src/index.js';
import type { BinLiquidityFact, SwapEventFact } from '../../domain/src/index.js';
import { computeBinWindowFeatures, computeSwapFlowFeatures, computeActiveBinMovement, type ActiveBinMovementFeatures, type SwapFlowFeatures, type BinWindowFeatures } from '../../features/src/index.js';
import { computeSustainability, type SustainabilityFeatures } from '../../pool-intelligence/src/index.js';
import { feeEfficiencyScorePct, type CanonicalDiscoveryMetrics } from '../../discovery-metrics/src/index.js';
export type DeepEligibility='QUALIFIED'|'WATCHLIST'|'BLOCK'|'QUARANTINED';
export interface DeepScreenPolicy {
  id:string;
  minProtocolConfidence:number;
  minPoolQuality:number;
  minOpportunity:number;
  maxToxicity:number;
  minFeePersistence:number;
  maxReferenceDivergenceBps:number;
  maxLiquidityDropPct:number;
}
export const DEFAULT_DEEP_SCREEN_POLICY:DeepScreenPolicy={id:'pool-deep-screen-v2.1.1',minProtocolConfidence:1,minPoolQuality:45,minOpportunity:40,maxToxicity:.78,minFeePersistence:.35,maxReferenceDivergenceBps:250,maxLiquidityDropPct:35};
export interface DeepScreenInput {
  pool:DataApiPool;
  protocolCompatible:boolean;
  observedAt:string;
  activeBinId:number;
  bins:BinLiquidityFact[];
  activeBinHistory:Array<{binId:number;observedAt:string}>;
  swaps:SwapEventFact[];
  historicalFees:HistoricalVolumePoint[];
  referenceDivergenceBps?:number;
  recentLiquidityChangePct?:number;
  marketFragility?:number;
  dataFresh:boolean;
  missingEvidence?:string[];
  /** D1's canonical percentage-point contract; optional for historic fixtures. */
  discoveryMetrics?:CanonicalDiscoveryMetrics;
}
export interface ToxicityFeatures {
  directionalDominance:number;
  velocity:number;
  directionality:number;
  meanBinsCrossed:number;
  largeMovePressure:number;
  adverseInventoryPressure:number;
  toxicityProbability:number;
}
export interface DeepScreenResult {
  policyId:string;
  poolAddress:string;
  observedAt:string;
  eligibility:DeepEligibility;
  poolQualityScore:number;
  currentOpportunityScore:number;
  executableLiquidityScore:number;
  feeQualityScore:number;
  flowQualityScore:number;
  toxicity:ToxicityFeatures;
  feeSustainability:SustainabilityFeatures;
  bin:BinWindowFeatures;
  movement:ActiveBinMovementFeatures;
  flow:SwapFlowFeatures;
  opportunityHalfLifeMinutes:number|null;
  reasonCodes:string[];
  evidenceAvailability:Record<string,'AVAILABLE'|'UNAVAILABLE'|'STALE'|'CONTRADICTORY'|'NOT_APPLICABLE'>;
  evidence:Record<string,unknown>;
}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:undefined;
const score100=(x:number)=>Math.round(clamp(x)*10000)/100;
const logScale=(v:number|undefined,anchor:number)=>v===undefined?0.25:clamp(Math.log1p(Math.max(0,v))/Math.log1p(anchor));
export function computeDirectionalToxicity(input:{movement:ActiveBinMovementFeatures;flow:SwapFlowFeatures;bin:BinWindowFeatures}):ToxicityFeatures{
  const directionalDominance=clamp(Math.abs(input.flow.netDirection));
  const velocity=clamp(input.movement.velocityBinsPerMinute/4);
  const directionality=clamp(input.movement.directionality);
  const meanBinsCrossed=clamp(input.flow.meanBinsCrossed/8);
  const largeMovePressure=clamp(.55*velocity+.45*meanBinsCrossed);
  const liquidityFragility=clamp((1-input.bin.nonEmptyRatio)*.5+input.bin.maxConsecutiveEmpty/Math.max(1,input.bin.binCount)*.5);
  const adverseInventoryPressure=clamp(.35*directionalDominance+.30*directionality+.20*largeMovePressure+.15*liquidityFragility);
  return{directionalDominance,velocity,directionality,meanBinsCrossed,largeMovePressure,adverseInventoryPressure,toxicityProbability:clamp(.42*adverseInventoryPressure+.28*directionalDominance+.18*largeMovePressure+.12*(1-input.flow.twoWayRatio))};
}
export function estimateOpportunityHalfLife(input:{fee:SustainabilityFeatures;movement:ActiveBinMovementFeatures;flow:SwapFlowFeatures}):number|null{
  if(input.fee.buckets<3)return null;
  const decay=clamp(Math.max(0,-input.fee.feeTrendNormalized)/2);
  const instability=clamp(input.fee.feeCoefficientOfVariation===null?.5:input.fee.feeCoefficientOfVariation/3);
  const movement=clamp(input.movement.velocityBinsPerMinute/4);
  const oneWay=1-clamp(input.flow.twoWayRatio);
  const hazard=.08+.34*decay+.24*instability+.20*movement+.14*oneWay;
  return Math.round(Math.max(5,Math.min(360,Math.log(2)/hazard*60))*10)/10;
}
export function deepScreenPool(input:DeepScreenInput,policy:DeepScreenPolicy=DEFAULT_DEEP_SCREEN_POLICY):DeepScreenResult{
  const bin=computeBinWindowFeatures(input.bins,input.activeBinId);
  const movement=computeActiveBinMovement(input.activeBinHistory);
  const flow=computeSwapFlowFeatures(input.swaps);
  const feeSustainability=computeSustainability(input.historicalFees);
  const toxicity=computeDirectionalToxicity({movement,flow,bin});
  const reasons:string[]=[];
  const availability:DeepScreenResult['evidenceAvailability']={
    protocol:input.protocolCompatible?'AVAILABLE':'CONTRADICTORY',
    bins:input.bins.length?'AVAILABLE':'UNAVAILABLE',
    movement:input.activeBinHistory.length>=2?'AVAILABLE':'UNAVAILABLE',
    swaps:input.swaps.length?'AVAILABLE':'UNAVAILABLE',
    historicalFees:input.historicalFees.length?'AVAILABLE':'UNAVAILABLE',
    reference:input.referenceDivergenceBps===undefined?'UNAVAILABLE':'AVAILABLE',
    discoveryFreshness:input.dataFresh?'AVAILABLE':'STALE'
  };
  for(const m of input.missingEvidence??[])availability[m]='UNAVAILABLE';
  const protocol=input.protocolCompatible?1:0;
  const liquidity=clamp(.30*bin.nonEmptyRatio+.20*(1-clamp(bin.maxConsecutiveEmpty/Math.max(1,bin.binCount)))+.20*(1-clamp(Math.abs(bin.liquiditySkew)))+.15*(1-clamp(bin.activeBinLiquidityShare/.75))+.15*logScale(finite(input.pool.tvl),250_000));
  const feeDensity=input.discoveryMetrics
    ?clamp(.45*feeEfficiencyScorePct(input.discoveryMetrics.feeTotalTvlRatio1hPct)+.30*feeEfficiencyScorePct(input.discoveryMetrics.feeTotalTvlRatio24hPct)+.25*feeSustainability.persistenceScore)
    :clamp(.45*clamp((finite(input.pool.fee_tvl_ratio?.['1h'])??0)/.006)+.30*clamp((finite(input.pool.fee_tvl_ratio?.['24h'])??0)/.025)+.25*feeSustainability.persistenceScore);
  const flowQuality=clamp(.50*flow.twoWayRatio+.25*(1-clamp(Math.abs(flow.netDirection)))+.25*(1-clamp(flow.meanBinsCrossed/10)));
  const tokenQuality=clamp(((input.pool.token_x?.freeze_authority_disabled===false||input.pool.token_y?.freeze_authority_disabled===false)?.25:1)*((input.pool.is_blacklisted===true)?0:1));
  const fragility=clamp(input.marketFragility??.35);
  const reliability=clamp((input.dataFresh?1:.2)*(.35+.65*protocol)*(input.bins.length?1:.5));
  const poolQuality=score100(.22*liquidity+.20*feeSustainability.persistenceScore+.14*feeDensity+.12*flowQuality+.12*tokenQuality+.10*(1-fragility)+.10*reliability);
  const currentOpportunity=score100(.25*feeDensity+.20*feeSustainability.persistenceScore+.18*(1-toxicity.toxicityProbability)+.15*flowQuality+.12*liquidity+.10*(1-clamp(movement.velocityBinsPerMinute/5)));
  if(!input.protocolCompatible)reasons.push('DEEP_PROTOCOL_INCOMPATIBLE');
  if(!input.dataFresh)reasons.push('DEEP_DATA_STALE');
  if(input.referenceDivergenceBps!==undefined&&input.referenceDivergenceBps>policy.maxReferenceDivergenceBps)reasons.push('DEEP_REFERENCE_DIVERGENCE');
  if(input.recentLiquidityChangePct!==undefined&&input.recentLiquidityChangePct<-policy.maxLiquidityDropPct)reasons.push('DEEP_LIQUIDITY_COLLAPSE');
  if(feeSustainability.persistenceScore<policy.minFeePersistence)reasons.push('DEEP_FEE_PERSISTENCE_WEAK');
  if(toxicity.toxicityProbability>policy.maxToxicity)reasons.push('DEEP_DIRECTIONAL_TOXICITY_HIGH');
  if(poolQuality<policy.minPoolQuality)reasons.push('DEEP_POOL_QUALITY_LOW');
  if(currentOpportunity<policy.minOpportunity)reasons.push('DEEP_CURRENT_OPPORTUNITY_LOW');
  let eligibility:DeepEligibility='QUALIFIED';
  if(!input.protocolCompatible||reasons.includes('DEEP_REFERENCE_DIVERGENCE')||reasons.includes('DEEP_LIQUIDITY_COLLAPSE'))eligibility='BLOCK';
  else if(!input.dataFresh||input.bins.length===0)eligibility='QUARANTINED';
  else if(reasons.length)eligibility='WATCHLIST';
  return{policyId:policy.id,poolAddress:input.pool.address,observedAt:input.observedAt,eligibility,poolQualityScore:poolQuality,currentOpportunityScore:currentOpportunity,executableLiquidityScore:score100(liquidity),feeQualityScore:score100(feeDensity),flowQualityScore:score100(flowQuality),toxicity,feeSustainability,bin,movement,flow,opportunityHalfLifeMinutes:estimateOpportunityHalfLife({fee:feeSustainability,movement,flow}),reasonCodes:reasons.sort(),evidenceAvailability:availability,evidence:{marketFragility:fragility,referenceDivergenceBps:input.referenceDivergenceBps??null,recentLiquidityChangePct:input.recentLiquidityChangePct??null,tvl:input.pool.tvl??null,currentPrice:input.pool.current_price??null,feeTvl1h:input.discoveryMetrics?.feeTotalTvlRatio1hPct??input.pool.fee_tvl_ratio?.['1h']??null,feeTvl24h:input.discoveryMetrics?.feeTotalTvlRatio24hPct??input.pool.fee_tvl_ratio?.['24h']??null,feeRatioUnit:input.discoveryMetrics?.ratioUnit??'SOURCE_UNSPECIFIED'}};
}
