import { canonicalJson, sha256Hex, type SwapEventFact } from '../../domain/src/index.js';
import {
  deriveCapitalConstrainedForwardPosition,
  forwardV2ValueLamports,
  type FrozenPhase3ForwardDecision,
} from '../../phase3-forward-validation/src/index.js';
import { simulateSyntheticPosition, type BinFrame, type InventorySnapshot } from '../../simulator/src/index.js';

/** This package is a downstream research recorder. It has no decision authority. */
export const POST_ENTRY_TELEMETRY_SCHEMA_VERSION = 'post-entry-state-telemetry-v2';
export const POST_ENTRY_TELEMETRY_AUTHORITY = 'RESEARCH_ONLY_NO_POLICY_MUTATION';
export const POST_ENTRY_TELEMETRY_COLLECTOR_VERSION = 'post-entry-telemetry-capture-v2';
export const POST_ENTRY_TELEMETRY_OUTCOME_MODEL_VERSION = 'phase3-forward-outcome-v2';
export const POST_ENTRY_TELEMETRY_CHECKPOINTS = [
  { key: 'DECISION', offsetMinutes: 0, observationType: 'ENTRY' as const },
  { key: 'M1', offsetMinutes: 1, observationType: 'CHECKPOINT' as const },
  { key: 'M5', offsetMinutes: 5, observationType: 'CHECKPOINT' as const },
  { key: 'M10', offsetMinutes: 10, observationType: 'CHECKPOINT' as const },
  { key: 'M15', offsetMinutes: 15, observationType: 'CHECKPOINT' as const },
  { key: 'M30', offsetMinutes: 30, observationType: 'CHECKPOINT' as const },
  { key: 'M60', offsetMinutes: 60, observationType: 'CHECKPOINT' as const },
  { key: 'M120', offsetMinutes: 120, observationType: 'CHECKPOINT' as const },
] as const;
export const POST_ENTRY_TELEMETRY_CHECKPOINT_GRACE_MS = 2 * 60_000;

export type TelemetryCheckpointStatus =
  | 'OBSERVED'
  | 'MISSED'
  | 'DELAYED'
  | 'SOURCE_UNAVAILABLE'
  | 'DUPLICATE_REJECTED'
  | 'INTEGRITY_CONFLICT';
export type TelemetryObservationType = 'ENTRY' | 'CHECKPOINT' | 'FINALIZATION';

export interface TelemetryCheckpointTask {
  telemetryEpisodeId: string;
  checkpointKey: string;
  observationType: TelemetryObservationType;
  targetAt: string;
  decisionAt: string;
  sourceVersion: string;
  frozenHeader: Record<string, unknown>;
  decisionPayload: FrozenPhase3ForwardDecision;
  /** The immutable content of the decision checkpoint, if already observed. */
  decisionCheckpointContent?: Record<string, unknown>;
  /** The immediately prior recorded checkpoint, used only for raw delta facts. */
  previousCheckpointContent?: Record<string, unknown>;
  terminalOutcomes?: Array<Record<string, unknown>>;
}

export interface TelemetryCapturePlan {
  defer: boolean;
  status?: TelemetryCheckpointStatus;
  observationType?: TelemetryObservationType;
  observedAt?: string;
  content?: Record<string, unknown>;
  reasonCodes: string[];
}

export interface TelemetryManifestInput {
  telemetryEpisodeId: string;
  sequenceNumber: number;
  observationId: string;
  observationType: TelemetryObservationType;
  observedAt?: string;
  capturedAt: string;
  sourceVersion: string;
  collectorVersion: string;
  contentHash: string;
  previousHash: string;
  captureStatus: TelemetryCheckpointStatus;
}

export interface TelemetryManifestEntry extends TelemetryManifestInput {
  currentHash: string;
}

const date = (value: string): number | undefined => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const iso = (value: number): string => new Date(value).toISOString();
const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const finite = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const raw = (value: unknown): bigint | undefined => {
  try { return typeof value === 'string' || typeof value === 'bigint' ? BigInt(value) : undefined; } catch { return undefined; }
};

export function postEntryTelemetryEpisodeId(recommendationId: string): string {
  if (!recommendationId.trim()) throw new Error('LPFORGE_TELEMETRY_RECOMMENDATION_ID_REQUIRED');
  return `post-entry-v2:${recommendationId}`;
}

