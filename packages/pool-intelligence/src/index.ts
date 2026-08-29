import type { Freshness } from '../../domain/src/index.js';
import type { BinWindowFeatures, ActiveBinMovementFeatures, SwapFlowFeatures, FeeQualityFeatures, Phase1PoolFeatures } from '../../features/src/index.js';
import type { DataApiPool } from '../../data-api/src/index.js';

export type PoolEligibility='ELIGIBLE'|'WATCH'|'BLOCK';
export type PoolArchetype='MATURE_DEEP'|'MATURE_VOLATILE'|'NEW_HIGH_ACTIVITY'|'BURSTY_SPECULATIVE'|'THIN_TRENDING'|'LIQUIDITY_DECAY'|'REWARD_DRIVEN'|'LIMIT_ORDER_HEAVY'|'UNKNOWN';

export interface TokenRiskInput {
  /** Canonical mint identity. Required for exact-address risk exceptions. */
  mintAddress?:string;
  freezeAuthorityDisabled?:boolean;
  isVerified?:boolean;
  holders?:number;
  isBlacklisted?:boolean;
  ageHours?:number;
  concentrationPct?:number;
  externalRiskMissing?:boolean;
}

export interface TrustedFreezeAuthorityException {
  /** Exact pool address. Exceptions never apply by symbol or token name. */
  pool:string;
  /** Exact token mint allowed to retain freeze authority in this exact pool. */
  tokenMint:string;
  reason:string;
}

export interface PoolIntelligencePolicy {
  id:string;
  /** Research baseline only. These values are not live-trading permissions. */
  blockBlacklisted:boolean;
  requireFreezeAuthorityDisabled:boolean;
  trustedFreezeAuthorityExceptions?:readonly TrustedFreezeAuthorityException[];
  maxReferenceDivergenceBps:number;
  maxDataAgeSeconds:number;
  liquidityCollapsePct:number;
  minHoldersForEligible:number;
  minTwoWayFlowForEligible:number;
  maxDirectionalMovementForEligible:number;
  maxMeanBinsCrossedForEligible:number;
  maxFeeBurstRatioForEligible:number;
}

export const RESEARCH_POOL_POLICY_V1:PoolIntelligencePolicy={
  id:'research-pool-policy-v1',
  blockBlacklisted:true,
  requireFreezeAuthorityDisabled:true,
  maxReferenceDivergenceBps:250,
  maxDataAgeSeconds:120,
  liquidityCollapsePct:-35,
  minHoldersForEligible:250,
  minTwoWayFlowForEligible:0.35,
  maxDirectionalMovementForEligible:0.85,
  maxMeanBinsCrossedForEligible:25,
  maxFeeBurstRatioForEligible:8,
};

/**
 * Narrow Phase 6 canary policy. The exception is intentionally bound to one
 * exact pool+mint tuple; symbols and names are never accepted as identity.
 * The token risk score still reflects freeze-authority centralization risk.
 */
export const PHASE6_CANARY_POOL_POLICY_V1:PoolIntelligencePolicy={
  ...RESEARCH_POOL_POLICY_V1,
  id:'phase6-canary-pool-policy-v1',
  trustedFreezeAuthorityExceptions:[
    {
      pool:'5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',
      tokenMint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      reason:'CANONICAL_USDC_EXACT_POOL_ALLOWLIST',
    },
  ],
};

export interface PoolIntelligenceInput {
  pool:string;
  protocolCompatible:boolean;
  dataFreshness:Freshness;
  observedAt:string;
  dataAgeSeconds?:number;
  tokenX?:TokenRiskInput;
  tokenY?:TokenRiskInput;
  referenceDivergenceBps?:number;
  recentLiquidityChangePct?:number;
  tvl?:number;
  hasFarm?:boolean;
  functionType?:'LIQUIDITY_MINING'|'LIMIT_ORDER'|'UNKNOWN';
  bin?:BinWindowFeatures;
  movement?:ActiveBinMovementFeatures;
  flow?:SwapFlowFeatures;
  fee?:FeeQualityFeatures;
}

