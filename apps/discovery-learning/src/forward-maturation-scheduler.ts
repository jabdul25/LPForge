export type ForwardMaturationState = 'PENDING' | 'INSUFFICIENT_EVIDENCE' | 'FINAL' | 'FAILED_DATA_INTEGRITY';

export interface ForwardMaturationTask {
  recommendationId: string;
  horizonMinutes: number;
  /** Durable state read with the task; missing is legacy-PENDING compatibility. */
  state?: ForwardMaturationState;
  retryCount?: number;
  dueAt?: string;
  nextRetryAt?: string;
  sourceSha?: string;
}

export interface ForwardMaturationTaskResult {
  state: ForwardMaturationState;
  reasonCodes?: readonly string[];
}

export interface ForwardMaturationPersistence {
  writeApplied: boolean;
  stateTransition: boolean;
  retryNoProgress: boolean;
}

export interface ForwardMaturationBatchSummary {
  selected: number;
  attempted: number;
  stateTransitions: number;
  newFinal: number;
  newInsufficient: number;
  retryNoProgress: number;
  persistedWrites: number;
  /** Legacy projections retained for existing research diagnostics. */
  due: number;
  processed: number;
  finalized: number;
  insufficient: number;
  failed: number;
  persisted: number;
}

/** A deterministic, bounded two-lane sequence.  Neither lane can consume
 * every slot while the other has due work, and callers still retain strict
 * serial maturation within each returned row. */
export function interleaveBoundedCounterfactualLanes<T>(v3:readonly T[],historical:readonly T[],limit:number):T[]{
  const cap=Math.max(1,Math.floor(limit)),out:T[]=[];
  for(let index=0;out.length<cap&&(index<v3.length||index<historical.length);index++){
    if(index<v3.length&&out.length<cap)out.push(v3[index]!);
    if(index<historical.length&&out.length<cap)out.push(historical[index]!);
  }
  return out;
}

/** Reserve two thirds of the bounded M0054 batch for fresh V3 when it is due.
 * The remaining third guarantees continuous historical catch-up while the
 * active M0056 working set has enough service to remain bounded. */
export function counterfactualV3ReservedSlots(limit:number):number{
  const cap=Math.max(1,Math.floor(limit));
  return Math.max(1,Math.ceil(cap*2/3));
}

export type ForwardMaturationLogEvent = {
  event: 'FORWARD_MATURATION_DUE' | 'FORWARD_MATURATION_FINAL' | 'FORWARD_MATURATION_INSUFFICIENT' | 'FORWARD_MATURATION_RETRY_NO_PROGRESS' | 'FORWARD_MATURATION_FAILED' | 'FORWARD_MATURATION_PERSISTED';
  recommendationId?: string;
  horizonMinutes?: number;
  error?: string;
  due?: number;
  persisted?: boolean;
  stateTransition?: boolean;
  retryNoProgress?: boolean;
};

/** Existing evidence collection retries use a fifteen-minute cooldown. The
 * forward queue uses that same base cadence, with exponential delay capped at
 * the existing one-hour bounded-retry ceiling. */
export const FORWARD_MATURATION_RETRY_BASE_MS=15*60_000;
export const FORWARD_MATURATION_RETRY_MAX_MS=60*60_000;
export const FORWARD_MATURATION_RETRY_LIMIT=4;

export interface ForwardMaturationRetryPlan {
  retryCount: number;
  terminal: boolean;
  nextRetryAt?: string;
}

/** A missing frozen candidate can never be reconstructed. Frame coverage and
 * continuity gaps may improve only through delayed historical ingestion, so
 * they receive bounded retries; their outcome semantics are unchanged. */
export function deriveForwardMaturationRetryPlan(input:{priorState:ForwardMaturationState|undefined;resultState:ForwardMaturationState;reasonCodes:readonly string[];retryCount?:number;attemptedAt:string}):ForwardMaturationRetryPlan {
  const priorRetries=Math.max(0,Math.floor(input.retryCount??0));
  if(input.resultState!=='INSUFFICIENT_EVIDENCE')return{retryCount:priorRetries,terminal:input.resultState==='FINAL'||input.resultState==='FAILED_DATA_INTEGRITY'};
  const retryCount=priorRetries+1;
  const terminal=input.reasonCodes.includes('FORWARD_FROZEN_CANDIDATE_UNAVAILABLE')||input.reasonCodes.some(code=>['FORWARD_V2_FROZEN_WSOL_VALUATION_INVALID','FORWARD_V2_FROZEN_CAPITAL_INVALID','FORWARD_V2_CAPITAL_ALLOCATION_INVALID','FORWARD_V2_BIN_LIQUIDITY_UNAVAILABLE','FORWARD_V2_NOT_PRICE_TAKING','FORWARD_V2_POSITION_QUANTITY_UNREPRESENTABLE','FORWARD_V2_CAPITAL_REPRESENTATION_INVALID'].includes(code))||retryCount>=FORWARD_MATURATION_RETRY_LIMIT;
  if(terminal)return{retryCount,terminal:true};
  const attempted=Date.parse(input.attemptedAt);
  if(!Number.isFinite(attempted))throw new Error('LPFORGE_FORWARD_MATURATION_ATTEMPT_TIMESTAMP_INVALID');
  const delay=Math.min(FORWARD_MATURATION_RETRY_MAX_MS,FORWARD_MATURATION_RETRY_BASE_MS*(2**Math.max(0,retryCount-1)));
  return{retryCount,terminal:false,nextRetryAt:new Date(attempted+delay).toISOString()};
}

