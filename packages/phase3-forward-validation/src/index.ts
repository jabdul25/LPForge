import { canonicalJson, sha256Hex, type SwapEventFact } from '../../domain/src/index.js';
import { evaluateOpportunity, type CandidateCapitalEconomics } from '../../opportunity/src/index.js';
import {
  PHASE3_FORWARD_CURRENT_OUTCOME_MODEL_VERSION,
  PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V1,
  PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2,
  PHASE3_FORWARD_OUTCOME_MODEL_VERSIONS,
} from '../../contracts/src/index.js';
import { deriveSyntheticPositionShareRaw, simulateCandidateEconomics, type CandidateEconomicSimulation } from '../../candidate-simulator/src/index.js';
import type { ShadowRecommendation } from '../../shadow/src/index.js';
import { simulateSyntheticPosition, type BinFrame, type SimulationCostModel, type SyntheticBinShare, type SyntheticPosition } from '../../simulator/src/index.js';

export {
  PHASE3_FORWARD_CURRENT_OUTCOME_MODEL_VERSION,
  PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V1,
  PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2,
  PHASE3_FORWARD_OUTCOME_MODEL_VERSIONS,
};
/** Compatibility alias: omitted model identity retains immutable V1 semantics. */
export const PHASE3_FORWARD_OUTCOME_MODEL_VERSION = PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V1;
export const PHASE3_FORWARD_HORIZONS_MINUTES = [30, 60, 120] as const;
export type ForwardOutcomeState = 'PENDING' | 'INSUFFICIENT_EVIDENCE' | 'FINAL' | 'FAILED_DATA_INTEGRITY';

export interface RuntimeArtifactProvenance {
  sourceSha: string;
  buildId: string;
  policyHash: string;
  migrationHead: string;
}

/** VC-0/VC-1 immutable contracts; research/replay only. */
export const CANONICAL_FORWARD_REPLAY_CONTRACT_VERSION = 'phase3-forward-canonical-replay-v1' as const;
export const CAPITAL_CONTRACT_VERSION = 'lpforge-capital-contract-v1' as const;
export const POSITION_CONTRACT_VERSION = 'lpforge-position-contract-v1' as const;
export type CanonicalOutcomeNamespace = 'OBSERVED_CANONICAL' | 'COUNTERFACTUAL_CANONICAL';
export type CapitalFeasibilityStatus = 'FEASIBLE_PRICE_TAKING'|'FEASIBLE_NONLINEAR'|'CAPACITY_LIMITED'|'OWNERSHIP_LIMIT'|'LIQUIDITY_LIMIT'|'CAPITAL_UTILIZATION_FAILURE'|'GEOMETRY_INFEASIBLE'|'INVALID_CAPITAL'|'UNSUPPORTED_ORIENTATION'|'UNSUPPORTED'|'UNKNOWN';
export type CapitalBindingConstraint = 'NONE'|'OWNERSHIP_CAP'|'BIN_VALUE_LIMIT'|'LIQUIDITY_UNAVAILABLE'|'CAPITAL_UTILIZATION'|'INVALID_GEOMETRY'|'INVALID_CAPITAL'|'UNSUPPORTED_ORIENTATION'|'POSITION_QUANTITY_UNREPRESENTABLE'|'UNKNOWN';
export interface CapitalContract { contractVersion:typeof CAPITAL_CONTRACT_VERSION; proposedCapitalLamports:string; candidateCapitalFraction:string; allocatedCapitalLamports:string; capitalUnit:'LAMPORTS'; capitalContractHash:string; }
export interface PositionContract { contractVersion:typeof POSITION_CONTRACT_VERSION; candidateId:string; capitalContractHash:string; positionContractHash:string; }
export interface CanonicalEvidenceManifest { contractVersion:typeof CANONICAL_FORWARD_REPLAY_CONTRACT_VERSION; recommendationId:string; decisionId:string; horizonMinutes:number; horizonStart:string; horizonEnd:string; baselineFrame:BinFrame|null; futureFrames:BinFrame[]; futureEvents:SwapEventFact[]; evidenceManifestHash:string; }
export interface CapitalEvaluationIdentity { identityVersion:'lpforge-capital-evaluation-v1'; namespace:CanonicalOutcomeNamespace; capitalEvaluationId:string; }
export interface CanonicalForwardReplayContract { canonicalContractVersion:typeof CANONICAL_FORWARD_REPLAY_CONTRACT_VERSION; namespace:CanonicalOutcomeNamespace; recommendationId:string; decisionId:string; candidateId:string|null; decisionAt:string; horizonMinutes:number; outcomeModelVersion:string; formulaVersion:string; maturerVersion:string; sourceSha:string; buildHash:string; policyHash:string; migrationHead:string; capitalContract:CapitalContract|null; positionContract:PositionContract|null; evidenceManifest:CanonicalEvidenceManifest; canonicalInputSnapshot:Record<string,unknown>; canonicalInputSnapshotHash:string; }
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
  /** M0050 research evidence; never consumed by Phase-3/4 policy. */
  marketContext?: ShadowRecommendation['decisionTimeMarketContext'];
  phase4: FrozenPhase4ForwardSnapshot;
}

/**
 * RESET-3C storage is deliberately separate from the economic and outcome
 * model versions.  V1 inlined decision-wide evidence in every candidate row;
 * V2 references the immutable shadow-recommendation snapshot and keeps only
 * candidate-specific facts inline.
 */
export const RESET3C_STORAGE_CONTRACT_V1 = 'reset3c-universe-v1' as const;
export const RESET3C_STORAGE_CONTRACT_V2 = 'reset3c-universe-v2-compact' as const;
/**
 * V3 keeps an immutable, compact census for every generated candidate while
 * reserving counterfactual replay rows for the decision-relevant subset.  It
 * is a physical-capture contract only: it does not change economics, ranking,
 * capital, ownership, or the canonical outcome model.
 */
export const RESET3C_STORAGE_CONTRACT_V3 = 'reset3c-universe-v3-decision-relevant' as const;
export const RESET3C_VALIDATION_SAMPLING_CONTRACT_V1 = 'reset3c-validation-sampling-v1' as const;
export const RESET3C_SHARED_EVIDENCE_REFERENCE_VERSION = 'shadow-recommendation-candidate-universe-v1' as const;
export const RESET3C_VALIDATION_SHARED_EVIDENCE_REFERENCE_VERSION = 'reset3c-validation-universe-shared-evidence-v1' as const;

export interface Reset3cSharedEvidenceReference {
  version: typeof RESET3C_SHARED_EVIDENCE_REFERENCE_VERSION;
  recommendationId: string;
  sharedEvidenceHash: string;
}

export interface Reset3cValidationSharedEvidenceReference {
  version: typeof RESET3C_VALIDATION_SHARED_EVIDENCE_REFERENCE_VERSION;
  recommendationId: string;
  sharedEvidenceHash: string;
}

export type Reset3cDetailedValidationReason =
  | 'CURRENT_SELECTED'
  | 'TOP_CURRENT_RANK'
  | 'TOP_LEGACY_EXPECTED_NET'
  | 'TOP_CANONICAL_EXPECTED_NET'
  | 'MAX_LEGACY_POS_CANONICAL_NEG_DISAGREEMENT'
  | 'MAX_LEGACY_NEG_CANONICAL_POS_DISAGREEMENT'
  | 'TOP_CONSTRUCTIBLE_OWNERSHIP_LIMIT'
  | 'TOP_CURRENT_RANK_FALLBACK_CONSTRUCTIBLE'
  | 'TOP_LEGACY_EXPECTED_NET_FALLBACK_CONSTRUCTIBLE'
  | 'MAX_LEGACY_POS_CANONICAL_NEG_DISAGREEMENT_FALLBACK_CONSTRUCTIBLE';

