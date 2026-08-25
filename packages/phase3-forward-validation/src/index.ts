import { canonicalJson, sha256Hex, type SwapEventFact } from '../../domain/src/index.js';
import { deriveSyntheticPositionShareRaw, simulateCandidateEconomics, type CandidateEconomicSimulation } from '../../candidate-simulator/src/index.js';
import type { ShadowRecommendation } from '../../shadow/src/index.js';
import { simulateSyntheticPosition, type BinFrame, type SyntheticBinShare, type SyntheticPosition } from '../../simulator/src/index.js';

export const PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V1 = 'phase3-forward-outcome-v1';
export const PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2 = 'phase3-forward-outcome-v2';
/** Compatibility alias: callers without an explicit version retain immutable V1 semantics. */
export const PHASE3_FORWARD_OUTCOME_MODEL_VERSION = PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V1;
export const PHASE3_FORWARD_OUTCOME_MODEL_VERSIONS = [PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V1, PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2] as const;
export const PHASE3_FORWARD_HORIZONS_MINUTES = [30, 60, 120] as const;
export type ForwardOutcomeState = 'PENDING' | 'INSUFFICIENT_EVIDENCE' | 'FINAL' | 'FAILED_DATA_INTEGRITY';

export interface RuntimeArtifactProvenance {
  sourceSha: string;
  buildId: string;
  policyHash: string;
  migrationHead: string;
}

