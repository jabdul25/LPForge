import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_ACTIVE_CANDIDATE_EVIDENCE_POLICY,canonicalBackfillRefreshRequired,refreshCanonicalHistoricalBackfill,refreshCurrentPhase3Evidence} from '../.build/packages/active-candidate-evidence/src/index.js';
import {selectLiveEvidenceAdmissionCandidates,dynamicLiveEvidenceAdmissionCapacity} from '../.build/packages/db/src/index.js';

const at='2026-08-22T12:00:00.000Z',ms=Date.parse(at);
const stamp=i=>new Date(ms-(47-i)*5*60_000).toISOString();
const historical=Array.from({length:48},(_,i)=>({observedAt:stamp(i),sourceType:'HISTORICAL_API_BACKFILL',sourceProvider:'fixture',price:1+i*.001,resolutionMs:300000,activeBinId:100+i%3,volume:10,feeValue:1,localLiquidity:1000}));
const bins=Array.from({length:3},(_,i)=>({binId:99+i,amountX:100n,amountY:100n,liquiditySupply:1000n}));
function operational(rows){return{marketObservations:rows.map(x=>({observedAt:x.observedAt,price:x.price,activeBinId:x.activeBinId,volume:x.volume,feeValue:x.feeValue,localLiquidity:x.localLiquidity})),activeBins:rows.map(x=>({observedAt:x.observedAt,activeBinId:x.activeBinId})),binFrames:rows.map(x=>({observedAt:x.observedAt,activeBinId:x.activeBinId,bins})),swapEvents:rows.map((x,i)=>({pool:'STATIC',signature:`swap-${i}`,eventIndex:0,stamp:{observedAt:x.observedAt}}))};}
function staticStore(){
 const live=[11,5,3,1].map(minutes=>({observedAt:new Date(ms-minutes*60_000).toISOString(),sourceType:'LIVE_OBSERVED',sourceProvider:'OPERATOR_METEORA_API+RPC',price:1,activeBinId:100,resolutionMs:60000,volume:10,feeValue:1,localLiquidity:1000}));
 const observations=[...historical,...live],maturity=[],estimates=[],fees=Array.from({length:48},(_,i)=>({bucketAt:stamp(i),fees:1,protocolFees:0,volume:10}));
 return{observations,maturity,estimates,insertPoolSnapshot:async()=>{},insertBins:async()=>{},insertDataApiPool:async()=>{},insertCandidateMarketObservations:async value=>{for(const row of value.rows){const prior=observations.findIndex(x=>x.observedAt===row.observedAt&&x.sourceType===row.sourceType);if(prior>=0)observations[prior]=row;else observations.push(row);}},insertFeeVolumeObservations:async value=>{for(const row of value.rows){const prior=fees.findIndex(x=>x.bucketAt===row.bucketAt);if(prior>=0)fees[prior]={...fees[prior],...row};else fees.push(row);}},loadOperationalHistory:async()=>operational(observations),loadCandidateMarketObservations:async()=>[...observations],loadFeeVolumeObservations:async()=>[...fees],loadActiveCandidateBackfill:async()=>({quality:'SUFFICIENT'}),upsertActiveCandidateHistoryMaturity:async value=>maturity.push(value),insertEconomicEstimate:async value=>estimates.push(value)};
}
test('static production observation uses the shared full evidence projection without duplicate LIVE_OBSERVED rows',async()=>{
 const store=staticStore(),pool={address:'STATIC',activeBinId:100},apiPool={address:'STATIC',tvl:1000,current_price:1,fees:{'5m':1},protocol_fees:{'5m':0},volume:{'5m':10}};
 const result=await refreshCurrentPhase3Evidence({store,poolAddress:'STATIC',pool,bins,apiPool,observedAt:at,sourceProvider:'OPERATOR_METEORA_API+RPC',sourcePayload:{productionPolicyPool:true},collectionTarget:'PRODUCTION_POLICY',authority:'PRODUCTION_POLICY_MONITORING'});
 assert.equal(store.observations.filter(x=>x.sourceType==='LIVE_OBSERVED').length,5);
 assert.equal(store.maturity.at(-1).payload.collectionTarget,'PRODUCTION_POLICY');
 assert.equal(store.maturity.at(-1).payload.phase3CurrentLiveReady,true);
 assert.equal(store.estimates.at(-1).fidelity,'EVENT_PATH_ESTIMATE');
 assert.equal(result.estimate.fidelity,'EVENT_PATH_ESTIMATE');
 await refreshCurrentPhase3Evidence({store,poolAddress:'STATIC',pool,bins,apiPool,observedAt:at,sourceProvider:'OPERATOR_METEORA_API+RPC',sourcePayload:{productionPolicyPool:true},collectionTarget:'PRODUCTION_POLICY'});
 assert.equal(store.observations.filter(x=>x.sourceType==='LIVE_OBSERVED').length,5,'same physical observation is idempotent');
 assert.equal(dynamicLiveEvidenceAdmissionCapacity({serviceableCapacity:2,staticPolicyPoolCount:5}),2);
});
test('incomplete static evidence remains aggregate and does not fabricate Phase-3 readiness',async()=>{
 const store=staticStore();store.observations.splice(0,store.observations.length,...historical.slice(-2));
 const result=await refreshCurrentPhase3Evidence({store,poolAddress:'STATIC',pool:{address:'STATIC',activeBinId:100},bins,apiPool:{address:'STATIC',tvl:1000,current_price:1,fees:{'5m':1},volume:{'5m':10}},observedAt:at,sourceProvider:'OPERATOR_METEORA_API+RPC',collectionTarget:'PRODUCTION_POLICY'});
 assert.equal(result.estimate.fidelity,'AGGREGATE_ESTIMATE');assert.equal(result.phase3CurrentLiveReady,false);
});
function backfillFixture({prior,ohlcvCount=49}={}){
 let row=prior,calls=0;
 const points=Array.from({length:49},(_,i)=>({timestamp:Math.floor((ms-(48-i)*5*60_000)/1000),fees:1,protocol_fees:0,volume:10,open:1,high:1,low:1,close:1}));
 const store={loadActiveCandidateBackfill:async()=>row,upsertActiveCandidateBackfill:async value=>{row={...value};},insertOhlcv:async()=>{},insertFeeVolumeObservations:async()=>{},insertCandidateMarketObservations:async()=>{},insertSwapEvent:async()=>{}};
 const api={getHistoricalVolume:async()=>{calls++;return{data:points};},getOhlcv:async()=>{calls++;return{data:points.slice(0,ohlcvCount)};}};
 const adapter={decodeEvents:async()=>[]},rpc={getSignaturesForAddress:async()=>[],getTransaction:async()=>null};
 return{store,api,adapter,rpc,get calls(){return calls;},get row(){return row;}};
}
test('static canonical backfill retries only when absent, partial outside cooldown, or stale',async()=>{
 const partial={quality:'PARTIAL',last_successful_at:'2026-08-22T11:40:00.000Z'},sufficient={quality:'SUFFICIENT',last_successful_at:'2026-08-22T11:55:00.000Z'};
 assert.equal(canonicalBackfillRefreshRequired({prior:partial,observedAt:at}),true);
 assert.equal(canonicalBackfillRefreshRequired({prior:sufficient,observedAt:at}),false);
 assert.equal(canonicalBackfillRefreshRequired({prior:{quality:'PARTIAL',last_successful_at:'2026-08-22T11:50:00.000Z'},observedAt:at}),false);
 assert.equal(canonicalBackfillRefreshRequired({observedAt:at}),true);
 const fixture=backfillFixture({prior:partial});
 const refreshed=await refreshCanonicalHistoricalBackfill({api:fixture.api,adapter:fixture.adapter,rpc:fixture.rpc,store:fixture.store,poolAddress:'STATIC',apiPool:{address:'STATIC',tvl:1000},observedAt:at});
 assert.equal(refreshed.attempted,true);assert.ok(fixture.calls>0);assert.equal(fixture.row.quality,'SUFFICIENT');
 const noRetry=backfillFixture({prior:sufficient});
 assert.equal((await refreshCanonicalHistoricalBackfill({api:noRetry.api,adapter:noRetry.adapter,rpc:noRetry.rpc,store:noRetry.store,poolAddress:'STATIC',apiPool:{address:'STATIC',tvl:1000},observedAt:at})).attempted,false);assert.equal(noRetry.calls,0);
 const insideCooldown=backfillFixture({prior:{quality:'PARTIAL',last_successful_at:'2026-08-22T11:50:00.000Z'}});
 assert.equal((await refreshCanonicalHistoricalBackfill({api:insideCooldown.api,adapter:insideCooldown.adapter,rpc:insideCooldown.rpc,store:insideCooldown.store,poolAddress:'STATIC',apiPool:{address:'STATIC',tvl:1000},observedAt:at})).attempted,false);assert.equal(insideCooldown.calls,0);
 const absent=backfillFixture();
 assert.equal((await refreshCanonicalHistoricalBackfill({api:absent.api,adapter:absent.adapter,rpc:absent.rpc,store:absent.store,poolAddress:'STATIC',apiPool:{address:'STATIC',tvl:1000},observedAt:at})).attempted,true);assert.ok(absent.calls>0);
});
test('sparse upstream OHLCV remains PARTIAL and cannot fabricate static Phase-3 readiness',async()=>{
 const fixture=backfillFixture({prior:{quality:'PARTIAL',last_successful_at:'2026-08-22T11:40:00.000Z'},ohlcvCount:12});
 const result=await refreshCanonicalHistoricalBackfill({api:fixture.api,adapter:fixture.adapter,rpc:fixture.rpc,store:fixture.store,poolAddress:'STATIC',apiPool:{address:'STATIC',tvl:1000},observedAt:at});
 assert.equal(result.attempted,true);assert.equal(fixture.row.quality,'PARTIAL');assert.ok(fixture.row.reasonCodes.includes('ENTRY_HISTORY_BACKFILL_GAPS'));
 assert.equal(DEFAULT_ACTIVE_CANDIDATE_EVIDENCE_POLICY.maxConcurrentBackfills,1);
 assert.equal(dynamicLiveEvidenceAdmissionCapacity({serviceableCapacity:2,staticPolicyPoolCount:5}),2);
});
test('pending ready leases outrank ordinary active leases and keep FIFO order during over-capacity reconciliation',()=>{
 const base={state:'ACTIVE_CANDIDATE',firstSeenAt:at,matureForPhase3:false,phase3Terminal:false,evidenceLeaseActive:true};
 const selected=selectLiveEvidenceAdmissionCandidates([
  {...base,poolAddress:'ordinary-high',priorityScore:999,rank:1},
  {...base,poolAddress:'ready-new',priorityScore:1,rank:9,phase3ConsumptionPending:true,phase3ReadyAt:'2026-08-22T11:59:00.000Z'},
  {...base,poolAddress:'ready-old',priorityScore:1,rank:10,phase3ConsumptionPending:true,phase3ReadyAt:'2026-08-22T11:55:00.000Z'},
 ],2);
 assert.deepEqual(selected.map(x=>x.poolAddress),['ready-old','ready-new']);
 const oneReady=selectLiveEvidenceAdmissionCandidates([{...base,poolAddress:'ready',priorityScore:1,phase3ConsumptionPending:true,phase3ReadyAt:'2026-08-22T11:55:00.000Z'},{...base,poolAddress:'ordinary',priorityScore:1}],2);
 assert.deepEqual(oneReady.map(x=>x.poolAddress),['ready','ordinary']);
});
