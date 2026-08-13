// LPFORGE_PHASE7_RUNTIME_INTEGRATION_MODULE
import type {MeteoraDataApi} from '../../data-api/src/index.js';
import type {Phase1Store} from '../../db/src/index.js';
import type {SolanaRpcClient} from '../../meteora/src/index.js';
import type {Phase7HealthObservation} from '../../phase7-health/src/index.js';

export interface Phase7LiveHealthInput {assessmentAt:string;poolAddress:string;rpc:Pick<SolanaRpcClient,'getSlot'>;dataApi:Pick<MeteoraDataApi,'getPool'>;store:Pick<Phase1Store,'health'|'loadPhase7HealthFacts'>;}
const errorMessage=(e:unknown)=>e instanceof Error?e.message:String(e);
export async function collectPhase7LiveHealthObservations(input:Phase7LiveHealthInput):Promise<Phase7HealthObservation[]> {
  const nowMs=Date.parse(input.assessmentAt);if(!Number.isFinite(nowMs))throw new Error('LPFORGE_P7_LIVE_HEALTH_TIME');
  const observations:Phase7HealthObservation[]=[];
  try{const started=Date.now();const slot=await input.rpc.getSlot();observations.push({domain:'RPC',observedAt:input.assessmentAt,status:'HEALTHY',reasonCodes:[],metrics:{slot:slot.toString(),latencyMs:Math.max(0,Date.now()-started)}});}catch(e){observations.push({domain:'RPC',observedAt:input.assessmentAt,status:'CRITICAL',reasonCodes:['P7_LIVE_RPC_PROBE_FAILED'],metrics:{error:errorMessage(e)}});}
  try{const started=Date.now();const pool=await input.dataApi.getPool(input.poolAddress);observations.push({domain:'METEORA_API',observedAt:input.assessmentAt,status:pool.address===input.poolAddress?'HEALTHY':'CRITICAL',reasonCodes:pool.address===input.poolAddress?[]:['P7_LIVE_METEORA_POOL_MISMATCH'],metrics:{latencyMs:Math.max(0,Date.now()-started),pool:pool.address}});}catch(e){observations.push({domain:'METEORA_API',observedAt:input.assessmentAt,status:'DEGRADED',reasonCodes:['P7_LIVE_METEORA_API_PROBE_FAILED'],metrics:{error:errorMessage(e)}});}
  let dbHealthy=false;try{dbHealthy=await input.store.health();observations.push({domain:'DATABASE',observedAt:input.assessmentAt,status:dbHealthy?'HEALTHY':'CRITICAL',reasonCodes:dbHealthy?[]:['P7_LIVE_DATABASE_HEALTH_FALSE']});}catch(e){observations.push({domain:'DATABASE',observedAt:input.assessmentAt,status:'CRITICAL',reasonCodes:['P7_LIVE_DATABASE_PROBE_FAILED'],metrics:{error:errorMessage(e)}});}
  if(!dbHealthy){for(const domain of ['DECISION','EXECUTION','PORTFOLIO','RECONCILIATION'] as const)observations.push({domain,observedAt:input.assessmentAt,status:'CRITICAL',reasonCodes:[`P7_LIVE_${domain}_STATE_UNAVAILABLE`]});return observations;}
  try{
    const f=await input.store.loadPhase7HealthFacts(input.poolAddress);
    if(f.latestDecisionAt){const ageMs=Math.max(0,nowMs-Date.parse(f.latestDecisionAt));observations.push({domain:'DECISION',observedAt:f.latestDecisionAt,status:ageMs<=120_000?'HEALTHY':ageMs<=300_000?'DEGRADED':'CRITICAL',reasonCodes:ageMs<=120_000?[]:[ageMs<=300_000?'P7_LIVE_DECISION_AGING':'P7_LIVE_DECISION_STALE'],metrics:{ageMs}});}else observations.push({domain:'DECISION',observedAt:input.assessmentAt,status:'CRITICAL',reasonCodes:['P7_LIVE_DECISION_MISSING']});
    const executionCritical=f.unknownSubmissionCount>0;observations.push({domain:'EXECUTION',observedAt:input.assessmentAt,status:executionCritical?'CRITICAL':'HEALTHY',reasonCodes:executionCritical?['P7_LIVE_UNKNOWN_SUBMISSION']:[],metrics:{unknownSubmissionCount:f.unknownSubmissionCount,activeExecutionJournalCount:f.activeExecutionJournalCount}});
    observations.push({domain:'PORTFOLIO',observedAt:input.assessmentAt,status:'HEALTHY',reasonCodes:[],metrics:{openCanarySessionCount:f.openCanarySessionCount,...(f.latestPortfolioObservedAt?{latestPortfolioObservedAt:f.latestPortfolioObservedAt}:{})}});
    const reconCritical=f.unresolvedReconciliationDebt>0;observations.push({domain:'RECONCILIATION',observedAt:input.assessmentAt,status:reconCritical?'CRITICAL':'HEALTHY',reasonCodes:reconCritical?['P7_LIVE_RECONCILIATION_DEBT']:[],metrics:{unresolvedReconciliationDebt:f.unresolvedReconciliationDebt}});
  }catch(e){for(const domain of ['DECISION','EXECUTION','PORTFOLIO','RECONCILIATION'] as const)observations.push({domain,observedAt:input.assessmentAt,status:'CRITICAL',reasonCodes:[`P7_LIVE_${domain}_STATE_QUERY_FAILED`],metrics:{error:errorMessage(e)}});}
  return observations;
}
