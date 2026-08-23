export type ForwardMaturationState = 'PENDING' | 'INSUFFICIENT_EVIDENCE' | 'FINAL' | 'FAILED_DATA_INTEGRITY';

export interface ForwardMaturationTask {
  recommendationId: string;
  horizonMinutes: number;
}

export interface ForwardMaturationTaskResult {
  state: ForwardMaturationState;
}

export interface ForwardMaturationBatchSummary {
  due: number;
  processed: number;
  finalized: number;
  insufficient: number;
  failed: number;
  persisted: number;
}

export type ForwardMaturationLogEvent = {
  event: 'FORWARD_MATURATION_DUE' | 'FORWARD_MATURATION_FINAL' | 'FORWARD_MATURATION_INSUFFICIENT' | 'FORWARD_MATURATION_FAILED' | 'FORWARD_MATURATION_PERSISTED';
  recommendationId?: string;
  horizonMinutes?: number;
  error?: string;
  due?: number;
  persisted?: boolean;
};

/** Runs only rows already identified as due by the durable store. */
export async function processDueForwardMaturations<T extends ForwardMaturationTask, R extends ForwardMaturationTaskResult>(input: {
  tasks: readonly T[];
  mature(task: T): Promise<R>;
  persist(task: T, result: R): Promise<boolean>;
  emit?(event: ForwardMaturationLogEvent): void;
}): Promise<ForwardMaturationBatchSummary> {
  const summary: ForwardMaturationBatchSummary = { due: input.tasks.length, processed: 0, finalized: 0, insufficient: 0, failed: 0, persisted: 0 };
  if (summary.due) input.emit?.({ event: 'FORWARD_MATURATION_DUE', due: summary.due });
  for (const task of input.tasks) {
    try {
      const result = await input.mature(task);
      summary.processed++;
      if (result.state === 'FINAL') {
        summary.finalized++;
        input.emit?.({ event: 'FORWARD_MATURATION_FINAL', recommendationId: task.recommendationId, horizonMinutes: task.horizonMinutes });
      } else if (result.state === 'INSUFFICIENT_EVIDENCE') {
        summary.insufficient++;
        input.emit?.({ event: 'FORWARD_MATURATION_INSUFFICIENT', recommendationId: task.recommendationId, horizonMinutes: task.horizonMinutes });
      }
      const persisted = await input.persist(task, result);
      if (persisted) summary.persisted++;
      input.emit?.({ event: 'FORWARD_MATURATION_PERSISTED', recommendationId: task.recommendationId, horizonMinutes: task.horizonMinutes, persisted });
    } catch (error) {
      summary.failed++;
      input.emit?.({ event: 'FORWARD_MATURATION_FAILED', recommendationId: task.recommendationId, horizonMinutes: task.horizonMinutes, error: error instanceof Error ? error.message : String(error) });
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
