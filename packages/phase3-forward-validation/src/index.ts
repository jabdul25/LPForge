import { canonicalJson, sha256Hex, type SwapEventFact } from '../../domain/src/index.js';
import { deriveSyntheticPositionShareRaw, simulateCandidateEconomics, type CandidateEconomicSimulation } from '../../candidate-simulator/src/index.js';
import type { ShadowRecommendation } from '../../shadow/src/index.js';
import type { BinFrame } from '../../simulator/src/index.js';

export const PHASE3_FORWARD_OUTCOME_MODEL_VERSION = 'phase3-forward-outcome-v1';
export const PHASE3_FORWARD_HORIZONS_MINUTES = [30, 60, 120] as const;
export type ForwardOutcomeState = 'PENDING' | 'INSUFFICIENT_EVIDENCE' | 'FINAL' | 'FAILED_DATA_INTEGRITY';

export interface RuntimeArtifactProvenance {
  sourceSha: string;
  buildId: string;
  policyHash: string;
  migrationHead: string;
}

export interface FrozenPhase3ForwardDecision {
  recommendationId: string;
  decisionId: string;
  poolAddress: string;
  decisionTimestamp: string;
  sourceSha: string;
  buildId: string;
  policyHash: string;
  migrationHead: string;
  capitalLamports: string;
  phase3State: string;
  phase3Outcome: 'NO_TRADE' | 'WATCHING' | 'ENTRY_READY';
  reasonCodes: string[];
  prediction: Record<string, unknown>;
  evidenceProvenance: Record<string, unknown>;
  selectedCandidate?: ShadowRecommendation['forwardValidation']['selectedCandidate'];
  selectedSimulation?: CandidateEconomicSimulation;
  selectedSurvival?: ShadowRecommendation['forwardValidation']['selectedSurvival'];
  selectedCandidateKind: ShadowRecommendation['forwardValidation']['selectedCandidateKind'];
  wouldAugEraThesisSemanticsHaveCreatedThesis: boolean;
}

function copy<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function requireArtifact(value: RuntimeArtifactProvenance): void {
  if (!/^[0-9a-f]{40}$/i.test(value.sourceSha) || !/^[0-9a-f]{64}$/i.test(value.buildId) || !/^[0-9a-f]{64}$/i.test(value.policyHash) || !/^M\d{4}_.+\.sql$/.test(value.migrationHead)) {
    throw new Error('LPFORGE_FORWARD_ARTIFACT_PROVENANCE_INVALID');
  }
}

/**
 * Snapshot only facts already computed at decision time.  This has no import
 * path into Phase 3, Phase 4, P7, discovery ranking, or execution.
 */
export function freezePhase3ForwardDecision(input: { recommendation: ShadowRecommendation; artifact: RuntimeArtifactProvenance }): FrozenPhase3ForwardDecision {
  requireArtifact(input.artifact);
  const recommendation = input.recommendation;
  const forward = recommendation.forwardValidation;
  const outcome: FrozenPhase3ForwardDecision['phase3Outcome'] = recommendation.thesis ? 'ENTRY_READY' : recommendation.state === 'WATCHING' ? 'WATCHING' : 'NO_TRADE';
  return copy({
    recommendationId: recommendation.recommendationId,
    decisionId: `phase3-forward:${recommendation.recommendationId}`,
    poolAddress: recommendation.pool,
    decisionTimestamp: recommendation.decisionAt,
    ...input.artifact,
    capitalLamports: forward.capitalLamports,
    phase3State: recommendation.state,
    phase3Outcome: outcome,
    reasonCodes: recommendation.reasonCodes,
    prediction: {
      expectedFeeValue: recommendation.economics.expectedFeeValue,
      expectedInventoryPnl: recommendation.economics.expectedInventoryPnl,
      expectedExecutionCost: recommendation.economics.expectedExecutionCost,
      expectedRepositionCost: recommendation.economics.expectedRepositionCost,
      expectedTailRiskCost: recommendation.economics.expectedTailRiskCharge,
      expectedNetEv: recommendation.economics.expectedNetLpValue,
      expectedActiveTimeRatio: recommendation.economics.expectedActiveTimeRatio,
      predictedSurvivalProbability: forward.selectedSurvival?.survivalProbability ?? null,
      forecastUncertainty: recommendation.economics.forecastUncertainty,
      transitionRisk: recommendation.regime.transitionRisk,
      evidenceFidelity: recommendation.economics.evidenceFidelity,
      evidenceActionable: forward.selectedSimulation?.evidenceActionable ?? false,
      normalizationScale: forward.selectedSimulation?.normalizationScale ?? 0,
      candidateUtility: recommendation.ranking.rankings.find(row => row.candidateId === forward.selectedCandidate?.id)?.utility ?? null,
      candidateSimulation: forward.selectedSimulation ?? null,
      frozenSimulationCosts: forward.costs,
      rawUnitValueX: forward.rawUnitValueX,
      rawUnitValueY: forward.rawUnitValueY,
      activeBinIdAtDecision: forward.activeBinIdAtDecision,
      uncertaintyLineage: recommendation.uncertaintyLineage,
    },
    evidenceProvenance: {
      ...forward.evidence,
      activeBinIdAtDecision: forward.activeBinIdAtDecision,
      decisionTimestamp: recommendation.decisionAt,
      latestObservationTimestampAllowedAtDecision: recommendation.decisionAt,
      marketContextHash: recommendation.marketContextHash,
      rawUnitValueX: forward.rawUnitValueX,
      rawUnitValueY: forward.rawUnitValueY,
    },
    ...(forward.selectedCandidate ? { selectedCandidate: forward.selectedCandidate } : {}),
    ...(forward.selectedSimulation ? { selectedSimulation: forward.selectedSimulation } : {}),
    ...(forward.selectedSurvival ? { selectedSurvival: forward.selectedSurvival } : {}),
    selectedCandidateKind: forward.selectedCandidateKind,
    wouldAugEraThesisSemanticsHaveCreatedThesis: forward.wouldAugEraThesisSemanticsHaveCreatedThesis,
  });
}

