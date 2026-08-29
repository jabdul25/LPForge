import { readFileSync,readdirSync } from 'node:fs';
import { createPostgresStore } from '../../../packages/db/src/index.js';
import {
  INVENTORY_FORECAST_V2_ACTIVATION_ID,
  INVENTORY_FORECAST_V2_COLLECTOR_VERSION,
  INVENTORY_FORECAST_V2_FORMULA_VERSION,
  INVENTORY_FORECAST_V2_HISTORY_LOOKBACK_MINUTES,
  INVENTORY_FORECAST_V2_MODEL_VERSION,
  INVENTORY_FORECAST_V2_OUTCOME_MODEL_VERSION,
  INVENTORY_FORECAST_V2_SCHEMA_VERSION,
  planProspectiveInventoryForecastV2,
} from '../../../packages/inventory-forecast-v2/src/index.js';
import { MARKET_CONTEXT_TELEMETRY_MODEL_VERSION } from '../../../packages/market-context-telemetry/src/index.js';
import type { FrozenPhase3ForwardDecision } from '../../../packages/phase3-forward-validation/src/index.js';

const json=(value:unknown)=>JSON.stringify(value,(_,entry)=>typeof entry==='bigint'?entry.toString():entry);
const M0052_MIGRATION='M0052_inventory_forecast_v2_prospective_shadow.sql';

function verifiedInventoryForecastV2Artifact():{sourceSha:string;buildId:string;migrationHead:string;policyHash:string} {
  const manifest=JSON.parse(readFileSync('RELEASE_MANIFEST.json','utf8')) as {sourceCommit?:unknown;buildIdentity?:unknown;migrationHead?:unknown;policyHash?:unknown};
  const sourceRevision=readFileSync('SOURCE_REVISION.txt','utf8').trim().replace(/^source_git_commit=/,'');
  const sourceSha=typeof manifest.sourceCommit==='string'?manifest.sourceCommit.trim():'';
  const buildId=typeof manifest.buildIdentity==='string'?manifest.buildIdentity.trim():'';
  const migrationHead=typeof manifest.migrationHead==='string'?manifest.migrationHead.trim():'';
  const policyHash=typeof manifest.policyHash==='string'?manifest.policyHash.trim():'';
  const migrations=readdirSync('packages/db/migrations').filter(name=>/^M[0-9]{4}_.+[.]sql$/.test(name)).sort();
  const m0052Index=migrations.indexOf(M0052_MIGRATION);
  if(sourceRevision!==sourceSha||!/^[0-9a-f]{40}$/i.test(sourceSha)||!/^[0-9a-f]{64}$/i.test(buildId)||!/^[0-9a-f]{64}$/i.test(policyHash)||m0052Index<0||migrationHead!==migrations.at(-1)||migrations.indexOf(migrationHead)<m0052Index)throw new Error('LPFORGE_INVENTORY_FORECAST_V2_RELEASE_ARTIFACT_INVALID');
  if(process.env.LPFORGE_SOURCE_COMMIT&&process.env.LPFORGE_SOURCE_COMMIT!==sourceSha)throw new Error('LPFORGE_INVENTORY_FORECAST_V2_RELEASE_SOURCE_ASSERTION_MISMATCH');
  if(process.env.LPFORGE_BUILD_ID&&process.env.LPFORGE_BUILD_ID!==buildId)throw new Error('LPFORGE_INVENTORY_FORECAST_V2_RELEASE_BUILD_ASSERTION_MISMATCH');
  return{sourceSha,buildId,migrationHead,policyHash};
}

/**
 * This recorder is intentionally downstream of frozen Phase-3/M0049 facts.
 * It returns no decision value and has no import into authority packages.
 */