export interface PoolAssessment {
  pool:string;
  policyId:string;
  eligibility:PoolEligibility;
  poolQualityScore:number;
  economicQualityScore:number;
  flowQualityScore:number;
  liquidityQualityScore:number;
  tokenRiskScore:number;
  toxicityProbability:number;
  archetype:PoolArchetype;
  dataQuality:Freshness;
  blockers:string[];
  warnings:string[];
  evidence:Record<string,unknown>;
  assessedAt:string;
}

const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const score100=(x:number)=>Math.round(clamp(x)*100);
function holderScore(v:number|undefined,min:number):number { if(v===undefined)return .35; return clamp(Math.log10(Math.max(v,1))/Math.log10(Math.max(min*8,10))); }
function tokenScore(t:TokenRiskInput|undefined,p:PoolIntelligencePolicy):number { if(!t)return .25; let s=0.5; if(t.isBlacklisted)s=0; if(t.freezeAuthorityDisabled===true)s+=.15; else if(t.freezeAuthorityDisabled===false)s-=.35; if(t.isVerified===true)s+=.1; if(t.externalRiskMissing)s-=.05; s+=.25*holderScore(t.holders,p.minHoldersForEligible); if(typeof t.concentrationPct==='number')s-=clamp((t.concentrationPct-40)/60)*.2; return clamp(s); }
function freezeAuthorityException(input:PoolIntelligenceInput,token:TokenRiskInput,policy:PoolIntelligencePolicy):TrustedFreezeAuthorityException|undefined {
  if(token.freezeAuthorityDisabled!==false||!token.mintAddress)return undefined;
  return policy.trustedFreezeAuthorityExceptions?.find((x)=>x.pool===input.pool&&x.tokenMint===token.mintAddress);
}
function feeWindow(f:FeeQualityFeatures|undefined,k:'5m'|'30m'|'1h'|'2h'|'4h'|'12h'|'24h'):number|undefined { const v=f?.feeTvlRatio?.[k]; return typeof v==='number'&&Number.isFinite(v)?v:undefined; }

export function estimateToxicity(input:PoolIntelligenceInput):number {
  const directional=input.flow?Math.abs(input.flow.netDirection):0.5;
  const movement=input.movement?.directionality??0.5;
  const cross=clamp((input.flow?.meanBinsCrossed??10)/50);
  const lowTwoWay=1-(input.flow?.twoWayRatio??0.5);
  const gaps=clamp((input.bin?.maxConsecutiveEmpty??0)/10);
  const collapse=typeof input.recentLiquidityChangePct==='number'?clamp((-input.recentLiquidityChangePct)/50):0;
  return clamp(.24*directional+.22*movement+.18*cross+.18*lowTwoWay+.08*gaps+.10*collapse);
}

function archetype(input:PoolIntelligenceInput,tox:number):PoolArchetype {
  if(input.functionType==='LIMIT_ORDER')return'LIMIT_ORDER_HEAVY';
  if(input.hasFarm&&tox<.55)return'REWARD_DRIVEN';
  const burst=input.fee?.feeBurstRatio1hTo24h??1;
  const vol=input.movement?.velocityBinsPerMinute??0;
  const local=input.bin?.nonEmptyRatio??0;
  if(typeof input.recentLiquidityChangePct==='number'&&input.recentLiquidityChangePct<-20)return'LIQUIDITY_DECAY';
  if(burst>5&&tox>.5)return'BURSTY_SPECULATIVE';
  if(vol>10&&local<.5)return'THIN_TRENDING';
  if((input.tvl??0)>100000&&local>.7&&tox<.45)return'MATURE_DEEP';
  if((input.tvl??0)>100000&&tox>=.45)return'MATURE_VOLATILE';
  if(burst>2&&(input.tvl??0)<100000)return'NEW_HIGH_ACTIVITY';
  return'UNKNOWN';
}