export function phase3ForwardDecisionStoreValue(decision: FrozenPhase3ForwardDecision): {
  recommendationId:string;decisionId:string;poolAddress:string;decisionAt:string;sourceSha:string;buildId:string;policyHash:string;migrationHead:string;capitalLamports:string;selectedCandidateKind:'RANKING_WINNER'|'TOP_RANKED_COUNTERFACTUAL'|'NONE';activeBinIdAtDecision:number;strategy?:string;orientation?:string;rangeFamily?:string;lowerBinId?:number;upperBinId?:number;includedBinCount?:number;candidateWeights:Array<{binId:number;weight:number}>;prediction:Record<string,unknown>;evidenceProvenance:Record<string,unknown>;phase3State:string;phase3Outcome:'NO_TRADE'|'WATCHING'|'ENTRY_READY';reasonCodes:string[];wouldAugEraThesisSemanticsHaveCreatedThesis:boolean;payload:Record<string,unknown>;
} {
  const candidate=decision.selectedCandidate;
  return {
    recommendationId:decision.recommendationId,decisionId:decision.decisionId,poolAddress:decision.poolAddress,decisionAt:decision.decisionTimestamp,sourceSha:decision.sourceSha,buildId:decision.buildId,policyHash:decision.policyHash,migrationHead:decision.migrationHead,capitalLamports:decision.capitalLamports,selectedCandidateKind:decision.selectedCandidateKind,activeBinIdAtDecision:Number((decision.evidenceProvenance.activeBinIdAtDecision ?? candidate?.centerBinId ?? 0)),...(candidate?{strategy:candidate.strategy,orientation:candidate.orientation,rangeFamily:candidate.family,lowerBinId:candidate.lowerBinId,upperBinId:candidate.upperBinId,includedBinCount:candidate.widthBins,candidateWeights:candidate.perBinWeights.map(weight=>({binId:weight.binId,weight:weight.weight}))}:{candidateWeights:[]}),prediction:decision.prediction,evidenceProvenance:decision.evidenceProvenance,phase3State:decision.phase3State,phase3Outcome:decision.phase3Outcome,reasonCodes:decision.reasonCodes,wouldAugEraThesisSemanticsHaveCreatedThesis:decision.wouldAugEraThesisSemanticsHaveCreatedThesis,payload:decision as unknown as Record<string,unknown>,
  };
}

export interface Phase3ForwardOutcome {
  recommendationId: string;
  horizonMinutes: (typeof PHASE3_FORWARD_HORIZONS_MINUTES)[number];
  outcomeModelVersion: typeof PHASE3_FORWARD_OUTCOME_MODEL_VERSION;
  state: ForwardOutcomeState;
  evidenceHash?: string;
  reasonCodes: string[];
  realized?: {
    realizedFeeValue: number;
    realizedInventoryPnl: number;
    realizedExecutionCost: number;
    realizedRepositionCost: number;
    realizedTailRiskCost: number;
    realizedTotalCost: number;
    realizedNetValue: number;
    activeDurationMs: number;
    inactiveDurationMs: number;
    unobservedDurationMs: number;
    coverageRatio: number;
    activeRatio?: number;
    rangeSurvived: boolean;
    firstOutOfRangeTimestamp?: string;
  };
}

