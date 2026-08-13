import { canonicalJson, sha256Hex, type SwapEventFact } from '../../domain/src/index.js';
import type { DataApiPool, HistoricalVolumePoint, MeteoraDataApi } from '../../data-api/src/index.js';
import { buildMarketContext } from '../../market-context/src/index.js';
import type { MeteoraReadAdapter, SolanaRpcClient } from '../../meteora/src/index.js';
import { EXPECTED_DLMM_PROGRAM_ID, scanAddressTransactions } from '../../meteora/src/index.js';
import type { Phase1Store } from '../../db/src/index.js';

export interface ActiveCandidateEvidencePolicy {
  id:string;
  maxActiveCandidateCollectors:number;
  maxConcurrentPoolReads:number;
  perPoolMinIntervalMs:number;
  binRadius:number;
  eventScanLimit:number;
  historyWindowMs:number;
  staleAfterMs:number;
}
export const DEFAULT_ACTIVE_CANDIDATE_EVIDENCE_POLICY:ActiveCandidateEvidencePolicy={id:'phase4-active-candidate-evidence-v1',maxActiveCandidateCollectors:30,maxConcurrentPoolReads:2,perPoolMinIntervalMs:30_000,binRadius:35,eventScanLimit:10,historyWindowMs:4*60*60_000,staleAfterMs:180_000};
export interface HistoryMaturity {state:'WARMING'|'MATURE'|'STALE'|'DEGRADED';marketObservationCount:number;activeBinObservationCount:number;binFrameCount:number;swapEventCount:number;oldestObservationAt?:string;latestObservationAt?:string;completeness5m:number;completeness15m:number;completeness1h:number;reasonCodes:string[];}
export interface EconomicEstimateDraft {economicEstimateId:string;poolAddress:string;asOf:string;fidelity:'AGGREGATE_ESTIMATE'|'EVENT_PATH_ESTIMATE';rawObservationCount:number;effectiveSampleCount:number;independentEpisodeCount:number;feeObservationCount:number;eventPathObservationCount:number;feeRatePerCapitalHour:number;uncertainty:number;evidenceAgeSeconds:number;sourceHashes:Record<string,unknown>;payload:Record<string,unknown>;}
const n=(x:unknown)=>Number.isFinite(Number(x))?Number(x):0;
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const iso=(x:number)=>new Date(x).toISOString();
function episodeCount(timestamps:string[]){return new Set(timestamps.map(value=>Math.floor(Date.parse(value)/(15*60_000))).filter(Number.isFinite)).size;}

/** Computes the same horizon completeness Phase 4 consumes, while exposing it
 * as a first-class discovery/history state instead of an opaque entry block. */
export async function assessHistoryMaturity(input:{poolAddress:string;assessedAt:string;history:Awaited<ReturnType<Phase1Store['loadOperationalHistory']>>;staleAfterMs?:number}):Promise<HistoryMaturity>{
 const market=input.history.marketObservations, context=await buildMarketContext(input.poolAddress,input.assessedAt,market);
 const oldest=market.at(0)?.observedAt,latest=market.at(-1)?.observedAt;
 const c5=context.horizons['5m'].completeness,c15=context.horizons['15m'].completeness,c1h=context.horizons['1h'].completeness;
 const reasons:string[]=[];let state:HistoryMaturity['state']='WARMING';
 if(!latest||Date.parse(input.assessedAt)-Date.parse(latest)>(input.staleAfterMs??180_000)){state='STALE';reasons.push('HISTORY_STALE');}
 else if(Math.min(c5,c15,c1h)>=.60){state='MATURE';reasons.push('HISTORY_MATURE');}
 else reasons.push('HISTORY_WARMING');
 return{state,marketObservationCount:market.length,activeBinObservationCount:input.history.activeBins.length,binFrameCount:input.history.binFrames.length,swapEventCount:input.history.swapEvents.length,...(oldest?{oldestObservationAt:oldest}:{}),...(latest?{latestObservationAt:latest}:{}),completeness5m:c5,completeness15m:c15,completeness1h:c1h,reasonCodes:reasons};
}

