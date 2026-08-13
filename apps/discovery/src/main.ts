import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createMeteoraDataApi } from '../../../packages/data-api/src/index.js';
import { createPostgresStore } from '../../../packages/db/src/index.js';
import { loadPhase1Config } from '../../../packages/config/src/index.js';
import { createMeteoraReadAdapter, createSolanaRpcClient } from '../../../packages/meteora/src/index.js';
import { deriveDiscoveryLifecycleState, runDeepDiscoveryCycle } from '../../../packages/discovery-runtime/src/index.js';
import { discoverUniverse, parseDiscoveryPolicy, type DiscoveryPolicy, type RankedDiscoveryPool } from '../../../packages/pool-discovery/src/index.js';

function json(v:unknown){return JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)}
function env(name:string,fallback?:string):string{const v=process.env[name]??fallback;if(!v)throw new Error(`LPFORGE_DISCOVERY_ENV_REQUIRED:${name}`);return v}
async function loadPolicy():Promise<DiscoveryPolicy>{
  const path=process.env.LPFORGE_DISCOVERY_POLICY_PATH??'policies/pool-discovery-policy.json';
  const raw=JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown>;
  if(process.env.LPFORGE_POOL_SOURCE_MODE) raw.sourceMode=process.env.LPFORGE_POOL_SOURCE_MODE;
  if(process.env.LPFORGE_MANUAL_POOLS) raw.manualPools=process.env.LPFORGE_MANUAL_POOLS.split(',').map(x=>x.trim()).filter(Boolean);
  return parseDiscoveryPolicy(raw);
}
function cycleId(policyId:string,observedAt:string){return createHash('sha256').update(`${policyId}:${observedAt}`).digest('hex').slice(0,32)}
function reasonCodes(r:RankedDiscoveryPool){return [...new Set([...r.hardReasons,...r.warnings,...r.selectionReasons])].sort()}
async function once(){
  const policy=await loadPolicy();
  const api=createMeteoraDataApi({...((process.env.LPFORGE_METEORA_DATA_API_URL??'').trim()?{baseUrl:process.env.LPFORGE_METEORA_DATA_API_URL!}:{}),maxRps:Number(process.env.LPFORGE_DATA_API_MAX_RPS??1),timeoutMs:Number(process.env.LPFORGE_HTTP_TIMEOUT_MS??10000)});
  const result=await discoverUniverse(api,policy);
  const databaseUrl=env('DATABASE_URL');const store=await createPostgresStore(databaseUrl);const rankingCycleId=cycleId(policy.policyId,result.observedAt);
  try{
    const ranked=new Map(result.rankings.map(x=>[x.pool.address,x]));
    for(const raw of [...result.accepted,...result.rejected]){
      const r=ranked.get(raw.pool.address);const state=r?.state??'REJECTED',tier=r?.tier??'REJECTED';
      await store.insertDiscoveryObservation({poolAddress:raw.pool.address,observedAt:result.observedAt,policyId:policy.policyId,source:raw.source,decision:raw.decision,priorityScore:raw.priorityScore,metrics:{tvlUsd:raw.features.tvlUsd,volume30mUsd:raw.features.volume30mUsd,volume1hUsd:raw.features.volume1hUsd,volume24hUsd:raw.features.volume24hUsd,fees30mUsd:raw.features.fees30mUsd,fees1hUsd:raw.features.fees1hUsd,fees24hUsd:raw.features.fees24hUsd,feeTvl30m:raw.features.feeTvl30m,feeTvl1h:raw.features.feeTvl1h,feeTvl24h:raw.features.feeTvl24h,marketCapUsd:raw.features.marketCapUsd,liquidityToMarketCap:raw.features.liquidityToMarketCap,volume24hToMarketCap:raw.features.volume24hToMarketCap,fees24hToMarketCap:raw.features.fees24hToMarketCap,holders:raw.features.holders},hardReasons:raw.hardReasons,warnings:raw.warnings,selectionReasons:raw.selectionReasons,evidenceState:raw.features.evidence,payload:{name:raw.features.name,marketCapCohort:raw.features.marketCapCohort,wsolPair:raw.features.wsolPair,dataApi:raw.pool}});
      await store.upsertDiscoveryPool({poolAddress:raw.pool.address,observedAt:result.observedAt,sourceManual:raw.source==='MANUAL'||raw.source==='BOTH',sourceAuto:raw.source==='AUTO'||raw.source==='BOTH',tokenXMint:raw.features.tokenX,tokenYMint:raw.features.tokenY,pairedTokenMint:raw.features.pairedTokenMint,pairedTokenSymbol:raw.features.pairedTokenSymbol,marketCapCohort:raw.features.marketCapCohort,state,tier,priorityScore:raw.priorityScore,rank:r?.rank,universePercentile:r?.universePercentile,reasonCodes:r?reasonCodes(r):raw.hardReasons,evidenceState:raw.features.evidence,payload:{policyId:policy.policyId,decision:raw.decision,selectionReasons:raw.selectionReasons,warnings:raw.warnings}});
    }
    for(const r of result.rankings)await store.insertDiscoveryRanking({rankingCycleId,poolAddress:r.pool.address,observedAt:result.observedAt,policyId:policy.policyId,rank:r.rank,universePercentile:r.universePercentile,feePercentile:r.feePercentile,volumePercentile:r.volumePercentile,liquidityPercentile:r.liquidityPercentile,priorityScore:r.priorityScore,state:r.state,tier:r.tier,reasonCodes:reasonCodes(r),payload:{marketCapCohort:r.features.marketCapCohort,source:r.source}});
    const staleCutoff=new Date(Date.parse(result.observedAt)-policy.staleAfterMs).toISOString();const staleMarked=await store.markDiscoveryPoolsStale(staleCutoff,result.observedAt);
    let deep:Awaited<ReturnType<typeof runDeepDiscoveryCycle>>|undefined;
    if((process.env.LPFORGE_DISCOVERY_DEEP_ENABLED??'true').toLowerCase()==='true'&&result.deepScreenQueue.length){
      const cfg=loadPhase1Config();if(cfg.dataMode!=='LIVE_READ_ONLY')throw new Error('LPFORGE_DISCOVERY_DEEP_REQUIRES_LIVE_READ_ONLY');
      // A pool entering D3 is deliberately non-executable until the current
      // deep-screen result and D4 tier assignment have both been persisted.
      for(const r of result.deepScreenQueue)await store.upsertDiscoveryPool({poolAddress:r.pool.address,observedAt:result.observedAt,sourceManual:r.source==='MANUAL'||r.source==='BOTH',sourceAuto:r.source==='AUTO'||r.source==='BOTH',tokenXMint:r.features.tokenX,tokenYMint:r.features.tokenY,pairedTokenMint:r.features.pairedTokenMint,pairedTokenSymbol:r.features.pairedTokenSymbol,marketCapCohort:r.features.marketCapCohort,state:'OBSERVING',tier:'C',priorityScore:r.priorityScore,rank:r.rank,universePercentile:r.universePercentile,reasonCodes:['DISCOVERY_DEEP_SCREEN_IN_PROGRESS'],evidenceState:r.features.evidence,payload:{policyId:policy.policyId,deepScreenInProgressAt:result.observedAt}});
      const adapter=createMeteoraReadAdapter({rpcUrl:cfg.solanaRpcHttpUrl,cluster:cfg.cluster,programId:cfg.programId,expectedSdkVersion:cfg.expectedSdkVersion,rpcTimeoutMs:cfg.rpcTimeoutMs});
      const rpc=createSolanaRpcClient({url:cfg.solanaRpcHttpUrl,timeoutMs:cfg.rpcTimeoutMs,minIntervalMs:cfg.rpcMinIntervalMs,maxRetries:cfg.rpcMaxRetries,retryBaseDelayMs:cfg.rpcRetryBaseDelayMs,retryMaxDelayMs:cfg.rpcRetryMaxDelayMs});
      deep=await runDeepDiscoveryCycle({api,adapter,rpc,store,cheapQueue:result.deepScreenQueue,observedAt:result.observedAt});
      const byPool=new Map(deep.assignments.map(x=>[x.poolAddress,x])),deepByPool=new Map(deep.deep.map(x=>[x.poolAddress,x]));
      for(const r of result.rankings){const a=byPool.get(r.pool.address),d=deepByPool.get(r.pool.address);if(!a||!d)continue;const lifecycle=deriveDiscoveryLifecycleState({deep:d,assignment:a});await store.upsertDiscoveryPool({poolAddress:r.pool.address,observedAt:result.observedAt,sourceManual:r.source==='MANUAL'||r.source==='BOTH',sourceAuto:r.source==='AUTO'||r.source==='BOTH',tokenXMint:r.features.tokenX,tokenYMint:r.features.tokenY,pairedTokenMint:r.features.pairedTokenMint,pairedTokenSymbol:r.features.pairedTokenSymbol,marketCapCohort:r.features.marketCapCohort,state:lifecycle.state,tier:lifecycle.tier,priorityScore:a.deepPriority,rank:a.rank??undefined,universePercentile:r.universePercentile,reasonCodes:a.selectionReason,evidenceState:r.features.evidence,payload:{policyId:policy.policyId,deepScreened:true,deepScreenedAt:result.observedAt,control:a.control,opportunityHalfLifeMinutes:a.opportunityHalfLifeMinutes}});}
    }
    const summary={status:'PASS',authority:'DISCOVERY_ONLY_NO_EXECUTION',observedAt:result.observedAt,policyId:policy.policyId,rankingCycleId,enumerated:result.enumeratedCount,deduplicated:result.deduplicatedCount,accepted:result.accepted.length,rejected:result.rejected.length,deepScreenQueue:result.deepScreenQueue.length,deepScreened:deep?.deep.length??0,predictions:deep?.predictions.length??0,baselines:deep?.baselines??{},staleMarked,tierA:deep?.assignments.filter(x=>x.tier==='A').length??0,tierB:deep?.assignments.filter(x=>x.tier==='B').length??0,tierControl:deep?.assignments.filter(x=>x.tier==='CONTROL').length??0,top:result.rankings.slice(0,10).map(x=>({rank:x.rank,pool:x.pool.address,name:x.features.name,score:x.priorityScore,marketCapCohort:x.features.marketCapCohort,feeTvl1h:x.features.feeTvl1h,volume1hUsd:x.features.volume1hUsd,tvlUsd:x.features.tvlUsd,reasons:reasonCodes(x)}))};console.log(json(summary));return summary;
  } finally {await store.close()}
}
async function status(){const store=await createPostgresStore(env('DATABASE_URL'));try{console.log(json({authority:'DISCOVERY_ONLY_NO_EXECUTION',candidates:await store.listDiscoveryCandidates(['A','B','C'])}))}finally{await store.close()}}
async function start(){const interval=Math.max(30_000,Number(process.env.LPFORGE_DISCOVERY_INTERVAL_MS??180_000));for(;;){try{await once()}catch(e){console.error(json({status:'ERROR',authority:'DISCOVERY_ONLY_NO_EXECUTION',error:e instanceof Error?e.message:String(e)}))}await new Promise(r=>setTimeout(r,interval));}}
const cmd=process.argv[2]??'once';if(cmd==='once')await once();else if(cmd==='start')await start();else if(cmd==='status')await status();else throw new Error(`LPFORGE_DISCOVERY_COMMAND:${cmd}`);