export function assessPool(input:PoolIntelligenceInput,policy:PoolIntelligencePolicy=RESEARCH_POOL_POLICY_V1):PoolAssessment {
  const blockers:string[]=[],warnings:string[]=[];
  if(!input.protocolCompatible)blockers.push('PROTOCOL_INCOMPATIBLE');
  if(input.dataFreshness==='BAD')blockers.push('DATA_QUALITY_BAD');
  if(typeof input.dataAgeSeconds==='number'&&input.dataAgeSeconds>policy.maxDataAgeSeconds)blockers.push('CRITICAL_DATA_STALE');
  const tokens=[input.tokenX,input.tokenY].filter(Boolean) as TokenRiskInput[];
  if(policy.blockBlacklisted&&tokens.some((t)=>t.isBlacklisted))blockers.push('TOKEN_OR_POOL_BLACKLISTED');
  const freezeEnabled=tokens.filter((t)=>t.freezeAuthorityDisabled===false);
  const freezeExceptions=freezeEnabled.map((t)=>freezeAuthorityException(input,t,policy)).filter(Boolean) as TrustedFreezeAuthorityException[];
  const unexceptedFreezeEnabled=freezeEnabled.filter((t)=>!freezeAuthorityException(input,t,policy));
  if(policy.requireFreezeAuthorityDisabled&&unexceptedFreezeEnabled.length)blockers.push('FREEZE_AUTHORITY_ENABLED');
  if(freezeExceptions.length)warnings.push('TRUSTED_FREEZE_AUTHORITY_EXCEPTION');
  if(typeof input.referenceDivergenceBps==='number'&&Math.abs(input.referenceDivergenceBps)>policy.maxReferenceDivergenceBps)blockers.push('REFERENCE_DIVERGENCE_EXCESSIVE');
  if(typeof input.recentLiquidityChangePct==='number'&&input.recentLiquidityChangePct<=policy.liquidityCollapsePct)blockers.push('LIQUIDITY_COLLAPSE');
  if(tokens.some((t)=>typeof t.holders==='number'&&t.holders<policy.minHoldersForEligible))warnings.push('LOW_HOLDER_COUNT');
  if(tokens.some((t)=>t.externalRiskMissing))warnings.push('EXTERNAL_RISK_SIGNAL_MISSING');
  const tox=estimateToxicity(input);
  const flowQuality=clamp(1-tox);
  const liquidityQuality=clamp(.40*(input.bin?.nonEmptyRatio??.4)+.25*(1-clamp((input.bin?.maxConsecutiveEmpty??2)/10))+.20*(1-clamp(Math.abs(input.bin?.liquiditySkew??0)))+.15*(1-clamp(input.bin?.activeBinLiquidityShare??0)));
  const f1=feeWindow(input.fee,'1h')??0,f24=feeWindow(input.fee,'24h')??0;
  const persistence=f24>0?clamp((f1*24)/(f24*2),0,1):.25;
  const burst=input.fee?.feeBurstRatio1hTo24h??1;
  const burstPenalty=burst>policy.maxFeeBurstRatioForEligible?clamp((burst-policy.maxFeeBurstRatioForEligible)/policy.maxFeeBurstRatioForEligible):0;
  const economic=clamp(.45*persistence+.30*clamp(Math.log10(1+Math.max(f1,0)*1000)/2)+.25*(1-burstPenalty));
  const tokenRisk=(tokenScore(input.tokenX,policy)+tokenScore(input.tokenY,policy))/2;
  const overall=.28*economic+.26*flowQuality+.26*liquidityQuality+.20*tokenRisk;
  const softEligible=(input.flow?.twoWayRatio??0)>=policy.minTwoWayFlowForEligible&&(input.movement?.directionality??1)<=policy.maxDirectionalMovementForEligible&&(input.flow?.meanBinsCrossed??Infinity)<=policy.maxMeanBinsCrossedForEligible&&burst<=policy.maxFeeBurstRatioForEligible;
  const eligibility:PoolEligibility=blockers.length?'BLOCK':softEligible&&overall>=.55?'ELIGIBLE':'WATCH';
  if(!softEligible&&!blockers.length)warnings.push('RESEARCH_QUALITY_GATE_NOT_MET');
  return {pool:input.pool,policyId:policy.id,eligibility,poolQualityScore:score100(overall),economicQualityScore:score100(economic),flowQualityScore:score100(flowQuality),liquidityQualityScore:score100(liquidityQuality),tokenRiskScore:score100(tokenRisk),toxicityProbability:tox,archetype:archetype(input,tox),dataQuality:input.dataFreshness,blockers,warnings,evidence:{fee1hTvl:f1,fee24hTvl:f24,feeBurstRatio:burst,twoWayRatio:input.flow?.twoWayRatio,directionality:input.movement?.directionality,meanBinsCrossed:input.flow?.meanBinsCrossed,nonEmptyRatio:input.bin?.nonEmptyRatio,maxConsecutiveEmpty:input.bin?.maxConsecutiveEmpty,referenceDivergenceBps:input.referenceDivergenceBps,recentLiquidityChangePct:input.recentLiquidityChangePct,freezeAuthorityExceptions:freezeExceptions.map((x)=>({pool:x.pool,tokenMint:x.tokenMint,reason:x.reason}))},assessedAt:new Date().toISOString()};
}