/** Fee buckets are non-overlapping five-minute observations.  Independent
 * episodes deliberately use 15-minute buckets so minute-level duplication
 * cannot manufacture confidence. */
export async function deriveEventPathEconomicEstimate(input:{poolAddress:string;asOf:string;dataApiPool:DataApiPool;feeBuckets:HistoricalVolumePoint[];history:Awaited<ReturnType<Phase1Store['loadOperationalHistory']>>}):Promise<EconomicEstimateDraft>{
 const fees=input.feeBuckets.filter(row=>Number.isFinite(row.timestamp)&&n(row.fees)>=0).sort((a,b)=>a.timestamp-b.timestamp);
 const feeCount=fees.length, pathTimes=[...input.history.swapEvents.map(x=>x.stamp.observedAt),...input.history.binFrames.map(x=>x.observedAt)],pathCount=pathTimes.length;
 const effective=Math.min(episodeCount(fees.map(x=>iso(x.timestamp*1000))),episodeCount(pathTimes));
 const mature=feeCount>=12&&pathCount>=12&&effective>=6;
 const first=fees.at(0)?.timestamp,last=fees.at(-1)?.timestamp,spanHours=first!==undefined&&last!==undefined?Math.max(1/12,(last-first)/3600):1;
 const tvl=Math.max(1,n(input.dataApiPool.tvl));const feeRate=clamp(fees.reduce((sum,row)=>sum+Math.max(0,n(row.fees)),0)/tvl/spanHours,0,5);
 // This is evidence uncertainty before regime/sample/fidelity adjustments in
 // opportunity economics.  Mature, independent data has a natural route below
 // the Phase-4 maximum; incomplete evidence remains deliberately conservative.
 const uncertainty=mature?clamp(.12+.30*(1-Math.min(1,effective/24))+.18*(1-Math.min(1,feeCount/36))+.12*(1-Math.min(1,pathCount/36))):.55;
 const fidelity=mature?'EVENT_PATH_ESTIMATE' as const:'AGGREGATE_ESTIMATE' as const;
 const feeBucketSource=fees.map(x=>({timestamp:x.timestamp,fees:x.fees,protocolFees:x.protocol_fees,volume:x.volume}));
 const sourceHashes={feeBuckets:await sha256Hex(canonicalJson(feeBucketSource)),eventPath:await sha256Hex(canonicalJson(pathTimes))};
 const raw=feeCount+pathCount;
 const core={poolAddress:input.poolAddress,asOf:input.asOf,fidelity,raw,effective,feeCount,pathCount,feeRate,uncertainty,sourceHashes};
 return{economicEstimateId:`econ-${await sha256Hex(canonicalJson(core))}`,poolAddress:input.poolAddress,asOf:input.asOf,fidelity,rawObservationCount:raw,effectiveSampleCount:effective,independentEpisodeCount:effective,feeObservationCount:feeCount,eventPathObservationCount:pathCount,feeRatePerCapitalHour:feeRate,uncertainty,evidenceAgeSeconds:last===undefined?Number.POSITIVE_INFINITY:Math.max(0,(Date.parse(input.asOf)-last*1000)/1000),sourceHashes,payload:{policyId:DEFAULT_ACTIVE_CANDIDATE_EVIDENCE_POLICY.id,rawObservationCount:raw,effectiveSampleCount:effective,independentEpisodeCount:effective,feeBucketWindow:'NON_OVERLAPPING_5M',eventPathSources:['SWAP2EVT','BIN_FRAME'],mature}};
}