export async function runProspectiveInventoryForecastV2Capture(input:{
  store:Awaited<ReturnType<typeof createPostgresStore>>;
  now:string;
  limit?:number;
  emit?:(event:Record<string,unknown>)=>void;
}):Promise<{activationCreated:boolean;due:number;inserted:number;duplicates:number;conflicts:number;observed:number;unavailable:number;sourceUnavailable:number;sourceStale:number;timestampInvalid:number;failures:number}> {
  const emit=input.emit??(event=>console.log(json(event)));
  const limit=Math.max(1,Math.min(500,Math.floor(input.limit??Number(process.env.LPFORGE_INVENTORY_FORECAST_V2_MAX_BATCH??100))));
  const artifact=verifiedInventoryForecastV2Artifact();
  const activation=await input.store.ensureInventoryForecastV2Activation({
    activationId:INVENTORY_FORECAST_V2_ACTIVATION_ID,activatedAt:input.now,sourceSha:artifact.sourceSha,buildId:artifact.buildId,migrationHead:artifact.migrationHead,policyHash:artifact.policyHash,
    forecastSchemaVersion:INVENTORY_FORECAST_V2_SCHEMA_VERSION,forecastModelVersion:INVENTORY_FORECAST_V2_MODEL_VERSION,formulaVersion:INVENTORY_FORECAST_V2_FORMULA_VERSION,collectorVersion:INVENTORY_FORECAST_V2_COLLECTOR_VERSION,m0050MarketContextModelVersion:MARKET_CONTEXT_TELEMETRY_MODEL_VERSION,v2OutcomeModelVersion:INVENTORY_FORECAST_V2_OUTCOME_MODEL_VERSION,
  });
  const tasks=await input.store.loadDueInventoryForecastV2Predictions(input.now,limit,INVENTORY_FORECAST_V2_MODEL_VERSION);
  const result={activationCreated:activation.created,due:tasks.length,inserted:0,duplicates:0,conflicts:0,observed:0,unavailable:0,sourceUnavailable:0,sourceStale:0,timestampInvalid:0,failures:0};
  emit({event:'INVENTORY_FORECAST_V2_SHADOW_CAPTURE_START',authority:'RESEARCH_ONLY_NO_POLICY_MUTATION',observedAt:input.now,activationCreated:activation.created,activationAt:activation.activatedAt,due:tasks.length});
  for(const task of tasks){
    try {
      const decision=task.decisionPayload as unknown as FrozenPhase3ForwardDecision;
      const start=Date.parse(task.decisionAt);
      if(!Number.isFinite(start))throw new Error('INVENTORY_FORECAST_V2_TASK_DECISION_TIMESTAMP_INVALID');
      // Bounded entirely at the decision cutoff. Newer protocol observations
      // can never displace or enrich this shadow prediction.
      const history=await input.store.loadOperationalHistory(task.poolAddress,new Date(start-INVENTORY_FORECAST_V2_HISTORY_LOOKBACK_MINUTES*60_000).toISOString(),2000,task.decisionAt);
      const plan=planProspectiveInventoryForecastV2({telemetryEpisodeId:task.telemetryEpisodeId,decision,poolIdentity:{...(task.tokenXMint?{tokenXMint:task.tokenXMint}:{}),...(task.tokenYMint?{tokenYMint:task.tokenYMint}:{}),...(task.poolFirstSeenAt?{firstSeenAt:task.poolFirstSeenAt}:{})},historicalFrames:history.binFrames});
      if(plan.captureStatus==='DUPLICATE_REJECTED'||plan.captureStatus==='INTEGRITY_CONFLICT'||plan.captureStatus==='PRE_ACTIVATION_NOT_APPLICABLE')throw new Error('INVENTORY_FORECAST_V2_PLANNER_STATUS_NOT_PERSISTABLE');
      const persisted=await input.store.appendInventoryForecastV2Prediction({
        telemetryEpisodeId:plan.telemetryEpisodeId,recommendationId:plan.recommendationId,candidateId:plan.candidateId,poolAddress:plan.poolAddress,decisionAt:plan.decisionAt,capturedAt:input.now,
        decisionSourceSha:task.sourceSha,decisionBuildId:task.buildId,decisionMigrationHead:task.migrationHead,forecastSchemaVersion:INVENTORY_FORECAST_V2_SCHEMA_VERSION,forecastModelVersion:INVENTORY_FORECAST_V2_MODEL_VERSION,formulaVersion:INVENTORY_FORECAST_V2_FORMULA_VERSION,collectorVersion:INVENTORY_FORECAST_V2_COLLECTOR_VERSION,captureStatus:plan.captureStatus,reasonCodes:plan.reasonCodes,rawFrozenInputs:plan.rawFrozenInputs,derivedForecast:plan.derivedForecast,provenance:plan.provenance,
      });
      if(persisted.status==='INSERTED')result.inserted++;
      else if(persisted.status==='DUPLICATE_REJECTED')result.duplicates++;
      else result.conflicts++;
      if(plan.captureStatus==='OBSERVED')result.observed++;
      if(plan.captureStatus==='FORECAST_UNAVAILABLE')result.unavailable++;
      if(plan.captureStatus==='SOURCE_UNAVAILABLE')result.sourceUnavailable++;
      if(plan.captureStatus==='SOURCE_STALE')result.sourceStale++;
      if(plan.captureStatus==='SOURCE_TIMESTAMP_UNVERIFIED')result.timestampInvalid++;
    }catch(error){
      result.failures++;
      emit({event:'INVENTORY_FORECAST_V2_SHADOW_CAPTURE_FAILED',authority:'RESEARCH_ONLY_NO_POLICY_MUTATION',telemetryEpisodeId:task.telemetryEpisodeId,error:error instanceof Error?error.message:String(error)});
    }
  }
  emit({event:'INVENTORY_FORECAST_V2_SHADOW_CAPTURE_COMPLETE',authority:'RESEARCH_ONLY_NO_POLICY_MUTATION',observedAt:input.now,...result});
  return result;
}

export function startIndependentProspectiveInventoryForecastV2Loop(input:{intervalMs:number;run:()=>Promise<void>;onError:(error:unknown)=>void}):void {
  const interval=Math.max(30_000,Math.min(300_000,Math.floor(input.intervalMs)));let running=false;
  const tick=async()=>{if(running)return;running=true;try{await input.run();}catch(error){input.onError(error);}finally{running=false;}};
  setTimeout(()=>void tick(),interval).unref();setInterval(()=>void tick(),interval).unref();
}
