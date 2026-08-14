import { canonicalJson, sha256Hex } from "../../domain/src/index.js";
import type {
  BinLiquidityFact,
  FeatureEnvelope,
  PoolStateFact,
  PositionV2Fact,
  ProtocolCompatibilityCheck,
  SwapEventFact,
  TokenFact,
} from "../../domain/src/index.js";
import type { RegimeHistorySample } from "../../regime/src/index.js";
import type {
  Phase3RegimeLabel,
  ProbabilityEntry,
} from "../../contracts/src/index.js";

export interface IngestionCheckpoint {
  stream: string;
  lastSeenSlot?: bigint;
  lastFullyProcessedSlot?: bigint;
  state: Record<string, unknown>;
}

/**
 * A 5-minute fee/volume value is only useful when it represents an actual
 * measurement.  In particular, legacy rolling records with a zero/zero value
 * and no evidence state are provider placeholders, not proof that the pool
 * earned no fees in that interval.
 */
export type FeeVolumeEvidenceState = "MEASURED" | "PLACEHOLDER" | "PARTIAL";
export interface FeeVolumeObservationCandidate {
  source: string;
  fees?: number | null;
  protocolFees?: number | null;
  volume?: number | null;
  evidenceState?: string | null;
}
export function feeVolumeSelectionRank(row: FeeVolumeObservationCandidate): number {
  const state = row.evidenceState?.trim().toUpperCase();
  const fees = Number(row.fees ?? 0), protocolFees = Number(row.protocolFees ?? 0), volume = Number(row.volume ?? 0);
  const populated = [fees, protocolFees, volume].some(value => Number.isFinite(value) && value > 0);
  if (state === "MEASURED") return 0;
  if (populated) return 1;
  if (state === "PARTIAL") return 2;
  // Existing rows predate evidenceState. A zero rolling row is a placeholder
  // unless a producer explicitly attested it as MEASURED.
  if (row.source === "METEORA_API_ROLLING_5M" && fees === 0 && protocolFees === 0 && volume === 0) return 4;
  return 3;
}
export type AutonomousPlanAction =
  | "OPEN"
  | "ADD"
  | "CLAIM"
  | "REDUCE"
  | "RESHAPE"
  | "REBALANCE"
  | "CLOSE"
  | "EMERGENCY_CLOSE";
