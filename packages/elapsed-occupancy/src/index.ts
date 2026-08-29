/**
 * Canonical time occupancy for replayed DLMM ranges.  An observation describes
 * the state from its timestamp up to the next observation, never an invented
 * terminal interval.  Evidence beyond the admitted collection gap is
 * deliberately unobserved rather than silently active or inactive.
 */
export const DEFAULT_EXPECTED_EVIDENCE_CADENCE_MS = 60_000;
export const DEFAULT_MAXIMUM_ADMISSIBLE_EVIDENCE_GAP_MS = 450_000;
export const DEFAULT_MINIMUM_OCCUPANCY_COVERAGE_RATIO = 0.60;

export type OccupancyState = 'COMPLETE' | 'INSUFFICIENT_EVIDENCE' | 'AMBIGUOUS';

export interface OccupancyObservation {
  observedAt: string;
  activeBinId: number;
}

export interface ElapsedOccupancy {
  requestedDurationMs: number;
  activeDurationMs: number;
  inactiveDurationMs: number;
  unobservedDurationMs: number;
  observedDurationMs: number;
  coverageRatio: number;
  /** Undefined means no attributable observed duration; it is never a fabricated zero. */
  activeRatio?: number;
  state: OccupancyState;
  reasonCodes: string[];
}

export interface DeriveElapsedOccupancyInput {
  observations: readonly OccupancyObservation[];
  lowerBinId: number;
  upperBinId: number;
  horizonStart: string;
  horizonEnd: string;
  expectedCadenceMs?: number;
  maximumAdmissibleGapMs?: number;
  minimumCoverageRatio?: number;
}

type TimedObservation = Readonly<{ timestampMs: number; activeBinId: number; inRange: boolean }>;

function timestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function empty(input: { requestedDurationMs: number; reasonCodes: string[]; state?: OccupancyState }): ElapsedOccupancy {
  return {
    requestedDurationMs: input.requestedDurationMs,
    activeDurationMs: 0,
    inactiveDurationMs: 0,
    unobservedDurationMs: input.requestedDurationMs,
    observedDurationMs: 0,
    coverageRatio: 0,
    state: input.state ?? 'INSUFFICIENT_EVIDENCE',
    reasonCodes: input.reasonCodes,
  };
}

/**
 * The deterministic duplicate rule is intentionally based on the already
 * defined inclusive range membership.  Two same-timestamp observations that
 * disagree about membership cannot describe one interval and fail closed.
 */
function sanitize(input: DeriveElapsedOccupancyInput): { observations?: TimedObservation[]; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  const values: TimedObservation[] = [];
  for (const observation of input.observations) {
    const observedAt = timestamp(observation.observedAt);
    if (observedAt === undefined || !Number.isInteger(observation.activeBinId)) {
      reasonCodes.push('OCCUPANCY_OBSERVATION_MALFORMED');
      continue;
    }
    values.push({
      timestampMs: observedAt,
      activeBinId: observation.activeBinId,
      inRange: observation.activeBinId >= input.lowerBinId && observation.activeBinId <= input.upperBinId,
    });
  }
  if (reasonCodes.length) return { reasonCodes: [...new Set(reasonCodes)].sort() };
  values.sort((a, b) => a.timestampMs - b.timestampMs || a.activeBinId - b.activeBinId);
  const deduped: TimedObservation[] = [];
  for (const value of values) {
    const prior = deduped.at(-1);
    if (!prior || prior.timestampMs !== value.timestampMs) {
      deduped.push(value);
      continue;
    }
    if (prior.activeBinId !== value.activeBinId) {
      return { reasonCodes: ['OCCUPANCY_DUPLICATE_TIMESTAMP_CONFLICT'] };
    }
    // Identical samples at the same instant have no interval distinction.
  }
  return { observations: deduped, reasonCodes };
}

export function deriveElapsedOccupancy(input: DeriveElapsedOccupancyInput): ElapsedOccupancy {
  if (!Number.isInteger(input.lowerBinId) || !Number.isInteger(input.upperBinId) || input.lowerBinId > input.upperBinId) {
    throw new Error('LPFORGE_OCCUPANCY_RANGE_INVALID');
  }
  const horizonStart = timestamp(input.horizonStart);
  const horizonEnd = timestamp(input.horizonEnd);
  if (horizonStart === undefined || horizonEnd === undefined || horizonEnd < horizonStart) {
    throw new Error('LPFORGE_OCCUPANCY_HORIZON_INVALID');
  }
  const requestedDurationMs = horizonEnd - horizonStart;
  if (requestedDurationMs === 0) return empty({ requestedDurationMs, reasonCodes: ['OCCUPANCY_ZERO_HORIZON'] });
  const maximumAdmissibleGapMs = Math.max(1, Math.floor(input.maximumAdmissibleGapMs ?? DEFAULT_MAXIMUM_ADMISSIBLE_EVIDENCE_GAP_MS));
  const minimumCoverageRatio = Math.max(0, Math.min(1, input.minimumCoverageRatio ?? DEFAULT_MINIMUM_OCCUPANCY_COVERAGE_RATIO));
  const sanitized = sanitize(input);
  if (!sanitized.observations) return empty({ requestedDurationMs, state: 'AMBIGUOUS', reasonCodes: sanitized.reasonCodes });

  // Keep the last state known at or before the requested start and every
  // later state strictly before the requested end.  A final observation has no
  // successor and is intentionally not assigned duration.
  const before = sanitized.observations.filter(observation => observation.timestampMs <= horizonStart).at(-1);
  // An observation exactly at the end still bounds the preceding interval,
  // while contributing no terminal interval of its own.
  const after = sanitized.observations.filter(observation => observation.timestampMs > horizonStart && observation.timestampMs <= horizonEnd);
  const timeline = [...(before ? [before] : []), ...after];
  let activeDurationMs = 0;
  let inactiveDurationMs = 0;
  for (let index = 0; index + 1 < timeline.length; index += 1) {
    const current = timeline[index]!;
    const next = timeline[index + 1]!;
    const coveredStart = Math.max(horizonStart, current.timestampMs);
    // A stale state only speaks for its admissible window from the actual
    // observation timestamp, not from whichever horizon happens to include it.
    const coveredEnd = Math.min(horizonEnd, next.timestampMs, current.timestampMs + maximumAdmissibleGapMs);
    const duration = Math.max(0, coveredEnd - coveredStart);
    if (current.inRange) activeDurationMs += duration;
    else inactiveDurationMs += duration;
  }
  const observedDurationMs = activeDurationMs + inactiveDurationMs;
  const unobservedDurationMs = Math.max(0, requestedDurationMs - observedDurationMs);
  const coverageRatio = observedDurationMs / requestedDurationMs;
  const state: OccupancyState = observedDurationMs > 0 && coverageRatio >= minimumCoverageRatio ? 'COMPLETE' : 'INSUFFICIENT_EVIDENCE';
  const reasonCodes = state === 'COMPLETE' ? [] : ['OCCUPANCY_COVERAGE_INSUFFICIENT'];
  return {
    requestedDurationMs,
    activeDurationMs,
    inactiveDurationMs,
    unobservedDurationMs,
    observedDurationMs,
    coverageRatio,
    ...(observedDurationMs > 0 ? { activeRatio: activeDurationMs / observedDurationMs } : {}),
    state,
    reasonCodes,
  };
}