async function bounded<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]>{const out:R[]=[];let cursor=0;const workers=Array.from({length:Math.max(1,Math.min(limit,items.length))},async()=>{for(;;){const index=cursor++;if(index>=items.length)return;out[index]=await fn(items[index]!);}});await Promise.all(workers);return out;}
export async function collectActiveCandidateEvidence(input:{api:MeteoraDataApi;adapter:MeteoraReadAdapter;rpc:SolanaRpcClient;store:Phase1Store;observedAt:string;policy?:Partial<ActiveCandidateEvidencePolicy>}):Promise<{authority:'DISCOVERY_OBSERVATION_ONLY';observedAt:string;results:Array<{poolAddress:string;status:'PASS'|'DEGRADED';maturity?:HistoryMaturity;estimate?:EconomicEstimateDraft;error?:string}>}>{
 const p={...DEFAULT_ACTIVE_CANDIDATE_EVIDENCE_POLICY,...input.policy};const candidates=(await input.store.listDiscoveryCandidates(['A'])).filter(x=>x.state==='ACTIVE_CANDIDATE').slice(0,p.maxActiveCandidateCollectors);
 const results=await bounded(candidates,p.maxConcurrentPoolReads,async candidate=>{try{
   const [apiPool,pool,bins,fees,ohlcv,txs]=await Promise.all([input.api.getPool(candidate.poolAddress),input.adapter.getPool(candidate.poolAddress),input.adapter.getBinsAroundActive(candidate.poolAddress,p.binRadius),input.api.getHistoricalVolume(candidate.poolAddress,{timeframe:'5m',startTime:Math.floor((Date.parse(input.observedAt)-p.historyWindowMs)/1000)}),input.api.getOhlcv(candidate.poolAddress,{timeframe:'5m',startTime:Math.floor((Date.parse(input.observedAt)-p.historyWindowMs)/1000)}),scanAddressTransactions({rpc:input.rpc,address:candidate.poolAddress,limit:p.eventScanLimit,programId:EXPECTED_DLMM_PROGRAM_ID})]);
   await input.store.insertPoolSnapshot(pool);await input.store.insertBins(bins);await input.store.insertDataApiPool(apiPool as Record<string,unknown>,input.observedAt);await input.store.insertOhlcv(candidate.poolAddress,'5m',ohlcv.data as unknown as Array<Record<string,unknown>>,input.observedAt,'METEORA_API');await input.store.insertFeeVolumeObservations({poolAddress:candidate.poolAddress,observedAt:input.observedAt,source:'METEORA_API_HISTORICAL_5M',rows:fees.data.map(row=>({bucketAt:iso(row.timestamp*1000),fees:n(row.fees),protocolFees:n(row.protocol_fees),volume:n(row.volume),payload:{timestamp:row.timestamp}}))});
   for(const tx of txs)for(const event of await input.adapter.decodeEvents(candidate.poolAddress,tx.signature,tx.slot,tx.blockTime,tx.logs,tx.cpiInstructionData))if(event.pool===candidate.poolAddress)await input.store.insertSwapEvent(event);
   const history=await input.store.loadOperationalHistory(candidate.poolAddress,iso(Date.parse(input.observedAt)-p.historyWindowMs),2000),maturity=await assessHistoryMaturity({poolAddress:candidate.poolAddress,assessedAt:input.observedAt,history,staleAfterMs:p.staleAfterMs}),estimate=await deriveEventPathEconomicEstimate({poolAddress:candidate.poolAddress,asOf:input.observedAt,dataApiPool:apiPool,feeBuckets:fees.data,history});
   await input.store.upsertActiveCandidateHistoryMaturity({poolAddress:candidate.poolAddress,assessedAt:input.observedAt,...maturity,payload:{authority:'DISCOVERY_OBSERVATION_ONLY',policyId:p.id,deepQualifiedState:candidate.state,deepTier:candidate.tier}});await input.store.insertEconomicEstimate(estimate);return{poolAddress:candidate.poolAddress,status:'PASS' as const,maturity,estimate};
  }catch(error){const message=error instanceof Error?error.message:String(error);await input.store.upsertActiveCandidateHistoryMaturity({poolAddress:candidate.poolAddress,assessedAt:input.observedAt,state:'DEGRADED',marketObservationCount:0,activeBinObservationCount:0,binFrameCount:0,swapEventCount:0,completeness5m:0,completeness15m:0,completeness1h:0,reasonCodes:['HISTORY_COLLECTOR_POOL_FAILURE'],payload:{authority:'DISCOVERY_OBSERVATION_ONLY',error:message.slice(0,300)}});return{poolAddress:candidate.poolAddress,status:'DEGRADED' as const,error:message};}});
 return{authority:'DISCOVERY_OBSERVATION_ONLY',observedAt:input.observedAt,results};
}