export interface AutonomousPlanStep {
  transactionId: string;
  sequence: number;
  kind: string;
  state: string;
  requiredSignerAddresses: string[];
  metadata: Record<string, unknown>;
}
export interface AutonomousPlan {
  planId: string;
  intentId: string;
  idempotencyKey: string;
  action: AutonomousPlanAction;
  poolAddress: string;
  ownerAddress: string;
  positionAddress?: string;
  thesisId: string;
  observedAt: string;
  expiresAt: string;
  intentPayload: Record<string, unknown>;
  planPayload: Record<string, unknown>;
  steps: AutonomousPlanStep[];
}
export interface ExecutionCapitalReservationRequest {planId:string;ownerAddress:string;poolAddress:string;capitalLamports:bigint;walletLamports:bigint;reserveLamports:bigint;maxPortfolioLamports:bigint;maxPoolLamports:bigint;maxTokenLamports:bigint;maxInitialPositionLamports:bigint;now:string;}
export interface ExecutionCapitalReservationResult {approved:boolean;reasonCodes:string[];tokenMint?:string;deployedLamports:bigint;reservedLamports:bigint;availableLamports:bigint;}
export interface Phase1Store {
  health(): Promise<boolean>;
  close(): Promise<void>;
  upsertToken(token: TokenFact): Promise<void>;
  upsertPool(pool: PoolStateFact): Promise<void>;
  insertCompatibility(check: ProtocolCompatibilityCheck): Promise<void>;
  insertPoolSnapshot(pool: PoolStateFact): Promise<void>;
  insertBins(bins: BinLiquidityFact[]): Promise<void>;
  upsertPosition(position: PositionV2Fact): Promise<void>;
  insertSwapEvent(event: SwapEventFact): Promise<void>;
  getCheckpoint(stream: string): Promise<IngestionCheckpoint | undefined>;
  setCheckpoint(cp: IngestionCheckpoint): Promise<void>;
  insertDataApiPool(
    pool: Record<string, unknown>,
    observedAt: string,
  ): Promise<void>;
  insertOhlcv(
    poolAddress: string,
    timeframe: string,
    candles: Array<Record<string, unknown>>,
    observedAt: string,
    origin: "METEORA_API" | "EVENT_DERIVED",
  ): Promise<void>;
  insertFeatureSnapshot<T extends object>(
    snapshot: FeatureEnvelope<T>,
    hash: string,
  ): Promise<void>;
  insertPositionValuation(value: {
    positionAddress: string;
    poolAddress: string;
    chainSlot?: bigint;
    observedAt: string;
    valuation: Record<string, unknown>;
  }): Promise<void>;
  insertSimulationRun(value: {
    poolAddress: string;
    simulatorVersion: string;
    fidelity: string;
    policyId?: string;
    openedAt: string;
    endedAt: string;
    lowerBinId: number;
    upperBinId: number;
    inputHash: string;
    result: Record<string, unknown>;
  }): Promise<void>;
  insertPoolAssessment(value: {
    poolAddress: string;
    policyId: string;
    eligibility: "ELIGIBLE" | "WATCH" | "BLOCK";
    poolQualityScore: number;
    economicQualityScore: number;
    flowQualityScore: number;
    liquidityQualityScore: number;
    tokenRiskScore: number;
    toxicityProbability: number;
    archetype: string;
    blockers: string[];
    warnings: string[];
    evidence: Record<string, unknown>;
    assessedAt: string;
  }): Promise<void>;
  upsertDiscoveryPool(value: {
    poolAddress: string;
    observedAt: string;
    sourceManual: boolean;
    sourceAuto: boolean;
    tokenXMint?: string | undefined;
    tokenYMint?: string | undefined;
    pairedTokenMint?: string | undefined;
    pairedTokenSymbol?: string | undefined;
    marketCapCohort: string;
    state: string;
    tier: string;
    priorityScore: number;
    rank?: number | undefined;
    universePercentile?: number | undefined;
    reasonCodes: string[];
    evidenceState: Record<string, unknown>;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertDiscoveryObservation(value: {
    poolAddress: string;
    observedAt: string;
    policyId: string;
    source: string;
    decision: string;
    priorityScore: number;
    metrics: Record<string, number | undefined>;
    hardReasons: string[];
    warnings: string[];
    selectionReasons: string[];
    evidenceState: Record<string, unknown>;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertDiscoveryRanking(value: {
    rankingCycleId: string;
    poolAddress: string;
    observedAt: string;
    policyId: string;
    rank: number;
    universePercentile: number;
    feePercentile?: number | undefined;
    volumePercentile?: number | undefined;
    liquidityPercentile?: number | undefined;
    priorityScore: number;
    state: string;
    tier: string;
    reasonCodes: string[];
    payload: Record<string, unknown>;
  }): Promise<void>;
  listDiscoveryCandidates(tiers?: string[]): Promise<Array<{
    poolAddress: string; state: string; tier: string; priorityScore: number; rank?: number | undefined; lastSeenAt: string; tokenXMint?:string|undefined;tokenYMint?:string|undefined;pairedTokenMint?:string|undefined; payload: Record<string, unknown>;
  }>>;
  markDiscoveryPoolsStale(cutoff: string, observedAt: string): Promise<number>;
  insertFeeVolumeObservations(value:{poolAddress:string; observedAt:string; source:string; rows:Array<{bucketAt:string;fees?:number;protocolFees?:number;volume?:number;payload?:Record<string,unknown>}>;}):Promise<void>;
  loadFeeVolumeObservations(poolAddress:string,since:string,limit?:number):Promise<Array<{bucketAt:string;fees:number;protocolFees:number;volume:number;source:string;sourceHash:string}>>;
  insertCandidateMarketObservations(value:{poolAddress:string;ingestedAt:string;rows:Array<{observedAt:string;sourceType:'LIVE_OBSERVED'|'HISTORICAL_API_BACKFILL'|'HISTORICAL_RPC_BACKFILL'|'RECONSTRUCTED';sourceProvider:string;price:number;resolutionMs?:number;activeBinId?:number;volume?:number;feeValue?:number;localLiquidity?:number;payload?:Record<string,unknown>}>}):Promise<void>;
  loadCandidateMarketObservations(poolAddress:string,since:string,limit?:number):Promise<Array<{observedAt:string;sourceType:string;sourceProvider:string;price:number;resolutionMs:number;activeBinId?:number;volume?:number;feeValue?:number;localLiquidity?:number}>>;
  upsertActiveCandidateBackfill(value:{poolAddress:string;lastAttemptAt:string;lastSuccessfulAt?:string;requestedMinutes:number;coveredMinutes:number;coverageRatio:number;feeBucketCount:number;ohlcvBucketCount:number;swapEventCount:number;independent15mEpisodes:number;oldestEvidenceAt?:string;newestEvidenceAt?:string;quality:'SUFFICIENT'|'PARTIAL'|'INSUFFICIENT'|'DEGRADED';reasonCodes:string[];payload:Record<string,unknown>}):Promise<void>;
  loadActiveCandidateBackfill(poolAddress:string):Promise<Record<string,unknown>|undefined>;
  upsertActiveCandidateHistoryMaturity(value:{poolAddress:string; assessedAt:string; state:'WARMING'|'MATURE'|'STALE'|'DEGRADED'; marketObservationCount:number;activeBinObservationCount:number;binFrameCount:number;swapEventCount:number;oldestObservationAt?:string;latestObservationAt?:string;completeness5m:number;completeness15m:number;completeness1h:number;reasonCodes:string[];payload:Record<string,unknown>;}):Promise<void>;
  loadActiveCandidateHistoryMaturity(poolAddress:string):Promise<Record<string,unknown>|undefined>;
  insertEconomicEstimate(value:{economicEstimateId:string;poolAddress:string;asOf:string;fidelity:'AGGREGATE_ESTIMATE'|'EVENT_PATH_ESTIMATE'|'BIN_SHARE_REPLAY'|'ONCHAIN_POSITION';rawObservationCount:number;effectiveSampleCount:number;independentEpisodeCount:number;feeObservationCount:number;eventPathObservationCount:number;feeRatePerCapitalHour:number;uncertainty:number;evidenceAgeSeconds:number;sourceHashes:Record<string,unknown>;payload:Record<string,unknown>;}):Promise<void>;
  loadLatestEconomicEstimate(poolAddress:string,through:string):Promise<Record<string,unknown>|undefined>;
  insertDeepScreenObservation(value: {poolAddress:string; observedAt:string; policyId:string; eligibility:string; poolQualityScore:number; currentOpportunityScore:number; executableLiquidityScore:number; feeQualityScore:number; flowQualityScore:number; toxicityProbability:number; opportunityHalfLifeMinutes?:number; reasonCodes:string[]; evidenceAvailability:Record<string,unknown>; payload:Record<string,unknown>;}): Promise<void>;
  insertUniverseAssignment(value:{assignmentCycleId:string;poolAddress:string;observedAt:string;policyId:string;tier:string;rank?:number;deepPriority:number;control:boolean;selectionProbability:number;opportunityHalfLifeMinutes?:number;selectionReason:string[];payload:Record<string,unknown>;}):Promise<void>;
  insertDiscoveryPrediction(value:{predictionId:string;poolAddress:string;observedAt:string;policyVersion:string;modelVersion:string;cohort:string;episodeKey:string;selectedAction:string;selectionContext:Record<string,unknown>;prediction:Record<string,unknown>;}):Promise<void>;
  insertDiscoveryOutcome(value:{predictionId:string;poolAddress:string;observedAt:string;horizonMinutes:number;outcomeClass:string;eventAttribution:string;structuralEventCodes:string[];realizedNetValue?:number;realizedFees?:number;realizedDirectionalPnl?:number;rangeSurvived?:boolean;inventoryConversion?:number;payload:Record<string,unknown>;}):Promise<void>;
  upsertDiscoveryReputation(value:{reputationKey:string;level:string;asOf:string;samples:number;independentEpisodes:number;meanNet:number;positiveRate:number;confidence:number;payload:Record<string,unknown>}):Promise<void>;
  insertDiscoveryCalibration(value:{snapshotId:string;observedAt:string;modelVersion:string;sampleCount:number;independentEpisodes:number;brierProfit?:number;survivalBrier?:number;netValueMae?:number;meanBias?:number;allOutcomeNet:number;modelCalibrationNet:number;payload:Record<string,unknown>}):Promise<void>;
  insertDiscoveryBaseline(value:{runId:string;observedAt:string;baselineId:string;selectedPoolAddress?:string;informationCutoff:string;result:Record<string,unknown>}):Promise<void>;
  upsertDiscoveryPolicyProposal(value:{proposalId:string;createdAt:string;state:string;hypothesis:string;targetPolicy:string;changes:Record<string,unknown>;evidence:Record<string,unknown>}):Promise<void>;
  loadRecentDiscoveryPredictions(limit?:number):Promise<Array<Record<string,unknown>>>;
  loadDiscoveryOutcomes(limit?:number):Promise<Array<Record<string,unknown>>>;
  insertForensicEpisode(value: {
    poolAddress: string;
    episodeType: string;
    startedAt: string;
    endedAt?: string;
    dataQuality: string;
    sourceWatermark: Record<string, unknown>;
    facts: Record<string, unknown>;
    resultAttribution: Record<string, unknown>;
  }): Promise<string>;
  insertCounterfactual(value: {
    episodeId: string;
    label: string;
    simulatorVersion: string;
    result: Record<string, unknown>;
  }): Promise<void>;
  insertExperiment(value: {
    id: string;
    hypothesis: string;
    primaryMetric: string;
    secondaryMetrics: string[];
    controlPolicyId: string;
    treatmentPolicyId: string;
    specification: Record<string, unknown>;
    createdAt: string;
  }): Promise<void>;
  insertExperimentResult(value: {
    experimentId: string;
    runHash: string;
    result: Record<string, unknown>;
  }): Promise<void>;
  insertShadowRecommendation(value: {
    recommendationId: string;
    poolAddress: string;
    decisionAt: string;
    expiresAt: string;
    state: string;
    noTrade: boolean;
    marketContextHash: string;
    candidateCount: number;
    ranking: Record<string, unknown>;
    economics: Record<string, unknown>;
    reasonCodes: string[];
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertRegimeAssessment(value: {
    poolAddress: string;
    decisionAt: string;
    primaryRegime: string;
    probabilities: unknown[];
    confidence: number;
    stability: number;
    transitionRisk: number;
    evidence: Record<string, unknown>;
    recommendationId?: string;
  }): Promise<void>;
  insertLpThesis(value: {
    thesisId: string;
    recommendationId: string;
    poolAddress: string;
    observedAt: string;
    expiresAt: string;
    selectedCandidateId: string;
    thesis: Record<string, unknown>;
  }): Promise<void>;
  insertEntryEvaluation(value: {
    entryEvaluationId: string;
    thesisId: string;
    poolAddress: string;
    observedAt: string;
    expiresAt: string;
    decision: string;
    readinessScore: number;
    confidence: number;
    reasonCodes: string[];
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertRiskDecision(value: {
    riskDecisionId: string;
    observedAt: string;
    expiresAt: string;
    scope: string;
    decision: string;
    reasonCodes: string[];
    payload: Record<string, unknown>;
  }): Promise<void>;
  upsertPaperPosition(value: {
    paperPositionId: string;
    poolAddress: string;
    thesisId: string;
    candidateId: string;
    state: string;
    capital: number;
    lowerBinId: number;
    upperBinId: number;
    openedAt?: string;
    closedAt?: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertPaperPositionEvent(value: {
    paperPositionId: string;
    observedAt: string;
    priorState?: string;
    nextState: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertManagementDecision(value: {
    managementDecisionId: string;
    paperPositionId: string;
    observedAt: string;
    action: string;
    forwardEv: number;
    alternativeEv?: number;
    reasonCodes: string[];
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertCapitalAllocation(value: {
    allocationId: string;
    observedAt: string;
    poolAddress: string;
    requested: number;
    allocated: number;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertPaperPortfolioSnapshot(value: {
    portfolioId: string;
    observedAt: string;
    totalValue: number;
    cashValue: number;
    deployedValue: number;
    openPositions: number;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertExecutionIntent(value: {
    intentId: string;
    idempotencyKey: string;
    action: string;
    poolAddress?: string;
    ownerAddress: string;
    positionAddress?: string;
    thesisId: string;
    observedAt: string;
    expiresAt: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertTransactionPlan(value: {
    planId: string;
    intentId: string;
    cluster: string;
    state: string;
    createdAt: string;
    expiresAt: string;
    payload: Record<string, unknown>;
    steps: Array<{
      transactionId: string;
      sequence: number;
      kind: string;
      state: string;
      requiredSignerAddresses: string[];
      metadata: Record<string, unknown>;
    }>;
  }): Promise<void>;
  claimNextAutonomousPlan(now: string): Promise<AutonomousPlan | undefined>;
  reserveExecutionCapital(value:ExecutionCapitalReservationRequest):Promise<ExecutionCapitalReservationResult>;
  releaseExecutionCapital(planId:string,at:string,reasonCodes:string[]):Promise<void>;
  markExecutionCapitalSubmitted(planId:string,at:string):Promise<void>;
  reconcileExecutionCapitalReservations(at:string):Promise<void>;
  countExecutionActionsSince(ownerAddress:string,since:string):Promise<number>;
  claimNextAutonomousOpenPlan(now: string): Promise<
    | {
        planId: string;
        intentId: string;
        idempotencyKey: string;
        poolAddress: string;
        ownerAddress: string;
        thesisId: string;
        observedAt: string;
        expiresAt: string;
        intentPayload: Record<string, unknown>;
        planPayload: Record<string, unknown>;
        transactionId: string;
        transactionMetadata: Record<string, unknown>;
        swapTransactionId?: string;
        swapTransactionMetadata?: Record<string, unknown>;
      }
    | undefined
  >;
  transitionAutonomousPlan(value: {
    planId: string;
    state: string;
    at: string;
    reasonCodes?: string[];
    payload: Record<string, unknown>;
  }): Promise<void>;
  completeAutonomousPlan(value: {
    planId: string;
    state:
      | "SIMULATED"
      | "SUBMITTED"
      | "CONFIRMED"
      | "RECONCILED"
      | "BLOCKED"
      | "FAILED"
      | "COMPLETED";
    at: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  upsertOwnedPosition(value: {
    lpforgePositionId: string;
    poolAddress: string;
    positionAddress: string;
    ownerAddress: string;
    strategy: string;
    orientation: string;
    lowerBinId: number;
    upperBinId: number;
    activeBinAtEntry: number;
    initialCapitalLamports: bigint;
    entryPlanId?: string;
    entrySignature?: string;
    enteredAt: string;
    lifecycleState:
      | "OPEN"
      | "CLOSING"
      | "CLOSED"
      | "RECONCILIATION_REQUIRED"
      | "ENTRY_FUNDED_NOT_OPEN"
      | "ABORTED";
    lastPlanId?: string;
    reconciliationStatus: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertPositionObservation(value: {
    lpforgePositionId: string;
    observedAt: string;
    activeBinId?: number;
    rangeState: string;
    tokenXAmount?: string;
    tokenYAmount?: string;
    unclaimedFeeX?: string;
    unclaimedFeeY?: string;
    walletTruth: Record<string, unknown>;
    positionTruth: object;
    managementContext: Record<string, unknown>;
    reconciliationDebt: boolean;
    staleData: boolean;
    payload: Record<string, unknown>;
  }): Promise<void>;
  loadOwnedPositions(ownerAddress: string): Promise<Record<string, unknown>[]>;
  loadPhase7PortfolioFacts(ownerAddress:string):Promise<{deployedLamports:bigint;pendingReservedLamports:bigint;openPositions:number;unresolvedReconciliationDebt:number;poolExposureLamports:Record<string,bigint>;poolPendingLamports:Record<string,bigint>;tokenExposureLamports:Record<string,bigint>;tokenPendingLamports:Record<string,bigint>}>;
  loadPhase7PortfolioRiskState(ownerAddress:string):Promise<Record<string,unknown>|undefined>;
  upsertPhase7PortfolioRiskState(value:{ownerAddress:string;dayStart:string;dailyStartEquityLamports:bigint;peakEquityLamports:bigint;currentEquityLamports:bigint;observedAt:string;valuationState:'RECONCILED'|'UNAVAILABLE';reasonCodes:string[];payload:Record<string,unknown>}):Promise<void>;
  loadPositionExitState(lpforgePositionId: string): Promise<Record<string, unknown> | null>;
  upsertPositionExitState(value: {
    lpforgePositionId:string; observedAt:string; evidenceState:string; initialCapitalUsd?:number; currentEconomicValueUsd?:number;
    netPnlUsd?:number; netReturnFraction?:number; peakNetReturnFraction:number; peakEconomicValueUsd?:number; peakObservedAt:string;
    lastAction:string; reasonCodes:string[]; payload:Record<string,unknown>;
  }): Promise<void>;
  hasActiveAutonomousPlan(positionAddress: string): Promise<boolean>;
  markOwnedPositionLifecycle(value: {
    positionAddress: string;
    lifecycleState:
      | "OPEN"
      | "CLOSING"
      | "CLOSED"
      | "RECONCILIATION_REQUIRED"
      | "ENTRY_FUNDED_NOT_OPEN"
      | "ABORTED";
    reconciliationStatus: string;
    lastPlanId?: string;
    at: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  upsertPartialEntryRecovery(value: {
    planId: string;
    poolAddress: string;
    ownerAddress: string;
    tokenMint: string;
    fundingTransactionId: string;
    fundingSignature: string;
    fundedAt: string;
    pairedTokenAmount: string;
    intendedCapitalLamports: bigint;
    intendedRange: Record<string, unknown>;
    state:
      | "ENTRY_FUNDED_NOT_OPEN"
      | "RESUME_OPEN"
      | "UNWIND_REQUIRED"
      | "UNWIND_SUBMITTED"
      | "RESOLVED"
      | "RECONCILIATION_REQUIRED";
    walletTruth: Record<string, unknown>;
    payload: Record<string, unknown>;
    updatedAt: string;
  }): Promise<void>;
  loadPartialEntryRecoveries(): Promise<Record<string, unknown>[]>;
  loadAutonomousPlan(planId: string): Promise<AutonomousPlan | undefined>;
  loadUnresolvedAutonomousPlans(): Promise<AutonomousPlan[]>;
  insertExecutionSimulation(value: {
    transactionId: string;
    simulatedAt: string;
    freshUntil: string;
    ok: boolean;
    unitsConsumed?: number;
    logs: string[];
    error?: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertExecutionRiskPermit(value: {
    permitId: string;
    planId: string;
    decision: string;
    issuedAt: string;
    expiresAt?: string;
    reasonCodes: string[];
    payload: Record<string, unknown>;
  }): Promise<void>;
  prepareSubmissionAttempt(value: {
    attemptId: string;
    transactionId: string;
    idempotencyKey: string;
    attempt: number;
    signedPayloadFingerprint: string;
    blockhash: string;
    lastValidBlockHeight: number;
    preparedAt: string;
    payload: Record<string, unknown>;
  }): Promise<"PREPARED" | "DUPLICATE">;
  markSubmissionSent(
    attemptId: string,
    signature: string,
    submittedAt: string,
  ): Promise<void>;
  markSubmissionUnknown(
    attemptId: string,
    at: string,
    error: string,
  ): Promise<void>;
  insertExecutionConfirmation(value: {
    attemptId: string;
    signature?: string;
    status: string;
    observedAt: string;
    slot?: bigint;
    error?: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertExecutionReconciliation(value: {
    reconciliationId: string;
    planId: string;
    observedAt: string;
    status: string;
    expected: Record<string, unknown>;
    actual: Record<string, unknown>;
    discrepancies: string[];
    payload: Record<string, unknown>;
  }): Promise<void>;
  createExecutionJournal(value: {
    journalId: string;
    idempotencyKey: string;
    planId: string;
    transactionId?: string;
    state: string;
    signature?: string;
    blockhash?: string;
    lastValidBlockHeight?: number;
    version: number;
    updatedAt: string;
    payload: Record<string, unknown>;
  }): Promise<boolean>;
  updateExecutionJournal(value: {
    idempotencyKey: string;
    expectedVersion: number;
    state: string;
    signature?: string;
    blockhash?: string;
    lastValidBlockHeight?: number;
    updatedAt: string;
    payload: Record<string, unknown>;
  }): Promise<boolean>;
  getExecutionJournal(
    idempotencyKey: string,
  ): Promise<Record<string, unknown> | undefined>;
  insertCanaryRun(value: {
    runId: string;
    planId?: string;
    poolAddress: string;
    action: string;
    capitalLamports: bigint;
    status: string;
    startedAt: string;
    endedAt?: string;
    signature?: string;
    reconciliationStatus?: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  loadOperationalHistory(
    poolAddress: string,
    since: string,
    limit: number,
  ): Promise<{
    marketObservations: Array<{
      observedAt: string;
      price: number;
      activeBinId?: number;
      resolutionMs?: number;
      volume?: number;
      feeValue?: number;
      localLiquidity?: number;
    }>;
    activeBins: Array<{ observedAt: string; activeBinId: number }>;
    binFrames: Array<{
      observedAt: string;
      activeBinId: number;
      bins: Array<{
        binId: number;
        price: string;
        amountX: string;
        amountY: string;
        liquiditySupply?: string;
      }>;
    }>;
    swapEvents: SwapEventFact[];
  }>;
  loadRegimeAssessmentHistory(
    poolAddress: string,
    through: string,
    limit: number,
  ): Promise<RegimeHistorySample[]>;
  getLatestOpenPaperPosition(
    poolAddress: string,
  ): Promise<Record<string, unknown> | undefined>;
  insertOperationalCycle(value: {
    cycleId: string;
    poolAddress: string;
    observedAt: string;
    phase3Status: string;
    phase4Status: string;
    phase5Status: string;
    recommendationId?: string;
    thesisId?: string;
    entryDecision?: string;
    planId?: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  upsertRuntimeHeartbeat(value: {
    runtimeId: string;
    poolAddress: string;
    observedAt: string;
    status: string;
    cycleId?: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertDevnetValidationRun(value: {
    runId: string;
    observedAt: string;
    rpcUrl: string;
    stage: string;
    status: string;
    signature?: string;
    slot?: bigint;
    payload: Record<string, unknown>;
  }): Promise<void>;
  upsertPhase6CanarySession(value: {
    sessionId: string;
    poolAddress: string;
    ownerAddress: string;
    capitalLamports: bigint;
    status: string;
    openedAt?: string;
    closedAt?: string;
    openSignature?: string;
    closeSignature?: string;
    openReconciliationStatus?: string;
    closeReconciliationStatus?: string;
    executionCostLamports: bigint;
    duplicateSubmissionCount: number;
    recoveryEvents: number;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertPhase6CanaryObservation(value: {
    sessionId: string;
    observedAt: string;
    decision: string;
    forwardEv: number;
    inRange: boolean;
    inventoryRiskFraction: number;
    feesAccruedValue: number;
    netPnlValue: number;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertPhase6StageEvidence(value: {
    evidenceId: string;
    stage: string;
    status: "PASS" | "HOLD" | "BLOCK";
    observedAt: string;
    evidenceHash?: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertPhase7OperatorAction(value: {
    actionId: string;
    operatorId: string;
    action: string;
    requestedAt: string;
    approvalId: string;
    reason: string;
    targetType?: string;
    targetId?: string;
    beforeHash: string;
    afterHash: string;
    result: "APPLIED" | "WORKFLOW_REQUESTED";
    payload: Record<string, unknown>;
  }): Promise<void>;
  upsertPhase7RuntimeLease(value: {
    runtimeId: string;
    holderId: string;
    acquiredAt: string;
    expiresAt: string;
    generation: number;
  }): Promise<void>;
  getPhase7RuntimeLease(
    runtimeId: string,
  ): Promise<Record<string, unknown> | undefined>;
  claimPhase7RuntimeLease(value: {
    runtimeId: string;
    holderId: string;
    now: string;
    expiresAt: string;
  }): Promise<Record<string, unknown> | undefined>;
  insertPhase7RuntimeCycle(value: {
    cycleKey: string;
    runtimeId: string;
    instanceId: string;
    observedAt: string;
    plan: "RECOVER_ONLY" | "OBSERVE_ONLY" | "DECISION_CYCLE" | "HOLD";
    economicActionKey?: string;
    payload: Record<string, unknown>;
  }): Promise<boolean>;
  loadRecentPhase7RuntimeCycles(
    runtimeId: string,
    limit: number,
  ): Promise<Record<string, unknown>[]>;
  insertPhase7HealthAssessment(value: {
    assessmentId: string;
    runtimeId: string;
    cycleKey: string;
    observedAt: string;
    status: "HEALTHY" | "DEGRADED" | "CRITICAL";
    newEntriesAllowed: boolean;
    managementWritesAllowed: boolean;
    reasonCodes: string[];
    domainStatus: Record<string, unknown>;
    payload: Record<string, unknown>;
  }): Promise<void>;
  loadLatestPhase7HealthAssessment(
    runtimeId: string,
  ): Promise<Record<string, unknown> | undefined>;
  insertPhase7DriftAssessment(value: {
    assessmentId: string;
    policyHash?: string;
    observedAt: string;
    status: "STABLE" | "WATCH" | "BLOCK";
    sampleCount: number;
    reasonCodes: string[];
    deltas: Record<string, number>;
    payload: Record<string, unknown>;
  }): Promise<void>;
  loadLatestPhase7DriftAssessment(): Promise<
    Record<string, unknown> | undefined
  >;
  upsertPhase7IncidentState(value: {
    incidentId: string;
    incidentType: string;
    severity: "WARNING" | "CRITICAL";
    status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
    openedAt: string;
    observedAt: string;
    resolvedAt?: string;
    poolAddress?: string;
    tokenMint?: string;
    reasonCodes: string[];
    payload: Record<string, unknown>;
  }): Promise<void>;
  loadActivePhase7Incidents(): Promise<Record<string, unknown>[]>;
  insertPhase7ControlDecision(value: {
    decisionId: string;
    runtimeId: string;
    cycleKey: string;
    observedAt: string;
    authorityMode: "OBSERVE_ONLY" | "LIMITED_LIVE" | "PRODUCTION";
    healthStatus: "HEALTHY" | "DEGRADED" | "CRITICAL";
    driftStatus: "STABLE" | "WATCH" | "BLOCK";
    safetyMode: "NORMAL" | "ENTRIES_PAUSED" | "EMERGENCY_ONLY";
    daemonPlan: "RECOVER_ONLY" | "OBSERVE_ONLY" | "DECISION_CYCLE" | "HOLD";
    newEconomicActionAllowed: boolean;
    reasonCodes: string[];
    payload: Record<string, unknown>;
  }): Promise<void>;
  loadLatestPhase7ControlDecision(
    runtimeId: string,
  ): Promise<Record<string, unknown> | undefined>;
  insertPhase7EvidenceSnapshot(value: {
    snapshotId: string;
    runtimeId: string;
    cycleKey: string;
    observedAt: string;
    implementationStatus: "PASS" | "FAIL" | "UNKNOWN";
    operationalStatus: "PASS" | "HOLD" | "BLOCK" | "UNKNOWN";
    payload: Record<string, unknown>;
  }): Promise<void>;
  loadLatestPhase7EvidenceSnapshot(
    runtimeId: string,
  ): Promise<Record<string, unknown> | undefined>;
  insertPhase7EvidencePack(value: {
    packHash: string;
    packId: string;
    sourceCommit: string;
    policyHash: string;
    complete: boolean;
    operationalPass: boolean;
    createdAt: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertPhase7StageEvidence(value: {
    evidenceId: string;
    stage: string;
    status: "PASS" | "HOLD" | "BLOCK";
    observedAt: string;
    evidenceHash?: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  loadPhase7HealthFacts(poolAddress: string): Promise<{
    latestDecisionAt?: string;
    unknownSubmissionCount: number;
    unresolvedReconciliationDebt: number;
    activeExecutionJournalCount: number;
    openCanarySessionCount: number;
    latestPortfolioObservedAt?: string;
  }>;
  loadPhase7DriftFacts(
    poolAddress: string,
    since: string,
  ): Promise<{
    cycleCount: number;
    noTradeCount: number;
    entryReadyCount: number;
    reconciliationCount: number;
    reconciliationMismatchCount: number;
    canaryCapitalLamports: number;
    canaryExecutionCostLamports: number;
    featureMissingCount: number;
  }>;
  loadPhase7RecoveryFacts(runtimeId: string): Promise<{
    previousCompletedCycleKeys: string[];
    completedEconomicActionKeys: string[];
    recoveryQueueCount: number;
    unknownSubmissionCount: number;
    unresolvedReconciliationDebt: number;
  }>;
  loadPhase7EvidenceFacts(runtimeId: string): Promise<{
    latestHealthStatus?: string;
    latestDriftStatus?: string;
    latestSafetyMode?: string;
    latestRuntimePlan?: string;
    runtimeCycleCount: number;
    unresolvedReconciliationDebt: number;
    canaryRunCount: number;
    fullyReconciledCanaryCount: number;
    latestDrStatus?: string;
    latestLimitedLiveStatus?: string;
    latestProductionStatus?: string;
    phase7ExitPass: boolean;
    mainnetReadOnlyCycleCount: number;
    submissionCount: number;
  }>;
}

type QueryResult = { rows: Record<string, unknown>[] };
type PgClient = {
  query: (text: string, values?: unknown[]) => Promise<QueryResult>;
  end: () => Promise<void>;
};
async function newPgClient(url: string): Promise<PgClient> {
  const name = "pg";
  const mod = (await import(name)) as unknown as {
    Client: new (opts: {
      connectionString: string;
    }) => PgClient & { connect: () => Promise<void> };
  };
  const client = new mod.Client({ connectionString: url });
  await client.connect();
  return client;
}
const json = (v: unknown) =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));
/**
 * PostgreSQL timestamptz values arrive as Date instances. Do not round-trip a
 * Date through String(date): that presentation omits milliseconds and breaks
 * the exact provenance binding between the intent and plan payload.
 */
export function toIsoTimestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("LPFORGE_DB_TIMESTAMP_INVALID");
  return date.toISOString();
}
function autonomousPlanFromRow(row: Record<string, unknown>): AutonomousPlan {
  const rawSteps = Array.isArray(row.steps) ? row.steps : [];
  const steps = rawSteps
    .map((value): AutonomousPlanStep => {
      const step = (value ?? {}) as Record<string, unknown>;
      return {
        transactionId: String(step.transactionId),
        sequence: Number(step.sequence),
        kind: String(step.kind),
        state: String(step.state),
        requiredSignerAddresses: Array.isArray(step.requiredSignerAddresses)
          ? step.requiredSignerAddresses.map(String)
          : [],
        metadata: (step.metadata ?? {}) as Record<string, unknown>,
      };
    })
    .sort((a, b) => a.sequence - b.sequence);
  return {
    planId: String(row.plan_id),
    intentId: String(row.intent_id),
    idempotencyKey: String(row.idempotency_key),
    action: String(row.action) as AutonomousPlanAction,
    poolAddress: String(row.pool_address),
    ownerAddress: String(row.owner_address),
    ...(row.position_address
      ? { positionAddress: String(row.position_address) }
      : {}),
    thesisId: String(row.thesis_id),
    observedAt: toIsoTimestamp(row.observed_at),
    expiresAt: toIsoTimestamp(row.expires_at),
    intentPayload: (row.intent_payload ?? {}) as Record<string, unknown>,
    planPayload: (row.plan_payload ?? {}) as Record<string, unknown>,
    steps,
  };
}

export function regimeHistorySampleFromDbRow(
  r: Record<string, unknown>,
): RegimeHistorySample {
  const observedAt = new Date(String(r.decision_at)).toISOString();
  const probabilities = (
    Array.isArray(r.probabilities) ? r.probabilities : []
  ).flatMap((x): ProbabilityEntry[] => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>,
      label = String(o.label) as Phase3RegimeLabel,
      probability = Number(o.probability);
    return Number.isFinite(probability) ? [{ label, probability }] : [];
  });
  return {
    primary: String(r.primary_regime) as Phase3RegimeLabel,
    probabilities,
    confidence: Number(r.confidence),
    stability: Number(r.stability),
    transitionRisk: Number(r.transition_risk),
    observedAt,
  };
}

export function swapEventFromDbRow(r: Record<string, unknown>): SwapEventFact {
  return {
    signature: String(r.signature),
    eventIndex: Number(r.event_index),
    pool: String(r.pool_address),
    ...(r.start_bin_id !== null && r.start_bin_id !== undefined
      ? { startBinId: Number(r.start_bin_id) }
      : {}),
    ...(r.end_bin_id !== null && r.end_bin_id !== undefined
      ? { endBinId: Number(r.end_bin_id) }
      : {}),
    ...(typeof r.swap_for_y === "boolean" ? { swapForY: r.swap_for_y } : {}),
    ...(r.amount_in !== null && r.amount_in !== undefined
      ? { amountIn: String(r.amount_in) }
      : {}),
    ...(r.amount_left !== null && r.amount_left !== undefined
      ? { amountLeft: String(r.amount_left) }
      : {}),
    ...(r.amount_out !== null && r.amount_out !== undefined
      ? { amountOut: String(r.amount_out) }
      : {}),
    ...(r.fee_bps !== null && r.fee_bps !== undefined
      ? { feeBps: String(r.fee_bps) }
      : {}),
    ...(r.mm_fee !== null && r.mm_fee !== undefined
      ? { mmFee: String(r.mm_fee) }
      : {}),
    ...(r.protocol_fee !== null && r.protocol_fee !== undefined
      ? { protocolFee: String(r.protocol_fee) }
      : {}),
    ...(r.limit_order_fee !== null && r.limit_order_fee !== undefined
      ? { limitOrderFee: String(r.limit_order_fee) }
      : {}),
    ...(r.host_fee !== null && r.host_fee !== undefined
      ? { hostFee: String(r.host_fee) }
      : {}),
    ...(typeof r.fees_on_input === "boolean"
      ? { feesOnInput: r.fees_on_input }
      : {}),
    ...(typeof r.fees_on_token_x === "boolean"
      ? { feesOnTokenX: r.fees_on_token_x }
      : {}),
    stamp: {
      source: "SOLANA_RPC",
      ...(r.chain_slot !== null && r.chain_slot !== undefined
        ? { chainSlot: BigInt(String(r.chain_slot)) }
        : {}),
      ...(r.block_time
        ? { blockTime: new Date(String(r.block_time)).toISOString() }
        : {}),
      observedAt: new Date(String(r.observed_at)).toISOString(),
    },
    raw: (r.payload ?? {}) as Record<string, unknown>,
  };
}

export async function createPostgresStore(
  databaseUrl: string,
): Promise<Phase1Store> {
  const db = await newPgClient(databaseUrl);
  const upsertToken = async (t: TokenFact): Promise<void> => {
    await db.query(
      `INSERT INTO protocol.tokens(mint,decimals,token_program,symbol,name) VALUES($1,$2,$3,$4,$5) ON CONFLICT(mint) DO UPDATE SET decimals=COALESCE(EXCLUDED.decimals,protocol.tokens.decimals),token_program=COALESCE(EXCLUDED.token_program,protocol.tokens.token_program),symbol=COALESCE(EXCLUDED.symbol,protocol.tokens.symbol),name=COALESCE(EXCLUDED.name,protocol.tokens.name)`,
      [
        t.mint,
        t.decimals ?? null,
        t.tokenProgram ?? null,
        t.symbol ?? null,
        t.name ?? null,
      ],
    );
  };
  const upsertPool = async (p: PoolStateFact): Promise<void> => {
    await upsertToken({ mint: p.tokenXMint });
    await upsertToken({ mint: p.tokenYMint });
    await db.query(
      `INSERT INTO protocol.pools(address,token_x_mint,token_y_mint,bin_step,function_type,collect_fee_mode) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(address) DO UPDATE SET token_x_mint=EXCLUDED.token_x_mint,token_y_mint=EXCLUDED.token_y_mint,bin_step=EXCLUDED.bin_step,function_type=EXCLUDED.function_type,collect_fee_mode=EXCLUDED.collect_fee_mode,last_seen_at=now()`,
      [
        p.address,
        p.tokenXMint,
        p.tokenYMint,
        p.binStep,
        p.functionType,
        p.collectFeeMode,
      ],
    );
  };
  return {
    async health() {
      try {
        await db.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      await db.end();
    },
    upsertToken,
    upsertPool,
    async insertCompatibility(c) {
      await db.query(
        `INSERT INTO protocol.compatibility_checks(checked_at,program_id,sdk_version,decoder_version,state,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          c.checkedAt,
          c.programId,
          c.expectedSdkVersion,
          c.decoderVersion,
          c.state,
          JSON.stringify(c.details),
        ],
      );
    },
    async insertPoolSnapshot(p) {
      await upsertPool(p);
      await db.query(
        `INSERT INTO protocol.pool_snapshots(pool_address,chain_slot,active_bin_id,base_fee_pct,dynamic_fee_pct,max_fee_pct,protocol_fee_pct,reserve_x,reserve_y,observed_at,source,raw) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [
          p.address,
          p.stamp.chainSlot?.toString() ?? null,
          p.activeBinId,
          p.baseFeePct ?? null,
          p.dynamicFeePct ?? null,
          p.maxFeePct ?? null,
          p.protocolFeePct ?? null,
          p.reserveX ?? null,
          p.reserveY ?? null,
          p.stamp.observedAt,
          p.stamp.source,
          JSON.stringify(p.raw ?? {}),
        ],
      );
    },
    async insertBins(bins) {
      for (const b of bins)
        await db.query(
          `INSERT INTO protocol.bin_snapshots(pool_address,bin_id,chain_slot,price,amount_x,amount_y,liquidity_supply,fee_amount_x_per_token_stored,fee_amount_y_per_token_stored,observed_at,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(pool_address,bin_id,observed_at) DO NOTHING`,
          [
            b.pool,
            b.binId,
            b.stamp.chainSlot?.toString() ?? null,
            b.price,
            b.amountX,
            b.amountY,
            b.liquiditySupply ?? null,
            b.feeAmountXPerTokenStored ?? null,
            b.feeAmountYPerTokenStored ?? null,
            b.stamp.observedAt,
            b.stamp.source,
          ],
        );
    },
    async upsertPosition(p) {
      await db.query(
        `INSERT INTO protocol.positions(address,pool_address,owner,fee_owner,lower_bin_id,upper_bin_id,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(address) DO UPDATE SET owner=EXCLUDED.owner,fee_owner=EXCLUDED.fee_owner,lower_bin_id=EXCLUDED.lower_bin_id,upper_bin_id=EXCLUDED.upper_bin_id,last_seen_at=EXCLUDED.last_seen_at`,
        [
          p.address,
          p.pool,
          p.owner,
          p.feeOwner ?? null,
          p.lowerBinId,
          p.upperBinId,
          p.stamp.observedAt,
        ],
      );
      await db.query(
        `INSERT INTO protocol.position_snapshots(position_address,pool_address,chain_slot,total_x,total_y,fee_x,fee_y,observed_at,source,raw) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [
          p.address,
          p.pool,
          p.stamp.chainSlot?.toString() ?? null,
          p.totalXAmount,
          p.totalYAmount,
          p.feeX ?? null,
          p.feeY ?? null,
          p.stamp.observedAt,
          p.stamp.source,
          JSON.stringify(p.raw ?? {}),
        ],
      );
    },
    async insertSwapEvent(e) {
      await db.query(
        `INSERT INTO protocol.swap_events(signature,event_index,pool_address,chain_slot,block_time,observed_at,start_bin_id,end_bin_id,swap_for_y,amount_in,amount_left,amount_out,fee_bps,mm_fee,protocol_fee,limit_order_fee,host_fee,fees_on_input,fees_on_token_x,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb) ON CONFLICT(signature,event_index) DO NOTHING`,
        [
          e.signature,
          e.eventIndex,
          e.pool,
          e.stamp.chainSlot?.toString() ?? null,
          e.stamp.blockTime ?? null,
          e.stamp.observedAt,
          e.startBinId ?? null,
          e.endBinId ?? null,
          e.swapForY ?? null,
          e.amountIn ?? null,
          e.amountLeft ?? null,
          e.amountOut ?? null,
          e.feeBps ?? null,
          e.mmFee ?? null,
          e.protocolFee ?? null,
          e.limitOrderFee ?? null,
          e.hostFee ?? null,
          e.feesOnInput ?? null,
          e.feesOnTokenX ?? null,
          JSON.stringify(e.raw),
        ],
      );
    },
    async getCheckpoint(stream) {
      const r = await db.query(
        `SELECT stream,last_seen_slot,last_fully_processed_slot,state FROM governance.ingestion_checkpoints WHERE stream=$1`,
        [stream],
      );
      const row = r.rows[0];
      if (!row) return undefined;
      return {
        stream: String(row.stream),
        ...(row.last_seen_slot != null
          ? { lastSeenSlot: BigInt(String(row.last_seen_slot)) }
          : {}),
        ...(row.last_fully_processed_slot != null
          ? {
              lastFullyProcessedSlot: BigInt(
                String(row.last_fully_processed_slot),
              ),
            }
          : {}),
        state: (row.state ?? {}) as Record<string, unknown>,
      };
    },
    async setCheckpoint(c) {
      await db.query(
        `INSERT INTO governance.ingestion_checkpoints(stream,last_seen_slot,last_fully_processed_slot,state) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(stream) DO UPDATE SET last_seen_slot=EXCLUDED.last_seen_slot,last_fully_processed_slot=EXCLUDED.last_fully_processed_slot,state=EXCLUDED.state,updated_at=now()`,
        [
          c.stream,
          c.lastSeenSlot?.toString() ?? null,
          c.lastFullyProcessedSlot?.toString() ?? null,
          JSON.stringify(c.state),
        ],
      );
    },
    async insertDataApiPool(pool, observedAt) {
      await db.query(
        `INSERT INTO market.data_api_pool_snapshots(pool_address,observed_at,payload) VALUES($1,$2,$3::jsonb)`,
        [String(pool.address ?? ""), observedAt, JSON.stringify(pool)],
      );
    },
    async insertOhlcv(poolAddress, timeframe, candles, observedAt, origin) {
      for (const candle of candles) {
        const ts = Number(candle.timestamp);
        if (!Number.isFinite(ts)) continue;
        await db.query(
          `INSERT INTO market.ohlcv(pool_address,timeframe,bucket_time,open,high,low,close,volume,origin,observed_at) VALUES($1,$2,to_timestamp($3),$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(pool_address,timeframe,bucket_time,origin) DO UPDATE SET open=EXCLUDED.open,high=EXCLUDED.high,low=EXCLUDED.low,close=EXCLUDED.close,volume=EXCLUDED.volume,observed_at=EXCLUDED.observed_at`,
          [
            poolAddress,
            timeframe,
            ts,
            candle.open,
            candle.high,
            candle.low,
            candle.close,
            candle.volume,
            origin,
            observedAt,
          ],
        );
      }
    },
    async insertFeatureSnapshot(s, hash) {
      await db.query(
        `INSERT INTO features.feature_snapshots(pool_address,schema_version,source_watermark,freshness,missing,features,canonical_hash,created_at) VALUES($1,$2,$3::jsonb,$4,$5::jsonb,$6::jsonb,$7,$8)`,
        [
          s.pool,
          s.schemaVersion,
          JSON.stringify(s.sourceWatermark, (_, v) =>
            typeof v === "bigint" ? v.toString() : v,
          ),
          s.freshness,
          JSON.stringify(s.missing),
          JSON.stringify(s.features),
          hash,
          s.createdAt,
        ],
      );
    },
    async insertPositionValuation(v) {
      await db.query(
        `INSERT INTO accounting.position_valuations(position_address,pool_address,chain_slot,observed_at,valuation) VALUES($1,$2,$3,$4,$5::jsonb)`,
        [
          v.positionAddress,
          v.poolAddress,
          v.chainSlot?.toString() ?? null,
          v.observedAt,
          JSON.stringify(v.valuation),
        ],
      );
    },
    async insertSimulationRun(v) {
      await db.query(
        `INSERT INTO research.simulation_runs(pool_address,simulator_version,fidelity,policy_id,opened_at,ended_at,lower_bin_id,upper_bin_id,input_hash,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT(input_hash,simulator_version) DO NOTHING`,
        [
          v.poolAddress,
          v.simulatorVersion,
          v.fidelity,
          v.policyId ?? null,
          v.openedAt,
          v.endedAt,
          v.lowerBinId,
          v.upperBinId,
          v.inputHash,
          json(v.result),
        ],
      );
    },
    async insertPoolAssessment(v) {
      await db.query(
        `INSERT INTO research.pool_assessments(pool_address,policy_id,eligibility,pool_quality_score,economic_quality_score,flow_quality_score,liquidity_quality_score,token_risk_score,toxicity_probability,archetype,blockers,warnings,evidence,assessed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14)`,
        [
          v.poolAddress,
          v.policyId,
          v.eligibility,
          v.poolQualityScore,
          v.economicQualityScore,
          v.flowQualityScore,
          v.liquidityQualityScore,
          v.tokenRiskScore,
          v.toxicityProbability,
          v.archetype,
          json(v.blockers),
          json(v.warnings),
          json(v.evidence),
          v.assessedAt,
        ],
      );
    },
    async upsertDiscoveryPool(v) {
      await db.query(
        `INSERT INTO market.pool_discovery_registry(pool_address,first_seen_at,last_seen_at,source_manual,source_auto,token_x_mint,token_y_mint,paired_token_mint,paired_token_symbol,market_cap_cohort,current_state,current_tier,last_priority_score,last_rank,last_universe_percentile,reason_codes,evidence_state,payload) VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb) ON CONFLICT(pool_address) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at,source_manual=market.pool_discovery_registry.source_manual OR EXCLUDED.source_manual,source_auto=market.pool_discovery_registry.source_auto OR EXCLUDED.source_auto,token_x_mint=COALESCE(EXCLUDED.token_x_mint,market.pool_discovery_registry.token_x_mint),token_y_mint=COALESCE(EXCLUDED.token_y_mint,market.pool_discovery_registry.token_y_mint),paired_token_mint=COALESCE(EXCLUDED.paired_token_mint,market.pool_discovery_registry.paired_token_mint),paired_token_symbol=COALESCE(EXCLUDED.paired_token_symbol,market.pool_discovery_registry.paired_token_symbol),market_cap_cohort=EXCLUDED.market_cap_cohort,current_state=CASE WHEN EXCLUDED.current_state='PREFILTERED' AND market.pool_discovery_registry.current_state IN ('ACTIVE_CANDIDATE','WATCHLIST','QUALIFIED') AND COALESCE(EXCLUDED.payload->>'deepScreened','false')<>'true' THEN market.pool_discovery_registry.current_state ELSE EXCLUDED.current_state END,current_tier=CASE WHEN EXCLUDED.current_state='PREFILTERED' AND market.pool_discovery_registry.current_state IN ('ACTIVE_CANDIDATE','WATCHLIST','QUALIFIED') AND COALESCE(EXCLUDED.payload->>'deepScreened','false')<>'true' THEN market.pool_discovery_registry.current_tier ELSE EXCLUDED.current_tier END,last_priority_score=EXCLUDED.last_priority_score,last_rank=EXCLUDED.last_rank,last_universe_percentile=EXCLUDED.last_universe_percentile,reason_codes=EXCLUDED.reason_codes,evidence_state=EXCLUDED.evidence_state,payload=market.pool_discovery_registry.payload || EXCLUDED.payload`,
        [v.poolAddress,v.observedAt,v.sourceManual,v.sourceAuto,v.tokenXMint??null,v.tokenYMint??null,v.pairedTokenMint??null,v.pairedTokenSymbol??null,v.marketCapCohort,v.state,v.tier,v.priorityScore,v.rank??null,v.universePercentile??null,json(v.reasonCodes),json(v.evidenceState),json(v.payload)],
      );
    },
    async insertDiscoveryObservation(v) {
      const m=v.metrics;
      await db.query(
        `INSERT INTO market.pool_discovery_observations(pool_address,observed_at,policy_id,source,decision,priority_score,tvl_usd,volume_30m_usd,volume_1h_usd,volume_24h_usd,fees_30m_usd,fees_1h_usd,fees_24h_usd,fee_tvl_30m,fee_tvl_1h,fee_tvl_24h,market_cap_usd,liquidity_to_market_cap,volume_24h_to_market_cap,fees_24h_to_market_cap,holders,hard_reasons,warnings,selection_reasons,evidence_state,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,$24::jsonb,$25::jsonb,$26::jsonb) ON CONFLICT(pool_address,observed_at,policy_id) DO NOTHING`,
        [v.poolAddress,v.observedAt,v.policyId,v.source,v.decision,v.priorityScore,m.tvlUsd??null,m.volume30mUsd??null,m.volume1hUsd??null,m.volume24hUsd??null,m.fees30mUsd??null,m.fees1hUsd??null,m.fees24hUsd??null,m.feeTvl30m??null,m.feeTvl1h??null,m.feeTvl24h??null,m.marketCapUsd??null,m.liquidityToMarketCap??null,m.volume24hToMarketCap??null,m.fees24hToMarketCap??null,m.holders??null,json(v.hardReasons),json(v.warnings),json(v.selectionReasons),json(v.evidenceState),json(v.payload)],
      );
    },
    async insertDiscoveryRanking(v) {
      await db.query(
        `INSERT INTO market.pool_discovery_rankings(ranking_cycle_id,pool_address,observed_at,policy_id,rank,universe_percentile,fee_percentile,volume_percentile,liquidity_percentile,priority_score,state,tier,reason_codes,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb) ON CONFLICT(ranking_cycle_id,pool_address) DO UPDATE SET rank=EXCLUDED.rank,universe_percentile=EXCLUDED.universe_percentile,fee_percentile=EXCLUDED.fee_percentile,volume_percentile=EXCLUDED.volume_percentile,liquidity_percentile=EXCLUDED.liquidity_percentile,priority_score=EXCLUDED.priority_score,state=EXCLUDED.state,tier=EXCLUDED.tier,reason_codes=EXCLUDED.reason_codes,payload=EXCLUDED.payload`,
        [v.rankingCycleId,v.poolAddress,v.observedAt,v.policyId,v.rank,v.universePercentile,v.feePercentile??null,v.volumePercentile??null,v.liquidityPercentile??null,v.priorityScore,v.state,v.tier,json(v.reasonCodes),json(v.payload)],
      );
    },
    async listDiscoveryCandidates(tiers=['A']) {
      const r=await db.query(`SELECT pool_address,current_state,current_tier,last_priority_score,last_rank,last_seen_at,token_x_mint,token_y_mint,paired_token_mint,COALESCE(NULLIF(payload->>'deepScreenedAt','')::timestamptz,last_seen_at) AS admission_seen_at,payload FROM market.pool_discovery_registry WHERE current_tier=ANY($1::text[]) ORDER BY last_rank NULLS LAST,last_priority_score DESC,pool_address`,[tiers]);
      return r.rows.map(row=>({poolAddress:String(row.pool_address),state:String(row.current_state),tier:String(row.current_tier),priorityScore:Number(row.last_priority_score),...(row.last_rank!==null?{rank:Number(row.last_rank)}:{}),lastSeenAt:new Date(String(row.admission_seen_at)).toISOString(),...(row.token_x_mint?{tokenXMint:String(row.token_x_mint)}:{}),...(row.token_y_mint?{tokenYMint:String(row.token_y_mint)}:{}),...(row.paired_token_mint?{pairedTokenMint:String(row.paired_token_mint)}:{}),payload:(row.payload??{}) as Record<string,unknown>}));
    },
    async markDiscoveryPoolsStale(cutoff, observedAt) {
      const r=await db.query(`UPDATE market.pool_discovery_registry SET current_state='OBSERVING',current_tier='C',reason_codes=CASE WHEN reason_codes ? 'DISCOVERY_STALE' THEN reason_codes ELSE reason_codes || '["DISCOVERY_STALE"]'::jsonb END,evidence_state=jsonb_set(evidence_state,'{discoveryFreshness}','"STALE"'::jsonb,true),payload=jsonb_set(payload,'{staleMarkedAt}',to_jsonb($2::text),true) WHERE last_seen_at<$1::timestamptz AND current_state NOT IN ('REJECTED','QUARANTINED') RETURNING pool_address`,[cutoff,observedAt]);
      return r.rows.length;
    },
    async insertFeeVolumeObservations(v){
      for(const row of v.rows){const payload=row.payload??{};const sourceHash=await sha256Hex(canonicalJson({pool:v.poolAddress,bucketAt:row.bucketAt,source:v.source,fees:row.fees??null,protocolFees:row.protocolFees??null,volume:row.volume??null,payload}));await db.query(`INSERT INTO market.pool_fee_volume_observations(pool_address,bucket_at,source,fees,protocol_fees,volume,observed_at,source_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(pool_address,bucket_at,source) DO UPDATE SET fees=EXCLUDED.fees,protocol_fees=EXCLUDED.protocol_fees,volume=EXCLUDED.volume,observed_at=EXCLUDED.observed_at,source_hash=EXCLUDED.source_hash,payload=EXCLUDED.payload`,[v.poolAddress,row.bucketAt,v.source,row.fees??null,row.protocolFees??null,row.volume??null,v.observedAt,sourceHash,json(payload)]);}
    },
    async loadFeeVolumeObservations(poolAddress,since,limit=1000){const r=await db.query(`SELECT DISTINCT ON(bucket_at) bucket_at,fees,protocol_fees,volume,source,source_hash FROM market.pool_fee_volume_observations WHERE pool_address=$1 AND bucket_at>=$2::timestamptz ORDER BY bucket_at ASC,CASE WHEN upper(COALESCE(payload->>'evidenceState',''))='MEASURED' THEN 0 WHEN COALESCE(fees,0)>0 OR COALESCE(protocol_fees,0)>0 OR COALESCE(volume,0)>0 THEN 1 WHEN upper(COALESCE(payload->>'evidenceState',''))='PARTIAL' THEN 2 WHEN source='METEORA_API_ROLLING_5M' AND COALESCE(fees,0)=0 AND COALESCE(protocol_fees,0)=0 AND COALESCE(volume,0)=0 THEN 4 ELSE 3 END,CASE WHEN source='METEORA_API_ROLLING_5M' THEN 0 ELSE 1 END,observed_at DESC LIMIT $3`,[poolAddress,since,Math.max(1,Math.min(2000,limit))]);return r.rows.map(row=>({bucketAt:new Date(String(row.bucket_at)).toISOString(),fees:Number(row.fees??0),protocolFees:Number(row.protocol_fees??0),volume:Number(row.volume??0),source:String(row.source),sourceHash:String(row.source_hash)}));},
    async insertCandidateMarketObservations(v){for(const row of v.rows){if(!(Number(row.price)>0)||!Number.isFinite(Date.parse(row.observedAt)))continue;const payload=row.payload??{},resolutionMs=Math.max(1_000,Math.min(15*60_000,Math.floor(row.resolutionMs??60_000)));const sourceHash=await sha256Hex(canonicalJson({pool:v.poolAddress,observedAt:row.observedAt,sourceType:row.sourceType,sourceProvider:row.sourceProvider,price:row.price,resolutionMs,activeBinId:row.activeBinId??null,volume:row.volume??null,feeValue:row.feeValue??null,localLiquidity:row.localLiquidity??null,payload}));await db.query(`INSERT INTO market.candidate_market_observations(pool_address,observed_at,ingested_at,source_type,source_provider,price,active_bin_id,resolution_ms,volume,fee_value,local_liquidity,source_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) ON CONFLICT(pool_address,observed_at,source_type) DO UPDATE SET ingested_at=EXCLUDED.ingested_at,source_provider=EXCLUDED.source_provider,price=EXCLUDED.price,active_bin_id=EXCLUDED.active_bin_id,resolution_ms=EXCLUDED.resolution_ms,volume=EXCLUDED.volume,fee_value=EXCLUDED.fee_value,local_liquidity=EXCLUDED.local_liquidity,source_hash=EXCLUDED.source_hash,payload=EXCLUDED.payload`,[v.poolAddress,row.observedAt,v.ingestedAt,row.sourceType,row.sourceProvider,row.price,row.activeBinId??null,resolutionMs,row.volume??null,row.feeValue??null,row.localLiquidity??null,sourceHash,json(payload)]);}},
    async loadCandidateMarketObservations(poolAddress,since,limit=2000){const r=await db.query(`SELECT observed_at,source_type,source_provider,price,resolution_ms,active_bin_id,volume,fee_value,local_liquidity FROM market.candidate_market_observations WHERE pool_address=$1 AND observed_at>=$2::timestamptz ORDER BY observed_at ASC,CASE source_type WHEN 'LIVE_OBSERVED' THEN 0 ELSE 1 END LIMIT $3`,[poolAddress,since,Math.max(1,Math.min(4000,limit))]);return r.rows.map(row=>({observedAt:toIsoTimestamp(row.observed_at),sourceType:String(row.source_type),sourceProvider:String(row.source_provider),price:Number(row.price),resolutionMs:Number(row.resolution_ms),...(row.active_bin_id!==null?{activeBinId:Number(row.active_bin_id)}:{}),...(row.volume!==null?{volume:Number(row.volume)}:{}),...(row.fee_value!==null?{feeValue:Number(row.fee_value)}:{}),...(row.local_liquidity!==null?{localLiquidity:Number(row.local_liquidity)}:{})}));},
    async upsertActiveCandidateBackfill(v){await db.query(`INSERT INTO market.active_candidate_backfill(pool_address,last_attempt_at,last_successful_at,requested_minutes,covered_minutes,coverage_ratio,fee_bucket_count,ohlcv_bucket_count,swap_event_count,independent_15m_episodes,oldest_evidence_at,newest_evidence_at,quality,reason_codes,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb) ON CONFLICT(pool_address) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at,last_successful_at=COALESCE(EXCLUDED.last_successful_at,market.active_candidate_backfill.last_successful_at),requested_minutes=EXCLUDED.requested_minutes,covered_minutes=EXCLUDED.covered_minutes,coverage_ratio=EXCLUDED.coverage_ratio,fee_bucket_count=EXCLUDED.fee_bucket_count,ohlcv_bucket_count=EXCLUDED.ohlcv_bucket_count,swap_event_count=EXCLUDED.swap_event_count,independent_15m_episodes=EXCLUDED.independent_15m_episodes,oldest_evidence_at=EXCLUDED.oldest_evidence_at,newest_evidence_at=EXCLUDED.newest_evidence_at,quality=EXCLUDED.quality,reason_codes=EXCLUDED.reason_codes,payload=EXCLUDED.payload`,[v.poolAddress,v.lastAttemptAt,v.lastSuccessfulAt??null,v.requestedMinutes,v.coveredMinutes,v.coverageRatio,v.feeBucketCount,v.ohlcvBucketCount,v.swapEventCount,v.independent15mEpisodes,v.oldestEvidenceAt??null,v.newestEvidenceAt??null,v.quality,json(v.reasonCodes),json(v.payload)]);},
    async loadActiveCandidateBackfill(poolAddress){const r=await db.query(`SELECT * FROM market.active_candidate_backfill WHERE pool_address=$1`,[poolAddress]);return r.rows[0] as Record<string,unknown>|undefined;},
    async upsertActiveCandidateHistoryMaturity(v){await db.query(`INSERT INTO market.active_candidate_history_maturity(pool_address,assessed_at,state,market_observation_count,active_bin_observation_count,bin_frame_count,swap_event_count,oldest_observation_at,latest_observation_at,completeness_5m,completeness_15m,completeness_1h,reason_codes,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb) ON CONFLICT(pool_address) DO UPDATE SET assessed_at=EXCLUDED.assessed_at,state=EXCLUDED.state,market_observation_count=EXCLUDED.market_observation_count,active_bin_observation_count=EXCLUDED.active_bin_observation_count,bin_frame_count=EXCLUDED.bin_frame_count,swap_event_count=EXCLUDED.swap_event_count,oldest_observation_at=EXCLUDED.oldest_observation_at,latest_observation_at=EXCLUDED.latest_observation_at,completeness_5m=EXCLUDED.completeness_5m,completeness_15m=EXCLUDED.completeness_15m,completeness_1h=EXCLUDED.completeness_1h,reason_codes=EXCLUDED.reason_codes,payload=EXCLUDED.payload`,[v.poolAddress,v.assessedAt,v.state,v.marketObservationCount,v.activeBinObservationCount,v.binFrameCount,v.swapEventCount,v.oldestObservationAt??null,v.latestObservationAt??null,v.completeness5m,v.completeness15m,v.completeness1h,json(v.reasonCodes),json(v.payload)]);},
    async loadActiveCandidateHistoryMaturity(poolAddress){const r=await db.query(`SELECT * FROM market.active_candidate_history_maturity WHERE pool_address=$1`,[poolAddress]);return r.rows[0] as Record<string,unknown>|undefined;},
    async insertEconomicEstimate(v){await db.query(`INSERT INTO research.economic_estimates(economic_estimate_id,pool_address,as_of,fidelity,raw_observation_count,effective_sample_count,independent_episode_count,fee_observation_count,event_path_observation_count,fee_rate_per_capital_hour,uncertainty,evidence_age_seconds,source_hashes,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb) ON CONFLICT(economic_estimate_id) DO NOTHING`,[v.economicEstimateId,v.poolAddress,v.asOf,v.fidelity,v.rawObservationCount,v.effectiveSampleCount,v.independentEpisodeCount,v.feeObservationCount,v.eventPathObservationCount,v.feeRatePerCapitalHour,v.uncertainty,v.evidenceAgeSeconds,json(v.sourceHashes),json(v.payload)]);},
    async loadLatestEconomicEstimate(poolAddress,through){const r=await db.query(`SELECT * FROM research.economic_estimates WHERE pool_address=$1 AND as_of<=$2::timestamptz ORDER BY as_of DESC LIMIT 1`,[poolAddress,through]);return r.rows[0] as Record<string,unknown>|undefined;},
    async insertDeepScreenObservation(v) {await db.query(`INSERT INTO research.pool_deep_screen_observations(pool_address,observed_at,policy_id,eligibility,pool_quality_score,current_opportunity_score,executable_liquidity_score,fee_quality_score,flow_quality_score,toxicity_probability,opportunity_half_life_minutes,reason_codes,evidence_availability,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb) ON CONFLICT(pool_address,observed_at,policy_id) DO NOTHING`,[v.poolAddress,v.observedAt,v.policyId,v.eligibility,v.poolQualityScore,v.currentOpportunityScore,v.executableLiquidityScore,v.feeQualityScore,v.flowQualityScore,v.toxicityProbability,v.opportunityHalfLifeMinutes??null,json(v.reasonCodes),json(v.evidenceAvailability),json(v.payload)]);},
    async insertUniverseAssignment(v){await db.query(`INSERT INTO market.pool_universe_assignments(assignment_cycle_id,pool_address,observed_at,policy_id,tier,rank,deep_priority,control_cohort,selection_probability,opportunity_half_life_minutes,selection_reason,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb) ON CONFLICT(assignment_cycle_id,pool_address) DO UPDATE SET tier=EXCLUDED.tier,rank=EXCLUDED.rank,deep_priority=EXCLUDED.deep_priority,control_cohort=EXCLUDED.control_cohort,selection_probability=EXCLUDED.selection_probability,opportunity_half_life_minutes=EXCLUDED.opportunity_half_life_minutes,selection_reason=EXCLUDED.selection_reason,payload=EXCLUDED.payload`,[v.assignmentCycleId,v.poolAddress,v.observedAt,v.policyId,v.tier,v.rank??null,v.deepPriority,v.control,v.selectionProbability,v.opportunityHalfLifeMinutes??null,json(v.selectionReason),json(v.payload)]);},
    async insertDiscoveryPrediction(v){await db.query(`INSERT INTO research.discovery_predictions(prediction_id,pool_address,observed_at,policy_version,model_version,cohort,episode_key,selected_action,selection_context,prediction) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) ON CONFLICT(prediction_id) DO NOTHING`,[v.predictionId,v.poolAddress,v.observedAt,v.policyVersion,v.modelVersion,v.cohort,v.episodeKey,v.selectedAction,json(v.selectionContext),json(v.prediction)]);},
    async insertDiscoveryOutcome(v){await db.query(`INSERT INTO research.discovery_outcomes(prediction_id,pool_address,observed_at,horizon_minutes,outcome_class,event_attribution,structural_event_codes,realized_net_value,realized_fees,realized_directional_pnl,range_survived,inventory_conversion,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13::jsonb) ON CONFLICT(prediction_id,horizon_minutes) DO UPDATE SET observed_at=EXCLUDED.observed_at,outcome_class=EXCLUDED.outcome_class,event_attribution=EXCLUDED.event_attribution,structural_event_codes=EXCLUDED.structural_event_codes,realized_net_value=EXCLUDED.realized_net_value,realized_fees=EXCLUDED.realized_fees,realized_directional_pnl=EXCLUDED.realized_directional_pnl,range_survived=EXCLUDED.range_survived,inventory_conversion=EXCLUDED.inventory_conversion,payload=EXCLUDED.payload`,[v.predictionId,v.poolAddress,v.observedAt,v.horizonMinutes,v.outcomeClass,v.eventAttribution,json(v.structuralEventCodes),v.realizedNetValue??null,v.realizedFees??null,v.realizedDirectionalPnl??null,v.rangeSurvived??null,v.inventoryConversion??null,json(v.payload)]);},
    async upsertDiscoveryReputation(v){await db.query(`INSERT INTO research.discovery_reputation(reputation_key,level,as_of,samples,independent_episodes,mean_net,positive_rate,confidence,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(reputation_key) DO UPDATE SET level=EXCLUDED.level,as_of=EXCLUDED.as_of,samples=EXCLUDED.samples,independent_episodes=EXCLUDED.independent_episodes,mean_net=EXCLUDED.mean_net,positive_rate=EXCLUDED.positive_rate,confidence=EXCLUDED.confidence,payload=EXCLUDED.payload`,[v.reputationKey,v.level,v.asOf,v.samples,v.independentEpisodes,v.meanNet,v.positiveRate,v.confidence,json(v.payload)]);},
    async insertDiscoveryCalibration(v){await db.query(`INSERT INTO research.discovery_calibration_snapshots(snapshot_id,observed_at,model_version,sample_count,independent_episodes,brier_profit,survival_brier,net_value_mae,mean_bias,all_outcome_net,model_calibration_net,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) ON CONFLICT(snapshot_id) DO NOTHING`,[v.snapshotId,v.observedAt,v.modelVersion,v.sampleCount,v.independentEpisodes,v.brierProfit??null,v.survivalBrier??null,v.netValueMae??null,v.meanBias??null,v.allOutcomeNet,v.modelCalibrationNet,json(v.payload)]);},
    async insertDiscoveryBaseline(v){await db.query(`INSERT INTO research.discovery_baseline_results(run_id,observed_at,baseline_id,selected_pool_address,information_cutoff,result) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(run_id,baseline_id) DO UPDATE SET result=EXCLUDED.result,selected_pool_address=EXCLUDED.selected_pool_address`,[v.runId,v.observedAt,v.baselineId,v.selectedPoolAddress??null,v.informationCutoff,json(v.result)]);},
    async upsertDiscoveryPolicyProposal(v){await db.query(`INSERT INTO research.discovery_policy_proposals(proposal_id,created_at,state,hypothesis,target_policy,changes,evidence,automatic_promotion) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,FALSE) ON CONFLICT(proposal_id) DO UPDATE SET state=EXCLUDED.state,evidence=EXCLUDED.evidence,changes=EXCLUDED.changes,automatic_promotion=FALSE`,[v.proposalId,v.createdAt,v.state,v.hypothesis,v.targetPolicy,json(v.changes),json(v.evidence)]);},
    async loadRecentDiscoveryPredictions(limit=5000){const r=await db.query(`SELECT * FROM research.discovery_predictions ORDER BY observed_at DESC LIMIT $1`,[limit]);return r.rows as Array<Record<string,unknown>>;},
    async loadDiscoveryOutcomes(limit=20000){const r=await db.query(`SELECT * FROM research.discovery_outcomes ORDER BY observed_at DESC LIMIT $1`,[limit]);return r.rows as Array<Record<string,unknown>>;},
    async insertForensicEpisode(v) {
      const r = await db.query(
        `INSERT INTO research.forensic_episodes(pool_address,episode_type,started_at,ended_at,data_quality,source_watermark,facts,result_attribution) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) RETURNING id`,
        [
          v.poolAddress,
          v.episodeType,
          v.startedAt,
          v.endedAt ?? null,
          v.dataQuality,
          json(v.sourceWatermark),
          json(v.facts),
          json(v.resultAttribution),
        ],
      );
      return String(r.rows[0]?.id ?? "");
    },
    async insertCounterfactual(v) {
      await db.query(
        `INSERT INTO research.counterfactual_results(episode_id,label,simulator_version,result) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(episode_id,label,simulator_version) DO UPDATE SET result=EXCLUDED.result,created_at=now()`,
        [v.episodeId, v.label, v.simulatorVersion, json(v.result)],
      );
    },
    async insertExperiment(v) {
      await db.query(
        `INSERT INTO research.experiments(id,hypothesis,primary_metric,secondary_metrics,control_policy_id,treatment_policy_id,specification,created_at) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8) ON CONFLICT(id) DO NOTHING`,
        [
          v.id,
          v.hypothesis,
          v.primaryMetric,
          json(v.secondaryMetrics),
          v.controlPolicyId,
          v.treatmentPolicyId,
          json(v.specification),
          v.createdAt,
        ],
      );
    },
    async insertExperimentResult(v) {
      await db.query(
        `INSERT INTO research.experiment_results(experiment_id,run_hash,result) VALUES($1,$2,$3::jsonb) ON CONFLICT(experiment_id,run_hash) DO NOTHING`,
        [v.experimentId, v.runHash, json(v.result)],
      );
    },
    async insertShadowRecommendation(v) {
      await db.query(
        `INSERT INTO research.shadow_recommendations(recommendation_id,pool_address,decision_at,expires_at,state,no_trade,market_context_hash,candidate_count,ranking,economics,reason_codes,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb) ON CONFLICT(recommendation_id) DO NOTHING`,
        [
          v.recommendationId,
          v.poolAddress,
          v.decisionAt,
          v.expiresAt,
          v.state,
          v.noTrade,
          v.marketContextHash,
          v.candidateCount,
          json(v.ranking),
          json(v.economics),
          json(v.reasonCodes),
          json(v.payload),
        ],
      );
    },
    async insertRegimeAssessment(v) {
      await db.query(
        `INSERT INTO research.regime_assessments(pool_address,decision_at,primary_regime,probabilities,confidence,stability,transition_risk,evidence,recommendation_id) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9)`,
        [
          v.poolAddress,
          v.decisionAt,
          v.primaryRegime,
          json(v.probabilities),
          v.confidence,
          v.stability,
          v.transitionRisk,
          json(v.evidence),
          v.recommendationId ?? null,
        ],
      );
    },
    async insertLpThesis(v) {
      await db.query(
        `INSERT INTO research.lp_theses(thesis_id,recommendation_id,pool_address,observed_at,expires_at,selected_candidate_id,thesis) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(thesis_id) DO NOTHING`,
        [
          v.thesisId,
          v.recommendationId,
          v.poolAddress,
          v.observedAt,
          v.expiresAt,
          v.selectedCandidateId,
          json(v.thesis),
        ],
      );
    },
    async insertEntryEvaluation(v) {
      await db.query(
        `INSERT INTO research.entry_evaluations(entry_evaluation_id,thesis_id,pool_address,observed_at,expires_at,decision,readiness_score,confidence,reason_codes,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) ON CONFLICT(entry_evaluation_id) DO NOTHING`,
        [
          v.entryEvaluationId,
          v.thesisId,
          v.poolAddress,
          v.observedAt,
          v.expiresAt,
          v.decision,
          v.readinessScore,
          v.confidence,
          json(v.reasonCodes),
          json(v.payload),
        ],
      );
    },
    async insertRiskDecision(v) {
      await db.query(
        `INSERT INTO research.risk_decisions(risk_decision_id,observed_at,expires_at,scope,decision,reason_codes,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) ON CONFLICT(risk_decision_id) DO NOTHING`,
        [
          v.riskDecisionId,
          v.observedAt,
          v.expiresAt,
          v.scope,
          v.decision,
          json(v.reasonCodes),
          json(v.payload),
        ],
      );
    },
    async upsertPaperPosition(v) {
      await db.query(
        `INSERT INTO accounting.paper_positions(paper_position_id,pool_address,thesis_id,candidate_id,state,capital,lower_bin_id,upper_bin_id,opened_at,closed_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) ON CONFLICT(paper_position_id) DO UPDATE SET pool_address=EXCLUDED.pool_address,thesis_id=EXCLUDED.thesis_id,candidate_id=EXCLUDED.candidate_id,state=EXCLUDED.state,capital=EXCLUDED.capital,lower_bin_id=EXCLUDED.lower_bin_id,upper_bin_id=EXCLUDED.upper_bin_id,opened_at=COALESCE(EXCLUDED.opened_at,accounting.paper_positions.opened_at),closed_at=COALESCE(EXCLUDED.closed_at,accounting.paper_positions.closed_at),payload=EXCLUDED.payload`,
        [
          v.paperPositionId,
          v.poolAddress,
          v.thesisId,
          v.candidateId,
          v.state,
          v.capital,
          v.lowerBinId,
          v.upperBinId,
          v.openedAt ?? null,
          v.closedAt ?? null,
          json(v.payload),
        ],
      );
    },
    async insertPaperPositionEvent(v) {
      await db.query(
        `INSERT INTO accounting.paper_position_events(paper_position_id,observed_at,prior_state,next_state,event_type,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(paper_position_id,observed_at,event_type) DO NOTHING`,
        [
          v.paperPositionId,
          v.observedAt,
          v.priorState ?? null,
          v.nextState,
          v.eventType,
          json(v.payload),
        ],
      );
    },
    async insertManagementDecision(v) {
      await db.query(
        `INSERT INTO research.management_decisions(management_decision_id,paper_position_id,observed_at,action,forward_ev,alternative_ev,reason_codes,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) ON CONFLICT(management_decision_id) DO NOTHING`,
        [
          v.managementDecisionId,
          v.paperPositionId,
          v.observedAt,
          v.action,
          v.forwardEv,
          v.alternativeEv ?? null,
          json(v.reasonCodes),
          json(v.payload),
        ],
      );
    },
    async insertCapitalAllocation(v) {
      await db.query(
        `INSERT INTO research.capital_allocations(allocation_id,observed_at,pool_address,requested,allocated,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(allocation_id) DO NOTHING`,
        [
          v.allocationId,
          v.observedAt,
          v.poolAddress,
          v.requested,
          v.allocated,
          json(v.payload),
        ],
      );
    },
    async insertPaperPortfolioSnapshot(v) {
      await db.query(
        `INSERT INTO research.paper_portfolio_snapshots(portfolio_id,observed_at,total_value,cash_value,deployed_value,open_positions,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(portfolio_id,observed_at) DO UPDATE SET total_value=EXCLUDED.total_value,cash_value=EXCLUDED.cash_value,deployed_value=EXCLUDED.deployed_value,open_positions=EXCLUDED.open_positions,payload=EXCLUDED.payload`,
        [
          v.portfolioId,
          v.observedAt,
          v.totalValue,
          v.cashValue,
          v.deployedValue,
          v.openPositions,
          json(v.payload),
        ],
      );
    },
    async insertExecutionIntent(v) {
      await db.query(
        `INSERT INTO execution.intents(intent_id,idempotency_key,action,pool_address,owner_address,position_address,thesis_id,observed_at,expires_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT(intent_id) DO NOTHING`,
        [
          v.intentId,
          v.idempotencyKey,
          v.action,
          v.poolAddress ?? null,
          v.ownerAddress,
          v.positionAddress ?? null,
          v.thesisId,
          v.observedAt,
          v.expiresAt,
          json(v.payload),
        ],
      );
    },
    async insertTransactionPlan(v) {
      await db.query(
        `INSERT INTO execution.transaction_plans(plan_id,intent_id,cluster,state,created_at,expires_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(plan_id) DO NOTHING`,
        [
          v.planId,
          v.intentId,
          v.cluster,
          v.state,
          v.createdAt,
          v.expiresAt,
          json(v.payload),
        ],
      );
      for (const step of v.steps)
        await db.query(
          `INSERT INTO execution.transaction_steps(transaction_id,plan_id,sequence,kind,state,required_signers,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) ON CONFLICT(transaction_id) DO NOTHING`,
          [
            step.transactionId,
            v.planId,
            step.sequence,
            step.kind,
            step.state,
            json(step.requiredSignerAddresses),
            json(step.metadata),
          ],
        );
    },
    async claimNextAutonomousPlan(now) {
      const claimed = await db.query(
        `WITH candidate AS (SELECT p.plan_id FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id WHERE p.cluster='mainnet-beta' AND p.state='PLANNED' AND p.expires_at>$1::timestamptz AND i.action IN ('OPEN','ADD','CLAIM','REDUCE','RESHAPE','REBALANCE','CLOSE','EMERGENCY_CLOSE') AND NOT EXISTS (SELECT 1 FROM execution.transaction_plans pending JOIN execution.intents pi ON pi.intent_id=pending.intent_id WHERE pending.plan_id<>p.plan_id AND pending.cluster='mainnet-beta' AND pending.state IN ('CLAIMED','DISPATCHING','BUILDING','BUILT','SIMULATING','SIMULATED','RISK_APPROVED','SIGNING','SIGNED','SUBMITTING','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED','RECONCILING') AND ((i.position_address IS NOT NULL AND pi.position_address=i.position_address) OR (i.action='OPEN' AND pi.action='OPEN' AND pi.pool_address=i.pool_address AND pi.owner_address=i.owner_address))) ORDER BY CASE i.action WHEN 'EMERGENCY_CLOSE' THEN 1 WHEN 'CLOSE' THEN 2 WHEN 'REDUCE' THEN 3 WHEN 'RESHAPE' THEN 4 WHEN 'REBALANCE' THEN 5 WHEN 'CLAIM' THEN 6 WHEN 'ADD' THEN 7 ELSE 8 END,p.created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE execution.transaction_plans p SET state='CLAIMED',payload=p.payload||jsonb_build_object('autonomous_dispatch_claimed_at',$1::text) FROM candidate c WHERE p.plan_id=c.plan_id RETURNING p.plan_id,p.intent_id,p.expires_at,p.payload`,
        [now],
      );
      const plan = claimed.rows[0];
      if (!plan) return undefined;
      await db.query(
        `INSERT INTO execution.plan_state_events(plan_id,prior_state,next_state,observed_at,reason_codes,payload) VALUES($1,'PLANNED','CLAIMED',$2,'[]'::jsonb,'{}'::jsonb)`,
        [String(plan.plan_id), now],
      );
      const detail = await db.query(
        `SELECT p.plan_id,p.intent_id,p.expires_at,p.payload AS plan_payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload AS intent_payload,COALESCE(json_agg(json_build_object('transactionId',s.transaction_id,'sequence',s.sequence,'kind',s.kind,'state',s.state,'requiredSignerAddresses',s.required_signers,'metadata',s.metadata) ORDER BY s.sequence) FILTER (WHERE s.transaction_id IS NOT NULL),'[]'::json) AS steps FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id LEFT JOIN execution.transaction_steps s ON s.plan_id=p.plan_id WHERE p.plan_id=$1 GROUP BY p.plan_id,p.intent_id,p.expires_at,p.payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload`,
        [String(plan.plan_id)],
      );
      const row = detail.rows[0];
      if (!row) throw new Error("LPFORGE_P6_AUTONOMOUS_PLAN_DETAIL_MISSING");
      return autonomousPlanFromRow(row);
    },
    async reserveExecutionCapital(v) {
      const tx=db;
      try {
        await tx.query('BEGIN');
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))",[v.ownerAddress]);
        const existing=await tx.query("SELECT token_mint,state FROM execution.capital_reservations WHERE plan_id=$1 FOR UPDATE",[v.planId]);
        if(existing.rows[0]&&String(existing.rows[0].state)!=='RELEASED'){
          await tx.query('COMMIT');
          return{approved:true,reasonCodes:['P6_CAPITAL_RESERVATION_ALREADY_HELD'],tokenMint:String(existing.rows[0].token_mint),deployedLamports:0n,reservedLamports:v.capitalLamports,availableLamports:0n};
        }
        // Execution is currently canonicalized to WSOL as token Y.  Therefore
        // token X is the paired/risky asset used for concentration accounting.
        const tokenRow=await tx.query("SELECT token_x_mint FROM protocol.pools WHERE address=$1",[v.poolAddress]);
        const tokenMint=tokenRow.rows[0]?.token_x_mint?String(tokenRow.rows[0].token_x_mint):undefined;
        const reasons:string[]=[]; if(!tokenMint) reasons.push('P6_CAPITAL_POOL_TOKEN_MISSING');
        const positions=await tx.query("SELECT COALESCE(sum(initial_capital_lamports),0)::text AS deployed,COALESCE(sum(initial_capital_lamports) FILTER (WHERE pool_address=$2),0)::text AS pool_deployed,COALESCE(sum(initial_capital_lamports) FILTER (WHERE p.token_x_mint=$3),0)::text AS token_deployed FROM execution.owned_positions o JOIN protocol.pools p ON p.address=o.pool_address WHERE o.owner_address=$1 AND o.lifecycle_state IN ('OPEN','CLOSING','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN')",[v.ownerAddress,v.poolAddress,tokenMint??'']);
        const reservations=await tx.query("SELECT COALESCE(sum(capital_lamports),0)::text AS reserved,COALESCE(sum(capital_lamports) FILTER (WHERE pool_address=$2),0)::text AS pool_reserved,COALESCE(sum(capital_lamports) FILTER (WHERE token_mint=$3),0)::text AS token_reserved FROM execution.capital_reservations WHERE owner_address=$1 AND state IN ('RESERVED','SUBMITTED')",[v.ownerAddress,v.poolAddress,tokenMint??'']);
        const q=(row:Record<string,unknown>,key:string)=>BigInt(String(row[key]??'0'));
        const deployed=q(positions.rows[0]??{},'deployed'),poolDeployed=q(positions.rows[0]??{},'pool_deployed'),tokenDeployed=q(positions.rows[0]??{},'token_deployed'),reserved=q(reservations.rows[0]??{},'reserved'),poolReserved=q(reservations.rows[0]??{},'pool_reserved'),tokenReserved=q(reservations.rows[0]??{},'token_reserved');
        const available=v.walletLamports-v.reserveLamports-deployed-reserved;
        if(v.capitalLamports>v.maxInitialPositionLamports)reasons.push('P6_CAPITAL_MAX_INITIAL_POSITION');
        if(v.capitalLamports>available)reasons.push('P6_CAPITAL_WALLET_OR_PORTFOLIO_LIMIT');
        if(deployed+reserved+v.capitalLamports>v.maxPortfolioLamports)reasons.push('P6_CAPITAL_PORTFOLIO_LIMIT');
        if(poolDeployed+poolReserved+v.capitalLamports>v.maxPoolLamports)reasons.push('P6_CAPITAL_POOL_LIMIT');
        if(tokenDeployed+tokenReserved+v.capitalLamports>v.maxTokenLamports)reasons.push('P6_CAPITAL_TOKEN_LIMIT');
        if(reasons.length){await tx.query('COMMIT');return{approved:false,reasonCodes:reasons.sort(),...(tokenMint?{tokenMint}:{}),deployedLamports:deployed,reservedLamports:reserved,availableLamports:available>0n?available:0n};}
        await tx.query("INSERT INTO execution.capital_reservations(plan_id,owner_address,pool_address,token_mint,capital_lamports,state,reserved_at,updated_at,reason_codes,payload) VALUES($1,$2,$3,$4,$5,'RESERVED',$6,$6,'[]'::jsonb,'{}'::jsonb) ON CONFLICT(plan_id) DO UPDATE SET state='RESERVED',updated_at=EXCLUDED.updated_at,reason_codes='[]'::jsonb",[v.planId,v.ownerAddress,v.poolAddress,tokenMint,v.capitalLamports.toString(),v.now]);
        await tx.query('COMMIT');return{approved:true,reasonCodes:['P6_CAPITAL_RESERVED'],...(tokenMint?{tokenMint}:{}),deployedLamports:deployed,reservedLamports:reserved+v.capitalLamports,availableLamports:available-v.capitalLamports};
      } catch(error) {try{await tx.query('ROLLBACK');}catch{} throw error;}
    },
    async releaseExecutionCapital(planId,at,reasonCodes){await db.query("UPDATE execution.capital_reservations SET state='RELEASED',updated_at=$2,reason_codes=$3::jsonb WHERE plan_id=$1 AND state IN ('RESERVED','SUBMITTED')",[planId,at,json(reasonCodes)]);},
    async markExecutionCapitalSubmitted(planId,at){await db.query("UPDATE execution.capital_reservations SET state='SUBMITTED',updated_at=$2 WHERE plan_id=$1 AND state='RESERVED'",[planId,at]);},
    async reconcileExecutionCapitalReservations(at){await db.query("UPDATE execution.capital_reservations r SET state=CASE WHEN p.state IN ('BLOCKED','FAILED') THEN 'RELEASED' WHEN EXISTS(SELECT 1 FROM execution.owned_positions o WHERE o.entry_plan_id=r.plan_id AND o.lifecycle_state IN ('OPEN','CLOSING','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN')) THEN 'DEPLOYED' ELSE r.state END,updated_at=$1 FROM execution.transaction_plans p WHERE p.plan_id=r.plan_id AND r.state IN ('RESERVED','SUBMITTED')",[at]);},
    async countExecutionActionsSince(ownerAddress,since){const r=await db.query("SELECT count(DISTINCT p.plan_id)::int AS n FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id LEFT JOIN execution.transaction_steps s ON s.plan_id=p.plan_id LEFT JOIN execution.submission_attempts a ON a.transaction_id=s.transaction_id WHERE i.owner_address=$1 AND a.state IN ('SENT','UNKNOWN') AND a.submitted_at >= $2::timestamptz",[ownerAddress,since]);return Number(r.rows[0]?.n??0);},
    async claimNextAutonomousOpenPlan(now) {
      const claimed = await db.query(
        `WITH candidate AS (SELECT p.plan_id FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id WHERE p.cluster='mainnet-beta' AND p.state='PLANNED' AND i.action='OPEN' AND p.expires_at>$1::timestamptz ORDER BY p.created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE execution.transaction_plans p SET state='DISPATCHING',payload=p.payload||jsonb_build_object('autonomous_dispatch_claimed_at',$1::text) FROM candidate c WHERE p.plan_id=c.plan_id RETURNING p.plan_id,p.intent_id,p.expires_at,p.payload`,
        [now],
      );
      const plan = claimed.rows[0];
      if (!plan) return undefined;
      const detail = await db.query(
        `SELECT i.idempotency_key,i.pool_address,i.owner_address,i.thesis_id,i.observed_at,open_step.transaction_id,open_step.metadata,swap_step.transaction_id AS swap_transaction_id,swap_step.metadata AS swap_transaction_metadata,i.payload AS intent_payload FROM execution.intents i JOIN execution.transaction_steps open_step ON open_step.plan_id=$1 AND open_step.kind='METEORA_OPEN' LEFT JOIN execution.transaction_steps swap_step ON swap_step.plan_id=$1 AND swap_step.kind='JUPITER_SWAP' WHERE i.intent_id=$2 ORDER BY open_step.sequence LIMIT 1`,
        [String(plan.plan_id), String(plan.intent_id)],
      );
      const row = detail.rows[0];
      if (!row) throw new Error("LPFORGE_P6_AUTONOMOUS_PLAN_OPEN_STEP_MISSING");
      return {
        planId: String(plan.plan_id),
        intentId: String(plan.intent_id),
        idempotencyKey: String(row.idempotency_key),
        poolAddress: String(row.pool_address),
        ownerAddress: String(row.owner_address),
        thesisId: String(row.thesis_id),
        observedAt: toIsoTimestamp(row.observed_at),
        expiresAt: new Date(String(plan.expires_at)).toISOString(),
        intentPayload: (row.intent_payload ?? {}) as Record<string, unknown>,
        planPayload: (plan.payload ?? {}) as Record<string, unknown>,
        transactionId: String(row.transaction_id),
        transactionMetadata: (row.metadata ?? {}) as Record<string, unknown>,
        ...(row.swap_transaction_id
          ? {
              swapTransactionId: String(row.swap_transaction_id),
              swapTransactionMetadata: (row.swap_transaction_metadata ??
                {}) as Record<string, unknown>,
            }
          : {}),
      };
    },
    async transitionAutonomousPlan(v) {
      const prior = await db.query(
        `WITH current AS (SELECT state FROM execution.transaction_plans WHERE plan_id=$1),updated AS (UPDATE execution.transaction_plans SET state=$2,payload=payload||jsonb_build_object('autonomous_dispatch_updated_at',$3::text,'autonomous_dispatch',$4::jsonb) WHERE plan_id=$1 RETURNING plan_id) SELECT state FROM current JOIN updated ON true`,
        [v.planId, v.state, v.at, json(v.payload)],
      );
      await db.query(
        `INSERT INTO execution.plan_state_events(plan_id,prior_state,next_state,observed_at,reason_codes,payload) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [
          v.planId,
          String(prior.rows[0]?.state ?? ""),
          v.state,
          v.at,
          json(v.reasonCodes ?? []),
          json(v.payload),
        ],
      );
    },
    async completeAutonomousPlan(v) {
      await db.query(
        `UPDATE execution.transaction_plans SET state=$2,payload=payload||jsonb_build_object('autonomous_dispatch_completed_at',$3::text,'autonomous_dispatch',$4::jsonb) WHERE plan_id=$1`,
        [v.planId, v.state, v.at, json(v.payload)],
      );
    },
    async upsertOwnedPosition(v) {
      await db.query(
        `INSERT INTO execution.owned_positions(lpforge_position_id,pool_address,position_address,owner_address,strategy,orientation,lower_bin_id,upper_bin_id,active_bin_at_entry,initial_capital_lamports,entry_plan_id,entry_signature,entered_at,lifecycle_state,last_plan_id,reconciliation_status,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb) ON CONFLICT(lpforge_position_id) DO UPDATE SET lifecycle_state=EXCLUDED.lifecycle_state,last_plan_id=COALESCE(EXCLUDED.last_plan_id,execution.owned_positions.last_plan_id),reconciliation_status=EXCLUDED.reconciliation_status,entry_signature=COALESCE(EXCLUDED.entry_signature,execution.owned_positions.entry_signature),payload=EXCLUDED.payload`,
        [
          v.lpforgePositionId,
          v.poolAddress,
          v.positionAddress,
          v.ownerAddress,
          v.strategy,
          v.orientation,
          v.lowerBinId,
          v.upperBinId,
          v.activeBinAtEntry,
          v.initialCapitalLamports.toString(),
          v.entryPlanId ?? null,
          v.entrySignature ?? null,
          v.enteredAt,
          v.lifecycleState,
          v.lastPlanId ?? null,
          v.reconciliationStatus,
          json(v.payload),
        ],
      );
    },
    async insertPositionObservation(v) {
      await db.query(
        `INSERT INTO execution.position_observations(lpforge_position_id,observed_at,active_bin_id,range_state,token_x_amount,token_y_amount,unclaimed_fee_x,unclaimed_fee_y,wallet_truth,position_truth,management_context,reconciliation_debt,stale_data,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14::jsonb) ON CONFLICT(lpforge_position_id,observed_at) DO NOTHING`,
        [
          v.lpforgePositionId,
          v.observedAt,
          v.activeBinId ?? null,
          v.rangeState,
          v.tokenXAmount ?? null,
          v.tokenYAmount ?? null,
          v.unclaimedFeeX ?? null,
          v.unclaimedFeeY ?? null,
          json(v.walletTruth),
          json(v.positionTruth),
          json(v.managementContext),
          v.reconciliationDebt,
          v.staleData,
          json(v.payload),
        ],
      );
    },
    async loadOwnedPositions(ownerAddress) {
      const r = await db.query(
        `SELECT * FROM execution.owned_positions WHERE owner_address=$1 AND lifecycle_state IN ('OPEN','CLOSING','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN') ORDER BY entered_at ASC`,
        [ownerAddress],
      );
      return r.rows;
    },
    async loadPhase7PortfolioFacts(ownerAddress){const [positions,reservations,recon]=await Promise.all([db.query("SELECT COALESCE(sum(o.initial_capital_lamports),0)::text AS deployed,count(*)::int AS open_positions,COALESCE(jsonb_object_agg(o.pool_address,o.initial_capital_lamports) FILTER (WHERE o.pool_address IS NOT NULL),'{}'::jsonb) AS by_pool,COALESCE(jsonb_object_agg(p.token_x_mint,o.initial_capital_lamports) FILTER (WHERE p.token_x_mint IS NOT NULL),'{}'::jsonb) AS by_token FROM execution.owned_positions o JOIN protocol.pools p ON p.address=o.pool_address WHERE o.owner_address=$1 AND o.lifecycle_state IN ('OPEN','CLOSING','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN')",[ownerAddress]),db.query("SELECT COALESCE(sum(capital_lamports),0)::text AS reserved,COALESCE(jsonb_object_agg(pool_address,capital_lamports) FILTER (WHERE pool_address IS NOT NULL),'{}'::jsonb) AS by_pool,COALESCE(jsonb_object_agg(token_mint,capital_lamports) FILTER (WHERE token_mint IS NOT NULL),'{}'::jsonb) AS by_token FROM execution.capital_reservations WHERE owner_address=$1 AND state IN ('RESERVED','SUBMITTED')",[ownerAddress]),db.query("SELECT count(*)::int AS n FROM execution.owned_positions WHERE owner_address=$1 AND lifecycle_state IN ('RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN')",[ownerAddress])]);const map=(v:unknown)=>Object.fromEntries(Object.entries((v??{}) as Record<string,unknown>).map(([k,x])=>[k,BigInt(String(x))]));return{deployedLamports:BigInt(String(positions.rows[0]?.deployed??'0')),pendingReservedLamports:BigInt(String(reservations.rows[0]?.reserved??'0')),openPositions:Number(positions.rows[0]?.open_positions??0),unresolvedReconciliationDebt:Number(recon.rows[0]?.n??0),poolExposureLamports:map(positions.rows[0]?.by_pool),poolPendingLamports:map(reservations.rows[0]?.by_pool),tokenExposureLamports:map(positions.rows[0]?.by_token),tokenPendingLamports:map(reservations.rows[0]?.by_token)};},
    async loadPhase7PortfolioRiskState(ownerAddress){const r=await db.query("SELECT * FROM operations.phase7_live_portfolio_risk_state WHERE owner_address=$1",[ownerAddress]);return r.rows[0] as Record<string,unknown>|undefined;},
    async upsertPhase7PortfolioRiskState(v){await db.query("INSERT INTO operations.phase7_live_portfolio_risk_state(owner_address,day_start,daily_start_equity_lamports,peak_equity_lamports,current_equity_lamports,observed_at,valuation_state,reason_codes,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) ON CONFLICT(owner_address) DO UPDATE SET day_start=EXCLUDED.day_start,daily_start_equity_lamports=EXCLUDED.daily_start_equity_lamports,peak_equity_lamports=EXCLUDED.peak_equity_lamports,current_equity_lamports=EXCLUDED.current_equity_lamports,observed_at=EXCLUDED.observed_at,valuation_state=EXCLUDED.valuation_state,reason_codes=EXCLUDED.reason_codes,payload=EXCLUDED.payload",[v.ownerAddress,v.dayStart,v.dailyStartEquityLamports.toString(),v.peakEquityLamports.toString(),v.currentEquityLamports.toString(),v.observedAt,v.valuationState,json(v.reasonCodes),json(v.payload)]);},
    async loadPositionExitState(lpforgePositionId) {
      const r=await db.query(`SELECT * FROM execution.position_exit_state WHERE lpforge_position_id=$1`,[lpforgePositionId]);
      return (r.rows[0] as Record<string,unknown>|undefined)??null;
    },
    async upsertPositionExitState(v) {
      await db.query(`INSERT INTO execution.position_exit_state(lpforge_position_id,observed_at,evidence_state,initial_capital_usd,current_economic_value_usd,net_pnl_usd,net_return_fraction,peak_net_return_fraction,peak_economic_value_usd,peak_observed_at,last_action,last_reason_codes,payload,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$2) ON CONFLICT(lpforge_position_id) DO UPDATE SET observed_at=EXCLUDED.observed_at,evidence_state=EXCLUDED.evidence_state,initial_capital_usd=COALESCE(EXCLUDED.initial_capital_usd,execution.position_exit_state.initial_capital_usd),current_economic_value_usd=EXCLUDED.current_economic_value_usd,net_pnl_usd=EXCLUDED.net_pnl_usd,net_return_fraction=EXCLUDED.net_return_fraction,peak_net_return_fraction=GREATEST(execution.position_exit_state.peak_net_return_fraction,EXCLUDED.peak_net_return_fraction),peak_economic_value_usd=CASE WHEN EXCLUDED.peak_net_return_fraction>=execution.position_exit_state.peak_net_return_fraction THEN EXCLUDED.peak_economic_value_usd ELSE execution.position_exit_state.peak_economic_value_usd END,peak_observed_at=CASE WHEN EXCLUDED.peak_net_return_fraction>=execution.position_exit_state.peak_net_return_fraction THEN EXCLUDED.peak_observed_at ELSE execution.position_exit_state.peak_observed_at END,last_action=EXCLUDED.last_action,last_reason_codes=EXCLUDED.last_reason_codes,payload=EXCLUDED.payload,updated_at=EXCLUDED.updated_at`,[v.lpforgePositionId,v.observedAt,v.evidenceState,v.initialCapitalUsd??null,v.currentEconomicValueUsd??null,v.netPnlUsd??null,v.netReturnFraction??null,v.peakNetReturnFraction,v.peakEconomicValueUsd??null,v.peakObservedAt,v.lastAction,json(v.reasonCodes),json(v.payload)]);
    },
    async hasActiveAutonomousPlan(positionAddress) {
      const r = await db.query(
        `SELECT EXISTS(SELECT 1 FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id WHERE i.position_address=$1 AND p.cluster='mainnet-beta' AND p.state IN ('PLANNED','CLAIMED','DISPATCHING','BUILDING','BUILT','SIMULATING','SIMULATED','RISK_APPROVED','SIGNING','SIGNED','SUBMITTING','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED','RECONCILING','RECOVERING','RECONCILIATION_REQUIRED')) AS active`,
        [positionAddress],
      );
      return Boolean(r.rows[0]?.active);
    },
    async markOwnedPositionLifecycle(v) {
      await db.query(
        `UPDATE execution.owned_positions SET lifecycle_state=$2,reconciliation_status=$3,last_plan_id=COALESCE($4,last_plan_id),payload=payload||jsonb_build_object('lifecycle_updated_at',$5::text,'lifecycle',$6::jsonb) WHERE position_address=$1`,
        [
          v.positionAddress,
          v.lifecycleState,
          v.reconciliationStatus,
          v.lastPlanId ?? null,
          v.at,
          json(v.payload),
        ],
      );
    },
    async upsertPartialEntryRecovery(v) {
      await db.query(
        `INSERT INTO execution.partial_entry_recovery(plan_id,pool_address,owner_address,token_mint,funding_transaction_id,funding_signature,funded_at,paired_token_amount,intended_capital_lamports,intended_range,state,wallet_truth,payload,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13::jsonb,$14) ON CONFLICT(plan_id) DO UPDATE SET state=EXCLUDED.state,wallet_truth=EXCLUDED.wallet_truth,payload=EXCLUDED.payload,updated_at=EXCLUDED.updated_at`,
        [
          v.planId,
          v.poolAddress,
          v.ownerAddress,
          v.tokenMint,
          v.fundingTransactionId,
          v.fundingSignature,
          v.fundedAt,
          v.pairedTokenAmount,
          v.intendedCapitalLamports.toString(),
          json(v.intendedRange),
          v.state,
          json(v.walletTruth),
          json(v.payload),
          v.updatedAt,
        ],
      );
    },
    async loadPartialEntryRecoveries() {
      const r = await db.query(
        `SELECT * FROM execution.partial_entry_recovery WHERE state IN ('ENTRY_FUNDED_NOT_OPEN','RESUME_OPEN','UNWIND_REQUIRED','UNWIND_SUBMITTED','RECONCILIATION_REQUIRED') ORDER BY updated_at ASC`,
      );
      return r.rows;
    },
    async loadAutonomousPlan(planId) {
      const r = await db.query(
        `SELECT p.plan_id,p.intent_id,p.expires_at,p.payload AS plan_payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload AS intent_payload,COALESCE(json_agg(json_build_object('transactionId',s.transaction_id,'sequence',s.sequence,'kind',s.kind,'state',s.state,'requiredSignerAddresses',s.required_signers,'metadata',s.metadata) ORDER BY s.sequence) FILTER (WHERE s.transaction_id IS NOT NULL),'[]'::json) AS steps FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id LEFT JOIN execution.transaction_steps s ON s.plan_id=p.plan_id WHERE p.plan_id=$1 GROUP BY p.plan_id,p.intent_id,p.expires_at,p.payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload`,
        [planId],
      );
      return r.rows[0] ? autonomousPlanFromRow(r.rows[0]) : undefined;
    },
    async loadUnresolvedAutonomousPlans() {
      const r = await db.query(
        `SELECT p.plan_id,p.intent_id,p.expires_at,p.payload AS plan_payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload AS intent_payload,COALESCE(json_agg(json_build_object('transactionId',s.transaction_id,'sequence',s.sequence,'kind',s.kind,'state',s.state,'requiredSignerAddresses',s.required_signers,'metadata',s.metadata) ORDER BY s.sequence) FILTER (WHERE s.transaction_id IS NOT NULL),'[]'::json) AS steps FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id LEFT JOIN execution.transaction_steps s ON s.plan_id=p.plan_id WHERE p.cluster='mainnet-beta' AND p.state IN ('CLAIMED','DISPATCHING','BUILDING','BUILT','SIMULATING','SIMULATED','RISK_APPROVED','SIGNING','SIGNED','SUBMITTING','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED','RECONCILING') GROUP BY p.plan_id,p.intent_id,p.expires_at,p.payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload ORDER BY p.created_at ASC`,
      );
      return r.rows.map(autonomousPlanFromRow);
    },
    async insertExecutionSimulation(v) {
      await db.query(
        `INSERT INTO execution.simulations(transaction_id,simulated_at,fresh_until,ok,units_consumed,logs,error,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb) ON CONFLICT(transaction_id,simulated_at) DO NOTHING`,
        [
          v.transactionId,
          v.simulatedAt,
          v.freshUntil,
          v.ok,
          v.unitsConsumed ?? null,
          json(v.logs),
          v.error ?? null,
          json(v.payload),
        ],
      );
    },
    async insertExecutionRiskPermit(v) {
      await db.query(
        `INSERT INTO execution.risk_permits(permit_id,plan_id,decision,issued_at,expires_at,reason_codes,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) ON CONFLICT(permit_id) DO NOTHING`,
        [
          v.permitId,
          v.planId,
          v.decision,
          v.issuedAt,
          v.expiresAt ?? null,
          json(v.reasonCodes),
          json(v.payload),
        ],
      );
    },
    async prepareSubmissionAttempt(v) {
      const r = await db.query(
        `INSERT INTO execution.submission_attempts(attempt_id,transaction_id,idempotency_key,attempt,state,signed_payload_fingerprint,blockhash,last_valid_block_height,prepared_at,payload) VALUES($1,$2,$3,$4,'PREPARED',$5,$6,$7,$8,$9::jsonb) ON CONFLICT(attempt_id) DO NOTHING RETURNING attempt_id`,
        [
          v.attemptId,
          v.transactionId,
          v.idempotencyKey,
          v.attempt,
          v.signedPayloadFingerprint,
          v.blockhash,
          v.lastValidBlockHeight,
          v.preparedAt,
          json(v.payload),
        ],
      );
      return r.rows.length ? "PREPARED" : "DUPLICATE";
    },
    async markSubmissionSent(attemptId, signature, submittedAt) {
      await db.query(
        `UPDATE execution.submission_attempts SET state='SENT',signature=$2,submitted_at=$3 WHERE attempt_id=$1`,
        [attemptId, signature, submittedAt],
      );
    },
    async markSubmissionUnknown(attemptId, at, error) {
      await db.query(
        `UPDATE execution.submission_attempts SET state='UNKNOWN',submitted_at=COALESCE(submitted_at,$2),payload=payload||jsonb_build_object('submission_error',$3::text) WHERE attempt_id=$1`,
        [attemptId, at, error],
      );
    },
    async insertExecutionConfirmation(v) {
      await db.query(
        `INSERT INTO execution.confirmations(attempt_id,signature,status,observed_at,slot,error,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(attempt_id,observed_at,status) DO NOTHING`,
        [
          v.attemptId,
          v.signature ?? null,
          v.status,
          v.observedAt,
          v.slot?.toString() ?? null,
          v.error ?? null,
          json(v.payload),
        ],
      );
    },
    async insertExecutionReconciliation(v) {
      await db.query(
        `INSERT INTO execution.reconciliations(reconciliation_id,plan_id,observed_at,status,expected,actual,discrepancies,payload) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb) ON CONFLICT(reconciliation_id) DO NOTHING`,
        [
          v.reconciliationId,
          v.planId,
          v.observedAt,
          v.status,
          json(v.expected),
          json(v.actual),
          json(v.discrepancies),
          json(v.payload),
        ],
      );
    },
    async createExecutionJournal(v) {
      const r = await db.query(
        `INSERT INTO execution.execution_journal(journal_id,idempotency_key,plan_id,transaction_id,state,signature,blockhash,last_valid_block_height,version,updated_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) ON CONFLICT(idempotency_key) DO NOTHING RETURNING journal_id`,
        [
          v.journalId,
          v.idempotencyKey,
          v.planId,
          v.transactionId ?? null,
          v.state,
          v.signature ?? null,
          v.blockhash ?? null,
          v.lastValidBlockHeight ?? null,
          v.version,
          v.updatedAt,
          json(v.payload),
        ],
      );
      return r.rows.length > 0;
    },
    async updateExecutionJournal(v) {
      const r = await db.query(
        `UPDATE execution.execution_journal SET state=$3,signature=COALESCE($4,signature),blockhash=COALESCE($5,blockhash),last_valid_block_height=COALESCE($6,last_valid_block_height),version=version+1,updated_at=$7,payload=$8::jsonb WHERE idempotency_key=$1 AND version=$2 RETURNING journal_id`,
        [
          v.idempotencyKey,
          v.expectedVersion,
          v.state,
          v.signature ?? null,
          v.blockhash ?? null,
          v.lastValidBlockHeight ?? null,
          v.updatedAt,
          json(v.payload),
        ],
      );
      return r.rows.length > 0;
    },
    async getExecutionJournal(idempotencyKey) {
      const r = await db.query(
        `SELECT * FROM execution.execution_journal WHERE idempotency_key=$1`,
        [idempotencyKey],
      );
      return r.rows[0];
    },
    async loadOperationalHistory(poolAddress, since, limit) {
      const lim = Math.max(1, Math.min(2000, limit));
      const market = await db.query(
        `WITH candidate AS (
           SELECT observed_at,price::double precision AS price,local_liquidity::double precision AS tvl,active_bin_id,resolution_ms,
             COALESCE(volume,0)::double precision AS volume_5m,COALESCE(fee_value,0)::double precision AS fee_5m,
             CASE source_type WHEN 'LIVE_OBSERVED' THEN 0 WHEN 'RECONSTRUCTED' THEN 1 ELSE 2 END AS source_rank
           FROM market.candidate_market_observations
           WHERE pool_address=$1 AND observed_at>=$2
         ), snapshots AS (
           SELECT d.observed_at,(d.payload->>'current_price')::double precision AS price,(d.payload->>'tvl')::double precision AS tvl,
             (SELECT p.active_bin_id FROM protocol.pool_snapshots p WHERE p.pool_address=d.pool_address AND p.observed_at<=d.observed_at ORDER BY p.observed_at DESC LIMIT 1) AS active_bin_id,
             COALESCE((d.payload->'volume'->>'5m')::double precision,0) AS volume_5m,
             COALESCE((d.payload->'fees'->>'5m')::double precision,0) AS fee_5m,60000::integer AS resolution_ms,1 AS source_rank
           FROM market.data_api_pool_snapshots d
           WHERE d.pool_address=$1 AND d.observed_at>=$2 AND (d.payload->>'current_price') IS NOT NULL
         ), all_points AS (SELECT * FROM candidate UNION ALL SELECT * FROM snapshots),
         dedup AS (SELECT DISTINCT ON(observed_at) * FROM all_points ORDER BY observed_at,source_rank)
         SELECT observed_at,price,tvl,active_bin_id,resolution_ms,volume_5m,fee_5m FROM dedup ORDER BY observed_at ASC LIMIT $3`,
        [poolAddress, since, lim],
      );
      const active = await db.query(
        `SELECT observed_at,active_bin_id FROM protocol.pool_snapshots WHERE pool_address=$1 AND observed_at>=$2 ORDER BY observed_at ASC LIMIT $3`,
        [poolAddress, since, lim],
      );
      const stamps = await db.query(
        `SELECT DISTINCT observed_at FROM protocol.bin_snapshots WHERE pool_address=$1 AND observed_at>=$2 ORDER BY observed_at DESC LIMIT $3`,
        [poolAddress, since, Math.min(lim, 240)],
      );
      const stampValues = stamps.rows.map((r) => r.observed_at).filter(Boolean);
      const frames: Array<{
        observedAt: string;
        activeBinId: number;
        bins: Array<{
          binId: number;
          price: string;
          amountX: string;
          amountY: string;
          liquiditySupply?: string;
        }>;
      }> = [];
      for (const stamp of stampValues.reverse()) {
        const rows = await db.query(
          `SELECT b.bin_id,b.price,b.amount_x,b.amount_y,b.liquidity_supply,
          (SELECT p.active_bin_id FROM protocol.pool_snapshots p WHERE p.pool_address=b.pool_address AND p.observed_at<=b.observed_at ORDER BY p.observed_at DESC LIMIT 1) AS active_bin_id
          FROM protocol.bin_snapshots b WHERE b.pool_address=$1 AND b.observed_at=$2 ORDER BY b.bin_id`,
          [poolAddress, stamp],
        );
        if (!rows.rows.length) continue;
        const a = Number(rows.rows[0]!.active_bin_id);
        if (!Number.isFinite(a)) continue;
        frames.push({
          observedAt: new Date(String(stamp)).toISOString(),
          activeBinId: a,
          bins: rows.rows.map((r) => ({
            binId: Number(r.bin_id),
            price: String(r.price ?? "0"),
            amountX: String(r.amount_x ?? "0"),
            amountY: String(r.amount_y ?? "0"),
            ...(r.liquidity_supply !== null && r.liquidity_supply !== undefined
              ? { liquiditySupply: String(r.liquidity_supply) }
              : {}),
          })),
        });
      }
      const swaps = await db.query(
        `SELECT signature,event_index,pool_address,chain_slot,block_time,observed_at,start_bin_id,end_bin_id,swap_for_y,amount_in,amount_left,amount_out,fee_bps,mm_fee,protocol_fee,limit_order_fee,host_fee,fees_on_input,fees_on_token_x,payload FROM protocol.swap_events WHERE pool_address=$1 AND observed_at>=$2 ORDER BY observed_at ASC LIMIT $3`,
        [poolAddress, since, lim],
      );
      return {
        marketObservations: market.rows.flatMap((r) => {
          const price = Number(r.price),
            activeBinId = Number(r.active_bin_id);
          if (!(price > 0)) return [];
          return [
            {
              observedAt: new Date(String(r.observed_at)).toISOString(),
              price,
              ...(Number.isFinite(activeBinId) ? { activeBinId } : {}),
              resolutionMs: Number(r.resolution_ms),
              ...(Number.isFinite(Number(r.volume_5m))
                ? { volume: Number(r.volume_5m) }
                : {}),
              ...(Number.isFinite(Number(r.fee_5m))
                ? { feeValue: Number(r.fee_5m) }
                : {}),
              ...(Number.isFinite(Number(r.tvl))
                ? { localLiquidity: Number(r.tvl) }
                : {}),
            },
          ];
        }),
        activeBins: active.rows
          .map((r) => ({
            observedAt: new Date(String(r.observed_at)).toISOString(),
            activeBinId: Number(r.active_bin_id),
          }))
          .filter((r) => Number.isFinite(r.activeBinId)),
        binFrames: frames,
        swapEvents: swaps.rows.map(swapEventFromDbRow),
      };
    },
    async loadRegimeAssessmentHistory(poolAddress, through, limit) {
      const lim = Math.max(1, Math.min(500, limit));
      const r = await db.query(
        `SELECT primary_regime,probabilities,confidence,stability,transition_risk,decision_at FROM research.regime_assessments WHERE pool_address=$1 AND decision_at<$2 ORDER BY decision_at DESC LIMIT $3`,
        [poolAddress, through, lim],
      );
      return r.rows.map(regimeHistorySampleFromDbRow).reverse();
    },
    async getLatestOpenPaperPosition(poolAddress) {
      const r = await db.query(
        `SELECT * FROM accounting.paper_positions WHERE pool_address=$1 AND state NOT IN ('CLOSED','FAILED') ORDER BY created_at DESC LIMIT 1`,
        [poolAddress],
      );
      return r.rows[0];
    },
    async insertOperationalCycle(v) {
      await db.query(
        `INSERT INTO operations.forward_cycles(cycle_id,pool_address,observed_at,phase3_status,phase4_status,phase5_status,recommendation_id,thesis_id,entry_decision,plan_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) ON CONFLICT(cycle_id) DO UPDATE SET phase3_status=EXCLUDED.phase3_status,phase4_status=EXCLUDED.phase4_status,phase5_status=EXCLUDED.phase5_status,recommendation_id=EXCLUDED.recommendation_id,thesis_id=EXCLUDED.thesis_id,entry_decision=EXCLUDED.entry_decision,plan_id=EXCLUDED.plan_id,payload=EXCLUDED.payload`,
        [
          v.cycleId,
          v.poolAddress,
          v.observedAt,
          v.phase3Status,
          v.phase4Status,
          v.phase5Status,
          v.recommendationId ?? null,
          v.thesisId ?? null,
          v.entryDecision ?? null,
          v.planId ?? null,
          json(v.payload),
        ],
      );
    },
    async upsertRuntimeHeartbeat(v) {
      await db.query(
        `INSERT INTO operations.runtime_heartbeats(runtime_id,pool_address,observed_at,status,cycle_id,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(runtime_id) DO UPDATE SET pool_address=EXCLUDED.pool_address,observed_at=EXCLUDED.observed_at,status=EXCLUDED.status,cycle_id=EXCLUDED.cycle_id,payload=EXCLUDED.payload`,
        [
          v.runtimeId,
          v.poolAddress,
          v.observedAt,
          v.status,
          v.cycleId ?? null,
          json(v.payload),
        ],
      );
    },
    async insertDevnetValidationRun(v) {
      await db.query(
        `INSERT INTO operations.devnet_validation_runs(run_id,observed_at,rpc_url,stage,status,signature,slot,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(run_id,stage) DO UPDATE SET observed_at=EXCLUDED.observed_at,status=EXCLUDED.status,signature=EXCLUDED.signature,slot=EXCLUDED.slot,payload=EXCLUDED.payload`,
        [
          v.runId,
          v.observedAt,
          v.rpcUrl,
          v.stage,
          v.status,
          v.signature ?? null,
          v.slot?.toString() ?? null,
          json(v.payload),
        ],
      );
    },
    async upsertPhase6CanarySession(v) {
      await db.query(
        `INSERT INTO operations.phase6_canary_sessions(session_id,pool_address,owner_address,capital_lamports,status,opened_at,closed_at,open_signature,close_signature,open_reconciliation_status,close_reconciliation_status,execution_cost_lamports,duplicate_submission_count,recovery_events,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb) ON CONFLICT(session_id) DO UPDATE SET status=EXCLUDED.status,closed_at=COALESCE(EXCLUDED.closed_at,operations.phase6_canary_sessions.closed_at),open_signature=COALESCE(EXCLUDED.open_signature,operations.phase6_canary_sessions.open_signature),close_signature=COALESCE(EXCLUDED.close_signature,operations.phase6_canary_sessions.close_signature),open_reconciliation_status=COALESCE(EXCLUDED.open_reconciliation_status,operations.phase6_canary_sessions.open_reconciliation_status),close_reconciliation_status=COALESCE(EXCLUDED.close_reconciliation_status,operations.phase6_canary_sessions.close_reconciliation_status),execution_cost_lamports=EXCLUDED.execution_cost_lamports,duplicate_submission_count=EXCLUDED.duplicate_submission_count,recovery_events=EXCLUDED.recovery_events,payload=EXCLUDED.payload`,
        [
          v.sessionId,
          v.poolAddress,
          v.ownerAddress,
          v.capitalLamports.toString(),
          v.status,
          v.openedAt ?? null,
          v.closedAt ?? null,
          v.openSignature ?? null,
          v.closeSignature ?? null,
          v.openReconciliationStatus ?? null,
          v.closeReconciliationStatus ?? null,
          v.executionCostLamports.toString(),
          v.duplicateSubmissionCount,
          v.recoveryEvents,
          json(v.payload),
        ],
      );
    },
    async insertPhase6CanaryObservation(v) {
      await db.query(
        `INSERT INTO operations.phase6_canary_observations(session_id,observed_at,decision,forward_ev,in_range,inventory_risk_fraction,fees_accrued_value,net_pnl_value,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(session_id,observed_at) DO UPDATE SET decision=EXCLUDED.decision,forward_ev=EXCLUDED.forward_ev,in_range=EXCLUDED.in_range,inventory_risk_fraction=EXCLUDED.inventory_risk_fraction,fees_accrued_value=EXCLUDED.fees_accrued_value,net_pnl_value=EXCLUDED.net_pnl_value,payload=EXCLUDED.payload`,
        [
          v.sessionId,
          v.observedAt,
          v.decision,
          v.forwardEv,
          v.inRange,
          v.inventoryRiskFraction,
          v.feesAccruedValue,
          v.netPnlValue,
          json(v.payload),
        ],
      );
    },
    async insertPhase6StageEvidence(v) {
      await db.query(
        `INSERT INTO operations.phase6_stage_evidence(evidence_id,stage,status,observed_at,evidence_hash,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(evidence_id) DO NOTHING`,
        [
          v.evidenceId,
          v.stage,
          v.status,
          v.observedAt,
          v.evidenceHash ?? null,
          json(v.payload),
        ],
      );
    },
    async insertPhase7OperatorAction(v) {
      await db.query(
        `INSERT INTO operations.phase7_operator_actions(action_id,operator_id,action,requested_at,approval_id,reason,target_type,target_id,before_hash,after_hash,result,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) ON CONFLICT(action_id) DO NOTHING`,
        [
          v.actionId,
          v.operatorId,
          v.action,
          v.requestedAt,
          v.approvalId,
          v.reason,
          v.targetType ?? null,
          v.targetId ?? null,
          v.beforeHash,
          v.afterHash,
          v.result,
          json(v.payload),
        ],
      );
    },
    async upsertPhase7RuntimeLease(v) {
      await db.query(
        `INSERT INTO operations.phase7_runtime_leases(runtime_id,holder_id,acquired_at,expires_at,generation) VALUES($1,$2,$3,$4,$5) ON CONFLICT(runtime_id) DO UPDATE SET holder_id=EXCLUDED.holder_id,acquired_at=EXCLUDED.acquired_at,expires_at=EXCLUDED.expires_at,generation=EXCLUDED.generation`,
        [v.runtimeId, v.holderId, v.acquiredAt, v.expiresAt, v.generation],
      );
    },
    async getPhase7RuntimeLease(runtimeId) {
      const r = await db.query(
        `SELECT runtime_id,holder_id,acquired_at,expires_at,generation FROM operations.phase7_runtime_leases WHERE runtime_id=$1`,
        [runtimeId],
      );
      return r.rows[0];
    },
    async claimPhase7RuntimeLease(v) {
      const r = await db.query(
        `INSERT INTO operations.phase7_runtime_leases(runtime_id,holder_id,acquired_at,expires_at,generation) VALUES($1,$2,$3,$4,1) ON CONFLICT(runtime_id) DO UPDATE SET holder_id=EXCLUDED.holder_id,acquired_at=CASE WHEN operations.phase7_runtime_leases.holder_id=EXCLUDED.holder_id THEN operations.phase7_runtime_leases.acquired_at ELSE EXCLUDED.acquired_at END,expires_at=EXCLUDED.expires_at,generation=CASE WHEN operations.phase7_runtime_leases.holder_id=EXCLUDED.holder_id THEN operations.phase7_runtime_leases.generation ELSE operations.phase7_runtime_leases.generation+1 END WHERE operations.phase7_runtime_leases.expires_at<=$3 OR operations.phase7_runtime_leases.holder_id=EXCLUDED.holder_id RETURNING runtime_id,holder_id,acquired_at,expires_at,generation`,
        [v.runtimeId, v.holderId, v.now, v.expiresAt],
      );
      return r.rows[0];
    },
    async insertPhase7RuntimeCycle(v) {
      const r = await db.query(
        `INSERT INTO operations.phase7_runtime_cycles(cycle_key,runtime_id,instance_id,observed_at,plan,economic_action_key,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(cycle_key) DO NOTHING RETURNING cycle_key`,
        [
          v.cycleKey,
          v.runtimeId,
          v.instanceId,
          v.observedAt,
          v.plan,
          v.economicActionKey ?? null,
          json(v.payload),
        ],
      );
      return r.rows.length === 1;
    },
    async loadRecentPhase7RuntimeCycles(runtimeId, limit) {
      const lim = Math.max(1, Math.min(500, limit));
      const r = await db.query(
        `SELECT cycle_key,runtime_id,instance_id,observed_at,plan,economic_action_key,payload FROM operations.phase7_runtime_cycles WHERE runtime_id=$1 ORDER BY observed_at DESC LIMIT $2`,
        [runtimeId, lim],
      );
      return r.rows;
    },
    async insertPhase7HealthAssessment(v) {
      await db.query(
        `INSERT INTO operations.phase7_health_assessments(assessment_id,runtime_id,cycle_key,observed_at,status,new_entries_allowed,management_writes_allowed,reason_codes,domain_status,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb) ON CONFLICT(assessment_id) DO NOTHING`,
        [
          v.assessmentId,
          v.runtimeId,
          v.cycleKey,
          v.observedAt,
          v.status,
          v.newEntriesAllowed,
          v.managementWritesAllowed,
          json(v.reasonCodes),
          json(v.domainStatus),
          json(v.payload),
        ],
      );
    },
    async loadLatestPhase7HealthAssessment(runtimeId) {
      const r = await db.query(
        `SELECT * FROM operations.phase7_health_assessments WHERE runtime_id=$1 ORDER BY observed_at DESC LIMIT 1`,
        [runtimeId],
      );
      return r.rows[0];
    },
    async insertPhase7DriftAssessment(v) {
      await db.query(
        `INSERT INTO operations.phase7_drift_assessments(assessment_id,policy_hash,observed_at,status,sample_count,reason_codes,deltas,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) ON CONFLICT(assessment_id) DO NOTHING`,
        [
          v.assessmentId,
          v.policyHash ?? null,
          v.observedAt,
          v.status,
          v.sampleCount,
          json(v.reasonCodes),
          json(v.deltas),
          json(v.payload),
        ],
      );
    },
    async loadLatestPhase7DriftAssessment() {
      const r = await db.query(
        `SELECT * FROM operations.phase7_drift_assessments ORDER BY observed_at DESC LIMIT 1`,
      );
      return r.rows[0];
    },
    async upsertPhase7IncidentState(v) {
      await db.query(
        `INSERT INTO operations.phase7_incident_states(incident_id,incident_type,severity,status,opened_at,observed_at,resolved_at,pool_address,token_mint,reason_codes,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb) ON CONFLICT(incident_id) DO UPDATE SET severity=EXCLUDED.severity,status=EXCLUDED.status,observed_at=EXCLUDED.observed_at,resolved_at=EXCLUDED.resolved_at,pool_address=EXCLUDED.pool_address,token_mint=EXCLUDED.token_mint,reason_codes=EXCLUDED.reason_codes,payload=EXCLUDED.payload`,
        [
          v.incidentId,
          v.incidentType,
          v.severity,
          v.status,
          v.openedAt,
          v.observedAt,
          v.resolvedAt ?? null,
          v.poolAddress ?? null,
          v.tokenMint ?? null,
          json(v.reasonCodes),
          json(v.payload),
        ],
      );
    },
    async loadActivePhase7Incidents() {
      const r = await db.query(
        `SELECT * FROM operations.phase7_incident_states WHERE status<>'RESOLVED' ORDER BY opened_at ASC`,
      );
      return r.rows;
    },
    async insertPhase7ControlDecision(v) {
      await db.query(
        `INSERT INTO operations.phase7_control_decisions(decision_id,runtime_id,cycle_key,observed_at,authority_mode,health_status,drift_status,safety_mode,daemon_plan,new_economic_action_allowed,reason_codes,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb) ON CONFLICT(decision_id) DO NOTHING`,
        [
          v.decisionId,
          v.runtimeId,
          v.cycleKey,
          v.observedAt,
          v.authorityMode,
          v.healthStatus,
          v.driftStatus,
          v.safetyMode,
          v.daemonPlan,
          v.newEconomicActionAllowed,
          json(v.reasonCodes),
          json(v.payload),
        ],
      );
    },
    async loadLatestPhase7ControlDecision(runtimeId) {
      const r = await db.query(
        `SELECT * FROM operations.phase7_control_decisions WHERE runtime_id=$1 ORDER BY observed_at DESC LIMIT 1`,
        [runtimeId],
      );
      return r.rows[0];
    },
    async insertPhase7EvidenceSnapshot(v) {
      await db.query(
        `INSERT INTO operations.phase7_evidence_snapshots(snapshot_id,runtime_id,cycle_key,observed_at,implementation_status,operational_status,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(snapshot_id) DO NOTHING`,
        [
          v.snapshotId,
          v.runtimeId,
          v.cycleKey,
          v.observedAt,
          v.implementationStatus,
          v.operationalStatus,
          json(v.payload),
        ],
      );
    },
    async loadLatestPhase7EvidenceSnapshot(runtimeId) {
      const r = await db.query(
        `SELECT * FROM operations.phase7_evidence_snapshots WHERE runtime_id=$1 ORDER BY observed_at DESC LIMIT 1`,
        [runtimeId],
      );
      return r.rows[0];
    },
    async insertPhase7EvidencePack(v) {
      await db.query(
        `INSERT INTO operations.phase7_evidence_packs(pack_hash,pack_id,source_commit,policy_hash,complete,operational_pass,created_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(pack_hash) DO NOTHING`,
        [
          v.packHash,
          v.packId,
          v.sourceCommit,
          v.policyHash,
          v.complete,
          v.operationalPass,
          v.createdAt,
          json(v.payload),
        ],
      );
    },
    async insertPhase7StageEvidence(v) {
      await db.query(
        `INSERT INTO operations.phase7_stage_evidence(evidence_id,stage,status,observed_at,evidence_hash,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(evidence_id) DO NOTHING`,
        [
          v.evidenceId,
          v.stage,
          v.status,
          v.observedAt,
          v.evidenceHash ?? null,
          json(v.payload),
        ],
      );
    },
    async loadPhase7HealthFacts(poolAddress) {
      const [decision, unknown, recon, journal, canary, portfolio] =
        await Promise.all([
          db.query(
            `SELECT observed_at FROM operations.forward_cycles WHERE pool_address=$1 ORDER BY observed_at DESC LIMIT 1`,
            [poolAddress],
          ),
          db.query(
            `SELECT count(*)::int AS n FROM execution.submission_attempts WHERE state='UNKNOWN'`,
          ),
          db.query(
            `WITH latest AS (SELECT DISTINCT ON (plan_id) plan_id,status FROM execution.reconciliations ORDER BY plan_id,observed_at DESC) SELECT count(*)::int AS n FROM latest WHERE status<>'MATCH'`,
          ),
          db.query(
            `SELECT count(*)::int AS n FROM execution.execution_journal WHERE state NOT IN ('RECONCILED','EXPIRED','FAILED','HOLD')`,
          ),
          db.query(
            `SELECT count(*)::int AS n FROM operations.phase6_canary_sessions WHERE status NOT IN ('CLOSED','FAILED')`,
          ),
          db.query(
            `SELECT observed_at FROM research.paper_portfolio_snapshots ORDER BY observed_at DESC LIMIT 1`,
          ),
        ]);
      const d = decision.rows[0]?.observed_at,
        p = portfolio.rows[0]?.observed_at;
      return {
        ...(d ? { latestDecisionAt: new Date(String(d)).toISOString() } : {}),
        unknownSubmissionCount: Number(unknown.rows[0]?.n ?? 0),
        unresolvedReconciliationDebt: Number(recon.rows[0]?.n ?? 0),
        activeExecutionJournalCount: Number(journal.rows[0]?.n ?? 0),
        openCanarySessionCount: Number(canary.rows[0]?.n ?? 0),
        ...(p
          ? { latestPortfolioObservedAt: new Date(String(p)).toISOString() }
          : {}),
      };
    },
    async loadPhase7DriftFacts(poolAddress, since) {
      const [cycles, recon, canary] = await Promise.all([
        db.query(
          `SELECT count(*)::int AS n,count(*) FILTER (WHERE phase3_status='NO_TRADE')::int AS no_trade,count(*) FILTER (WHERE phase4_status IN ('ENTRY_READY','PLAN_PREPARED'))::int AS entry_ready,count(*) FILTER (WHERE NOT (payload ? 'evidence'))::int AS feature_missing FROM operations.forward_cycles WHERE pool_address=$1 AND observed_at>=$2`,
          [poolAddress, since],
        ),
        db.query(
          `WITH latest AS (SELECT DISTINCT ON (plan_id) plan_id,status,observed_at FROM execution.reconciliations ORDER BY plan_id,observed_at DESC) SELECT count(*) FILTER (WHERE observed_at>=$1)::int AS n,count(*) FILTER (WHERE observed_at>=$1 AND status<>'MATCH')::int AS mismatch FROM latest`,
          [since],
        ),
        db.query(
          `SELECT COALESCE(sum(capital_lamports),0)::text AS capital,COALESCE(sum(execution_cost_lamports),0)::text AS cost FROM operations.phase6_canary_sessions WHERE COALESCE(opened_at,closed_at,now()) >= $1`,
          [since],
        ),
      ]);
      const c = cycles.rows[0] ?? {},
        r = recon.rows[0] ?? {},
        k = canary.rows[0] ?? {};
      return {
        cycleCount: Number(c.n ?? 0),
        noTradeCount: Number(c.no_trade ?? 0),
        entryReadyCount: Number(c.entry_ready ?? 0),
        reconciliationCount: Number(r.n ?? 0),
        reconciliationMismatchCount: Number(r.mismatch ?? 0),
        canaryCapitalLamports: Number(k.capital ?? 0),
        canaryExecutionCostLamports: Number(k.cost ?? 0),
        featureMissingCount: Number(c.feature_missing ?? 0),
      };
    },
    async loadPhase7RecoveryFacts(runtimeId) {
      const [cycles, actions, queue, unknown, recon] = await Promise.all([
        db.query(
          `SELECT cycle_key FROM operations.phase7_runtime_cycles WHERE runtime_id=$1 ORDER BY observed_at DESC LIMIT 500`,
          [runtimeId],
        ),
        db.query(
          `SELECT idempotency_key FROM execution.execution_journal WHERE state='RECONCILED' ORDER BY updated_at DESC LIMIT 500`,
        ),
        db.query(
          `SELECT count(*)::int AS n FROM execution.execution_journal WHERE state IN ('SIGNED','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED')`,
        ),
        db.query(
          `SELECT count(*)::int AS n FROM execution.submission_attempts WHERE state='UNKNOWN'`,
        ),
        db.query(
          `WITH latest AS (SELECT DISTINCT ON (plan_id) plan_id,status FROM execution.reconciliations ORDER BY plan_id,observed_at DESC) SELECT count(*)::int AS n FROM latest WHERE status<>'MATCH'`,
        ),
      ]);
      return {
        previousCompletedCycleKeys: cycles.rows.map((r) => String(r.cycle_key)),
        completedEconomicActionKeys: actions.rows.map((r) =>
          String(r.idempotency_key),
        ),
        recoveryQueueCount: Number(queue.rows[0]?.n ?? 0),
        unknownSubmissionCount: Number(unknown.rows[0]?.n ?? 0),
        unresolvedReconciliationDebt: Number(recon.rows[0]?.n ?? 0),
      };
    },
    async loadPhase7EvidenceFacts(runtimeId) {
      const [
        health,
        drift,
        control,
        runtime,
        recon,
        canary,
        dr,
        ll,
        prod,
        exit,
        readOnly,
        subs,
      ] = await Promise.all([
        db.query(
          `SELECT status FROM operations.phase7_health_assessments WHERE runtime_id=$1 ORDER BY observed_at DESC LIMIT 1`,
          [runtimeId],
        ),
        db.query(
          `SELECT status FROM operations.phase7_drift_assessments ORDER BY observed_at DESC LIMIT 1`,
        ),
        db.query(
          `SELECT safety_mode FROM operations.phase7_control_decisions WHERE runtime_id=$1 ORDER BY observed_at DESC LIMIT 1`,
          [runtimeId],
        ),
        db.query(
          `SELECT plan,count(*) OVER()::int AS total FROM operations.phase7_runtime_cycles WHERE runtime_id=$1 ORDER BY observed_at DESC LIMIT 1`,
          [runtimeId],
        ),
        db.query(
          `WITH latest AS (SELECT DISTINCT ON (plan_id) plan_id,status FROM execution.reconciliations ORDER BY plan_id,observed_at DESC) SELECT count(*) FILTER (WHERE status<>'MATCH')::int AS n FROM latest`,
        ),
        db.query(
          `SELECT count(*)::int AS n,count(*) FILTER (WHERE status='CLOSED' AND open_reconciliation_status='MATCH' AND close_reconciliation_status='MATCH')::int AS reconciled FROM operations.phase6_canary_sessions`,
        ),
        db.query(
          `SELECT status FROM operations.phase7_disaster_recovery_evidence ORDER BY observed_at DESC LIMIT 1`,
        ),
        db.query(
          `SELECT operational_status FROM operations.phase7_promotion_decisions WHERE target='LIMITED_LIVE' ORDER BY observed_at DESC LIMIT 1`,
        ),
        db.query(
          `SELECT operational_status FROM operations.phase7_promotion_decisions WHERE target='PRODUCTION' ORDER BY observed_at DESC LIMIT 1`,
        ),
        db.query(
          `SELECT count(*)::int AS n FROM operations.phase7_stage_evidence WHERE stage='P7-R10' AND status='PASS'`,
        ),
        db.query(`SELECT count(*)::int AS n FROM operations.forward_cycles`),
        db.query(
          `SELECT count(*)::int AS n FROM execution.submission_attempts WHERE state IN ('SENT','UNKNOWN')`,
        ),
      ]);
      return {
        ...(health.rows[0]?.status
          ? { latestHealthStatus: String(health.rows[0].status) }
          : {}),
        ...(drift.rows[0]?.status
          ? { latestDriftStatus: String(drift.rows[0].status) }
          : {}),
        ...(control.rows[0]?.safety_mode
          ? { latestSafetyMode: String(control.rows[0].safety_mode) }
          : {}),
        ...(runtime.rows[0]?.plan
          ? { latestRuntimePlan: String(runtime.rows[0].plan) }
          : {}),
        runtimeCycleCount: Number(runtime.rows[0]?.total ?? 0),
        unresolvedReconciliationDebt: Number(recon.rows[0]?.n ?? 0),
        canaryRunCount: Number(canary.rows[0]?.n ?? 0),
        fullyReconciledCanaryCount: Number(canary.rows[0]?.reconciled ?? 0),
        ...(dr.rows[0]?.status
          ? { latestDrStatus: String(dr.rows[0].status) }
          : {}),
        ...(ll.rows[0]?.operational_status
          ? { latestLimitedLiveStatus: String(ll.rows[0].operational_status) }
          : {}),
        ...(prod.rows[0]?.operational_status
          ? { latestProductionStatus: String(prod.rows[0].operational_status) }
          : {}),
        phase7ExitPass: Number(exit.rows[0]?.n ?? 0) > 0,
        mainnetReadOnlyCycleCount: Number(readOnly.rows[0]?.n ?? 0),
        submissionCount: Number(subs.rows[0]?.n ?? 0),
      };
    },
    async insertCanaryRun(v) {
      await db.query(
        `INSERT INTO execution.canary_runs(run_id,plan_id,pool_address,action,capital_lamports,status,started_at,ended_at,signature,reconciliation_status,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) ON CONFLICT(run_id) DO NOTHING`,
        [
          v.runId,
          v.planId ?? null,
          v.poolAddress,
          v.action,
          v.capitalLamports.toString(),
          v.status,
          v.startedAt,
          v.endedAt ?? null,
          v.signature ?? null,
          v.reconciliationStatus ?? null,
          json(v.payload),
        ],
      );
    },
  };
}

export function createMemoryStore(): Phase1Store {
  const cp = new Map<string, IngestionCheckpoint>();
  return {
    async health() {
      return true;
    },
    async close() {},
    async upsertToken() {},
    async upsertPool() {},
    async insertCompatibility() {},
    async insertPoolSnapshot() {},
    async insertBins() {},
    async upsertPosition() {},
    async insertSwapEvent() {},
    async getCheckpoint(s) {
      return cp.get(s);
    },
    async setCheckpoint(c) {
      cp.set(c.stream, c);
    },
    async insertDataApiPool() {},
    async insertOhlcv() {},
    async insertFeatureSnapshot() {},
    async insertPositionValuation() {},
    async insertSimulationRun() {},
    async insertPoolAssessment() {},
    async upsertDiscoveryPool() {},
    async insertDiscoveryObservation() {},
    async insertDiscoveryRanking() {},
    async listDiscoveryCandidates() { return []; },
    async markDiscoveryPoolsStale() { return 0; },
    async insertFeeVolumeObservations() {},
    async loadFeeVolumeObservations() { return []; },
    async insertCandidateMarketObservations() {},
    async loadCandidateMarketObservations() { return []; },
    async upsertActiveCandidateBackfill() {},
    async loadActiveCandidateBackfill() { return undefined; },
    async upsertActiveCandidateHistoryMaturity() {},
    async loadActiveCandidateHistoryMaturity() { return undefined; },
    async insertEconomicEstimate() {},
    async loadLatestEconomicEstimate() { return undefined; },
    async insertDeepScreenObservation() {},
    async insertUniverseAssignment() {},
    async insertDiscoveryPrediction() {},
    async insertDiscoveryOutcome() {},
    async upsertDiscoveryReputation() {},
    async insertDiscoveryCalibration() {},
    async insertDiscoveryBaseline() {},
    async upsertDiscoveryPolicyProposal() {},
    async loadRecentDiscoveryPredictions() { return []; },
    async loadDiscoveryOutcomes() { return []; },
    async insertForensicEpisode() {
      return "memory-episode";
    },
    async insertCounterfactual() {},
    async insertExperiment() {},
    async insertExperimentResult() {},
    async insertShadowRecommendation() {},
    async insertRegimeAssessment() {},
    async insertLpThesis() {},
    async insertEntryEvaluation() {},
    async insertRiskDecision() {},
    async upsertPaperPosition() {},
    async insertPaperPositionEvent() {},
    async insertManagementDecision() {},
    async insertCapitalAllocation() {},
    async insertPaperPortfolioSnapshot() {},
    async insertExecutionIntent() {},
    async insertTransactionPlan() {},
    async claimNextAutonomousPlan() {
      return undefined;
    },
    async reserveExecutionCapital() { return {approved:true,reasonCodes:['P6_CAPITAL_RESERVED'],deployedLamports:0n,reservedLamports:0n,availableLamports:0n}; },
    async releaseExecutionCapital() {},
    async markExecutionCapitalSubmitted() {},
    async reconcileExecutionCapitalReservations() {},
    async countExecutionActionsSince() { return 0; },
    async claimNextAutonomousOpenPlan() {
      return undefined;
    },
    async transitionAutonomousPlan() {},
    async completeAutonomousPlan() {},
    async upsertOwnedPosition() {},
    async insertPositionObservation() {},
    async loadOwnedPositions() {
      return [];
    },
    async loadPhase7PortfolioFacts() { return {deployedLamports:0n,pendingReservedLamports:0n,openPositions:0,unresolvedReconciliationDebt:0,poolExposureLamports:{},poolPendingLamports:{},tokenExposureLamports:{},tokenPendingLamports:{}}; },
    async loadPhase7PortfolioRiskState() { return undefined; },
    async upsertPhase7PortfolioRiskState() {},
    async loadPositionExitState() { return null; },
    async upsertPositionExitState() {},
    async hasActiveAutonomousPlan() {
      return false;
    },
    async markOwnedPositionLifecycle() {},
    async upsertPartialEntryRecovery() {},
    async loadPartialEntryRecoveries() {
      return [];
    },
    async loadAutonomousPlan() {
      return undefined;
    },
    async loadUnresolvedAutonomousPlans() {
      return [];
    },
    async insertExecutionSimulation() {},
    async insertExecutionRiskPermit() {},
    async prepareSubmissionAttempt() {
      return "PREPARED";
    },
    async markSubmissionSent() {},
    async markSubmissionUnknown() {},
    async insertExecutionConfirmation() {},
    async insertExecutionReconciliation() {},
    async createExecutionJournal() {
      return true;
    },
    async updateExecutionJournal() {
      return true;
    },
    async getExecutionJournal() {
      return undefined;
    },
    async insertCanaryRun() {},
    async loadOperationalHistory() {
      return {
        marketObservations: [],
        activeBins: [],
        swapEvents: [],
        binFrames: [],
      };
    },
    async loadRegimeAssessmentHistory() {
      return [];
    },
    async getLatestOpenPaperPosition() {
      return undefined;
    },
    async insertOperationalCycle() {},
    async upsertRuntimeHeartbeat() {},
    async insertDevnetValidationRun() {},
    async upsertPhase6CanarySession() {},
    async insertPhase6CanaryObservation() {},
    async insertPhase6StageEvidence() {},
    async insertPhase7OperatorAction() {},
    async upsertPhase7RuntimeLease() {},
    async getPhase7RuntimeLease() {
      return undefined;
    },
    async claimPhase7RuntimeLease() {
      return undefined;
    },
    async insertPhase7RuntimeCycle() {
      return true;
    },
    async loadRecentPhase7RuntimeCycles() {
      return [];
    },
    async insertPhase7HealthAssessment() {},
    async loadLatestPhase7HealthAssessment() {
      return undefined;
    },
    async insertPhase7DriftAssessment() {},
    async loadLatestPhase7DriftAssessment() {
      return undefined;
    },
    async upsertPhase7IncidentState() {},
    async loadActivePhase7Incidents() {
      return [];
    },
    async insertPhase7ControlDecision() {},
    async loadLatestPhase7ControlDecision() {
      return undefined;
    },
    async insertPhase7EvidenceSnapshot() {},
    async loadLatestPhase7EvidenceSnapshot() {
      return undefined;
    },
    async insertPhase7EvidencePack() {},
    async insertPhase7StageEvidence() {},
    async loadPhase7HealthFacts() {
      return {
        unknownSubmissionCount: 0,
        unresolvedReconciliationDebt: 0,
        activeExecutionJournalCount: 0,
        openCanarySessionCount: 0,
      };
    },
    async loadPhase7DriftFacts() {
      return {
        cycleCount: 0,
        noTradeCount: 0,
        entryReadyCount: 0,
        reconciliationCount: 0,
        reconciliationMismatchCount: 0,
        canaryCapitalLamports: 0,
        canaryExecutionCostLamports: 0,
        featureMissingCount: 0,
      };
    },
    async loadPhase7RecoveryFacts() {
      return {
        previousCompletedCycleKeys: [],
        completedEconomicActionKeys: [],
        recoveryQueueCount: 0,
        unknownSubmissionCount: 0,
        unresolvedReconciliationDebt: 0,
      };
    },
    async loadPhase7EvidenceFacts() {
      return {
        runtimeCycleCount: 0,
        unresolvedReconciliationDebt: 0,
        canaryRunCount: 0,
        fullyReconciledCanaryCount: 0,
        phase7ExitPass: false,
        mainnetReadOnlyCycleCount: 0,
        submissionCount: 0,
      };
    },
  };
}