export async function telemetryHeaderHash(header: Record<string, unknown>): Promise<string> {
  return sha256Hex(canonicalJson(header));
}

export async function telemetryContentHash(content: Record<string, unknown>): Promise<string> {
  return sha256Hex(canonicalJson(content));
}

export async function buildTelemetryManifestEntry(input: TelemetryManifestInput): Promise<TelemetryManifestEntry> {
  if (!Number.isSafeInteger(input.sequenceNumber) || input.sequenceNumber <= 0) throw new Error('LPFORGE_TELEMETRY_SEQUENCE_INVALID');
  for (const hash of [input.contentHash, input.previousHash]) if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error('LPFORGE_TELEMETRY_HASH_INVALID');
  const currentHash = await sha256Hex(canonicalJson({
    telemetryEpisodeId: input.telemetryEpisodeId,
    sequenceNumber: input.sequenceNumber,
    observationId: input.observationId,
    observationType: input.observationType,
    observedAt: input.observedAt ?? null,
    capturedAt: input.capturedAt,
    sourceVersion: input.sourceVersion,
    collectorVersion: input.collectorVersion,
    contentHash: input.contentHash,
    previousHash: input.previousHash,
    captureStatus: input.captureStatus,
  }));
  return { ...input, currentHash };
}

/**
 * Verifies an immutable manifest chain without consulting current market state.
 */
export async function verifyTelemetryManifestChain(input: {
  headerHash: string;
  entries: TelemetryManifestEntry[];
}): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(input.headerHash)) return false;
  let previousHash = input.headerHash;
  let expectedSequence = 1;
  for (const entry of input.entries) {
    if (entry.sequenceNumber !== expectedSequence || entry.previousHash !== previousHash) return false;
    const rebuilt = await buildTelemetryManifestEntry({
      telemetryEpisodeId: entry.telemetryEpisodeId,
      sequenceNumber: entry.sequenceNumber,
      observationId: entry.observationId,
      observationType: entry.observationType,
      ...(entry.observedAt ? { observedAt: entry.observedAt } : {}),
      capturedAt: entry.capturedAt,
      sourceVersion: entry.sourceVersion,
      collectorVersion: entry.collectorVersion,
      contentHash: entry.contentHash,
      previousHash: entry.previousHash,
      captureStatus: entry.captureStatus,
    });
    if (rebuilt.currentHash !== entry.currentHash) return false;
    previousHash = entry.currentHash;
    expectedSequence++;
  }
  return true;
}

function nearestFrame(frames: BinFrame[], target: number, beforeOnly: boolean): BinFrame | undefined {
  const candidates = frames.filter(frame => {
    const observed = date(frame.observedAt);
    return observed !== undefined && (!beforeOnly || observed <= target) && Math.abs(observed - target) <= POST_ENTRY_TELEMETRY_CHECKPOINT_GRACE_MS;
  });
  return candidates.sort((a, b) => Math.abs(date(a.observedAt)! - target) - Math.abs(date(b.observedAt)! - target) || (date(a.observedAt)! - date(b.observedAt)!))[0];
}

function nearestMarketObservation(history: { marketObservations: Array<{ observedAt: string; price: number; activeBinId?: number; tvl?: number; volume5m?: number; fee5m?: number; resolutionMs?: number }> }, target: number) {
  return history.marketObservations
    .filter(row => date(row.observedAt) !== undefined && Math.abs(date(row.observedAt)! - target) <= POST_ENTRY_TELEMETRY_CHECKPOINT_GRACE_MS)
    .sort((a, b) => Math.abs(date(a.observedAt)! - target) - Math.abs(date(b.observedAt)! - target))[0];
}

function frameFromContent(content: Record<string, unknown> | undefined): BinFrame | undefined {
  const market = object(content?.market);
  const frame = object(market?.frame);
  if (!frame || typeof frame.observedAt !== 'string' || !Number.isInteger(frame.activeBinId) || !Array.isArray(frame.bins)) return undefined;
  const bins = frame.bins.flatMap(value => {
    const bin = object(value);
    if (!bin || !Number.isInteger(bin.binId) || typeof bin.price !== 'string' || typeof bin.amountX !== 'string' || typeof bin.amountY !== 'string') return [];
    return [{ binId: Number(bin.binId), price: bin.price, amountX: bin.amountX, amountY: bin.amountY, ...(typeof bin.liquiditySupply === 'string' ? { liquiditySupply: bin.liquiditySupply } : {}) }];
  });
  return bins.length === frame.bins.length ? { observedAt: frame.observedAt, activeBinId: Number(frame.activeBinId), bins } : undefined;
}

