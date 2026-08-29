import type { DataApiPool, MeteoraDataApi, MeteoraDiscoveryPool } from '../../data-api/src/index.js';
import { discoveryEconomicPriority, discoveryPoolMetricPatch, feeEfficiencyScorePct, mergeDiscoveryMetrics, standardPoolDiscoveryMetrics, type CanonicalDiscoveryMetrics } from '../../discovery-metrics/src/index.js';

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export type PoolSourceMode = 'MANUAL'|'AUTO'|'HYBRID';
export type DiscoveryDecision = 'PASS'|'WATCH'|'REJECT';
export type DiscoveryState = 'DISCOVERED'|'PREFILTERED'|'OBSERVING'|'QUALIFIED'|'WATCHLIST'|'ACTIVE_CANDIDATE'|'COOLDOWN'|'REJECTED'|'QUARANTINED';
export type DiscoveryTier = 'A'|'B'|'C'|'COOLDOWN'|'REJECTED'|'QUARANTINED';
export type EvidenceAvailability = 'AVAILABLE'|'UNAVAILABLE'|'STALE'|'CONTRADICTORY'|'NOT_APPLICABLE';

export interface DiscoveryPolicy {
  schemaVersion: 1;
  policyId: string;
  sourceMode: PoolSourceMode;
  requireWsolForAuto: boolean;
  allowedBinSteps: number[];
  requireWsolTokenYForAuto: boolean;
  manualPools: string[];
  maxUniverse: number;
  pageSize: number;
  maxDeepScreen: number;
  maxActiveCandidates: number;
  maxWatchlist: number;
  minTvlUsd: number;
  minVolume30mUsd: number;
  minVolume1hUsd: number;
  minVolume24hUsd: number;
  minPoolAgeHours: number;
  minKnownHolders: number;
  activeMinPriority: number;
  qualifiedMinPriority: number;
  serverSideSortBy: string;
  useServerSidePrefilter: boolean;
  staleAfterMs: number;
}

export interface CheapDiscoveryFeatures {
  poolAddress: string;
  name?: string | undefined;
  tokenX?: string | undefined;
  tokenY?: string | undefined;
  pairedTokenMint?: string | undefined;
  pairedTokenSymbol?: string | undefined;
  binStep?: number | undefined;
  wsolPair: boolean;
  blacklisted: boolean;
  poolAgeHours?: number | undefined;
  tvlUsd?: number | undefined;
  volume30mUsd?: number | undefined;
  volume1hUsd?: number | undefined;
  volume24hUsd?: number | undefined;
  fees30mUsd?: number | undefined;
  fees1hUsd?: number | undefined;
  fees24hUsd?: number | undefined;
  /** Canonical source contract: all ratio values are percentage points. */
  metrics: CanonicalDiscoveryMetrics;
  activeTvlUsd?: number | undefined;
  feeTotalTvlRatio30mPct?: number | undefined;
  feeTotalTvlRatio1hPct?: number | undefined;
  feeTotalTvlRatio24hPct?: number | undefined;
  feeActiveTvlRatio30mPct?: number | undefined;
  feeActiveTvlRatio1hPct?: number | undefined;
  feeActiveTvlRatio24hPct?: number | undefined;
  discoveryEconomicPriority: number;
  feeTvl30m?: number | undefined;
  feeTvl1h?: number | undefined;
  feeTvl24h?: number | undefined;
  marketCapUsd?: number | undefined;
  fdvUsd?: number | undefined;
  liquidityToMarketCap?: number | undefined;
  volume24hToMarketCap?: number | undefined;
  fees24hToMarketCap?: number | undefined;
  holders?: number | undefined;
  marketCapCohort: 'MICRO'|'SMALL'|'MID'|'LARGE'|'UNKNOWN';
  evidence: Record<string,EvidenceAvailability>;
}