/** Minimal, decision-time-only census facts used by the V3 selector. */
export interface Reset3cValidationCensusCandidate {
  candidateId: string;
  mechanicallyConstructible: boolean;
  currentPolicyStatus?: string | null;
  currentRank?: number | null;
  legacyExpectedNetPnl?: number | null;
  canonicalExpectedNetPnl?: number | null;
}

export interface Reset3cDecisionRelevantSelection {
  samplingContractVersion: typeof RESET3C_VALIDATION_SAMPLING_CONTRACT_V1;
  /** Category winners preserve the full-census fact even when unconstructible. */
  categoryWinners: Partial<Record<Reset3cDetailedValidationReason, string>>;
  detailedCandidates: Array<{ candidateId: string; reasonCodes: Reset3cDetailedValidationReason[] }>;
}

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function byId<T extends { candidateId: string }>(a: T, b: T): number {
  return a.candidateId.localeCompare(b.candidateId);
}

/**
 * Select the smallest deterministic subset that can answer the authority
 * question.  All inputs are frozen at the decision cutoff; no outcome field
 * is accepted by this function.
 */
export function selectReset3cDecisionRelevantCandidates(input: {
  candidates: readonly Reset3cValidationCensusCandidate[];
  currentSelectedCandidateId?: string;
}): Reset3cDecisionRelevantSelection {
  const candidates = [...input.candidates];
  const byCandidateId = new Map(candidates.map(candidate => [candidate.candidateId, candidate] as const));
  const categoryWinners: Partial<Record<Reset3cDetailedValidationReason, string>> = {};
  const selected = new Map<string, Set<Reset3cDetailedValidationReason>>();
  const include = (candidateId: string | undefined, reason: Reset3cDetailedValidationReason) => {
    if (!candidateId || !byCandidateId.has(candidateId)) return;
    categoryWinners[reason] = candidateId;
    const reasons = selected.get(candidateId) ?? new Set<Reset3cDetailedValidationReason>();
    reasons.add(reason);
    selected.set(candidateId, reasons);
  };
  const currentRanked = [...candidates]
    .filter(candidate => finiteNumber(candidate.currentRank))
    .sort((a, b) => Number(a.currentRank) - Number(b.currentRank) || byId(a, b));
  const legacyRanked = [...candidates]
    .filter(candidate => finiteNumber(candidate.legacyExpectedNetPnl))
    .sort((a, b) => Number(b.legacyExpectedNetPnl) - Number(a.legacyExpectedNetPnl) || byId(a, b));
  const canonicalRanked = [...candidates]
    .filter(candidate => candidate.mechanicallyConstructible && finiteNumber(candidate.canonicalExpectedNetPnl))
    .sort((a, b) => Number(b.canonicalExpectedNetPnl) - Number(a.canonicalExpectedNetPnl) || byId(a, b));
  const constructibleRankFallback = (rows: readonly Reset3cValidationCensusCandidate[]) =>
    rows.find(candidate => candidate.mechanicallyConstructible);

  // An actual selected candidate remains explicitly represented even if a
  // later constructibility check records an unavailable forward outcome.
  include(input.currentSelectedCandidateId, 'CURRENT_SELECTED');

  const topCurrent = currentRanked[0];
  include(topCurrent?.candidateId, 'TOP_CURRENT_RANK');
  if (topCurrent && !topCurrent.mechanicallyConstructible) {
    include(constructibleRankFallback(currentRanked)?.candidateId, 'TOP_CURRENT_RANK_FALLBACK_CONSTRUCTIBLE');
  }

  const topLegacy = legacyRanked[0];
  include(topLegacy?.candidateId, 'TOP_LEGACY_EXPECTED_NET');
  if (topLegacy && !topLegacy.mechanicallyConstructible) {
    include(constructibleRankFallback(legacyRanked)?.candidateId, 'TOP_LEGACY_EXPECTED_NET_FALLBACK_CONSTRUCTIBLE');
  }

  include(canonicalRanked[0]?.candidateId, 'TOP_CANONICAL_EXPECTED_NET');

  const legacyPositiveCanonicalNegative = candidates
    .filter(candidate => finiteNumber(candidate.legacyExpectedNetPnl) && finiteNumber(candidate.canonicalExpectedNetPnl)
      && Number(candidate.legacyExpectedNetPnl) > 0 && Number(candidate.canonicalExpectedNetPnl) <= 0)
    .sort((a, b) => (Number(b.legacyExpectedNetPnl) - Number(b.canonicalExpectedNetPnl))
      - (Number(a.legacyExpectedNetPnl) - Number(a.canonicalExpectedNetPnl)) || byId(a, b));
  include(legacyPositiveCanonicalNegative[0]?.candidateId, 'MAX_LEGACY_POS_CANONICAL_NEG_DISAGREEMENT');
  if (legacyPositiveCanonicalNegative[0] && !legacyPositiveCanonicalNegative[0].mechanicallyConstructible) {
    include(constructibleRankFallback(legacyPositiveCanonicalNegative)?.candidateId, 'MAX_LEGACY_POS_CANONICAL_NEG_DISAGREEMENT_FALLBACK_CONSTRUCTIBLE');
  }

  const legacyNegativeCanonicalPositive = candidates
    .filter(candidate => candidate.mechanicallyConstructible && finiteNumber(candidate.legacyExpectedNetPnl) && finiteNumber(candidate.canonicalExpectedNetPnl)
      && Number(candidate.legacyExpectedNetPnl) <= 0 && Number(candidate.canonicalExpectedNetPnl) > 0)
    .sort((a, b) => (Number(b.canonicalExpectedNetPnl) - Number(b.legacyExpectedNetPnl))
      - (Number(a.canonicalExpectedNetPnl) - Number(a.legacyExpectedNetPnl)) || byId(a, b));
  include(legacyNegativeCanonicalPositive[0]?.candidateId, 'MAX_LEGACY_NEG_CANONICAL_POS_DISAGREEMENT');

  const ownershipLimited = canonicalRanked
    .filter(candidate => candidate.currentPolicyStatus === 'OWNERSHIP_LIMIT');
  include(ownershipLimited[0]?.candidateId, 'TOP_CONSTRUCTIBLE_OWNERSHIP_LIMIT');

  return {
    samplingContractVersion: RESET3C_VALIDATION_SAMPLING_CONTRACT_V1,
    categoryWinners,
    detailedCandidates: [...selected.entries()]
      .map(([candidateId, reasons]) => ({ candidateId, reasonCodes: [...reasons].sort() }))
      .sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
  };
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

function reset3cSharedEvidencePayload(
  recommendationId: string,
  shadowRecommendationPayload: Record<string, unknown>,
): Record<string, unknown> {
  const universe = record(shadowRecommendationPayload.candidateUniverseEvidence);
  if (!Array.isArray(universe.frames) || !Array.isArray(universe.events)) {
    throw new Error('LPFORGE_RESET3C_SHARED_EVIDENCE_UNAVAILABLE');
  }
  return {
    version: RESET3C_SHARED_EVIDENCE_REFERENCE_VERSION,
    recommendationId,
    capitalLamports: universe.capitalLamports,
    frames: universe.frames,
    events: universe.events,
    qualificationFacts: universe.qualification,
    globalEconomics: universe.economics,
  };
}

export async function buildReset3cSharedEvidenceReference(input: {
  recommendationId: string;
  shadowRecommendationPayload: Record<string, unknown>;
}): Promise<Reset3cSharedEvidenceReference> {
  return {
    version: RESET3C_SHARED_EVIDENCE_REFERENCE_VERSION,
    recommendationId: input.recommendationId,
    sharedEvidenceHash: await sha256Hex(canonicalJson(
      reset3cSharedEvidencePayload(input.recommendationId, input.shadowRecommendationPayload),
    )),
  };
}

export async function resolveReset3cSharedEvidence(input: {
  sharedEvidenceReference: Reset3cSharedEvidenceReference;
  shadowRecommendationPayload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const shared = reset3cSharedEvidencePayload(
    input.sharedEvidenceReference.recommendationId,
    input.shadowRecommendationPayload,
  );
  const actualHash = await sha256Hex(canonicalJson(shared));
  if (actualHash !== input.sharedEvidenceReference.sharedEvidenceHash) {
    throw new Error('LPFORGE_RESET3C_SHARED_EVIDENCE_HASH_MISMATCH');
  }
  return shared;
}

/**
 * V3 persists only the replay material that is shared by the selected subset.
 * The compact census and candidate predictions live elsewhere permanently;
 * this payload is deliberately eligible for deletion only after every
 * selected candidate/horizon has a terminal result.
 */
export function reset3cValidationTemporarySharedEvidence(
  recommendationId: string,
  universe: Record<string, unknown>,
  frozenDecision?: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(universe.frames) || !Array.isArray(universe.events)) {
    throw new Error('LPFORGE_RESET3C_VALIDATION_SHARED_EVIDENCE_UNAVAILABLE');
  }
  const decision = record(frozenDecision);
  const { selectedCandidate: _selectedCandidate, capitalLamports: _capitalLamports, ...sharedFrozenDecision } = decision;
  return {
    version: RESET3C_VALIDATION_SHARED_EVIDENCE_REFERENCE_VERSION,
    recommendationId,
    capitalLamports: universe.capitalLamports,
    frames: universe.frames,
    events: universe.events,
    costs: universe.costs,
    // All decision-wide state, including market context, is temporary.  A
    // detailed candidate retains only its exact candidate/capital overlay.
    ...(Object.keys(sharedFrozenDecision).length ? { frozenDecision: sharedFrozenDecision } : {}),
  };
}

export async function buildReset3cValidationSharedEvidenceReference(input: {
  recommendationId: string;
  universe: Record<string, unknown>;
  frozenDecision?: Record<string, unknown>;
}): Promise<{ reference: Reset3cValidationSharedEvidenceReference; temporarySharedEvidence: Record<string, unknown> }> {
  const temporarySharedEvidence = reset3cValidationTemporarySharedEvidence(
    input.recommendationId,
    input.universe,
    input.frozenDecision,
  );
  return {
    reference: {
      version: RESET3C_VALIDATION_SHARED_EVIDENCE_REFERENCE_VERSION,
      recommendationId: input.recommendationId,
      sharedEvidenceHash: await sha256Hex(canonicalJson(temporarySharedEvidence)),
    },
    temporarySharedEvidence,
  };
}

export async function resolveReset3cValidationSharedEvidence(input: {
  sharedEvidenceReference: Reset3cValidationSharedEvidenceReference;
  temporarySharedEvidence?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  if (!input.temporarySharedEvidence) {
    throw new Error('LPFORGE_RESET3C_VALIDATION_SHARED_EVIDENCE_PURGED');
  }
  const actualHash = await sha256Hex(canonicalJson(input.temporarySharedEvidence));
  if (actualHash !== input.sharedEvidenceReference.sharedEvidenceHash) {
    throw new Error('LPFORGE_RESET3C_VALIDATION_SHARED_EVIDENCE_HASH_MISMATCH');
  }
  if (input.temporarySharedEvidence.version !== RESET3C_VALIDATION_SHARED_EVIDENCE_REFERENCE_VERSION
    || input.temporarySharedEvidence.recommendationId !== input.sharedEvidenceReference.recommendationId) {
    throw new Error('LPFORGE_RESET3C_VALIDATION_SHARED_EVIDENCE_REFERENCE_INVALID');
  }
  return input.temporarySharedEvidence;
}

/** Store only immutable candidate facts; the decision-wide subtrees resolve by
 * a hash-bound reference to research.shadow_recommendations.payload. */
export function compactReset3cRawContract(
  v1: Record<string, unknown>,
  sharedEvidenceReference: Reset3cSharedEvidenceReference,
): Record<string, unknown> {
  return {
    version: RESET3C_STORAGE_CONTRACT_V2,
    storageContractVersion: RESET3C_STORAGE_CONTRACT_V2,
    universeManifestHash: v1.universeManifestHash,
    expectedCandidateCount: v1.expectedCandidateCount,
    capturedCandidateCount: v1.capturedCandidateCount,
    universeComplete: v1.universeComplete,
    evidenceCutoffAt: v1.evidenceCutoffAt,
    frozenDecision: v1.frozenDecision,
    candidate: v1.candidate,
    legacyEconomics: v1.legacyEconomics,
    canonicalEconomics: v1.canonicalEconomics,
    mechanicalConstructibility: v1.mechanicalConstructibility,
    rankingFacts: v1.rankingFacts,
    ...(v1.failureReason === undefined ? {} : { failureReason: v1.failureReason }),
    sharedEvidenceReference,
  };
}

/** V3 has the same candidate economics semantics as V2.  Its reference points
 * to the temporary, terminally-purgeable validation-universe record rather
 * than to the permanently retained shadow-recommendation payload. */
export function compactReset3cDecisionRelevantRawContract(
  v1: Record<string, unknown>,
  sharedEvidenceReference: Reset3cValidationSharedEvidenceReference,
  selection: { samplingContractVersion: string; detailedSelectionManifestHash: string; detailedValidationReasons: readonly string[]; outcomeEligible: boolean },
): Record<string, unknown> {
  const frozenDecision = record(v1.frozenDecision);
  const candidateCapital = frozenDecision.capitalLamports;
  return {
    version: RESET3C_STORAGE_CONTRACT_V3,
    storageContractVersion: RESET3C_STORAGE_CONTRACT_V3,
    // This representation marker distinguishes V3 rows captured before the
    // shared frozen-decision split.  Both reconstruct to the same V1 view.
    storageRepresentationVersion: 'reset3c-v3-shared-frozen-decision-v2',
    samplingContractVersion: selection.samplingContractVersion,
    detailedSelectionManifestHash: selection.detailedSelectionManifestHash,
    detailedValidationReasons: [...selection.detailedValidationReasons].sort(),
    outcomeEligible: selection.outcomeEligible,
    universeManifestHash: v1.universeManifestHash,
    expectedCandidateCount: v1.expectedCandidateCount,
    capturedCandidateCount: v1.capturedCandidateCount,
    universeComplete: v1.universeComplete,
    evidenceCutoffAt: v1.evidenceCutoffAt,
    // The decision-wide frozen object (notably market context) is held once
    // in temporary shared evidence.  The exact candidate and capital remain
    // inline and are merged back before canonical outcome maturation.
    frozenDecision: candidateCapital === undefined ? {} : { capitalLamports: candidateCapital },
    candidate: v1.candidate,
    legacyEconomics: v1.legacyEconomics,
    canonicalEconomics: v1.canonicalEconomics,
    mechanicalConstructibility: v1.mechanicalConstructibility,
    rankingFacts: v1.rankingFacts,
    ...(v1.failureReason === undefined ? {} : { failureReason: v1.failureReason }),
    sharedEvidenceReference,
  };
}

/**
 * Returns the V1 semantic view for both physical representations.  A missing
 * or changed shared snapshot is an integrity failure, never a live-state
 * reconstruction or a silently degraded counterfactual input.
 */
export async function reconstructReset3cRawContract(input: {
  rawContract: Record<string, unknown>;
  shadowRecommendationPayload?: Record<string, unknown>;
  temporarySharedEvidence?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const raw = input.rawContract;
  if (raw.version === RESET3C_STORAGE_CONTRACT_V1) return raw;
  if (raw.version === RESET3C_STORAGE_CONTRACT_V3) {
    const reference = record(raw.sharedEvidenceReference);
    const recommendationId = typeof reference.recommendationId === 'string' ? reference.recommendationId : '';
    const expectedHash = typeof reference.sharedEvidenceHash === 'string' ? reference.sharedEvidenceHash : '';
    if (!recommendationId || !expectedHash) throw new Error('LPFORGE_RESET3C_VALIDATION_SHARED_EVIDENCE_REFERENCE_INVALID');
    const shared = await resolveReset3cValidationSharedEvidence({
      sharedEvidenceReference: {
        version: RESET3C_VALIDATION_SHARED_EVIDENCE_REFERENCE_VERSION,
        recommendationId,
        sharedEvidenceHash: expectedHash,
      },
      ...(input.temporarySharedEvidence ? { temporarySharedEvidence: input.temporarySharedEvidence } : {}),
    });
    return reconstructReset3cRawContractFromResolvedShared(raw, shared);
  }
  if (raw.version !== RESET3C_STORAGE_CONTRACT_V2) {
    throw new Error('LPFORGE_RESET3C_STORAGE_CONTRACT_UNKNOWN');
  }
  const reference = record(raw.sharedEvidenceReference);
  const recommendationId = typeof reference.recommendationId === 'string'
    ? reference.recommendationId
    : '';
  const expectedHash = typeof reference.sharedEvidenceHash === 'string'
    ? reference.sharedEvidenceHash
    : '';
  if (!recommendationId || !expectedHash || !input.shadowRecommendationPayload) {
    throw new Error('LPFORGE_RESET3C_SHARED_EVIDENCE_REFERENCE_INVALID');
  }
  const shared = await resolveReset3cSharedEvidence({
    sharedEvidenceReference: {
      version: RESET3C_SHARED_EVIDENCE_REFERENCE_VERSION,
      recommendationId,
      sharedEvidenceHash: expectedHash,
    },
    shadowRecommendationPayload: input.shadowRecommendationPayload,
  });
  return reconstructReset3cRawContractFromResolvedShared(raw, shared);
}

/** The DB loader resolves/hash-checks each shared universe once per bounded
 * batch, then reuses the same immutable object for its candidate rows. */
export function reconstructReset3cRawContractFromResolvedShared(
  raw: Record<string, unknown>,
  shared: Record<string, unknown>,
): Record<string, unknown> {
  if (raw.version !== RESET3C_STORAGE_CONTRACT_V2 && raw.version !== RESET3C_STORAGE_CONTRACT_V3) {
    throw new Error('LPFORGE_RESET3C_STORAGE_CONTRACT_UNKNOWN');
  }
  const mechanical = record(raw.mechanicalConstructibility);
  const sharedFrozenDecision = record(shared.frozenDecision);
  const candidateFrozenDecision = record(raw.frozenDecision);
  const reconstructedFrozenDecision = raw.version === RESET3C_STORAGE_CONTRACT_V3
    && Object.keys(sharedFrozenDecision).length
    ? {
      ...sharedFrozenDecision,
      ...candidateFrozenDecision,
      selectedCandidate: raw.candidate,
    }
    : raw.frozenDecision;
  return {
    ...raw,
    frozenDecision: reconstructedFrozenDecision,
    frames: shared.frames,
    events: shared.events,
    qualificationFacts: shared.qualificationFacts,
    globalEconomics: shared.globalEconomics,
    currentPolicy: mechanical.currentPolicyFeasibility ?? null,
  };
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
    ...(recommendation.decisionTimeMarketContext?{marketContext:recommendation.decisionTimeMarketContext}:{}),
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
  replayContract?: CanonicalForwardReplayContract;
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

/**
 * The V2 capital representation is also consumed by the downstream,
 * research-only telemetry recorder.  Exporting this pure representation does
 * not give telemetry any authority over maturation or Phase-3 decisions.
 */
export interface CapitalConstrainedForwardPosition {
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

/** Strict decimal boundary: identity is always an integer lamport value. */
export function solToLamports(value:string|number):bigint {
  const text=String(value).trim();
  if(!/^\d+(?:\.\d{1,9})?$/.test(text)) throw new Error('LPFORGE_CAPITAL_SOL_INVALID');
  const pieces=text.split('.'), whole=pieces[0]!, fraction=pieces[1]??'';
  return BigInt(whole)*1_000_000_000n+BigInt((fraction+'000000000').slice(0,9));
}
export function lamportsToDisplaySol(value:bigint):string {
  if(value<0n) throw new Error('LPFORGE_CAPITAL_LAMPORTS_INVALID');
  const whole=value/1_000_000_000n, fraction=(value%1_000_000_000n).toString().padStart(9,'0').replace(/0+$/,'');
  return fraction?`${whole}.${fraction}`:whole.toString();
}
function normalizedCapitalFraction(value:number):bigint|undefined {
  if(!Number.isFinite(value)||value<=0||value>1)return undefined;
  const out=BigInt(Math.round(value*Number(FORWARD_V2_WEIGHT_SCALE)));
  return out>0n&&out<=FORWARD_V2_WEIGHT_SCALE?out:undefined;
}
export async function buildCapitalContract(input:{proposedCapitalLamports:bigint;candidateCapitalFraction:number}):Promise<CapitalContract> {
  const fraction=normalizedCapitalFraction(input.candidateCapitalFraction);
  if(input.proposedCapitalLamports<=0n||fraction===undefined)throw new Error('LPFORGE_CAPITAL_CONTRACT_INVALID');
  const core={contractVersion:CAPITAL_CONTRACT_VERSION,proposedCapitalLamports:input.proposedCapitalLamports.toString(),candidateCapitalFraction:fraction.toString(),allocatedCapitalLamports:((input.proposedCapitalLamports*fraction)/FORWARD_V2_WEIGHT_SCALE).toString(),capitalUnit:'LAMPORTS' as const};
  return{...core,capitalContractHash:await sha256Hex(canonicalJson(core))};
}
export async function buildPositionContract(input:{decision:FrozenPhase3ForwardDecision;candidate:NonNullable<FrozenPhase3ForwardDecision['selectedCandidate']>;baseline:BinFrame;capitalContract:CapitalContract}):Promise<PositionContract> {
  const candidateBins=[...input.candidate.perBinWeights].sort((a,b)=>a.binId-b.binId).map(weight=>({binId:weight.binId,weight:weight.weight,baselineBin:input.baseline.bins.find(bin=>bin.binId===weight.binId)??null}));
  const core={contractVersion:POSITION_CONTRACT_VERSION,candidateId:input.candidate.id,capitalContractHash:input.capitalContract.capitalContractHash,strategy:input.candidate.strategy,orientation:input.candidate.orientation,lowerBin:input.candidate.lowerBinId,upperBin:input.candidate.upperBinId,entryActiveBin:input.baseline.activeBinId,entryObservedAt:input.baseline.observedAt,weights:candidateBins,rawUnitValueX:input.decision.prediction.rawUnitValueX??null,rawUnitValueY:input.decision.prediction.rawUnitValueY??null,constructorVersion:'deriveCapitalConstrainedForwardPosition-v2'};
  return{contractVersion:POSITION_CONTRACT_VERSION,candidateId:input.candidate.id,capitalContractHash:input.capitalContract.capitalContractHash,positionContractHash:await sha256Hex(canonicalJson(core))};
}
export async function buildCapitalEvaluationIdentity(input:{decision:FrozenPhase3ForwardDecision;candidate:NonNullable<FrozenPhase3ForwardDecision['selectedCandidate']>;capitalContract:CapitalContract;positionContract:PositionContract|null;modelVersion:string;formulaVersion:string;namespace:CanonicalOutcomeNamespace}):Promise<CapitalEvaluationIdentity> {
  const core={identityVersion:'lpforge-capital-evaluation-v1' as const,namespace:input.namespace,decisionId:input.decision.decisionId,recommendationId:input.decision.recommendationId,candidateId:input.candidate.id,proposedCapitalLamports:input.capitalContract.proposedCapitalLamports,allocatedCapitalLamports:input.capitalContract.allocatedCapitalLamports,capitalContractHash:input.capitalContract.capitalContractHash,positionContractHash:input.positionContract?.positionContractHash??null,modelVersion:input.modelVersion,formulaVersion:input.formulaVersion};
  return{identityVersion:'lpforge-capital-evaluation-v1',namespace:input.namespace,capitalEvaluationId:await sha256Hex(canonicalJson(core))};
}
export async function buildCanonicalEvidenceManifest(input:{decision:FrozenPhase3ForwardDecision;horizonMinutes:number;baseline:BinFrame|null;futureFrames:BinFrame[];futureEvents:SwapEventFact[]}):Promise<CanonicalEvidenceManifest> {
  const start=Date.parse(input.decision.decisionTimestamp), end=start+input.horizonMinutes*60_000;
  const core={contractVersion:CANONICAL_FORWARD_REPLAY_CONTRACT_VERSION,recommendationId:input.decision.recommendationId,decisionId:input.decision.decisionId,horizonMinutes:input.horizonMinutes,horizonStart:new Date(start).toISOString(),horizonEnd:new Date(end).toISOString(),baselineFrame:input.baseline?copy(input.baseline):null,futureFrames:[...input.futureFrames].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||a.activeBinId-b.activeBinId).map(copy),futureEvents:[...input.futureEvents].sort((a,b)=>Date.parse(a.stamp.observedAt)-Date.parse(b.stamp.observedAt)||a.signature.localeCompare(b.signature)||a.eventIndex-b.eventIndex).map(copy)};
  return{...core,evidenceManifestHash:await sha256Hex(canonicalJson(core))};
}
export async function buildCanonicalForwardReplayContract(input:{decision:FrozenPhase3ForwardDecision;horizonMinutes:number;outcomeModelVersion:string;baseline:BinFrame|null;futureFrames:BinFrame[];futureEvents:SwapEventFact[];namespace?:CanonicalOutcomeNamespace}):Promise<CanonicalForwardReplayContract> {
  const candidate=input.decision.selectedCandidate;
  const evidenceManifest=await buildCanonicalEvidenceManifest({decision:input.decision,horizonMinutes:input.horizonMinutes,baseline:input.baseline,futureFrames:input.futureFrames,futureEvents:input.futureEvents});
  const capitalContract=candidate?await buildCapitalContract({proposedCapitalLamports:forwardRaw(input.decision.capitalLamports),candidateCapitalFraction:candidate.capitalFraction}):null;
  const positionContract=candidate&&input.baseline&&capitalContract?await buildPositionContract({decision:input.decision,candidate,baseline:input.baseline,capitalContract}):null;
  const canonicalInputSnapshot={decision:copy(input.decision),outcomeModelVersion:input.outcomeModelVersion,horizonMinutes:input.horizonMinutes,namespace:input.namespace??'OBSERVED_CANONICAL',evidenceManifestHash:evidenceManifest.evidenceManifestHash,formulaVersion:input.outcomeModelVersion===PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2?'capital-constrained-forward-v2':'historical-synthetic-forward-v1',maturerVersion:'phase3-forward-maturer-v2'};
  const core={canonicalContractVersion:CANONICAL_FORWARD_REPLAY_CONTRACT_VERSION,namespace:input.namespace??'OBSERVED_CANONICAL',recommendationId:input.decision.recommendationId,decisionId:input.decision.decisionId,candidateId:candidate?.id??null,decisionAt:input.decision.decisionTimestamp,horizonMinutes:input.horizonMinutes,outcomeModelVersion:input.outcomeModelVersion,formulaVersion:input.outcomeModelVersion===PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2?'capital-constrained-forward-v2':'historical-synthetic-forward-v1',maturerVersion:'phase3-forward-maturer-v2',sourceSha:input.decision.sourceSha,buildHash:input.decision.buildId,policyHash:input.decision.policyHash,migrationHead:input.decision.migrationHead,capitalContract,positionContract,evidenceManifest,canonicalInputSnapshot};
  return{...core,canonicalInputSnapshotHash:await sha256Hex(canonicalJson(canonicalInputSnapshot))};
}
export async function replayCanonicalForwardContract(contract:CanonicalForwardReplayContract):Promise<Phase3ForwardOutcome> {
  const decision=contract.canonicalInputSnapshot.decision as FrozenPhase3ForwardDecision|undefined;
  if(!decision||typeof decision!=="object")throw new Error("LPFORGE_CANONICAL_REPLAY_INPUT_MISSING");
  const baseline=contract.evidenceManifest.baselineFrame;
  if(!baseline)throw new Error("LPFORGE_CANONICAL_REPLAY_BASELINE_MISSING");
  const replayHash=await sha256Hex(canonicalJson(contract.canonicalInputSnapshot));
  if(replayHash!==contract.canonicalInputSnapshotHash)throw new Error("LPFORGE_CANONICAL_REPLAY_INPUT_HASH_INVALID");
  return matureFrozenPhase3ForwardOutcome({decision,horizonMinutes:contract.horizonMinutes as 30|60|120,outcomeModelVersion:contract.outcomeModelVersion,frames:[baseline,...contract.evidenceManifest.futureFrames],events:contract.evidenceManifest.futureEvents,now:contract.evidenceManifest.horizonEnd});
}
export interface CapitalFeasibilityResult { status:CapitalFeasibilityStatus; proposedCapitalLamports:string; allocatedCapitalLamports?:string; capitalUtilizationBps?:number; ownershipProfile:Array<CapitalConstrainedForwardPosition['bins'][number]>; maxOwnershipBps?:number; perBinSupport:Array<{binId:number;baselineBinValueLamports?:string;allocatedCapitalLamports?:string;effectiveOwnershipBps?:number}>; bindingConstraint:CapitalBindingConstraint; failureReason?:string; capitalContract:CapitalContract|null; positionContract:PositionContract|null; canonicalPosition?:CapitalConstrainedForwardPosition; provenance:{constructorVersion:string;tokenOrientation:'WSOL_AS_Y'|'WSOL_AS_X'|'UNKNOWN'}; }
function feasibilityBinding(reason:string|undefined):{status:CapitalFeasibilityStatus;binding:CapitalBindingConstraint}{
  if(reason==='FORWARD_V2_NOT_PRICE_TAKING')return{status:'OWNERSHIP_LIMIT',binding:'OWNERSHIP_CAP'};
  if(reason==='FORWARD_V2_CAPITAL_EXCEEDS_BIN_VALUE')return{status:'CAPACITY_LIMITED',binding:'BIN_VALUE_LIMIT'};
  if(reason==='FORWARD_V2_BIN_LIQUIDITY_UNAVAILABLE')return{status:'LIQUIDITY_LIMIT',binding:'LIQUIDITY_UNAVAILABLE'};
  if(reason==='FORWARD_V2_CAPITAL_REPRESENTATION_INVALID')return{status:'CAPITAL_UTILIZATION_FAILURE',binding:'CAPITAL_UTILIZATION'};
  if(reason==='FORWARD_V2_CAPITAL_ALLOCATION_INVALID')return{status:'GEOMETRY_INFEASIBLE',binding:'INVALID_GEOMETRY'};
  if(reason==='FORWARD_V2_FROZEN_CAPITAL_INVALID')return{status:'INVALID_CAPITAL',binding:'INVALID_CAPITAL'};
  if(reason==='FORWARD_V2_POSITION_QUANTITY_UNREPRESENTABLE')return{status:'CAPACITY_LIMITED',binding:'POSITION_QUANTITY_UNREPRESENTABLE'};
  return{status:'UNKNOWN',binding:'UNKNOWN'};
}
export async function evaluateCapitalFeasibility(input:{decision:FrozenPhase3ForwardDecision;candidate:NonNullable<FrozenPhase3ForwardDecision['selectedCandidate']>;baseline:BinFrame;proposedCapitalLamports:bigint;tokenOrientation?:'WSOL_AS_Y'|'WSOL_AS_X'|'UNKNOWN'}):Promise<CapitalFeasibilityResult> {
  const tokenOrientation=input.tokenOrientation??'WSOL_AS_Y';
  if(tokenOrientation==='WSOL_AS_X')return{status:'UNSUPPORTED_ORIENTATION',proposedCapitalLamports:input.proposedCapitalLamports.toString(),ownershipProfile:[],perBinSupport:[],bindingConstraint:'UNSUPPORTED_ORIENTATION',failureReason:'FORWARD_V2_CANONICAL_WSOL_AS_X_UNSUPPORTED',capitalContract:null,positionContract:null,provenance:{constructorVersion:'deriveCapitalConstrainedForwardPosition-v2',tokenOrientation}};
  let capitalContract:CapitalContract;
  try{capitalContract=await buildCapitalContract({proposedCapitalLamports:input.proposedCapitalLamports,candidateCapitalFraction:input.candidate.capitalFraction});}catch{return{status:'INVALID_CAPITAL',proposedCapitalLamports:input.proposedCapitalLamports.toString(),ownershipProfile:[],perBinSupport:[],bindingConstraint:'INVALID_CAPITAL',failureReason:'LPFORGE_CAPITAL_CONTRACT_INVALID',capitalContract:null,positionContract:null,provenance:{constructorVersion:'deriveCapitalConstrainedForwardPosition-v2',tokenOrientation}};}
  const decision=copy({...input.decision,capitalLamports:input.proposedCapitalLamports.toString()});
  const positionContract=await buildPositionContract({decision,candidate:input.candidate,baseline:input.baseline,capitalContract});
  const derived=deriveCapitalConstrainedForwardPosition({decision,candidate:input.candidate,baseline:input.baseline});
  if(!derived.position){const reason=derived.reasonCodes?.[0];const mapped=feasibilityBinding(reason);return{status:mapped.status,proposedCapitalLamports:input.proposedCapitalLamports.toString(),allocatedCapitalLamports:capitalContract.allocatedCapitalLamports,ownershipProfile:[],perBinSupport:[],bindingConstraint:mapped.binding,...(reason?{failureReason:reason}:{}),capitalContract,positionContract,provenance:{constructorVersion:'deriveCapitalConstrainedForwardPosition-v2',tokenOrientation}};}
  const position=derived.position, utilization=Number((position.derivedPositionValueLamports*FORWARD_V2_BPS_SCALE)/position.allocatedCapitalLamports);
  return{status:'FEASIBLE_PRICE_TAKING',proposedCapitalLamports:input.proposedCapitalLamports.toString(),allocatedCapitalLamports:position.allocatedCapitalLamports.toString(),capitalUtilizationBps:utilization,ownershipProfile:position.bins,perBinSupport:position.bins.map(row=>({binId:row.binId,baselineBinValueLamports:row.baselineBinValueLamports,allocatedCapitalLamports:row.allocatedCapitalLamports,effectiveOwnershipBps:row.effectiveOwnershipBps})),maxOwnershipBps:position.maxEffectiveOwnershipBps,bindingConstraint:'NONE',capitalContract,positionContract,canonicalPosition:position,provenance:{constructorVersion:'deriveCapitalConstrainedForwardPosition-v2',tokenOrientation}};
}
export interface MaximumFeasibleCapitalResult { maximumFeasibleCapitalLamports?:string; allocatedCapitalAtMaximum?:string; firstBindingConstraint:CapitalBindingConstraint; status:'EXACT_MONOTONIC_SEARCH'|'MONOTONICITY_NOT_PROVEN'|'NO_FEASIBLE_CAPITAL'|'INPUT_INVALID'; analyticUpperBoundLamports?:string; probes:Array<{capitalLamports:string;status:CapitalFeasibilityStatus}>; }
export interface MechanicalCapitalConstructibilityResult {
  mechanicallyConstructible:boolean;
  mechanicalFailureReason?:string;
  currentPolicyFeasibility:CapitalFeasibilityResult;
  allocatedCapitalLamports?:string;
  capitalUtilizationBps?:number;
  maxOwnershipBps?:number;
  ownershipProfile:Array<CapitalConstrainedForwardPosition['bins'][number]>;
  canonicalPosition?:CapitalConstrainedForwardPosition;
}

/**
 * Research-only constructibility view. It preserves the current VC-2
 * price-taking policy result but evaluates the same canonical position without
 * enforcing the internal 500-bps ownership preference. A failed result means
 * the current canonical position representation cannot safely construct the
 * requested position; it does not assert an on-chain Meteora rejection.
 */
export async function evaluateMechanicalCapitalConstructibility(input:{decision:FrozenPhase3ForwardDecision;candidate:NonNullable<FrozenPhase3ForwardDecision['selectedCandidate']>;baseline:BinFrame;proposedCapitalLamports:bigint;tokenOrientation?:'WSOL_AS_Y'|'WSOL_AS_X'|'UNKNOWN'}):Promise<MechanicalCapitalConstructibilityResult> {
  const currentPolicyFeasibility=await evaluateCapitalFeasibility(input);
  const tokenOrientation=input.tokenOrientation??'WSOL_AS_Y';
  if(tokenOrientation!=='WSOL_AS_Y')return{mechanicallyConstructible:false,mechanicalFailureReason:currentPolicyFeasibility.failureReason??currentPolicyFeasibility.bindingConstraint,currentPolicyFeasibility,ownershipProfile:[]};
  let capitalContract:CapitalContract;
  try{capitalContract=await buildCapitalContract({proposedCapitalLamports:input.proposedCapitalLamports,candidateCapitalFraction:input.candidate.capitalFraction});}catch{return{mechanicallyConstructible:false,mechanicalFailureReason:'LPFORGE_CAPITAL_CONTRACT_INVALID',currentPolicyFeasibility,ownershipProfile:[]};}
  const decision=copy({...input.decision,capitalLamports:input.proposedCapitalLamports.toString()});
  const derived=deriveCapitalConstrainedForwardPosition({decision,candidate:input.candidate,baseline:input.baseline,enforcePriceTakingOwnershipCap:false});
  if(!derived.position)return{mechanicallyConstructible:false,mechanicalFailureReason:derived.reasonCodes?.[0]??'FORWARD_V2_POSITION_UNAVAILABLE',currentPolicyFeasibility,allocatedCapitalLamports:capitalContract.allocatedCapitalLamports,ownershipProfile:[]};
  const position=derived.position;
  return{mechanicallyConstructible:true,currentPolicyFeasibility,allocatedCapitalLamports:position.allocatedCapitalLamports.toString(),capitalUtilizationBps:Number((position.derivedPositionValueLamports*FORWARD_V2_BPS_SCALE)/position.allocatedCapitalLamports),maxOwnershipBps:position.maxEffectiveOwnershipBps,ownershipProfile:position.bins,canonicalPosition:position};
}

export async function deriveMaximumFeasibleCapital(input:{decision:FrozenPhase3ForwardDecision;candidate:NonNullable<FrozenPhase3ForwardDecision['selectedCandidate']>;baseline:BinFrame;tokenOrientation?:'WSOL_AS_Y'|'WSOL_AS_X'|'UNKNOWN'}):Promise<MaximumFeasibleCapitalResult> {
  const fraction=normalizedCapitalFraction(input.candidate.capitalFraction), weights=forwardWeightNumerators(input.candidate), rawX=Number(input.decision.prediction.rawUnitValueX??0),rawY=Number(input.decision.prediction.rawUnitValueY??0);
  if(!fraction||!weights||rawX<=0||rawY<=0)return{status:'INPUT_INVALID',firstBindingConstraint:'INVALID_CAPITAL',probes:[]};
  const total=weights.reduce((a,b)=>a+b,0n), map=new Map(input.baseline.bins.map(bin=>[bin.binId,bin] as const));let upper:bigint|undefined;
  for(let i=0;i<weights.length;i++){const weight=weights[i]!,candidateWeight=input.candidate.perBinWeights[i]!;if(weight<=0n)continue;const bin=map.get(candidateWeight.binId), x=forwardSafeNumber(forwardRaw(bin?.amountX)),y=forwardSafeNumber(forwardRaw(bin?.amountY));if(!bin||x===undefined||y===undefined)return{status:'INPUT_INVALID',firstBindingConstraint:'LIQUIDITY_UNAVAILABLE',probes:[]};const value=BigInt(Math.floor((x*rawX+y*rawY)/rawY));if(value<=0n)return{status:'INPUT_INVALID',firstBindingConstraint:'BIN_VALUE_LIMIT',probes:[]};const maxAllocation=(((BigInt(FORWARD_V2_MAX_PRICE_TAKING_OWNERSHIP_BPS)+1n)*value+FORWARD_V2_BPS_SCALE-1n)/FORWARD_V2_BPS_SCALE)-1n;const maxAllocatedTotal=(maxAllocation*total+weight-1n)/weight;const proposed=(maxAllocatedTotal*FORWARD_V2_WEIGHT_SCALE+fraction-1n)/fraction;upper=upper===undefined?proposed:(proposed<upper?proposed:upper);}
  if(!upper||upper<=0n)return{status:'INPUT_INVALID',firstBindingConstraint:'BIN_VALUE_LIMIT',probes:[]};
  const probes:Array<{capitalLamports:string;status:CapitalFeasibilityStatus}>=[];const evaluate=async(capital:bigint)=>{const result=await evaluateCapitalFeasibility({...input,proposedCapitalLamports:capital});probes.push({capitalLamports:capital.toString(),status:result.status});return result;};
  let low=1n, seed:bigint|undefined;while(low<=upper){const r=await evaluate(low);if(r.status==='FEASIBLE_PRICE_TAKING'){seed=low;break;}low*=2n;}
  if(!seed)return{status:'NO_FEASIBLE_CAPITAL',firstBindingConstraint:probes.at(-1)?.status==='OWNERSHIP_LIMIT'?'OWNERSHIP_CAP':'UNKNOWN',analyticUpperBoundLamports:upper.toString(),probes};
  let left=seed,right=upper,best=seed;while(left<=right){const mid=(left+right)/2n,r=await evaluate(mid);if(r.status==='FEASIBLE_PRICE_TAKING'){best=mid;left=mid+1n;}else right=mid-1n;}
  const atBest=await evaluateCapitalFeasibility({...input,proposedCapitalLamports:best}),after=best<upper?await evaluateCapitalFeasibility({...input,proposedCapitalLamports:best+1n}):undefined;
  const sampleCount=17n;let monotonic=true;for(let i=0n;i<=sampleCount;i++){const c=seed+((best-seed)*i)/sampleCount,r=await evaluate(c);if(r.status!=='FEASIBLE_PRICE_TAKING')monotonic=false;}if(after?.status==='FEASIBLE_PRICE_TAKING')monotonic=false;
  return{status:monotonic?'EXACT_MONOTONIC_SEARCH':'MONOTONICITY_NOT_PROVEN',maximumFeasibleCapitalLamports:best.toString(),...(atBest.allocatedCapitalLamports?{allocatedCapitalAtMaximum:atBest.allocatedCapitalLamports}:{}),firstBindingConstraint:after?.bindingConstraint??'OWNERSHIP_CAP',analyticUpperBoundLamports:upper.toString(),probes};
}
export function deriveCapitalConstrainedForwardPosition(input: {
  decision: FrozenPhase3ForwardDecision;
  candidate: NonNullable<FrozenPhase3ForwardDecision['selectedCandidate']>;
  baseline: BinFrame;
  /** The 500-bps price-taking ceiling is an LPForge policy assumption, not a DLMM construction requirement. */
  enforcePriceTakingOwnershipCap?: boolean;
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
      return { reasonCodes: ['FORWARD_V2_CAPITAL_EXCEEDS_BIN_VALUE'] };
    }
    const requestedBps = (allocation * FORWARD_V2_BPS_SCALE) / valueLamports;
    if (input.enforcePriceTakingOwnershipCap !== false && requestedBps > BigInt(FORWARD_V2_MAX_PRICE_TAKING_OWNERSHIP_BPS)) {
      return { reasonCodes: ['FORWARD_V2_NOT_PRICE_TAKING'] };
    }
    // p/(s+p) <= allocation/binValue: floor preserves the frozen capital cap.
    const positionShareRaw = (supply * allocation) / (valueLamports - allocation);
    if (positionShareRaw <= 0n) return { reasonCodes: ['FORWARD_V2_POSITION_QUANTITY_UNREPRESENTABLE'] };
    const ownershipBps = Number((positionShareRaw * FORWARD_V2_BPS_SCALE) / (supply + positionShareRaw));
    if (input.enforcePriceTakingOwnershipCap !== false && ownershipBps > FORWARD_V2_MAX_PRICE_TAKING_OWNERSHIP_BPS) return { reasonCodes: ['FORWARD_V2_NOT_PRICE_TAKING'] };
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

export function forwardV2ValueLamports(tokenXRaw: bigint, tokenYRaw: bigint, rawUnitValueX: number, rawUnitValueY: number): bigint | undefined {
  const x = forwardSafeNumber(tokenXRaw), y = forwardSafeNumber(tokenYRaw);
  if (x === undefined || y === undefined || !Number.isFinite(rawUnitValueX) || rawUnitValueX <= 0 || !Number.isFinite(rawUnitValueY) || rawUnitValueY <= 0) return undefined;
  const value = (x * rawUnitValueX + y * rawUnitValueY) / rawUnitValueY;
  return Number.isFinite(value) && value >= 0 ? BigInt(Math.trunc(value)) : undefined;
}

/** Shadow-only supplied-capital evaluation. It keeps current VC-2 policy facts
 * observable, while economics are available whenever the canonical position
 * can be constructed without the internal price-taking ownership preference. */
export interface UserSelectedCapitalCandidateSimulation {
  candidateId:string; feeValue:number; inventoryChangeValue:number; totalCostValue:number; netValue:number;
  evidenceActionable:boolean; warnings:string[]; activeDurationMs:number; inactiveDurationMs:number;
  occupancyCoverageRatio:number; maxEffectiveOwnershipBps:number;
}
export interface UserSelectedCapitalEvaluation {
  economics:CandidateCapitalEconomics;
  /** Existing strict VC-2 / price-taking policy result; never changed here. */
  feasibility:CapitalFeasibilityResult;
  constructibility:MechanicalCapitalConstructibilityResult;
  simulation?:UserSelectedCapitalCandidateSimulation;
}
export async function evaluateUserSelectedCapitalOpportunity(input:{
  decision:FrozenPhase3ForwardDecision; candidate:NonNullable<FrozenPhase3ForwardDecision['selectedCandidate']>;
  baseline:BinFrame; frames:BinFrame[]; events:SwapEventFact[]; userSelectedCapitalLamports:bigint;
  costs?:SimulationCostModel; tokenOrientation?:'WSOL_AS_Y'|'WSOL_AS_X'|'UNKNOWN'; softRiskReasons?:string[];
}):Promise<UserSelectedCapitalEvaluation>{
  const cutoff=Date.parse(input.decision.decisionTimestamp);
  if(!Number.isFinite(cutoff)||Date.parse(input.baseline.observedAt)>cutoff||input.frames.some(frame=>!Number.isFinite(Date.parse(frame.observedAt))||Date.parse(frame.observedAt)>cutoff)||input.events.some(event=>!Number.isFinite(Date.parse(event.stamp.observedAt))||Date.parse(event.stamp.observedAt)>cutoff))throw new Error('LPFORGE_USER_SELECTED_CAPITAL_LOOKAHEAD');
  // Capital fraction is legacy candidate metadata, not sizing authority on this path.
  const candidate={...input.candidate,capitalFraction:1};
  const constructibility=await evaluateMechanicalCapitalConstructibility({decision:input.decision,candidate,baseline:input.baseline,proposedCapitalLamports:input.userSelectedCapitalLamports,...(input.tokenOrientation?{tokenOrientation:input.tokenOrientation}:{})});
  const feasibility=constructibility.currentPolicyFeasibility;
  const economyFeasibility:CapitalFeasibilityResult=constructibility.mechanicallyConstructible&&constructibility.canonicalPosition
    ? {...feasibility,status:'FEASIBLE_NONLINEAR',bindingConstraint:'NONE',allocatedCapitalLamports:constructibility.allocatedCapitalLamports!,capitalUtilizationBps:constructibility.capitalUtilizationBps!,maxOwnershipBps:constructibility.maxOwnershipBps!,ownershipProfile:constructibility.ownershipProfile,perBinSupport:constructibility.ownershipProfile.map(row=>({binId:row.binId,baselineBinValueLamports:row.baselineBinValueLamports,allocatedCapitalLamports:row.allocatedCapitalLamports,effectiveOwnershipBps:row.effectiveOwnershipBps})),canonicalPosition:constructibility.canonicalPosition}
    : feasibility;
  const decorate=(economics:CandidateCapitalEconomics):CandidateCapitalEconomics=>({
    ...economics,
    mechanicallyConstructible:constructibility.mechanicallyConstructible,
    ...(constructibility.mechanicalFailureReason?{mechanicalFailureReason:constructibility.mechanicalFailureReason}:{}),
    currentPolicyFeasible:feasibility.status==='FEASIBLE_PRICE_TAKING'||feasibility.status==='FEASIBLE_NONLINEAR',
    currentPolicyStatus:feasibility.status,
    ...(feasibility.failureReason?{currentPolicyFailureReason:feasibility.failureReason}:{}),
    ...(constructibility.maxOwnershipBps===undefined?{}:{resultingOwnershipBps:constructibility.maxOwnershipBps}),
    ...(constructibility.capitalUtilizationBps===undefined?{}:{capitalUtilizationBps:constructibility.capitalUtilizationBps}),
  });
  if(!constructibility.mechanicallyConstructible||!constructibility.canonicalPosition)return{economics:decorate(evaluateOpportunity({candidateId:input.candidate.id,userSelectedCapitalLamports:input.userSelectedCapitalLamports,decisionContext:{feasibility:economyFeasibility,evidenceObservedAt:input.baseline.observedAt,softRiskReasons:input.softRiskReasons??[]}})),feasibility,constructibility};
  const frames=[...input.frames].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
  const events=[...input.events].sort((a,b)=>Date.parse(a.stamp.observedAt)-Date.parse(b.stamp.observedAt)||a.signature.localeCompare(b.signature)||a.eventIndex-b.eventIndex);
  const replay=simulateSyntheticPosition({position:constructibility.canonicalPosition.position,frames,events,...(input.costs?{costs:input.costs}:{})});
  const rawUnitValueX=Number(input.decision.prediction.rawUnitValueX??0),rawUnitValueY=Number(input.decision.prediction.rawUnitValueY??0),start=replay.inventory[0],end=replay.inventory.at(-1),startValue=start?forwardV2ValueLamports(start.tokenXRaw,start.tokenYRaw,rawUnitValueX,rawUnitValueY):undefined,endValue=end?forwardV2ValueLamports(end.tokenXRaw,end.tokenYRaw,rawUnitValueX,rawUnitValueY):undefined,feeValue=forwardV2ValueLamports(replay.totalAttributedFeeXRaw,replay.totalAttributedFeeYRaw,rawUnitValueX,rawUnitValueY),continuous=!replay.inventory.some(snapshot=>snapshot.missingBins.some(binId=>constructibility.canonicalPosition!.position.bins.some(bin=>bin.binId===binId&&bin.positionShareRaw>0n))),valid=startValue!==undefined&&endValue!==undefined&&feeValue!==undefined&&continuous&&replay.occupancyState==='COMPLETE',totalCostValue=Object.values(replay.costs).reduce((sum,value)=>sum+(Number(value)||0),0),simulation:UserSelectedCapitalCandidateSimulation={candidateId:input.candidate.id,feeValue:valid?Number(feeValue)/1_000_000_000:0,inventoryChangeValue:valid?Number(endValue-startValue)/1_000_000_000:0,totalCostValue:valid?totalCostValue:0,netValue:valid?Number(feeValue+endValue-startValue)/1_000_000_000-totalCostValue:0,evidenceActionable:valid,warnings:[...replay.warnings,...(continuous?[]:['CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT']),...(replay.occupancyState==='COMPLETE'?[]:['CANDIDATE_ACTIVE_TIME_EVIDENCE_INSUFFICIENT'])],activeDurationMs:replay.activeDurationMs,inactiveDurationMs:replay.inactiveDurationMs,occupancyCoverageRatio:replay.occupancyCoverageRatio,maxEffectiveOwnershipBps:constructibility.canonicalPosition.maxEffectiveOwnershipBps};
  return{economics:decorate(evaluateOpportunity({candidateId:input.candidate.id,userSelectedCapitalLamports:input.userSelectedCapitalLamports,decisionContext:{feasibility:economyFeasibility,evidenceObservedAt:input.baseline.observedAt,simulation,softRiskReasons:input.softRiskReasons??[]}})),feasibility,constructibility,simulation};
}

function forwardInsufficient(input: {
  decision: FrozenPhase3ForwardDecision;
  horizon: (typeof PHASE3_FORWARD_HORIZONS_MINUTES)[number];
  outcomeModelVersion: string;
  reasonCodes: string[];
  evidenceHash?: string;
  replayContract?: CanonicalForwardReplayContract;
}): Phase3ForwardOutcome {
  return {
    recommendationId: input.decision.recommendationId,
    horizonMinutes: input.horizon,
    outcomeModelVersion: input.outcomeModelVersion,
    state: 'INSUFFICIENT_EVIDENCE',
    ...(input.evidenceHash ? { evidenceHash: input.evidenceHash } : {}),
    ...(input.replayContract ? { replayContract: input.replayContract } : {}),
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
  enforcePriceTakingOwnershipCap?:boolean;
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
  const baseline = orderedFrames.filter(frame => Date.parse(frame.observedAt) <= start).at(-1) ?? null;
  const futureFrames = orderedFrames.filter(frame => inWindow(frame.observedAt, start, end));
  const events = input.events.filter(event => inWindow(event.stamp.observedAt, start, end));
  const replayContract = await buildCanonicalForwardReplayContract({ decision: input.decision, horizonMinutes: horizon, outcomeModelVersion, baseline, futureFrames, futureEvents: events });
  if (!baseline || !futureFrames.length) return forwardInsufficient({ decision: input.decision, horizon, outcomeModelVersion, replayContract, reasonCodes: ['FORWARD_FUTURE_FRAME_COVERAGE_INSUFFICIENT'] });
  const frames = [baseline, ...futureFrames];
  const evidenceHash = replayContract.evidenceManifest.evidenceManifestHash;
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
      return forwardInsufficient({ decision: input.decision, horizon, outcomeModelVersion, evidenceHash, replayContract, reasonCodes: ['FORWARD_FUTURE_EVIDENCE_INSUFFICIENT', ...simulation.warnings] });
    }
    return {
      recommendationId: input.decision.recommendationId,
      horizonMinutes: horizon,
      outcomeModelVersion,
      state: 'FINAL',
      evidenceHash,
      reasonCodes: [],
      replayContract,
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

  const constrained = deriveCapitalConstrainedForwardPosition({ decision: input.decision, candidate, baseline,...(input.enforcePriceTakingOwnershipCap===undefined?{}:{enforcePriceTakingOwnershipCap:input.enforcePriceTakingOwnershipCap}) });
  if (!constrained.position) return forwardInsufficient({ decision: input.decision, horizon, outcomeModelVersion, evidenceHash, replayContract, reasonCodes: constrained.reasonCodes ?? ['FORWARD_V2_POSITION_UNAVAILABLE'] });
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
    return forwardInsufficient({ decision: input.decision, horizon, outcomeModelVersion, evidenceHash, replayContract, reasonCodes: [
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
    replayContract,
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