/** Defense-in-depth ordering mirrors the durable SQL queue: newly due PENDING
 * work first, oldest due first; only then eligible insufficient-evidence retries. */
export function prioritizeForwardMaturationTasks<T extends ForwardMaturationTask>(tasks:readonly T[]):T[]{
  const state=(task:T):ForwardMaturationState=>task.state??'PENDING';
  const time=(value:string|undefined)=>{const parsed=Date.parse(value??'');return Number.isFinite(parsed)?parsed:Number.POSITIVE_INFINITY;};
  return [...tasks].sort((a,b)=>{
    const priority=(state(a)==='PENDING'?0:1)-(state(b)==='PENDING'?0:1);
    if(priority)return priority;
    const aAt=state(a)==='PENDING'?time(a.dueAt):time(a.nextRetryAt??a.dueAt),bAt=state(b)==='PENDING'?time(b.dueAt):time(b.nextRetryAt??b.dueAt);
    return aAt-bAt||a.horizonMinutes-b.horizonMinutes||a.recommendationId.localeCompare(b.recommendationId);
  });
}

/** Runs only rows already identified as due by the durable store. */
export async function processDueForwardMaturations<T extends ForwardMaturationTask, R extends ForwardMaturationTaskResult>(input: {
  tasks: readonly T[];
  mature(task: T): Promise<R>;
  persist(task: T, result: R): Promise<ForwardMaturationPersistence>;
  emit?(event: ForwardMaturationLogEvent): void;
}): Promise<ForwardMaturationBatchSummary> {
  const tasks=prioritizeForwardMaturationTasks(input.tasks);
  const summary: ForwardMaturationBatchSummary = { selected:tasks.length,attempted:0,stateTransitions:0,newFinal:0,newInsufficient:0,retryNoProgress:0,persistedWrites:0,due:tasks.length,processed:0,finalized:0,insufficient:0,failed:0,persisted:0 };
  if(summary.selected)input.emit?.({event:'FORWARD_MATURATION_DUE',due:summary.selected});
  for(const task of tasks){
    try{
      const result=await input.mature(task);
      summary.attempted++;summary.processed++;
      const persistence=await input.persist(task,result);
      if(persistence.writeApplied){summary.persistedWrites++;summary.persisted++;}
      if(persistence.stateTransition){
        summary.stateTransitions++;
        if(result.state==='FINAL'){summary.newFinal++;summary.finalized++;input.emit?.({event:'FORWARD_MATURATION_FINAL',recommendationId:task.recommendationId,horizonMinutes:task.horizonMinutes});}
        if(result.state==='INSUFFICIENT_EVIDENCE'){summary.newInsufficient++;summary.insufficient++;input.emit?.({event:'FORWARD_MATURATION_INSUFFICIENT',recommendationId:task.recommendationId,horizonMinutes:task.horizonMinutes});}
      }
      if(persistence.retryNoProgress){summary.retryNoProgress++;input.emit?.({event:'FORWARD_MATURATION_RETRY_NO_PROGRESS',recommendationId:task.recommendationId,horizonMinutes:task.horizonMinutes,retryNoProgress:true});}
      input.emit?.({event:'FORWARD_MATURATION_PERSISTED',recommendationId:task.recommendationId,horizonMinutes:task.horizonMinutes,persisted:persistence.writeApplied,stateTransition:persistence.stateTransition,retryNoProgress:persistence.retryNoProgress});
    }catch(error){
      summary.failed++;
      input.emit?.({event:'FORWARD_MATURATION_FAILED',recommendationId:task.recommendationId,horizonMinutes:task.horizonMinutes,error:error instanceof Error?error.message:String(error)});
    }
  }
  return summary;
}

export interface IndependentForwardMaturationLoop {
  stop(): void;
  completed: Promise<void>;
}

/**
 * An immediate, serial timer that is intentionally independent from slower
 * counterfactual/calibration work in the main learning loop.
 */
export function startIndependentForwardMaturationLoop(input: {
  intervalMs: number;
  run(): Promise<void>;
  onError(error: unknown): void;
}): IndependentForwardMaturationLoop {
  const requestedIntervalMs = Math.floor(input.intervalMs);
  const intervalMs = Number.isFinite(requestedIntervalMs) ? Math.max(30_000, Math.min(300_000, requestedIntervalMs)) : 60_000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  const wait = () => new Promise<void>(resolve => {
    wake = resolve;
    timer = setTimeout(() => {
      timer = undefined;
      wake = undefined;
      resolve();
    }, intervalMs);
  });
  const completed = (async () => {
    while (!stopped) {
      try {
        await input.run();
      } catch (error) {
        input.onError(error);
      }
      if (!stopped) await wait();
    }
  })();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      const resolve = wake;
      wake = undefined;
      resolve?.();
    },
    completed,
  };
}