export interface FrozenPhase4ForwardSnapshot {
  result:string;
  readinessScore:number|null;
  timingConfidence:number|null;
  reasonCodes:string[];
  diagnostics:Record<string,unknown>;
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
  poolQualityShadow?: ShadowRecommendation['forwardValidation']['poolQualityShadow'];
  phase4: FrozenPhase4ForwardSnapshot;
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
export function freezePhase3ForwardDecision(input: { recommendation: ShadowRecommendation; artifact: RuntimeArtifactProvenance; phase4?: FrozenPhase4ForwardSnapshot }): FrozenPhase3ForwardDecision {
  requireArtifact(input.artifact);
  const recommendation = input.recommendation;
  const forward = recommendation.forwardValidation;
  // Older frozen-fixture callers predate the qualification record. Retain
  // their global-primary interpretation; new runtime records always carry it.
  const qualification=recommendation.qualification??{policyId:'global-primary-v1' as const,economicAuthority:'GLOBAL_PRIMARY' as const,globalExpectedNetEV:recommendation.economics.expectedNetLpValue,globalAdjustmentWeight:0,globalRiskAdjustment:0,riskAdjustedExpectedNetEV:recommendation.economics.expectedNetLpValue,uncertaintyAuthority:'HARD_VETO' as const,hardBlockReasons:[],softRiskReasons:[]};
  const candidateSimulation=forward.selectedSimulation;
  const thesisEconomics=recommendation.thesis?.expectedEconomics;
  const candidatePrimary=qualification.economicAuthority==='CANDIDATE_PRIMARY';
  const candidateExpectedFeeValue=thesisEconomics?.candidateExpectedFees??candidateSimulation?.feeValue??recommendation.economics.expectedFeeValue;
  const candidateExpectedInventoryPnl=thesisEconomics?.candidateExpectedInventoryPnl??candidateSimulation?.inventoryChangeValue??recommendation.economics.expectedInventoryPnl;
  const candidateExecutionCosts=thesisEconomics?.candidateExecutionCosts??candidateSimulation?.totalCostValue??recommendation.economics.expectedExecutionCost;
  const candidateRepositionCosts=thesisEconomics?.candidateRepositionCosts??0;
  const phase4=input.phase4??{result:'NOT_EVALUATED',readinessScore:null,timingConfidence:null,reasonCodes:[],diagnostics:{}};
  const candidateTailCosts=thesisEconomics?.candidateTailCosts??0;
  const outcome: FrozenPhase3ForwardDecision['phase3Outcome'] = recommendation.thesis ? 'ENTRY_READY' : recommendation.state === 'WATCHING' ? 'WATCHING' : 'NO_TRADE';
  return copy({
    recommendationId: recommendation.recommendationId,
    decisionId: `phase3-forward:${recommendation.recommendationId}`,
    poolAddress: recommendation.pool,
    decisionTimestamp: recommendation.decisionAt,
    ...input.artifact,
    capitalLamports: forward.capitalLamports,
    phase4,
    ...(forward.poolQualityShadow?{poolQualityShadow:forward.poolQualityShadow}:{}),
    phase3State: recommendation.state,
    phase3Outcome: outcome,
    reasonCodes: recommendation.reasonCodes,
    prediction: {
      expectedFeeValue: candidatePrimary?candidateExpectedFeeValue:recommendation.economics.expectedFeeValue,
      expectedInventoryPnl: candidatePrimary?candidateExpectedInventoryPnl:recommendation.economics.expectedInventoryPnl,
      expectedExecutionCost: candidatePrimary?candidateExecutionCosts:recommendation.economics.expectedExecutionCost,
      expectedRepositionCost: candidatePrimary?candidateRepositionCosts:recommendation.economics.expectedRepositionCost,
      expectedTailRiskCost: candidatePrimary?candidateTailCosts:recommendation.economics.expectedTailRiskCharge,
      // expectedNetEv is the decision's actual policy authority. Raw global
      // and candidate values are retained separately for later calibration.
      expectedNetEv: recommendation.thesis?.expectedEconomics?.netLpValue ?? qualification.riskAdjustedExpectedNetEV ?? recommendation.economics.expectedNetLpValue,
      qualificationPolicy: qualification.policyId,
      economicAuthority: qualification.economicAuthority,
      candidateExpectedFeeValue,
      candidateExpectedInventoryPnl,
      candidateExecutionCosts,
      candidateRepositionCosts,
      candidateTailCosts,
      candidateExpectedNetEV: qualification.candidateExpectedNetEV ?? candidateSimulation?.netValue ?? null,
      globalExpectedNetEV: qualification.globalExpectedNetEV,
      globalAdjustmentWeight: qualification.globalAdjustmentWeight,
      globalRiskAdjustment: qualification.globalRiskAdjustment ?? null,
      riskAdjustedExpectedNetEV: qualification.riskAdjustedExpectedNetEV ?? null,
      uncertaintyAuthority: qualification.uncertaintyAuthority,
      hardBlockReasons: qualification.hardBlockReasons,
      softRiskReasons: qualification.softRiskReasons,
      expectedActiveTimeRatio: recommendation.economics.expectedActiveTimeRatio,
      predictedSurvivalProbability: forward.selectedSurvival?.survivalProbability ?? null,
      forecastUncertainty: recommendation.economics.forecastUncertainty,
      transitionRisk: recommendation.regime?.transitionRisk ?? null,
      evidenceFidelity: recommendation.economics.evidenceFidelity,
      evidenceActionable: forward.selectedSimulation?.evidenceActionable ?? false,
      normalizationScale: forward.selectedSimulation?.normalizationScale ?? 0,
      candidateUtility: recommendation.ranking.rankings.find(row => row.candidateId === forward.selectedCandidate?.id)?.utility ?? null,
      candidateSimulation: forward.selectedSimulation ?? null,
      frozenSimulationCosts: forward.costs,
      rawUnitValueX: forward.rawUnitValueX,
      rawUnitValueY: forward.rawUnitValueY,
      activeBinIdAtDecision: forward.activeBinIdAtDecision,
      uncertaintyLineage: recommendation.uncertaintyLineage ?? null,
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
  /** A version is part of the durable outcome identity. New models coexist
   * with, rather than rewrite, the original calibration record. */
  outcomeModelVersion: string;
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
    frozenCapitalLamports?: string;
    allocatedCapitalLamports?: string;
    derivedPositionValueLamports?: string;
    maxEffectiveOwnershipBps?: number;
    participationModel?: 'CAPITAL_CONSTRAINED_V2';
    perBinParticipation?: Array<{binId:number;allocatedCapitalLamports:string;baselineBinValueLamports:string;competingSupplyRaw:string;positionShareRaw:string;effectiveOwnershipBps:number}>;
  };
}

/** Bind a durable realization to the exact result that was calculated. */
export async function phase3ForwardOutcomeResultHash(outcome: Pick<Phase3ForwardOutcome, 'recommendationId'|'horizonMinutes'|'outcomeModelVersion'|'state'|'evidenceHash'|'reasonCodes'|'realized'>): Promise<string> {
  return sha256Hex(canonicalJson({
    recommendationId: outcome.recommendationId,
    horizonMinutes: outcome.horizonMinutes,
    outcomeModelVersion: outcome.outcomeModelVersion,
    state: outcome.state,
    evidenceHash: outcome.evidenceHash ?? null,
    reasonCodes: [...outcome.reasonCodes].sort(),
    realized: outcome.realized ?? null,
  }));
}

function inWindow(timestamp: string, start: number, end: number): boolean {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) && value > start && value <= end;
}

interface CapitalConstrainedForwardPosition {
  position: SyntheticPosition;
  frozenCapitalLamports: bigint;
  allocatedCapitalLamports: bigint;
  derivedPositionValueLamports: bigint;
  maxEffectiveOwnershipBps: number;
  bins: Array<{
    binId: number;
    allocatedCapitalLamports: string;
    baselineBinValueLamports: string;
    competingSupplyRaw: string;
    positionShareRaw: string;
    effectiveOwnershipBps: number;
  }>;
}

const FORWARD_V2_WEIGHT_SCALE = 1_000_000_000_000n;
const FORWARD_V2_BPS_SCALE = 10_000n;
const FORWARD_V2_MIN_CAPITAL_UTILIZATION_BPS = 9_950n;
/** Five percent is the explicit maximum price-taking ownership of a populated bin. */
export const FORWARD_V2_MAX_PRICE_TAKING_OWNERSHIP_BPS = 500;

function forwardRaw(value: string | undefined): bigint {
  try { return BigInt(value ?? '0'); } catch { return 0n; }
}

function forwardSafeNumber(value: bigint): number | undefined {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(value);
}

function forwardWeightNumerators(candidate: NonNullable<FrozenPhase3ForwardDecision['selectedCandidate']>): bigint[] | undefined {
  const seen = new Set<number>();
  const weights = candidate.perBinWeights.map(weight => {
    if (!Number.isInteger(weight.binId) || seen.has(weight.binId) || !Number.isFinite(weight.weight) || weight.weight < 0) return undefined;
    seen.add(weight.binId);
    return BigInt(Math.round(weight.weight * Number(FORWARD_V2_WEIGHT_SCALE)));
  });
  if (weights.some(weight => weight === undefined)) return undefined;
  return weights as bigint[];
}

function allocateForwardCapital(capitalLamports: bigint, weights: bigint[]): bigint[] | undefined {
  const denominator = weights.reduce((sum, weight) => sum + weight, 0n);
  const remainderIndex = weights.reduce((last, weight, index) => weight > 0n ? index : last, -1);
  if (capitalLamports <= 0n || denominator <= 0n || remainderIndex < 0) return undefined;
  let allocated = 0n;
  return weights.map((weight, index) => {
    const value = index === remainderIndex ? capitalLamports - allocated : (capitalLamports * weight) / denominator;
    allocated += value;
    return value;
  });
}

/**
 * V2 constructs actual synthetic LP-share units from the frozen capital at t0.
 * rawUnitValueY is the frozen token-X value of one WSOL lamport, so it is also
 * the frozen conversion from the token-X valuation contract back to lamports.
 */
function deriveCapitalConstrainedForwardPosition(input: {
  decision: FrozenPhase3ForwardDecision;
  candidate: NonNullable<FrozenPhase3ForwardDecision['selectedCandidate']>;
  baseline: BinFrame;
}): { position?: CapitalConstrainedForwardPosition; reasonCodes?: string[] } {
  const rawUnitValueX = Number(input.decision.prediction.rawUnitValueX ?? 0);
  const rawUnitValueY = Number(input.decision.prediction.rawUnitValueY ?? 0);
  if (!Number.isFinite(rawUnitValueX) || rawUnitValueX <= 0 || !Number.isFinite(rawUnitValueY) || rawUnitValueY <= 0) {
    return { reasonCodes: ['FORWARD_V2_FROZEN_WSOL_VALUATION_INVALID'] };
  }
  const frozenCapitalLamports = forwardRaw(input.decision.capitalLamports);
  const capitalFraction = input.candidate.capitalFraction;
  if (frozenCapitalLamports <= 0n || !Number.isFinite(capitalFraction) || capitalFraction <= 0 || capitalFraction > 1) {
    return { reasonCodes: ['FORWARD_V2_FROZEN_CAPITAL_INVALID'] };
  }
  const fraction = BigInt(Math.round(capitalFraction * Number(FORWARD_V2_WEIGHT_SCALE)));
  const allocatedCapitalLamports = (frozenCapitalLamports * fraction) / FORWARD_V2_WEIGHT_SCALE;
  const weights = forwardWeightNumerators(input.candidate);
  const allocations = weights ? allocateForwardCapital(allocatedCapitalLamports, weights) : undefined;
  if (!weights || !allocations || allocations.reduce((sum, value) => sum + value, 0n) > frozenCapitalLamports) {
    return { reasonCodes: ['FORWARD_V2_CAPITAL_ALLOCATION_INVALID'] };
  }
  const binMap = new Map(input.baseline.bins.map(bin => [bin.binId, bin] as const));
  const bins: SyntheticBinShare[] = [];
  const audit: CapitalConstrainedForwardPosition['bins'] = [];
  for (let index = 0; index < input.candidate.perBinWeights.length; index++) {
    const weight = input.candidate.perBinWeights[index]!;
    const allocation = allocations[index]!;
    if (allocation <= 0n) continue;
    const bin = binMap.get(weight.binId);
    const supply = forwardRaw(bin?.liquiditySupply);
    const amountX = forwardSafeNumber(forwardRaw(bin?.amountX));
    const amountY = forwardSafeNumber(forwardRaw(bin?.amountY));
    if (!bin || supply <= 0n || amountX === undefined || amountY === undefined) {
      return { reasonCodes: ['FORWARD_V2_BIN_LIQUIDITY_UNAVAILABLE'] };
    }
    const valueLamports = BigInt(Math.floor((amountX * rawUnitValueX + amountY * rawUnitValueY) / rawUnitValueY));
    if (valueLamports <= 0n || allocation >= valueLamports) {
      return { reasonCodes: ['FORWARD_V2_NOT_PRICE_TAKING'] };
    }
    const requestedBps = (allocation * FORWARD_V2_BPS_SCALE) / valueLamports;
    if (requestedBps > BigInt(FORWARD_V2_MAX_PRICE_TAKING_OWNERSHIP_BPS)) {
      return { reasonCodes: ['FORWARD_V2_NOT_PRICE_TAKING'] };
    }
    // p/(s+p) <= allocation/binValue: floor preserves the frozen capital cap.
    const positionShareRaw = (supply * allocation) / (valueLamports - allocation);
    if (positionShareRaw <= 0n) return { reasonCodes: ['FORWARD_V2_POSITION_QUANTITY_UNREPRESENTABLE'] };
    const ownershipBps = Number((positionShareRaw * FORWARD_V2_BPS_SCALE) / (supply + positionShareRaw));
    if (ownershipBps > FORWARD_V2_MAX_PRICE_TAKING_OWNERSHIP_BPS) return { reasonCodes: ['FORWARD_V2_NOT_PRICE_TAKING'] };
    bins.push({ binId: weight.binId, positionShareRaw, competingSupplyRaw: supply });
    audit.push({
      binId: weight.binId,
      allocatedCapitalLamports: allocation.toString(),
      baselineBinValueLamports: valueLamports.toString(),
      competingSupplyRaw: supply.toString(),
      positionShareRaw: positionShareRaw.toString(),
      effectiveOwnershipBps: ownershipBps,
    });
  }
  if (!bins.length) return { reasonCodes: ['FORWARD_V2_POSITION_QUANTITY_UNREPRESENTABLE'] };
  const position: SyntheticPosition = {
    pool: input.decision.poolAddress,
    lowerBinId: input.candidate.lowerBinId,
    upperBinId: input.candidate.upperBinId,
    openedAt: input.baseline.observedAt,
    bins,
    strategyLabel: `${input.candidate.strategy}:${input.candidate.orientation}`,
  };
  const baselineSimulation = simulateSyntheticPosition({ position, frames: [input.baseline], events: [] });
  const baselineInventory = baselineSimulation.inventory[0];
  if (!baselineInventory) return { reasonCodes: ['FORWARD_V2_POSITION_QUANTITY_UNREPRESENTABLE'] };
  const derivedPositionValueLamports = forwardV2ValueLamports(baselineInventory.tokenXRaw, baselineInventory.tokenYRaw, rawUnitValueX, rawUnitValueY);
  if (derivedPositionValueLamports === undefined || derivedPositionValueLamports <= 0n || derivedPositionValueLamports > allocatedCapitalLamports ||
      derivedPositionValueLamports * FORWARD_V2_BPS_SCALE < allocatedCapitalLamports * FORWARD_V2_MIN_CAPITAL_UTILIZATION_BPS) {
    return { reasonCodes: ['FORWARD_V2_CAPITAL_REPRESENTATION_INVALID'] };
  }
  return {
    position: {
      position,
      frozenCapitalLamports,
      allocatedCapitalLamports,
      derivedPositionValueLamports,
      maxEffectiveOwnershipBps: Math.max(...audit.map(row => row.effectiveOwnershipBps)),
      bins: audit,
    },
  };
}

function forwardV2ValueLamports(tokenXRaw: bigint, tokenYRaw: bigint, rawUnitValueX: number, rawUnitValueY: number): bigint | undefined {
  const x = forwardSafeNumber(tokenXRaw), y = forwardSafeNumber(tokenYRaw);
  if (x === undefined || y === undefined || !Number.isFinite(rawUnitValueX) || rawUnitValueX <= 0 || !Number.isFinite(rawUnitValueY) || rawUnitValueY <= 0) return undefined;
  const value = (x * rawUnitValueX + y * rawUnitValueY) / rawUnitValueY;
  return Number.isFinite(value) && value >= 0 ? BigInt(Math.trunc(value)) : undefined;
}

function forwardInsufficient(input: {
  decision: FrozenPhase3ForwardDecision;
  horizon: (typeof PHASE3_FORWARD_HORIZONS_MINUTES)[number];
  outcomeModelVersion: string;
  reasonCodes: string[];
  evidenceHash?: string;
}): Phase3ForwardOutcome {
  return {
    recommendationId: input.decision.recommendationId,
    horizonMinutes: input.horizon,
    outcomeModelVersion: input.outcomeModelVersion,
    state: 'INSUFFICIENT_EVIDENCE',
    ...(input.evidenceHash ? { evidenceHash: input.evidenceHash } : {}),
    reasonCodes: [...new Set(input.reasonCodes)].sort(),
  };
}

/**
 * Mature one frozen geometry.  No RangeForge generation or candidate ranking
 * occurs here: later source changes cannot alter this historical outcome.
 */
export async function matureFrozenPhase3ForwardOutcome(input: {
  decision: FrozenPhase3ForwardDecision;
  horizonMinutes: (typeof PHASE3_FORWARD_HORIZONS_MINUTES)[number];
  outcomeModelVersion?: string;
  frames: BinFrame[];
  events: SwapEventFact[];
  now: string;
}): Promise<Phase3ForwardOutcome> {
  const horizon = input.horizonMinutes;
  const outcomeModelVersion = input.outcomeModelVersion ?? PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V1;
  if (outcomeModelVersion !== PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V1 && outcomeModelVersion !== PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2) {
    throw new Error('LPFORGE_FORWARD_OUTCOME_MODEL_VERSION_UNSUPPORTED');
  }
  const start = Date.parse(input.decision.decisionTimestamp);
  const now = Date.parse(input.now);
  if (!Number.isFinite(start) || !Number.isFinite(now)) throw new Error('LPFORGE_FORWARD_MATURATION_TIME_INVALID');
  const end = start + horizon * 60_000;
  if (now < end) return { recommendationId: input.decision.recommendationId, horizonMinutes: horizon, outcomeModelVersion, state: 'PENDING', reasonCodes: ['FORWARD_HORIZON_NOT_DUE'] };
  const candidate = input.decision.selectedCandidate;
  if (!candidate) return forwardInsufficient({ decision: input.decision, horizon, outcomeModelVersion, reasonCodes: ['FORWARD_FROZEN_CANDIDATE_UNAVAILABLE'] });
  const orderedFrames = [...input.frames].filter(frame => Number.isFinite(Date.parse(frame.observedAt))).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const baseline = orderedFrames.filter(frame => Date.parse(frame.observedAt) <= start).at(-1);
  const futureFrames = orderedFrames.filter(frame => inWindow(frame.observedAt, start, end));
  if (!baseline || !futureFrames.length) return forwardInsufficient({ decision: input.decision, horizon, outcomeModelVersion, reasonCodes: ['FORWARD_FUTURE_FRAME_COVERAGE_INSUFFICIENT'] });
  const frames = [baseline, ...futureFrames];
  const events = input.events.filter(event => inWindow(event.stamp.observedAt, start, end));
  const evidenceHash = await sha256Hex(canonicalJson({ recommendationId: input.decision.recommendationId, horizon, frames, events }));
  // The frozen cost contract is stored at t0. Neither V1 nor V2 may consult
  // a current cost policy while calibrating a historical prediction.
  const prediction = input.decision.prediction;
  const execution = Number(prediction.expectedExecutionCost ?? 0);
  const reposition = Number(prediction.expectedRepositionCost ?? 0);
  const tail = Number(prediction.expectedTailRiskCost ?? 0);
  const realizedTotalCost = execution + reposition + tail;

  // Immutable V1 branch retained exactly for historical comparability.
  if (outcomeModelVersion === PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V1) {
    const simulation = simulateCandidateEconomics({
      candidate,
      pool: input.decision.poolAddress,
      frames,
      events,
      totalPositionShareRaw: deriveSyntheticPositionShareRaw(baseline),
      rawUnitValueX: Number(input.decision.prediction.rawUnitValueX ?? 0),
      rawUnitValueY: Number(input.decision.prediction.rawUnitValueY ?? 0),
      capitalValue: Number(input.decision.capitalLamports) / 1_000_000_000,
      costs: { transactionFeeValue: String(Math.max(0, realizedTotalCost)) },
      rebaseCandidateToFirstFrame: false,
      horizonEnd: new Date(end).toISOString(),
    });
    if (!simulation.unitScaleValid || simulation.occupancyState !== 'COMPLETE' || simulation.warnings.includes('CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT')) {
      return forwardInsufficient({ decision: input.decision, horizon, outcomeModelVersion, evidenceHash, reasonCodes: ['FORWARD_FUTURE_EVIDENCE_INSUFFICIENT', ...simulation.warnings] });
    }
    return {
      recommendationId: input.decision.recommendationId,
      horizonMinutes: horizon,
      outcomeModelVersion,
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

  const constrained = deriveCapitalConstrainedForwardPosition({ decision: input.decision, candidate, baseline });
  if (!constrained.position) return forwardInsufficient({ decision: input.decision, horizon, outcomeModelVersion, evidenceHash, reasonCodes: constrained.reasonCodes ?? ['FORWARD_V2_POSITION_UNAVAILABLE'] });
  const rawUnitValueX = Number(input.decision.prediction.rawUnitValueX ?? 0);
  const rawUnitValueY = Number(input.decision.prediction.rawUnitValueY ?? 0);
  const simulation = simulateSyntheticPosition({ position: constrained.position.position, frames, events, horizonEnd: new Date(end).toISOString() });
  const startInventory = simulation.inventory[0];
  const endInventory = simulation.inventory.at(-1);
  const startValueLamports = startInventory ? forwardV2ValueLamports(startInventory.tokenXRaw, startInventory.tokenYRaw, rawUnitValueX, rawUnitValueY) : undefined;
  const endValueLamports = endInventory ? forwardV2ValueLamports(endInventory.tokenXRaw, endInventory.tokenYRaw, rawUnitValueX, rawUnitValueY) : undefined;
  const feeValueLamports = forwardV2ValueLamports(simulation.totalAttributedFeeXRaw, simulation.totalAttributedFeeYRaw, rawUnitValueX, rawUnitValueY);
  const replayContinuous = !simulation.inventory.some(snapshot => snapshot.missingBins.some(binId => constrained.position!.position.bins.some(bin => bin.binId === binId && bin.positionShareRaw > 0n)));
  if (!startValueLamports || endValueLamports === undefined || feeValueLamports === undefined || !replayContinuous || simulation.occupancyState !== 'COMPLETE') {
    return forwardInsufficient({ decision: input.decision, horizon, outcomeModelVersion, evidenceHash, reasonCodes: [
      'FORWARD_FUTURE_EVIDENCE_INSUFFICIENT',
      ...(replayContinuous ? [] : ['CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT']),
      ...(simulation.occupancyState === 'COMPLETE' ? [] : ['CANDIDATE_ACTIVE_TIME_EVIDENCE_INSUFFICIENT']),
    ] });
  }
  const realizedFeeValue = Number(feeValueLamports) / 1_000_000_000;
  const realizedInventoryPnl = Number(endValueLamports - startValueLamports) / 1_000_000_000;
  return {
    recommendationId: input.decision.recommendationId,
    horizonMinutes: horizon,
    outcomeModelVersion,
    state: 'FINAL',
    evidenceHash,
    reasonCodes: [],
    realized: {
      realizedFeeValue,
      realizedInventoryPnl,
      realizedExecutionCost: execution,
      realizedRepositionCost: reposition,
      realizedTailRiskCost: tail,
      realizedTotalCost,
      realizedNetValue: realizedFeeValue + realizedInventoryPnl - realizedTotalCost,
      activeDurationMs: simulation.activeDurationMs,
      inactiveDurationMs: simulation.inactiveDurationMs,
      unobservedDurationMs: simulation.unobservedDurationMs,
      coverageRatio: simulation.occupancyCoverageRatio,
      ...(simulation.activeTimeRatio === undefined ? {} : { activeRatio: simulation.activeTimeRatio }),
      rangeSurvived: !simulation.firstOutOfRangeAt,
      ...(simulation.firstOutOfRangeAt ? { firstOutOfRangeTimestamp: simulation.firstOutOfRangeAt } : {}),
      frozenCapitalLamports: constrained.position.frozenCapitalLamports.toString(),
      allocatedCapitalLamports: constrained.position.allocatedCapitalLamports.toString(),
      derivedPositionValueLamports: constrained.position.derivedPositionValueLamports.toString(),
      maxEffectiveOwnershipBps: constrained.position.maxEffectiveOwnershipBps,
      participationModel: 'CAPITAL_CONSTRAINED_V2',
      perBinParticipation: constrained.position.bins,
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

export interface ForwardCalibrationStats {
  count: number;
  decisionCount: number;
  predictedPositiveCount: number;
  realizedPositiveCount: number;
  medianPredictedEv: number | null;
  meanRealizedEv: number | null;
  medianRealizedEv: number | null;
  medianPredictionError: number | null;
  realizedPositiveRate: number | null;
  falsePositiveRate: number | null;
  falseNegativeRate: number | null;
}

export interface Phase3ForwardCalibration {
  summary: Record<string, number>;
  evBuckets: Record<string, ForwardCalibrationStats>;
  uncertaintyBuckets: Record<string, ForwardCalibrationStats>;
  byHorizon: Record<string, { summary: ForwardCalibrationStats; evBuckets: Record<string, ForwardCalibrationStats>; uncertaintyBuckets: Record<string, ForwardCalibrationStats>; progressStateCohorts: Record<string, ForwardCalibrationStats>; positiveEvProgressStateCohorts: Record<string, ForwardCalibrationStats> }>;
  progressStateCohorts: Record<string, ForwardCalibrationStats>;
  positiveEvProgressStateCohorts: Record<string, ForwardCalibrationStats>;
}

export function buildPhase3ForwardCalibration(rows: CalibrationRow[], options?: { outcomeModelVersion?: string }): Phase3ForwardCalibration {
  if (options?.outcomeModelVersion) rows = rows.filter(row => row.outcome.outcomeModelVersion === options.outcomeModelVersion);
  const final = rows.filter(row => row.outcome.state === 'FINAL' && row.outcome.realized);
  const summarize = (group: CalibrationRow[]): ForwardCalibrationStats => {
    const predicted = group.map(row => Number(row.decision.prediction.expectedNetEv));
    const realized = group.map(row => row.outcome.realized!.realizedNetValue);
    const errors = realized.map((value, index) => value - predicted[index]!);
    const predictedPositiveCount = predicted.filter(value => value > 0).length;
    const predictedNegativeCount = group.length - predictedPositiveCount;
    const realizedPositiveCount = realized.filter(value => value > 0).length;
    const falsePositive = group.filter((row, index) => predicted[index]! > 0 && realized[index]! <= 0).length;
    const falseNegative = group.filter((row, index) => predicted[index]! <= 0 && realized[index]! > 0).length;
    return { count: group.length, decisionCount: group.length, predictedPositiveCount, realizedPositiveCount, medianPredictedEv: median(predicted), meanRealizedEv: realized.length ? realized.reduce((a, b) => a + b, 0) / realized.length : null, medianRealizedEv: median(realized), medianPredictionError: median(errors), realizedPositiveRate: realized.length ? realizedPositiveCount / realized.length : null, falsePositiveRate: predictedPositiveCount ? falsePositive / predictedPositiveCount : null, falseNegativeRate: predictedNegativeCount ? falseNegative / predictedNegativeCount : null };
  };
  const by = (group: CalibrationRow[], key: (row: CalibrationRow) => string, required: string[] = []): Record<string, ForwardCalibrationStats> => Object.fromEntries([...new Set([...required, ...group.map(key)])].sort().map(label => [label, summarize(group.filter(row => key(row) === label))]));
  const progress = (group: CalibrationRow[]) => by(group, row => String(row.decision.phase3State).toUpperCase(), ['QUALIFIED', 'WATCHING', 'REJECTED', 'DATA_BLOCKED']);
  const positiveProgress = (group: CalibrationRow[]) => progress(group.filter(row => Number(row.decision.prediction.expectedNetEv) > 0));
  const byHorizon = Object.fromEntries(PHASE3_FORWARD_HORIZONS_MINUTES.map(horizon => {
    const group = final.filter(row => row.outcome.horizonMinutes === horizon);
    return [String(horizon), { summary: summarize(group), evBuckets: by(group, row => evBucket(Number(row.decision.prediction.expectedNetEv))), uncertaintyBuckets: by(group, row => uncertaintyBucket(Number(row.decision.prediction.forecastUncertainty))), progressStateCohorts: progress(group), positiveEvProgressStateCohorts: positiveProgress(group) }];
  }));
  const negativeNegative = final.filter(row => Number(row.decision.prediction.expectedNetEv) <= 0 && row.outcome.realized!.realizedNetValue <= 0).length;
  const negativePositive = final.filter(row => Number(row.decision.prediction.expectedNetEv) <= 0 && row.outcome.realized!.realizedNetValue > 0).length;
  const positivePositive = final.filter(row => Number(row.decision.prediction.expectedNetEv) > 0 && row.outcome.realized!.realizedNetValue > 0).length;
  const positiveNegative = final.filter(row => Number(row.decision.prediction.expectedNetEv) > 0 && row.outcome.realized!.realizedNetValue <= 0).length;
  return { summary: { predictions: rows.length, final: final.length, insufficientEvidence: rows.filter(row => row.outcome.state === 'INSUFFICIENT_EVIDENCE').length, predictedNegativeRealizedNegative: negativeNegative, predictedNegativeRealizedPositive: negativePositive, predictedPositiveRealizedPositive: positivePositive, predictedPositiveRealizedNegative: positiveNegative }, evBuckets: by(final, row => evBucket(Number(row.decision.prediction.expectedNetEv))), uncertaintyBuckets: by(final, row => uncertaintyBucket(Number(row.decision.prediction.forecastUncertainty))), byHorizon, progressStateCohorts: progress(final), positiveEvProgressStateCohorts: positiveProgress(final) };
}


export type PoolQualityProspectiveClassification='GENERALIZING'|'PROMISING_BUT_CONCENTRATED'|'NO_IMPROVEMENT'|'TOO_EARLY';
export interface PoolQualityProspectivePoolStats {
  final:number; wins:number; losses:number; winRate:number|null;
  realizedFees:number; realizedInventoryPnl:number; realizedEv:number; expectancy:number|null; profitFactor:number|null;
}
export interface PoolQualityProspectiveCohortStats extends PoolQualityProspectivePoolStats {
  decisions:number; pending:number; insufficientEvidence:number; failedDataIntegrity:number;
  uniquePoolCount:number; profitableUniquePoolCount:number; losingUniquePoolCount:number;
  largestProfitablePool:{poolAddress:string;realizedEv:number;grossProfitShare:number}|null;
  largestLosingPool:{poolAddress:string;realizedEv:number;grossLossShare:number}|null;
  byPool:Record<string,PoolQualityProspectivePoolStats>;
  classification:PoolQualityProspectiveClassification;
}
export interface PoolQualityProspectiveShadowReport {
  experimentVersion:'pool-quality-prospective-shadow-v1';
  outcomeModelVersion:string;
  frozenDecisionCount:number;
  byHorizon:Record<string,Record<'CONTROL'|'A'|'B'|'C',PoolQualityProspectiveCohortStats>>;
}
type PoolQualityMembership={CONTROL:true;A:boolean;B:boolean;C:boolean};
type PoolQualityDecision=FrozenPhase3ForwardDecision&{poolQualityShadow?:{version?:string;membership?:PoolQualityMembership}};
const poolQualityCohorts=['CONTROL','A','B','C'] as const;
const value=(input:unknown):number=>typeof input==='number'&&Number.isFinite(input)?input:0;
function poolQualityClassification(stats:PoolQualityProspectiveCohortStats):PoolQualityProspectiveClassification {
  if(stats.final===0||stats.uniquePoolCount<3)return'TOO_EARLY';
  if(stats.expectancy===null||stats.expectancy<=0)return'NO_IMPROVEMENT';
  if((stats.largestProfitablePool?.grossProfitShare??1)>.5)return'PROMISING_BUT_CONCENTRATED';
  return'GENERALIZING';
}
function poolQualityStats(rows:CalibrationRow[]):PoolQualityProspectiveCohortStats {
  const final=rows.filter(row=>row.outcome.state==='FINAL'&&row.outcome.realized),profits=final.map(row=>value(row.outcome.realized?.realizedNetValue));
  const wins=profits.filter(x=>x>0).length,losses=profits.length-wins,grossProfit=profits.filter(x=>x>0).reduce((a,b)=>a+b,0),grossLoss=-profits.filter(x=>x<0).reduce((a,b)=>a+b,0);
  const raw={final:final.length,wins,losses,winRate:final.length?wins/final.length:null,realizedFees:final.reduce((sum,row)=>sum+value(row.outcome.realized?.realizedFeeValue),0),realizedInventoryPnl:final.reduce((sum,row)=>sum+value(row.outcome.realized?.realizedInventoryPnl),0),realizedEv:profits.reduce((a,b)=>a+b,0),expectancy:profits.length?profits.reduce((a,b)=>a+b,0)/profits.length:null,profitFactor:grossLoss?grossProfit/grossLoss:grossProfit?Infinity:null};
  const pools=[...new Set(rows.map(row=>row.decision.poolAddress))].sort();
  const byPool=Object.fromEntries(pools.map(pool=>[pool,poolQualityStatsFlat(rows.filter(row=>row.decision.poolAddress===pool))]));
  const finalPools=Object.entries(byPool).filter(([,stats])=>stats.final>0),positive=[...finalPools].filter(([,stats])=>stats.realizedEv>0).sort((a,b)=>b[1].realizedEv-a[1].realizedEv),negative=[...finalPools].filter(([,stats])=>stats.realizedEv<0).sort((a,b)=>a[1].realizedEv-b[1].realizedEv);
  const stats:PoolQualityProspectiveCohortStats={decisions:rows.length,pending:rows.filter(row=>row.outcome.state==='PENDING').length,insufficientEvidence:rows.filter(row=>row.outcome.state==='INSUFFICIENT_EVIDENCE').length,failedDataIntegrity:rows.filter(row=>row.outcome.state==='FAILED_DATA_INTEGRITY').length,...raw,uniquePoolCount:pools.length,profitableUniquePoolCount:positive.length,losingUniquePoolCount:negative.length,largestProfitablePool:positive[0]?{poolAddress:positive[0][0],realizedEv:positive[0][1].realizedEv,grossProfitShare:grossProfit?positive[0][1].realizedEv/grossProfit:0}:null,largestLosingPool:negative[0]?{poolAddress:negative[0][0],realizedEv:negative[0][1].realizedEv,grossLossShare:grossLoss?-negative[0][1].realizedEv/grossLoss:0}:null,byPool,classification:'TOO_EARLY'};
  return{...stats,classification:poolQualityClassification(stats)};
}
function poolQualityStatsFlat(rows:CalibrationRow[]):PoolQualityProspectivePoolStats {
  const final=rows.filter(row=>row.outcome.state==='FINAL'&&row.outcome.realized),values=final.map(row=>value(row.outcome.realized?.realizedNetValue)),wins=values.filter(x=>x>0).length,grossProfit=values.filter(x=>x>0).reduce((a,b)=>a+b,0),grossLoss=-values.filter(x=>x<0).reduce((a,b)=>a+b,0);
  return{final:final.length,wins,losses:values.length-wins,winRate:values.length?wins/values.length:null,realizedFees:final.reduce((sum,row)=>sum+value(row.outcome.realized?.realizedFeeValue),0),realizedInventoryPnl:final.reduce((sum,row)=>sum+value(row.outcome.realized?.realizedInventoryPnl),0),realizedEv:values.reduce((a,b)=>a+b,0),expectancy:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,profitFactor:grossLoss?grossProfit/grossLoss:grossProfit?Infinity:null};
}
/** Reporting-only pool-quality experiment. It consumes immutable snapshots and
 * V2 outcomes; no decision or execution module imports this report. */
export function buildPoolQualityProspectiveShadowReport(rows:CalibrationRow[],options?:{outcomeModelVersion?:string}):PoolQualityProspectiveShadowReport {
  const scoped=rows.filter(row=>(!options?.outcomeModelVersion||row.outcome.outcomeModelVersion===options.outcomeModelVersion)&&(row.decision as PoolQualityDecision).poolQualityShadow?.version==='pool-quality-prospective-shadow-v1');
  const byHorizon=Object.fromEntries(PHASE3_FORWARD_HORIZONS_MINUTES.map(horizon=>[String(horizon),Object.fromEntries(poolQualityCohorts.map(cohort=>[cohort,poolQualityStats(scoped.filter(row=>row.outcome.horizonMinutes===horizon&&(row.decision as PoolQualityDecision).poolQualityShadow?.membership?.[cohort]===true))]))])) as PoolQualityProspectiveShadowReport['byHorizon'];
  return{experimentVersion:'pool-quality-prospective-shadow-v1',outcomeModelVersion:options?.outcomeModelVersion??'ALL',frozenDecisionCount:new Set(scoped.map(row=>row.decision.recommendationId)).size,byHorizon};
}

/** Deterministic episode view: within one pool/model/horizon, retain the first
 * decision and suppress later decision windows that overlap its frozen horizon.
 * This is reporting-only and does not change immutable decision capture. */
export function buildPhase3ForwardEpisodeCalibration(rows: CalibrationRow[], options?: { outcomeModelVersion?: string }): Phase3ForwardCalibration {
  const scoped = options?.outcomeModelVersion ? rows.filter(row => row.outcome.outcomeModelVersion === options.outcomeModelVersion) : rows;
  const selected: CalibrationRow[] = [];
  const groups = new Map<string, CalibrationRow[]>();
  for (const row of scoped) {
    const key = [row.decision.poolAddress, row.outcome.outcomeModelVersion, row.outcome.horizonMinutes].join(':');
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    let nextStart = Number.NEGATIVE_INFINITY;
    for (const row of [...group].sort((a, b) => Date.parse(a.decision.decisionTimestamp) - Date.parse(b.decision.decisionTimestamp) || a.decision.recommendationId.localeCompare(b.decision.recommendationId))) {
      const start = Date.parse(row.decision.decisionTimestamp);
      if (!Number.isFinite(start) || start < nextStart) continue;
      selected.push(row);
      nextStart = start + row.outcome.horizonMinutes * 60_000;
    }
  }
  return buildPhase3ForwardCalibration(selected, options);
}
