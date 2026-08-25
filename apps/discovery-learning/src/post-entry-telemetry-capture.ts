import { createPostgresStore } from '../../../packages/db/src/index.js';
import {
  planPostEntryTelemetryCheckpoint,
  POST_ENTRY_TELEMETRY_COLLECTOR_VERSION,
  POST_ENTRY_TELEMETRY_SCHEMA_VERSION,
  type TelemetryCheckpointTask,
} from '../../../packages/post-entry-telemetry/src/index.js';
import type { FrozenPhase3ForwardDecision } from '../../../packages/phase3-forward-validation/src/index.js';

const json=(value:unknown)=>JSON.stringify(value,(_,entry)=>typeof entry==='bigint'?entry.toString():entry);

/**
 * The only runtime writer for post-entry telemetry. This module is owned by
 * discovery-learning and is intentionally never imported by Phase 3, Phase 4,
 * production, P7, or execution.
 */
export async function runPostEntryTelemetryCapture(input:{
  store:Awaited<ReturnType<typeof createPostgresStore>>;
  now:string;
  limit?:number;
  emit?:(event:Record<string,unknown>)=>void;
}):Promise<{episodesCreated:number;due:number;inserted:number;deferred:number;duplicates:number;conflicts:number;sourceUnavailable:number;failures:number}> {
  const emit=input.emit??(event=>console.log(json(event)));
  const limit=Math.max(1,Math.min(500,Math.floor(input.limit??Number(process.env.LPFORGE_POST_ENTRY_TELEMETRY_MAX_BATCH??100))));
  const prepared=await input.store.preparePostEntryTelemetryEpisodes(input.now);
  const tasks=await input.store.loadDuePostEntryTelemetryCheckpoints(input.now,limit);
  const result={episodesCreated:prepared.created,due:tasks.length,inserted:0,deferred:0,duplicates:0,conflicts:0,sourceUnavailable:0,failures:0};
  emit({event:'POST_ENTRY_TELEMETRY_START',authority:'RESEARCH_ONLY_NO_POLICY_MUTATION',observedAt:input.now,episodesCreated:prepared.created,due:tasks.length});
  for(const task of tasks){
    try{
      const decision=task.decisionPayload as unknown as FrozenPhase3ForwardDecision;
      const history=task.observationType==='FINALIZATION'
        ? {marketObservations:[],binFrames:[],swapEvents:[]}
        : await input.store.loadOperationalHistory(decision.poolAddress,new Date(Date.parse(decision.decisionTimestamp)-5*60_000).toISOString(),2000);
      const planned=planPostEntryTelemetryCheckpoint({
        task:{...task,decisionPayload:decision} as TelemetryCheckpointTask,
        history:{
          marketObservations:history.marketObservations.map(row=>({observedAt:row.observedAt,price:row.price,...(row.activeBinId===undefined?{}:{activeBinId:row.activeBinId}),...(row.localLiquidity===undefined?{}:{tvl:row.localLiquidity}),...(row.volume===undefined?{}:{volume5m:row.volume}),...(row.feeValue===undefined?{}:{fee5m:row.feeValue}),...(row.resolutionMs===undefined?{}:{resolutionMs:row.resolutionMs})})),
          binFrames:history.binFrames,
          swapEvents:history.swapEvents,
        },
        capturedAt:input.now,
      });
      if(planned.defer){result.deferred++;continue;}
      const status=planned.status!;
      const content={...(planned.content??{}),capture:{checkpointStatus:status,reasonCodes:planned.reasonCodes,capturedAt:input.now,collectorVersion:POST_ENTRY_TELEMETRY_COLLECTOR_VERSION}};
      const persisted=await input.store.appendPostEntryTelemetryObservation({
        telemetryEpisodeId:task.telemetryEpisodeId,checkpointKey:task.checkpointKey,observationType:planned.observationType??task.observationType,targetAt:task.targetAt,...(planned.observedAt?{observedAt:planned.observedAt}:{}),capturedAt:input.now,checkpointStatus:status,sourceVersion:task.sourceVersion,collectorVersion:POST_ENTRY_TELEMETRY_COLLECTOR_VERSION,valuationContractVersion:'phase3-forward-v2-frozen-valuation-v1',content,
      });
      if(persisted.status==='INSERTED')result.inserted++;
      else if(persisted.status==='DUPLICATE_REJECTED')result.duplicates++;
      else result.conflicts++;
      if(status==='SOURCE_UNAVAILABLE')result.sourceUnavailable++;
    }catch(error){
      result.failures++;
      emit({event:'POST_ENTRY_TELEMETRY_CAPTURE_FAILED',authority:'RESEARCH_ONLY_NO_POLICY_MUTATION',telemetryEpisodeId:task.telemetryEpisodeId,checkpointKey:task.checkpointKey,error:error instanceof Error?error.message:String(error)});
    }
  }
  emit({event:'POST_ENTRY_TELEMETRY_COMPLETE',authority:'RESEARCH_ONLY_NO_POLICY_MUTATION',observedAt:input.now,...result});
  return result;
}

/** Separate, bounded recorder loop: it does not share a critical path with maturation. */
export function startIndependentPostEntryTelemetryLoop(input:{intervalMs:number;run:()=>Promise<void>;onError:(error:unknown)=>void}):void {
  const interval=Math.max(30_000,Math.min(300_000,Math.floor(input.intervalMs)));
  let running=false;
  const tick=async()=>{
    if(running)return;
    running=true;
    try{await input.run();}catch(error){input.onError(error);}finally{running=false;}
  };
  // Startup once() performs the first capture. Delay this independent loop so
  // the same due checkpoint cannot be concurrently captured twice.
  setTimeout(()=>void tick(),interval).unref();
  setInterval(()=>void tick(),interval).unref();
}
