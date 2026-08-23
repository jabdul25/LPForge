import { createHash } from 'node:crypto';
import type { MeteoraDataApi, DataApiPool } from '../../data-api/src/index.js';
import type { MeteoraReadAdapter, SolanaRpcClient } from '../../meteora/src/index.js';
import { scanAddressTransactions, EXPECTED_DLMM_PROGRAM_ID } from '../../meteora/src/index.js';
import type { Phase1Store } from '../../db/src/index.js';
import { deepScreenPool, type DeepScreenResult, type DeepScreenPolicy, DEFAULT_DEEP_SCREEN_POLICY } from '../../pool-deep-screen/src/index.js';
import { assignUniverseTiers, type UniversePolicy, DEFAULT_UNIVERSE_POLICY } from '../../pool-universe/src/index.js';
import { evaluateDiscoveryStrategies } from '../../discovery-strategy-evaluation/src/index.js';
import { makePrediction, selectBaselines, type PredictionRecord, type OutcomeRecord, calibratePredictions, buildReputation } from '../../discovery-learning/src/index.js';
import { createPolicyProposal, assertNoAutomaticPolicyMutation } from '../../discovery-governance/src/index.js';
import type { RankedDiscoveryPool } from '../../pool-discovery/src/index.js';
export interface DiscoveryRuntimePolicy {
  id:string;
  deep:DeepScreenPolicy;
  universe:UniversePolicy;
  eventScanLimit:number;
  binRadius:number;
  capitalResearchSol:number;
  predictionCohorts:Array<'A'|'B'|'CONTROL'>;
}
export const DEFAULT_DISCOVERY_RUNTIME_POLICY:DiscoveryRuntimePolicy={id:'discovery-runtime-v2.1.1',deep:DEFAULT_DEEP_SCREEN_POLICY,universe:DEFAULT_UNIVERSE_POLICY,eventScanLimit:5,binRadius:35,capitalResearchSol:.1,predictionCohorts:['A','B','CONTROL']};
export type DiscoveryLifecycleState='OBSERVING'|'QUALIFIED'|'WATCHLIST'|'ACTIVE_CANDIDATE'|'REJECTED'|'QUARANTINED';
/**
 * Deep screening is expensive P4 work. Rotate the already-ranked queue by
 * discovery cycle so a transiently failing first pool cannot monopolize every
 * bounded admission slot. Ranking order is preserved within each slice.
 */
export function selectDeepScreenSlice<T>(queue:readonly T[],maxPools:number,observedAt:string,cycleMs=180_000):T[]{
 const limit=Math.max(0,Math.min(Math.floor(maxPools),queue.length));if(!limit)return[];
 const at=Date.parse(observedAt),epoch=Number.isFinite(at)?Math.floor(at/Math.max(1,cycleMs)):0;
 // Two out of every three bounded D3 rounds preserve priority.  The third
 // round reserves one slot for the ranked tail, giving a durable fairness
 // bound without allowing a lower-quality incumbent to dominate the queue.
 if(queue.length<=limit)return[...queue];
 const fairnessRound=((epoch%3)+3)%3===2;
 if(!fairnessRound)return queue.slice(0,limit);
 const prioritySlots=Math.max(0,limit-1),tail=queue.slice(prioritySlots),offset=((Math.floor((epoch+1)/3)%tail.length)+tail.length)%tail.length;
 return[...queue.slice(0,prioritySlots),tail[offset]!];
}
/**
 * D3/D4 is the only authority allowed to promote a cheap-screened pool into
 * execution eligibility.  D1/D2 priority alone must never produce an active
 * candidate state.
 */