function inWindow(timestamp: string, start: number, end: number): boolean {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) && value > start && value <= end;
}

/**
 * Mature one frozen geometry.  No RangeForge generation or candidate ranking
 * occurs here: later source changes cannot alter this historical outcome.
 */
export async function matureFrozenPhase3ForwardOutcome(input: {
  decision: FrozenPhase3ForwardDecision;
  horizonMinutes: (typeof PHASE3_FORWARD_HORIZONS_MINUTES)[number];
  frames: BinFrame[];
  events: SwapEventFact[];
  now: string;
}): Promise<Phase3ForwardOutcome> {
  const horizon = input.horizonMinutes;
  const start = Date.parse(input.decision.decisionTimestamp);
  const now = Date.parse(input.now);
  if (!Number.isFinite(start) || !Number.isFinite(now)) throw new Error('LPFORGE_FORWARD_MATURATION_TIME_INVALID');
  const end = start + horizon * 60_000;
  if (now < end) return { recommendationId: input.decision.recommendationId, horizonMinutes: horizon, outcomeModelVersion: PHASE3_FORWARD_OUTCOME_MODEL_VERSION, state: 'PENDING', reasonCodes: ['FORWARD_HORIZON_NOT_DUE'] };
  const candidate = input.decision.selectedCandidate;
  if (!candidate) return { recommendationId: input.decision.recommendationId, horizonMinutes: horizon, outcomeModelVersion: PHASE3_FORWARD_OUTCOME_MODEL_VERSION, state: 'INSUFFICIENT_EVIDENCE', reasonCodes: ['FORWARD_FROZEN_CANDIDATE_UNAVAILABLE'] };
  const orderedFrames = [...input.frames].filter(frame => Number.isFinite(Date.parse(frame.observedAt))).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const baseline = orderedFrames.filter(frame => Date.parse(frame.observedAt) <= start).at(-1);
  const futureFrames = orderedFrames.filter(frame => inWindow(frame.observedAt, start, end));
  if (!baseline || !futureFrames.length) return { recommendationId: input.decision.recommendationId, horizonMinutes: horizon, outcomeModelVersion: PHASE3_FORWARD_OUTCOME_MODEL_VERSION, state: 'INSUFFICIENT_EVIDENCE', reasonCodes: ['FORWARD_FUTURE_FRAME_COVERAGE_INSUFFICIENT'] };
  const frames = [baseline, ...futureFrames];
  const events = input.events.filter(event => inWindow(event.stamp.observedAt, start, end));
  const evidenceHash = await sha256Hex(canonicalJson({ recommendationId: input.decision.recommendationId, horizon, frames, events }));
  // The frozen cost contract is stored in the recommendation payload's
  // selected simulation and global prediction.  Reconstruct its exact three
  // economic components rather than consulting a current policy.
  const prediction = input.decision.prediction;
  const execution = Number(prediction.expectedExecutionCost ?? 0);
  const reposition = Number(prediction.expectedRepositionCost ?? 0);
  const tail = Number(prediction.expectedTailRiskCost ?? 0);
  const simulation = simulateCandidateEconomics({
    candidate,
    pool: input.decision.poolAddress,
    frames,
    events,
    totalPositionShareRaw: deriveSyntheticPositionShareRaw(baseline),
    rawUnitValueX: Number(input.decision.prediction.rawUnitValueX ?? 0),
    rawUnitValueY: Number(input.decision.prediction.rawUnitValueY ?? 0),
    capitalValue: Number(input.decision.capitalLamports) / 1_000_000_000,
    costs: { transactionFeeValue: String(Math.max(0, execution + reposition + tail)) },
    rebaseCandidateToFirstFrame: false,
    horizonEnd: new Date(end).toISOString(),
  });
  if (!simulation.unitScaleValid || simulation.occupancyState !== 'COMPLETE' || simulation.warnings.includes('CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT')) {
    return { recommendationId: input.decision.recommendationId, horizonMinutes: horizon, outcomeModelVersion: PHASE3_FORWARD_OUTCOME_MODEL_VERSION, state: 'INSUFFICIENT_EVIDENCE', evidenceHash, reasonCodes: [...new Set(['FORWARD_FUTURE_EVIDENCE_INSUFFICIENT', ...simulation.warnings])].sort() };
  }
  const realizedTotalCost = execution + reposition + tail;
  return {
    recommendationId: input.decision.recommendationId,
    horizonMinutes: horizon,
    outcomeModelVersion: PHASE3_FORWARD_OUTCOME_MODEL_VERSION,
    state: 'FINAL',
    evidenceHash,
    reasonCodes: [],
    realized: {
      realizedFeeValue: simulation.feeValue,
      realizedInventoryPnl: simulation.inventoryChangeValue,
      realizedExecutionCost: execution,
      realizedRepositionCost: reposition,
      realizedTailRiskCost: tail,
      realizedTotalCost,
      realizedNetValue: simulation.feeValue + simulation.inventoryChangeValue - realizedTotalCost,
      activeDurationMs: simulation.activeDurationMs,
      inactiveDurationMs: simulation.inactiveDurationMs,
      unobservedDurationMs: simulation.unobservedDurationMs,
      coverageRatio: simulation.occupancyCoverageRatio,
      ...(simulation.activeTimeRatio === undefined ? {} : { activeRatio: simulation.activeTimeRatio }),
      rangeSurvived: !simulation.firstOutOfRangeAt,
      ...(simulation.firstOutOfRangeAt ? { firstOutOfRangeTimestamp: simulation.firstOutOfRangeAt } : {}),
    },
  };
}