export interface CheapScreenResult {
  pool: DataApiPool;
  source: 'AUTO'|'MANUAL'|'BOTH';
  features: CheapDiscoveryFeatures;
  decision: DiscoveryDecision;
  priorityScore: number;
  /** Scheduling-only economics; never an execution or trade approval. */
  economicPriority: number;
  hardReasons: string[];
  warnings: string[];
  selectionReasons: string[];
}

export interface DiscoveryUniverseResult {
  observedAt: string;
  policyId: string;
  enumeratedCount: number;
  deduplicatedCount: number;
  accepted: CheapScreenResult[];
  rejected: CheapScreenResult[];
  deepScreenQueue: RankedDiscoveryPool[];
  rankings: RankedDiscoveryPool[];
}

export interface RankedDiscoveryPool extends CheapScreenResult {
  rank: number;
  universePercentile: number;
  feePercentile?: number | undefined;
  volumePercentile?: number | undefined;
  liquidityPercentile?: number | undefined;
  economicPriorityPercentile?: number | undefined;
  state: DiscoveryState;
  tier: DiscoveryTier;
}

function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('LPFORGE_DISCOVERY_POLICY_OBJECT');return v as Record<string,unknown>}
function finite(v:unknown, fallback:number):number{const n=Number(v);return Number.isFinite(n)?n:fallback}
function positiveInt(v:unknown,fallback:number):number{const n=Math.trunc(finite(v,fallback));return n>0?n:fallback}
function strings(v:unknown):string[]{return Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'&&x.length>0):[]}
function positiveInts(v:unknown):number[]{return [...new Set(Array.isArray(v)?v.map(x=>Math.trunc(Number(x))).filter(x=>Number.isInteger(x)&&x>0):[])].sort((a,b)=>a-b)}
export function parseDiscoveryPolicy(raw:unknown):DiscoveryPolicy{
  const v=obj(raw); if(v.schemaVersion!==1)throw new Error('LPFORGE_DISCOVERY_POLICY_SCHEMA');
  const mode=v.sourceMode; if(mode!=='MANUAL'&&mode!=='AUTO'&&mode!=='HYBRID')throw new Error('LPFORGE_DISCOVERY_POLICY_SOURCE_MODE');
  const policy:DiscoveryPolicy={schemaVersion:1,policyId:String(v.policyId??'pool-discovery-v2.1.1'),sourceMode:mode,requireWsolForAuto:v.requireWsolForAuto!==false,allowedBinSteps:positiveInts(v.allowedBinSteps),requireWsolTokenYForAuto:v.requireWsolTokenYForAuto===true,manualPools:[...new Set(strings(v.manualPools))],maxUniverse:positiveInt(v.maxUniverse,250),pageSize:Math.min(1000,positiveInt(v.pageSize,250)),maxDeepScreen:positiveInt(v.maxDeepScreen,40),maxActiveCandidates:positiveInt(v.maxActiveCandidates,10),maxWatchlist:positiveInt(v.maxWatchlist,30),minTvlUsd:Math.max(0,finite(v.minTvlUsd,25000)),minVolume30mUsd:Math.max(0,finite(v.minVolume30mUsd,2500)),minVolume1hUsd:Math.max(0,finite(v.minVolume1hUsd,7500)),minVolume24hUsd:Math.max(0,finite(v.minVolume24hUsd,50000)),minPoolAgeHours:Math.max(0,finite(v.minPoolAgeHours,3)),minKnownHolders:Math.max(0,positiveInt(v.minKnownHolders,250)),activeMinPriority:Math.max(0,Math.min(100,finite(v.activeMinPriority,62))),qualifiedMinPriority:Math.max(0,Math.min(100,finite(v.qualifiedMinPriority,45))),serverSideSortBy:typeof v.serverSideSortBy==='string'&&v.serverSideSortBy.trim()?v.serverSideSortBy.trim():'volume_24h:desc',useServerSidePrefilter:v.useServerSidePrefilter!==false,staleAfterMs:Math.max(60_000,positiveInt(v.staleAfterMs,900_000))};
  if(policy.maxActiveCandidates>policy.maxDeepScreen)throw new Error('LPFORGE_DISCOVERY_POLICY_ACTIVE_GT_DEEP'); return policy;
}

function n(v:unknown):number|undefined{const x=Number(v);return Number.isFinite(x)?x:undefined}
function ratio(a:number|undefined,b:number|undefined):number|undefined{return a!==undefined&&b!==undefined&&b>0?a/b:undefined}
function cohort(mc:number|undefined):CheapDiscoveryFeatures['marketCapCohort']{if(mc===undefined||mc<=0)return'UNKNOWN';if(mc<1_000_000)return'MICRO';if(mc<10_000_000)return'SMALL';if(mc<100_000_000)return'MID';return'LARGE'}
function evidence(v:unknown):EvidenceAvailability{return n(v)===undefined?'UNAVAILABLE':'AVAILABLE'}
function ageHours(createdAt:unknown, nowMs:number):number|undefined{const raw=n(createdAt);if(raw===undefined)return undefined;const ms=raw>10_000_000_000?raw:raw*1000;const age=(nowMs-ms)/3_600_000;return Number.isFinite(age)?Math.max(0,age):undefined}
function paired(pool:DataApiPool){const x=pool.token_x?.address,y=pool.token_y?.address;if(x===WSOL_MINT)return pool.token_y;if(y===WSOL_MINT)return pool.token_x;return undefined}

export function extractCheapFeatures(pool:DataApiPool, observedAt:string, enrichment:ReadonlyArray<Partial<CanonicalDiscoveryMetrics>>=[]):CheapDiscoveryFeatures{
  const p=paired(pool), mc=n(p?.market_cap),metrics=mergeDiscoveryMetrics(standardPoolDiscoveryMetrics(pool,observedAt),enrichment),tvl=metrics.totalTvlUsd,vol24=metrics.volume24hUsd,fees24=metrics.fees24hUsd,economicPriority=discoveryEconomicPriority(metrics);
  return {poolAddress:pool.address,...(pool.name?{name:pool.name}:{}),...(pool.token_x?.address?{tokenX:pool.token_x.address}:{}),...(pool.token_y?.address?{tokenY:pool.token_y.address}:{}),...(p?.address?{pairedTokenMint:p.address}:{}),...(p?.symbol?{pairedTokenSymbol:p.symbol}:{}),wsolPair:Boolean(p),blacklisted:pool.is_blacklisted===true,...(ageHours(pool.created_at,Date.parse(observedAt))!==undefined?{poolAgeHours:ageHours(pool.created_at,Date.parse(observedAt))}:{}),...(tvl!==undefined?{tvlUsd:tvl}:{}),...(metrics.activeTvlUsd!==undefined?{activeTvlUsd:metrics.activeTvlUsd}:{}),...(metrics.volume30mUsd!==undefined?{volume30mUsd:metrics.volume30mUsd}:{}),...(metrics.volume1hUsd!==undefined?{volume1hUsd:metrics.volume1hUsd}:{}),...(vol24!==undefined?{volume24hUsd:vol24}:{}),...(metrics.fees30mUsd!==undefined?{fees30mUsd:metrics.fees30mUsd}:{}),...(metrics.fees1hUsd!==undefined?{fees1hUsd:metrics.fees1hUsd}:{}),...(fees24!==undefined?{fees24hUsd:fees24}:{}),...(metrics.feeTotalTvlRatio30mPct!==undefined?{feeTvl30m:metrics.feeTotalTvlRatio30mPct,feeTotalTvlRatio30mPct:metrics.feeTotalTvlRatio30mPct}:{}),...(metrics.feeTotalTvlRatio1hPct!==undefined?{feeTvl1h:metrics.feeTotalTvlRatio1hPct,feeTotalTvlRatio1hPct:metrics.feeTotalTvlRatio1hPct}:{}),...(metrics.feeTotalTvlRatio24hPct!==undefined?{feeTvl24h:metrics.feeTotalTvlRatio24hPct,feeTotalTvlRatio24hPct:metrics.feeTotalTvlRatio24hPct}:{}),...(metrics.feeActiveTvlRatio30mPct!==undefined?{feeActiveTvlRatio30mPct:metrics.feeActiveTvlRatio30mPct}:{}),...(metrics.feeActiveTvlRatio1hPct!==undefined?{feeActiveTvlRatio1hPct:metrics.feeActiveTvlRatio1hPct}:{}),...(metrics.feeActiveTvlRatio24hPct!==undefined?{feeActiveTvlRatio24hPct:metrics.feeActiveTvlRatio24hPct}:{}),metrics,discoveryEconomicPriority:economicPriority,...(mc!==undefined?{marketCapUsd:mc}:{}),...(p?.total_supply!==undefined&&p.price!==undefined?{fdvUsd:Number(p.total_supply)*Number(p.price)}:{}),...(ratio(tvl,mc)!==undefined?{liquidityToMarketCap:ratio(tvl,mc)}:{}),...(ratio(vol24,mc)!==undefined?{volume24hToMarketCap:ratio(vol24,mc)}:{}),...(ratio(fees24,mc)!==undefined?{fees24hToMarketCap:ratio(fees24,mc)}:{}),...(n(p?.holders)!==undefined?{holders:n(p?.holders)}:{}),marketCapCohort:cohort(mc),evidence:{marketCap:evidence(mc),holders:evidence(p?.holders),tvl:evidence(tvl),activeTvl:evidence(metrics.activeTvlUsd),volume30m:evidence(metrics.volume30mUsd),volume1h:evidence(metrics.volume1hUsd),volume24h:evidence(vol24),fees30m:evidence(metrics.fees30mUsd),fees1h:evidence(metrics.fees1hUsd),fees24h:evidence(fees24),poolAge:ageHours(pool.created_at,Date.parse(observedAt))===undefined?'UNAVAILABLE':'AVAILABLE'}};
}

function sat(value:number|undefined, target:number):number{if(value===undefined)return 0.25;if(target<=0)return 1;return Math.max(0,Math.min(1,value/target))}
function logSat(value:number|undefined,target:number):number{if(value===undefined||value<=0)return 0.2;return Math.max(0,Math.min(1,Math.log1p(value)/Math.log1p(Math.max(1,target))))}
function feeScore(f:CheapDiscoveryFeatures):number{return .35*feeEfficiencyScorePct(f.feeTotalTvlRatio30mPct)+.40*feeEfficiencyScorePct(f.feeTotalTvlRatio1hPct)+.25*feeEfficiencyScorePct(f.feeTotalTvlRatio24hPct)}
function fragilityPenalty(f:CheapDiscoveryFeatures):number{if(f.marketCapUsd===undefined)return .08;let p=0;if(f.marketCapCohort==='MICRO')p+=.12;else if(f.marketCapCohort==='SMALL')p+=.05;if(f.liquidityToMarketCap!==undefined&&f.liquidityToMarketCap<.01)p+=.12;if(f.holders!==undefined&&f.holders<250)p+=.08;return Math.min(.30,p)}
export function cheapScreen(pool:DataApiPool,source:CheapScreenResult['source'],policy:DiscoveryPolicy,observedAt:string,enrichment:ReadonlyArray<Partial<CanonicalDiscoveryMetrics>>=[]):CheapScreenResult{
  const f=extractCheapFeatures(pool,observedAt,enrichment), hard:string[]=[],warn:string[]=[],sel:string[]=[];
  if(!pool.address)hard.push('DISCOVERY_POOL_ADDRESS_MISSING');
  if(f.blacklisted)hard.push('DISCOVERY_BLACKLISTED');
  if(source!=='MANUAL'&&policy.requireWsolForAuto&&!f.wsolPair)hard.push('DISCOVERY_AUTO_REQUIRES_WSOL');
  if(policy.requireWsolTokenYForAuto&&f.tokenY!==WSOL_MINT)hard.push('DISCOVERY_REQUIRES_WSOL_TOKEN_Y');
  const binStep=n(pool.pool_config?.bin_step);
  if(policy.allowedBinSteps.length&&(!binStep||!policy.allowedBinSteps.includes(binStep)))hard.push('DISCOVERY_BIN_STEP_NOT_ALLOWED');
  if((f.tvlUsd??0)<policy.minTvlUsd)(source==='MANUAL'?warn:hard).push('DISCOVERY_TVL_BELOW_MINIMUM');
  if((f.volume24hUsd??0)<policy.minVolume24hUsd)(source==='MANUAL'?warn:hard).push('DISCOVERY_VOLUME_24H_BELOW_MINIMUM');
  if(f.poolAgeHours!==undefined&&f.poolAgeHours<policy.minPoolAgeHours)warn.push('DISCOVERY_POOL_YOUNG');
  if(f.volume30mUsd===undefined)warn.push('DISCOVERY_VOLUME_30M_UNAVAILABLE');else if(f.volume30mUsd<policy.minVolume30mUsd)warn.push('DISCOVERY_VOLUME_30M_SOFT_LOW');
  if(f.volume1hUsd===undefined)warn.push('DISCOVERY_VOLUME_1H_UNAVAILABLE');else if(f.volume1hUsd<policy.minVolume1hUsd)warn.push('DISCOVERY_VOLUME_1H_SOFT_LOW');
  if(f.holders===undefined)warn.push('DISCOVERY_HOLDERS_UNAVAILABLE');else if(f.holders<policy.minKnownHolders)warn.push('DISCOVERY_HOLDERS_SOFT_LOW');
  if(f.marketCapUsd===undefined)warn.push('DISCOVERY_MARKET_CAP_UNAVAILABLE');
  const liquidity=logSat(f.tvlUsd,Math.max(policy.minTvlUsd*6,150_000));const activity=(logSat(f.volume30mUsd,Math.max(policy.minVolume30mUsd*6,15_000))*.25+logSat(f.volume1hUsd,Math.max(policy.minVolume1hUsd*5,37_500))*.30+logSat(f.volume24hUsd,Math.max(policy.minVolume24hUsd*5,250_000))*.45);const fees=feeScore(f);const maturity=f.poolAgeHours===undefined?.45:Math.min(1,f.poolAgeHours/24);const holder=f.holders===undefined?.45:Math.min(1,f.holders/1500);const safetyScore=Math.max(0,Math.min(1,(liquidity*.30+activity*.32+maturity*.16+holder*.22)-fragilityPenalty(f))),score=Math.round(Math.max(0,Math.min(100,.65*f.discoveryEconomicPriority+.35*safetyScore*100))*100)/100;
  if(source==='MANUAL'||source==='BOTH')sel.push('DISCOVERY_MANUAL_PRIORITY');if(fees>=.7)sel.push('DISCOVERY_STRONG_FEE_DENSITY');if(f.discoveryEconomicPriority>=70)sel.push('DISCOVERY_HIGH_ECONOMIC_PRIORITY');if(activity>=.7)sel.push('DISCOVERY_STRONG_ACTIVITY');if(liquidity>=.7)sel.push('DISCOVERY_LIQUIDITY_SCALE');if(f.marketCapCohort==='MICRO'||f.marketCapCohort==='SMALL')sel.push('DISCOVERY_HIGHER_FRAGILITY_COHORT');
  const decision:DiscoveryDecision=hard.length?'REJECT':score>=policy.qualifiedMinPriority?'PASS':'WATCH';return{pool,source,features:f,decision,priorityScore:score,economicPriority:f.discoveryEconomicPriority,hardReasons:hard.sort(),warnings:warn.sort(),selectionReasons:sel.sort()};
}

function percentile(value:number,values:number[]):number{if(values.length<=1)return 100;const below=values.filter(v=>v<value).length,equal=values.filter(v=>v===value).length;return Math.round(((below+(equal-1)/2)/(values.length-1))*10000)/100}
function metricPercentile(v:number|undefined,values:Array<number|undefined>):number|undefined{if(v===undefined)return undefined;const xs=values.filter((x):x is number=>x!==undefined&&Number.isFinite(x));return xs.length?percentile(v,xs):undefined}
export function rankDiscovery(results:CheapScreenResult[],policy:DiscoveryPolicy):RankedDiscoveryPool[]{
  const eligible=results.filter(r=>r.decision!=='REJECT').sort((a,b)=>b.priorityScore-a.priorityScore||b.economicPriority-a.economicPriority||a.pool.address.localeCompare(b.pool.address));const scores=eligible.map(r=>r.priorityScore),fees=eligible.map(r=>r.features.feeTotalTvlRatio1hPct),vols=eligible.map(r=>r.features.volume1hUsd),tvls=eligible.map(r=>r.features.tvlUsd),economics=eligible.map(r=>r.economicPriority);
  return eligible.map((r,i)=>{const rank=i+1;let state:DiscoveryState=r.decision==='PASS'?'PREFILTERED':'OBSERVING',tier:DiscoveryTier='C';if(rank<=policy.maxActiveCandidates&&r.priorityScore>=policy.activeMinPriority)tier='A';else if(rank<=policy.maxActiveCandidates+policy.maxWatchlist&&r.priorityScore>=policy.qualifiedMinPriority)tier='B';return{...r,rank,universePercentile:percentile(r.priorityScore,scores),...(metricPercentile(r.features.feeTotalTvlRatio1hPct,fees)!==undefined?{feePercentile:metricPercentile(r.features.feeTotalTvlRatio1hPct,fees)}:{}),...(metricPercentile(r.features.volume1hUsd,vols)!==undefined?{volumePercentile:metricPercentile(r.features.volume1hUsd,vols)}:{}),...(metricPercentile(r.features.tvlUsd,tvls)!==undefined?{liquidityPercentile:metricPercentile(r.features.tvlUsd,tvls)}:{}),...(metricPercentile(r.economicPriority,economics)!==undefined?{economicPriorityPercentile:metricPercentile(r.economicPriority,economics)}:{}),state,tier};});
}

export async function enumeratePools(api:MeteoraDataApi,policy:DiscoveryPolicy):Promise<DataApiPool[]>{
  if(policy.sourceMode==='MANUAL')return[];const out:DataApiPool[]=[];const filter=policy.useServerSidePrefilter?`is_blacklisted=false && tvl>=${policy.minTvlUsd} && volume_24h>=${policy.minVolume24hUsd}`:undefined;for(let page=1;out.length<policy.maxUniverse;page++){const p=await api.listPools(page,Math.min(policy.pageSize,policy.maxUniverse-out.length),undefined,{sortBy:policy.serverSideSortBy,...(filter?{filterBy:filter}:{})});out.push(...p.data);const pages=p.pages??p.total_pages;if(!p.data.length||p.data.length<p.page_size||(pages!==undefined&&page>=pages))break;}return out.slice(0,policy.maxUniverse);
}

function discoveryAddress(row:MeteoraDiscoveryPool):string|undefined{const address=typeof row.pool_address==='string'?row.pool_address:typeof row.address==='string'?row.address:undefined;return address?.trim()||undefined;}
/**
 * Fetch a deliberately bounded economic enrichment set.  Failure to obtain
 * optional discovery economics never fabricates active TVL or bypasses the
 * established standard-source/safety path.
 */
export async function enumerateEconomicDiscoveryMetrics(api:MeteoraDataApi,policy:DiscoveryPolicy,observedAt:string):Promise<Map<string,Array<Partial<CanonicalDiscoveryMetrics>>>>{
  const patches=new Map<string,Array<Partial<CanonicalDiscoveryMetrics>>>(),pageSize=Math.min(100,Math.max(25,policy.maxDeepScreen*4));
  for(const timeframe of ['30m','1h','24h'] as const){
    try{
      const page=await api.listDiscoveryPools(1,pageSize,{timeframe,category:'all',sortBy:'fee_active_tvl_ratio:desc'});
      for(const row of page.data){const address=discoveryAddress(row);if(!address)continue;const values=patches.get(address)??[];values.push(discoveryPoolMetricPatch(row,timeframe,observedAt));patches.set(address,values);}
    }catch{/* The standard source remains independently safe and usable. */}
  }
  return patches;
}

export async function discoverUniverse(api:MeteoraDataApi,policy:DiscoveryPolicy,observedAt=new Date().toISOString()):Promise<DiscoveryUniverseResult>{
  const [auto,enrichment]=await Promise.all([enumeratePools(api,policy),enumerateEconomicDiscoveryMetrics(api,policy,observedAt)]);
  const map=new Map<string,{pool:DataApiPool;source:CheapScreenResult['source'];enrichment:ReadonlyArray<Partial<CanonicalDiscoveryMetrics>>}>();
  for(const p of auto)if(p.address)map.set(p.address,{pool:p,source:'AUTO',enrichment:enrichment.get(p.address)??[]});
  // Only a bounded, economics-ranked set may trigger an additional standard
  // pool read.  Active-TVL cannot directly admit an otherwise unknown pool.
  const candidates=[...enrichment.entries()].filter(([address])=>!map.has(address)).map(([address,patches])=>({address,patches,priority:discoveryEconomicPriority(mergeDiscoveryMetrics({ratioUnit:'PERCENTAGE_POINTS',source:'METEORA_DISCOVERY_API',ingestedAt:observedAt},patches))})).sort((a,b)=>b.priority-a.priority||a.address.localeCompare(b.address)).slice(0,Math.min(policy.maxUniverse,Math.max(policy.maxDeepScreen*2,policy.maxDeepScreen)));
  for(const candidate of candidates){try{const pool=await api.getPool(candidate.address);map.set(candidate.address,{pool,source:'AUTO',enrichment:candidate.patches});}catch{/* No full DLMM record means no safety-screenable candidate. */}}
  if(policy.sourceMode!=='AUTO')for(const address of policy.manualPools){let pool:DataApiPool;try{pool=await api.getPool(address)}catch{pool={address}}const prior=map.get(address);map.set(address,{pool:prior?.pool.address?prior.pool:pool,source:prior?'BOTH':'MANUAL',enrichment:prior?.enrichment??enrichment.get(address)??[]});}
  const screened=[...map.values()].map(x=>cheapScreen(x.pool,x.source,policy,observedAt,x.enrichment));const rankings=rankDiscovery(screened,policy);const rankedByAddress=new Map(rankings.map(r=>[r.pool.address,r]));const accepted=screened.filter(r=>r.decision!=='REJECT');const rejected=screened.filter(r=>r.decision==='REJECT');const manualFirst=rankings.filter(r=>r.source==='MANUAL'||r.source==='BOTH');const deepScreenQueue=[...manualFirst,...rankings.filter(r=>!manualFirst.some(m=>m.pool.address===r.pool.address))].slice(0,policy.maxDeepScreen).map(r=>rankedByAddress.get(r.pool.address)!).filter(Boolean);
  return{observedAt,policyId:policy.policyId,enumeratedCount:auto.length,deduplicatedCount:map.size,accepted,rejected,deepScreenQueue,rankings};
}