function checkpointInventory(content: Record<string, unknown> | undefined): { tokenXRaw?: string; tokenYRaw?: string; valueLamports?: string } | undefined {
  const inventory = object(content?.inventory);
  if (!inventory) return undefined;
  const tokenXRaw = typeof inventory.tokenXRaw === 'string' ? inventory.tokenXRaw : undefined;
  const tokenYRaw = typeof inventory.tokenYRaw === 'string' ? inventory.tokenYRaw : undefined;
  const valueLamports = typeof inventory.valueLamports === 'string' ? inventory.valueLamports : undefined;
  return tokenXRaw || tokenYRaw || valueLamports ? { ...(tokenXRaw ? { tokenXRaw } : {}), ...(tokenYRaw ? { tokenYRaw } : {}), ...(valueLamports ? { valueLamports } : {}) } : undefined;
}

function rangePath(position: { lowerBinId: number; upperBinId: number }, frames: BinFrame[]) {
  const ordered = [...frames].sort((a, b) => date(a.observedAt)! - date(b.observedAt)!);
  let previousInRange: boolean | undefined;
  const crossings: Array<{ eventType: 'RANGE_ENTER' | 'RANGE_EXIT'; observedAt: string; direction?: 'LOWER' | 'UPPER' }> = [];
  let firstOutOfRangeAt: string | undefined;
  let observedOutsideDurationMs = 0;
  for (let index = 0; index < ordered.length; index++) {
    const frame = ordered[index]!;
    const inRange = frame.activeBinId >= position.lowerBinId && frame.activeBinId <= position.upperBinId;
    if (previousInRange !== undefined && previousInRange !== inRange) {
      crossings.push({ eventType: inRange ? 'RANGE_ENTER' : 'RANGE_EXIT', observedAt: frame.observedAt, ...(!inRange ? { direction: frame.activeBinId < position.lowerBinId ? 'LOWER' : 'UPPER' } : {}) });
    }
    if (!inRange && !firstOutOfRangeAt) firstOutOfRangeAt = frame.observedAt;
    const previous = ordered[index - 1];
    if (!inRange && previous) observedOutsideDurationMs += Math.max(0, date(frame.observedAt)! - date(previous.observedAt)!);
    previousInRange = inRange;
  }
  return { crossings, ...(firstOutOfRangeAt ? { firstObservedOutOfRangeAt: firstOutOfRangeAt } : {}), observedOutsideDurationMs };
}

function feeValueLamports(input: { tokenXRaw: bigint; tokenYRaw: bigint; decision: FrozenPhase3ForwardDecision }): bigint | undefined {
  return forwardV2ValueLamports(
    input.tokenXRaw,
    input.tokenYRaw,
    Number(input.decision.prediction.rawUnitValueX ?? 0),
    Number(input.decision.prediction.rawUnitValueY ?? 0),
  );
}

function checkpointEvents(input: { type: TelemetryObservationType; snapshot?: InventorySnapshot; previous?: Record<string, unknown>; rangeCrossings: Array<{ eventType: 'RANGE_ENTER' | 'RANGE_EXIT'; observedAt: string; direction?: 'LOWER' | 'UPPER' }> }): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  if (input.type === 'ENTRY') events.push({ eventType: 'ENTRY' });
  if (input.snapshot) {
    events.push({ eventType: 'PRICE_OBSERVATION', observedAt: input.snapshot.observedAt, activeBinId: input.snapshot.activeBinId });
    const previousMarket = object(input.previous?.market);
    const previousActiveBinId = previousMarket && Number.isInteger(previousMarket.activeBinId) ? Number(previousMarket.activeBinId) : undefined;
    if (previousActiveBinId !== undefined && previousActiveBinId !== input.snapshot.activeBinId) {
      events.push({ eventType: 'BIN_CHANGE', observedAt: input.snapshot.observedAt, fromActiveBinId: previousActiveBinId, toActiveBinId: input.snapshot.activeBinId });
    }
    events.push({ eventType: 'INVENTORY_OBSERVATION', observedAt: input.snapshot.observedAt });
    events.push({ eventType: 'FEE_OBSERVATION', observedAt: input.snapshot.observedAt });
  }
  return [...events, ...input.rangeCrossings];
}

