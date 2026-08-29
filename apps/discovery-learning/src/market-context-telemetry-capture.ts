import { readFileSync,readdirSync } from 'node:fs';
import { createPostgresStore } from '../../../packages/db/src/index.js';
import {
  MARKET_CONTEXT_TELEMETRY_ACTIVATION_ID,
  MARKET_CONTEXT_TELEMETRY_COLLECTOR_VERSION,
  MARKET_CONTEXT_TELEMETRY_MODEL_VERSION,
  MARKET_CONTEXT_TELEMETRY_SCHEMA_VERSION,
  planProspectiveMarketContextSnapshot,
} from '../../../packages/market-context-telemetry/src/index.js';
import type { FrozenPhase3ForwardDecision } from '../../../packages/phase3-forward-validation/src/index.js';

const json=(value:unknown)=>JSON.stringify(value,(_,entry)=>typeof entry==='bigint'?entry.toString():entry);
const M0050_MIGRATION='M0050_prospective_market_context_telemetry.sql';
const POST_ENTRY_TELEMETRY_SCHEMA_VERSION='post-entry-state-telemetry-v2';

function verifiedM0050Artifact():{sourceSha:string;buildId:string;migrationHead:string} {
  const manifest=JSON.parse(readFileSync('RELEASE_MANIFEST.json','utf8')) as {sourceCommit?:unknown;buildIdentity?:unknown;migrationHead?:unknown};
  const sourceRevision=readFileSync('SOURCE_REVISION.txt','utf8').trim().replace(/^source_git_commit=/,'');
  const sourceSha=typeof manifest.sourceCommit==='string'?manifest.sourceCommit.trim():'';
  const buildId=typeof manifest.buildIdentity==='string'?manifest.buildIdentity.trim():'';
  const migrationHead=typeof manifest.migrationHead==='string'?manifest.migrationHead.trim():'';
  const migrations=readdirSync('packages/db/migrations').filter(name=>/^M[0-9]{4}_.+[.]sql$/.test(name)).sort();
  const m0050Index=migrations.indexOf(M0050_MIGRATION);
  if(sourceRevision!==sourceSha||!/^[0-9a-f]{40}$/i.test(sourceSha)||!/^[0-9a-f]{64}$/i.test(buildId)||m0050Index<0||migrationHead!==migrations.at(-1)||migrations.indexOf(migrationHead)<m0050Index)throw new Error('LPFORGE_M0050_RELEASE_ARTIFACT_INVALID');
  if(process.env.LPFORGE_SOURCE_COMMIT&&process.env.LPFORGE_SOURCE_COMMIT!==sourceSha)throw new Error('LPFORGE_M0050_RELEASE_SOURCE_ASSERTION_MISMATCH');
  if(process.env.LPFORGE_BUILD_ID&&process.env.LPFORGE_BUILD_ID!==buildId)throw new Error('LPFORGE_M0050_RELEASE_BUILD_ASSERTION_MISMATCH');
  return{sourceSha,buildId,migrationHead};
}

/**
 * Separate, research-only recorder. It consumes immutable M0049/Phase-3
 * evidence after a decision has been made and never returns any value to
 * Phase-3, Phase-4, ranking, readiness, execution, signing, or P7.
 */