export interface EconomicsSample { netValue:number; feeValue:number; inventoryPnl:number; hodlRelativePnl:number; activeTimeRatio:number; }
export interface EconomicsSummary { samples:number;meanNetValue:number;medianNetValue:number;positiveRate:number;p10NetValue:number;meanFeeValue:number;meanInventoryPnl:number;meanHodlRelativePnl:number;meanActiveTimeRatio:number;feeToAdverseInventoryRatio:number|null;uncertaintyStdDev:number; }
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
function quantile(a:number[],q:number):number{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);const p=(s.length-1)*q,l=Math.floor(p),h=Math.ceil(p);const lv=s[l]??0,hv=s[h]??lv;return lv+(hv-lv)*(p-l);}
export function summarizeEconomics(samples:EconomicsSample[]):EconomicsSummary{const nets=samples.map((s)=>s.netValue),m=mean(nets),adverse=-samples.filter((s)=>s.inventoryPnl<0).reduce((x,s)=>x+s.inventoryPnl,0);const fees=samples.reduce((x,s)=>x+s.feeValue,0);return{samples:samples.length,meanNetValue:m,medianNetValue:quantile(nets,.5),positiveRate:samples.length?samples.filter((s)=>s.netValue>0).length/samples.length:0,p10NetValue:quantile(nets,.1),meanFeeValue:mean(samples.map((s)=>s.feeValue)),meanInventoryPnl:mean(samples.map((s)=>s.inventoryPnl)),meanHodlRelativePnl:mean(samples.map((s)=>s.hodlRelativePnl)),meanActiveTimeRatio:mean(samples.map((s)=>s.activeTimeRatio)),feeToAdverseInventoryRatio:adverse>0?fees/adverse:null,uncertaintyStdDev:samples.length?Math.sqrt(mean(nets.map((x)=>(x-m)**2))):0};}