export function deriveDiscoveryLifecycleState(input:{deep:Pick<DeepScreenResult,'eligibility'|'reasonCodes'>;assignment:Pick<import('../../pool-universe/src/index.js').UniverseAssignment,'tier'>}):{state:DiscoveryLifecycleState;tier:string}{
 const {eligibility}=input.deep,{tier}=input.assignment;
 if(input.deep.reasonCodes.some(code=>code.startsWith('DEEP_READ_FAILED:')))return{state:'OBSERVING',tier:'C'};
 if(eligibility==='QUARANTINED'||tier==='QUARANTINED')return{state:'QUARANTINED',tier:'QUARANTINED'};
 if(eligibility==='BLOCK'||tier==='REJECTED')return{state:'REJECTED',tier:'REJECTED'};
 if(eligibility!=='QUALIFIED')return{state:'OBSERVING',tier:'C'};
 // Tier-A proves a pool is qualified; durable admission into the bounded
 // live-evidence set happens transactionally in the discovery store.
 if(tier==='A')return{state:'QUALIFIED',tier:'A'};
 if(tier==='B')return{state:'WATCHLIST',tier:'B'};
 return{state:'QUALIFIED',tier};
}
const hash=(x:string)=>createHash('sha256').update(x).digest('hex').slice(0,32);
function movementHistory(events:Array<{startBinId?:number;endBinId?:number;blockTime?:string}>,activeBinId:number,observedAt:string){
 const rows:Array<{binId:number;observedAt:string}>=[];for(const e of events){if(e.blockTime&&e.endBinId!==undefined)rows.push({binId:e.endBinId,observedAt:e.blockTime});}
 if(!rows.length||rows.at(-1)?.observedAt!==observedAt)rows.push({binId:activeBinId,observedAt});return rows;
}
function fragility(r:RankedDiscoveryPool){let p=0;if(r.features.marketCapCohort==='MICRO')p+=.35;else if(r.features.marketCapCohort==='SMALL')p+=.15;if(r.features.liquidityToMarketCap!==undefined&&r.features.liquidityToMarketCap<.01)p+=.25;if(r.features.holders!==undefined&&r.features.holders<250)p+=.2;return Math.min(1,p);}
export async function runDeepDiscoveryCycle(input:{api:MeteoraDataApi;adapter:MeteoraReadAdapter;rpc:SolanaRpcClient;store:Phase1Store;cheapQueue:RankedDiscoveryPool[];observedAt:string;policy?:DiscoveryRuntimePolicy}){
 const p=input.policy??DEFAULT_DISCOVERY_RUNTIME_POLICY;const deep:DeepScreenResult[]=[];
 for(const cheap of input.cheapQueue){
  let pool:DataApiPool=cheap.pool;try{pool=await input.api.getPool(cheap.pool.address)}catch{}
  try{
   // The Meteora SDK and the RPC scanner share a provider budget.  Keep the
   // expensive read path serialized so one candidate cannot create a burst of
   // independent SDK/RPC requests and turn a transient rate limit into a
   // partially persisted discovery cycle.
   const compat=await input.adapter.verifyCompatibility(cheap.pool.address);
   const active=await input.adapter.getActiveBin(cheap.pool.address);
   const bins=await input.adapter.getBinsAroundActive(cheap.pool.address,p.binRadius);
   const hist=await input.api.getHistoricalVolume(cheap.pool.address,{timeframe:'5m'});
   const txs=await scanAddressTransactions({rpc:input.rpc,address:cheap.pool.address,limit:p.eventScanLimit,programId:EXPECTED_DLMM_PROGRAM_ID});
   const events=[];for(const tx of txs)events.push(...await input.adapter.decodeEvents(cheap.pool.address,tx.signature,tx.slot,tx.blockTime,tx.logs,tx.cpiInstructionData));
   const result=deepScreenPool({pool,protocolCompatible:compat.state==='VERIFIED',observedAt:input.observedAt,activeBinId:active.binId,bins,activeBinHistory:movementHistory(events,active.binId,input.observedAt),swaps:events,historicalFees:hist.data,marketFragility:fragility(cheap),dataFresh:true,discoveryMetrics:cheap.features.metrics});
   deep.push(result);await input.store.insertDeepScreenObservation({poolAddress:result.poolAddress,observedAt:result.observedAt,policyId:result.policyId,eligibility:result.eligibility,poolQualityScore:result.poolQualityScore,currentOpportunityScore:result.currentOpportunityScore,executableLiquidityScore:result.executableLiquidityScore,feeQualityScore:result.feeQualityScore,flowQualityScore:result.flowQualityScore,toxicityProbability:result.toxicity.toxicityProbability,...(result.opportunityHalfLifeMinutes!==null?{opportunityHalfLifeMinutes:result.opportunityHalfLifeMinutes}:{}),reasonCodes:result.reasonCodes,evidenceAvailability:result.evidenceAvailability,payload:{bin:result.bin,movement:result.movement,flow:result.flow,feeSustainability:result.feeSustainability,evidence:result.evidence}});
  }catch(error){
   const fallback=deepScreenPool({pool,protocolCompatible:false,observedAt:input.observedAt,activeBinId:0,bins:[],activeBinHistory:[],swaps:[],historicalFees:[],marketFragility:fragility(cheap),dataFresh:false,missingEvidence:['deepRead'],});
   fallback.reasonCodes.push(`DEEP_READ_FAILED:${error instanceof Error?error.message:'UNKNOWN'}`);deep.push(fallback);
   await input.store.insertDeepScreenObservation({poolAddress:fallback.poolAddress,observedAt:fallback.observedAt,policyId:fallback.policyId,eligibility:fallback.eligibility,poolQualityScore:fallback.poolQualityScore,currentOpportunityScore:fallback.currentOpportunityScore,executableLiquidityScore:fallback.executableLiquidityScore,feeQualityScore:fallback.feeQualityScore,flowQualityScore:fallback.flowQualityScore,toxicityProbability:fallback.toxicity.toxicityProbability,reasonCodes:fallback.reasonCodes,evidenceAvailability:fallback.evidenceAvailability,payload:{readFailure:true}});
  }
 }
 const assignments=assignUniverseTiers(deep,p.universe),cycleId=hash(`${p.id}:${input.observedAt}`);
 for(const a of assignments)await input.store.insertUniverseAssignment({assignmentCycleId:cycleId,poolAddress:a.poolAddress,observedAt:input.observedAt,policyId:p.universe.id,tier:a.tier,...(a.rank!==null?{rank:a.rank}:{}),deepPriority:a.deepPriority,control:a.control,selectionProbability:a.selectionProbability,...(a.opportunityHalfLifeMinutes!==null?{opportunityHalfLifeMinutes:a.opportunityHalfLifeMinutes}:{}),selectionReason:a.selectionReason,payload:{authority:'DISCOVERY_ONLY_NO_EXECUTION'}});
 const cheapMap=new Map(input.cheapQueue.map(x=>[x.pool.address,x])),deepMap=new Map(deep.map(x=>[x.poolAddress,x]));
 const predictions:PredictionRecord[]=[];
 for(const a of assignments.filter(x=>p.predictionCohorts.includes(x.tier as 'A'|'B'|'CONTROL'))){const d=deepMap.get(a.poolAddress);if(!d)continue;const ev=evaluateDiscoveryStrategies({deep:d,capitalSol:p.capitalResearchSol});const c=cheapMap.get(a.poolAddress);const pred=makePrediction({poolAddress:a.poolAddress,observedAt:input.observedAt,policyVersion:p.id,deep:d,strategy:ev,selectionContext:{tier:a.tier,rank:a.rank,selectionProbability:a.selectionProbability,selectionReason:a.selectionReason,universePercentile:c?.universePercentile??null,feePercentile:c?.feePercentile??null,volumePercentile:c?.volumePercentile??null,liquidityPercentile:c?.liquidityPercentile??null},cohort:a.control?'RANDOM_QUALIFIED_CONTROL':a.tier});predictions.push(pred);await input.store.insertDiscoveryPrediction({predictionId:pred.predictionId,poolAddress:pred.poolAddress,observedAt:pred.observedAt,policyVersion:pred.policyVersion,modelVersion:pred.modelVersion,cohort:pred.cohort,episodeKey:pred.episodeKey,selectedAction:pred.selectedAction,selectionContext:pred.selectionContext,prediction:pred as unknown as Record<string,unknown>});}
 const baselineInputs=deep.map(d=>({poolAddress:d.poolAddress,feeTvl:(cheapMap.get(d.poolAddress)?.features.feeTvl1h??0),feePersistence:d.feeSustainability.persistenceScore,liquidity:d.executableLiquidityScore/100,toxicity:d.toxicity.toxicityProbability,eligible:d.eligibility==='QUALIFIED'}));const baselines=selectBaselines(baselineInputs,cycleId);for(const [id,pool] of Object.entries(baselines))await input.store.insertDiscoveryBaseline({runId:cycleId,observedAt:input.observedAt,baselineId:id,...(pool?{selectedPoolAddress:pool}:{}),informationCutoff:input.observedAt,result:{prospective:true,informationCutoff:input.observedAt}});
 return{status:'PASS' as const,authority:'DISCOVERY_ONLY_NO_EXECUTION' as const,cycleId,deep,assignments,predictions,baselines};
}
export function researchProposalFromCalibration(input:{observedAt:string;calibration:ReturnType<typeof calibratePredictions>;minimumEpisodes?:number}){
 const min=input.minimumEpisodes??30;if(input.calibration.independentEpisodes<min)return null;if((input.calibration.brierProfit??0)<=.25&&(input.calibration.meanBias??0)<=.01)return null;
 const p=createPolicyProposal({proposalId:`disc-proposal-${hash(`${input.observedAt}:${JSON.stringify(input.calibration)}`)}`,createdAt:input.observedAt,hypothesis:'Discovery forecast calibration materially deviates from observed outcomes; evaluate a versioned calibration correction in research/shadow only.',targetPolicy:'discovery-model',changes:{automatic:false,recalibrate:true},evidence:{calibration:input.calibration}});return{proposal:p,authority:assertNoAutomaticPolicyMutation(p)};
}
export function aggregateLearning(predictions:PredictionRecord[],outcomes:OutcomeRecord[],observedAt:string){
 const calibration=calibratePredictions(predictions,outcomes);return{calibration,poolReputation:buildReputation(predictions,outcomes,p=>p.poolAddress),strategyReputation:buildReputation(predictions,outcomes,p=>String(p.selectedAction)),poolStrategyRegimeReputation:buildReputation(predictions,outcomes,p=>`${p.poolAddress}:${p.selectedAction}:${String(p.selectionContext.regime??'UNKNOWN')}`),proposal:researchProposalFromCalibration({observedAt,calibration})};
}
