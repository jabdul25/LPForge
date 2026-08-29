import type {DataApiPool,MeteoraDiscoveryPool,MeteoraDiscoveryTimeframe} from '../../data-api/src/index.js';

export type DiscoveryMetricWindow='30m'|'1h'|'24h';
export type DiscoveryMetricSource='METEORA_STANDARD_POOL_API'|'METEORA_DISCOVERY_API';

/** Every ratio is percentage points: 0.5 means 0.5%, never 0.005. */
export interface CanonicalDiscoveryMetrics {
  ratioUnit:'PERCENTAGE_POINTS'; source:DiscoveryMetricSource; ingestedAt:string; sourceObservedAt?:string;
  totalTvlUsd?:number; activeTvlUsd?:number;
  fees30mUsd?:number; fees1hUsd?:number; fees24hUsd?:number;
  volume30mUsd?:number; volume1hUsd?:number; volume24hUsd?:number;
  swapCount30m?:number; swapCount1h?:number; swapCount24h?:number;
  feeTotalTvlRatio30mPct?:number; feeTotalTvlRatio1hPct?:number; feeTotalTvlRatio24hPct?:number;
  feeActiveTvlRatio30mPct?:number; feeActiveTvlRatio1hPct?:number; feeActiveTvlRatio24hPct?:number;
}
const finite=(value:unknown):number|undefined=>{const n=Number(value);return Number.isFinite(n)?n:undefined;};
const nonNegative=(value:unknown):number|undefined=>{const n=finite(value);return n!==undefined&&n>=0?n:undefined;};
const timestamp=(value:unknown):string|undefined=>{if(typeof value==='string'&&Number.isFinite(Date.parse(value)))return new Date(Date.parse(value)).toISOString();if(typeof value==='number'&&Number.isFinite(value))return new Date(value>10_000_000_000?value:value*1000).toISOString();return undefined;};
export function ratioPct(numerator:unknown,denominator:unknown):number|undefined{const n=nonNegative(numerator),d=finite(denominator);return n!==undefined&&d!==undefined&&d>0?n/d*100:undefined;}
/** Standard DLMM API supplies ratio values in percentage points when present. */
export function standardPoolDiscoveryMetrics(pool:DataApiPool,ingestedAt:string):CanonicalDiscoveryMetrics{
  const totalTvlUsd=nonNegative(pool.tvl),ratio=(window:DiscoveryMetricWindow)=>nonNegative(pool.fee_tvl_ratio?.[window])??ratioPct(pool.fees?.[window],totalTvlUsd);
  const fees30mUsd=nonNegative(pool.fees?.['30m']),fees1hUsd=nonNegative(pool.fees?.['1h']),fees24hUsd=nonNegative(pool.fees?.['24h']),volume30mUsd=nonNegative(pool.volume?.['30m']),volume1hUsd=nonNegative(pool.volume?.['1h']),volume24hUsd=nonNegative(pool.volume?.['24h']),feeTotalTvlRatio30mPct=ratio('30m'),feeTotalTvlRatio1hPct=ratio('1h'),feeTotalTvlRatio24hPct=ratio('24h');
  return{ratioUnit:'PERCENTAGE_POINTS',source:'METEORA_STANDARD_POOL_API',ingestedAt,...(totalTvlUsd!==undefined?{totalTvlUsd}:{}),...(fees30mUsd!==undefined?{fees30mUsd}:{}),...(fees1hUsd!==undefined?{fees1hUsd}:{}),...(fees24hUsd!==undefined?{fees24hUsd}:{}),...(volume30mUsd!==undefined?{volume30mUsd}:{}),...(volume1hUsd!==undefined?{volume1hUsd}:{}),...(volume24hUsd!==undefined?{volume24hUsd}:{}),...(feeTotalTvlRatio30mPct!==undefined?{feeTotalTvlRatio30mPct}:{}),...(feeTotalTvlRatio1hPct!==undefined?{feeTotalTvlRatio1hPct}:{}),...(feeTotalTvlRatio24hPct!==undefined?{feeTotalTvlRatio24hPct}:{})};
}
export function discoveryPoolMetricPatch(pool:MeteoraDiscoveryPool,timeframe:MeteoraDiscoveryTimeframe,ingestedAt:string):Partial<CanonicalDiscoveryMetrics>{
  const sourceObservedAt=timestamp(pool.updated_at)??timestamp(pool.timestamp),fee=nonNegative(pool.fee??pool.fees),volume=nonNegative(pool.volume),swaps=nonNegative(pool.swap_count),totalTvlUsd=nonNegative(pool.tvl),activeTvlUsd=nonNegative(pool.active_tvl),totalRatio=nonNegative(pool.fee_tvl_ratio)??ratioPct(fee,totalTvlUsd),activeRatio=nonNegative(pool.fee_active_tvl_ratio),common={ratioUnit:'PERCENTAGE_POINTS' as const,source:'METEORA_DISCOVERY_API' as const,ingestedAt,...(sourceObservedAt?{sourceObservedAt}:{}),...(totalTvlUsd!==undefined?{totalTvlUsd}:{}),...(activeTvlUsd!==undefined?{activeTvlUsd}:{})};
  if(timeframe==='30m')return{...common,...(fee!==undefined?{fees30mUsd:fee}:{}),...(volume!==undefined?{volume30mUsd:volume}:{}),...(swaps!==undefined?{swapCount30m:swaps}:{}),...(totalRatio!==undefined?{feeTotalTvlRatio30mPct:totalRatio}:{}),...(activeRatio!==undefined?{feeActiveTvlRatio30mPct:activeRatio}:{})};
  if(timeframe==='1h')return{...common,...(fee!==undefined?{fees1hUsd:fee}:{}),...(volume!==undefined?{volume1hUsd:volume}:{}),...(swaps!==undefined?{swapCount1h:swaps}:{}),...(totalRatio!==undefined?{feeTotalTvlRatio1hPct:totalRatio}:{}),...(activeRatio!==undefined?{feeActiveTvlRatio1hPct:activeRatio}:{})};
  return{...common,...(fee!==undefined?{fees24hUsd:fee}:{}),...(volume!==undefined?{volume24hUsd:volume}:{}),...(swaps!==undefined?{swapCount24h:swaps}:{}),...(totalRatio!==undefined?{feeTotalTvlRatio24hPct:totalRatio}:{}),...(activeRatio!==undefined?{feeActiveTvlRatio24hPct:activeRatio}:{})};
}
export function mergeDiscoveryMetrics(base:CanonicalDiscoveryMetrics,patches:ReadonlyArray<Partial<CanonicalDiscoveryMetrics>>):CanonicalDiscoveryMetrics{
  const merged:CanonicalDiscoveryMetrics={...base};
  for(const patch of patches){
    for(const [key,value] of Object.entries(patch))if(value!==undefined)Object.assign(merged,{[key]:value});
  }
  return {...merged,ratioUnit:'PERCENTAGE_POINTS'};
}
const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));
/** Bounded monotone log curve that remains discriminative from 0.01% to 20%. */
export function feeEfficiencyScorePct(value:number|undefined):number{if(value===undefined||!Number.isFinite(value)||value<=0)return 0;return clamp(Math.log1p(value/.05)/Math.log1p(20/.05));}
const logScore=(value:number|undefined,anchor:number)=>value===undefined||value<=0?0:clamp(Math.log1p(value)/Math.log1p(anchor));
/** Scheduling-only priority; it is not a safety approval or an LP EV estimate. */
export function discoveryEconomicPriority(metrics:CanonicalDiscoveryMetrics):number{
  const active=.45*feeEfficiencyScorePct(metrics.feeActiveTvlRatio30mPct)+.35*feeEfficiencyScorePct(metrics.feeActiveTvlRatio1hPct)+.20*feeEfficiencyScorePct(metrics.feeActiveTvlRatio24hPct),total=.35*feeEfficiencyScorePct(metrics.feeTotalTvlRatio30mPct)+.40*feeEfficiencyScorePct(metrics.feeTotalTvlRatio1hPct)+.25*feeEfficiencyScorePct(metrics.feeTotalTvlRatio24hPct),feeStrength=Math.max(active,total*.75),fees=.45*logScore(metrics.fees30mUsd,500)+.40*logScore(metrics.fees1hUsd,1000)+.15*logScore(metrics.fees24hUsd,20_000),activeLiquidity=logScore(metrics.activeTvlUsd,100_000),liquidityConfidence=metrics.activeTvlUsd===undefined?.25:clamp(metrics.activeTvlUsd/(metrics.activeTvlUsd+5_000)),liquidityAdjustedFeeStrength=feeStrength*(.25+.75*liquidityConfidence),volume=.45*logScore(metrics.volume30mUsd,20_000)+.40*logScore(metrics.volume1hUsd,50_000)+.15*logScore(metrics.volume24hUsd,500_000),swaps=.45*logScore(metrics.swapCount30m,100)+.40*logScore(metrics.swapCount1h,200)+.15*logScore(metrics.swapCount24h,2000),persistence=metrics.feeActiveTvlRatio30mPct!==undefined&&metrics.feeActiveTvlRatio1hPct!==undefined&&metrics.feeActiveTvlRatio24hPct!==undefined?clamp(Math.min(metrics.feeActiveTvlRatio30mPct,metrics.feeActiveTvlRatio1hPct,metrics.feeActiveTvlRatio24hPct)/Math.max(metrics.feeActiveTvlRatio30mPct,metrics.feeActiveTvlRatio1hPct,metrics.feeActiveTvlRatio24hPct,1e-12)):0;
  return Math.round(clamp(.40*liquidityAdjustedFeeStrength+.19*fees+.14*activeLiquidity+.14*volume+.05*swaps+.08*persistence)*10_000)/100;
}