export function poolInputFromDataApi(pool:DataApiPool,features:Phase1PoolFeatures,extra:{protocolCompatible:boolean;dataFreshness:Freshness;observedAt:string;dataAgeSeconds?:number;referenceDivergenceBps?:number;recentLiquidityChangePct?:number;functionType?:'LIQUIDITY_MINING'|'LIMIT_ORDER'|'UNKNOWN'}):PoolIntelligenceInput{
  const token=(t:DataApiPool['token_x']):TokenRiskInput|undefined=>t?{mintAddress:t.address,...(typeof t.freeze_authority_disabled==='boolean'?{freezeAuthorityDisabled:t.freeze_authority_disabled}:{}),...(typeof t.is_verified==='boolean'?{isVerified:t.is_verified}:{}),...(typeof t.holders==='number'?{holders:t.holders}:{}),isBlacklisted:Boolean(pool.is_blacklisted)}:undefined;
  const tx=token(pool.token_x),ty=token(pool.token_y);
  return{pool:pool.address,protocolCompatible:extra.protocolCompatible,dataFreshness:extra.dataFreshness,observedAt:extra.observedAt,...(extra.dataAgeSeconds!==undefined?{dataAgeSeconds:extra.dataAgeSeconds}:{}),...(tx?{tokenX:tx}:{}),...(ty?{tokenY:ty}:{}),...(extra.referenceDivergenceBps!==undefined?{referenceDivergenceBps:extra.referenceDivergenceBps}:{}),...(extra.recentLiquidityChangePct!==undefined?{recentLiquidityChangePct:extra.recentLiquidityChangePct}:{}),...(typeof pool.tvl==='number'?{tvl:pool.tvl}:{}),...(extra.functionType?{functionType:extra.functionType}:{}),...(features.bin?{bin:features.bin}:{}),...(features.movement?{movement:features.movement}:{}),...(features.flow?{flow:features.flow}:{}),...(features.fee?{fee:features.fee}:{}),};
}

export interface HistoricalFeeBucket { timestamp:number; fees:number; protocol_fees:number; volume:number; }
export interface SustainabilityFeatures {
  buckets:number;
  activeFeeBucketRatio:number;
  feeMean:number;
  feeStdDev:number;
  feeCoefficientOfVariation:number|null;
  volumeMean:number;
  feeTrendNormalized:number;
  protocolFeeShare:number|null;
  persistenceScore:number;
}
export function computeSustainability(buckets:HistoricalFeeBucket[]):SustainabilityFeatures{
  const s=[...buckets].sort((a,b)=>a.timestamp-b.timestamp);
  if(!s.length)return{buckets:0,activeFeeBucketRatio:0,feeMean:0,feeStdDev:0,feeCoefficientOfVariation:null,volumeMean:0,feeTrendNormalized:0,protocolFeeShare:null,persistenceScore:0};
  const fees=s.map((x)=>Math.max(0,x.fees)),vol=s.map((x)=>Math.max(0,x.volume));
  const fm=fees.reduce((a,b)=>a+b,0)/fees.length,vm=vol.reduce((a,b)=>a+b,0)/vol.length;
  const sd=Math.sqrt(fees.reduce((a,b)=>a+(b-fm)**2,0)/fees.length);
  const cv=fm>0?sd/fm:null;
  const active=fees.filter((x)=>x>0).length/fees.length;
  const first=fees.slice(0,Math.max(1,Math.floor(fees.length/3)));const last=fees.slice(-Math.max(1,Math.floor(fees.length/3)));
  const firstMean=first.reduce((a,b)=>a+b,0)/first.length,lastMean=last.reduce((a,b)=>a+b,0)/last.length;
  const trend=fm>0?(lastMean-firstMean)/fm:0;
  const pf=s.reduce((a,b)=>a+Math.max(0,b.protocol_fees),0),tf=fees.reduce((a,b)=>a+b,0);
  const protocolFeeShare=tf>0?pf/tf:null;
  const stability=cv===null?0:1-clamp(cv/3);
  const trendPenalty=clamp(Math.abs(trend)/3);
  const persistence=clamp(.55*active+.35*stability+.10*(1-trendPenalty));
  return{buckets:s.length,activeFeeBucketRatio:active,feeMean:fm,feeStdDev:sd,feeCoefficientOfVariation:cv,volumeMean:vm,feeTrendNormalized:trend,protocolFeeShare,persistenceScore:persistence};
}