export async function runProspectiveMarketContextTelemetryCapture(input:{
  store:Awaited<ReturnType<typeof createPostgresStore>>;
  now:string;
  limit?:number;
  emit?:(event:Record<string,unknown>)=>void;
}):Promise<{activationCreated:boolean;due:number;inserted:number;duplicates:number;conflicts:number;partial:number;sourceUnavailable:number;sourceStale:number;timestampInvalid:number;failures:number}> {
  const emit=input.emit??(event=>console.log(json(event)));
  const limit=Math.max(1,Math.min(500,Math.floor(input.limit??Number(process.env.LPFORGE_MARKET_CONTEXT_TELEMETRY_MAX_BATCH??100))));
  const artifact=verifiedM0050Artifact();
  const activation=await input.store.ensureMarketContextTelemetryActivation({
    activationId:MARKET_CONTEXT_TELEMETRY_ACTIVATION_ID,activatedAt:input.now,sourceSha:artifact.sourceSha,buildId:artifact.buildId,migrationVersion:M0050_MIGRATION,
    telemetrySchemaVersion:POST_ENTRY_TELEMETRY_SCHEMA_VERSION,marketContextSchemaVersion:MARKET_CONTEXT_TELEMETRY_SCHEMA_VERSION,marketContextModelVersion:MARKET_CONTEXT_TELEMETRY_MODEL_VERSION,collectorVersion:MARKET_CONTEXT_TELEMETRY_COLLECTOR_VERSION,
  });
  const tasks=await input.store.loadDueProspectiveMarketContextSnapshots(input.now,limit,MARKET_CONTEXT_TELEMETRY_MODEL_VERSION);
  const result={activationCreated:activation.created,due:tasks.length,inserted:0,duplicates:0,conflicts:0,partial:0,sourceUnavailable:0,sourceStale:0,timestampInvalid:0,failures:0};
  emit({event:'M0050_MARKET_CONTEXT_TELEMETRY_START',authority:'RESEARCH_ONLY_NO_POLICY_MUTATION',observedAt:input.now,activationCreated:activation.created,activationAt:activation.activatedAt,due:tasks.length});
  for(const task of tasks){
    try{
      const decision=task.decisionPayload as unknown as FrozenPhase3ForwardDecision;
      const plan=planProspectiveMarketContextSnapshot({telemetryEpisodeId:task.telemetryEpisodeId,decision});
      const provenance=plan.provenance;
      const persistenceStatus=plan.captureStatus==='OBSERVED'||plan.captureStatus==='PARTIAL'||plan.captureStatus==='SOURCE_UNAVAILABLE'||plan.captureStatus==='SOURCE_STALE'||plan.captureStatus==='SOURCE_TIMESTAMP_UNVERIFIED'?plan.captureStatus:'SOURCE_UNAVAILABLE';
      const persisted=await input.store.appendProspectiveMarketContextSnapshot({
        telemetryEpisodeId:plan.telemetryEpisodeId,recommendationId:plan.recommendationId,poolAddress:plan.poolAddress,decisionAt:plan.decisionAt,capturedAt:input.now,
        decisionSourceSha:task.sourceSha,decisionBuildId:task.buildId,decisionMigrationHead:task.migrationHead,
        telemetrySchemaVersion:POST_ENTRY_TELEMETRY_SCHEMA_VERSION,marketContextSchemaVersion:MARKET_CONTEXT_TELEMETRY_SCHEMA_VERSION,marketContextModelVersion:MARKET_CONTEXT_TELEMETRY_MODEL_VERSION,
        ...(typeof provenance.regimeModelVersion==='string'?{regimeModelVersion:provenance.regimeModelVersion}:{}),
        ...(typeof provenance.sourceMarketContextSchemaVersion==='string'?{volatilityModelVersion:provenance.sourceMarketContextSchemaVersion}:{}),
        collectorVersion:MARKET_CONTEXT_TELEMETRY_COLLECTOR_VERSION,captureStatus:persistenceStatus,reasonCodes:plan.reasonCodes,availability:plan.availability,
        rawPayload:plan.rawPayload,derivedInterpretation:plan.derivedInterpretation,provenance:plan.provenance,facts:plan.facts,
      });
      if(persisted.status==='INSERTED')result.inserted++;
      else if(persisted.status==='DUPLICATE_REJECTED')result.duplicates++;
      else result.conflicts++;
      if(plan.captureStatus==='PARTIAL')result.partial++;
      if(plan.captureStatus==='SOURCE_UNAVAILABLE')result.sourceUnavailable++;
      if(plan.captureStatus==='SOURCE_STALE')result.sourceStale++;
      if(plan.captureStatus==='SOURCE_TIMESTAMP_UNVERIFIED')result.timestampInvalid++;
    }catch(error){
      result.failures++;
      emit({event:'M0050_MARKET_CONTEXT_TELEMETRY_CAPTURE_FAILED',authority:'RESEARCH_ONLY_NO_POLICY_MUTATION',telemetryEpisodeId:task.telemetryEpisodeId,error:error instanceof Error?error.message:String(error)});
    }
  }
  emit({event:'M0050_MARKET_CONTEXT_TELEMETRY_COMPLETE',authority:'RESEARCH_ONLY_NO_POLICY_MUTATION',observedAt:input.now,...result});
  return result;
}

export function startIndependentProspectiveMarketContextTelemetryLoop(input:{intervalMs:number;run:()=>Promise<void>;onError:(error:unknown)=>void}):void {
  const interval=Math.max(30_000,Math.min(300_000,Math.floor(input.intervalMs)));
  let running=false;
  const tick=async()=>{if(running)return;running=true;try{await input.run();}catch(error){input.onError(error);}finally{running=false;}};
  setTimeout(()=>void tick(),interval).unref();
  setInterval(()=>void tick(),interval).unref();
}