function frozenCosts(decision: FrozenPhase3ForwardDecision) {
  const execution = finite(decision.prediction.expectedExecutionCost) ?? 0;
  const reposition = finite(decision.prediction.expectedRepositionCost) ?? 0;
  const tail = finite(decision.prediction.expectedTailRiskCost) ?? 0;
  return { execution, reposition, tail, total: execution + reposition + tail };
}

/**
 * Builds one raw checkpoint. It never interpolates market data and deliberately
 * emits SOURCE_UNAVAILABLE instead of manufacturing a position state.
 */
export function planPostEntryTelemetryCheckpoint(input: {
  task: TelemetryCheckpointTask;
  history: {
    marketObservations: Array<{ observedAt: string; price: number; activeBinId?: number; tvl?: number; volume5m?: number; fee5m?: number; resolutionMs?: number }>;
    binFrames: BinFrame[];
    swapEvents: SwapEventFact[];
  };
  capturedAt: string;
}): TelemetryCapturePlan {
  const target = date(input.task.targetAt);
  const captured = date(input.capturedAt);
  if (target === undefined || captured === undefined) throw new Error('LPFORGE_TELEMETRY_TIME_INVALID');
  if (input.task.observationType === 'FINALIZATION') {
    return {
      defer: false,
      status: 'OBSERVED',
      observationType: 'FINALIZATION',
      observedAt: input.capturedAt,
      reasonCodes: [],
      content: {
        authority: POST_ENTRY_TELEMETRY_AUTHORITY,
        telemetrySchemaVersion: POST_ENTRY_TELEMETRY_SCHEMA_VERSION,
        eventFacts: [{ eventType: 'FINALIZATION', observedAt: input.capturedAt }],
        terminalOutcomes: input.task.terminalOutcomes ?? [],
        sourceAvailability: 'TERMINAL_FORWARD_OUTCOME_LEDGER',
      },
    };
  }
  const decisionTime = date(input.task.decisionAt);
  if (decisionTime === undefined) throw new Error('LPFORGE_TELEMETRY_DECISION_TIME_INVALID');
  const isDecision = input.task.checkpointKey === 'DECISION';
  const frame = nearestFrame(input.history.binFrames, target, isDecision);
  if (!frame && captured < target + POST_ENTRY_TELEMETRY_CHECKPOINT_GRACE_MS) return { defer: true, reasonCodes: ['TELEMETRY_CHECKPOINT_WAITING_FOR_SOURCE'] };
  const market = nearestMarketObservation(input.history, target);
  if (!frame) {
    return {
      defer: false,
      status: 'SOURCE_UNAVAILABLE',
      observationType: input.task.observationType,
      reasonCodes: ['TELEMETRY_BIN_FRAME_UNAVAILABLE_NO_INTERPOLATION'],
      content: {
        authority: POST_ENTRY_TELEMETRY_AUTHORITY,
        telemetrySchemaVersion: POST_ENTRY_TELEMETRY_SCHEMA_VERSION,
        checkpoint: { key: input.task.checkpointKey, targetAt: input.task.targetAt, noInterpolation: true },
        market: { ...(market ? { marketObservation: market } : {}), frame: null },
        position: { availability: 'SOURCE_UNAVAILABLE' },
        eventFacts: [],
      },
    };
  }
  const baseline = isDecision ? frame : frameFromContent(input.task.decisionCheckpointContent);
  const status: TelemetryCheckpointStatus = Math.abs(date(frame.observedAt)! - target) <= 60_000 ? 'OBSERVED' : 'DELAYED';
  if (!baseline) {
    return {
      defer: false,
      status: 'SOURCE_UNAVAILABLE',
      observationType: input.task.observationType,
      observedAt: frame.observedAt,
      reasonCodes: ['TELEMETRY_FROZEN_BASELINE_UNAVAILABLE_NO_INTERPOLATION'],
      content: {
        authority: POST_ENTRY_TELEMETRY_AUTHORITY,
        telemetrySchemaVersion: POST_ENTRY_TELEMETRY_SCHEMA_VERSION,
        checkpoint: { key: input.task.checkpointKey, targetAt: input.task.targetAt, noInterpolation: true },
        market: { ...(market ? { marketObservation: market } : {}), frame },
        position: { availability: 'FROZEN_POSITION_UNAVAILABLE', reasonCodes: ['TELEMETRY_FROZEN_BASELINE_UNAVAILABLE_NO_INTERPOLATION'] },
        eventFacts: [],
      },
    };
  }
  const decision = input.task.decisionPayload;
  const candidate = decision.selectedCandidate;
  const common = {
    authority: POST_ENTRY_TELEMETRY_AUTHORITY,
    telemetrySchemaVersion: POST_ENTRY_TELEMETRY_SCHEMA_VERSION,
    checkpoint: { key: input.task.checkpointKey, targetAt: input.task.targetAt, noInterpolation: true },
    market: { ...(market ? { marketObservation: market } : {}), frame },
  };
  if (!candidate) {
    return {
      defer: false,
      status,
      observationType: input.task.observationType,
      observedAt: frame.observedAt,
      reasonCodes: ['FROZEN_POSITION_UNAVAILABLE'],
      content: {
        ...common,
        position: { availability: 'FROZEN_POSITION_UNAVAILABLE', selectedCandidateKind: decision.selectedCandidateKind },
        eventFacts: input.task.observationType === 'ENTRY' ? [{ eventType: 'ENTRY', shadowPosition: true }] : [{ eventType: 'PRICE_OBSERVATION', observedAt: frame.observedAt, activeBinId: frame.activeBinId }],
      },
    };
  }
  const constrained = deriveCapitalConstrainedForwardPosition({ decision, candidate, baseline });
  if (!constrained.position) {
    return {
      defer: false,
      status,
      observationType: input.task.observationType,
      observedAt: frame.observedAt,
      reasonCodes: constrained.reasonCodes ?? ['FROZEN_POSITION_UNAVAILABLE'],
      content: {
        ...common,
        position: { availability: 'FROZEN_POSITION_UNAVAILABLE', reasonCodes: constrained.reasonCodes ?? [] },
        eventFacts: [],
      },
    };
  }
  const windowFrames = input.history.binFrames.filter(value => {
    const observed = date(value.observedAt);
    return observed !== undefined && observed >= date(baseline.observedAt)! && observed <= date(frame.observedAt)!;
  });
  const simulationFrames = [baseline, ...windowFrames.filter(value => value.observedAt !== baseline.observedAt)];
  const events = input.history.swapEvents.filter(event => {
    const observed = date(event.stamp.observedAt);
    return observed !== undefined && observed > decisionTime && observed <= date(frame.observedAt)!;
  });
  const simulation = simulateSyntheticPosition({ position: constrained.position.position, frames: simulationFrames, events, horizonEnd: frame.observedAt });
  const snapshot = simulation.inventory.at(-1)!;
  const baselineSnapshot = simulation.inventory[0]!;
  const inventoryValue = feeValueLamports({ tokenXRaw: snapshot.tokenXRaw, tokenYRaw: snapshot.tokenYRaw, decision });
  const baselineValue = feeValueLamports({ tokenXRaw: baselineSnapshot.tokenXRaw, tokenYRaw: baselineSnapshot.tokenYRaw, decision });
  const feeValue = feeValueLamports({ tokenXRaw: simulation.totalAttributedFeeXRaw, tokenYRaw: simulation.totalAttributedFeeYRaw, decision });
  const priorInventory = checkpointInventory(input.task.previousCheckpointContent);
  const previousValue = raw(priorInventory?.valueLamports);
  const costs = frozenCosts(decision);
  const range = rangePath(constrained.position.position, simulationFrames);
  const inventory = {
    tokenXRaw: snapshot.tokenXRaw.toString(),
    tokenYRaw: snapshot.tokenYRaw.toString(),
    ...(inventoryValue !== undefined ? { valueLamports: inventoryValue.toString() } : { valueLamports: null, valuationStatus: 'PRECISION_UNAVAILABLE' }),
    ...(inventoryValue !== undefined && baselineValue !== undefined ? { deltaFromEntryLamports: (inventoryValue - baselineValue).toString() } : { deltaFromEntryLamports: null }),
    ...(inventoryValue !== undefined && previousValue !== undefined ? { deltaFromPreviousCheckpointLamports: (inventoryValue - previousValue).toString() } : { deltaFromPreviousCheckpointLamports: null }),
  };
  const netPositionValueLamports = inventoryValue !== undefined && feeValue !== undefined
    ? inventoryValue + feeValue - BigInt(Math.round(costs.total * 1_000_000_000))
    : undefined;
  const eventsFacts = checkpointEvents({ type: input.task.observationType, snapshot, ...(input.task.previousCheckpointContent ? { previous: input.task.previousCheckpointContent } : {}), rangeCrossings: range.crossings });
  return {
    defer: false,
    status,
    observationType: input.task.observationType,
    observedAt: frame.observedAt,
    reasonCodes: [],
    content: {
      ...common,
      position: {
        availability: 'AVAILABLE_FOR_RESEARCH_REPLAY',
        lowerBinId: constrained.position.position.lowerBinId,
        upperBinId: constrained.position.position.upperBinId,
        binParticipation: constrained.position.bins,
        frozenCapitalLamports: constrained.position.frozenCapitalLamports.toString(),
        allocatedCapitalLamports: constrained.position.allocatedCapitalLamports.toString(),
        derivedPositionValueLamports: constrained.position.derivedPositionValueLamports.toString(),
        maxEffectiveOwnershipBps: constrained.position.maxEffectiveOwnershipBps,
      },
      range: {
        currentBinId: snapshot.activeBinId,
        lowerBoundaryBinId: constrained.position.position.lowerBinId,
        upperBoundaryBinId: constrained.position.position.upperBinId,
        inRange: snapshot.inRange,
        distanceToLowerBoundaryBins: snapshot.activeBinId - constrained.position.position.lowerBinId,
        distanceToUpperBoundaryBins: constrained.position.position.upperBinId - snapshot.activeBinId,
        ...(snapshot.inRange ? {} : { outOfRangeDirection: snapshot.activeBinId < constrained.position.position.lowerBinId ? 'LOWER' : 'UPPER' }),
        activeBinDistance: snapshot.activeBinDistance,
        observedOutsideDurationMs: range.observedOutsideDurationMs,
        ...(range.firstObservedOutOfRangeAt ? { firstObservedOutOfRangeAt: range.firstObservedOutOfRangeAt } : {}),
        crossings: range.crossings,
        coveredBins: snapshot.coveredBins,
        missingBins: snapshot.missingBins,
      },
      inventory: {
        ...inventory,
        tokenXMint: object(input.task.frozenHeader.provenance)?.tokenXMint ?? null,
        tokenYMint: object(input.task.frozenHeader.provenance)?.tokenYMint ?? null,
        tokenXDecimals: object(input.task.frozenHeader.provenance)?.tokenXDecimals ?? null,
        tokenYDecimals: object(input.task.frozenHeader.provenance)?.tokenYDecimals ?? null,
      },
      fees: {
        cumulativeAttributedFeeXRaw: simulation.totalAttributedFeeXRaw.toString(),
        cumulativeAttributedFeeYRaw: simulation.totalAttributedFeeYRaw.toString(),
        ...(feeValue !== undefined ? { feeValueLamports: feeValue.toString() } : { feeValueLamports: null, valuationStatus: 'PRECISION_UNAVAILABLE' }),
        attributionMethod: 'SWAP2EVT_MM_FEE_PATH_ALLOCATED',
        attributionVersion: 'simulator-event-path-v1',
        attributions: simulation.feeAttribution.map(value => ({ ...value, mmFeeRaw: value.mmFeeRaw.toString(), attributedLpFeeRaw: value.attributedLpFeeRaw.toString() })),
      },
      economics: {
        grossPositionValueLamports: inventory.valueLamports,
        feeContributionLamports: feeValue?.toString() ?? null,
        inventoryContributionLamports: inventory.deltaFromEntryLamports,
        frozenCosts: costs,
        realizedCosts: null,
        ...(netPositionValueLamports !== undefined ? { netPositionValueLamports: netPositionValueLamports.toString() } : { netPositionValueLamports: null }),
        calculationVersion: 'post-entry-telemetry-v2',
      },
      rawEvents: events,
      eventFacts: eventsFacts,
      valuation: object(input.task.frozenHeader.valuationContract) ?? { availability: 'FROZEN_VALUATION_CONTRACT_UNAVAILABLE' },
    },
  };
}