export interface CalibrationRow {
  decision: FrozenPhase3ForwardDecision;
  outcome: Phase3ForwardOutcome;
}

const evBucket = (value: number): string => value < -0.0001 ? '< -100 µSOL' : value < -0.000075 ? '-100 to -75 µSOL' : value < -0.00005 ? '-75 to -50 µSOL' : value < -0.000025 ? '-50 to -25 µSOL' : value < 0 ? '-25 to 0 µSOL' : value < .000025 ? '0 to +25 µSOL' : value < .00005 ? '+25 to +50 µSOL' : value < .0001 ? '+50 to +100 µSOL' : '> +100 µSOL';
const uncertaintyBucket = (value: number): string => value <= .55 ? '<= 0.55' : value <= .60 ? '0.55–0.60' : value <= .65 ? '0.60–0.65' : value <= .70 ? '0.65–0.70' : value <= .75 ? '0.70–0.75' : value <= .80 ? '0.75–0.80' : value <= .90 ? '0.80–0.90' : '> 0.90';
const median = (values: number[]): number | null => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const i = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[i]! : (sorted[i - 1]! + sorted[i]!) / 2; };

export function buildPhase3ForwardCalibration(rows: CalibrationRow[]): { summary: Record<string, number>; evBuckets: Record<string, Record<string, number | null>>; uncertaintyBuckets: Record<string, Record<string, number | null>> } {
  const final = rows.filter(row => row.outcome.state === 'FINAL' && row.outcome.realized);
  const summarize = (group: CalibrationRow[]) => {
    const predicted = group.map(row => Number(row.decision.prediction.expectedNetEv));
    const realized = group.map(row => row.outcome.realized!.realizedNetValue);
    const falsePositive = group.filter((row, index) => predicted[index]! > 0 && realized[index]! <= 0).length;
    const falseNegative = group.filter((row, index) => predicted[index]! <= 0 && realized[index]! > 0).length;
    return { count: group.length, medianPredictedEv: median(predicted), meanRealizedEv: realized.length ? realized.reduce((a, b) => a + b, 0) / realized.length : null, medianRealizedEv: median(realized), realizedPositiveRate: realized.length ? realized.filter(value => value > 0).length / realized.length : null, falsePositiveRate: group.length ? falsePositive / group.length : null, falseNegativeRate: group.length ? falseNegative / group.length : null };
  };
  const by = (key: (row: CalibrationRow) => string) => Object.fromEntries([...new Set(final.map(key))].sort().map(label => [label, summarize(final.filter(row => key(row) === label))]));
  const negativeNegative = final.filter(row => Number(row.decision.prediction.expectedNetEv) <= 0 && row.outcome.realized!.realizedNetValue <= 0).length;
  const negativePositive = final.filter(row => Number(row.decision.prediction.expectedNetEv) <= 0 && row.outcome.realized!.realizedNetValue > 0).length;
  const positivePositive = final.filter(row => Number(row.decision.prediction.expectedNetEv) > 0 && row.outcome.realized!.realizedNetValue > 0).length;
  const positiveNegative = final.filter(row => Number(row.decision.prediction.expectedNetEv) > 0 && row.outcome.realized!.realizedNetValue <= 0).length;
  return { summary: { predictions: rows.length, final: final.length, insufficientEvidence: rows.filter(row => row.outcome.state === 'INSUFFICIENT_EVIDENCE').length, predictedNegativeRealizedNegative: negativeNegative, predictedNegativeRealizedPositive: negativePositive, predictedPositiveRealizedPositive: positivePositive, predictedPositiveRealizedNegative: positiveNegative }, evBuckets: by(row => evBucket(Number(row.decision.prediction.expectedNetEv))), uncertaintyBuckets: by(row => uncertaintyBucket(Number(row.decision.prediction.forecastUncertainty))) };
}
