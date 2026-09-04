import { canonicalJson, sha256Hex } from "../../domain/src/index.js";
import type { ExecutionJournalState } from "../../execution-recovery/src/index.js";
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
import {
  PHASE3_FORWARD_CURRENT_OUTCOME_MODEL_VERSION,
  type Phase3RegimeLabel,
  type ProbabilityEntry,
} from "../../contracts/src/index.js";
import { reconstructReset3cRawContractFromResolvedShared, resolveReset3cSharedEvidence, resolveReset3cValidationSharedEvidence } from "../../phase3-forward-validation/src/index.js";
const WSOL_MINT="So11111111111111111111111111111111111111112";

/**
 * Authoritative terminal states for execution plans. A terminal plan remains
 * immutable forensic history, but cannot be resurrected as pending solely by
 * a historical submission row. Unknown submission and reconciliation states
 * are deliberately absent: they remain safety-blocking until resolved.
 */
export const EXECUTION_TERMINAL_PLAN_STATES = [
  "BLOCKED",
  "FAILED",
  "EXPIRED",
  "RECONCILED",
  "COMPLETED",
] as const;

export function isExecutionPlanTerminalState(state: string): boolean {
  return (EXECUTION_TERMINAL_PLAN_STATES as readonly string[]).includes(state);
}

export function executionPlanCountsAsPendingForPortfolio(state: string): boolean {
  return !isExecutionPlanTerminalState(state);
}

/**
 * Continuity tracking is deliberately bounded.  When its slots contend, the
 * selection must favour the pool most likely to complete the already-required
 * live-confirmation episode, rather than the pool that happened to enter the
 * tracker first.  This is scheduling only: it grants neither entry authority
 * nor an exception to the confirmation contract.
 */
export interface ContinuityMaturityPriorityInput {
  poolAddress: string;
  observedAt: string;
  liveObservationTimes: readonly string[];
  trackingStartedAt?: string;
  tierARank?: number;
  candidateUtility?: number;
  candidateReadiness?: number;
  confirmationWindowMs?: number;
  minimumObservations?: number;
  maximumGapMs?: number;
}

export interface ContinuityMaturityPriority {
  poolAddress: string;
  confirmationRemainingMs: number;
  validObservationCount: number;
  validObservationSpanMs: number;
  anchorPresent: boolean;
  tierARank: number;
  candidateUtility: number;
  candidateReadiness: number;
  trackingStartedAtMs: number;
}

export function continuityMaturityPriority(input: ContinuityMaturityPriorityInput): ContinuityMaturityPriority {
  const now = Date.parse(input.observedAt);
  const confirmationWindowMs = Math.max(1, Math.floor(input.confirmationWindowMs ?? 10 * 60_000));
  const minimumObservations = Math.max(1, Math.floor(input.minimumObservations ?? 4));
  const maximumGapMs = Math.max(1, Math.floor(input.maximumGapMs ?? 450_000));
  const observations = input.liveObservationTimes
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value) && value <= now && value >= now - confirmationWindowMs - maximumGapMs)
    .sort((a, b) => a - b);
  const latest = observations.at(-1);
  const currentEpisode = latest === undefined || now - latest > maximumGapMs
    ? []
    : observations.reduce<number[]>((episode, value) => {
        if (!episode.length || value - episode.at(-1)! <= maximumGapMs) episode.push(value);
        else {
          episode.length = 0;
          episode.push(value);
        }
        return episode;
      }, []);
  const first = currentEpisode[0];
  const last = currentEpisode.at(-1);
  const validObservationCount = currentEpisode.length;
  const validObservationSpanMs = first === undefined || last === undefined ? 0 : Math.max(0, last - first);
  const anchorPresent = first !== undefined
    && last !== undefined
    && validObservationCount >= minimumObservations
    && now - first >= confirmationWindowMs
    && now - last <= maximumGapMs;
  return {
    poolAddress: input.poolAddress,
    // A non-current episode is deliberately least preferred: retaining it
    // cannot repair the already-broken confirmation window.
    confirmationRemainingMs: first === undefined || last === undefined || now - last > maximumGapMs
      ? Number.POSITIVE_INFINITY
      : Math.max(0, confirmationWindowMs - (now - first)),
    validObservationCount,
    validObservationSpanMs,
    anchorPresent,
    tierARank: Number.isFinite(input.tierARank) ? Math.max(0, Math.floor(input.tierARank!)) : Number.MAX_SAFE_INTEGER,
    candidateUtility: Number.isFinite(input.candidateUtility) ? input.candidateUtility! : Number.NEGATIVE_INFINITY,
    candidateReadiness: Number.isFinite(input.candidateReadiness) ? input.candidateReadiness! : Number.NEGATIVE_INFINITY,
    trackingStartedAtMs: input.trackingStartedAt && Number.isFinite(Date.parse(input.trackingStartedAt))
      ? Date.parse(input.trackingStartedAt)
      : Number.MAX_SAFE_INTEGER,
  };
}

/** Lower values win.  This comparator is total and stable across restarts. */
export function compareContinuityMaturityPriority(a: ContinuityMaturityPriority, b: ContinuityMaturityPriority): number {
  const numericAsc = (left: number, right: number) => left === right ? 0 : left < right ? -1 : 1;
  const numericDesc = (left: number, right: number) => left === right ? 0 : left > right ? -1 : 1;
  return numericAsc(a.confirmationRemainingMs, b.confirmationRemainingMs)
    || numericDesc(Number(a.anchorPresent), Number(b.anchorPresent))
    || numericDesc(a.validObservationCount, b.validObservationCount)
    || numericDesc(a.validObservationSpanMs, b.validObservationSpanMs)
    || numericAsc(a.tierARank, b.tierARank)
    || numericDesc(a.candidateUtility, b.candidateUtility)
    || numericDesc(a.candidateReadiness, b.candidateReadiness)
    || numericAsc(a.trackingStartedAtMs, b.trackingStartedAtMs)
    || a.poolAddress.localeCompare(b.poolAddress);
}

/**
 * A non-MATCH plan reconciliation remains audit evidence forever.  It is only
 * operationally superseded when a later lifecycle-level chain reconciliation
 * proves the same lifecycle terminal and no newer unresolved effect exists.
 */
export interface Phase7ReconciliationDebtArtifact {
  planReconciliationStatus: string;
  lifecycleStatus?: string;
  authoritativeLifecycleReconciliationStatus?: string;
  planReconciliationObservedAt?: string;
  authoritativeLifecycleReconciliationObservedAt?: string;
  newerUnresolvedEffect: boolean;
}

export function isPhase7SupersededReconciliationDebtArtifact(
  artifact: Phase7ReconciliationDebtArtifact,
): boolean {
  const planObservedAt = artifact.planReconciliationObservedAt
    ? Date.parse(artifact.planReconciliationObservedAt)
    : Number.NaN;
  const authorityObservedAt = artifact.authoritativeLifecycleReconciliationObservedAt
    ? Date.parse(artifact.authoritativeLifecycleReconciliationObservedAt)
    : Number.NaN;
  return artifact.planReconciliationStatus !== "MATCH"
    && artifact.lifecycleStatus === "SOL_SETTLED"
    && artifact.authoritativeLifecycleReconciliationStatus === "RECONCILED_CHAIN"
    && Number.isFinite(planObservedAt)
    && Number.isFinite(authorityObservedAt)
    && authorityObservedAt > planObservedAt
    && !artifact.newerUnresolvedEffect;
}

export interface IngestionCheckpoint {
  stream: string;
  lastSeenSlot?: bigint;
  lastFullyProcessedSlot?: bigint;
  state: Record<string, unknown>;
}

/**
 * M0054 is one immutable outcome contract with two capture generations.  The
 * lane is an access-path concern only: it cannot change outcome identity,
 * capital, economics, or terminal-state semantics.
 */
export type CandidateCounterfactualQueueLane = 'ALL'|'V3'|'FULL_UNIVERSE'|'HISTORICAL';

/**
 * Canonicalizes an optional immutable upper bound for operational-history
 * reads. Callers that omit `through` retain the existing live-history
 * behavior. Forward-outcome callers supply it so delayed maturation cannot
 * substitute newer wall-clock observations for frozen-horizon evidence.
 */
export function operationalHistoryWindow(since: string, through?: string): {
  since: string;
  through?: string;
} {
  const lower = Date.parse(since);
  if (!Number.isFinite(lower)) throw new Error("LPFORGE_OPERATIONAL_HISTORY_SINCE_INVALID");
  if (through === undefined) return { since: new Date(lower).toISOString() };
  const upper = Date.parse(through);
  if (!Number.isFinite(upper) || upper < lower) {
    throw new Error("LPFORGE_OPERATIONAL_HISTORY_THROUGH_INVALID");
  }
  return { since: new Date(lower).toISOString(), through: new Date(upper).toISOString() };
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
/**
 * Select the bounded set that is allowed to consume full live-evidence
 * collection.  A Tier-A pool that has completed historical maturity and live
 * confirmation remains economically actionable until Phase 3 reaches its
 * next/terminal decision, so it must retain a serviceable slot even if its
 * discovery registry state was previously QUALIFIED.  This is deliberately
 * admission only: it neither changes maturity nor relaxes economic freshness.
 */
export interface LiveEvidenceAdmissionCandidate {
  poolAddress:string;
  state:string;
  priorityScore:number;
  rank?:number|undefined;
  firstSeenAt:string;
  matureForPhase3:boolean;
  phase3Terminal:boolean;
  /** A successful full collector pass owns a bounded, restart-safe evidence
   * attempt. This is scheduling state only, never a trading decision. */
  evidenceLeaseActive?:boolean;
  /** A ready lease must outrank all non-ready leases until real Phase-3
   * economics consumes it, its bounded timeout expires, or it fails closed. */
  phase3ConsumptionPending?:boolean;
  phase3ReadyAt?:string|undefined;
  admissionEligible?:boolean;
  /** Fresh discovery economics used only for bounded live-evidence ordering. */
  economicPriority?:number|undefined;
  economicPriorityObservedAt?:string|undefined;
  evidencePriority?:number|undefined;
  activeDwellMs?:number|undefined;
  waitingMinutes?:number|undefined;
  protectedCriticalConsumption?:boolean|undefined;
  releaseReason?:string|undefined;
  /**
   * Fresh, research-only evidence used only to order otherwise serviceable
   * live-evidence slots.  It is never an admission threshold or trade gate.
   */
  economicQuality?:{
    eventPathAsOf:string;
    forecastAsOf:string;
    feeRatePerCapitalHour:number;
    adverseInventoryPressure?:number;
    forecastUncertainty?:number;
  }|undefined;
}
export const LIVE_EVIDENCE_ECONOMIC_RANKING_FRESHNESS_SECONDS=300;
/** Three independent fifteen-minute episodes need at most one bounded
 * forty-five-minute collection attempt. This is not a freshness SLA. */
export const ACTIVE_EVIDENCE_LEASE_TIMEOUT_MS=3*15*60_000;
export const ACTIVE_EVIDENCE_LEASE_MAX_FAILURES=3;
export const ACTIVE_EVIDENCE_LEASE_RETRY_COOLDOWN_MS=15*60_000;
/**
 * Dynamic raw-frame continuity is deliberately separate from economic ACTIVE
 * admission. Its TTL is exactly the existing replay horizon: it can bridge a
 * bounded cooldown, but cannot become an unbounded background collector.
 */
export const EVIDENCE_CONTINUITY_TRACKING_TTL_MS=60*60_000;
/** Two bounded lanes preserve the two-slot economic lease contract while
 * avoiding immediate FIFO eviction of near-mature dynamic pools. */
export const EVIDENCE_CONTINUITY_TRACKING_CAP=2;
const EVIDENCE_CONTINUITY_NO_TRADE_REASONS=new Set([
  'CANDIDATE_REPLAY_COVERAGE_INSUFFICIENT',
  'CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT',
  'RANGE_SURVIVAL_EVIDENCE_INSUFFICIENT',
  'NO_TRADE_EVIDENCE_NON_ACTIONABLE',
  'FEE_CALIBRATION_RAW_REPLAY_NOT_ACTIONABLE',
  'RANK_EVIDENCE_NON_ACTIONABLE',
]);
export function evidenceContinuityTrackingExpiresAt(startedAt:string):string|undefined{
 const start=Date.parse(startedAt);return Number.isFinite(start)?new Date(start+EVIDENCE_CONTINUITY_TRACKING_TTL_MS).toISOString():undefined;
}
export function isEvidenceMaturityNoTrade(phase3Status:string|undefined,reasonCodes:readonly string[]|undefined):boolean{
 return phase3Status==='NO_TRADE'&&Boolean(reasonCodes?.some(code=>EVIDENCE_CONTINUITY_NO_TRADE_REASONS.has(code)));
}
/** A completed EVENT_PATH estimate is consumable only while its existing
 * economic-freshness window remains open. This is an evaluation handoff,
 * never an additional evidence lease or admission slot. */
export const POST_EVIDENCE_EVALUATION_WINDOW_MS=LIVE_EVIDENCE_ECONOMIC_RANKING_FRESHNESS_SECONDS*1000;
export function isPostEvidenceEvaluationEligible(payload:Record<string,unknown>|undefined,observedAt:string):boolean{
 const now=Date.parse(observedAt),expires=Date.parse(String(payload?.postEvidenceEvaluationExpiresAt??''));
 return payload?.postEvidenceEvaluationState==='ELIGIBLE'&&Number.isFinite(now)&&Number.isFinite(expires)&&expires>now;
}
export function liveEvidenceLeaseExpiresAt(startedAt:string):string|undefined{
 const start=Date.parse(startedAt);return Number.isFinite(start)?new Date(start+ACTIVE_EVIDENCE_LEASE_TIMEOUT_MS).toISOString():undefined;
}
export function isLiveEvidenceLeaseActive(value:{startedAt?:string|undefined;expiresAt?:string|undefined;failureCount?:number|undefined},observedAt:string):boolean{
 const now=Date.parse(observedAt),start=Date.parse(String(value.startedAt??'')),expires=Date.parse(String(value.expiresAt??''));
 return Number.isFinite(now)&&Number.isFinite(start)&&Number.isFinite(expires)&&expires>now&&Number(value.failureCount??0)<ACTIVE_EVIDENCE_LEASE_MAX_FAILURES;
}
export function liveEvidenceLeaseReleaseReason(value:{state:string;startedAt?:string|undefined;expiresAt?:string|undefined;failureCount?:number|undefined;eventPathEstimateFresh?:boolean;phase3CurrentLiveReady?:boolean;phase3Status?:string|undefined},observedAt:string):string|undefined{
 if(value.state!=='ACTIVE_CANDIDATE')return undefined;
 // Readiness reserves the lease for consumption; it is not a release. The
 // canonical live observations must remain owned until a real Phase-3 result.
 if(value.phase3Status==='ENTRY_READY'||value.phase3Status==='NO_TRADE')return 'LIVE_EVIDENCE_LEASE_TERMINAL_PHASE3';
 if(!value.startedAt)return undefined;
 if(Number(value.failureCount??0)>=ACTIVE_EVIDENCE_LEASE_MAX_FAILURES)return 'LIVE_EVIDENCE_LEASE_COLLECTION_FAILURE_LIMIT';
 return isLiveEvidenceLeaseActive(value,observedAt)?undefined:'LIVE_EVIDENCE_LEASE_TIMEOUT';
}
/** A ready dynamic candidate remains ACTIVE until a real Phase-3 economics
 * result consumes the same evidence. This is bounded by its existing lease. */
export function isPhase3ReadyConsumptionPending(payload:Record<string,unknown>|undefined,observedAt:string):boolean{
 const readyAt=Date.parse(String(payload?.liveEvidencePhase3ReadyAt??'')),expiresAt=Date.parse(String(payload?.liveEvidenceLeaseExpiresAt??'')),now=Date.parse(observedAt);
 return payload?.liveEvidencePhase3ConsumptionState==='PENDING'&&Number.isFinite(readyAt)&&Number.isFinite(expiresAt)&&Number.isFinite(now)&&readyAt<=now&&expiresAt>now;
}
export const LIVE_EVIDENCE_DISCOVERY_PRIORITY_FRESHNESS_MS=10*60_000;
export const LIVE_EVIDENCE_MIN_ACTIVE_DWELL_MS=15*60_000;
export const LIVE_EVIDENCE_REPLACEMENT_MARGIN=12;
export function freshLiveEvidenceEconomicQuality(value:LiveEvidenceAdmissionCandidate['economicQuality'],observedAt:string):LiveEvidenceAdmissionCandidate['economicQuality']|undefined{
  if(!value)return undefined;
  const now=Date.parse(observedAt),eventAt=Date.parse(value.eventPathAsOf),forecastAt=Date.parse(value.forecastAsOf),maxAge=LIVE_EVIDENCE_ECONOMIC_RANKING_FRESHNESS_SECONDS*1000;
  // EVENT_PATH_ESTIMATE is the economic evidence and must remain fresh.  The
  // deep-screen inventory/forecast descriptors are secondary ordering inputs
  // from a separate bounded collector, so requiring both collectors to land
  // in the same five-minute window would make this ranking path inert.
  if(!Number.isFinite(now)||!Number.isFinite(eventAt)||!Number.isFinite(forecastAt)||eventAt>now||forecastAt>now||now-eventAt>maxAge)return undefined;
  if(!Number.isFinite(value.feeRatePerCapitalHour))return undefined;
  return value;
}
export function dynamicLiveEvidenceAdmissionCapacity(value:{serviceableCapacity:number;staticPolicyPoolCount?:number}):number{
  // Static policy monitoring is an independent workload.  Its count is kept
  // only for admission telemetry and never consumes dynamic active slots.
  return Math.max(0,Math.floor(value.serviceableCapacity));
}
export function isLiveEvidenceAdmissionTerminal(phase3Status:string|undefined):boolean{
  // Economic NO_TRADE is a point-in-time result, not a permanent observation
  // exclusion.  ENTRY_READY is the only downstream terminal for this slot.
  return phase3Status==='ENTRY_READY';
}
/** A Phase-3 result consumes the ACTIVE lease that produced it.  Once that
 * lease has been released to QUALIFIED and its existing retry cooldown has
 * elapsed, the historical result remains auditable but must not permanently
 * suppress a fresh, independently admitted evidence episode. */
export function isLiveEvidenceAdmissionTerminalForCurrentLease(value:{state:string;phase3Status?:string|undefined}):boolean{
  return value.state==='ACTIVE_CANDIDATE'&&isLiveEvidenceAdmissionTerminal(value.phase3Status);
}
export function freshDiscoveryEconomicPriority(value:{priority?:number|undefined;observedAt?:string|undefined}|undefined,observedAt:string):number|undefined{
  if(!value||!Number.isFinite(value.priority))return undefined;
  const now=Date.parse(observedAt),at=Date.parse(value.observedAt??'');
  if(!Number.isFinite(now)||!Number.isFinite(at)||at>now||now-at>LIVE_EVIDENCE_DISCOVERY_PRIORITY_FRESHNESS_MS)return undefined;
  return Math.max(0,Math.min(100,Number(value.priority)));
}
export function liveEvidenceAdmissionPriority(candidate:LiveEvidenceAdmissionCandidate):number{
  if(Number.isFinite(candidate.evidencePriority))return Number(candidate.evidencePriority);
  if(Number.isFinite(candidate.economicPriority))return Number(candidate.economicPriority);
  return Number.isFinite(candidate.priorityScore)?candidate.priorityScore:0;
}
export function selectLiveEvidenceAdmissionCandidates<T extends LiveEvidenceAdmissionCandidate>(candidates:readonly T[],capacity:number):T[]{
  const stateRank=(state:string)=>state==='ACTIVE_CANDIDATE'?0:1;
  const base=(a:T,b:T)=>
    Number(b.matureForPhase3)-Number(a.matureForPhase3)
    ||liveEvidenceAdmissionPriority(b)-liveEvidenceAdmissionPriority(a)
    ||stateRank(a.state)-stateRank(b.state)
    ||b.priorityScore-a.priorityScore
    ||(a.rank??Number.MAX_SAFE_INTEGER)-(b.rank??Number.MAX_SAFE_INTEGER)
    ||Date.parse(a.firstSeenAt)-Date.parse(b.firstSeenAt)
    ||a.poolAddress.localeCompare(b.poolAddress);
  const economic=(a:T,b:T)=>{
    const qa=a.economicQuality,qb=b.economicQuality;
    if(!qa||!qb)return base(a,b);
    return qb.feeRatePerCapitalHour-qa.feeRatePerCapitalHour
      ||((Number.isFinite(qa.adverseInventoryPressure)&&Number.isFinite(qb.adverseInventoryPressure))?qa.adverseInventoryPressure!-qb.adverseInventoryPressure!:0)
      ||((Number.isFinite(qa.forecastUncertainty)&&Number.isFinite(qb.forecastUncertainty))?qa.forecastUncertainty!-qb.forecastUncertainty!:0)
      ||base(a,b);
  };
  const pendingLease=(a:T,b:T)=>{
    const pending=Number(Boolean(b.phase3ConsumptionPending))-Number(Boolean(a.phase3ConsumptionPending));
    if(pending)return pending;
    if(a.phase3ConsumptionPending&&b.phase3ConsumptionPending){
      const readyA=Date.parse(String(a.phase3ReadyAt??'')),readyB=Date.parse(String(b.phase3ReadyAt??''));
      const ordered=(Number.isFinite(readyA)?readyA:Number.MAX_SAFE_INTEGER)-(Number.isFinite(readyB)?readyB:Number.MAX_SAFE_INTEGER);
      if(ordered)return ordered;
    }
    return base(a,b);
  };
  const slots=Math.max(0,Math.floor(capacity)),eligible=candidates.filter(candidate=>!candidate.phase3Terminal&&candidate.admissionEligible!==false),locked=eligible.filter(candidate=>candidate.evidenceLeaseActive&&(candidate.phase3ConsumptionPending===true||candidate.protectedCriticalConsumption===true||(candidate.activeDwellMs??0)<LIVE_EVIDENCE_MIN_ACTIVE_DWELL_MS)).sort(pendingLease),selected=locked.slice(0,slots);
  let remaining=slots-selected.length;
  if(!remaining)return selected;
  // A mature, non-terminal Phase-3 candidate is a protected continuation of
  // evidence already earned.  It receives an available slot before an
  // ordinary, challengeable ACTIVE lease, but it never displaces a critical
  // in-consumption lease above.
  for(const candidate of eligible.filter(candidate=>!selected.includes(candidate)&&candidate.state!=='ACTIVE_CANDIDATE'&&candidate.matureForPhase3).sort(economic)){if(remaining<=0)break;selected.push(candidate);remaining--;}
  const challengeable=eligible.filter(candidate=>candidate.state==='ACTIVE_CANDIDATE'&&!locked.includes(candidate)).sort(base);
  for(const candidate of challengeable){if(remaining<=0)break;selected.push(candidate);remaining--;}
  for(const challenger of eligible.filter(candidate=>!selected.includes(candidate)&&candidate.state!=='ACTIVE_CANDIDATE').sort(economic)){
    const incumbent=selected.filter(candidate=>candidate.state==='ACTIVE_CANDIDATE'&&!locked.includes(candidate)).sort((a,b)=>liveEvidenceAdmissionPriority(a)-liveEvidenceAdmissionPriority(b)||a.poolAddress.localeCompare(b.poolAddress))[0];
    if(incumbent&&liveEvidenceAdmissionPriority(challenger)>=liveEvidenceAdmissionPriority(incumbent)+LIVE_EVIDENCE_REPLACEMENT_MARGIN){selected.splice(selected.indexOf(incumbent),1,challenger);continue;}
    if(remaining>0){selected.push(challenger);remaining--;}
  }
  if(!remaining)return selected.sort(base);
  const ordinary=eligible.filter(candidate=>!selected.includes(candidate)&&!candidate.evidenceLeaseActive&&!candidate.matureForPhase3),bootstrap=ordinary.filter(candidate=>!candidate.economicQuality).sort(base),economicallyComparable=ordinary.filter(candidate=>candidate.economicQuality).sort(economic);
  // Reserve one ordinary slot for a candidate that has not yet accumulated an
  // event-path estimate.  That preserves the bounded bootstrap path and
  // prevents economics from becoming a circular admission prerequisite.
  if(bootstrap.length){selected.push(bootstrap.shift()!);remaining--;}
  for(const candidate of [...economicallyComparable,...bootstrap]){if(remaining<=0)break;selected.push(candidate);remaining--;}
  return selected;
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
  state: string;
  idempotencyKey: string;
  action: AutonomousPlanAction;
  /** Provenance of a resolved position address.  Lifecycle fallback appears
   * only after the exact linked position reached SOL_SETTLED. */
  positionIdentitySource?: "DIRECT" | "LIFECYCLE_SOL_SETTLED";
  positionLifecycleSettled?: boolean;
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
export type WalletPositionClassification =
  | "KNOWN_LPFORGE_POSITION"
  | "UNKNOWN_WALLET_POSITION"
  | "PENDING_LPFORGE_OPEN"
  | "PENDING_LPFORGE_CLOSE"
  | "HISTORICAL_EXTERNAL_POSITION"
  | "AMBIGUOUS_POSITION"
  | "DB_ONLY";
export interface WalletPositionDiscovery {
  ownerAddress: string;
  positionAddress: string;
  poolAddress?: string;
  classification: WalletPositionClassification;
  lpforgePositionId?: string;
  executionPlanId?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastReconciledAt: string;
  payload: Record<string, unknown>;
}
export interface ExecutionCapitalReservationRequest {planId:string;ownerAddress:string;poolAddress:string;capitalLamports:bigint;walletLamports:bigint;reserveLamports:bigint;maxPortfolioLamports:bigint;maxPoolLamports:bigint;maxTokenLamports:bigint;maxInitialPositionLamports:bigint;now:string;}
export interface ExecutionCapitalReservationDiagnostics {walletBalanceLamports:bigint;walletReserveLamports:bigint;pendingCashReservationLamports:bigint;walletDeployableLamports:bigint;deployedPortfolioLamports:bigint;reservedPortfolioLamports:bigint;requestedLamports:bigint;projectedPortfolioLamports:bigint;poolCurrentLamports:bigint;poolReservedLamports:bigint;poolProjectedLamports:bigint;poolLimitLamports:bigint;tokenCurrentLamports:bigint;tokenReservedLamports:bigint;tokenProjectedLamports:bigint;tokenLimitLamports:bigint;}
export interface ExecutionCapitalReservationResult {approved:boolean;reasonCodes:string[];tokenMint?:string;deployedLamports:bigint;reservedLamports:bigint;availableLamports:bigint;diagnostics?:ExecutionCapitalReservationDiagnostics;}
export function assessExecutionCapitalReservation(input:{request:ExecutionCapitalReservationRequest;tokenMint?:string;deployedLamports:bigint;reservedLamports:bigint;poolDeployedLamports:bigint;poolReservedLamports:bigint;tokenDeployedLamports:bigint;tokenReservedLamports:bigint;}):{approved:boolean;reasonCodes:string[];diagnostics:ExecutionCapitalReservationDiagnostics}{
  const v=input.request,zero=0n,clamp=(value:bigint)=>value>zero?value:zero;
  // The wallet balance is current chain cash, so deployed LP capital has
  // already left it. Deployed exposure belongs exclusively to the portfolio
  // constraint below and must never reduce wallet liquidity a second time.
  const walletDeployable=clamp(v.walletLamports-v.reserveLamports-input.reservedLamports),projectedPortfolio=input.deployedLamports+input.reservedLamports+v.capitalLamports,poolProjected=input.poolDeployedLamports+input.poolReservedLamports+v.capitalLamports,tokenProjected=input.tokenDeployedLamports+input.tokenReservedLamports+v.capitalLamports;
  const diagnostics:ExecutionCapitalReservationDiagnostics={walletBalanceLamports:v.walletLamports,walletReserveLamports:v.reserveLamports,pendingCashReservationLamports:input.reservedLamports,walletDeployableLamports:walletDeployable,deployedPortfolioLamports:input.deployedLamports,reservedPortfolioLamports:input.reservedLamports,requestedLamports:v.capitalLamports,projectedPortfolioLamports:projectedPortfolio,poolCurrentLamports:input.poolDeployedLamports,poolReservedLamports:input.poolReservedLamports,poolProjectedLamports:poolProjected,poolLimitLamports:v.maxPoolLamports,tokenCurrentLamports:input.tokenDeployedLamports,tokenReservedLamports:input.tokenReservedLamports,tokenProjectedLamports:tokenProjected,tokenLimitLamports:v.maxTokenLamports};
  const reasons:string[]=[];
  if(!input.tokenMint)reasons.push('P6_CAPITAL_POOL_TOKEN_MISSING');
  if(v.capitalLamports>v.maxInitialPositionLamports)reasons.push('P6_CAPITAL_MAX_INITIAL_POSITION');
  if(v.capitalLamports>walletDeployable)reasons.push('P6_CAPITAL_WALLET_OR_PORTFOLIO_LIMIT','P6_CAPITAL_WALLET_RESERVE_LIMIT');
  if(projectedPortfolio>v.maxPortfolioLamports)reasons.push('P6_CAPITAL_PORTFOLIO_LIMIT');
  if(poolProjected>v.maxPoolLamports)reasons.push('P6_CAPITAL_POOL_LIMIT');
  if(tokenProjected>v.maxTokenLamports)reasons.push('P6_CAPITAL_TOKEN_LIMIT');
  return{approved:reasons.length===0,reasonCodes:[...new Set(reasons)].sort(),diagnostics};
}
export type PositionInventoryLotSide = "X" | "Y";
export type PositionInventoryLotSource =
  | "OPEN_RESIDUAL"
  | "FEE_CLAIM"
  | "REDUCE_WITHDRAWAL"
  | "CLOSE_WITHDRAWAL"
  | "RECOVERY_RESIDUAL"
  | "RESHAPE_SETTLEMENT";
export type PositionInventoryLotStatus =
  | "OPEN"
  | "PARTIALLY_SETTLED"
  | "SETTLED"
  | "TRANSFERRED"
  | "DUST_RETAINED";
export type PositionInventoryLotEventType =
  | "CREATED"
  | "SETTLED"
  | "TRANSFERRED"
  | "DUST_RETAINED"
  | "ATTRIBUTION_CORRECTED";
export interface PositionInventoryLot {
  lotId:string;
  positionAddress:string;
  planId:string;
  ownerAddress:string;
  poolAddress:string;
  tokenMint:string;
  tokenSide:PositionInventoryLotSide;
  sourceEvent:PositionInventoryLotSource;
  sourceCashflowId?:string;
  rawAmount:bigint;
  remainingRawAmount:bigint;
  decimals:number;
  acquiredAt:string;
  status:PositionInventoryLotStatus;
  payload:Record<string,unknown>;
}
export interface PositionInventoryLotEvent {
  eventId:string;
  lotId:string;
  planId?:string;
  eventType:PositionInventoryLotEventType;
  rawAmount:bigint;
  remainingRawAmount:bigint;
  observedAt:string;
  transactionSignature?:string;
  payload:Record<string,unknown>;
}
export type OpenChunkDisposition =
  | "PENDING"
  | "SIGNING"
  | "SIGNED"
  | "SUBMITTED"
  | "CONFIRMED"
  | "UNKNOWN_SUBMISSION"
  | "PROVEN_NOT_LANDED"
  | "FAILED_PRE_SIGN"
  | "EXPIRED_PRE_SUBMISSION";
export interface OpenChunkDispositionRecord {
  planId:string;
  transactionId:string;
  sequence:number;
  kind:string;
  disposition:OpenChunkDisposition;
  signature?:string;
  lastValidBlockHeight?:bigint;
  observedAt:string;
  payload:Record<string,unknown>;
}
export type PlanCashflowType =
  | "ENTRY_FUNDING_SOL_OUT"
  | "ENTRY_FUNDING_X_IN"
  | "FUNDING_TX_COST"
  | "RECOVERY_UNWIND_X_OUT"
  | "RECOVERY_SOL_IN"
  | "RECOVERY_TX_COST";
export interface PlanCashflow {
  cashflowId:string;
  planId:string;
  flowType:PlanCashflowType;
  observedAt:string;
  lamports?:bigint;
  tokenMint?:string;
  tokenAmountRaw?:string;
  transactionSignature?:string;
  payload:Record<string,unknown>;
}
/**
 * A lifecycle is the durable economic boundary for one PositionV2.  A
 * replacement position deliberately receives a new lifecycle and is linked
 * through predecessorLifecycleId instead of inheriting mutable economics.
 */
export interface PositionLifecycle {
  lifecycleId:string;
  positionAddress:string;
  entryPlanId?:string;
  ownerAddress:string;
  poolAddress:string;
  predecessorLifecycleId?:string;
  status:"OPEN"|"CLOSED"|"SOL_SETTLED"|"RECONCILIATION_REQUIRED";
}
export type LifecycleChildTransactionState="CONFIRMED"|"FAILED_FINAL"|"PROVEN_NOT_LANDED"|"SUBMITTED"|"UNKNOWN"|"RECOVERY_PENDING"|"CONFIRMATION_PENDING";
export interface LifecycleChildTransaction {transactionId:string;signature?:string;state:LifecycleChildTransactionState;planId?:string;planRole?:"ENTRY"|"MANAGEMENT"|"CLOSE"|"RECOVERY";kind?:string;}
export interface LifecycleSettlementCashflow {cashflowId:string;flowType:string;lamports?:bigint;tokenMint?:string;tokenAmountRaw?:string;planId?:string;payload?:Record<string,unknown>;}
export interface LifecycleSettlementInput {
  lifecycle:PositionLifecycle;
  cashflows:LifecycleSettlementCashflow[];
  inventoryLots:PositionInventoryLot[];
  transactions:LifecycleChildTransaction[];
  positionAbsent:boolean;
  positionCheckedAt:string;
  positionCheckedSlot?:bigint;
  reconciliationClean:boolean;
  reservationClean:boolean;
}
export interface LifecycleSettlementAssessment {
  ready:boolean;
  reasonCodes:string[];
  totalSolInLamports:bigint;
  totalSolOutLamports:bigint;
  rentLockedLamports:bigint;
  rentRecoveredLamports:bigint;
  netRentCostLamports:bigint;
  realizedSolPnlLamports:bigint;
}
export interface LiveLearningOutcome {outcomeId:string;outcomeKind:"LIVE_SOL_SETTLED"|"LIVE_ENTRY_ABORTED_SOL_SETTLED";settlementId?:string;lifecycleId?:string;entryPlanId:string;predictionId:string;recommendationId:string;thesisId:string;poolAddress:string;realizedSolPnlLamports:bigint;realizedReturnFraction?:number;}
const SETTLEMENT_TERMINAL_TRANSACTION_STATES=new Set<LifecycleChildTransactionState>(["CONFIRMED","FAILED_FINAL","PROVEN_NOT_LANDED"]);
const FEE_INCOME_CASHFLOW_TYPES=['FEE_CLAIM','REWARD_CLAIM'] as const;
const SETTLEMENT_SOL_IN=new Set([...FEE_INCOME_CASHFLOW_TYPES,"REDUCE_WITHDRAWAL","CLOSE_WITHDRAWAL","SWAP_PROCEEDS","RENT_RECOVERY"]);
const SETTLEMENT_SOL_OUT=new Set(["OPEN_CONTRIBUTION","ADD_CONTRIBUTION","SWAP_COST","TX_COST","RENT_LOCK"]);
/**
 * Canonical terminal convention: gross observed SOL/WSOL instruction flows.
 * A network fee is represented exactly once by TX_COST.  RENT_LOCK is an
 * outflow and RENT_RECOVERY an inflow, so temporary rent is never a loss.
 * Non-SOL cashflows affect terminal PnL only through a later actual
 * SOL/WSOL receipt (for example SWAP_PROCEEDS), never a mark price.
 */
export function assessLifecycleSettlement(input:LifecycleSettlementInput):LifecycleSettlementAssessment{
  const reasons:string[]=[];
  if(!input.positionAbsent)reasons.push("SETTLEMENT_POSITION_STILL_EXISTS");
  if(!input.reconciliationClean)reasons.push("SETTLEMENT_RECONCILIATION_REQUIRED");
  if(!input.reservationClean)reasons.push("SETTLEMENT_RESERVATION_PENDING");
  reasons.push(...assertLifecycleTransactionsTerminal(input.transactions));
  for(const lot of input.inventoryLots){
    if(lot.status==="DUST_RETAINED"){
      const dust=lot.payload.dustDisposition;
      if(!dust||typeof dust!=="object"||String((dust as Record<string,unknown>).state??"")!=="DUST_RETAINED"||String((dust as Record<string,unknown>).rawAmount??"")!==lot.remainingRawAmount.toString()||!Number.isFinite(Number((dust as Record<string,unknown>).usdValue))||Number((dust as Record<string,unknown>).usdValue)<0||!Number.isFinite(Number((dust as Record<string,unknown>).thresholdUsd))||Number((dust as Record<string,unknown>).thresholdUsd)<0||Number((dust as Record<string,unknown>).usdValue)>Number((dust as Record<string,unknown>).thresholdUsd)||typeof (dust as Record<string,unknown>).valuationSource!=="string"||typeof (dust as Record<string,unknown>).valuationAt!=="string")reasons.push(`SETTLEMENT_DUST_DISPOSITION_INVALID:${lot.lotId}`);
      continue;
    }
    if(lot.remainingRawAmount!==0n||!(lot.status==="SETTLED"||lot.status==="TRANSFERRED")){reasons.push(`SETTLEMENT_INVENTORY_REMAINS:${lot.lotId}`);continue;}
    const terminal=lot.payload.terminalSettlement;
    if(lot.status==="SETTLED"&&(!terminal||typeof terminal!=="object"||typeof (terminal as Record<string,unknown>).transactionSignature!=="string"))reasons.push(`SETTLEMENT_INVENTORY_DISPOSITION_MISSING:${lot.lotId}`);
    const accountingDeduplicated=lot.status==="TRANSFERRED"&&terminal&&typeof terminal==="object"&&String((terminal as Record<string,unknown>).source??"")==="P6_RECOVERED_OPEN_RESIDUAL_DEDUPLICATION"&&typeof (terminal as Record<string,unknown>).canonicalLotId==="string"&&String((terminal as Record<string,unknown>).rawAmount??"")===lot.rawAmount.toString();
    if(lot.status==="TRANSFERRED"&&!accountingDeduplicated&&(!terminal||typeof terminal!=="object"||typeof (terminal as Record<string,unknown>).successorPositionAddress!=="string"||String((terminal as Record<string,unknown>).transferredRawAmount??"")!==lot.rawAmount.toString()))reasons.push("SETTLEMENT_INVENTORY_SUCCESSOR_MISSING:"+lot.lotId);
  }
  let totalSolInLamports=0n,totalSolOutLamports=0n,rentLockedLamports=0n,rentRecoveredLamports=0n;
  for(const cashflow of input.cashflows){
    // A lamport field is authoritative. WSOL raw amounts are equivalent to
    // lamports only when explicitly identified by the canonical mint.
    const amount=cashflow.lamports??(cashflow.tokenMint==="So11111111111111111111111111111111111111112"&&cashflow.tokenAmountRaw!==undefined?BigInt(cashflow.tokenAmountRaw):undefined);
    if(amount===undefined){
      if(cashflow.tokenAmountRaw!==undefined&&cashflow.tokenMint)continue;
      reasons.push(`SETTLEMENT_CASHFLOW_INCOMPLETE:${cashflow.cashflowId}`);continue;
    }
    if(SETTLEMENT_SOL_IN.has(cashflow.flowType))totalSolInLamports+=amount;
    else if(SETTLEMENT_SOL_OUT.has(cashflow.flowType))totalSolOutLamports+=amount;
    else reasons.push(`SETTLEMENT_CASHFLOW_UNCLASSIFIED:${cashflow.cashflowId}`);
    if(cashflow.flowType==="RENT_LOCK")rentLockedLamports+=amount;
    if(cashflow.flowType==="RENT_RECOVERY")rentRecoveredLamports+=amount;
  }
  return {ready:reasons.length===0,reasonCodes:[...new Set(reasons)].sort(),totalSolInLamports,totalSolOutLamports,rentLockedLamports,rentRecoveredLamports,netRentCostLamports:rentLockedLamports-rentRecoveredLamports,realizedSolPnlLamports:totalSolInLamports-totalSolOutLamports};
}
/** Exact transaction IDs are retained so recovery has a concrete proof target. */
export interface CloseFeeAttributionAccountingInput {
  tokenXMint:string;
  tokenYMint:string;
  preCloseFeeXRaw:bigint;
  preCloseFeeYRaw:bigint;
  tokenXDecimals?:number;
  tokenYDecimals?:number;
  closeTokenXRaw?:bigint;
  closeTokenYRaw?:bigint;
  closeNativeLamports:bigint;
  swapProceedsLamports:bigint;
  explicitClaimLamports:bigint;
  rewardLamports:bigint;
  initialCapitalLamports:bigint;
  transactionCostLamports:bigint;
  rentLockedLamports:bigint;
  rentRecoveredLamports:bigint;
  realizedSolPnlLamports:bigint;
}
export interface CloseFeeAttributionAccounting {
  status:'COMPLETE'|'PARTIAL';
  reasonCodes:string[];
  embeddedRemoveFeeXRaw:bigint;
  embeddedRemoveFeeYRaw:bigint;
  realizedLpFeeValueLamports?:bigint;
  principalReturnedValueLamports?:bigint;
  inventoryUnwindResultLamports?:bigint;
  accountingReconciliationDifferenceLamports?:bigint;
}
/** Pure, receipt-bound accounting for a full REMOVE. The Meteora SDK adds
 * PositionData feeX/feeY to remove output; raw fee labels are never inferred
 * from an aggregate wallet withdrawal. */
export function deriveCloseFeeAttributionAccounting(input:CloseFeeAttributionAccountingInput):CloseFeeAttributionAccounting {
  const reasons:string[]=[];
  if(!Number.isInteger(input.tokenXDecimals)||input.tokenXDecimals!<0)reasons.push('TOKEN_X_DECIMALS_UNAVAILABLE');
  if(!Number.isInteger(input.tokenYDecimals)||input.tokenYDecimals!<0)reasons.push('TOKEN_Y_DECIMALS_UNAVAILABLE');
  let feeXValue:bigint|undefined=input.preCloseFeeXRaw===0n?0n:undefined;
  let feeYValue:bigint|undefined=input.preCloseFeeYRaw===0n?0n:undefined;
  if(input.tokenXMint===WSOL_MINT)feeXValue=input.preCloseFeeXRaw;
  else if(input.preCloseFeeXRaw>0n&&input.closeTokenXRaw!==undefined&&input.closeTokenXRaw>0n&&input.swapProceedsLamports>=0n)feeXValue=(input.swapProceedsLamports*input.preCloseFeeXRaw)/input.closeTokenXRaw;
  else if(input.preCloseFeeXRaw>0n)reasons.push('FEE_X_VALUATION_UNAVAILABLE');
  if(input.tokenYMint===WSOL_MINT)feeYValue=input.preCloseFeeYRaw;
  else if(input.preCloseFeeYRaw>0n)reasons.push('FEE_Y_VALUATION_UNAVAILABLE');
  if(feeXValue===undefined||feeYValue===undefined)return{status:'PARTIAL',reasonCodes:[...new Set(reasons)].sort(),embeddedRemoveFeeXRaw:input.preCloseFeeXRaw,embeddedRemoveFeeYRaw:input.preCloseFeeYRaw};
  const feeValue=feeXValue+feeYValue;
  const closeValue=input.closeNativeLamports+input.swapProceedsLamports;
  const principal=closeValue-feeValue;
  const inventory=principal-input.initialCapitalLamports;
  const explained=inventory+feeValue+input.explicitClaimLamports+input.rewardLamports+input.rentRecoveredLamports-input.rentLockedLamports-input.transactionCostLamports;
  return{status:reasons.length?'PARTIAL':'COMPLETE',reasonCodes:[...new Set(reasons)].sort(),embeddedRemoveFeeXRaw:input.preCloseFeeXRaw,embeddedRemoveFeeYRaw:input.preCloseFeeYRaw,realizedLpFeeValueLamports:feeValue,principalReturnedValueLamports:principal,inventoryUnwindResultLamports:inventory,accountingReconciliationDifferenceLamports:input.realizedSolPnlLamports-explained};
}

export function assertLifecycleTransactionsTerminal(transactions:ReadonlyArray<LifecycleChildTransaction>):string[]{
  return transactions.filter(tx=>!SETTLEMENT_TERMINAL_TRANSACTION_STATES.has(tx.state)).map(tx=>`SETTLEMENT_TX_${tx.state}:${tx.transactionId}`);
}
export async function lifecycleSettlementEvidenceHash(input:LifecycleSettlementInput,assessment:LifecycleSettlementAssessment):Promise<string>{
  return sha256Hex(canonicalJson({lifecycleId:input.lifecycle.lifecycleId,assessment:{in:assessment.totalSolInLamports.toString(),out:assessment.totalSolOutLamports.toString(),pnl:assessment.realizedSolPnlLamports.toString(),rent:assessment.netRentCostLamports.toString()},cashflows:input.cashflows.map(flow=>[flow.cashflowId,flow.flowType,flow.lamports?.toString()??null,flow.tokenMint??null,flow.tokenAmountRaw??null]),inventoryLots:input.inventoryLots.map(lot=>[lot.lotId,lot.remainingRawAmount.toString(),lot.status]),transactions:input.transactions.map(tx=>[tx.transactionId,tx.signature??null,tx.state])}));
}
/**
 * The balance projection is deliberately independent of wallet balances.
 * Wallet truth says what an owner holds; inventory lots say which portion is
 * economically attributable to one LPForge position.
 */
export function attributedPositionInventoryRaw(lots:ReadonlyArray<Pick<PositionInventoryLot,"positionAddress"|"tokenMint"|"remainingRawAmount">>,positionAddress:string,tokenMint?:string):bigint{
  return lots.reduce((total,lot)=>total+(lot.positionAddress===positionAddress&&(!tokenMint||lot.tokenMint===tokenMint)?lot.remainingRawAmount:0n),0n);
}
export function settlePositionInventoryLotBalance(input:{remainingRawAmount:bigint;settledRawAmount:bigint;eventType:"SETTLED"|"TRANSFERRED"}):{remainingRawAmount:bigint;status:PositionInventoryLotStatus}{
  if(input.settledRawAmount<=0n)throw new Error("LPFORGE_INVENTORY_SETTLEMENT_AMOUNT_INVALID");
  if(input.settledRawAmount>input.remainingRawAmount)throw new Error("LPFORGE_INVENTORY_SETTLEMENT_EXCEEDS_LOT");
  const remainingRawAmount=input.remainingRawAmount-input.settledRawAmount;
  return{remainingRawAmount,status:remainingRawAmount===0n?input.eventType:"PARTIALLY_SETTLED"};
}
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
    metrics: Record<string, number | string | undefined>;
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
  reconcileLiveEvidenceAdmission(value:{observedAt:string;serviceableCapacity:number;productionMonitoredPoolAddresses?:string[]}):Promise<{serviceableCapacity:number;productionMonitoredCount:number;activeCount:number;qualifiedWaitingCount:number;promotedPoolAddresses:string[];demotedPoolAddresses:string[];replacements:Array<{incumbentPoolAddress:string;challengerPoolAddress:string;priorityDelta:number}>}>;
  reconcileEvidenceContinuityTracking(value:{observedAt:string;capacity:number;liveConfirmationWindowMs?:number;liveConfirmationMinimumObservations?:number;liveConfirmationMaximumGapMs?:number}):Promise<{capacity:number;trackedPoolAddresses:string[];expiredPoolAddresses:string[];evictedPoolAddresses:string[]}>;
  recordLiveEvidenceCollectionOutcome(value:{poolAddress:string;observedAt:string;success:boolean;eventPathEstimate?:boolean;phase3CurrentLiveReady?:boolean;poolReadStartedAt?:string;poolReadCompletedAt?:string;poolReadElapsedMs?:number;serviceGapMs?:number}):Promise<void>;
  recordEvidenceContinuityCollectionOutcome(value:{poolAddress:string;observedAt:string;success:boolean;poolReadStartedAt?:string;poolReadCompletedAt?:string;poolReadElapsedMs?:number;serviceGapMs?:number}):Promise<void>;
  loadActiveCandidateEvidenceCollectorTiming?():Promise<{p95PoolCollectionMs?:number}|undefined>;
  recordActiveCandidateEvidenceCollectorPass?(value:{observedAt:string;completedAt:string;elapsedMs:number;collectionSliceSize:number;effectivePoolCollectionMs:number;measuredP95PoolCollectionMs:number;projectedRevisitMs:number;capacityViolation:boolean;maxServiceGapMs:number;activePoolCount:number;successfulPoolCount:number;continuityPoolCount?:number;economicProjectedRevisitMs?:number;continuityProjectedRevisitMs?:number;economicTargetViolation?:boolean}):Promise<void>;
  recordPostEvidenceEvaluationOutcome(value:{poolAddress:string;observedAt:string;phase3Status:string;reasonCodes?:readonly string[]}):Promise<void>;
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
  loadDueDiscoveryCounterfactualPredictions(now:string,limit:number):Promise<Array<Record<string,unknown>>>;
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
  /** Immutable decision-wide RESET-3C source; never an authority input. */
  loadShadowRecommendationPayload(recommendationId:string):Promise<Record<string,unknown>|undefined>;
  /** Canonical Production global-selection evidence. This is the only pool-selection lane. */
  insertProductionGlobalCandidate(value:{globalCycleId:string;poolAddress:string;operationalCycleId:string;observedAt:string;operationalState:'ENTRY_READY'|'NO_TRADE'|'WARMING'|'REJECTED';phase4State:string;recommendationId?:string;thesisId?:string;candidateId?:string;strategy?:string;orientation?:string;lowerBinId?:number;upperBinId?:number;activeBinId?:number;capitalValue?:number;horizonMinutes?:number;predictedGrossFees?:number;predictedInventoryPnl?:number;predictedNetEv?:number;riskAdjustedExpectedNetEv?:number;uncertainty?:number;confidence?:number;oorRisk?:number;eventPathEvidenceAt?:string;feeEvidenceAt?:string;volumeEvidenceAt?:string;tvl?:number;feeTvl1h?:number;feeTvl24h?:number;reasonCodes:string[];evidence:Record<string,unknown>;payload:Record<string,unknown>}):Promise<void>;
  loadProductionGlobalCandidateFacts(globalCycleId:string,poolAddresses:string[]):Promise<Array<Record<string,unknown>>>;
  /** Verifies an exact, fresh canonical global-winner binding for Phase-6 claim admission. */
  verifyProductionGlobalWinnerAdmission(value:{globalCycleId:string;poolAddress:string;candidateId:string;now:string}):Promise<{globalCycleId:string;poolAddress:string;candidateId:string;selectionTier:string;selectionState:string;selectionDynamicEligible:boolean}|undefined>;
  loadProductionPoolSettlementHistory(poolAddresses:string[],decisionCutoff:string):Promise<Array<Record<string,unknown>>>;
  insertProductionGlobalSelection(value:{globalCycleId:string;policyVersion:string;reentryContextPolicyVersion:string;decisionCutoff:string;startedAt:string;completedAt:string;eligiblePoolCount:number;evaluatedPoolCount:number;candidatePoolCount:number;coverageState:string;outcome:string;winnerPoolAddress?:string;winnerCandidateId?:string;runnerUpPoolAddress?:string;rankingMetric:string;crossPoolMetricsComparable:boolean;reasonCodes:string[];sourceCommit?:string;buildId?:string;payload:Record<string,unknown>;candidates:Array<{poolAddress:string;evaluationOrder:number;candidateRank?:number;candidateState:string;selectionTier?:string;selectionState?:string;selectionDynamicEligible?:boolean;recommendationId?:string;thesisId?:string;candidateId?:string;strategy?:string;orientation?:string;lowerBinId?:number;upperBinId?:number;activeBinId?:number;riskAdjustedExpectedNetEv?:number;predictedFees?:number;predictedInventoryPnl?:number;capitalValue?:number;horizonMinutes?:number;decisionAt?:string;expiresAt?:string;phase3State?:string;phase4State?:string;reasonCodes:string[];historyContext:Record<string,unknown>;payload:Record<string,unknown>}>}):Promise<void>;
  /** Shadow-only Phase-3 forward-validation capture. It has no authority path. */
  /** RESET-3C append-only full-universe evidence. It is never read by authority paths. */
  insertReset3cValidationUniverse(value:{recommendationId:string;decisionId:string;decisionAt:string;samplingContractVersion:string;storageContractVersion:string;capitalLamports:string;expectedCandidateCount:number;capturedCandidateCount:number;universeComplete:boolean;universeManifestHash:string;detailedCandidateCount:number;outcomeEligibleCandidateCount:number;detailedCandidateIds:string[];selectionManifest:Record<string,unknown>;detailedSelectionManifestHash:string;census:Record<string,unknown>;sharedEvidenceHash:string;temporarySharedEvidence:Record<string,unknown>;contentHash:string;}):Promise<'INSERTED'|'IDEMPOTENT'>;
  loadReset3cValidationUniverse(recommendationId:string):Promise<Record<string,unknown>|undefined>;
  markTerminalEligibleReset3cValidationUniverses(now:string,limit:number):Promise<number>;
  purgeTerminalEligibleReset3cValidationEvidence(now:string,limit:number):Promise<number>;
  insertCandidateUniverseRerankRetention(value:{recommendationId:string;decisionId:string;decisionAt:string;poolAddress:string;calibrationVersion:string;expectedCandidateCount:number;universeManifestHash:string;candidateFacts:Record<string,unknown>;compactSummary:Record<string,unknown>;retentionUntil:string;contentHash:string;}):Promise<'INSERTED'|'IDEMPOTENT'>;
  compactEligibleCandidateUniverseRerankRetention(now:string,limit:number):Promise<number>;
  insertVariableCapitalEvaluation(value:{capitalEvaluationId:string;recommendationId:string;decisionId:string;candidateId:string;proposedCapitalLamports:string;allocatedCapitalLamports?:string;capitalContractHash:string;positionContractHash?:string;capitalFeasibilityStatus:string;bindingConstraint:string;sourceSha:string;buildId:string;policyHash:string;migrationHead:string;evidenceManifestHash?:string;outcomeCreatedAt?:string;provenance:Record<string,unknown>;rawContract:Record<string,unknown>;contentHash:string;}):Promise<'INSERTED'|'IDEMPOTENT'>;
  insertPhase3ForwardDecision(value: {
    recommendationId: string;
    decisionId: string;
    poolAddress: string;
    decisionAt: string;
    sourceSha: string;
    buildId: string;
    policyHash: string;
    migrationHead: string;
    capitalLamports: string;
    selectedCandidateKind: 'RANKING_WINNER'|'TOP_RANKED_COUNTERFACTUAL'|'NONE';
    activeBinIdAtDecision: number;
    strategy?: string;
    orientation?: string;
    rangeFamily?: string;
    lowerBinId?: number;
    upperBinId?: number;
    includedBinCount?: number;
    candidateWeights: Array<{binId:number;weight:number}>;
    prediction: Record<string, unknown>;
    evidenceProvenance: Record<string, unknown>;
    phase3State: string;
    phase3Outcome: 'NO_TRADE'|'WATCHING'|'ENTRY_READY';
    reasonCodes: string[];
    wouldAugEraThesisSemanticsHaveCreatedThesis: boolean;
    payload: Record<string, unknown>;
  }): Promise<boolean>;
  ensurePhase3ForwardOutcome(value:{recommendationId:string;horizonMinutes:30|60|120;outcomeModelVersion:string}):Promise<boolean>;
  loadDuePhase3ForwardOutcomes(now: string, limit: number): Promise<Array<{recommendationId:string;horizonMinutes:30|60|120;outcomeModelVersion:string;sourceSha?:string;decisionPayload:Record<string,unknown>;state:'PENDING'|'INSUFFICIENT_EVIDENCE'|'FINAL'|'FAILED_DATA_INTEGRITY';retryCount:number;dueAt:string;nextRetryAt?:string;evidenceHash?:string;resultHash?:string}>>;
  persistPhase3ForwardOutcome(value:{recommendationId:string;horizonMinutes:30|60|120;outcomeModelVersion:string;state:'PENDING'|'INSUFFICIENT_EVIDENCE'|'FINAL'|'FAILED_DATA_INTEGRITY';evidenceHash?:string;resultHash?:string;reasonCodes:string[];realized?:Record<string,unknown>;payload:Record<string,unknown>;maturedAt:string;attemptedAt:string;retryCount:number;nextRetryAt?:string;terminalAt?:string}):Promise<{writeApplied:boolean;stateTransition:boolean;retryNoProgress:boolean}>;
  loadPhase3ForwardOutcomes(limit?:number): Promise<Array<Record<string,unknown>>>;
  /** Prospective-only research telemetry. No Phase-3/4 consumer calls these. */
  loadDueCandidateCounterfactualOutcomes(now:string,limit:number,lane?:CandidateCounterfactualQueueLane):Promise<Array<{capitalEvaluationId:string;horizonMinutes:30|60|120;outcomeModelVersion:string;state:'PENDING'|'INSUFFICIENT_EVIDENCE'|'FINAL'|'FAILED_DATA_INTEGRITY';retryCount:number;rawContract:Record<string,unknown>}>>;
  persistCandidateCounterfactualOutcome(value:{capitalEvaluationId:string;horizonMinutes:30|60|120;outcomeModelVersion:string;state:'INSUFFICIENT_EVIDENCE'|'FINAL'|'FAILED_DATA_INTEGRITY';evidenceHash?:string;resultHash:string;reasonCodes:string[];realized?:Record<string,unknown>;payload:Record<string,unknown>;attemptedAt:string;retryCount:number;nextRetryAt?:string;terminalAt?:string}):Promise<'APPLIED'|'IDEMPOTENT'>;
  /** Oldest-first M0062 full-universe contract backfill.  It returns only
   * immutable decision-time data and never consults current market state. */
  loadFullUniverseOutcomeCoverageBackfill(limit:number):Promise<Array<{recommendationId:string;decisionId:string;decisionAt:string;poolAddress:string;expectedCandidateCount:number;candidateFacts:Record<string,unknown>;temporarySharedEvidence?:Record<string,unknown>;missingCandidateIds:string[]}>>;
  refreshCandidateUniverseForwardOutcomeCoverage(recommendationId:string,at:string):Promise<void>;
  /** Derived-state repair only: returns oldest manifests whose durable outcome
   * rows no longer agree with their aggregate coverage counters. */
  loadStaleCandidateUniverseForwardOutcomeCoverage(limit:number):Promise<string[]>;
  /** Dynamic, fail-closed retention protection for raw protocol bin history. */
  loadBinSnapshotRetentionPlan(now:string):Promise<{state:'READY'|'UNKNOWN';protectionFloor?:string;protectionInputs:Partial<Record<'SELECTED_FORWARD'|'CANDIDATE_COUNTERFACTUAL'|'INVENTORY_FORECAST_V2'|'OPERATIONAL_HISTORY',string>>;reasonCodes:string[]}>;
  deleteBinSnapshotsBefore(protectionFloor:string,limit:number):Promise<{deleted:number;oldestDeletedAt?:string;newestDeletedAt?:string}>;
  preparePostEntryTelemetryEpisodes(capturedAt:string,limit?:number):Promise<{created:number}>;
  loadDuePostEntryTelemetryCheckpoints(now:string,limit:number):Promise<Array<{
    telemetryEpisodeId:string;checkpointKey:string;observationType:'ENTRY'|'CHECKPOINT'|'FINALIZATION';targetAt:string;decisionAt:string;sourceVersion:string;frozenHeader:Record<string,unknown>;decisionPayload:Record<string,unknown>;decisionCheckpointContent?:Record<string,unknown>;previousCheckpointContent?:Record<string,unknown>;terminalOutcomes?:Array<Record<string,unknown>>;
  }>>;
  appendPostEntryTelemetryObservation(value:{
    telemetryEpisodeId:string;checkpointKey:string;observationType:'ENTRY'|'CHECKPOINT'|'FINALIZATION';targetAt:string;observedAt?:string;capturedAt:string;checkpointStatus:'OBSERVED'|'MISSED'|'DELAYED'|'SOURCE_UNAVAILABLE'|'DUPLICATE_REJECTED'|'INTEGRITY_CONFLICT';sourceVersion:string;collectorVersion:string;valuationContractVersion:string;content:Record<string,unknown>;
  }):Promise<{status:'INSERTED'|'DUPLICATE_REJECTED'|'INTEGRITY_CONFLICT';observationId?:string;sequenceNumber?:number;contentHash:string;currentHash?:string}>;
  loadPostEntryTelemetryEpisode(telemetryEpisodeId:string):Promise<{headerHash:string;observations:Array<Record<string,unknown>>;manifest:Array<Record<string,unknown>>}|undefined>;
  /** M0050 reads only frozen forward decisions and writes research evidence. */
  ensureMarketContextTelemetryActivation(value:{activationId:string;activatedAt:string;sourceSha:string;buildId:string;migrationVersion:string;telemetrySchemaVersion:string;marketContextSchemaVersion:string;marketContextModelVersion:string;collectorVersion:string;}):Promise<{created:boolean;activatedAt:string}>;
  loadDueProspectiveMarketContextSnapshots(now:string,limit:number,marketContextModelVersion:string):Promise<Array<{telemetryEpisodeId:string;recommendationId:string;poolAddress:string;decisionAt:string;headerHash:string;decisionPayload:Record<string,unknown>;sourceSha:string;buildId:string;migrationHead:string;}>>;
  appendProspectiveMarketContextSnapshot(value:{telemetryEpisodeId:string;recommendationId:string;poolAddress:string;decisionAt:string;capturedAt:string;decisionSourceSha:string;decisionBuildId:string;decisionMigrationHead:string;telemetrySchemaVersion:string;marketContextSchemaVersion:string;marketContextModelVersion:string;regimeModelVersion?:string;volatilityModelVersion?:string;collectorVersion:string;captureStatus:'OBSERVED'|'PARTIAL'|'SOURCE_UNAVAILABLE'|'SOURCE_STALE'|'SOURCE_TIMESTAMP_UNVERIFIED';reasonCodes:string[];availability:Record<string,unknown>;rawPayload:Record<string,unknown>;derivedInterpretation:Record<string,unknown>;provenance:Record<string,unknown>;facts:Array<{key:string;layer:'RAW_FACT'|'DERIVED_INTERPRETATION';value:unknown;unit:string;sourceIdentity:string;sourceVersion:string;availabilityStatus:string;sourceObservedAt?:string;sourceAgeMs?:number;sourceWindow?:string;}>;}):Promise<{status:'INSERTED'|'DUPLICATE_REJECTED'|'INTEGRITY_CONFLICT';contentHash:string;snapshotId?:string;currentHash?:string}>;
  loadProspectiveMarketContextSnapshot(telemetryEpisodeId:string,marketContextModelVersion:string):Promise<{headerHash:string;snapshot:Record<string,unknown>;facts:Array<Record<string,unknown>>;manifest?:Record<string,unknown>}|undefined>;
  /** M0052 is a separate shadow-only recorder. No authority path consumes it. */
  ensureInventoryForecastV2Activation(value:{activationId:string;activatedAt:string;sourceSha:string;buildId:string;migrationHead:string;policyHash:string;forecastSchemaVersion:string;forecastModelVersion:string;formulaVersion:string;collectorVersion:string;m0050MarketContextModelVersion:string;v2OutcomeModelVersion:string;}):Promise<{created:boolean;activatedAt:string}>;
  loadDueInventoryForecastV2Predictions(now:string,limit:number,forecastModelVersion:string):Promise<Array<{telemetryEpisodeId:string;recommendationId:string;poolAddress:string;decisionAt:string;headerHash:string;decisionPayload:Record<string,unknown>;sourceSha:string;buildId:string;migrationHead:string;tokenXMint?:string;tokenYMint?:string;poolFirstSeenAt?:string;}>>;
  appendInventoryForecastV2Prediction(value:{telemetryEpisodeId:string;recommendationId:string;candidateId:string;poolAddress:string;decisionAt:string;capturedAt:string;decisionSourceSha:string;decisionBuildId:string;decisionMigrationHead:string;forecastSchemaVersion:string;forecastModelVersion:string;formulaVersion:string;collectorVersion:string;captureStatus:'OBSERVED'|'FORECAST_UNAVAILABLE'|'SOURCE_UNAVAILABLE'|'SOURCE_STALE'|'SOURCE_TIMESTAMP_UNVERIFIED';reasonCodes:string[];rawFrozenInputs:Record<string,unknown>;derivedForecast:Record<string,unknown>;provenance:Record<string,unknown>;}):Promise<{status:'INSERTED'|'DUPLICATE_REJECTED'|'INTEGRITY_CONFLICT';contentHash:string;predictionId?:string;currentHash?:string}>;
  loadInventoryForecastV2ValidationRows(forecastModelVersion:string):Promise<Array<Record<string,unknown>>>;
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
  /**
   * The controlled canary watch consumes only a still-live Phase-4 approval.
   * This is deliberately a read-only lookup: it never invents an entry
   * decision and it cannot revive an expired evaluation.
   */
  loadFreshPhase4EntryAuthorization(now: string): Promise<
    | {
        entryEvaluationId: string;
        thesisId: string;
        poolAddress: string;
        observedAt: string;
        expiresAt: string;
        confidence: number;
        reasonCodes: string[];
        payload: Record<string, unknown>;
      }
    | undefined
  >;
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
  ensureExecutionTransactionStep(value: {
    planId: string;
    transactionId: string;
    kind: string;
    state: string;
    requiredSignerAddresses: string[];
    metadata: Record<string, unknown>;
  }): Promise<void>;
  claimNextAutonomousPlan(now: string): Promise<AutonomousPlan | undefined>;
  reserveExecutionCapital(value:ExecutionCapitalReservationRequest):Promise<ExecutionCapitalReservationResult>;
  releaseExecutionCapital(planId:string,at:string,reasonCodes:string[]):Promise<void>;
  markExecutionCapitalSubmitted(planId:string,at:string):Promise<void>;
  reconcileExecutionCapitalReservations(at:string):Promise<void>;
  countExecutionActionsSince(ownerAddress:string,since:string):Promise<number>;
  /**
   * A durable, one-time permit for a specifically armed controlled-canary
   * campaign.  A pre-sign, proven-zero-exposure failure can use exactly one
   * separately audited replacement attempt; the original campaign run is
   * never rewritten or released.
   */
  reserveControlledCanaryCampaignOpen(value:{campaignId:string;planId:string;poolAddress:string;capitalLamports:bigint;at:string}):Promise<{reserved:boolean;existingPlanId?:string}>;
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
    entrySlot?: bigint;
    enteredAt: string;
    lifecycleState:
      | "OPEN"
      | "CLOSING"
      | "CLOSED"
      | "SOL_SETTLED"
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
  loadLatestPositionManagementMetrics(lpforgePositionId:string): Promise<Record<string,unknown>|null>;
  insertPositionManagementMetrics(value:{
    lpforgePositionId:string; observedAt:string; policyVersion:string;
    managedNavUsd?:number; currentReturnFraction?:number; inventoryValueUsd?:number; cumulativeGrossFeesUsd?:number;
    mfeManagedNavUsd?:number; mfeReturnFraction?:number; mfeObservedAt?:string; mfeActiveBin?:number;
    mfeInventoryValueUsd?:number; mfeCumulativeGrossFeesUsd?:number;
    inventoryDeteriorationSinceMfeUsd?:number; grossFeesSinceMfeUsd?:number; feeCompensationRatio?:number;
    economicClassification:string; tokenInventoryShare?:number; solInventoryShare?:number;
    flowEvidenceStatus:string; continuationEvidenceAvailable:boolean; continuationEvidenceAgeSeconds?:number;
    continuationExpectedNetEvLamports?:bigint; continuationUncertainty?:number; continuationReasonCodes:string[];
    managementHoldClassification:string; actionLaneState:string; payload:Record<string,unknown>;
  }): Promise<void>;
  loadPositionOorLifecycleState(positionAddress:string): Promise<Record<string,unknown>|null>;
  /** Reconstructs only from durable monitor observations when M0065 first
   * encounters an already-open position; it never uses current market data. */
  reconstructPositionOorLifecycleState(positionAddress:string): Promise<Record<string,unknown>|null>;
  upsertPositionOorLifecycleState(value:{
    lpforgePositionId:string; positionAddress:string; poolAddress:string; policyVersion:string;
    rangeState:"IN_RANGE"|"OUT_OF_RANGE"; lifecycleState:string; direction?:"ABOVE_MAX"|"BELOW_MIN";
    inventoryClassification:string; firstOorDetectedAt?:string; continuousOorStartedAt?:string;
    latestObservedAt:string; lastReenteredAt?:string; excursionCount:number;
    totalOorDurationSeconds:number; continuousOorDurationSeconds:number; activeBinId?:number;
    lowerBinId:number; upperBinId:number; feeValueAtOorStartLamports?:bigint; feeValueLamports?:bigint; feeSinceOorLamports?:bigint;
    activeFeeRateLamportsPerHour?:bigint; recommendation:string; reasonCodes:string[];
    chainObservedAt?:string; chainSlot?:bigint; payload:Record<string,unknown>;
  }): Promise<void>;
  insertPositionManagementDecisionAudit(value:{lpforgePositionId:string;positionAddress:string;observedAt:string;activeBinId?:number;lowerBinId:number;upperBinId:number;positionContinuationEvLamports?:bigint;expectedCloseCostLamports?:bigint;uncertainty?:number;forecastHorizonMinutes?:number;sourceDecisionId?:string;sourceEconomicsId?:string;geometryIdentity:string;managementAction:string;exitReasonFamily:string;reasonCodes:string[];confirmationSequenceCount:number;validContinuationEvidence:boolean}):Promise<void>;
  loadOwnedPositions(ownerAddress: string): Promise<Record<string, unknown>[]>;
  upsertWalletPositionDiscovery(value: WalletPositionDiscovery): Promise<void>;
  loadWalletPositionDiscoveries(ownerAddress: string): Promise<WalletPositionDiscovery[]>;
  findAutonomousOpenPlansByPosition(value: {
    ownerAddress: string;
    poolAddress: string;
    positionAddress: string;
  }): Promise<AutonomousPlan[]>;
  loadOwnedPoolHistory(ownerAddress:string):Promise<Array<{poolAddress:string;tokenXMint?:string;tokenYMint?:string}>>;
  loadPhase7PortfolioFacts(ownerAddress:string):Promise<{deployedLamports:bigint;pendingReservedLamports:bigint;pendingExecutionCount:number;openPositions:number;unresolvedReconciliationDebt:number;poolExposureLamports:Record<string,bigint>;poolPendingLamports:Record<string,bigint>;tokenExposureLamports:Record<string,bigint>;tokenPendingLamports:Record<string,bigint>}>;
  loadPhase7PortfolioRiskState(ownerAddress:string):Promise<Record<string,unknown>|undefined>;
  upsertPhase7PortfolioRiskState(value:{ownerAddress:string;dayStart:string;dailyStartEquityLamports:bigint;peakEquityLamports:bigint;currentEquityLamports:bigint;observedAt:string;valuationState:'RECONCILED'|'UNAVAILABLE';reasonCodes:string[];payload:Record<string,unknown>}):Promise<void>;
  loadPositionExitState(lpforgePositionId: string): Promise<Record<string, unknown> | null>;
  upsertPositionExitState(value: {
    lpforgePositionId:string; observedAt:string; evidenceState:string; initialCapitalUsd?:number; currentEconomicValueUsd?:number;
    netPnlUsd?:number; netReturnFraction?:number; peakNetReturnFraction:number; peakEconomicValueUsd?:number; peakObservedAt:string|Date;
    lastAction:string; reasonCodes:string[]; payload:Record<string,unknown>;
  }): Promise<void>;
  hasActiveAutonomousPlan(positionAddress: string): Promise<boolean>;
  loadActiveAutonomousPlansForPosition(positionAddress:string): Promise<Array<{planId:string;action:AutonomousPlanAction;state:string;createdAt:string;expiresAt:string}>>;
  markOwnedPositionLifecycle(value: {
    positionAddress: string;
    lifecycleState:
      | "OPEN"
      | "CLOSING"
      | "CLOSED"
      | "SOL_SETTLED"
      | "RECONCILIATION_REQUIRED"
      | "ENTRY_FUNDED_NOT_OPEN"
      | "ABORTED";
    reconciliationStatus: string;
    lastPlanId?: string;
    at: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  adjustOwnedPositionCapital(value: {
    positionAddress: string;
    capitalLamports: bigint;
    at: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  insertPositionCashflow(value:{cashflowId:string;positionAddress:string;planId:string;flowType:'OPEN_CONTRIBUTION'|'ADD_CONTRIBUTION'|'FEE_CLAIM'|'REWARD_CLAIM'|'REDUCE_WITHDRAWAL'|'CLOSE_WITHDRAWAL'|'SWAP_PROCEEDS'|'SWAP_COST'|'TX_COST'|'RENT_LOCK'|'RENT_RECOVERY';observedAt:string;lamports?:bigint;tokenMint?:string;tokenAmountRaw?:string;payload:Record<string,unknown>}):Promise<void>;
  loadPositionCashflows(positionAddress:string):Promise<Array<{flowType:string;lamports?:bigint;tokenMint?:string;tokenAmountRaw?:string;payload?:Record<string,unknown>}>>;
  ensurePositionLifecycle(value:{positionAddress:string;entryPlanId?:string;ownerAddress:string;poolAddress:string;predecessorLifecycleId?:string;at:string}):Promise<PositionLifecycle>;
  linkPositionLifecyclePlan(value:{positionAddress:string;planId:string;role:"ENTRY"|"MANAGEMENT"|"CLOSE"|"RECOVERY";at:string}):Promise<void>;
  loadLifecycleSettlementInput(positionAddress:string):Promise<Omit<LifecycleSettlementInput,"positionAbsent"|"positionCheckedAt"|"positionCheckedSlot">|undefined>;
  persistLifecycleSolSettlement(value:{assessment:LifecycleSettlementAssessment;input:LifecycleSettlementInput;sourceCommit?:string;policyHash?:string;migrationHead?:string;buildId?:string;at:string}):Promise<{lifecycleId:string;settlementId:string;created:boolean;superseded?:boolean}>;
  upsertLifecycleSettlementChainReconciliation(value:{positionAddress:string;closePlanId:string;status:"RECONCILED_CHAIN"|"RECONCILIATION_REQUIRED";chainSolInLamports:bigint;chainSolOutLamports:bigint;dbSolInLamports:bigint;dbSolOutLamports:bigint;reasonCodes:string[];payload:Record<string,unknown>;observedAt:string}):Promise<void>;
  loadTerminalCloseRentRecoveryCandidates(limit?:number):Promise<Array<{planId:string;positionAddress:string}>>;
  loadPendingPositionManagementDecisionAuditCompactions(limit?:number):Promise<string[]>;
  compactPositionManagementDecisionAudit(value:{positionAddress:string;at:string}):Promise<{compacted:boolean}>;
  upsertCloseFeeAttributionSnapshot(value:{closePlanId:string;positionAddress:string;poolAddress:string;ownerAddress:string;observedSlot?:bigint;observedAt:string;observedBlockTime?:string;commitment:string;tokenXMint:string;tokenYMint:string;tokenXDecimals?:number;tokenYDecimals?:number;preCloseFeeXRaw:bigint;preCloseFeeYRaw:bigint;preCloseRewardOneRaw:bigint;preCloseRewardTwoRaw:bigint}):Promise<void>;
  finalizeCloseFeeAttribution(value:{closePlanId:string;positionAddress:string;removeSignature:string;claimSignature?:string;terminalSettlementId:string;at:string}):Promise<{status:'COMPLETE'|'PARTIAL'|'UNAVAILABLE';reasonCodes:string[]}>;

  createLiveSolSettledLearningOutcome(value:{positionAddress:string;at:string}):Promise<{created:boolean;outcome?:LiveLearningOutcome;reasonCodes:string[]}>;
  createLiveEntryAbortedLearningOutcome(value:{planId:string;at:string}):Promise<{created:boolean;outcome?:LiveLearningOutcome;reasonCodes:string[]}>;
  loadPendingLiveSolSettledLearningOutcomes(limit?:number):Promise<string[]>;
  loadLiveLearningOutcomes(limit?:number):Promise<Array<Record<string,unknown>>>;
  insertLiveLearningCalibration(value:{snapshotId:string;observedAt:string;sampleCount:number;independentEpisodes:number;brierProfit?:number;netPnlMaeLamports?:number;meanBiasLamports?:number;payload:Record<string,unknown>}):Promise<void>;
  createPositionInventoryLot(value:Omit<PositionInventoryLot,"remainingRawAmount"|"status">&{createdEventId:string;transactionSignature?:string}):Promise<void>;
  settlePositionInventoryLot(value:{eventId:string;lotId:string;planId?:string;eventType:"SETTLED"|"TRANSFERRED";settledRawAmount:bigint;observedAt:string;transactionSignature?:string;payload:Record<string,unknown>}):Promise<{remainingRawAmount:bigint;status:PositionInventoryLotStatus}>;
  retainPositionInventoryLotDust(value:{eventId:string;lotId:string;planId?:string;observedAt:string;payload:Record<string,unknown>}):Promise<void>;
  correctAggregateCloseClaimAttribution(value:{eventId:string;closeLotId:string;claimLotId:string;planId:string;claimRawAmount:bigint;transactionSignature:string;observedAt:string;payload:Record<string,unknown>}):Promise<void>;
  loadPositionInventoryLots(positionAddress:string,tokenMint?:string):Promise<PositionInventoryLot[]>;
  loadOwnerPositionInventoryLots(ownerAddress:string):Promise<PositionInventoryLot[]>;
  insertPlanCashflow(value:PlanCashflow):Promise<void>;
  loadPlanCashflows(planId:string):Promise<PlanCashflow[]>;
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
      | "RECONCILIATION_REQUIRED"
      | "OPEN_RECOVERED"
      | "ABORTED_SOL_SETTLED";
    walletTruth: Record<string, unknown>;
    payload: Record<string, unknown>;
    updatedAt: string;
  }): Promise<void>;
  loadPartialEntryRecoveries(): Promise<Record<string, unknown>[]>;
  /** Direct lookup is needed only for close-time attribution of a terminal
   * OPEN_RECOVERED row; the recurring entry-recovery queue intentionally
   * excludes that terminal state. */
  loadPartialEntryRecovery(
    planId: string,
  ): Promise<Record<string, unknown> | undefined>;
  upsertOpenChunkDisposition(value:OpenChunkDispositionRecord):Promise<void>;
  loadOpenChunkDispositions(planId:string):Promise<OpenChunkDispositionRecord[]>;
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
  /** A signature was observed absent after its blockhash expired.  This is a
   * terminal no-effect recovery result, never permission to resend it. */
  markSubmissionExpired(
    signature: string,
    at: string,
    reason: string,
  ): Promise<void>;
  /** A skip-preflight=false RPC simulation rejection has no chain effect. */
  recoverNoEffectPreflightSubmissionAttempts(at: string): Promise<number>;
  /** Durable blockhash evidence for signature-first recovery. */
  loadSubmissionAttemptBySignature(
    signature: string,
  ): Promise<{ lastValidBlockHeight?: number } | undefined>;
  /**
   * Recovery may resume a multi-child protective close only from the exact
   * child that is durably recorded as confirmed.  This is intentionally a
   * transaction-id lookup rather than a plan-wide "latest signature" lookup:
   * the latter can point at an earlier REMOVE or CLAIM child.
   */
  loadConfirmedSubmissionByTransactionId(
    transactionId: string,
  ): Promise<{
    signature: string;
    status: "CONFIRMED" | "FINALIZED";
    slot?: bigint;
  } | undefined>;
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
    state: ExecutionJournalState;
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
    state: ExecutionJournalState;
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
    /** Optional immutable evidence boundary. Undefined preserves the
     * existing unbounded live-history reader for non-forward callers. */
    through?: string,
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
  loadPhase7ControlDecision(
    runtimeId: string,
    decisionId: string,
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
    supersededReconciliationHistoryCount: number;
    partialEntryRecoveryCount: number;
  }>;
  loadPhase7EvidenceFacts(runtimeId: string): Promise<{
    latestHealthStatus?: string;
    latestDriftStatus?: string;
    latestSafetyMode?: string;
    latestRuntimePlan?: string;
    runtimeCycleCount: number;
    unresolvedReconciliationDebt: number;
    supersededReconciliationHistoryCount: number;
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
 * Canonical P7 operational debt view.  Historical plan-level UNKNOWN rows are
 * retained, but are non-blocking only after a later lifecycle reconciliation
 * authoritatively proves SOL_SETTLED / RECONCILED_CHAIN and no subsequent
 * linked effect is still unresolved.  This is deliberately a derived query:
 * it never rewrites reconciliation evidence.
 */
const phase7ReconciliationDebtQuery = `
  WITH latest_plan_reconciliation AS (
    SELECT DISTINCT ON (plan_id) plan_id,status,observed_at
    FROM execution.reconciliations
    ORDER BY plan_id,observed_at DESC
  ),
  latest_lifecycle_reconciliation AS (
    SELECT DISTINCT ON (lifecycle_id) lifecycle_id,status,observed_at
    FROM execution.lifecycle_settlement_chain_reconciliations
    ORDER BY lifecycle_id,observed_at DESC,updated_at DESC
  ),
  unresolved AS (
    SELECT plan.plan_id,plan.status AS plan_status,plan.observed_at AS plan_observed_at,
           link.lifecycle_id,lifecycle.status AS lifecycle_status,
           authority.status AS authority_status,authority.observed_at AS authority_observed_at
    FROM latest_plan_reconciliation plan
    LEFT JOIN execution.lifecycle_plan_links link ON link.plan_id=plan.plan_id
    LEFT JOIN execution.position_lifecycles lifecycle ON lifecycle.lifecycle_id=link.lifecycle_id
    LEFT JOIN latest_lifecycle_reconciliation authority ON authority.lifecycle_id=link.lifecycle_id
    WHERE plan.status<>'MATCH'
  ),
  classified AS (
    SELECT unresolved.*,
      EXISTS (
        SELECT 1
        FROM execution.execution_journal journal
        JOIN execution.lifecycle_plan_links later_link ON later_link.plan_id=journal.plan_id
        WHERE later_link.lifecycle_id=unresolved.lifecycle_id
          AND journal.updated_at>unresolved.authority_observed_at
          AND journal.state IN ('SIGNED','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED')
      )
      OR EXISTS (
        SELECT 1
        FROM latest_plan_reconciliation later_plan
        JOIN execution.lifecycle_plan_links later_link ON later_link.plan_id=later_plan.plan_id
        WHERE later_link.lifecycle_id=unresolved.lifecycle_id
          AND later_plan.observed_at>unresolved.authority_observed_at
          AND later_plan.status<>'MATCH'
      ) AS newer_unresolved_effect
    FROM unresolved
  )
  SELECT
    count(*) FILTER (
      WHERE NOT (
        lifecycle_status='SOL_SETTLED'
        AND authority_status='RECONCILED_CHAIN'
        AND authority_observed_at>plan_observed_at
        AND NOT newer_unresolved_effect
      )
    )::int AS blocking_debt,
    count(*) FILTER (
      WHERE lifecycle_status='SOL_SETTLED'
        AND authority_status='RECONCILED_CHAIN'
        AND authority_observed_at>plan_observed_at
        AND NOT newer_unresolved_effect
    )::int AS superseded_history
  FROM classified
`;
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
    state: String(row.state),
    idempotencyKey: String(row.idempotency_key),
    action: String(row.action) as AutonomousPlanAction,
    poolAddress: String(row.pool_address),
    ownerAddress: String(row.owner_address),
    ...(row.position_address
      ? { positionAddress: String(row.position_address) }
      : {}),
    thesisId: String(row.thesis_id),
    ...(row.position_identity_source
      ? { positionIdentitySource: String(row.position_identity_source) as "DIRECT" | "LIFECYCLE_SOL_SETTLED" }
      : {}),
    observedAt: toIsoTimestamp(row.observed_at),
    ...(row.position_lifecycle_settled === true ? { positionLifecycleSettled: true } : {}),
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

/**
 * Project a durable operational market row without manufacturing bin-motion
 * evidence. Historical OHLCV rows may be valid price/volume evidence while
 * having no active-bin observation; SQL NULL must remain absent here because
 * Number(null) would fabricate active bin zero.
 */
export function operationalActiveBinIdFromDbValue(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const activeBinId = Number(value);
  return Number.isFinite(activeBinId) ? activeBinId : undefined;
}

function optionalFiniteDbNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function operationalMarketObservationFromDbRow(r: Record<string, unknown>): {
  observedAt: string;
  price: number;
  activeBinId?: number;
  resolutionMs: number;
  volume?: number;
  feeValue?: number;
  localLiquidity?: number;
} | undefined {
  const price = Number(r.price);
  if (!(price > 0)) return undefined;
  const activeBinId = operationalActiveBinIdFromDbValue(r.active_bin_id);
  const localLiquidity = optionalFiniteDbNumber(r.tvl);
  return {
    observedAt: new Date(String(r.observed_at)).toISOString(),
    price,
    ...(activeBinId !== undefined ? { activeBinId } : {}),
    resolutionMs: Number(r.resolution_ms),
    ...(Number.isFinite(Number(r.volume_5m))
      ? { volume: Number(r.volume_5m) }
      : {}),
    ...(Number.isFinite(Number(r.fee_5m))
      ? { feeValue: Number(r.fee_5m) }
      : {}),
    ...(localLiquidity !== undefined ? { localLiquidity } : {}),
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
        `INSERT INTO market.pool_discovery_registry(pool_address,first_seen_at,last_seen_at,source_manual,source_auto,token_x_mint,token_y_mint,paired_token_mint,paired_token_symbol,market_cap_cohort,current_state,current_tier,last_priority_score,last_rank,last_universe_percentile,reason_codes,evidence_state,payload) VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb) ON CONFLICT(pool_address) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at,source_manual=market.pool_discovery_registry.source_manual OR EXCLUDED.source_manual,source_auto=market.pool_discovery_registry.source_auto OR EXCLUDED.source_auto,token_x_mint=COALESCE(EXCLUDED.token_x_mint,market.pool_discovery_registry.token_x_mint),token_y_mint=COALESCE(EXCLUDED.token_y_mint,market.pool_discovery_registry.token_y_mint),paired_token_mint=COALESCE(EXCLUDED.paired_token_mint,market.pool_discovery_registry.paired_token_mint),paired_token_symbol=COALESCE(EXCLUDED.paired_token_symbol,market.pool_discovery_registry.paired_token_symbol),market_cap_cohort=EXCLUDED.market_cap_cohort,current_state=CASE WHEN EXCLUDED.current_state='PREFILTERED' AND market.pool_discovery_registry.current_state IN ('ACTIVE_CANDIDATE','WATCHLIST','QUALIFIED') AND COALESCE(EXCLUDED.payload->>'deepScreened','false')<>'true' THEN market.pool_discovery_registry.current_state WHEN EXCLUDED.current_state='QUALIFIED' AND EXCLUDED.current_tier='A' AND market.pool_discovery_registry.current_state='ACTIVE_CANDIDATE' THEN market.pool_discovery_registry.current_state ELSE EXCLUDED.current_state END,current_tier=CASE WHEN EXCLUDED.current_state='PREFILTERED' AND market.pool_discovery_registry.current_state IN ('ACTIVE_CANDIDATE','WATCHLIST','QUALIFIED') AND COALESCE(EXCLUDED.payload->>'deepScreened','false')<>'true' THEN market.pool_discovery_registry.current_tier WHEN EXCLUDED.current_state='QUALIFIED' AND EXCLUDED.current_tier='A' AND market.pool_discovery_registry.current_state='ACTIVE_CANDIDATE' THEN market.pool_discovery_registry.current_tier ELSE EXCLUDED.current_tier END,last_priority_score=EXCLUDED.last_priority_score,last_rank=EXCLUDED.last_rank,last_universe_percentile=EXCLUDED.last_universe_percentile,reason_codes=EXCLUDED.reason_codes,evidence_state=EXCLUDED.evidence_state,payload=market.pool_discovery_registry.payload || EXCLUDED.payload`,
        [v.poolAddress,v.observedAt,v.sourceManual,v.sourceAuto,v.tokenXMint??null,v.tokenYMint??null,v.pairedTokenMint??null,v.pairedTokenSymbol??null,v.marketCapCohort,v.state,v.tier,v.priorityScore,v.rank??null,v.universePercentile??null,json(v.reasonCodes),json(v.evidenceState),json(v.payload)],
      );
    },
    async insertDiscoveryObservation(v) {
      const m=v.metrics;
      await db.query(
        `INSERT INTO market.pool_discovery_observations(pool_address,observed_at,policy_id,source,decision,priority_score,tvl_usd,volume_30m_usd,volume_1h_usd,volume_24h_usd,fees_30m_usd,fees_1h_usd,fees_24h_usd,fee_tvl_30m,fee_tvl_1h,fee_tvl_24h,market_cap_usd,liquidity_to_market_cap,volume_24h_to_market_cap,fees_24h_to_market_cap,holders,hard_reasons,warnings,selection_reasons,evidence_state,payload,active_tvl_usd,fee_total_tvl_ratio_30m_pct,fee_total_tvl_ratio_1h_pct,fee_total_tvl_ratio_24h_pct,fee_active_tvl_ratio_30m_pct,fee_active_tvl_ratio_1h_pct,fee_active_tvl_ratio_24h_pct,economic_priority,metric_source,metric_source_observed_at,metric_ingested_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,$24::jsonb,$25::jsonb,$26::jsonb,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36::timestamptz,$37::timestamptz) ON CONFLICT(pool_address,observed_at,policy_id) DO NOTHING`,
        [v.poolAddress,v.observedAt,v.policyId,v.source,v.decision,v.priorityScore,m.tvlUsd??null,m.volume30mUsd??null,m.volume1hUsd??null,m.volume24hUsd??null,m.fees30mUsd??null,m.fees1hUsd??null,m.fees24hUsd??null,m.feeTvl30m??null,m.feeTvl1h??null,m.feeTvl24h??null,m.marketCapUsd??null,m.liquidityToMarketCap??null,m.volume24hToMarketCap??null,m.fees24hToMarketCap??null,m.holders??null,json(v.hardReasons),json(v.warnings),json(v.selectionReasons),json(v.evidenceState),json(v.payload),m.activeTvlUsd??null,m.feeTotalTvlRatio30mPct??null,m.feeTotalTvlRatio1hPct??null,m.feeTotalTvlRatio24hPct??null,m.feeActiveTvlRatio30mPct??null,m.feeActiveTvlRatio1hPct??null,m.feeActiveTvlRatio24hPct??null,m.economicPriority??null,m.metricSource??null,m.metricSourceObservedAt??null,m.metricIngestedAt??null],
      );
    },
    async insertDiscoveryRanking(v) {
      await db.query(
        `INSERT INTO market.pool_discovery_rankings(ranking_cycle_id,pool_address,observed_at,policy_id,rank,universe_percentile,fee_percentile,volume_percentile,liquidity_percentile,priority_score,state,tier,reason_codes,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb) ON CONFLICT(ranking_cycle_id,pool_address) DO UPDATE SET rank=EXCLUDED.rank,universe_percentile=EXCLUDED.universe_percentile,fee_percentile=EXCLUDED.fee_percentile,volume_percentile=EXCLUDED.volume_percentile,liquidity_percentile=EXCLUDED.liquidity_percentile,priority_score=EXCLUDED.priority_score,state=EXCLUDED.state,tier=EXCLUDED.tier,reason_codes=EXCLUDED.reason_codes,payload=EXCLUDED.payload`,
        [v.rankingCycleId,v.poolAddress,v.observedAt,v.policyId,v.rank,v.universePercentile,v.feePercentile??null,v.volumePercentile??null,v.liquidityPercentile??null,v.priorityScore,v.state,v.tier,json(v.reasonCodes),json(v.payload)],
      );
    },
    async listDiscoveryCandidates(tiers=['A']) {
      const r=await db.query(`SELECT pool_address,current_state,current_tier,last_priority_score,last_rank,last_seen_at,token_x_mint,token_y_mint,paired_token_mint,last_seen_at AS admission_seen_at,payload FROM market.pool_discovery_registry WHERE current_tier=ANY($1::text[]) ORDER BY last_rank NULLS LAST,last_priority_score DESC,pool_address`,[tiers]);
      return r.rows.map(row=>({poolAddress:String(row.pool_address),state:String(row.current_state),tier:String(row.current_tier),priorityScore:Number(row.last_priority_score),...(row.last_rank!==null?{rank:Number(row.last_rank)}:{}),lastSeenAt:new Date(String(row.admission_seen_at)).toISOString(),...(row.token_x_mint?{tokenXMint:String(row.token_x_mint)}:{}),...(row.token_y_mint?{tokenYMint:String(row.token_y_mint)}:{}),...(row.paired_token_mint?{pairedTokenMint:String(row.paired_token_mint)}:{}),payload:(row.payload??{}) as Record<string,unknown>}));
    },
    async reconcileLiveEvidenceAdmission(v) {
      const capacity=Math.max(0,Math.floor(v.serviceableCapacity)),monitored=[...new Set((v.productionMonitoredPoolAddresses??[]).map(x=>x.trim()).filter(Boolean))],tx=db;
      try {
        await tx.query('BEGIN');
        await tx.query("SELECT pg_advisory_xact_lock(hashtext('LPFORGE_LIVE_EVIDENCE_ADMISSION'))");
        // A tracked pool can be temporarily re-admitted into an economic slot.
        // If that slot is later released/demoted before the bounded replay TTL,
        // restore the existing continuity tracker rather than orphaning it in
        // CONSUMED_BY_ACTIVE_ECONOMIC_LEASE.
        await tx.query(`UPDATE market.pool_discovery_registry
          SET payload=payload||jsonb_build_object('evidenceContinuityTrackingState','TRACKING','evidenceContinuityTrackingResumedAt',$1::text)
          WHERE current_state='QUALIFIED' AND source_auto=true
            AND payload->>'evidenceContinuityTrackingState'='CONSUMED_BY_ACTIVE_ECONOMIC_LEASE'
            AND COALESCE(NULLIF(payload->>'evidenceContinuityTrackingExpiresAt','')::timestamptz,'epoch'::timestamptz)>$1::timestamptz`,[v.observedAt]);
        const rows=await tx.query(`SELECT registry.pool_address,registry.current_state,registry.last_priority_score,registry.last_rank,registry.first_seen_at,registry.payload,maturity.state AS maturity_state,maturity.payload->>'historicalMaturity' AS historical_maturity,maturity.payload->>'liveConfirmation' AS live_confirmation,cycle.phase3_status,economic.as_of AS event_path_as_of,economic.fee_rate_per_capital_hour,economic.uncertainty AS event_path_uncertainty,prediction.observed_at AS forecast_as_of,(prediction.prediction#>>'{deep,toxicity,adverseInventoryPressure}') AS adverse_inventory_pressure,(prediction.prediction#>>'{strategy,strategies,0,uncertainty}') AS forecast_uncertainty,deep.current_opportunity_score,deep.pool_quality_score,deep.toxicity_probability,deep.observed_at AS deep_observed_at FROM market.pool_discovery_registry registry LEFT JOIN market.active_candidate_history_maturity maturity ON maturity.pool_address=registry.pool_address LEFT JOIN LATERAL (SELECT phase3_status FROM operations.forward_cycles WHERE pool_address=registry.pool_address ORDER BY observed_at DESC LIMIT 1) cycle ON true LEFT JOIN LATERAL (SELECT as_of,fee_rate_per_capital_hour,uncertainty FROM research.economic_estimates WHERE pool_address=registry.pool_address AND fidelity='EVENT_PATH_ESTIMATE' AND as_of<=$2::timestamptz ORDER BY as_of DESC LIMIT 1) economic ON true LEFT JOIN LATERAL (SELECT observed_at,prediction FROM research.discovery_predictions WHERE pool_address=registry.pool_address AND observed_at<=$2::timestamptz ORDER BY observed_at DESC LIMIT 1) prediction ON true LEFT JOIN LATERAL (SELECT observed_at,current_opportunity_score,pool_quality_score,toxicity_probability FROM research.pool_deep_screen_observations WHERE pool_address=registry.pool_address AND observed_at<=$2::timestamptz ORDER BY observed_at DESC LIMIT 1) deep ON true WHERE registry.current_tier='A' AND registry.current_state IN ('ACTIVE_CANDIDATE','QUALIFIED') AND NOT(registry.pool_address=ANY($1::text[])) FOR UPDATE OF registry`,[monitored,v.observedAt]);
        const targets=rows.rows.map(row=>{
          const payload=(row.payload??{}) as Record<string,unknown>,metrics=(payload.discoveryMetrics??{}) as Record<string,unknown>,leaseStartedAt=typeof payload.liveEvidenceLeaseStartedAt==='string'?payload.liveEvidenceLeaseStartedAt:typeof payload.liveEvidenceAdmissionAt==='string'?payload.liveEvidenceAdmissionAt:undefined,leaseExpiresAt=typeof payload.liveEvidenceLeaseExpiresAt==='string'?payload.liveEvidenceLeaseExpiresAt:undefined,leaseFailureCount=Number(payload.liveEvidenceLeaseFailures??0),nextEligibleAt=typeof payload.liveEvidenceLeaseNextEligibleAt==='string'?payload.liveEvidenceLeaseNextEligibleAt:undefined,eventPathEstimateFresh=Boolean(row.event_path_as_of)&&Date.parse(v.observedAt)-Date.parse(String(row.event_path_as_of))<=LIVE_EVIDENCE_ECONOMIC_RANKING_FRESHNESS_SECONDS*1000,phase3Status=String(row.phase3_status??''),leaseActive=isLiveEvidenceLeaseActive({startedAt:leaseStartedAt,expiresAt:leaseExpiresAt,failureCount:leaseFailureCount},v.observedAt),pending=isPhase3ReadyConsumptionPending(payload,v.observedAt),releaseReason=liveEvidenceLeaseReleaseReason({state:String(row.current_state),startedAt:leaseStartedAt,expiresAt:leaseExpiresAt,failureCount:leaseFailureCount,eventPathEstimateFresh,phase3Status},v.observedAt),economicQuality=freshLiveEvidenceEconomicQuality(row.event_path_as_of?{eventPathAsOf:new Date(String(row.event_path_as_of)).toISOString(),forecastAsOf:new Date(String(row.forecast_as_of??row.event_path_as_of)).toISOString(),feeRatePerCapitalHour:Number(row.fee_rate_per_capital_hour),...(Number.isFinite(Number(row.adverse_inventory_pressure))?{adverseInventoryPressure:Number(row.adverse_inventory_pressure)}:{}),forecastUncertainty:Number(row.forecast_uncertainty??row.event_path_uncertainty)}:undefined,v.observedAt),metricObservedAt=typeof metrics.sourceObservedAt==='string'?metrics.sourceObservedAt:typeof metrics.ingestedAt==='string'?metrics.ingestedAt:undefined,discoveryPriority=freshDiscoveryEconomicPriority({priority:Number(payload.discoveryEconomicPriority),observedAt:metricObservedAt},v.observedAt),deepOpportunity=Number(row.current_opportunity_score),deepQuality=Number(row.pool_quality_score),toxicity=Number(row.toxicity_probability),waitSince=typeof payload.liveEvidenceWaitingAt==='string'?payload.liveEvidenceWaitingAt:new Date(String(row.first_seen_at)).toISOString(),waitingMinutes=Math.max(0,(Date.parse(v.observedAt)-Date.parse(waitSince))/60_000),feeRatios=[Number(metrics.feeActiveTvlRatio30mPct),Number(metrics.feeActiveTvlRatio1hPct),Number(metrics.feeActiveTvlRatio24hPct)],feePersistence=feeRatios.every(Number.isFinite)?Math.max(0,Math.min(1,Math.min(...feeRatios)/Math.max(...feeRatios,1e-12))):0,evidencePriority=Math.round((.48*(discoveryPriority??0)+.20*(Number.isFinite(deepOpportunity)?deepOpportunity:0)+.10*(Number.isFinite(deepQuality)?deepQuality:0)+.10*(Number.isFinite(toxicity)?(1-Math.max(0,Math.min(1,toxicity)))*100:0)+.07*feePersistence*100+.05*Math.min(100,waitingMinutes/30*100))*100)/100,cooling=nextEligibleAt!==undefined&&Date.parse(nextEligibleAt)>Date.parse(v.observedAt),matureForPhase3=String(row.maturity_state??'')==='MATURE'&&String(row.historical_maturity??'')==='MATURE'&&String(row.live_confirmation??'')==='CONFIRMED',activeDwellMs=leaseStartedAt?Math.max(0,Date.parse(v.observedAt)-Date.parse(leaseStartedAt)):0;
          const continuityActive=payload.evidenceContinuityTrackingState==='TRACKING';
          const target:LiveEvidenceAdmissionCandidate={poolAddress:String(row.pool_address),state:String(row.current_state),priorityScore:Number(row.last_priority_score??0),firstSeenAt:new Date(String(row.first_seen_at)).toISOString(),matureForPhase3,phase3Terminal:isLiveEvidenceAdmissionTerminalForCurrentLease({state:String(row.current_state),phase3Status})||releaseReason!==undefined,evidenceLeaseActive:String(row.current_state)==='ACTIVE_CANDIDATE'&&leaseActive&&!releaseReason,phase3ConsumptionPending:String(row.current_state)==='ACTIVE_CANDIDATE'&&leaseActive&&!releaseReason&&pending,...(pending?{phase3ReadyAt:String(payload.liveEvidencePhase3ReadyAt)}:{}),admissionEligible:!cooling&&!releaseReason&&(String(row.current_state)==='ACTIVE_CANDIDATE'||discoveryPriority!==undefined),evidencePriority,activeDwellMs,waitingMinutes,protectedCriticalConsumption:pending||continuityActive,...(row.last_rank===null?{}:{rank:Number(row.last_rank)}),...(discoveryPriority===undefined?{}:{economicPriority:discoveryPriority}),...(metricObservedAt===undefined?{}:{economicPriorityObservedAt:metricObservedAt}),...(economicQuality?{economicQuality}:{}),...(releaseReason===undefined?{}:{releaseReason})};
          return target;
        }),available=dynamicLiveEvidenceAdmissionCapacity({serviceableCapacity:capacity,staticPolicyPoolCount:monitored.length}),admitted=selectLiveEvidenceAdmissionCandidates(targets,available),admittedSet=new Set(admitted.map(x=>x.poolAddress)),promoted=admitted.filter(x=>x.state==='QUALIFIED'),demoted=targets.filter(x=>x.state==='ACTIVE_CANDIDATE'&&!admittedSet.has(x.poolAddress));
        const replacementPairs=demoted.sort((a,b)=>liveEvidenceAdmissionPriority(a)-liveEvidenceAdmissionPriority(b)||a.poolAddress.localeCompare(b.poolAddress)).flatMap((incumbent,index)=>{
          const challenger=promoted.sort((a,b)=>liveEvidenceAdmissionPriority(b)-liveEvidenceAdmissionPriority(a)||a.poolAddress.localeCompare(b.poolAddress))[index];
          return challenger&&liveEvidenceAdmissionPriority(challenger)>=liveEvidenceAdmissionPriority(incumbent)+LIVE_EVIDENCE_REPLACEMENT_MARGIN?[{incumbent,challenger}]:[];
        });
        for(const pair of replacementPairs)await tx.query(`INSERT INTO market.active_candidate_evidence_replacements(observed_at,incumbent_pool_address,challenger_pool_address,reason_code,incumbent_priority,challenger_priority,priority_delta,incumbent_dwell_ms,challenger_metric_observed_at,payload) VALUES($1,$2,$3,'ACTIVE_REPLACED_BY_HIGHER_ECONOMIC_PRIORITY',$4,$5,$6,$7,$8::timestamptz,$9::jsonb) ON CONFLICT(observed_at,incumbent_pool_address,challenger_pool_address) DO NOTHING`,[v.observedAt,pair.incumbent.poolAddress,pair.challenger.poolAddress,Number(pair.incumbent.evidencePriority),Number(pair.challenger.evidencePriority),Number(pair.challenger.evidencePriority)-Number(pair.incumbent.evidencePriority),Math.round(pair.incumbent.activeDwellMs??0),pair.challenger.economicPriorityObservedAt??null,json({incumbentPriority:pair.incumbent.evidencePriority,challengerPriority:pair.challenger.evidencePriority,minimumDwellMs:LIVE_EVIDENCE_MIN_ACTIVE_DWELL_MS,replacementMargin:LIVE_EVIDENCE_REPLACEMENT_MARGIN,authority:'DISCOVERY_OBSERVATION_ONLY'})]);
        const replacementByIncumbent=new Map(replacementPairs.map(pair=>[pair.incumbent.poolAddress,pair]));
        for(const incumbent of demoted){
          const replacement=replacementByIncumbent.get(incumbent.poolAddress),releaseReason=replacement?'ACTIVE_REPLACED_BY_HIGHER_ECONOMIC_PRIORITY':incumbent.releaseReason??'LIVE_EVIDENCE_WAITING_FOR_CAPACITY';
          await tx.query(`UPDATE market.pool_discovery_registry SET current_state='QUALIFIED',reason_codes=(reason_codes - 'LIVE_EVIDENCE_ADMITTED') || jsonb_build_array('LIVE_EVIDENCE_WAITING_FOR_CAPACITY',$3::text),payload=(payload||jsonb_build_object('liveEvidenceAdmission','WAITING','liveEvidenceWaitingAt',$2::text,'liveEvidenceLeaseReleasedAt',$2::text,'liveEvidenceLeaseReleaseReason',$3::text,'liveEvidenceLeaseNextEligibleAt',to_char(($2::timestamptz + interval '15 minutes'),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))||CASE WHEN payload->>'evidenceContinuityTrackingState'='CONSUMED_BY_ACTIVE_ECONOMIC_LEASE' AND COALESCE(NULLIF(payload->>'evidenceContinuityTrackingExpiresAt','')::timestamptz,'epoch'::timestamptz)>$2::timestamptz THEN jsonb_build_object('evidenceContinuityTrackingState','TRACKING','evidenceContinuityTrackingResumedAt',$2::text) ELSE '{}'::jsonb END WHERE pool_address=$1`,[incumbent.poolAddress,v.observedAt,releaseReason]);
        }
        // Admission itself starts the bounded evidence lease.  Leaving the
        // start/expiry unset lets a later reconciliation treat a newly
        // promoted pool as an expired lease before it gets its first read.
        const promotedLeaseExpiresAt=liveEvidenceLeaseExpiresAt(v.observedAt)??v.observedAt;
        if(promoted.length)await tx.query(`UPDATE market.pool_discovery_registry SET payload=payload-ARRAY['evidenceContinuityEpisodeAnchorAt','evidenceContinuityLastObservationAt','evidenceContinuityDeadlineAt','evidenceContinuityTrackingStartedAt','evidenceContinuityTrackingExpiresAt']::text[] WHERE pool_address=ANY($1::text[])`,[promoted.map(x=>x.poolAddress)]);
        if(promoted.length)await tx.query(`UPDATE market.pool_discovery_registry SET current_state='ACTIVE_CANDIDATE',reason_codes=(reason_codes - 'LIVE_EVIDENCE_WAITING_FOR_CAPACITY') || '["LIVE_EVIDENCE_ADMITTED"]'::jsonb,payload=payload||jsonb_build_object('liveEvidenceAdmission','ADMITTED','liveEvidenceAdmissionAt',$2::text,'liveEvidenceLeaseStartedAt',$2::text,'liveEvidenceLeaseExpiresAt',$3::text,'liveEvidenceLeaseFailures',0,'liveEvidencePhase3ConsumptionState','NONE','liveEvidencePhase3ReadyAt',NULL,'liveEvidencePhase3ReadyEventPathAt',NULL,'postEvidenceEvaluationState','NONE','evidenceContinuityTrackingState','CONSUMED_BY_ACTIVE_ECONOMIC_LEASE','evidenceContinuityTrackingConsumedAt',$2::text) WHERE pool_address=ANY($1::text[])`,[promoted.map(x=>x.poolAddress),v.observedAt,promotedLeaseExpiresAt]);
        const waitingCandidates=targets.filter(candidate=>!admittedSet.has(candidate.poolAddress));
        // jsonb_build_object is polymorphic: explicitly type the priority so PostgreSQL
        // never treats this prepared-statement parameter as an unknown value.
        for(const waiting of waitingCandidates)await tx.query(`UPDATE market.pool_discovery_registry SET payload=payload||jsonb_build_object('liveEvidenceWaitingAt',COALESCE(payload->>'liveEvidenceWaitingAt',$2::text),'liveEvidenceTimesSkipped',COALESCE((payload->>'liveEvidenceTimesSkipped')::int,0)+1,'liveEvidenceLastPriority',$3::numeric) WHERE pool_address=$1`,[waiting.poolAddress,v.observedAt,Number(waiting.evidencePriority??waiting.priorityScore)]);
        const priorities=(rows:readonly LiveEvidenceAdmissionCandidate[])=>rows.map(liveEvidenceAdmissionPriority).filter(Number.isFinite).sort((a,b)=>a-b),activePriorities=priorities(admitted),waitingPriorities=priorities(waitingCandidates),waitingMinutes=waitingCandidates.map(candidate=>Number(candidate.waitingMinutes)).filter(Number.isFinite).sort((a,b)=>a-b),median=(values:readonly number[])=>values.length?values[Math.floor((values.length-1)/2)]!:null,utilization=available>0?Math.min(1,admitted.length/available):0;
        await tx.query(`INSERT INTO market.active_candidate_evidence_capacity_observations(observed_at,serviceable_capacity,production_monitored_count,dynamic_capacity,active_count,qualified_waiting_count,candidate_slot_utilization,replacement_count,active_priority_min,active_priority_max,waiting_priority_min,waiting_priority_max,waiting_minutes_p50,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) ON CONFLICT(observed_at) DO UPDATE SET serviceable_capacity=EXCLUDED.serviceable_capacity,production_monitored_count=EXCLUDED.production_monitored_count,dynamic_capacity=EXCLUDED.dynamic_capacity,active_count=EXCLUDED.active_count,qualified_waiting_count=EXCLUDED.qualified_waiting_count,candidate_slot_utilization=EXCLUDED.candidate_slot_utilization,replacement_count=EXCLUDED.replacement_count,active_priority_min=EXCLUDED.active_priority_min,active_priority_max=EXCLUDED.active_priority_max,waiting_priority_min=EXCLUDED.waiting_priority_min,waiting_priority_max=EXCLUDED.waiting_priority_max,waiting_minutes_p50=EXCLUDED.waiting_minutes_p50,payload=EXCLUDED.payload`,[v.observedAt,capacity,monitored.length,available,admitted.length,waitingCandidates.length,utilization,replacementPairs.length,activePriorities[0]??null,activePriorities.at(-1)??null,waitingPriorities[0]??null,waitingPriorities.at(-1)??null,median(waitingMinutes),json({authority:'DISCOVERY_OBSERVATION_ONLY',activePoolAddresses:admitted.map(candidate=>candidate.poolAddress),waitingPoolAddresses:waitingCandidates.map(candidate=>candidate.poolAddress),replacementPairs:replacementPairs.map(pair=>({incumbent:pair.incumbent.poolAddress,challenger:pair.challenger.poolAddress,priorityDelta:liveEvidenceAdmissionPriority(pair.challenger)-liveEvidenceAdmissionPriority(pair.incumbent)}),),priorityFreshnessMs:LIVE_EVIDENCE_DISCOVERY_PRIORITY_FRESHNESS_MS})]);
        await tx.query('COMMIT');
        return{serviceableCapacity:capacity,productionMonitoredCount:monitored.length,activeCount:admitted.length,qualifiedWaitingCount:targets.length-admitted.length,promotedPoolAddresses:promoted.map(x=>x.poolAddress),demotedPoolAddresses:demoted.map(x=>x.poolAddress),replacements:replacementPairs.map(pair=>({incumbentPoolAddress:pair.incumbent.poolAddress,challengerPoolAddress:pair.challenger.poolAddress,priorityDelta:Number(pair.challenger.evidencePriority)-Number(pair.incumbent.evidencePriority)}))};
      } catch(error) {try{await tx.query('ROLLBACK');}catch{} throw error;}
    },
    async reconcileEvidenceContinuityTracking(v) {
      const capacity=Math.max(0,Math.floor(v.capacity)),tx=db;
      try {
        await tx.query('BEGIN');
        await tx.query("SELECT pg_advisory_xact_lock(hashtext('LPFORGE_LIVE_EVIDENCE_ADMISSION'))");
        // Confirmation is durable in the maturity record.  A continuity slot
        // protects only an incomplete episode, so it must be released without
        // waiting for later P3/P4 economic handling.
        await tx.query(`UPDATE market.pool_discovery_registry registry
          SET payload=(registry.payload-ARRAY['evidenceContinuityEpisodeAnchorAt','evidenceContinuityLastObservationAt','evidenceContinuityDeadlineAt','evidenceContinuityTrackingStartedAt','evidenceContinuityTrackingExpiresAt']::text[])||jsonb_build_object('evidenceContinuityTrackingState','COMPLETED','evidenceContinuityReleasedAt',$1::text,'evidenceContinuityReleaseReason','LIVE_CONFIRMATION_CONFIRMED')
          FROM market.active_candidate_history_maturity maturity
          WHERE registry.pool_address=maturity.pool_address
            AND registry.payload->>'evidenceContinuityTrackingState'='TRACKING'
            AND maturity.payload->>'liveConfirmation'='CONFIRMED'`,[v.observedAt]);
        // Waiting is queue state, never an active protected episode.  Keep raw
        // observation history intact while removing stale active-episode facts.
        await tx.query(`UPDATE market.pool_discovery_registry
          SET payload=(payload-ARRAY['evidenceContinuityEpisodeAnchorAt','evidenceContinuityLastObservationAt','evidenceContinuityDeadlineAt','evidenceContinuityTrackingStartedAt','evidenceContinuityTrackingExpiresAt']::text[])||jsonb_build_object('evidenceContinuityTrackingState','WAITING_FOR_CONTINUITY_SLOT')
          WHERE payload->>'evidenceContinuityTrackingState'='WAITING_FOR_CONTINUITY_SLOT'`);
        const expired=await tx.query(`UPDATE market.pool_discovery_registry
          SET payload=payload||jsonb_build_object('evidenceContinuityTrackingState','EXPIRED','evidenceContinuityTrackingEvictedAt',$2::text,'evidenceContinuityTrackingEvictionReason','EVIDENCE_CONTINUITY_TTL_OR_ELIGIBILITY_EXPIRED')
          WHERE payload->>'evidenceContinuityTrackingState'='TRACKING'
            AND (COALESCE(NULLIF(payload->>'evidenceContinuityTrackingExpiresAt','')::timestamptz,'epoch'::timestamptz)<=$1::timestamptz OR current_state NOT IN ('QUALIFIED','ACTIVE_CANDIDATE') OR source_auto<>true)
          RETURNING pool_address`,[v.observedAt,v.observedAt]);
        const eligible=await tx.query(`SELECT registry.pool_address,registry.last_rank,
            registry.payload->>'evidenceContinuityTrackingStartedAt' AS tracking_started_at,
            latest.risk_adjusted_expected_net_ev AS candidate_utility,
            latest.confidence AS candidate_readiness
          FROM market.pool_discovery_registry registry
          LEFT JOIN LATERAL (
            SELECT risk_adjusted_expected_net_ev,confidence
            FROM execution.production_global_candidates
            WHERE pool_address=registry.pool_address AND observed_at<=$1::timestamptz
            ORDER BY observed_at DESC LIMIT 1
          ) latest ON true
          WHERE current_state IN ('QUALIFIED','ACTIVE_CANDIDATE') AND source_auto=true
            AND registry.payload->>'evidenceContinuityTrackingState'='TRACKING'
            AND COALESCE(NULLIF(registry.payload->>'evidenceContinuityTrackingExpiresAt','')::timestamptz,'epoch'::timestamptz)>$1::timestamptz`,[v.observedAt]);
        const eligiblePoolAddresses=eligible.rows.map(row=>String(row.pool_address));
        const confirmationWindowMs=Math.max(1,Math.floor(v.liveConfirmationWindowMs??10*60_000)),confirmationMaximumGapMs=Math.max(1,Math.floor(v.liveConfirmationMaximumGapMs??450_000));
        const observations=eligiblePoolAddresses.length?await tx.query(`SELECT pool_address,observed_at FROM market.candidate_market_observations WHERE pool_address=ANY($1::text[]) AND source_type='LIVE_OBSERVED' AND observed_at>=$2::timestamptz AND observed_at<=$3::timestamptz ORDER BY pool_address,observed_at`,[eligiblePoolAddresses,new Date(Date.parse(v.observedAt)-confirmationWindowMs-confirmationMaximumGapMs).toISOString(),v.observedAt]):{rows:[] as Array<{pool_address:string;observed_at:Date|string}>};
        const observationTimes=new Map<string,string[]>();
        for(const row of observations.rows){const poolAddress=String(row.pool_address),times=observationTimes.get(poolAddress)??[];times.push(new Date(String(row.observed_at)).toISOString());observationTimes.set(poolAddress,times);}
        const prioritized=eligible.rows.map(row=>continuityMaturityPriority({
          poolAddress:String(row.pool_address),observedAt:v.observedAt,liveObservationTimes:observationTimes.get(String(row.pool_address))??[],
          ...(row.tracking_started_at?{trackingStartedAt:String(row.tracking_started_at)}:{}),
          ...(row.last_rank===null?{}:{tierARank:Number(row.last_rank)}),
          ...(row.candidate_utility===null?{}:{candidateUtility:Number(row.candidate_utility)}),
          ...(row.candidate_readiness===null?{}:{candidateReadiness:Number(row.candidate_readiness)}),
          confirmationWindowMs,...(v.liveConfirmationMinimumObservations===undefined?{}:{minimumObservations:v.liveConfirmationMinimumObservations}),maximumGapMs:confirmationMaximumGapMs,
        })).sort(compareContinuityMaturityPriority);
        const retained=prioritized.slice(0,capacity).map(row=>row.poolAddress),evicted=prioritized.slice(capacity).map(row=>row.poolAddress);
        if(evicted.length)await tx.query(`UPDATE market.pool_discovery_registry
          SET payload=payload||jsonb_build_object('evidenceContinuityTrackingState','EVICTED','evidenceContinuityTrackingEvictedAt',$2::text,'evidenceContinuityTrackingEvictionReason','EVIDENCE_CONTINUITY_CAPACITY_EVICTED')
          WHERE pool_address=ANY($1::text[]) AND payload->>'evidenceContinuityTrackingState'='TRACKING'`,[evicted,v.observedAt]);
        await tx.query('COMMIT');
        return{capacity,trackedPoolAddresses:retained,expiredPoolAddresses:expired.rows.map(row=>String(row.pool_address)),evictedPoolAddresses:evicted};
      } catch(error) {try{await tx.query('ROLLBACK');}catch{} throw error;}
    },
    async loadActiveCandidateEvidenceCollectorTiming() {
      const r=await db.query(`SELECT payload->'collectorPass' AS pass FROM market.active_candidate_evidence_capacity_observations WHERE payload ? 'collectorPass' ORDER BY observed_at DESC LIMIT 1`),pass=r.rows[0]?.pass as Record<string,unknown>|undefined,p95=Number(pass?.measuredP95PoolCollectionMs);
      return Number.isFinite(p95)&&p95>0?{p95PoolCollectionMs:p95}:undefined;
    },
    async recordActiveCandidateEvidenceCollectorPass(v) {
      await db.query(`UPDATE market.active_candidate_evidence_capacity_observations SET payload=payload||jsonb_build_object('collectorPass',jsonb_build_object('startedAt',$2::text,'completedAt',$3::text,'elapsedMs',$4::numeric,'collectionSliceSize',$5::int,'effectivePoolCollectionMs',$6::numeric,'measuredP95PoolCollectionMs',$7::numeric,'projectedRevisitMs',$8::numeric,'capacityViolation',$9::boolean,'maxServiceGapMs',$10::numeric,'activePoolCount',$11::int,'successfulPoolCount',$12::int,'continuityPoolCount',$13::int,'economicProjectedRevisitMs',$14::numeric,'continuityProjectedRevisitMs',$15::numeric,'economicTargetViolation',$16::boolean)) WHERE observed_at=$1::timestamptz`,[v.observedAt,v.observedAt,v.completedAt,v.elapsedMs,v.collectionSliceSize,v.effectivePoolCollectionMs,v.measuredP95PoolCollectionMs,v.projectedRevisitMs,v.capacityViolation,v.maxServiceGapMs,v.activePoolCount,v.successfulPoolCount,Math.max(0,Math.floor(v.continuityPoolCount??0)),Math.max(0,Number(v.economicProjectedRevisitMs??v.projectedRevisitMs)),Math.max(0,Number(v.continuityProjectedRevisitMs??v.projectedRevisitMs)),Boolean(v.economicTargetViolation)]);
    },
    async recordLiveEvidenceCollectionOutcome(v) {
      const tx=db,now=Date.parse(v.observedAt),nextEligibleAt=new Date(now+ACTIVE_EVIDENCE_LEASE_RETRY_COOLDOWN_MS).toISOString();
      try {
        await tx.query('BEGIN');
        await tx.query("SELECT pg_advisory_xact_lock(hashtext('LPFORGE_LIVE_EVIDENCE_ADMISSION'))");
        const found=await tx.query(`SELECT current_state,payload FROM market.pool_discovery_registry WHERE pool_address=$1 FOR UPDATE`,[v.poolAddress]),row=found.rows[0];
        if(!row||row.current_state!=='ACTIVE_CANDIDATE'){await tx.query('COMMIT');return;}
        const payload=(row.payload??{}) as Record<string,unknown>,priorFailures=Math.max(0,Math.floor(Number(payload.liveEvidenceLeaseFailures??0)));
        if(v.success&&v.eventPathEstimate&&v.phase3CurrentLiveReady){const startedAt=typeof payload.liveEvidenceLeaseStartedAt==='string'&&Number.isFinite(Date.parse(payload.liveEvidenceLeaseStartedAt))?payload.liveEvidenceLeaseStartedAt:v.observedAt,expiresAt=typeof payload.liveEvidenceLeaseExpiresAt==='string'&&Number.isFinite(Date.parse(payload.liveEvidenceLeaseExpiresAt))?payload.liveEvidenceLeaseExpiresAt:liveEvidenceLeaseExpiresAt(startedAt);await tx.query(`UPDATE market.pool_discovery_registry SET reason_codes=(reason_codes-'LIVE_EVIDENCE_LEASE_PHASE3_READY')||'["LIVE_EVIDENCE_PHASE3_CONSUMPTION_PENDING"]'::jsonb,payload=payload||jsonb_build_object('liveEvidenceAdmission','ADMITTED','liveEvidenceLeaseStartedAt',$2::text,'liveEvidenceLeaseExpiresAt',$3::text,'liveEvidenceLeaseFailures',0,'liveEvidenceLastSuccessfulAt',$4::text,'liveEvidencePhase3ConsumptionState','PENDING','liveEvidencePhase3ReadyAt',COALESCE(NULLIF(payload->>'liveEvidencePhase3ReadyAt',''),$4::text),'liveEvidencePhase3ReadyEventPathAt',$4::text,'postEvidenceEvaluationState','PENDING_ACTIVE') WHERE pool_address=$1`,[v.poolAddress,startedAt,expiresAt??v.observedAt,v.observedAt]);}
        else if(v.success){const startedAt=typeof payload.liveEvidenceLeaseStartedAt==='string'&&Number.isFinite(Date.parse(payload.liveEvidenceLeaseStartedAt))?payload.liveEvidenceLeaseStartedAt:v.observedAt,expiresAt=typeof payload.liveEvidenceLeaseExpiresAt==='string'&&Number.isFinite(Date.parse(payload.liveEvidenceLeaseExpiresAt))?payload.liveEvidenceLeaseExpiresAt:liveEvidenceLeaseExpiresAt(startedAt);await tx.query(`UPDATE market.pool_discovery_registry SET payload=payload||jsonb_build_object('liveEvidenceAdmission','ADMITTED','liveEvidenceLeaseStartedAt',$2::text,'liveEvidenceLeaseExpiresAt',$3::text,'liveEvidenceLeaseFailures',0,'liveEvidenceLastSuccessfulAt',$4::text) WHERE pool_address=$1`,[v.poolAddress,startedAt,expiresAt??v.observedAt,v.observedAt]);}
        else {const failures=priorFailures+1;if(failures>=ACTIVE_EVIDENCE_LEASE_MAX_FAILURES)await tx.query(`UPDATE market.pool_discovery_registry SET current_state='QUALIFIED',reason_codes=(reason_codes-'LIVE_EVIDENCE_ADMITTED')||'["LIVE_EVIDENCE_LEASE_COLLECTION_FAILURE_LIMIT"]'::jsonb,payload=payload||jsonb_build_object('liveEvidenceAdmission','WAITING','liveEvidenceLeaseReleaseReason','LIVE_EVIDENCE_LEASE_COLLECTION_FAILURE_LIMIT','liveEvidenceLeaseReleasedAt',$2::text,'liveEvidenceLeaseNextEligibleAt',$3::text,'liveEvidenceLeaseFailures',$4::int) WHERE pool_address=$1`,[v.poolAddress,v.observedAt,nextEligibleAt,failures]);else await tx.query(`UPDATE market.pool_discovery_registry SET payload=payload||jsonb_build_object('liveEvidenceLeaseFailures',$2::int,'liveEvidenceLastFailureAt',$3::text) WHERE pool_address=$1`,[v.poolAddress,failures,v.observedAt]);}
        if(v.success){const continuityStarted=await tx.query(`UPDATE market.pool_discovery_registry SET payload=payload||jsonb_build_object('liveEvidenceLastReadStartedAt',$2::text,'liveEvidenceLastReadCompletedAt',$3::text,'liveEvidenceLastReadElapsedMs',$4::numeric,'liveEvidenceLastServiceGapMs',$5::numeric,'evidenceContinuityTrackingState','TRACKING','evidenceContinuityTrackingStartedAt',COALESCE(payload->>'evidenceContinuityTrackingStartedAt',$2::text),'evidenceContinuityEpisodeAnchorAt',COALESCE(payload->>'evidenceContinuityEpisodeAnchorAt',$2::text),'evidenceContinuityLastObservationAt',$2::text,'evidenceContinuityDeadlineAt',to_char(($2::timestamptz + interval '450 seconds'),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'evidenceContinuityTrackingExpiresAt',COALESCE(payload->>'evidenceContinuityTrackingExpiresAt',to_char(($2::timestamptz + interval '60 minutes'),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) WHERE pool_address=$1 AND current_state='ACTIVE_CANDIDATE' AND (payload->>'evidenceContinuityTrackingState'='TRACKING' OR (SELECT COUNT(*) FROM market.pool_discovery_registry tracker WHERE tracker.payload->>'evidenceContinuityTrackingState'='TRACKING' AND tracker.current_state IN ('QUALIFIED','ACTIVE_CANDIDATE') AND tracker.source_auto=true AND COALESCE(NULLIF(tracker.payload->>'evidenceContinuityTrackingExpiresAt','')::timestamptz,'epoch'::timestamptz)>$2::timestamptz)<2) RETURNING pool_address`,[v.poolAddress,v.observedAt,v.poolReadCompletedAt??v.observedAt,Number(v.poolReadElapsedMs??0),Number(v.serviceGapMs??0)]);if(continuityStarted.rows.length===0)await tx.query(`UPDATE market.pool_discovery_registry SET payload=payload||jsonb_build_object('evidenceContinuityTrackingState','WAITING_FOR_CONTINUITY_SLOT','evidenceContinuityWaitingAt',COALESCE(payload->>'evidenceContinuityWaitingAt',$2::text)) WHERE pool_address=$1 AND current_state='ACTIVE_CANDIDATE'`,[v.poolAddress,v.observedAt]);}
        if(v.success)await tx.query(`UPDATE market.pool_discovery_registry SET payload=(payload-ARRAY['evidenceContinuityEpisodeAnchorAt','evidenceContinuityLastObservationAt','evidenceContinuityDeadlineAt','evidenceContinuityTrackingStartedAt','evidenceContinuityTrackingExpiresAt']::text[])||jsonb_build_object('evidenceContinuityTrackingState','WAITING_FOR_CONTINUITY_SLOT','evidenceContinuityWaitingAt',COALESCE(payload->>'evidenceContinuityWaitingAt',$2::text)) WHERE pool_address=$1 AND payload->>'evidenceContinuityTrackingState'='WAITING_FOR_CONTINUITY_SLOT'`,[v.poolAddress,v.observedAt]);
        await tx.query('COMMIT');
      } catch(error) {try{await tx.query('ROLLBACK');}catch{} throw error;}
    },
    async recordEvidenceContinuityCollectionOutcome(v) {
      const payload=v.success?{evidenceContinuityTrackingState:'TRACKING',evidenceContinuityLastSuccessfulAt:v.observedAt,evidenceContinuityLastObservationAt:v.observedAt,evidenceContinuityDeadlineAt:new Date(Date.parse(v.observedAt)+450_000).toISOString(),evidenceContinuityLastReadStartedAt:v.poolReadStartedAt??v.observedAt,evidenceContinuityLastReadCompletedAt:v.poolReadCompletedAt??v.observedAt,evidenceContinuityLastReadElapsedMs:Math.max(0,Number(v.poolReadElapsedMs??0)),...(v.serviceGapMs===undefined?{}:{evidenceContinuityLastServiceGapMs:Math.max(0,Number(v.serviceGapMs))})}:{evidenceContinuityTrackingState:'TRACKING',evidenceContinuityLastFailureAt:v.observedAt};
      await db.query(`UPDATE market.pool_discovery_registry SET payload=payload||$2::jsonb WHERE pool_address=$1 AND current_state='QUALIFIED' AND source_auto=true AND payload->>'evidenceContinuityTrackingState'='TRACKING'`,[v.poolAddress,json(payload)]);
    },
    async recordPostEvidenceEvaluationOutcome(v) {
      if(v.phase3Status!=='ENTRY_READY'&&v.phase3Status!=='NO_TRADE')return;
      const nextEligibleAt=new Date(Date.parse(v.observedAt)+ACTIVE_EVIDENCE_LEASE_RETRY_COOLDOWN_MS).toISOString(),clearReason='POST_EVIDENCE_PHASE3_'+v.phase3Status;
      // A ready ACTIVE lease is released only after a durable real economics
      // result. WARMING intentionally reaches neither update.
      const continuityPayload={evidenceContinuityTrackingState:'COMPLETED',evidenceContinuityReleasedAt:v.observedAt,evidenceContinuityReleaseReason:'LIVE_CONFIRMATION_DOWNSTREAM_TERMINAL',evidenceContinuityExecutionAuthority:false};
      await db.query(`UPDATE market.pool_discovery_registry SET current_state='QUALIFIED',reason_codes=(reason_codes-'LIVE_EVIDENCE_ADMITTED')||'[\"LIVE_EVIDENCE_LEASE_TERMINAL_PHASE3\"]'::jsonb,payload=(payload-ARRAY['evidenceContinuityEpisodeAnchorAt','evidenceContinuityLastObservationAt','evidenceContinuityDeadlineAt','evidenceContinuityTrackingStartedAt','evidenceContinuityTrackingExpiresAt']::text[])||jsonb_build_object('liveEvidenceAdmission','WAITING','liveEvidenceLeaseReleaseReason','LIVE_EVIDENCE_LEASE_TERMINAL_PHASE3','liveEvidenceLeaseReleasedAt',$2::text,'liveEvidenceLeaseNextEligibleAt',$3::text,'liveEvidencePhase3ConsumptionState','COMPLETED','liveEvidencePhase3ConsumedAt',$2::text,'postEvidenceEvaluationState','COMPLETED','postEvidenceEvaluationCompletedAt',$2::text,'postEvidenceEvaluationClearReason',$4::text)||$5::jsonb WHERE pool_address=$1 AND current_state='ACTIVE_CANDIDATE' AND source_auto=true AND payload->>'liveEvidencePhase3ConsumptionState'='PENDING'`,[v.poolAddress,v.observedAt,nextEligibleAt,clearReason,json(continuityPayload)]);
      // Preserve completion records for the bounded legacy QUALIFIED handoff.
      await db.query(`UPDATE market.pool_discovery_registry SET payload=payload||jsonb_build_object('postEvidenceEvaluationState','COMPLETED','postEvidenceEvaluationCompletedAt',$2::text,'postEvidenceEvaluationClearReason',$3::text) WHERE pool_address=$1 AND payload->>'postEvidenceEvaluationState'='ELIGIBLE' AND COALESCE(NULLIF(payload->>'postEvidenceEvaluationEligibleAt','')::timestamptz,'epoch'::timestamptz)<=$2::timestamptz`,[v.poolAddress,v.observedAt,clearReason]);
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
    async loadRecentDiscoveryPredictions(limit=5000){const r=await db.query(`SELECT * FROM research.discovery_predictions ORDER BY observed_at DESC LIMIT $1`,[Math.max(1,Math.min(1000,Math.floor(limit)))]);return r.rows as Array<Record<string,unknown>>;},
    async loadDueDiscoveryCounterfactualPredictions(now,limit){const r=await db.query(`SELECT p.* FROM research.discovery_predictions p WHERE EXISTS(SELECT 1 FROM (VALUES(30),(60),(120),(240),(360)) AS horizon(minutes) WHERE p.observed_at+(horizon.minutes||' minutes')::interval<=$1::timestamptz AND NOT EXISTS(SELECT 1 FROM research.discovery_outcomes o WHERE o.prediction_id=p.prediction_id AND o.horizon_minutes=horizon.minutes)) ORDER BY p.observed_at ASC,p.prediction_id ASC LIMIT $2`,[now,Math.max(1,Math.min(25,Math.floor(limit)))]);return r.rows as Array<Record<string,unknown>>;},
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
    async loadShadowRecommendationPayload(recommendationId) {
      const r=await db.query('SELECT payload FROM research.shadow_recommendations WHERE recommendation_id=$1',[recommendationId]);
      return r.rows[0]?.payload as Record<string,unknown>|undefined;
    },
    async insertProductionGlobalCandidate(v) {
      await db.query(`INSERT INTO execution.production_global_candidates(global_cycle_id,pool_address,operational_cycle_id,observed_at,operational_state,phase4_state,recommendation_id,thesis_id,candidate_id,strategy,orientation,lower_bin_id,upper_bin_id,active_bin_id,capital_value,horizon_minutes,predicted_gross_fees,predicted_inventory_pnl,predicted_net_ev,risk_adjusted_expected_net_ev,uncertainty,confidence,oor_risk,event_path_evidence_at,fee_evidence_at,volume_evidence_at,tvl,fee_tvl_1h,fee_tvl_24h,reason_codes,evidence,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,$31::jsonb,$32::jsonb) ON CONFLICT(global_cycle_id,pool_address) DO NOTHING`,[v.globalCycleId,v.poolAddress,v.operationalCycleId,v.observedAt,v.operationalState,v.phase4State,v.recommendationId??null,v.thesisId??null,v.candidateId??null,v.strategy??null,v.orientation??null,v.lowerBinId??null,v.upperBinId??null,v.activeBinId??null,v.capitalValue??null,v.horizonMinutes??null,v.predictedGrossFees??null,v.predictedInventoryPnl??null,v.predictedNetEv??null,v.riskAdjustedExpectedNetEv??null,v.uncertainty??null,v.confidence??null,v.oorRisk??null,v.eventPathEvidenceAt??null,v.feeEvidenceAt??null,v.volumeEvidenceAt??null,v.tvl??null,v.feeTvl1h??null,v.feeTvl24h??null,json(v.reasonCodes),json(v.evidence),json(v.payload)]);
    },
    async loadProductionGlobalCandidateFacts(globalCycleId,poolAddresses) {
      if(!poolAddresses.length)return [];
      const r=await db.query(`SELECT * FROM execution.production_global_candidates WHERE global_cycle_id=$1 AND pool_address=ANY($2::text[]) ORDER BY pool_address`,[globalCycleId,poolAddresses]);
      return r.rows as Array<Record<string,unknown>>;
    },
    async verifyProductionGlobalWinnerAdmission(v) {
      const r=await db.query(`SELECT candidate.selection_tier,candidate.selection_state,candidate.selection_dynamic_eligible
        FROM execution.production_global_selection_cycles cycle
        JOIN execution.production_global_pool_candidates candidate
          ON candidate.global_cycle_id=cycle.global_cycle_id
        WHERE cycle.global_cycle_id=$1
          AND cycle.outcome='GLOBAL_WINNER'
          AND cycle.coverage_state='COMPLETE'
          AND cycle.winner_pool_address=$2
          AND cycle.winner_candidate_id=$3
          AND candidate.pool_address=$2
          AND candidate.candidate_id=$3
          AND candidate.candidate_state='INCLUDED'
          AND candidate.phase3_state='ENTRY_READY'
          AND candidate.selection_tier='A'
          AND candidate.selection_dynamic_eligible=true
          AND (candidate.expires_at IS NULL OR candidate.expires_at>$4::timestamptz)
        LIMIT 1`,[v.globalCycleId,v.poolAddress,v.candidateId,v.now]);
      const row=r.rows[0];
      return row?{globalCycleId:v.globalCycleId,poolAddress:v.poolAddress,candidateId:v.candidateId,selectionTier:String(row.selection_tier),selectionState:String(row.selection_state),selectionDynamicEligible:Boolean(row.selection_dynamic_eligible)}:undefined;
    },
    async loadProductionPoolSettlementHistory(poolAddresses,decisionCutoff) {
      if(!poolAddresses.length)return [];
      const r=await db.query(`WITH latest AS (
        SELECT DISTINCT ON (lifecycle_id) lifecycle_id,settlement_version,realized_sol_pnl_lamports,settled_at
        FROM execution.lifecycle_sol_settlements ORDER BY lifecycle_id,settlement_version DESC
      ) SELECT l.lifecycle_id,l.pool_address,l.position_address,s.settled_at,s.realized_sol_pnl_lamports,
        o.initial_capital_lamports,re.close_reason,oor.direction AS oor_direction,oor.inventory_classification,
        COALESCE(re.gross_lp_fee_lamports,0) AS gross_fees,COALESCE(re.inventory_unwind_pnl_lamports,0) AS inventory_pnl
        FROM execution.position_lifecycles l
        JOIN latest s ON s.lifecycle_id=l.lifecycle_id
        LEFT JOIN execution.owned_positions o ON o.position_address=l.position_address
        LEFT JOIN execution.position_realized_economics re ON re.position_address=l.position_address
        LEFT JOIN execution.position_oor_lifecycle_state oor ON oor.position_address=l.position_address
        WHERE l.pool_address=ANY($1::text[]) AND s.settled_at<=$2::timestamptz
        ORDER BY l.pool_address,s.settled_at DESC,l.lifecycle_id DESC`,[poolAddresses,decisionCutoff]);
      return r.rows as Array<Record<string,unknown>>;
    },
    async insertProductionGlobalSelection(v) {
      await db.query('BEGIN');
      try{
        await db.query(`INSERT INTO execution.production_global_selection_cycles(global_cycle_id,policy_version,reentry_context_policy_version,decision_cutoff,started_at,completed_at,eligible_pool_count,evaluated_pool_count,candidate_pool_count,coverage_state,outcome,winner_pool_address,winner_candidate_id,runner_up_pool_address,ranking_metric,cross_pool_metrics_comparable,reason_codes,source_commit,build_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20::jsonb) ON CONFLICT(global_cycle_id) DO NOTHING`,[v.globalCycleId,v.policyVersion,v.reentryContextPolicyVersion,v.decisionCutoff,v.startedAt,v.completedAt,v.eligiblePoolCount,v.evaluatedPoolCount,v.candidatePoolCount,v.coverageState,v.outcome,v.winnerPoolAddress??null,v.winnerCandidateId??null,v.runnerUpPoolAddress??null,v.rankingMetric,v.crossPoolMetricsComparable,json(v.reasonCodes),v.sourceCommit??null,v.buildId??null,json(v.payload)]);
        for(const c of v.candidates)await db.query(`INSERT INTO execution.production_global_pool_candidates(global_cycle_id,pool_address,evaluation_order,candidate_rank,candidate_state,selection_tier,selection_state,selection_dynamic_eligible,recommendation_id,thesis_id,candidate_id,strategy,orientation,lower_bin_id,upper_bin_id,active_bin_id,risk_adjusted_expected_net_ev,predicted_fees,predicted_inventory_pnl,capital_value,horizon_minutes,decision_at,expires_at,phase3_state,phase4_state,reason_codes,history_context,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb,$27::jsonb,$28::jsonb) ON CONFLICT(global_cycle_id,pool_address) DO NOTHING`,[v.globalCycleId,c.poolAddress,c.evaluationOrder,c.candidateRank??null,c.candidateState,c.selectionTier??null,c.selectionState??null,c.selectionDynamicEligible??false,c.recommendationId??null,c.thesisId??null,c.candidateId??null,c.strategy??null,c.orientation??null,c.lowerBinId??null,c.upperBinId??null,c.activeBinId??null,c.riskAdjustedExpectedNetEv??null,c.predictedFees??null,c.predictedInventoryPnl??null,c.capitalValue??null,c.horizonMinutes??null,c.decisionAt??null,c.expiresAt??null,c.phase3State??null,c.phase4State??null,json(c.reasonCodes),json(c.historyContext),json(c.payload)]);
        await db.query('COMMIT');
      }catch(error){await db.query('ROLLBACK');throw error;}
    },
    async insertReset3cValidationUniverse(v) {
      const inserted=await db.query(
        `INSERT INTO research.reset3c_validation_universes(recommendation_id,decision_id,decision_at,sampling_contract_version,storage_contract_version,capital_lamports,expected_candidate_count,captured_candidate_count,universe_complete,universe_manifest_hash,detailed_candidate_count,outcome_eligible_candidate_count,expected_outcome_count,detailed_candidate_ids,selection_manifest,detailed_selection_manifest_hash,census,shared_evidence_hash,temporary_shared_evidence,content_hash,authority) VALUES($1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17::jsonb,$18,$19::jsonb,$20,'RESEARCH_ONLY_NO_POLICY_MUTATION') ON CONFLICT DO NOTHING RETURNING recommendation_id`,
        [v.recommendationId,v.decisionId,v.decisionAt,v.samplingContractVersion,v.storageContractVersion,v.capitalLamports,v.expectedCandidateCount,v.capturedCandidateCount,v.universeComplete,v.universeManifestHash,v.detailedCandidateCount,v.outcomeEligibleCandidateCount,v.outcomeEligibleCandidateCount*3,json([...new Set(v.detailedCandidateIds)].sort()),json(v.selectionManifest),v.detailedSelectionManifestHash,json(v.census),v.sharedEvidenceHash,json(v.temporarySharedEvidence),v.contentHash],
      );
      if(inserted.rows.length)return 'INSERTED';
      const existing=await db.query('SELECT content_hash FROM research.reset3c_validation_universes WHERE recommendation_id=$1',[v.recommendationId]);
      if(String(existing.rows[0]?.content_hash??'')===v.contentHash)return 'IDEMPOTENT';
      throw new Error('LPFORGE_RESET3C_VALIDATION_UNIVERSE_CONFLICT');
    },
    async loadReset3cValidationUniverse(recommendationId) {
      const r=await db.query('SELECT recommendation_id,decision_id,decision_at,sampling_contract_version,storage_contract_version,capital_lamports,expected_candidate_count,captured_candidate_count,universe_complete,universe_manifest_hash,detailed_candidate_count,outcome_eligible_candidate_count,expected_outcome_count,detailed_candidate_ids,selection_manifest,detailed_selection_manifest_hash,census,shared_evidence_hash,temporary_shared_evidence,lifecycle_state,terminal_eligible_at,purged_at,content_hash,created_at FROM research.reset3c_validation_universes WHERE recommendation_id=$1',[recommendationId]);
      return r.rows[0] as Record<string,unknown>|undefined;
    },
    async markTerminalEligibleReset3cValidationUniverses(now,limit) {
      const lim=Math.max(1,Math.min(50,Math.floor(limit)));
      // Eligibility must precede the bounded batch. Selecting the oldest ACTIVE
      // rows first lets PENDING/retry rows consume every maintenance slot and
      // starve later terminal universes of their safe raw-evidence purge.
      const r=await db.query(`WITH eligible AS (SELECT u.recommendation_id FROM research.reset3c_validation_universes u WHERE u.lifecycle_state='ACTIVE' AND u.universe_complete AND (SELECT COUNT(*) FROM research.variable_capital_evaluations e WHERE e.recommendation_id=u.recommendation_id AND e.evaluation_schema_version='reset3c-universe-v3-decision-relevant')=u.detailed_candidate_count AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(u.detailed_candidate_ids) AS required(candidate_id) WHERE NOT EXISTS(SELECT 1 FROM research.variable_capital_evaluations e WHERE e.recommendation_id=u.recommendation_id AND e.candidate_id=required.candidate_id AND e.evaluation_schema_version='reset3c-universe-v3-decision-relevant')) AND (SELECT COUNT(*) FROM research.candidate_counterfactual_forward_outcomes o JOIN research.variable_capital_evaluations e ON e.capital_evaluation_id=o.capital_evaluation_id WHERE e.recommendation_id=u.recommendation_id AND e.evaluation_schema_version='reset3c-universe-v3-decision-relevant')=u.expected_outcome_count AND NOT EXISTS(SELECT 1 FROM research.candidate_counterfactual_forward_outcomes o JOIN research.variable_capital_evaluations e ON e.capital_evaluation_id=o.capital_evaluation_id WHERE e.recommendation_id=u.recommendation_id AND e.evaluation_schema_version='reset3c-universe-v3-decision-relevant' AND (o.result_hash IS NULL OR NOT (o.state='FINAL' OR (o.state='INSUFFICIENT_EVIDENCE' AND o.terminal_at IS NOT NULL)))) ORDER BY u.created_at,u.recommendation_id LIMIT $2) UPDATE research.reset3c_validation_universes u SET lifecycle_state='TERMINAL_ELIGIBLE',terminal_eligible_at=$1::timestamptz FROM eligible e WHERE u.recommendation_id=e.recommendation_id RETURNING u.recommendation_id`,[now,lim]);
      return r.rows.length;
    },
    async purgeTerminalEligibleReset3cValidationEvidence(now,limit) {
      const lim=Math.max(1,Math.min(50,Math.floor(limit)));
      // Reverify terminal-outcome invariants immediately before the only
      // destructive lifecycle action. A stale TERMINAL_ELIGIBLE row cannot
      // block newer safe rows because the batch is bounded after revalidation.
      const r=await db.query(`WITH eligible AS (SELECT u.recommendation_id FROM research.reset3c_validation_universes u WHERE u.lifecycle_state='TERMINAL_ELIGIBLE' AND u.universe_complete AND u.temporary_shared_evidence IS NOT NULL AND (SELECT COUNT(*) FROM research.variable_capital_evaluations e WHERE e.recommendation_id=u.recommendation_id AND e.evaluation_schema_version='reset3c-universe-v3-decision-relevant')=u.detailed_candidate_count AND (SELECT COUNT(*) FROM research.candidate_counterfactual_forward_outcomes o JOIN research.variable_capital_evaluations e ON e.capital_evaluation_id=o.capital_evaluation_id WHERE e.recommendation_id=u.recommendation_id AND e.evaluation_schema_version='reset3c-universe-v3-decision-relevant')=u.expected_outcome_count AND NOT EXISTS(SELECT 1 FROM research.candidate_counterfactual_forward_outcomes o JOIN research.variable_capital_evaluations e ON e.capital_evaluation_id=o.capital_evaluation_id WHERE e.recommendation_id=u.recommendation_id AND e.evaluation_schema_version='reset3c-universe-v3-decision-relevant' AND (o.result_hash IS NULL OR NOT (o.state='FINAL' OR (o.state='INSUFFICIENT_EVIDENCE' AND o.terminal_at IS NOT NULL)))) ORDER BY u.terminal_eligible_at,u.recommendation_id LIMIT $2) UPDATE research.reset3c_validation_universes u SET lifecycle_state='PURGED',temporary_shared_evidence=NULL,purged_at=$1::timestamptz FROM eligible e WHERE u.recommendation_id=e.recommendation_id RETURNING u.recommendation_id`,[now,lim]);
      return r.rows.length;
    },
    async insertCandidateUniverseRerankRetention(v) {
      const r=await db.query(`INSERT INTO research.candidate_universe_rerank_retention(recommendation_id,decision_id,decision_at,pool_address,calibration_version,expected_candidate_count,persisted_candidate_count,universe_manifest_hash,candidate_facts,compact_summary,retention_until,content_hash) VALUES($1,$2,$3::timestamptz,$4,$5,$6,$6,$7,$8::jsonb,$9::jsonb,$10::timestamptz,$11) ON CONFLICT DO NOTHING RETURNING recommendation_id`,[v.recommendationId,v.decisionId,v.decisionAt,v.poolAddress,v.calibrationVersion,v.expectedCandidateCount,v.universeManifestHash,json(v.candidateFacts),json(v.compactSummary),v.retentionUntil,v.contentHash]);
      if(r.rows.length){
        for(const horizonMinutes of [30,60,120])await db.query(`INSERT INTO research.candidate_universe_forward_outcome_coverage(recommendation_id,horizon_minutes,outcome_model_version,expected_candidate_count,updated_at) VALUES($1,$2,'phase3-forward-outcome-v2',$3,now()) ON CONFLICT DO NOTHING`,[v.recommendationId,horizonMinutes,v.expectedCandidateCount]);
        return 'INSERTED';
      }
      const existing=await db.query('SELECT content_hash FROM research.candidate_universe_rerank_retention WHERE recommendation_id=$1',[v.recommendationId]);
      if(String(existing.rows[0]?.content_hash??'')===v.contentHash)return 'IDEMPOTENT';
      throw new Error('LPFORGE_CANDIDATE_UNIVERSE_RERANK_RETENTION_CONFLICT');
    },
    async compactEligibleCandidateUniverseRerankRetention(now,limit) {
      const lim=Math.max(1,Math.min(50,Math.floor(limit)));
      const r=await db.query(`WITH eligible AS (SELECT u.recommendation_id FROM research.candidate_universe_rerank_retention u WHERE u.lifecycle_state='ACTIVE' AND u.retention_until<=$1::timestamptz AND (SELECT COUNT(*) FROM research.phase3_forward_outcomes o WHERE o.recommendation_id=u.recommendation_id AND o.outcome_model_version='phase3-forward-outcome-v2' AND o.horizon_minutes IN (30,60,120))=3 AND NOT EXISTS(SELECT 1 FROM research.phase3_forward_outcomes o WHERE o.recommendation_id=u.recommendation_id AND o.outcome_model_version='phase3-forward-outcome-v2' AND o.horizon_minutes IN (30,60,120) AND NOT (o.state='FINAL' OR (o.state='INSUFFICIENT_EVIDENCE' AND o.terminal_at IS NOT NULL))) AND (SELECT COUNT(*) FROM research.candidate_universe_forward_outcome_coverage c WHERE c.recommendation_id=u.recommendation_id AND c.outcome_model_version='phase3-forward-outcome-v2' AND c.horizon_minutes IN (30,60,120) AND c.terminal_candidate_count=c.expected_candidate_count)=3 ORDER BY u.retention_until,u.recommendation_id LIMIT $2) UPDATE research.candidate_universe_rerank_retention u SET lifecycle_state='COMPACTED',candidate_facts=NULL,compacted_at=$1::timestamptz FROM eligible e WHERE u.recommendation_id=e.recommendation_id RETURNING u.recommendation_id`,[now,lim]);
      return r.rows.length;
    },
    async insertVariableCapitalEvaluation(v) {
      const storageVersion=String(v.rawContract.version??'');
      if(storageVersion!=='reset3c-universe-v1'&&storageVersion!=='reset3c-universe-v2-compact'&&storageVersion!=='reset3c-universe-v3-decision-relevant')throw new Error('LPFORGE_RESET3C_STORAGE_CONTRACT_INVALID');
      const inserted=await db.query(
        `INSERT INTO research.variable_capital_evaluations(capital_evaluation_id,recommendation_id,decision_id,candidate_id,namespace,evaluation_schema_version,proposed_capital_lamports,allocated_capital_lamports,candidate_capital_fraction_scaled,capital_contract_hash,position_contract_hash,capital_feasibility_status,binding_constraint,source_sha,build_id,policy_hash,migration_head,evidence_manifest_hash,provenance,raw_contract,content_hash,authority) VALUES($1,$2,$3,$4,'COUNTERFACTUAL_CANONICAL',$17::jsonb->>'version',$5,$6,1000000000000,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,'RESEARCH_ONLY_NO_POLICY_MUTATION') ON CONFLICT DO NOTHING RETURNING capital_evaluation_id`,
        [v.capitalEvaluationId,v.recommendationId,v.decisionId,v.candidateId,v.proposedCapitalLamports,v.allocatedCapitalLamports??null,v.capitalContractHash,v.positionContractHash??null,v.capitalFeasibilityStatus,v.bindingConstraint,v.sourceSha,v.buildId,v.policyHash,v.migrationHead,v.evidenceManifestHash??null,json(v.provenance),json(v.rawContract),v.contentHash],
      );
      if(inserted.rows.length){const outcomeEligible=storageVersion==='reset3c-universe-v3-decision-relevant'?v.rawContract.outcomeEligible===true:true;if(outcomeEligible)for(const horizonMinutes of [30,60,120])await db.query(`INSERT INTO research.candidate_counterfactual_forward_outcomes(capital_evaluation_id,horizon_minutes,outcome_model_version,namespace,state,payload,created_at) VALUES($1,$2,'phase3-forward-outcome-v2','COUNTERFACTUAL_CANONICAL','PENDING','{}'::jsonb,COALESCE($3::timestamptz,now())) ON CONFLICT DO NOTHING`,[v.capitalEvaluationId,horizonMinutes,v.outcomeCreatedAt??null]);return 'INSERTED';}
      const existing=await db.query('SELECT content_hash FROM research.variable_capital_evaluations WHERE capital_evaluation_id=$1',[v.capitalEvaluationId]);
      if(String(existing.rows[0]?.content_hash??'')===v.contentHash)return 'IDEMPOTENT';
      throw new Error('LPFORGE_VARIABLE_CAPITAL_EVIDENCE_CONFLICT');
    },
    async insertPhase3ForwardDecision(v) {
      await db.query('BEGIN');
      try {
        const inserted = await db.query(
          `INSERT INTO research.phase3_forward_decisions(recommendation_id,decision_id,pool_address,decision_at,source_sha,build_id,policy_hash,migration_head,capital_lamports,selected_candidate_kind,strategy,orientation,range_family,active_bin_id_at_decision,lower_bin_id,upper_bin_id,included_bin_count,candidate_weights,prediction,evidence_provenance,phase3_state,phase3_outcome,reason_codes,would_aug_era_thesis_semantics_have_created_thesis,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20::jsonb,$21,$22,$23::jsonb,$24,$25::jsonb) ON CONFLICT(recommendation_id) DO NOTHING RETURNING recommendation_id`,
          [v.recommendationId,v.decisionId,v.poolAddress,v.decisionAt,v.sourceSha,v.buildId,v.policyHash,v.migrationHead,v.capitalLamports,v.selectedCandidateKind,v.strategy??null,v.orientation??null,v.rangeFamily??null,v.activeBinIdAtDecision,v.lowerBinId??null,v.upperBinId??null,v.includedBinCount??null,json(v.candidateWeights),json(v.prediction),json(v.evidenceProvenance),v.phase3State,v.phase3Outcome,json(v.reasonCodes),v.wouldAugEraThesisSemanticsHaveCreatedThesis,json(v.payload)],
        );
        if (inserted.rows.length) {
          for (const horizonMinutes of [30,60,120]) await db.query(
            `INSERT INTO research.phase3_forward_outcomes(recommendation_id,horizon_minutes,outcome_model_version,state,payload) VALUES($1,$2,$3,'PENDING','{}'::jsonb) ON CONFLICT(recommendation_id,horizon_minutes,outcome_model_version) DO NOTHING`,
            [v.recommendationId,horizonMinutes,PHASE3_FORWARD_CURRENT_OUTCOME_MODEL_VERSION],
          );
        }
        await db.query('COMMIT');
        return inserted.rows.length>0;
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    },
    async ensurePhase3ForwardOutcome(v) {
      if (v.outcomeModelVersion !== PHASE3_FORWARD_CURRENT_OUTCOME_MODEL_VERSION) throw new Error('LPFORGE_FORWARD_OUTCOME_MODEL_RETIRED');
      const r=await db.query(`INSERT INTO research.phase3_forward_outcomes(recommendation_id,horizon_minutes,outcome_model_version,state,payload) VALUES($1,$2,$3,'PENDING','{}'::jsonb) ON CONFLICT(recommendation_id,horizon_minutes,outcome_model_version) DO NOTHING RETURNING recommendation_id`,[v.recommendationId,v.horizonMinutes,v.outcomeModelVersion]);
      return r.rows.length===1;
    },
    async loadDueCandidateCounterfactualOutcomes(now,limit,lane='ALL') {
      const lim=Math.max(1,Math.min(200,limit));
      const laneClause=lane==='FULL_UNIVERSE'
        ? "v.evaluation_schema_version='reset3c-universe-v3-decision-relevant' AND v.raw_contract->'detailedValidationReasons' ? 'FULL_UNIVERSE_RERANK_COVERAGE'"
        : lane==='V3'
        ? "v.evaluation_schema_version='reset3c-universe-v3-decision-relevant' AND NOT (v.raw_contract->'detailedValidationReasons' ? 'FULL_UNIVERSE_RERANK_COVERAGE')"
        : lane==='HISTORICAL'
          ? "v.evaluation_schema_version<>'reset3c-universe-v3-decision-relevant'"
          : 'TRUE',dueOrigin=lane==='FULL_UNIVERSE'?"COALESCE(NULLIF(v.raw_contract->'frozenDecision'->>'decisionTimestamp','')::timestamptz,NULLIF(v.raw_contract->>'evidenceCutoffAt','')::timestamptz,o.created_at)":'o.created_at';
      /* Ordinary candidate rows mature from their immutable write time.
       * Full-universe backfills mature from their frozen decision time, so a
       * late research write cannot delay an already-complete historical
       * window or change which evidence belongs to that window.
       * Keep the full raw contract outside the ranked CTE; historical V1/V2
       * contracts are toasted and must be resolved only for the selected
       * bounded rows, not tens of thousands of queue candidates. */
      const r=await db.query(`WITH due AS MATERIALIZED (
        SELECT o.capital_evaluation_id,o.horizon_minutes,o.outcome_model_version,o.state,o.retry_count,v.recommendation_id,o.created_at,
          CASE WHEN o.state='PENDING' THEN ${dueOrigin}+(o.horizon_minutes||' minutes')::interval ELSE o.next_retry_at END AS ready_at,
          ROW_NUMBER() OVER (PARTITION BY o.horizon_minutes ORDER BY CASE WHEN o.state='PENDING' THEN 0 ELSE 1 END,CASE WHEN o.state='PENDING' THEN ${dueOrigin}+(o.horizon_minutes||' minutes')::interval ELSE o.next_retry_at END,o.created_at,o.capital_evaluation_id) AS horizon_position
        FROM research.candidate_counterfactual_forward_outcomes o
        JOIN research.variable_capital_evaluations v ON v.capital_evaluation_id=o.capital_evaluation_id
        WHERE ${laneClause} AND o.state IN ('PENDING','INSUFFICIENT_EVIDENCE') AND (o.next_retry_at IS NULL OR o.next_retry_at<=$1::timestamptz) AND (${dueOrigin}+(o.horizon_minutes||' minutes')::interval)<=$1::timestamptz
      ), selected AS MATERIALIZED (
        SELECT capital_evaluation_id,horizon_minutes,outcome_model_version,state,retry_count,recommendation_id,horizon_position,ready_at
        FROM due ORDER BY horizon_position,ready_at,horizon_minutes,capital_evaluation_id LIMIT $2
      ) SELECT s.capital_evaluation_id,s.horizon_minutes,s.outcome_model_version,s.state,s.retry_count,s.recommendation_id,v.raw_contract FROM selected s JOIN research.variable_capital_evaluations v ON v.capital_evaluation_id=s.capital_evaluation_id ORDER BY s.horizon_position,s.ready_at,s.horizon_minutes,s.capital_evaluation_id`,[now,lim]);
      const v2RecommendationIds=[...new Set(r.rows.filter(row=>String(((row.raw_contract??{}) as Record<string,unknown>).version)==='reset3c-universe-v2-compact').map(row=>String(row.recommendation_id)))];
      const v3RecommendationIds=[...new Set(r.rows.filter(row=>String(((row.raw_contract??{}) as Record<string,unknown>).version)==='reset3c-universe-v3-decision-relevant').map(row=>String(row.recommendation_id)))];
      const v2PayloadByRecommendation=new Map<string,Record<string,unknown>>(),v3SharedByRecommendation=new Map<string,Record<string,unknown>>();
      if(v2RecommendationIds.length){const shared=await db.query(`SELECT recommendation_id,payload FROM research.shadow_recommendations WHERE recommendation_id=ANY($1::text[])`,[v2RecommendationIds]);for(const row of shared.rows)v2PayloadByRecommendation.set(String(row.recommendation_id),(row.payload??{}) as Record<string,unknown>);}
      if(v3RecommendationIds.length){const shared=await db.query(`SELECT recommendation_id,temporary_shared_evidence FROM research.reset3c_validation_universes WHERE recommendation_id=ANY($1::text[])`,[v3RecommendationIds]);for(const row of shared.rows)v3SharedByRecommendation.set(String(row.recommendation_id),(row.temporary_shared_evidence??{}) as Record<string,unknown>);}
      const resolvedV2=new Map<string,Record<string,unknown>|Error>(),resolvedV3=new Map<string,Record<string,unknown>|Error>();
      for(const row of r.rows){const source=(row.raw_contract??{}) as Record<string,unknown>,reference=(source.sharedEvidenceReference??{}) as Record<string,unknown>,recommendationId=typeof reference.recommendationId==='string'?reference.recommendationId:'',sharedEvidenceHash=typeof reference.sharedEvidenceHash==='string'?reference.sharedEvidenceHash:'',key=`${recommendationId}:${sharedEvidenceHash}`;
        if(source.version==='reset3c-universe-v2-compact'&&!resolvedV2.has(key))try{if(!recommendationId||!sharedEvidenceHash)throw new Error('LPFORGE_RESET3C_SHARED_EVIDENCE_REFERENCE_INVALID');const payload=v2PayloadByRecommendation.get(String(row.recommendation_id));if(!payload)throw new Error('LPFORGE_RESET3C_SHARED_EVIDENCE_REFERENCE_INVALID');resolvedV2.set(key,await resolveReset3cSharedEvidence({sharedEvidenceReference:{version:'shadow-recommendation-candidate-universe-v1',recommendationId,sharedEvidenceHash},shadowRecommendationPayload:payload}));}catch(error){resolvedV2.set(key,error instanceof Error?error:new Error(String(error)));}
        if(source.version==='reset3c-universe-v3-decision-relevant'&&!resolvedV3.has(key))try{if(!recommendationId||!sharedEvidenceHash)throw new Error('LPFORGE_RESET3C_VALIDATION_SHARED_EVIDENCE_REFERENCE_INVALID');const payload=v3SharedByRecommendation.get(String(row.recommendation_id));if(!payload||!Object.keys(payload).length)throw new Error('LPFORGE_RESET3C_VALIDATION_SHARED_EVIDENCE_PURGED');resolvedV3.set(key,await resolveReset3cValidationSharedEvidence({sharedEvidenceReference:{version:'reset3c-validation-universe-shared-evidence-v1',recommendationId,sharedEvidenceHash},temporarySharedEvidence:payload}));}catch(error){resolvedV3.set(key,error instanceof Error?error:new Error(String(error)));}
      }
      const values=[] as Array<{capitalEvaluationId:string;horizonMinutes:30|60|120;outcomeModelVersion:string;state:'PENDING'|'INSUFFICIENT_EVIDENCE'|'FINAL'|'FAILED_DATA_INTEGRITY';retryCount:number;rawContract:Record<string,unknown>}>;
      for(const row of r.rows){const source=(row.raw_contract??{}) as Record<string,unknown>,reference=(source.sharedEvidenceReference??{}) as Record<string,unknown>,key=`${typeof reference.recommendationId==='string'?reference.recommendationId:''}:${typeof reference.sharedEvidenceHash==='string'?reference.sharedEvidenceHash:''}`;let rawContract=source;
        if(source.version==='reset3c-universe-v2-compact'){const shared=resolvedV2.get(key);if(shared instanceof Error)rawContract={...source,reset3cReconstructionFailure:shared.message};else if(!shared)rawContract={...source,reset3cReconstructionFailure:'LPFORGE_RESET3C_SHARED_EVIDENCE_REFERENCE_INVALID'};else rawContract=reconstructReset3cRawContractFromResolvedShared(source,shared);}
        if(source.version==='reset3c-universe-v3-decision-relevant'){const shared=resolvedV3.get(key);if(shared instanceof Error)rawContract={...source,reset3cReconstructionFailure:shared.message};else if(!shared)rawContract={...source,reset3cReconstructionFailure:'LPFORGE_RESET3C_VALIDATION_SHARED_EVIDENCE_REFERENCE_INVALID'};else rawContract=reconstructReset3cRawContractFromResolvedShared(source,shared);}
        values.push({capitalEvaluationId:String(row.capital_evaluation_id),horizonMinutes:Number(row.horizon_minutes) as 30|60|120,outcomeModelVersion:String(row.outcome_model_version),state:String(row.state) as 'PENDING'|'INSUFFICIENT_EVIDENCE'|'FINAL'|'FAILED_DATA_INTEGRITY',retryCount:Number(row.retry_count),rawContract:{...rawContract,_queueRecommendationId:String(row.recommendation_id)}});
      }
      return values;
    },
    async loadFullUniverseOutcomeCoverageBackfill(limit) {
      const lim=Math.max(1,Math.min(8,Math.floor(limit)));
      const r=await db.query(`SELECT u.recommendation_id,u.decision_id,u.decision_at,u.pool_address,u.expected_candidate_count,u.candidate_facts,v.temporary_shared_evidence,COALESCE((SELECT array_agg(c.candidate_id ORDER BY c.candidate_id) FROM (SELECT candidate->>'id' AS candidate_id FROM jsonb_array_elements(u.candidate_facts->'candidates') candidate WHERE NOT EXISTS(SELECT 1 FROM research.variable_capital_evaluations e WHERE e.recommendation_id=u.recommendation_id AND e.candidate_id=candidate->>'id' AND e.evaluation_schema_version='reset3c-universe-v3-decision-relevant')) c),ARRAY[]::text[]) AS missing_candidate_ids FROM research.candidate_universe_rerank_retention u LEFT JOIN research.reset3c_validation_universes v ON v.recommendation_id=u.recommendation_id WHERE u.lifecycle_state='ACTIVE' AND u.candidate_facts IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(u.candidate_facts->'candidates') candidate WHERE NOT EXISTS(SELECT 1 FROM research.variable_capital_evaluations e WHERE e.recommendation_id=u.recommendation_id AND e.candidate_id=candidate->>'id' AND e.evaluation_schema_version='reset3c-universe-v3-decision-relevant')) ORDER BY u.decision_at,u.recommendation_id LIMIT $1`,[lim]);
      return r.rows.map(row=>({recommendationId:String(row.recommendation_id),decisionId:String(row.decision_id),decisionAt:new Date(String(row.decision_at)).toISOString(),poolAddress:String(row.pool_address),expectedCandidateCount:Number(row.expected_candidate_count),candidateFacts:(row.candidate_facts??{}) as Record<string,unknown>,...(row.temporary_shared_evidence?{temporarySharedEvidence:row.temporary_shared_evidence as Record<string,unknown>}:{}) ,missingCandidateIds:Array.isArray(row.missing_candidate_ids)?row.missing_candidate_ids.map(String):[]}));
    },
    async refreshCandidateUniverseForwardOutcomeCoverage(recommendationId,at) {
      for(const horizonMinutes of [30,60,120])await db.query(`INSERT INTO research.candidate_universe_forward_outcome_coverage(recommendation_id,horizon_minutes,outcome_model_version,expected_candidate_count,evaluated_candidate_count,terminal_candidate_count,valid_candidate_count,insufficient_candidate_count,invalid_candidate_count,updated_at) SELECT u.recommendation_id,$2,'phase3-forward-outcome-v2',u.expected_candidate_count,COUNT(DISTINCT e.candidate_id),COUNT(DISTINCT e.candidate_id) FILTER(WHERE o.state='FINAL' OR (o.state='INSUFFICIENT_EVIDENCE' AND o.terminal_at IS NOT NULL) OR o.state='FAILED_DATA_INTEGRITY'),COUNT(DISTINCT e.candidate_id) FILTER(WHERE o.state='FINAL'),COUNT(DISTINCT e.candidate_id) FILTER(WHERE o.state='INSUFFICIENT_EVIDENCE' AND o.terminal_at IS NOT NULL),COUNT(DISTINCT e.candidate_id) FILTER(WHERE o.state='FAILED_DATA_INTEGRITY'),$3::timestamptz FROM research.candidate_universe_rerank_retention u LEFT JOIN research.variable_capital_evaluations e ON e.recommendation_id=u.recommendation_id AND e.evaluation_schema_version='reset3c-universe-v3-decision-relevant' LEFT JOIN research.candidate_counterfactual_forward_outcomes o ON o.capital_evaluation_id=e.capital_evaluation_id AND o.horizon_minutes=$2 AND o.outcome_model_version='phase3-forward-outcome-v2' WHERE u.recommendation_id=$1 GROUP BY u.recommendation_id,u.expected_candidate_count ON CONFLICT(recommendation_id,horizon_minutes,outcome_model_version) DO UPDATE SET expected_candidate_count=EXCLUDED.expected_candidate_count,evaluated_candidate_count=EXCLUDED.evaluated_candidate_count,terminal_candidate_count=EXCLUDED.terminal_candidate_count,valid_candidate_count=EXCLUDED.valid_candidate_count,insufficient_candidate_count=EXCLUDED.insufficient_candidate_count,invalid_candidate_count=EXCLUDED.invalid_candidate_count,updated_at=EXCLUDED.updated_at`,[recommendationId,horizonMinutes,at]);
    },
    async loadStaleCandidateUniverseForwardOutcomeCoverage(limit) {
      const lim=Math.max(1,Math.min(32,Math.floor(limit)));
      const r=await db.query(`WITH expected AS (SELECT u.recommendation_id,u.decision_at,u.expected_candidate_count,h.horizon_minutes,COUNT(DISTINCT e.candidate_id) AS evaluated_candidate_count,COUNT(DISTINCT e.candidate_id) FILTER(WHERE o.state='FINAL' OR (o.state='INSUFFICIENT_EVIDENCE' AND o.terminal_at IS NOT NULL) OR o.state='FAILED_DATA_INTEGRITY') AS terminal_candidate_count,COUNT(DISTINCT e.candidate_id) FILTER(WHERE o.state='FINAL') AS valid_candidate_count,COUNT(DISTINCT e.candidate_id) FILTER(WHERE o.state='INSUFFICIENT_EVIDENCE' AND o.terminal_at IS NOT NULL) AS insufficient_candidate_count,COUNT(DISTINCT e.candidate_id) FILTER(WHERE o.state='FAILED_DATA_INTEGRITY') AS invalid_candidate_count FROM research.candidate_universe_rerank_retention u CROSS JOIN (VALUES(30),(60),(120)) h(horizon_minutes) LEFT JOIN research.variable_capital_evaluations e ON e.recommendation_id=u.recommendation_id AND e.evaluation_schema_version='reset3c-universe-v3-decision-relevant' LEFT JOIN research.candidate_counterfactual_forward_outcomes o ON o.capital_evaluation_id=e.capital_evaluation_id AND o.horizon_minutes=h.horizon_minutes AND o.outcome_model_version='phase3-forward-outcome-v2' WHERE u.lifecycle_state='ACTIVE' GROUP BY u.recommendation_id,u.decision_at,u.expected_candidate_count,h.horizon_minutes),stale AS (SELECT DISTINCT expected.recommendation_id,expected.decision_at FROM expected LEFT JOIN research.candidate_universe_forward_outcome_coverage c ON c.recommendation_id=expected.recommendation_id AND c.horizon_minutes=expected.horizon_minutes AND c.outcome_model_version='phase3-forward-outcome-v2' WHERE c.recommendation_id IS NULL OR c.expected_candidate_count<>expected.expected_candidate_count OR c.evaluated_candidate_count<>expected.evaluated_candidate_count OR c.terminal_candidate_count<>expected.terminal_candidate_count OR c.valid_candidate_count<>expected.valid_candidate_count OR c.insufficient_candidate_count<>expected.insufficient_candidate_count OR c.invalid_candidate_count<>expected.invalid_candidate_count) SELECT recommendation_id FROM stale ORDER BY decision_at,recommendation_id LIMIT $1`,[lim]);
      return r.rows.map(row=>String(row.recommendation_id));
    },
    async persistCandidateCounterfactualOutcome(v) {
      const existing=await db.query('SELECT state,result_hash FROM research.candidate_counterfactual_forward_outcomes WHERE capital_evaluation_id=$1 AND horizon_minutes=$2 AND outcome_model_version=$3 FOR UPDATE',[v.capitalEvaluationId,v.horizonMinutes,v.outcomeModelVersion]);
      if(String(existing.rows[0]?.state)==='FINAL'){if(String(existing.rows[0]?.result_hash)===v.resultHash)return 'IDEMPOTENT';throw new Error('LPFORGE_COUNTERFACTUAL_OUTCOME_CONFLICT');}
      const q=await db.query(`UPDATE research.candidate_counterfactual_forward_outcomes SET state=$4,evidence_hash=$5,result_hash=$6,reason_codes=$7::jsonb,realized=$8::jsonb,payload=$9::jsonb,last_attempt_at=$10::timestamptz,matured_at=CASE WHEN $4='FINAL' THEN $10::timestamptz ELSE matured_at END,retry_count=$11,next_retry_at=$12::timestamptz,terminal_at=$13::timestamptz WHERE capital_evaluation_id=$1 AND horizon_minutes=$2 AND outcome_model_version=$3`,[v.capitalEvaluationId,v.horizonMinutes,v.outcomeModelVersion,v.state,v.evidenceHash??null,v.resultHash,json(v.reasonCodes),v.realized?json(v.realized):null,json(v.payload),v.attemptedAt,v.retryCount,v.nextRetryAt??null,v.terminalAt??null]);
return 'APPLIED';
    },
    async loadBinSnapshotRetentionPlan(now) {
      const parsed=Date.parse(now);
      if(!Number.isFinite(parsed))return{state:'UNKNOWN' as const,protectionInputs:{},reasonCodes:['RETENTION_PROTECTION_FLOOR_UNKNOWN','RETENTION_NOW_INVALID']};
      const r=await db.query(`WITH selected_open AS (
        SELECT min(d.decision_at-interval '15 minutes') AS floor
        FROM research.phase3_forward_outcomes o
        JOIN research.phase3_forward_decisions d ON d.recommendation_id=o.recommendation_id
        WHERE o.outcome_model_version='phase3-forward-outcome-v2' AND (o.state='PENDING' OR (o.state='INSUFFICIENT_EVIDENCE' AND o.terminal_at IS NULL))
      ), candidate_open AS (
        SELECT min(s.decision_at-interval '15 minutes') AS floor,count(*) FILTER (WHERE s.recommendation_id IS NULL)::integer AS missing_references
        FROM research.candidate_counterfactual_forward_outcomes o
        JOIN research.variable_capital_evaluations e ON e.capital_evaluation_id=o.capital_evaluation_id
        LEFT JOIN research.shadow_recommendations s ON s.recommendation_id=e.recommendation_id
        WHERE o.state='PENDING' OR (o.state='INSUFFICIENT_EVIDENCE' AND o.terminal_at IS NULL)
      ), inventory_open AS (
        SELECT min(e.decision_at-interval '240 minutes') AS floor
        FROM research.inventory_forecast_v2_activation a
        JOIN research.post_entry_telemetry_episodes e ON e.decision_at>=a.activated_at AND e.decision_at<=$1::timestamptz
        WHERE a.activation_id='inventory-forecast-v2-shadow-v1'
          AND NOT EXISTS(SELECT 1 FROM research.inventory_forecast_v2_predictions f WHERE f.telemetry_episode_id=e.telemetry_episode_id AND f.forecast_model_version='inventory-forecast-v2-shadow-v1')
      ) SELECT selected_open.floor AS selected_floor,candidate_open.floor AS candidate_floor,candidate_open.missing_references,inventory_open.floor AS inventory_floor FROM selected_open,candidate_open,inventory_open`,[now]);
      const row=r.rows[0]??{},asIso=(value:unknown)=>{if(!value)return undefined;const t=Date.parse(String(value));return Number.isFinite(t)?new Date(t).toISOString():undefined;},missing=Number(row.missing_references??0);
      if(missing>0)return{state:'UNKNOWN' as const,protectionInputs:{},reasonCodes:['RETENTION_PROTECTION_FLOOR_UNKNOWN','RETENTION_CANDIDATE_DECISION_REFERENCE_MISSING']};
      const protectionInputs={
        ...(asIso(row.selected_floor)?{SELECTED_FORWARD:asIso(row.selected_floor)!}:{}),
        ...(asIso(row.candidate_floor)?{CANDIDATE_COUNTERFACTUAL:asIso(row.candidate_floor)!}:{}),
        ...(asIso(row.inventory_floor)?{INVENTORY_FORECAST_V2:asIso(row.inventory_floor)!}:{}),
        OPERATIONAL_HISTORY:new Date(parsed-4*60*60_000).toISOString(),
      } as Partial<Record<'SELECTED_FORWARD'|'CANDIDATE_COUNTERFACTUAL'|'INVENTORY_FORECAST_V2'|'OPERATIONAL_HISTORY',string>>;
      const floors=Object.values(protectionInputs).map(Date.parse).filter(Number.isFinite);
      if(!floors.length)return{state:'UNKNOWN' as const,protectionInputs,reasonCodes:['RETENTION_PROTECTION_FLOOR_UNKNOWN','RETENTION_FLOOR_EMPTY']};
      return{state:'READY' as const,protectionFloor:new Date(Math.min(...floors)).toISOString(),protectionInputs,reasonCodes:[]};
    },
    async deleteBinSnapshotsBefore(protectionFloor,limit) {
      const parsed=Date.parse(protectionFloor),lim=Math.max(1,Math.min(10_000,Math.floor(limit)));
      if(!Number.isFinite(parsed))throw new Error('LPFORGE_BIN_SNAPSHOT_RETENTION_FLOOR_INVALID');
      const r=await db.query(`WITH candidates AS MATERIALIZED (
        SELECT ctid,observed_at FROM protocol.bin_snapshots WHERE observed_at<$1::timestamptz ORDER BY observed_at ASC LIMIT $2
      ), deleted AS (
        DELETE FROM protocol.bin_snapshots b USING candidates c WHERE b.ctid=c.ctid RETURNING b.observed_at
      ) SELECT count(*)::integer AS deleted,min(observed_at) AS oldest_deleted_at,max(observed_at) AS newest_deleted_at FROM deleted`,[protectionFloor,lim]);
      const row=r.rows[0]??{},asIso=(value:unknown)=>{if(!value)return undefined;const t=Date.parse(String(value));return Number.isFinite(t)?new Date(t).toISOString():undefined;};
      return{deleted:Math.max(0,Number(row.deleted??0)),...(asIso(row.oldest_deleted_at)?{oldestDeletedAt:asIso(row.oldest_deleted_at)!}:{}),...(asIso(row.newest_deleted_at)?{newestDeletedAt:asIso(row.newest_deleted_at)!}:{})};
    },
    async loadDuePhase3ForwardOutcomes(now, limit) {
      const lim=Math.max(1,Math.min(200,Math.floor(limit)));
      const r=await db.query(
        `SELECT o.recommendation_id,o.horizon_minutes,o.outcome_model_version,o.state,o.retry_count,o.next_retry_at,o.evidence_hash,o.result_hash,d.source_sha,d.payload AS decision_payload,d.decision_at+(o.horizon_minutes||' minutes')::interval AS due_at FROM research.phase3_forward_outcomes o JOIN research.phase3_forward_decisions d ON d.recommendation_id=o.recommendation_id WHERE o.outcome_model_version=$3 AND d.decision_at+(o.horizon_minutes||' minutes')::interval<=$1::timestamptz AND (o.state='PENDING' OR (o.state='INSUFFICIENT_EVIDENCE' AND o.terminal_at IS NULL AND (o.next_retry_at IS NULL OR o.next_retry_at<=$1::timestamptz))) ORDER BY CASE WHEN o.state='PENDING' THEN 0 ELSE 1 END ASC,CASE WHEN o.state='PENDING' THEN d.decision_at+(o.horizon_minutes||' minutes')::interval END ASC NULLS LAST,CASE WHEN o.state='INSUFFICIENT_EVIDENCE' THEN COALESCE(o.next_retry_at,d.decision_at+(o.horizon_minutes||' minutes')::interval) END ASC NULLS LAST,o.horizon_minutes ASC,o.recommendation_id ASC LIMIT $2`,
        [now,lim,PHASE3_FORWARD_CURRENT_OUTCOME_MODEL_VERSION],
      );
      return r.rows.map(row=>({recommendationId:String(row.recommendation_id),horizonMinutes:Number(row.horizon_minutes) as 30|60|120,outcomeModelVersion:String(row.outcome_model_version),...(row.source_sha?{sourceSha:String(row.source_sha)}:{}),decisionPayload:(row.decision_payload??{}) as Record<string,unknown>,state:String(row.state) as 'PENDING'|'INSUFFICIENT_EVIDENCE'|'FINAL'|'FAILED_DATA_INTEGRITY',retryCount:Math.max(0,Number(row.retry_count??0)),dueAt:toIsoTimestamp(row.due_at),...(row.next_retry_at?{nextRetryAt:toIsoTimestamp(row.next_retry_at)}:{}),...(row.evidence_hash?{evidenceHash:String(row.evidence_hash)}:{}),...(row.result_hash?{resultHash:String(row.result_hash)}:{})}));
    },
    async persistPhase3ForwardOutcome(v) {
      const computedResultHash=await sha256Hex(canonicalJson({recommendationId:v.recommendationId,horizonMinutes:v.horizonMinutes,outcomeModelVersion:v.outcomeModelVersion,state:v.state,evidenceHash:v.evidenceHash??null,reasonCodes:[...v.reasonCodes].sort(),realized:v.realized??null}));
      if(v.resultHash&&v.resultHash!==computedResultHash)throw new Error('LPFORGE_FORWARD_OUTCOME_RESULT_HASH_INVALID');
      const terminalAt=v.terminalAt??(v.state==='FINAL'?v.attemptedAt:undefined);
      await db.query('BEGIN');
      try{
        const existing=await db.query(`SELECT state,evidence_hash,result_hash FROM research.phase3_forward_outcomes WHERE recommendation_id=$1 AND horizon_minutes=$2 AND outcome_model_version=$3 FOR UPDATE`,[v.recommendationId,v.horizonMinutes,v.outcomeModelVersion]);
        const current=existing.rows[0];
        if(!current)throw new Error('LPFORGE_FORWARD_OUTCOME_ROW_MISSING');
        if(String(current.state)==='FINAL'){
          if(!current.result_hash)throw new Error('LPFORGE_FORWARD_OUTCOME_LEGACY_RESULT_HASH_MISSING');
          if(String(current.evidence_hash??'')!==String(v.evidenceHash??'')||String(current.result_hash)!==computedResultHash)throw new Error('LPFORGE_FORWARD_OUTCOME_EVIDENCE_OR_RESULT_HASH_CONFLICT');
          await db.query('COMMIT');
          return {writeApplied:false,stateTransition:false,retryNoProgress:false};
        }
        const stateTransition=String(current.state)!==v.state,retryNoProgress=String(current.state)==='INSUFFICIENT_EVIDENCE'&&v.state==='INSUFFICIENT_EVIDENCE';
        const r=await db.query(`UPDATE research.phase3_forward_outcomes SET state=$4,evidence_hash=$5,result_hash=$6,reason_codes=$7::jsonb,realized=$8::jsonb,payload=$9::jsonb,matured_at=CASE WHEN state IS DISTINCT FROM $4 THEN $10::timestamptz ELSE matured_at END,last_attempt_at=$11::timestamptz,next_retry_at=$12::timestamptz,retry_count=$13,terminal_at=CASE WHEN $14::boolean THEN COALESCE(terminal_at,$15::timestamptz) ELSE NULL END WHERE recommendation_id=$1 AND horizon_minutes=$2 AND outcome_model_version=$3 AND state<>'FINAL' RETURNING recommendation_id`,[v.recommendationId,v.horizonMinutes,v.outcomeModelVersion,v.state,v.evidenceHash??null,computedResultHash,json(v.reasonCodes),v.realized?json(v.realized):null,json(v.payload),v.maturedAt,v.attemptedAt,v.nextRetryAt??null,v.retryCount,Boolean(terminalAt),terminalAt??null]);
        await db.query('COMMIT');
        const writeApplied=r.rows.length===1;
        return {writeApplied,stateTransition:writeApplied&&stateTransition,retryNoProgress:writeApplied&&retryNoProgress};
      }catch(error){try{await db.query('ROLLBACK');}catch{}throw error;}
    },
    async loadPhase3ForwardOutcomes(limit=5000) {
      const lim=Math.max(1,Math.min(10000,Math.floor(limit)));
      const r=await db.query(`SELECT d.payload AS decision_payload,o.recommendation_id,o.horizon_minutes,o.outcome_model_version,o.state,o.evidence_hash,o.result_hash,o.reason_codes,o.realized,o.payload,o.created_at,o.matured_at FROM research.phase3_forward_outcomes o JOIN research.phase3_forward_decisions d ON d.recommendation_id=o.recommendation_id ORDER BY d.decision_at DESC,o.horizon_minutes ASC LIMIT $1`,[lim]);
      return r.rows.map(row=>({decisionPayload:(row.decision_payload??{}) as Record<string,unknown>,recommendationId:String(row.recommendation_id),horizonMinutes:Number(row.horizon_minutes),outcomeModelVersion:String(row.outcome_model_version),state:String(row.state),...(row.evidence_hash?{evidenceHash:String(row.evidence_hash)}:{}),...(row.result_hash?{resultHash:String(row.result_hash)}:{}),reasonCodes:(row.reason_codes??[]) as string[],...(row.realized?{realized:row.realized as Record<string,unknown>}:{}) ,payload:(row.payload??{}) as Record<string,unknown>,createdAt:new Date(String(row.created_at)).toISOString(),...(row.matured_at?{maturedAt:new Date(String(row.matured_at)).toISOString()}:{})}));
    },
    async preparePostEntryTelemetryEpisodes(capturedAt,limit=100) {
      const activation=await db.query(`SELECT activated_at FROM research.post_entry_telemetry_activation WHERE activation_id='post-entry-state-telemetry-v2'`);
      const activatedAt=activation.rows[0]?.activated_at;
      if(!activatedAt)throw new Error('LPFORGE_POST_ENTRY_TELEMETRY_ACTIVATION_MISSING');
      const rows=await db.query(`SELECT d.*,p.token_x_mint,p.token_y_mint,p.bin_step,tx.decimals AS token_x_decimals,tx.symbol AS token_x_symbol,ty.decimals AS token_y_decimals,ty.symbol AS token_y_symbol FROM research.phase3_forward_decisions d JOIN protocol.pools p ON p.address=d.pool_address LEFT JOIN protocol.tokens tx ON tx.mint=p.token_x_mint LEFT JOIN protocol.tokens ty ON ty.mint=p.token_y_mint WHERE d.decision_at >= $1::timestamptz AND NOT EXISTS(SELECT 1 FROM research.post_entry_telemetry_episodes e WHERE e.recommendation_id=d.recommendation_id) ORDER BY d.decision_at ASC LIMIT $2`,[activatedAt,Math.max(1,Math.min(500,Math.floor(limit)))]);
      let created=0;
      for(const row of rows.rows){
        const payload=(row.payload??{}) as Record<string,unknown>,phase4=(payload.phase4&&typeof payload.phase4==='object'&&!Array.isArray(payload.phase4)?payload.phase4:{}) as Record<string,unknown>,prediction=(row.prediction??{}) as Record<string,unknown>,evidence=(row.evidence_provenance??{}) as Record<string,unknown>,recommendationId=String(row.recommendation_id),telemetryEpisodeId=`post-entry-v2:${recommendationId}`;
        const phase4Diagnostics=phase4.diagnostics&&typeof phase4.diagnostics==='object'&&!Array.isArray(phase4.diagnostics)?phase4.diagnostics as Record<string,unknown>:{};
        const phase4EvaluatedAt=typeof phase4.evaluatedAt==='string'?phase4.evaluatedAt:(typeof phase4Diagnostics.evaluatedAt==='string'?phase4Diagnostics.evaluatedAt:null);
        const frozenHeader={authority:'RESEARCH_ONLY_NO_POLICY_MUTATION',telemetrySchemaVersion:'post-entry-state-telemetry-v2',outcomeModelVersion:'phase3-forward-outcome-v2',identity:{telemetryEpisodeId,recommendationId,decisionId:String(row.decision_id),poolAddress:String(row.pool_address),decisionAt:toIsoTimestamp(row.decision_at),...(phase4EvaluatedAt?{phase4EvaluatedAt}:{}),sourceSha:String(row.source_sha),buildId:String(row.build_id),migrationHead:String(row.migration_head)},decision:{phase3State:String(row.phase3_state),phase3Outcome:String(row.phase3_outcome),phase4State:typeof phase4.result==='string'?phase4.result:'NOT_EVALUATED',waitReasons:Array.isArray(phase4.reasonCodes)?phase4.reasonCodes.map(String):[],rejectReasons:Array.isArray(phase4.reasonCodes)?phase4.reasonCodes.map(String):[],reasonCodes:Array.isArray(row.reason_codes)?row.reason_codes.map(String):[]},economics:{candidateExpectedNetEV:prediction.candidateExpectedNetEV??null,riskAdjustedExpectedNetEV:prediction.riskAdjustedExpectedNetEV??prediction.expectedNetEv??null,candidateUtility:prediction.candidateUtility??null,expectedFees:prediction.candidateExpectedFeeValue??prediction.expectedFeeValue??null,expectedInventoryPnl:prediction.candidateExpectedInventoryPnl??prediction.expectedInventoryPnl??null,uncertainty:prediction.forecastUncertainty??null,timingConfidence:phase4.timingConfidence??null},position:{strategy:row.strategy??null,orientation:row.orientation??null,rangeFamily:row.range_family??null,lowerBinId:row.lower_bin_id??null,upperBinId:row.upper_bin_id??null,activeBinIdAtDecision:Number(row.active_bin_id_at_decision),width:row.included_bin_count??null,capitalLamports:String(row.capital_lamports),binWeights:row.candidate_weights??[]},provenance:{evidenceWatermark:evidence.replayEvidenceWatermark??evidence.historicalEventHash??null,policyHash:String(row.policy_hash),predictionSnapshotVersion:payload.forwardValidation&&typeof payload.forwardValidation==='object'?(payload.forwardValidation as Record<string,unknown>).version??null:null,tokenXMint:String(row.token_x_mint),tokenYMint:String(row.token_y_mint),tokenXDecimals:row.token_x_decimals??null,tokenYDecimals:row.token_y_decimals??null,tokenXSymbol:row.token_x_symbol??null,tokenYSymbol:row.token_y_symbol??null,binStep:Number(row.bin_step)},valuationContract:{version:'phase3-forward-v2-frozen-valuation-v1',quoteAsset:'SOL_LAMPORTS',rawUnitValueX:prediction.rawUnitValueX??null,rawUnitValueY:prediction.rawUnitValueY??null,conversionRule:'frozen-token-X-value-over-frozen-WSOL-lamport-value',precisionRule:'bigint-raw-units-floor',roundingRule:'truncation',calculationVersion:'phase3-forward-outcome-v2'},frozenDecisionPayload:payload};
        const headerHash=await sha256Hex(canonicalJson(frozenHeader));
        const inserted=await db.query(`INSERT INTO research.post_entry_telemetry_episodes(telemetry_episode_id,recommendation_id,decision_id,pool_address,decision_at,phase4_evaluated_at,source_sha,build_id,migration_head,telemetry_schema_version,outcome_model_version,frozen_position_status,frozen_header,header_hash,captured_at,authority) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'post-entry-state-telemetry-v2','phase3-forward-outcome-v2',$10,$11::jsonb,$12,$13,'RESEARCH_ONLY_NO_POLICY_MUTATION') ON CONFLICT(recommendation_id) DO NOTHING RETURNING telemetry_episode_id`,[telemetryEpisodeId,recommendationId,String(row.decision_id),String(row.pool_address),toIsoTimestamp(row.decision_at),phase4EvaluatedAt,String(row.source_sha),String(row.build_id),String(row.migration_head),String(row.selected_candidate_kind)==='NONE'?'FROZEN_POSITION_UNAVAILABLE':'AVAILABLE_FOR_RESEARCH_REPLAY',json(frozenHeader),headerHash,capturedAt]);
        if(inserted.rows.length)created++;
      }
      return{created};
    },
    async loadDuePostEntryTelemetryCheckpoints(now,limit) {
      const lim=Math.max(1,Math.min(500,Math.floor(limit)));
      const r=await db.query(`WITH scheduled AS (
        SELECT e.telemetry_episode_id,e.recommendation_id,e.decision_at,e.source_sha,e.frozen_header,checkpoint.checkpoint_key,checkpoint.observation_type,e.decision_at+(checkpoint.offset_minutes||' minutes')::interval AS target_at,NULL::jsonb AS terminal_outcomes
        FROM research.post_entry_telemetry_episodes e
        CROSS JOIN (VALUES ('DECISION','ENTRY',0),('M1','CHECKPOINT',1),('M5','CHECKPOINT',5),('M10','CHECKPOINT',10),('M15','CHECKPOINT',15),('M30','CHECKPOINT',30),('M60','CHECKPOINT',60),('M120','CHECKPOINT',120)) AS checkpoint(checkpoint_key,observation_type,offset_minutes)
        WHERE e.decision_at+(checkpoint.offset_minutes||' minutes')::interval <= $1::timestamptz
          AND NOT EXISTS(SELECT 1 FROM research.post_entry_telemetry_observations o WHERE o.telemetry_episode_id=e.telemetry_episode_id AND o.checkpoint_key=checkpoint.checkpoint_key)
      ), finalization AS (
        SELECT e.telemetry_episode_id,e.recommendation_id,e.decision_at,e.source_sha,e.frozen_header,'FINALIZATION'::text AS checkpoint_key,'FINALIZATION'::text AS observation_type,COALESCE(o.terminal_at,o.matured_at,o.created_at) AS target_at,
          (SELECT jsonb_agg(jsonb_build_object('horizonMinutes',all_o.horizon_minutes,'state',all_o.state,'evidenceHash',all_o.evidence_hash,'resultHash',all_o.result_hash,'reasonCodes',all_o.reason_codes,'realized',all_o.realized,'maturedAt',all_o.matured_at,'terminalAt',all_o.terminal_at) ORDER BY all_o.horizon_minutes) FROM research.phase3_forward_outcomes all_o WHERE all_o.recommendation_id=e.recommendation_id AND all_o.outcome_model_version='phase3-forward-outcome-v2') AS terminal_outcomes
        FROM research.post_entry_telemetry_episodes e
        JOIN research.phase3_forward_outcomes o ON o.recommendation_id=e.recommendation_id AND o.horizon_minutes=120 AND o.outcome_model_version='phase3-forward-outcome-v2'
        WHERE o.state IN ('FINAL','INSUFFICIENT_EVIDENCE','FAILED_DATA_INTEGRITY')
          AND NOT EXISTS(SELECT 1 FROM research.post_entry_telemetry_observations obs WHERE obs.telemetry_episode_id=e.telemetry_episode_id AND obs.checkpoint_key='FINALIZATION')
      ), due AS (SELECT * FROM scheduled UNION ALL SELECT * FROM finalization)
      SELECT due.*,d.payload AS decision_payload,decision_obs.content AS decision_checkpoint_content,previous_obs.content AS previous_checkpoint_content
      FROM due JOIN research.phase3_forward_decisions d ON d.recommendation_id=due.recommendation_id
      LEFT JOIN research.post_entry_telemetry_observations decision_obs ON decision_obs.telemetry_episode_id=due.telemetry_episode_id AND decision_obs.checkpoint_key='DECISION'
      LEFT JOIN LATERAL(SELECT content FROM research.post_entry_telemetry_observations prior WHERE prior.telemetry_episode_id=due.telemetry_episode_id AND prior.checkpoint_key<>'FINALIZATION' ORDER BY prior.target_at DESC,prior.sequence_number DESC LIMIT 1) previous_obs ON true
      ORDER BY due.target_at ASC,due.telemetry_episode_id ASC LIMIT $2`,[now,lim]);
      return r.rows.map(row=>({telemetryEpisodeId:String(row.telemetry_episode_id),checkpointKey:String(row.checkpoint_key),observationType:String(row.observation_type) as 'ENTRY'|'CHECKPOINT'|'FINALIZATION',targetAt:toIsoTimestamp(row.target_at),decisionAt:toIsoTimestamp(row.decision_at),sourceVersion:String(row.source_sha),frozenHeader:(row.frozen_header??{}) as Record<string,unknown>,decisionPayload:(row.decision_payload??{}) as Record<string,unknown>,...(row.decision_checkpoint_content?{decisionCheckpointContent:row.decision_checkpoint_content as Record<string,unknown>}:{}),...(row.previous_checkpoint_content?{previousCheckpointContent:row.previous_checkpoint_content as Record<string,unknown>}:{}),...(Array.isArray(row.terminal_outcomes)?{terminalOutcomes:row.terminal_outcomes as Array<Record<string,unknown>>}:{})}));
    },
    async appendPostEntryTelemetryObservation(v) {
      const contentHash=await sha256Hex(canonicalJson(v.content));
      await db.query('BEGIN');
      try{
        const episode=await db.query(`SELECT header_hash FROM research.post_entry_telemetry_episodes WHERE telemetry_episode_id=$1 FOR UPDATE`,[v.telemetryEpisodeId]);
        const header=episode.rows[0];if(!header)throw new Error('LPFORGE_POST_ENTRY_TELEMETRY_EPISODE_MISSING');
        const existing=await db.query(`SELECT observation_id,content_hash FROM research.post_entry_telemetry_observations WHERE telemetry_episode_id=$1 AND checkpoint_key=$2`,[v.telemetryEpisodeId,v.checkpointKey]);
        if(existing.rows[0]){
          const status=String(existing.rows[0].content_hash)===contentHash?'DUPLICATE_REJECTED':'INTEGRITY_CONFLICT';
          await db.query(`INSERT INTO research.post_entry_telemetry_capture_audit(telemetry_episode_id,checkpoint_key,attempted_at,capture_status,attempted_content_hash,detail,authority) VALUES($1,$2,$3,$4,$5,$6::jsonb,'RESEARCH_ONLY_NO_POLICY_MUTATION')`,[v.telemetryEpisodeId,v.checkpointKey,v.capturedAt,status,contentHash,json({existingObservationId:String(existing.rows[0].observation_id),existingContentHash:String(existing.rows[0].content_hash)})]);
          await db.query('COMMIT');return{status,contentHash};
        }
        const prior=await db.query(`SELECT sequence_number,current_hash FROM research.telemetry_manifest WHERE telemetry_episode_id=$1 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`,[v.telemetryEpisodeId]);
        const sequenceNumber=prior.rows[0]?Number(prior.rows[0].sequence_number)+1:1,previousHash=prior.rows[0]?String(prior.rows[0].current_hash):String(header.header_hash),observationId=`telemetry-observation:${await sha256Hex(canonicalJson({telemetryEpisodeId:v.telemetryEpisodeId,checkpointKey:v.checkpointKey,contentHash}))}`;
        const currentHash=await sha256Hex(canonicalJson({telemetryEpisodeId:v.telemetryEpisodeId,sequenceNumber,observationId,observationType:v.observationType,observedAt:v.observedAt??null,capturedAt:v.capturedAt,sourceVersion:v.sourceVersion,collectorVersion:v.collectorVersion,contentHash,previousHash,captureStatus:v.checkpointStatus}));
        await db.query(`INSERT INTO research.post_entry_telemetry_observations(observation_id,telemetry_episode_id,sequence_number,checkpoint_key,observation_type,target_at,observed_at,captured_at,checkpoint_status,source_version,collector_version,valuation_contract_version,content_hash,content) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,[observationId,v.telemetryEpisodeId,sequenceNumber,v.checkpointKey,v.observationType,v.targetAt,v.observedAt??null,v.capturedAt,v.checkpointStatus,v.sourceVersion,v.collectorVersion,v.valuationContractVersion,contentHash,json(v.content)]);
        await db.query(`INSERT INTO research.telemetry_manifest(telemetry_episode_id,sequence_number,observation_id,observation_type,observed_at,captured_at,source_version,collector_version,content_hash,previous_hash,current_hash,capture_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[v.telemetryEpisodeId,sequenceNumber,observationId,v.observationType,v.observedAt??null,v.capturedAt,v.sourceVersion,v.collectorVersion,contentHash,previousHash,currentHash,v.checkpointStatus]);
        await db.query(`INSERT INTO research.post_entry_telemetry_capture_audit(telemetry_episode_id,checkpoint_key,attempted_at,capture_status,attempted_content_hash,detail,authority) VALUES($1,$2,$3,'INSERTED',$4,$5::jsonb,'RESEARCH_ONLY_NO_POLICY_MUTATION')`,[v.telemetryEpisodeId,v.checkpointKey,v.capturedAt,contentHash,json({observationId,sequenceNumber,currentHash})]);
        await db.query('COMMIT');return{status:'INSERTED' as const,observationId,sequenceNumber,contentHash,currentHash};
      }catch(error){try{await db.query('ROLLBACK');}catch{}throw error;}
    },
    async loadPostEntryTelemetryEpisode(telemetryEpisodeId) {
      const episode=await db.query(`SELECT header_hash FROM research.post_entry_telemetry_episodes WHERE telemetry_episode_id=$1`,[telemetryEpisodeId]);
      if(!episode.rows[0])return undefined;
      const [observations,manifest]=await Promise.all([db.query(`SELECT observation_id,sequence_number,checkpoint_key,observation_type,target_at,observed_at,captured_at,checkpoint_status,source_version,collector_version,valuation_contract_version,content_hash,content FROM research.post_entry_telemetry_observations WHERE telemetry_episode_id=$1 ORDER BY sequence_number ASC`,[telemetryEpisodeId]),db.query(`SELECT sequence_number,observation_id,observation_type,observed_at,captured_at,source_version,collector_version,content_hash,previous_hash,current_hash,capture_status FROM research.telemetry_manifest WHERE telemetry_episode_id=$1 ORDER BY sequence_number ASC`,[telemetryEpisodeId])]);
      return{headerHash:String(episode.rows[0].header_hash),observations:observations.rows,manifest:manifest.rows};
    },
    async ensureMarketContextTelemetryActivation(v) {
      await db.query('BEGIN');
      try{
        const existing=await db.query("SELECT activated_at,source_sha,build_id,migration_version,telemetry_schema_version,market_context_schema_version,market_context_model_version,collector_version FROM research.market_context_telemetry_activation WHERE activation_id=$1 FOR UPDATE",[v.activationId]);
        if(existing.rows[0]){
          /* The activation row records the first accepted M0050 artifact. A later
             verified release may contain an additive telemetry-only migration;
             preserve the original activation provenance rather than rewriting it. */
          const row=existing.rows[0],sameContract=String(row.migration_version)===v.migrationVersion&&String(row.telemetry_schema_version)===v.telemetrySchemaVersion&&String(row.market_context_schema_version)===v.marketContextSchemaVersion&&String(row.market_context_model_version)===v.marketContextModelVersion&&String(row.collector_version)===v.collectorVersion;
          if(!sameContract)throw new Error('LPFORGE_M0050_ACTIVATION_CONTRACT_CONFLICT');
          await db.query('COMMIT');return{created:false,activatedAt:toIsoTimestamp(row.activated_at)};
        }
        await db.query("INSERT INTO research.market_context_telemetry_activation(activation_id,activated_at,source_sha,build_id,migration_version,telemetry_schema_version,market_context_schema_version,market_context_model_version,collector_version,authority) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'RESEARCH_ONLY_NO_POLICY_MUTATION')",[v.activationId,v.activatedAt,v.sourceSha,v.buildId,v.migrationVersion,v.telemetrySchemaVersion,v.marketContextSchemaVersion,v.marketContextModelVersion,v.collectorVersion]);
        await db.query('COMMIT');return{created:true,activatedAt:v.activatedAt};
      }catch(error){try{await db.query('ROLLBACK');}catch{}throw error;}
    },
    async loadDueProspectiveMarketContextSnapshots(now,limit,marketContextModelVersion) {
      const lim=Math.max(1,Math.min(500,Math.floor(limit)));
      const r=await db.query("SELECT e.telemetry_episode_id,e.recommendation_id,e.pool_address,e.decision_at,e.header_hash,d.payload AS decision_payload,d.source_sha,d.build_id,d.migration_head FROM research.market_context_telemetry_activation a JOIN research.post_entry_telemetry_episodes e ON e.decision_at>=a.activated_at JOIN research.phase3_forward_decisions d ON d.recommendation_id=e.recommendation_id WHERE a.activation_id='m0050-prospective-market-context-telemetry-v1' AND e.decision_at<=$1::timestamptz AND NOT EXISTS(SELECT 1 FROM research.market_context_telemetry_snapshots s WHERE s.telemetry_episode_id=e.telemetry_episode_id AND s.market_context_model_version=$3) ORDER BY e.decision_at ASC,e.telemetry_episode_id ASC LIMIT $2",[now,lim,marketContextModelVersion]);
      return r.rows.map(row=>({telemetryEpisodeId:String(row.telemetry_episode_id),recommendationId:String(row.recommendation_id),poolAddress:String(row.pool_address),decisionAt:toIsoTimestamp(row.decision_at),headerHash:String(row.header_hash),decisionPayload:(row.decision_payload??{}) as Record<string,unknown>,sourceSha:String(row.source_sha),buildId:String(row.build_id),migrationHead:String(row.migration_head)}));
    },
    async appendProspectiveMarketContextSnapshot(v) {
      const contentHash=await sha256Hex(canonicalJson({telemetryEpisodeId:v.telemetryEpisodeId,recommendationId:v.recommendationId,poolAddress:v.poolAddress,decisionAt:v.decisionAt,captureStatus:v.captureStatus,reasonCodes:[...v.reasonCodes].sort(),availability:v.availability,rawPayload:v.rawPayload,derivedInterpretation:v.derivedInterpretation,provenance:v.provenance,facts:v.facts}));
      await db.query('BEGIN');
      try{
        const episode=await db.query("SELECT header_hash,recommendation_id,pool_address,decision_at FROM research.post_entry_telemetry_episodes WHERE telemetry_episode_id=$1 FOR UPDATE",[v.telemetryEpisodeId]);
        const header=episode.rows[0];if(!header)throw new Error('LPFORGE_M0050_EPISODE_MISSING');
        if(String(header.recommendation_id)!==v.recommendationId||String(header.pool_address)!==v.poolAddress||toIsoTimestamp(header.decision_at)!==v.decisionAt)throw new Error('LPFORGE_M0050_EPISODE_LINKAGE_CONFLICT');
        const existing=await db.query("SELECT market_context_snapshot_id,content_hash FROM research.market_context_telemetry_snapshots WHERE telemetry_episode_id=$1 AND market_context_model_version=$2 FOR UPDATE",[v.telemetryEpisodeId,v.marketContextModelVersion]);
        if(existing.rows[0]){
          const status=String(existing.rows[0].content_hash)===contentHash?'DUPLICATE_REJECTED':'INTEGRITY_CONFLICT';
          await db.query("INSERT INTO research.market_context_telemetry_capture_audit(telemetry_episode_id,market_context_model_version,attempted_at,capture_status,attempted_content_hash,detail,authority) VALUES($1,$2,$3,$4,$5,$6::jsonb,'RESEARCH_ONLY_NO_POLICY_MUTATION')",[v.telemetryEpisodeId,v.marketContextModelVersion,v.capturedAt,status,contentHash,json({marketContextSnapshotId:String(existing.rows[0].market_context_snapshot_id),existingContentHash:String(existing.rows[0].content_hash)})]);
          await db.query('COMMIT');return{status,contentHash};
        }
        const snapshotId='market-context:'+await sha256Hex(canonicalJson({telemetryEpisodeId:v.telemetryEpisodeId,marketContextModelVersion:v.marketContextModelVersion,contentHash}));
        const previousHash=String(header.header_hash),currentHash=await sha256Hex(canonicalJson({telemetryEpisodeId:v.telemetryEpisodeId,marketContextModelVersion:v.marketContextModelVersion,snapshotId,sequenceNumber:1,capturedAt:v.capturedAt,contentHash,previousHash,captureStatus:v.captureStatus,collectorVersion:v.collectorVersion,sourceVersion:v.decisionSourceSha}));
        await db.query("INSERT INTO research.market_context_telemetry_snapshots(market_context_snapshot_id,telemetry_episode_id,recommendation_id,pool_address,decision_at,captured_at,decision_source_sha,decision_build_id,decision_migration_head,telemetry_schema_version,market_context_schema_version,market_context_model_version,regime_model_version,volatility_model_version,collector_version,capture_status,reason_codes,availability,raw_payload,derived_interpretation,provenance,content_hash,authority) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19::jsonb,$20::jsonb,$21::jsonb,$22,'RESEARCH_ONLY_NO_POLICY_MUTATION')",[snapshotId,v.telemetryEpisodeId,v.recommendationId,v.poolAddress,v.decisionAt,v.capturedAt,v.decisionSourceSha,v.decisionBuildId,v.decisionMigrationHead,v.telemetrySchemaVersion,v.marketContextSchemaVersion,v.marketContextModelVersion,v.regimeModelVersion??null,v.volatilityModelVersion??null,v.collectorVersion,v.captureStatus,json([...v.reasonCodes].sort()),json(v.availability),json(v.rawPayload),json(v.derivedInterpretation),json(v.provenance),contentHash]);
        for(const fact of v.facts){
          const factHash=await sha256Hex(canonicalJson({marketContextSnapshotId:snapshotId,...fact}));
          const factId='market-context-fact:'+await sha256Hex(canonicalJson({marketContextSnapshotId:snapshotId,key:fact.key,contentHash:factHash}));
          await db.query("INSERT INTO research.market_context_telemetry_facts(market_context_fact_id,market_context_snapshot_id,fact_key,fact_layer,value,unit,source_identity,source_version,source_observed_at,source_age_ms,source_window,availability_status,content_hash) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13)",[factId,snapshotId,fact.key,fact.layer,json(fact.value),fact.unit,fact.sourceIdentity,fact.sourceVersion,fact.sourceObservedAt??null,fact.sourceAgeMs??null,fact.sourceWindow??null,fact.availabilityStatus,factHash]);
        }
        await db.query("INSERT INTO research.market_context_telemetry_manifest(market_context_snapshot_id,telemetry_episode_id,sequence_number,observed_at,captured_at,source_version,collector_version,market_context_model_version,content_hash,previous_hash,current_hash,capture_status) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11)",[snapshotId,v.telemetryEpisodeId,v.decisionAt,v.capturedAt,v.decisionSourceSha,v.collectorVersion,v.marketContextModelVersion,contentHash,previousHash,currentHash,v.captureStatus]);
        await db.query("INSERT INTO research.market_context_telemetry_capture_audit(telemetry_episode_id,market_context_model_version,attempted_at,capture_status,attempted_content_hash,detail,authority) VALUES($1,$2,$3,'INSERTED',$4,$5::jsonb,'RESEARCH_ONLY_NO_POLICY_MUTATION')",[v.telemetryEpisodeId,v.marketContextModelVersion,v.capturedAt,contentHash,json({marketContextSnapshotId:snapshotId,currentHash,factCount:v.facts.length})]);
        await db.query('COMMIT');return{status:'INSERTED' as const,contentHash,snapshotId,currentHash};
      }catch(error){try{await db.query('ROLLBACK');}catch{}throw error;}
    },
    async loadProspectiveMarketContextSnapshot(telemetryEpisodeId,marketContextModelVersion) {
      const episode=await db.query("SELECT header_hash FROM research.post_entry_telemetry_episodes WHERE telemetry_episode_id=$1",[telemetryEpisodeId]);
      if(!episode.rows[0])return undefined;
      const snapshot=await db.query("SELECT * FROM research.market_context_telemetry_snapshots WHERE telemetry_episode_id=$1 AND market_context_model_version=$2",[telemetryEpisodeId,marketContextModelVersion]);
      if(!snapshot.rows[0])return undefined;
      const snapshotId=String(snapshot.rows[0].market_context_snapshot_id);
      const facts=await db.query("SELECT fact_key,fact_layer,value,unit,source_identity,source_version,source_observed_at,source_age_ms,source_window,availability_status,content_hash FROM research.market_context_telemetry_facts WHERE market_context_snapshot_id=$1 ORDER BY fact_key ASC",[snapshotId]);
      const manifest=await db.query("SELECT sequence_number,observed_at,captured_at,source_version,collector_version,market_context_model_version,content_hash,previous_hash,current_hash,capture_status FROM research.market_context_telemetry_manifest WHERE market_context_snapshot_id=$1",[snapshotId]);
      return{headerHash:String(episode.rows[0].header_hash),snapshot:snapshot.rows[0] as Record<string,unknown>,facts:facts.rows,...(manifest.rows[0]?{manifest:manifest.rows[0] as Record<string,unknown>}:{})};
    },
    async ensureInventoryForecastV2Activation(v) {
      await db.query('BEGIN');
      try {
        const existing=await db.query("SELECT activated_at,forecast_schema_version,forecast_model_version,formula_version,collector_version,m0050_market_context_model_version,v2_outcome_model_version FROM research.inventory_forecast_v2_activation WHERE activation_id=$1 FOR UPDATE",[v.activationId]);
        if(existing.rows[0]){
          const row=existing.rows[0],sameContract=String(row.forecast_schema_version)===v.forecastSchemaVersion&&String(row.forecast_model_version)===v.forecastModelVersion&&String(row.formula_version)===v.formulaVersion&&String(row.collector_version)===v.collectorVersion&&String(row.m0050_market_context_model_version)===v.m0050MarketContextModelVersion&&String(row.v2_outcome_model_version)===v.v2OutcomeModelVersion;
          if(!sameContract)throw new Error('LPFORGE_INVENTORY_FORECAST_V2_ACTIVATION_CONTRACT_CONFLICT');
          await db.query('COMMIT');return{created:false,activatedAt:toIsoTimestamp(row.activated_at)};
        }
        await db.query("INSERT INTO research.inventory_forecast_v2_activation(activation_id,activated_at,source_sha,build_id,migration_head,policy_hash,forecast_schema_version,forecast_model_version,formula_version,collector_version,m0050_market_context_model_version,v2_outcome_model_version,authority) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'RESEARCH_ONLY_NO_POLICY_MUTATION')",[v.activationId,v.activatedAt,v.sourceSha,v.buildId,v.migrationHead,v.policyHash,v.forecastSchemaVersion,v.forecastModelVersion,v.formulaVersion,v.collectorVersion,v.m0050MarketContextModelVersion,v.v2OutcomeModelVersion]);
        await db.query('COMMIT');return{created:true,activatedAt:v.activatedAt};
      }catch(error){try{await db.query('ROLLBACK');}catch{}throw error;}
    },
    async loadDueInventoryForecastV2Predictions(now,limit,forecastModelVersion) {
      const lim=Math.max(1,Math.min(500,Math.floor(limit)));
      const r=await db.query("SELECT e.telemetry_episode_id,e.recommendation_id,e.pool_address,e.decision_at,e.header_hash,d.payload AS decision_payload,d.source_sha,d.build_id,d.migration_head,p.token_x_mint,p.token_y_mint,p.first_seen_at FROM research.inventory_forecast_v2_activation a JOIN research.post_entry_telemetry_episodes e ON e.decision_at>=a.activated_at JOIN research.phase3_forward_decisions d ON d.recommendation_id=e.recommendation_id JOIN protocol.pools p ON p.address=e.pool_address WHERE a.activation_id='inventory-forecast-v2-shadow-v1' AND e.decision_at<=$1::timestamptz AND NOT EXISTS(SELECT 1 FROM research.inventory_forecast_v2_predictions f WHERE f.telemetry_episode_id=e.telemetry_episode_id AND f.forecast_model_version=$3) ORDER BY e.decision_at ASC,e.telemetry_episode_id ASC LIMIT $2",[now,lim,forecastModelVersion]);
      return r.rows.map(row=>({telemetryEpisodeId:String(row.telemetry_episode_id),recommendationId:String(row.recommendation_id),poolAddress:String(row.pool_address),decisionAt:toIsoTimestamp(row.decision_at),headerHash:String(row.header_hash),decisionPayload:(row.decision_payload??{}) as Record<string,unknown>,sourceSha:String(row.source_sha),buildId:String(row.build_id),migrationHead:String(row.migration_head),...(row.token_x_mint?{tokenXMint:String(row.token_x_mint)}:{}),...(row.token_y_mint?{tokenYMint:String(row.token_y_mint)}:{}),...(row.first_seen_at?{poolFirstSeenAt:toIsoTimestamp(row.first_seen_at)}:{})}));
    },
    async appendInventoryForecastV2Prediction(v) {
      const contentHash=await sha256Hex(canonicalJson({telemetryEpisodeId:v.telemetryEpisodeId,recommendationId:v.recommendationId,candidateId:v.candidateId,poolAddress:v.poolAddress,decisionAt:v.decisionAt,captureStatus:v.captureStatus,reasonCodes:[...v.reasonCodes].sort(),rawFrozenInputs:v.rawFrozenInputs,derivedForecast:v.derivedForecast,provenance:v.provenance}));
      await db.query('BEGIN');
      try {
        const episode=await db.query("SELECT header_hash,recommendation_id,pool_address,decision_at FROM research.post_entry_telemetry_episodes WHERE telemetry_episode_id=$1 FOR UPDATE",[v.telemetryEpisodeId]);
        const header=episode.rows[0];if(!header)throw new Error('LPFORGE_INVENTORY_FORECAST_V2_EPISODE_MISSING');
        if(String(header.recommendation_id)!==v.recommendationId||String(header.pool_address)!==v.poolAddress||toIsoTimestamp(header.decision_at)!==v.decisionAt)throw new Error('LPFORGE_INVENTORY_FORECAST_V2_EPISODE_LINKAGE_CONFLICT');
        const existing=await db.query("SELECT inventory_forecast_prediction_id,content_hash FROM research.inventory_forecast_v2_predictions WHERE telemetry_episode_id=$1 AND candidate_id=$2 AND forecast_model_version=$3 FOR UPDATE",[v.telemetryEpisodeId,v.candidateId,v.forecastModelVersion]);
        if(existing.rows[0]){
          const status=String(existing.rows[0].content_hash)===contentHash?'DUPLICATE_REJECTED':'INTEGRITY_CONFLICT';
          await db.query("INSERT INTO research.inventory_forecast_v2_capture_audit(telemetry_episode_id,candidate_id,forecast_model_version,attempted_at,capture_status,attempted_content_hash,detail,authority) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'RESEARCH_ONLY_NO_POLICY_MUTATION')",[v.telemetryEpisodeId,v.candidateId,v.forecastModelVersion,v.capturedAt,status,contentHash,json({inventoryForecastPredictionId:String(existing.rows[0].inventory_forecast_prediction_id),existingContentHash:String(existing.rows[0].content_hash)})]);
          await db.query('COMMIT');return{status,contentHash};
        }
        const predictionId='inventory-forecast-v2:'+await sha256Hex(canonicalJson({telemetryEpisodeId:v.telemetryEpisodeId,candidateId:v.candidateId,forecastModelVersion:v.forecastModelVersion,contentHash}));
        const previousHash=String(header.header_hash),currentHash=await sha256Hex(canonicalJson({telemetryEpisodeId:v.telemetryEpisodeId,predictionId,capturedAt:v.capturedAt,sourceVersion:v.decisionSourceSha,collectorVersion:v.collectorVersion,contentHash,previousHash,captureStatus:v.captureStatus}));
        await db.query("INSERT INTO research.inventory_forecast_v2_predictions(inventory_forecast_prediction_id,telemetry_episode_id,recommendation_id,candidate_id,pool_address,decision_at,captured_at,decision_source_sha,decision_build_id,decision_migration_head,forecast_schema_version,forecast_model_version,formula_version,collector_version,capture_status,reason_codes,raw_frozen_inputs,derived_forecast,provenance,content_hash,authority) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20,'RESEARCH_ONLY_NO_POLICY_MUTATION')",[predictionId,v.telemetryEpisodeId,v.recommendationId,v.candidateId,v.poolAddress,v.decisionAt,v.capturedAt,v.decisionSourceSha,v.decisionBuildId,v.decisionMigrationHead,v.forecastSchemaVersion,v.forecastModelVersion,v.formulaVersion,v.collectorVersion,v.captureStatus,json([...v.reasonCodes].sort()),json(v.rawFrozenInputs),json(v.derivedForecast),json(v.provenance),contentHash]);
        await db.query("INSERT INTO research.inventory_forecast_v2_manifest(inventory_forecast_prediction_id,telemetry_episode_id,observed_at,captured_at,source_version,collector_version,forecast_model_version,content_hash,previous_hash,current_hash,capture_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",[predictionId,v.telemetryEpisodeId,v.decisionAt,v.capturedAt,v.decisionSourceSha,v.collectorVersion,v.forecastModelVersion,contentHash,previousHash,currentHash,v.captureStatus]);
        await db.query("INSERT INTO research.inventory_forecast_v2_capture_audit(telemetry_episode_id,candidate_id,forecast_model_version,attempted_at,capture_status,attempted_content_hash,detail,authority) VALUES($1,$2,$3,$4,'INSERTED',$5,$6::jsonb,'RESEARCH_ONLY_NO_POLICY_MUTATION')",[v.telemetryEpisodeId,v.candidateId,v.forecastModelVersion,v.capturedAt,contentHash,json({inventoryForecastPredictionId:predictionId,currentHash})]);
        await db.query('COMMIT');return{status:'INSERTED' as const,contentHash,predictionId,currentHash};
      }catch(error){try{await db.query('ROLLBACK');}catch{}throw error;}
    },
    async loadInventoryForecastV2ValidationRows(forecastModelVersion) {
      const r=await db.query("SELECT f.pool_address,f.decision_at,f.recommendation_id,f.raw_frozen_inputs,f.derived_forecast,d.payload->'prediction'->>'candidateExpectedInventoryPnl' AS v1_predicted_inventory_pnl,o.horizon_minutes,o.realized->>'realizedInventoryPnl' AS realized_inventory_pnl FROM research.inventory_forecast_v2_predictions f JOIN research.phase3_forward_decisions d ON d.recommendation_id=f.recommendation_id JOIN research.phase3_forward_outcomes o ON o.recommendation_id=f.recommendation_id AND o.outcome_model_version='phase3-forward-outcome-v2' AND o.state='FINAL' WHERE f.forecast_model_version=$1 AND f.capture_status='OBSERVED' ORDER BY f.decision_at ASC,o.horizon_minutes ASC",[forecastModelVersion]);
      return r.rows;
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
    async loadFreshPhase4EntryAuthorization(now) {
      const r = await db.query(
        `SELECT entry_evaluation_id,thesis_id,pool_address,observed_at,expires_at,confidence,reason_codes,payload
         FROM research.entry_evaluations
         WHERE decision='ENTRY_READY'
           AND expires_at>$1::timestamptz
           AND reason_codes @> '["ENTRY_TIMING_APPROVED"]'::jsonb
         ORDER BY observed_at DESC
         LIMIT 1`,
        [now],
      );
      const row = r.rows[0];
      if (!row) return undefined;
      return {
        entryEvaluationId: String(row.entry_evaluation_id),
        thesisId: String(row.thesis_id),
        poolAddress: String(row.pool_address),
        observedAt: toIsoTimestamp(row.observed_at),
        expiresAt: toIsoTimestamp(row.expires_at),
        confidence: Number(row.confidence),
        reasonCodes: (row.reason_codes ?? []) as string[],
        payload: (row.payload ?? {}) as Record<string, unknown>,
      };
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
    async ensureExecutionTransactionStep(v) {
      await db.query(
        `INSERT INTO execution.transaction_steps(transaction_id,plan_id,sequence,kind,state,required_signers,metadata)
         SELECT $1,$2,COALESCE((SELECT MAX(sequence)+1 FROM execution.transaction_steps WHERE plan_id=$2),1),$3,$4,$5::jsonb,$6::jsonb
         ON CONFLICT(transaction_id) DO NOTHING`,
        [
          v.transactionId,
          v.planId,
          v.kind,
          v.state,
          json(v.requiredSignerAddresses),
          json(v.metadata),
        ],
      );
    },
    async claimNextAutonomousPlan(now) {
      // An expired recommendation is no longer a valid expression of the market
      // thesis that created it.  Finalize it before looking for work so it cannot
      // remain an apparently queued plan (or be confused with a retryable plan)
      // after its execution window has elapsed.
      await db.query(
        `WITH expired AS (
           UPDATE execution.transaction_plans
           SET state='EXPIRED',
               payload=payload||jsonb_build_object(
                 'autonomous_dispatch_expired_at',$1::text,
                 'autonomous_dispatch',jsonb_build_object('reason','P6_PLAN_EXPIRED_BEFORE_CLAIM')
               )
           WHERE state='PLANNED' AND expires_at<=$1::timestamptz
           RETURNING plan_id
         )
         INSERT INTO execution.plan_state_events(plan_id,prior_state,next_state,observed_at,reason_codes,payload)
         SELECT plan_id,'PLANNED','EXPIRED',$1,'["P6_PLAN_EXPIRED_BEFORE_CLAIM"]'::jsonb,
                jsonb_build_object('recovery',false)
         FROM expired`,
        [now],
      );
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
        `SELECT p.plan_id,p.intent_id,p.state,p.expires_at,p.payload AS plan_payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload AS intent_payload,COALESCE(json_agg(json_build_object('transactionId',s.transaction_id,'sequence',s.sequence,'kind',s.kind,'state',s.state,'requiredSignerAddresses',s.required_signers,'metadata',s.metadata) ORDER BY s.sequence) FILTER (WHERE s.transaction_id IS NOT NULL),'[]'::json) AS steps FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id LEFT JOIN execution.transaction_steps s ON s.plan_id=p.plan_id WHERE p.plan_id=$1 GROUP BY p.plan_id,p.intent_id,p.state,p.expires_at,p.payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload`,
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
        const positions=await tx.query("SELECT COALESCE(sum(initial_capital_lamports),0)::text AS deployed,COALESCE(sum(initial_capital_lamports) FILTER (WHERE pool_address=$2),0)::text AS pool_deployed,COALESCE(sum(initial_capital_lamports) FILTER (WHERE p.token_x_mint=$3),0)::text AS token_deployed FROM execution.owned_positions o JOIN protocol.pools p ON p.address=o.pool_address WHERE o.owner_address=$1 AND o.lifecycle_state IN ('OPEN','CLOSING','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN')",[v.ownerAddress,v.poolAddress,tokenMint??'']);
        const reservations=await tx.query("SELECT COALESCE(sum(capital_lamports),0)::text AS reserved,COALESCE(sum(capital_lamports) FILTER (WHERE pool_address=$2),0)::text AS pool_reserved,COALESCE(sum(capital_lamports) FILTER (WHERE token_mint=$3),0)::text AS token_reserved FROM execution.capital_reservations WHERE owner_address=$1 AND state IN ('RESERVED','SUBMITTED')",[v.ownerAddress,v.poolAddress,tokenMint??'']);
        const q=(row:Record<string,unknown>,key:string)=>BigInt(String(row[key]??'0'));
        const deployed=q(positions.rows[0]??{},'deployed'),poolDeployed=q(positions.rows[0]??{},'pool_deployed'),tokenDeployed=q(positions.rows[0]??{},'token_deployed'),reserved=q(reservations.rows[0]??{},'reserved'),poolReserved=q(reservations.rows[0]??{},'pool_reserved'),tokenReserved=q(reservations.rows[0]??{},'token_reserved');
        const assessment=assessExecutionCapitalReservation({request:v,...(tokenMint?{tokenMint}:{}),deployedLamports:deployed,reservedLamports:reserved,poolDeployedLamports:poolDeployed,poolReservedLamports:poolReserved,tokenDeployedLamports:tokenDeployed,tokenReservedLamports:tokenReserved}),available=assessment.diagnostics.walletDeployableLamports;
        if(!assessment.approved){await tx.query('COMMIT');return{approved:false,reasonCodes:assessment.reasonCodes,...(tokenMint?{tokenMint}:{}),deployedLamports:deployed,reservedLamports:reserved,availableLamports:available,diagnostics:assessment.diagnostics};}
        await tx.query("INSERT INTO execution.capital_reservations(plan_id,owner_address,pool_address,token_mint,capital_lamports,state,reserved_at,updated_at,reason_codes,payload) VALUES($1,$2,$3,$4,$5,'RESERVED',$6,$6,$7::jsonb,$8::jsonb) ON CONFLICT(plan_id) DO UPDATE SET state='RESERVED',updated_at=EXCLUDED.updated_at,reason_codes=EXCLUDED.reason_codes,payload=EXCLUDED.payload",[v.planId,v.ownerAddress,v.poolAddress,tokenMint,v.capitalLamports.toString(),v.now,json(['P6_CAPITAL_RESERVED']),json({capitalReservation:assessment.diagnostics})]);
        await tx.query('COMMIT');return{approved:true,reasonCodes:['P6_CAPITAL_RESERVED'],...(tokenMint?{tokenMint}:{}),deployedLamports:deployed,reservedLamports:reserved+v.capitalLamports,availableLamports:available-v.capitalLamports,diagnostics:assessment.diagnostics};
      } catch(error) {try{await tx.query('ROLLBACK');}catch{} throw error;}
    },
    async releaseExecutionCapital(planId,at,reasonCodes){await db.query("UPDATE execution.capital_reservations SET state='RELEASED',updated_at=$2,reason_codes=$3::jsonb WHERE plan_id=$1 AND state IN ('RESERVED','SUBMITTED')",[planId,at,json(reasonCodes)]);},
    async markExecutionCapitalSubmitted(planId,at){await db.query("UPDATE execution.capital_reservations SET state='SUBMITTED',updated_at=$2 WHERE plan_id=$1 AND state='RESERVED'",[planId,at]);},
    async reconcileExecutionCapitalReservations(at){await db.query("UPDATE execution.capital_reservations r SET state=CASE WHEN p.state IN ('BLOCKED','FAILED') THEN 'RELEASED' WHEN EXISTS(SELECT 1 FROM execution.owned_positions o WHERE o.entry_plan_id=r.plan_id AND o.lifecycle_state IN ('OPEN','CLOSING','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN')) THEN 'DEPLOYED' WHEN r.state='DEPLOYED' AND EXISTS(SELECT 1 FROM execution.owned_positions o WHERE o.entry_plan_id=r.plan_id AND o.lifecycle_state='CLOSED') THEN 'RELEASED' ELSE r.state END,updated_at=$1,reason_codes=CASE WHEN r.state='DEPLOYED' AND EXISTS(SELECT 1 FROM execution.owned_positions o WHERE o.entry_plan_id=r.plan_id AND o.lifecycle_state='CLOSED') THEN '[\"P6_CAPITAL_POSITION_CLOSED_RECONCILED\"]'::jsonb ELSE r.reason_codes END FROM execution.transaction_plans p WHERE p.plan_id=r.plan_id AND r.state IN ('RESERVED','SUBMITTED','DEPLOYED')",[at]);},
    async countExecutionActionsSince(ownerAddress,since){const r=await db.query("SELECT count(DISTINCT p.plan_id)::int AS n FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id LEFT JOIN execution.transaction_steps s ON s.plan_id=p.plan_id LEFT JOIN execution.submission_attempts a ON a.transaction_id=s.transaction_id WHERE i.owner_address=$1 AND a.state IN ('SENT','UNKNOWN') AND a.submitted_at >= $2::timestamptz",[ownerAddress,since]);return Number(r.rows[0]?.n??0);},
    async reserveControlledCanaryCampaignOpen(v){
      // `canary_runs` remains immutable audit history for attempt 1.  The
      // explicit M0059 replacement table is the only path by which a failed
      // pre-sign plan can admit one fresh plan; it is not a counter reset.
      const tx=db;
      try{
        await tx.query('BEGIN');
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))",[v.campaignId]);
        const existing=await tx.query("SELECT run_id,plan_id,capital_lamports FROM execution.canary_runs WHERE run_id=$1 FOR UPDATE",[v.campaignId]);
        if(!existing.rows[0]){
          await tx.query(
            "INSERT INTO execution.canary_runs(run_id,plan_id,pool_address,action,capital_lamports,status,started_at,payload) VALUES($1,$2,$3,'OPEN',$4,'BUILD_ONLY',$5,$6::jsonb)",
            [v.campaignId,v.planId,v.poolAddress,v.capitalLamports.toString(),v.at,json({recordType:'CONTROLLED_CANARY_CAMPAIGN_OPEN_ALLOWANCE',campaignId:v.campaignId,maximumOpenCount:1,allowanceState:'CONSUMED_BEFORE_SIGNING',attemptNumber:1})],
          );
          await tx.query('COMMIT');
          return{reserved:true};
        }
        const existingPlanId=String(existing.rows[0].plan_id??'');
        if(existingPlanId===v.planId){await tx.query('COMMIT');return{reserved:true,existingPlanId};}
        const replacement=await tx.query("SELECT replacement_plan_id FROM execution.canary_pre_sign_replacements WHERE campaign_id=$1 FOR UPDATE",[v.campaignId]);
        const replacementPlanId=replacement.rows[0]?.replacement_plan_id===undefined?undefined:String(replacement.rows[0].replacement_plan_id);
        if(replacementPlanId){await tx.query('COMMIT');return{reserved:replacementPlanId===v.planId,existingPlanId:replacementPlanId};}
        // A replacement is permitted only after the original plan is terminal
        // and every durable record proves it stopped before signature or send.
        const proof=await tx.query(
          `SELECT p.state AS plan_state,j.state AS journal_state,j.signature,
                  EXISTS(SELECT 1 FROM execution.transaction_steps s JOIN execution.submission_attempts a ON a.transaction_id=s.transaction_id WHERE s.plan_id=p.plan_id) AS any_submission,
                  EXISTS(SELECT 1 FROM execution.transaction_steps s JOIN execution.submission_attempts a ON a.transaction_id=s.transaction_id JOIN execution.confirmations c ON c.attempt_id=a.attempt_id WHERE s.plan_id=p.plan_id) AS any_confirmation,
                  EXISTS(SELECT 1 FROM execution.owned_positions o WHERE o.entry_plan_id=p.plan_id) AS any_position
             FROM execution.transaction_plans p
             LEFT JOIN execution.execution_journal j ON j.plan_id=p.plan_id
            WHERE p.plan_id=$1 FOR UPDATE OF p`,
          [existingPlanId],
        );
        const row=proof.rows[0];
        if(!row){await tx.query('COMMIT');return{reserved:false,existingPlanId};}
        const preSignZeroExposure=String(row.plan_state)==='FAILED'
          &&typeof row.journal_state==='string'
          &&row.signature==null
          &&row.any_submission===false
          &&row.any_confirmation===false
          &&row.any_position===false
          &&String(existing.rows[0].capital_lamports)===v.capitalLamports.toString();
        if(!preSignZeroExposure){await tx.query('COMMIT');return{reserved:false,existingPlanId};}
        await tx.query(
          `INSERT INTO execution.canary_pre_sign_replacements(campaign_id,failed_attempt_plan_id,replacement_plan_id,authorized_at,payload)
           VALUES($1,$2,$3,$4,$5::jsonb)`,
          [v.campaignId,existingPlanId,v.planId,v.at,json({recordType:'CONTROLLED_CANARY_PRE_SIGN_ZERO_EXPOSURE_REPLACEMENT',attemptNumber:2,maximumPlanAttempts:2,maximumEconomicOpens:1,failedAttemptPlanId:existingPlanId,replacementPlanId:v.planId,capitalLamports:v.capitalLamports.toString(),poolAddress:v.poolAddress})],
        );
        await tx.query('COMMIT');
        return{reserved:true,existingPlanId};
      }catch(error){try{await tx.query('ROLLBACK');}catch{}throw error;}
    },
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
        `WITH current AS (SELECT state FROM execution.transaction_plans WHERE plan_id=$1),updated AS (UPDATE execution.transaction_plans SET state=$2,payload=payload||jsonb_build_object('autonomous_dispatch_updated_at',$3::text,'autonomous_dispatch',COALESCE(payload->'autonomous_dispatch','{}'::jsonb)||$4::jsonb) WHERE plan_id=$1 RETURNING plan_id) SELECT state FROM current JOIN updated ON true`,
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
      const terminalJournalState =
        v.state === "EXPIRED"
          ? "EXPIRED"
          : v.state === "BLOCKED" || v.state === "FAILED"
            ? "FAILED"
            : v.state === "RECONCILED" || v.state === "COMPLETED"
              ? "RECONCILED"
              : undefined;
      if (terminalJournalState)
        await db.query(
          `UPDATE execution.execution_journal SET state=$2,updated_at=$3,payload=payload||jsonb_build_object('terminalPlanState',$4::text,'terminalizedAt',$3::timestamptz) WHERE plan_id=$1 AND state IN ('PLAN_CREATED','BUILT','SIMULATED','APPROVED','SIGNING','SIGNED','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED','RECONCILIATION_REQUIRED')`,
          [v.planId, terminalJournalState, v.at, v.state],
        );
    },
    async completeAutonomousPlan(v) {
      await db.query(
        `UPDATE execution.transaction_plans SET state=$2,payload=payload||jsonb_build_object('autonomous_dispatch_completed_at',$3::text,'autonomous_dispatch',COALESCE(payload->'autonomous_dispatch','{}'::jsonb)||$4::jsonb) WHERE plan_id=$1`,
        [v.planId, v.state, v.at, json(v.payload)],
      );
      const terminalJournalState =
        v.state === "BLOCKED" || v.state === "FAILED"
          ? "FAILED"
          : v.state === "RECONCILED" || v.state === "COMPLETED"
            ? "RECONCILED"
            : undefined;
      if (terminalJournalState)
        await db.query(
          `UPDATE execution.execution_journal SET state=$2,updated_at=$3::timestamptz,payload=payload||jsonb_build_object('terminalPlanState',$4::text,'terminalizedAt',$3::text) WHERE plan_id=$1 AND state IN ('PLAN_CREATED','BUILT','SIMULATED','APPROVED','SIGNING','SIGNED','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED','RECONCILIATION_REQUIRED')`,
          [v.planId, terminalJournalState, v.at, v.state],
        );
    },
    async upsertOwnedPosition(v) {
      await db.query(
        `INSERT INTO execution.owned_positions(lpforge_position_id,pool_address,position_address,owner_address,strategy,orientation,lower_bin_id,upper_bin_id,active_bin_at_entry,initial_capital_lamports,entry_plan_id,entry_signature,entry_slot,entered_at,lifecycle_state,last_plan_id,reconciliation_status,last_reconciled_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb) ON CONFLICT(lpforge_position_id) DO UPDATE SET lifecycle_state=EXCLUDED.lifecycle_state,last_plan_id=COALESCE(EXCLUDED.last_plan_id,execution.owned_positions.last_plan_id),reconciliation_status=EXCLUDED.reconciliation_status,entry_signature=COALESCE(EXCLUDED.entry_signature,execution.owned_positions.entry_signature),entry_slot=COALESCE(EXCLUDED.entry_slot,execution.owned_positions.entry_slot),last_reconciled_at=EXCLUDED.last_reconciled_at,payload=EXCLUDED.payload`,
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
          v.entrySlot?.toString() ?? null,
          v.enteredAt,
          v.lifecycleState,
          v.lastPlanId ?? null,
          v.reconciliationStatus,
          v.enteredAt,
          json(v.payload),
        ],
      );
      await db.query("INSERT INTO execution.position_lifecycles(lifecycle_id,position_address,entry_plan_id,owner_address,pool_address,status,created_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb) ON CONFLICT(position_address) DO UPDATE SET entry_plan_id=COALESCE(execution.position_lifecycles.entry_plan_id,EXCLUDED.entry_plan_id)",[`lifecycle:${v.positionAddress}`,v.positionAddress,v.entryPlanId??null,v.ownerAddress,v.poolAddress,v.lifecycleState==='RECONCILIATION_REQUIRED'?'RECONCILIATION_REQUIRED':v.lifecycleState==='CLOSED'?'CLOSED':'OPEN',v.enteredAt]);
      if(v.entryPlanId)await db.query("INSERT INTO execution.lifecycle_plan_links(lifecycle_id,plan_id,role,linked_at) VALUES($1,$2,'ENTRY',$3) ON CONFLICT DO NOTHING",[`lifecycle:${v.positionAddress}`,v.entryPlanId,v.enteredAt]);
      if(v.entryPlanId){const lineage=await db.query("INSERT INTO research.lifecycle_prediction_lineage(lifecycle_id,entry_plan_id,thesis_id,recommendation_id,prediction_id,linked_at,payload) SELECT $1,p.plan_id,t.thesis_id,t.recommendation_id,t.recommendation_id,$3,jsonb_build_object('predictionAuthority','PHASE3_RECOMMENDATION') FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id JOIN research.lp_theses t ON t.thesis_id=i.thesis_id WHERE p.plan_id=$2 ON CONFLICT(lifecycle_id) DO NOTHING RETURNING lifecycle_id",[`lifecycle:${v.positionAddress}`,v.entryPlanId,v.enteredAt]);if(!lineage.rows[0]){const existing=await db.query("SELECT lifecycle_id FROM research.lifecycle_prediction_lineage WHERE lifecycle_id=$1",[`lifecycle:${v.positionAddress}`]);if(!existing.rows[0])throw new Error("LPFORGE_LIVE_OUTCOME_PREDICTION_LINEAGE_MISSING");}}
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
    async loadLatestPositionManagementMetrics(lpforgePositionId) {
      const r=await db.query("SELECT * FROM execution.position_management_metrics WHERE lpforge_position_id=$1 ORDER BY observed_at DESC LIMIT 1",[lpforgePositionId]);
      return (r.rows[0] as Record<string,unknown>|undefined)??null;
    },
    async insertPositionManagementMetrics(v) {
      await db.query(
        `INSERT INTO execution.position_management_metrics(lpforge_position_id,observed_at,policy_version,managed_nav_usd,current_return_fraction,inventory_value_usd,cumulative_gross_fees_usd,mfe_managed_nav_usd,mfe_return_fraction,mfe_observed_at,mfe_active_bin,mfe_inventory_value_usd,mfe_cumulative_gross_fees_usd,inventory_deterioration_since_mfe_usd,gross_fees_since_mfe_usd,fee_compensation_ratio,economic_classification,token_inventory_share,sol_inventory_share,flow_evidence_status,continuation_evidence_available,continuation_evidence_age_seconds,continuation_expected_net_ev_lamports,continuation_uncertainty,continuation_reason_codes,management_hold_classification,action_lane_state,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb,$26,$27,$28::jsonb) ON CONFLICT(lpforge_position_id,observed_at) DO UPDATE SET managed_nav_usd=COALESCE(EXCLUDED.managed_nav_usd,execution.position_management_metrics.managed_nav_usd),current_return_fraction=COALESCE(EXCLUDED.current_return_fraction,execution.position_management_metrics.current_return_fraction),inventory_value_usd=COALESCE(EXCLUDED.inventory_value_usd,execution.position_management_metrics.inventory_value_usd),cumulative_gross_fees_usd=COALESCE(EXCLUDED.cumulative_gross_fees_usd,execution.position_management_metrics.cumulative_gross_fees_usd),mfe_managed_nav_usd=COALESCE(EXCLUDED.mfe_managed_nav_usd,execution.position_management_metrics.mfe_managed_nav_usd),mfe_return_fraction=COALESCE(EXCLUDED.mfe_return_fraction,execution.position_management_metrics.mfe_return_fraction),mfe_observed_at=COALESCE(EXCLUDED.mfe_observed_at,execution.position_management_metrics.mfe_observed_at),mfe_active_bin=COALESCE(EXCLUDED.mfe_active_bin,execution.position_management_metrics.mfe_active_bin),mfe_inventory_value_usd=COALESCE(EXCLUDED.mfe_inventory_value_usd,execution.position_management_metrics.mfe_inventory_value_usd),mfe_cumulative_gross_fees_usd=COALESCE(EXCLUDED.mfe_cumulative_gross_fees_usd,execution.position_management_metrics.mfe_cumulative_gross_fees_usd),inventory_deterioration_since_mfe_usd=COALESCE(EXCLUDED.inventory_deterioration_since_mfe_usd,execution.position_management_metrics.inventory_deterioration_since_mfe_usd),gross_fees_since_mfe_usd=COALESCE(EXCLUDED.gross_fees_since_mfe_usd,execution.position_management_metrics.gross_fees_since_mfe_usd),fee_compensation_ratio=COALESCE(EXCLUDED.fee_compensation_ratio,execution.position_management_metrics.fee_compensation_ratio),economic_classification=EXCLUDED.economic_classification,token_inventory_share=COALESCE(EXCLUDED.token_inventory_share,execution.position_management_metrics.token_inventory_share),sol_inventory_share=COALESCE(EXCLUDED.sol_inventory_share,execution.position_management_metrics.sol_inventory_share),flow_evidence_status=EXCLUDED.flow_evidence_status,continuation_evidence_available=EXCLUDED.continuation_evidence_available,continuation_evidence_age_seconds=EXCLUDED.continuation_evidence_age_seconds,continuation_expected_net_ev_lamports=EXCLUDED.continuation_expected_net_ev_lamports,continuation_uncertainty=EXCLUDED.continuation_uncertainty,continuation_reason_codes=EXCLUDED.continuation_reason_codes,management_hold_classification=EXCLUDED.management_hold_classification,action_lane_state=EXCLUDED.action_lane_state,payload=EXCLUDED.payload`,
        [v.lpforgePositionId,v.observedAt,v.policyVersion,v.managedNavUsd??null,v.currentReturnFraction??null,v.inventoryValueUsd??null,v.cumulativeGrossFeesUsd??null,v.mfeManagedNavUsd??null,v.mfeReturnFraction??null,v.mfeObservedAt?toIsoTimestamp(v.mfeObservedAt):null,v.mfeActiveBin??null,v.mfeInventoryValueUsd??null,v.mfeCumulativeGrossFeesUsd??null,v.inventoryDeteriorationSinceMfeUsd??null,v.grossFeesSinceMfeUsd??null,v.feeCompensationRatio??null,v.economicClassification,v.tokenInventoryShare??null,v.solInventoryShare??null,v.flowEvidenceStatus,v.continuationEvidenceAvailable,v.continuationEvidenceAgeSeconds??null,v.continuationExpectedNetEvLamports?.toString()??null,v.continuationUncertainty??null,json(v.continuationReasonCodes),v.managementHoldClassification,v.actionLaneState,json(v.payload)],
      );
    },
    async loadPositionOorLifecycleState(positionAddress) {
      const r=await db.query("SELECT * FROM execution.position_oor_lifecycle_state WHERE position_address=$1",[positionAddress]);
      return (r.rows[0] as Record<string,unknown>|undefined)??null;
    },
    async reconstructPositionOorLifecycleState(positionAddress) {
      const r=await db.query("WITH o AS (SELECT observed_at,range_state,lag(range_state) OVER(ORDER BY observed_at) AS prior_state,lead(observed_at) OVER(ORDER BY observed_at) AS next_observed FROM execution.position_observations WHERE lpforge_position_id=(SELECT lpforge_position_id FROM execution.owned_positions WHERE position_address=$1)), last_state AS (SELECT range_state,observed_at FROM o ORDER BY observed_at DESC LIMIT 1), last_in AS (SELECT max(observed_at) AS observed_at FROM o WHERE range_state='IN_RANGE') SELECT (SELECT range_state FROM last_state) AS range_state,(SELECT min(observed_at) FROM o WHERE range_state='OUT_OF_RANGE') AS first_oor_detected_at,(SELECT min(observed_at) FROM o WHERE range_state='OUT_OF_RANGE' AND observed_at>COALESCE((SELECT observed_at FROM last_in),'-infinity'::timestamptz)) AS continuous_oor_started_at,(SELECT max(observed_at) FROM o) AS latest_observed_at,(SELECT max(observed_at) FROM o WHERE range_state='IN_RANGE') AS last_reentered_at,COALESCE(count(*) FILTER(WHERE range_state='OUT_OF_RANGE' AND prior_state IS DISTINCT FROM 'OUT_OF_RANGE'),0)::int AS oor_excursion_count,COALESCE(sum(GREATEST(0,EXTRACT(EPOCH FROM (COALESCE(next_observed,observed_at)-observed_at)))::bigint) FILTER(WHERE range_state='OUT_OF_RANGE'),0)::bigint AS total_oor_duration_seconds FROM o",[positionAddress]);
      const row=r.rows[0] as Record<string,unknown>|undefined;
      return row?.latest_observed_at?row??null:null;
    },
    async upsertPositionOorLifecycleState(v) {
      const firstOorDetectedAt=v.firstOorDetectedAt?toIsoTimestamp(v.firstOorDetectedAt):null;
      const continuousOorStartedAt=v.continuousOorStartedAt?toIsoTimestamp(v.continuousOorStartedAt):null;
      const latestObservedAt=toIsoTimestamp(v.latestObservedAt);
      const lastReenteredAt=v.lastReenteredAt?toIsoTimestamp(v.lastReenteredAt):null;
      const chainObservedAt=v.chainObservedAt?toIsoTimestamp(v.chainObservedAt):null;
      await db.query("INSERT INTO execution.position_oor_lifecycle_state(lpforge_position_id,position_address,pool_address,policy_version,range_state,lifecycle_state,direction,inventory_classification,first_oor_detected_at,continuous_oor_started_at,latest_observed_at,last_reentered_at,oor_excursion_count,total_oor_duration_seconds,continuous_oor_duration_seconds,last_active_bin_id,lower_bin_id,upper_bin_id,fee_value_at_oor_start_lamports,fee_value_lamports,fee_since_oor_lamports,active_fee_rate_lamports_per_hour,recommendation,reason_codes,chain_observed_at,chain_slot,payload,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25,$26,$27::jsonb,$11) ON CONFLICT(position_address) DO UPDATE SET policy_version=EXCLUDED.policy_version,range_state=EXCLUDED.range_state,lifecycle_state=EXCLUDED.lifecycle_state,direction=EXCLUDED.direction,inventory_classification=EXCLUDED.inventory_classification,first_oor_detected_at=COALESCE(execution.position_oor_lifecycle_state.first_oor_detected_at,EXCLUDED.first_oor_detected_at),continuous_oor_started_at=EXCLUDED.continuous_oor_started_at,latest_observed_at=GREATEST(execution.position_oor_lifecycle_state.latest_observed_at,EXCLUDED.latest_observed_at),last_reentered_at=EXCLUDED.last_reentered_at,oor_excursion_count=GREATEST(execution.position_oor_lifecycle_state.oor_excursion_count,EXCLUDED.oor_excursion_count),total_oor_duration_seconds=GREATEST(execution.position_oor_lifecycle_state.total_oor_duration_seconds,EXCLUDED.total_oor_duration_seconds),continuous_oor_duration_seconds=EXCLUDED.continuous_oor_duration_seconds,last_active_bin_id=EXCLUDED.last_active_bin_id,lower_bin_id=EXCLUDED.lower_bin_id,upper_bin_id=EXCLUDED.upper_bin_id,fee_value_at_oor_start_lamports=CASE WHEN EXCLUDED.range_state='OUT_OF_RANGE' THEN COALESCE(execution.position_oor_lifecycle_state.fee_value_at_oor_start_lamports,EXCLUDED.fee_value_at_oor_start_lamports) ELSE NULL END,fee_value_lamports=EXCLUDED.fee_value_lamports,fee_since_oor_lamports=EXCLUDED.fee_since_oor_lamports,active_fee_rate_lamports_per_hour=EXCLUDED.active_fee_rate_lamports_per_hour,recommendation=EXCLUDED.recommendation,reason_codes=EXCLUDED.reason_codes,chain_observed_at=EXCLUDED.chain_observed_at,chain_slot=EXCLUDED.chain_slot,payload=EXCLUDED.payload,updated_at=EXCLUDED.updated_at",[v.lpforgePositionId,v.positionAddress,v.poolAddress,v.policyVersion,v.rangeState,v.lifecycleState,v.direction??null,v.inventoryClassification,firstOorDetectedAt,continuousOorStartedAt,latestObservedAt,lastReenteredAt,v.excursionCount,v.totalOorDurationSeconds,v.continuousOorDurationSeconds,v.activeBinId??null,v.lowerBinId,v.upperBinId,v.feeValueAtOorStartLamports?.toString()??null,v.feeValueLamports?.toString()??null,v.feeSinceOorLamports?.toString()??null,v.activeFeeRateLamportsPerHour?.toString()??null,v.recommendation,json(v.reasonCodes),chainObservedAt,v.chainSlot?.toString()??null,json(v.payload)]);
    },
    async insertPositionManagementDecisionAudit(v){await db.query("INSERT INTO execution.position_management_decision_audit(lpforge_position_id,position_address,observed_at,active_bin_id,lower_bin_id,upper_bin_id,position_continuation_ev_lamports,expected_close_cost_lamports,uncertainty,forecast_horizon_minutes,source_decision_id,source_economics_id,geometry_identity,management_action,exit_reason_family,reason_codes,confirmation_sequence_count,valid_continuation_evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18) ON CONFLICT(lpforge_position_id,observed_at) DO NOTHING",[v.lpforgePositionId,v.positionAddress,v.observedAt,v.activeBinId??null,v.lowerBinId,v.upperBinId,v.positionContinuationEvLamports?.toString()??null,v.expectedCloseCostLamports?.toString()??null,v.uncertainty??null,v.forecastHorizonMinutes??null,v.sourceDecisionId??null,v.sourceEconomicsId??null,v.geometryIdentity,v.managementAction,v.exitReasonFamily,json(v.reasonCodes),v.confirmationSequenceCount,v.validContinuationEvidence]);},
    async loadOwnedPositions(ownerAddress) {
      const r = await db.query(
        `SELECT * FROM execution.owned_positions WHERE owner_address=$1 AND lifecycle_state IN ('OPEN','CLOSING','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN') ORDER BY entered_at ASC`,
        [ownerAddress],
      );
      return r.rows;
    },
    async upsertWalletPositionDiscovery(v) {
      await db.query(
        `INSERT INTO execution.wallet_position_discoveries(owner_address,position_address,pool_address,classification,lpforge_position_id,execution_plan_id,first_seen_at,last_seen_at,last_reconciled_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT(owner_address,position_address) DO UPDATE SET pool_address=EXCLUDED.pool_address,classification=EXCLUDED.classification,lpforge_position_id=COALESCE(EXCLUDED.lpforge_position_id,execution.wallet_position_discoveries.lpforge_position_id),execution_plan_id=COALESCE(EXCLUDED.execution_plan_id,execution.wallet_position_discoveries.execution_plan_id),last_seen_at=EXCLUDED.last_seen_at,last_reconciled_at=EXCLUDED.last_reconciled_at,payload=EXCLUDED.payload`,
        [v.ownerAddress,v.positionAddress,v.poolAddress??null,v.classification,v.lpforgePositionId??null,v.executionPlanId??null,v.firstSeenAt,v.lastSeenAt,v.lastReconciledAt,json(v.payload)],
      );
    },
    async loadWalletPositionDiscoveries(ownerAddress) {
      const r=await db.query(`SELECT owner_address,position_address,pool_address,classification,lpforge_position_id,execution_plan_id,first_seen_at,last_seen_at,last_reconciled_at,payload FROM execution.wallet_position_discoveries WHERE owner_address=$1 ORDER BY last_reconciled_at DESC,position_address ASC`,[ownerAddress]);
      return r.rows.map(row=>({ownerAddress:String(row.owner_address),positionAddress:String(row.position_address),...(row.pool_address?{poolAddress:String(row.pool_address)}:{}),classification:String(row.classification) as WalletPositionClassification,...(row.lpforge_position_id?{lpforgePositionId:String(row.lpforge_position_id)}:{}),...(row.execution_plan_id?{executionPlanId:String(row.execution_plan_id)}:{}),firstSeenAt:toIsoTimestamp(row.first_seen_at),lastSeenAt:toIsoTimestamp(row.last_seen_at),lastReconciledAt:toIsoTimestamp(row.last_reconciled_at),payload:(row.payload??{}) as Record<string,unknown>}));
    },
    async findAutonomousOpenPlansByPosition(v) {
      const r=await db.query(
        `SELECT p.plan_id,p.intent_id,p.state,p.expires_at,p.payload AS plan_payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload AS intent_payload,COALESCE(json_agg(json_build_object('transactionId',s.transaction_id,'sequence',s.sequence,'kind',s.kind,'state',s.state,'requiredSignerAddresses',s.required_signers,'metadata',s.metadata) ORDER BY s.sequence) FILTER (WHERE s.transaction_id IS NOT NULL),'[]'::json) AS steps FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id LEFT JOIN execution.execution_journal j ON j.plan_id=p.plan_id LEFT JOIN execution.transaction_steps s ON s.plan_id=p.plan_id WHERE p.cluster='mainnet-beta' AND i.action='OPEN' AND i.owner_address=$1 AND i.pool_address=$2 AND (i.position_address=$3 OR p.payload->'autonomous_dispatch'->>'positionAddress'=$3 OR p.payload->'autonomous_dispatch'->>'generatedPositionAddress'=$3 OR j.payload->>'positionAddress'=$3 OR j.payload->>'generatedPositionAddress'=$3) GROUP BY p.plan_id,p.intent_id,p.state,p.expires_at,p.payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload ORDER BY p.plan_id ASC`,
        [v.ownerAddress,v.poolAddress,v.positionAddress],
      );
      return r.rows.map(autonomousPlanFromRow);
    },
    async loadOwnedPoolHistory(ownerAddress){const r=await db.query("SELECT DISTINCT o.pool_address,p.token_x_mint,p.token_y_mint FROM execution.owned_positions o LEFT JOIN protocol.pools p ON p.address=o.pool_address WHERE o.owner_address=$1",[ownerAddress]);return r.rows.map(row=>({poolAddress:String(row.pool_address),...(row.token_x_mint?{tokenXMint:String(row.token_x_mint)}:{}),...(row.token_y_mint?{tokenYMint:String(row.token_y_mint)}:{})}));},
    async loadPhase7PortfolioFacts(ownerAddress){const [positions,reservations,recon,pending]=await Promise.all([db.query("SELECT COALESCE(sum(o.initial_capital_lamports),0)::text AS deployed,count(*)::int AS open_positions,COALESCE((SELECT jsonb_object_agg(g.pool_address,g.deployed) FROM (SELECT p.address AS pool_address,COALESCE(sum(o2.initial_capital_lamports),0) AS deployed FROM execution.owned_positions o2 JOIN protocol.pools p ON p.address=o2.pool_address WHERE o2.owner_address=$1 AND o2.lifecycle_state IN ('OPEN','CLOSING','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN') GROUP BY p.address) g),'{}'::jsonb) AS by_pool,COALESCE((SELECT jsonb_object_agg(g.token_x_mint,g.deployed) FROM (SELECT p.token_x_mint,COALESCE(sum(o3.initial_capital_lamports),0) AS deployed FROM execution.owned_positions o3 JOIN protocol.pools p ON p.address=o3.pool_address WHERE o3.owner_address=$1 AND o3.lifecycle_state IN ('OPEN','CLOSING','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN') AND p.token_x_mint IS NOT NULL GROUP BY p.token_x_mint) g),'{}'::jsonb) AS by_token FROM execution.owned_positions o WHERE o.owner_address=$1 AND o.lifecycle_state IN ('OPEN','CLOSING','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN')",[ownerAddress]),db.query("SELECT COALESCE(sum(capital_lamports),0)::text AS reserved,COALESCE((SELECT jsonb_object_agg(g.pool_address,g.reserved) FROM (SELECT pool_address,COALESCE(sum(capital_lamports),0) AS reserved FROM execution.capital_reservations WHERE owner_address=$1 AND state IN ('RESERVED','SUBMITTED') AND pool_address IS NOT NULL GROUP BY pool_address) g),'{}'::jsonb) AS by_pool,COALESCE((SELECT jsonb_object_agg(g.token_mint,g.reserved) FROM (SELECT token_mint,COALESCE(sum(capital_lamports),0) AS reserved FROM execution.capital_reservations WHERE owner_address=$1 AND state IN ('RESERVED','SUBMITTED') AND token_mint IS NOT NULL GROUP BY token_mint) g),'{}'::jsonb) AS by_token FROM execution.capital_reservations WHERE owner_address=$1 AND state IN ('RESERVED','SUBMITTED')",[ownerAddress]),db.query("SELECT count(*)::int AS n FROM execution.owned_positions WHERE owner_address=$1 AND lifecycle_state IN ('RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN')",[ownerAddress]),db.query("SELECT count(DISTINCT p.plan_id)::int AS n FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id WHERE i.owner_address=$1 AND p.state <> ALL($2::text[])",[ownerAddress,EXECUTION_TERMINAL_PLAN_STATES])]);const map=(v:unknown)=>Object.fromEntries(Object.entries((v??{}) as Record<string,unknown>).map(([k,x])=>[k,BigInt(String(x))]));return{deployedLamports:BigInt(String(positions.rows[0]?.deployed??'0')),pendingReservedLamports:BigInt(String(reservations.rows[0]?.reserved??'0')),pendingExecutionCount:Number(pending.rows[0]?.n??0),openPositions:Number(positions.rows[0]?.open_positions??0),unresolvedReconciliationDebt:Number(recon.rows[0]?.n??0),poolExposureLamports:map(positions.rows[0]?.by_pool),poolPendingLamports:map(reservations.rows[0]?.by_pool),tokenExposureLamports:map(positions.rows[0]?.by_token),tokenPendingLamports:map(reservations.rows[0]?.by_token)};},
    async loadPhase7PortfolioRiskState(ownerAddress){const r=await db.query("SELECT * FROM operations.phase7_live_portfolio_risk_state WHERE owner_address=$1",[ownerAddress]);return r.rows[0] as Record<string,unknown>|undefined;},
    async upsertPhase7PortfolioRiskState(v){await db.query("INSERT INTO operations.phase7_live_portfolio_risk_state(owner_address,day_start,daily_start_equity_lamports,peak_equity_lamports,current_equity_lamports,observed_at,valuation_state,reason_codes,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) ON CONFLICT(owner_address) DO UPDATE SET day_start=EXCLUDED.day_start,daily_start_equity_lamports=EXCLUDED.daily_start_equity_lamports,peak_equity_lamports=EXCLUDED.peak_equity_lamports,current_equity_lamports=EXCLUDED.current_equity_lamports,observed_at=EXCLUDED.observed_at,valuation_state=EXCLUDED.valuation_state,reason_codes=EXCLUDED.reason_codes,payload=EXCLUDED.payload",[v.ownerAddress,v.dayStart,v.dailyStartEquityLamports.toString(),v.peakEquityLamports.toString(),v.currentEquityLamports.toString(),v.observedAt,v.valuationState,json(v.reasonCodes),json(v.payload)]);},
    async loadPositionExitState(lpforgePositionId) {
      const r=await db.query(`SELECT * FROM execution.position_exit_state WHERE lpforge_position_id=$1`,[lpforgePositionId]);
      return (r.rows[0] as Record<string,unknown>|undefined)??null;
    },
    async upsertPositionExitState(v) {
      // Exit governance can carry the high-water timestamp as a Date.  Normalize
      // it at the PostgreSQL boundary; Date#toString() is not a timestamptz value.
      const peakObservedAt=toIsoTimestamp(v.peakObservedAt);
      await db.query(`INSERT INTO execution.position_exit_state(lpforge_position_id,observed_at,evidence_state,initial_capital_usd,current_economic_value_usd,net_pnl_usd,net_return_fraction,peak_net_return_fraction,peak_economic_value_usd,peak_observed_at,last_action,last_reason_codes,payload,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$2) ON CONFLICT(lpforge_position_id) DO UPDATE SET observed_at=EXCLUDED.observed_at,evidence_state=EXCLUDED.evidence_state,initial_capital_usd=COALESCE(EXCLUDED.initial_capital_usd,execution.position_exit_state.initial_capital_usd),current_economic_value_usd=EXCLUDED.current_economic_value_usd,net_pnl_usd=EXCLUDED.net_pnl_usd,net_return_fraction=EXCLUDED.net_return_fraction,peak_net_return_fraction=GREATEST(execution.position_exit_state.peak_net_return_fraction,EXCLUDED.peak_net_return_fraction),peak_economic_value_usd=CASE WHEN EXCLUDED.peak_net_return_fraction>=execution.position_exit_state.peak_net_return_fraction THEN EXCLUDED.peak_economic_value_usd ELSE execution.position_exit_state.peak_economic_value_usd END,peak_observed_at=CASE WHEN EXCLUDED.peak_net_return_fraction>=execution.position_exit_state.peak_net_return_fraction THEN EXCLUDED.peak_observed_at ELSE execution.position_exit_state.peak_observed_at END,last_action=EXCLUDED.last_action,last_reason_codes=EXCLUDED.last_reason_codes,payload=EXCLUDED.payload,updated_at=EXCLUDED.updated_at`,[v.lpforgePositionId,v.observedAt,v.evidenceState,v.initialCapitalUsd??null,v.currentEconomicValueUsd??null,v.netPnlUsd??null,v.netReturnFraction??null,v.peakNetReturnFraction,v.peakEconomicValueUsd??null,peakObservedAt,v.lastAction,json(v.reasonCodes),json(v.payload)]);
    },
    async hasActiveAutonomousPlan(positionAddress) {
      const r = await db.query(
        `SELECT EXISTS(SELECT 1 FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id WHERE i.position_address=$1 AND p.cluster='mainnet-beta' AND p.state IN ('PLANNED','CLAIMED','DISPATCHING','BUILDING','BUILT','SIMULATING','SIMULATED','RISK_APPROVED','SIGNING','SIGNED','SUBMITTING','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED','RECONCILING','RECOVERING','RECONCILIATION_REQUIRED')) AS active`,
        [positionAddress],
      );
      return Boolean(r.rows[0]?.active);
    },
    async loadActiveAutonomousPlansForPosition(positionAddress) {
      const r=await db.query(`SELECT p.plan_id,i.action,p.state,p.created_at,p.expires_at FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id WHERE i.position_address=$1 AND p.cluster='mainnet-beta' AND p.state IN ('PLANNED','CLAIMED','DISPATCHING','BUILDING','BUILT','SIMULATING','SIMULATED','RISK_APPROVED','SIGNING','SIGNED','SUBMITTING','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED','RECONCILING','RECOVERING','RECONCILIATION_REQUIRED') ORDER BY p.created_at ASC`,[positionAddress]);
      return r.rows.map(row=>({planId:String(row.plan_id),action:String(row.action) as AutonomousPlanAction,state:String(row.state),createdAt:toIsoTimestamp(row.created_at),expiresAt:toIsoTimestamp(row.expires_at)}));
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
      if(v.lifecycleState==='RECONCILIATION_REQUIRED')await db.query("UPDATE execution.position_lifecycles SET status='RECONCILIATION_REQUIRED' WHERE position_address=$1 AND status<>'SOL_SETTLED'",[v.positionAddress]);
      if(v.lifecycleState==='CLOSED')await db.query("UPDATE execution.position_lifecycles SET status='CLOSED' WHERE position_address=$1 AND status<>'SOL_SETTLED'",[v.positionAddress]);
    },
    async adjustOwnedPositionCapital(v) {
      await db.query(
        `UPDATE execution.owned_positions SET initial_capital_lamports=$2,payload=payload||jsonb_build_object('capital_adjustments',COALESCE(payload->'capital_adjustments','[]'::jsonb)||jsonb_build_array(jsonb_build_object('capitalLamports',$2::text,'at',$3::text,'detail',$4::jsonb))) WHERE position_address=$1`,
        [v.positionAddress, v.capitalLamports.toString(), v.at, json(v.payload)],
      );
    },
    async insertPositionCashflow(v){await db.query("INSERT INTO execution.position_cashflows(cashflow_id,position_address,plan_id,flow_type,observed_at,lamports,token_mint,token_amount_raw,payload,lifecycle_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,(SELECT lifecycle_id FROM execution.position_lifecycles WHERE position_address=$2)) ON CONFLICT(cashflow_id) DO UPDATE SET lamports=EXCLUDED.lamports,token_mint=EXCLUDED.token_mint,token_amount_raw=EXCLUDED.token_amount_raw,payload=EXCLUDED.payload",[v.cashflowId,v.positionAddress,v.planId,v.flowType,v.observedAt,v.lamports?.toString()??null,v.tokenMint??null,v.tokenAmountRaw??null,json(v.payload)]);},
    async loadPositionCashflows(positionAddress){const r=await db.query("SELECT flow_type,lamports,token_mint,token_amount_raw,payload FROM execution.position_cashflows WHERE position_address=$1 ORDER BY observed_at ASC,cashflow_id ASC",[positionAddress]);return r.rows.map(row=>({flowType:String(row.flow_type),...(row.lamports!==null&&row.lamports!==undefined?{lamports:BigInt(String(row.lamports))}:{}),...(row.token_mint?{tokenMint:String(row.token_mint)}:{}),...(row.token_amount_raw?{tokenAmountRaw:String(row.token_amount_raw)}:{}),...(row.payload&&typeof row.payload==='object'?{payload:row.payload as Record<string,unknown>}:{})}));},
    async ensurePositionLifecycle(v){
      const lifecycleId=`lifecycle:${v.positionAddress}`;
      const r=await db.query("INSERT INTO execution.position_lifecycles(lifecycle_id,position_address,entry_plan_id,owner_address,pool_address,predecessor_lifecycle_id,status,created_at,payload) VALUES($1,$2,$3,$4,$5,$6,'OPEN',$7,'{}'::jsonb) ON CONFLICT(position_address) DO UPDATE SET entry_plan_id=COALESCE(execution.position_lifecycles.entry_plan_id,EXCLUDED.entry_plan_id),predecessor_lifecycle_id=COALESCE(execution.position_lifecycles.predecessor_lifecycle_id,EXCLUDED.predecessor_lifecycle_id) RETURNING lifecycle_id,position_address,entry_plan_id,owner_address,pool_address,predecessor_lifecycle_id,status",[lifecycleId,v.positionAddress,v.entryPlanId??null,v.ownerAddress,v.poolAddress,v.predecessorLifecycleId??null,v.at]);
      if(v.entryPlanId)await db.query("INSERT INTO execution.lifecycle_plan_links(lifecycle_id,plan_id,role,linked_at) VALUES($1,$2,'ENTRY',$3) ON CONFLICT DO NOTHING",[lifecycleId,v.entryPlanId,v.at]);
      const row=r.rows[0]!;return{lifecycleId:String(row.lifecycle_id),positionAddress:String(row.position_address),...(row.entry_plan_id?{entryPlanId:String(row.entry_plan_id)}:{}),ownerAddress:String(row.owner_address),poolAddress:String(row.pool_address),...(row.predecessor_lifecycle_id?{predecessorLifecycleId:String(row.predecessor_lifecycle_id)}:{}),status:String(row.status) as PositionLifecycle["status"]};
    },
    async linkPositionLifecyclePlan(v){
      const r=await db.query("SELECT lifecycle_id FROM execution.position_lifecycles WHERE position_address=$1",[v.positionAddress]);if(!r.rows[0])throw new Error("LPFORGE_LIFECYCLE_MISSING");
      await db.query("INSERT INTO execution.lifecycle_plan_links(lifecycle_id,plan_id,role,linked_at) VALUES($1,$2,$3,$4) ON CONFLICT(lifecycle_id,plan_id) DO NOTHING",[r.rows[0].lifecycle_id,v.planId,v.role,v.at]);
    },
    async loadLifecycleSettlementInput(positionAddress){
      const lr=await db.query("SELECT lifecycle_id,position_address,entry_plan_id,owner_address,pool_address,predecessor_lifecycle_id,status FROM execution.position_lifecycles WHERE position_address=$1",[positionAddress]);if(!lr.rows[0])return undefined;const l=lr.rows[0];
      const [cash,lots,tx,res]=await Promise.all([
        db.query("SELECT cashflow_id,plan_id,flow_type,lamports,token_mint,token_amount_raw,payload FROM execution.position_cashflows WHERE lifecycle_id=$1 ORDER BY observed_at,cashflow_id",[l.lifecycle_id]),
        db.query("SELECT lot_id,position_address,plan_id,owner_address,pool_address,token_mint,token_side,source_event,source_cashflow_id,raw_amount,remaining_raw_amount,decimals,acquired_at,status,payload FROM execution.position_inventory_lots WHERE lifecycle_id=$1 ORDER BY acquired_at,lot_id",[l.lifecycle_id]),
        db.query("SELECT link.plan_id,link.role,s.transaction_id,s.kind,a.signature,CASE WHEN s.kind='JUPITER_UNWIND' AND a.signature IS NULL AND p.payload #>> '{autonomous_dispatch,attributableTokenX}'='0' AND p.payload #>> '{autonomous_dispatch,attributableTokenY}'='0' THEN 'SKIPPED_NO_EFFECT' ELSE COALESCE(CASE WHEN a.state='EXPIRED' THEN 'EXPIRED' ELSE c.status END,a.state,CASE WHEN s.state IN ('CONFIRMED','COMPLETED') THEN 'CONFIRMED' ELSE s.state END) END state FROM execution.lifecycle_plan_links link JOIN execution.transaction_plans p ON p.plan_id=link.plan_id JOIN execution.transaction_steps s ON s.plan_id=link.plan_id LEFT JOIN LATERAL (SELECT attempt_id,signature,state FROM execution.submission_attempts WHERE transaction_id=s.transaction_id ORDER BY attempt DESC LIMIT 1) a ON true LEFT JOIN LATERAL (SELECT status FROM execution.confirmations WHERE attempt_id=a.attempt_id ORDER BY observed_at DESC LIMIT 1) c ON true WHERE link.lifecycle_id=$1 ORDER BY s.sequence",[l.lifecycle_id]),
        db.query("SELECT NOT EXISTS(SELECT 1 FROM execution.owned_positions WHERE position_address=$1 AND lifecycle_state='RECONCILIATION_REQUIRED') AS reconciliation_clean,NOT EXISTS(SELECT 1 FROM execution.capital_reservations r JOIN execution.lifecycle_plan_links link ON link.plan_id=r.plan_id WHERE link.lifecycle_id=$2 AND r.state IN ('RESERVED','SUBMITTED')) AS reservation_clean",[positionAddress,l.lifecycle_id])
      ]);
      const normalize=(state:string):LifecycleChildTransactionState=>state==='CONFIRMED'||state==='FINALIZED'||state==='SKIPPED_NO_EFFECT'?"CONFIRMED":state==='FAILED'||state==='EXPIRED'?"FAILED_FINAL":state==='PROVEN_NOT_LANDED'?"PROVEN_NOT_LANDED":state==='UNKNOWN'?"UNKNOWN":state==='SUBMITTED'||state==='SENT'||state==='PROCESSED'?"SUBMITTED":state==='PREPARED'?"CONFIRMATION_PENDING":"RECOVERY_PENDING";
      return {lifecycle:{lifecycleId:String(l.lifecycle_id),positionAddress:String(l.position_address),...(l.entry_plan_id?{entryPlanId:String(l.entry_plan_id)}:{}),ownerAddress:String(l.owner_address),poolAddress:String(l.pool_address),...(l.predecessor_lifecycle_id?{predecessorLifecycleId:String(l.predecessor_lifecycle_id)}:{}),status:String(l.status) as PositionLifecycle["status"]},cashflows:cash.rows.map(row=>({cashflowId:String(row.cashflow_id),flowType:String(row.flow_type),...(row.plan_id?{planId:String(row.plan_id)}:{}),...(row.lamports===null?{}:{lamports:BigInt(String(row.lamports))}),...(row.token_mint?{tokenMint:String(row.token_mint)}:{}),...(row.token_amount_raw===null?{}:{tokenAmountRaw:String(row.token_amount_raw)}),...(row.payload&&typeof row.payload==='object'?{payload:row.payload as Record<string,unknown>}:{})})),inventoryLots:lots.rows.map(row=>({lotId:String(row.lot_id),positionAddress:String(row.position_address),planId:String(row.plan_id),ownerAddress:String(row.owner_address),poolAddress:String(row.pool_address),tokenMint:String(row.token_mint),tokenSide:String(row.token_side) as PositionInventoryLotSide,sourceEvent:String(row.source_event) as PositionInventoryLotSource,...(row.source_cashflow_id?{sourceCashflowId:String(row.source_cashflow_id)}:{}),rawAmount:BigInt(String(row.raw_amount)),remainingRawAmount:BigInt(String(row.remaining_raw_amount)),decimals:Number(row.decimals),acquiredAt:toIsoTimestamp(row.acquired_at),status:String(row.status) as PositionInventoryLotStatus,payload:(row.payload??{}) as Record<string,unknown>})),transactions:tx.rows.map(row=>({transactionId:String(row.transaction_id),...(row.signature?{signature:String(row.signature)}:{}),...(row.plan_id?{planId:String(row.plan_id)}:{}),...(row.role?{planRole:String(row.role) as "ENTRY"|"MANAGEMENT"|"CLOSE"|"RECOVERY"}:{}),...(row.kind?{kind:String(row.kind)}:{}),state:normalize(String(row.state))})),reconciliationClean:Boolean(res.rows[0]?.reconciliation_clean),reservationClean:Boolean(res.rows[0]?.reservation_clean)};
    },
    async persistLifecycleSolSettlement(v){
      if(!v.assessment.ready)throw new Error(`LPFORGE_SETTLEMENT_NOT_READY:${v.assessment.reasonCodes.join(',')}`);
      const input=v.input,assessment=v.assessment,evidenceHash=await lifecycleSettlementEvidenceHash(input,assessment);
      await db.query("BEGIN");
      try{
        const priorResult=await db.query("SELECT settlement_id,settlement_version,evidence_hash FROM execution.lifecycle_sol_settlements WHERE lifecycle_id=$1 ORDER BY settlement_version DESC LIMIT 1 FOR UPDATE",[input.lifecycle.lifecycleId]),prior=priorResult.rows[0];
        if(prior&&String(prior.evidence_hash)===evidenceHash){await db.query("COMMIT");return{lifecycleId:input.lifecycle.lifecycleId,settlementId:String(prior.settlement_id),created:false};}
        const version=prior?Number(prior.settlement_version)+1:1,settlementId=`settlement:${input.lifecycle.lifecycleId}:v${version}`;
        await db.query("INSERT INTO execution.lifecycle_sol_settlements(settlement_id,lifecycle_id,settlement_version,position_address,owner_address,pool_address,entry_plan_id,total_sol_in_lamports,total_sol_out_lamports,rent_locked_lamports,rent_recovered_lamports,net_rent_cost_lamports,realized_sol_pnl_lamports,cashflow_count,inventory_lot_count,child_transaction_count,position_checked_at,position_checked_slot,reconciliation_verified_at,source_commit,policy_hash,migration_head,build_id,evidence_hash,settled_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb)",[settlementId,input.lifecycle.lifecycleId,version,input.lifecycle.positionAddress,input.lifecycle.ownerAddress,input.lifecycle.poolAddress,input.lifecycle.entryPlanId??null,assessment.totalSolInLamports.toString(),assessment.totalSolOutLamports.toString(),assessment.rentLockedLamports.toString(),assessment.rentRecoveredLamports.toString(),assessment.netRentCostLamports.toString(),assessment.realizedSolPnlLamports.toString(),input.cashflows.length,input.inventoryLots.length,input.transactions.length,input.positionCheckedAt,input.positionCheckedSlot?.toString()??null,v.at,v.sourceCommit??null,v.policyHash??null,v.migrationHead??null,v.buildId??null,evidenceHash,v.at,json({accountingConvention:'gross-sol-instruction-flows-v1',reasonCodes:assessment.reasonCodes,positionAbsence:{checkedAt:input.positionCheckedAt,slot:input.positionCheckedSlot?.toString()??null,commitment:'confirmed'},...(prior?{supersedesSettlementId:String(prior.settlement_id),supersedesSettlementVersion:Number(prior.settlement_version),supersessionReason:'ADDITIONAL_CONFIRMED_ATTRIBUTABLE_CASHFLOW'}:{})})]);
        await db.query("UPDATE execution.position_lifecycles SET status='SOL_SETTLED',settled_at=$2 WHERE lifecycle_id=$1",[input.lifecycle.lifecycleId,v.at]);
        // `payload.lifecycle` is an operational progress hint, not the lifecycle
        // authority.  Clear it atomically with the terminal columns so a prior
        // SETTLEMENT_BLOCKED hint cannot survive a successful, reconciled
        // SOL_SETTLED transition and mislead a later observer/recovery pass.
        await db.query("UPDATE execution.owned_positions SET lifecycle_state='SOL_SETTLED',reconciliation_status='MATCH',payload=payload-'lifecycle' WHERE position_address=$1",[input.lifecycle.positionAddress]);
        await db.query("COMMIT");return{lifecycleId:input.lifecycle.lifecycleId,settlementId,created:true,...(prior?{superseded:true}:{})};
      }catch(error){try{await db.query("ROLLBACK");}catch{}throw error;}
    },
    async upsertLifecycleSettlementChainReconciliation(v){
      const lifecycle=await db.query("SELECT lifecycle_id FROM execution.position_lifecycles WHERE position_address=$1",[v.positionAddress]);
      if(!lifecycle.rows[0])throw new Error("LPFORGE_SETTLEMENT_LIFECYCLE_MISSING");
      const chainNet=v.chainSolInLamports-v.chainSolOutLamports,dbNet=v.dbSolInLamports-v.dbSolOutLamports;
      await db.query("INSERT INTO execution.lifecycle_settlement_chain_reconciliations(lifecycle_id,position_address,close_plan_id,status,chain_sol_in_lamports,chain_sol_out_lamports,chain_net_sol_pnl_lamports,db_sol_in_lamports,db_sol_out_lamports,db_net_sol_pnl_lamports,difference_lamports,reason_codes,payload,observed_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$14) ON CONFLICT(lifecycle_id) DO UPDATE SET close_plan_id=EXCLUDED.close_plan_id,status=EXCLUDED.status,chain_sol_in_lamports=EXCLUDED.chain_sol_in_lamports,chain_sol_out_lamports=EXCLUDED.chain_sol_out_lamports,chain_net_sol_pnl_lamports=EXCLUDED.chain_net_sol_pnl_lamports,db_sol_in_lamports=EXCLUDED.db_sol_in_lamports,db_sol_out_lamports=EXCLUDED.db_sol_out_lamports,db_net_sol_pnl_lamports=EXCLUDED.db_net_sol_pnl_lamports,difference_lamports=EXCLUDED.difference_lamports,reason_codes=EXCLUDED.reason_codes,payload=EXCLUDED.payload,observed_at=EXCLUDED.observed_at,updated_at=EXCLUDED.updated_at",[String(lifecycle.rows[0].lifecycle_id),v.positionAddress,v.closePlanId,v.status,v.chainSolInLamports.toString(),v.chainSolOutLamports.toString(),chainNet.toString(),v.dbSolInLamports.toString(),v.dbSolOutLamports.toString(),dbNet.toString(),(chainNet-dbNet).toString(),json([...new Set(v.reasonCodes)].sort()),json(v.payload),v.observedAt]);
    },
    async upsertCloseFeeAttributionSnapshot(v){
      await db.query("BEGIN");
      try{
        const existing=await db.query("SELECT position_address,pool_address,owner_address,observed_slot,token_x_mint,token_y_mint,pre_close_fee_x_raw,pre_close_fee_y_raw FROM execution.close_fee_attributions WHERE close_plan_id=$1 FOR UPDATE",[v.closePlanId]);
        if(existing.rows[0]){
          const row=existing.rows[0];
          // A crash after the immutable snapshot but before the stage marker is safe: reuse the first plan-bound snapshot rather than replacing it with later state.
          const same=String(row.position_address)===v.positionAddress&&String(row.pool_address)===v.poolAddress&&String(row.owner_address)===v.ownerAddress&&String(row.token_x_mint)===v.tokenXMint&&String(row.token_y_mint)===v.tokenYMint;
          if(!same)throw new Error('LPFORGE_CLOSE_FEE_SNAPSHOT_IDENTITY_CONFLICT');
          await db.query("COMMIT");return;
        }
        await db.query("INSERT INTO execution.close_fee_attributions(close_plan_id,position_address,pool_address,owner_address,observed_slot,observed_at,observed_block_time,rpc_commitment,token_x_mint,token_y_mint,token_x_decimals,token_y_decimals,pre_close_fee_x_raw,pre_close_fee_y_raw,pre_close_reward_one_raw,pre_close_reward_two_raw,attribution_method,attribution_status,reason_codes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'POSITION_V2_PRE_CLOSE_REMOVE','PENDING',$17::jsonb)",[v.closePlanId,v.positionAddress,v.poolAddress,v.ownerAddress,v.observedSlot?.toString()??null,v.observedAt,v.observedBlockTime??null,v.commitment,v.tokenXMint,v.tokenYMint,v.tokenXDecimals??null,v.tokenYDecimals??null,v.preCloseFeeXRaw.toString(),v.preCloseFeeYRaw.toString(),v.preCloseRewardOneRaw.toString(),v.preCloseRewardTwoRaw.toString(),json([...(v.tokenXDecimals===undefined?['TOKEN_X_DECIMALS_UNAVAILABLE']:[]),...(v.tokenYDecimals===undefined?['TOKEN_Y_DECIMALS_UNAVAILABLE']:[])])]);
        await db.query("COMMIT");
      }catch(error){try{await db.query("ROLLBACK");}catch{}throw error;}
    },
    async finalizeCloseFeeAttribution(v){
      const snapshot=await db.query("SELECT * FROM execution.close_fee_attributions WHERE close_plan_id=$1",[v.closePlanId]),row=snapshot.rows[0];
      if(!row)return{status:'UNAVAILABLE' as const,reasonCodes:['PRE_CLOSE_POSITION_STATE_UNAVAILABLE']};
      if(row.finalized_at)return{status:String(row.attribution_status) as 'COMPLETE'|'PARTIAL'|'UNAVAILABLE',reasonCodes:Array.isArray(row.reason_codes)?row.reason_codes.map(String):[]};
      const [life,flows,settlement]=await Promise.all([db.query("SELECT l.lifecycle_id,o.initial_capital_lamports FROM execution.position_lifecycles l JOIN execution.owned_positions o ON o.position_address=l.position_address WHERE l.position_address=$1",[v.positionAddress]),db.query("SELECT plan_id,flow_type,lamports,token_mint,token_amount_raw,payload FROM execution.position_cashflows WHERE position_address=$1 ORDER BY observed_at,cashflow_id",[v.positionAddress]),db.query("SELECT realized_sol_pnl_lamports FROM execution.lifecycle_sol_settlements WHERE settlement_id=$1",[v.terminalSettlementId])]);
      if(!life.rows[0]||!settlement.rows[0])return{status:'UNAVAILABLE' as const,reasonCodes:['TERMINAL_SETTLEMENT_UNAVAILABLE']};
      const amount=(f:Record<string,unknown>)=>f.lamports!==null&&f.lamports!==undefined?BigInt(String(f.lamports)):f.token_mint===WSOL_MINT&&f.token_amount_raw!==null&&f.token_amount_raw!==undefined?BigInt(String(f.token_amount_raw)):0n;
      const rows=flows.rows,closeRows=rows.filter(flow=>String(flow.plan_id)===v.closePlanId),findRaw=(mint:string)=>closeRows.filter(flow=>String(flow.flow_type)==='CLOSE_WITHDRAWAL'&&String(flow.token_mint??'')===mint).reduce((n,flow)=>n+BigInt(String(flow.token_amount_raw??0)),0n),closeNative=closeRows.filter(flow=>String(flow.flow_type)==='CLOSE_WITHDRAWAL').reduce((n,flow)=>n+amount(flow),0n),swap=closeRows.filter(flow=>String(flow.flow_type)==='SWAP_PROCEEDS').reduce((n,flow)=>n+amount(flow),0n),claims=rows.filter(flow=>String(flow.flow_type)==='FEE_CLAIM').reduce((n,flow)=>n+amount(flow),0n),rewards=rows.filter(flow=>String(flow.flow_type)==='REWARD_CLAIM').reduce((n,flow)=>n+amount(flow),0n),txCosts=rows.filter(flow=>['TX_COST','SWAP_COST'].includes(String(flow.flow_type))).reduce((n,flow)=>n+amount(flow),0n),rentLocked=rows.filter(flow=>String(flow.flow_type)==='RENT_LOCK').reduce((n,flow)=>n+amount(flow),0n),rentRecovered=rows.filter(flow=>String(flow.flow_type)==='RENT_RECOVERY').reduce((n,flow)=>n+amount(flow),0n);
      const terminalClaim=closeRows.some(flow=>String(flow.flow_type)==='FEE_CLAIM'&&v.claimSignature!==undefined&&typeof (flow.payload as Record<string,unknown>|null)?.signature==='string'&&String((flow.payload as Record<string,unknown>).signature)===v.claimSignature),preCloseFeeXRaw=BigInt(String(row.pre_close_fee_x_raw)),preCloseFeeYRaw=BigInt(String(row.pre_close_fee_y_raw)),claimedFeeXRaw=terminalClaim&&String(row.token_x_mint)===WSOL_MINT?preCloseFeeXRaw:0n,claimedFeeYRaw=terminalClaim&&String(row.token_y_mint)===WSOL_MINT?preCloseFeeYRaw:0n;
      const accounting=deriveCloseFeeAttributionAccounting({tokenXMint:String(row.token_x_mint),tokenYMint:String(row.token_y_mint),preCloseFeeXRaw,preCloseFeeYRaw,...(row.token_x_decimals===null?{}:{tokenXDecimals:Number(row.token_x_decimals)}),...(row.token_y_decimals===null?{}:{tokenYDecimals:Number(row.token_y_decimals)}),closeTokenXRaw:findRaw(String(row.token_x_mint)),closeTokenYRaw:findRaw(String(row.token_y_mint)),closeNativeLamports:closeNative,swapProceedsLamports:swap,explicitClaimLamports:claims,rewardLamports:rewards,initialCapitalLamports:BigInt(String(life.rows[0].initial_capital_lamports)),transactionCostLamports:txCosts,rentLockedLamports:rentLocked,rentRecoveredLamports:rentRecovered,realizedSolPnlLamports:BigInt(String(settlement.rows[0].realized_sol_pnl_lamports))});
      const reasons=[...accounting.reasonCodes,...(BigInt(String(row.pre_close_reward_one_raw))>0n||BigInt(String(row.pre_close_reward_two_raw))>0n?['REWARD_ATTRIBUTION_UNAVAILABLE']:[])],status: 'COMPLETE'|'PARTIAL'=reasons.length?'PARTIAL':accounting.status;
      const embeddedFeeXRaw=accounting.embeddedRemoveFeeXRaw-claimedFeeXRaw,embeddedFeeYRaw=accounting.embeddedRemoveFeeYRaw-claimedFeeYRaw;
      await db.query("UPDATE execution.close_fee_attributions SET claimed_fee_x_raw=$2,claimed_fee_y_raw=$3,embedded_remove_fee_x_raw=$4,embedded_remove_fee_y_raw=$5,total_realized_fee_x_raw=$6,total_realized_fee_y_raw=$7,realized_lp_fee_value_lamports=$8,realized_rewards_value_lamports=$9,principal_returned_value_lamports=$10,inventory_unwind_result_lamports=$11,transaction_cost_lamports=$12,rent_recovered_lamports=$13,accounting_reconciliation_difference_lamports=$14,attribution_status=$15,reason_codes=$16::jsonb,remove_signature=$17,claim_signature=$18,terminal_settlement_id=$19,valuation_payload=$20::jsonb,finalized_at=$21 WHERE close_plan_id=$1",[v.closePlanId,claimedFeeXRaw.toString(),claimedFeeYRaw.toString(),embeddedFeeXRaw.toString(),embeddedFeeYRaw.toString(),accounting.embeddedRemoveFeeXRaw.toString(),accounting.embeddedRemoveFeeYRaw.toString(),accounting.realizedLpFeeValueLamports?.toString()??null,rewards.toString(),accounting.principalReturnedValueLamports?.toString()??null,accounting.inventoryUnwindResultLamports?.toString()??null,txCosts.toString(),rentRecovered.toString(),accounting.accountingReconciliationDifferenceLamports?.toString()??null,status,json([...new Set(reasons)].sort()),v.removeSignature,v.claimSignature??null,v.terminalSettlementId,json({valuationMethod:'WSOL_RAW_OR_CONFIRMED_UNWIND_PRO_RATA',terminalClaimObserved:terminalClaim,swapProceedsLamports:swap.toString(),closeTokenXRaw:findRaw(String(row.token_x_mint)).toString(),closeTokenYRaw:findRaw(String(row.token_y_mint)).toString()}),v.at]);
      const closePlan=await db.query("SELECT payload FROM execution.transaction_plans WHERE plan_id=$1",[v.closePlanId]);
      const closePayload=(closePlan.rows[0]?.payload??{}) as Record<string,unknown>, metadata=(closePayload.metadata??{}) as Record<string,unknown>, managementReasons=Array.isArray(metadata.managementReasonCodes)?metadata.managementReasonCodes.map(String):[];
      const closeReason=managementReasons.find(code=>code.startsWith('POSITION_OOR_'))??managementReasons[0]??null;
      // The immutable M0063 snapshot and lifecycle settlement remain the
      // source of truth.  This compact row is written once, only for new
      // terminal lifecycles, and never backfills historical unknowns.
      const fullLpFees=claims+(accounting.realizedLpFeeValueLamports??0n)-claimedFeeXRaw-claimedFeeYRaw;
      await db.query("INSERT INTO execution.position_realized_economics(position_address,lifecycle_id,entry_plan_id,close_plan_id,close_reason,entry_capital_lamports,gross_lp_fee_lamports,rewards_lamports,principal_returned_lamports,inventory_unwind_pnl_lamports,transaction_cost_lamports,swap_cost_lamports,rent_recovered_lamports,final_realized_pnl_lamports,accounting_reconciliation_difference_lamports,fee_attribution_status,accounting_status,payload,created_at,finalized_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$19) ON CONFLICT(position_address) DO NOTHING",[v.positionAddress,String(life.rows[0].lifecycle_id),null,v.closePlanId,closeReason,life.rows[0].initial_capital_lamports,fullLpFees.toString(),rewards.toString(),accounting.principalReturnedValueLamports?.toString()??null,accounting.inventoryUnwindResultLamports?.toString()??null,txCosts.toString(),rows.filter(flow=>String(flow.flow_type)==='SWAP_COST').reduce((n,flow)=>n+amount(flow),0n).toString(),rentRecovered.toString(),String(settlement.rows[0].realized_sol_pnl_lamports),accounting.accountingReconciliationDifferenceLamports?.toString()??null,status,status==='COMPLETE'?'COMPLETE':'PARTIAL',json({source:'M0063_CLOSE_FEE_ATTRIBUTION_PLUS_LIFECYCLE_SETTLEMENT',rawLpFees:{x:accounting.embeddedRemoveFeeXRaw.toString(),y:accounting.embeddedRemoveFeeYRaw.toString()},terminalClaimObserved:terminalClaim,reasonCodes:[...new Set(reasons)].sort(),closeReasonCodes:managementReasons}),v.at]);
      return{status,reasonCodes:[...new Set(reasons)].sort()};
    },

    async loadTerminalCloseRentRecoveryCandidates(limit=16){const bounded=Math.max(1,Math.min(100,Math.floor(limit)));const r=await db.query("SELECT p.plan_id,l.position_address FROM execution.position_lifecycles l JOIN execution.lifecycle_plan_links link ON link.lifecycle_id=l.lifecycle_id AND link.role='CLOSE' JOIN execution.transaction_plans p ON p.plan_id=link.plan_id LEFT JOIN LATERAL (SELECT realized_sol_pnl_lamports FROM execution.lifecycle_sol_settlements s WHERE s.lifecycle_id=l.lifecycle_id ORDER BY settlement_version DESC LIMIT 1) settlement ON true LEFT JOIN execution.position_management_summaries summary ON summary.position_address=l.position_address WHERE l.status='CLOSED' AND p.state=ANY($1::text[]) AND p.payload #>> '{autonomous_dispatch,builder}'='closePositionIfEmpty' AND p.payload #>> '{autonomous_dispatch,signature}' IS NOT NULL AND (settlement.realized_sol_pnl_lamports IS NULL OR (EXISTS(SELECT 1 FROM execution.position_management_decision_audit audit WHERE audit.position_address=l.position_address) AND NOT EXISTS(SELECT 1 FROM execution.position_cashflows f WHERE f.lifecycle_id=l.lifecycle_id AND f.flow_type='RENT_RECOVERY')) OR (summary.position_address IS NOT NULL AND (summary.final_realized_pnl_lamports IS DISTINCT FROM settlement.realized_sol_pnl_lamports OR NOT EXISTS(SELECT 1 FROM execution.position_cashflows f WHERE f.lifecycle_id=l.lifecycle_id AND f.cashflow_id=p.plan_id||':close-native-withdrawal:'||(p.payload #>> '{autonomous_dispatch,removeTransactionId}'))))) ORDER BY l.settled_at ASC NULLS LAST LIMIT $2",[EXECUTION_TERMINAL_PLAN_STATES,bounded]);return r.rows.map(row=>({planId:String(row.plan_id),positionAddress:String(row.position_address)}));},
    async loadPendingPositionManagementDecisionAuditCompactions(limit=16){const bounded=Math.max(1,Math.min(100,Math.floor(limit)));const r=await db.query("SELECT l.position_address FROM execution.position_lifecycles l JOIN execution.lifecycle_sol_settlements s ON s.lifecycle_id=l.lifecycle_id LEFT JOIN execution.position_management_summaries summary ON summary.position_address=l.position_address WHERE l.status='SOL_SETTLED' AND summary.position_address IS NULL AND EXISTS(SELECT 1 FROM execution.position_management_decision_audit audit WHERE audit.position_address=l.position_address) ORDER BY l.settled_at ASC NULLS LAST LIMIT $1",[bounded]);return r.rows.map(row=>String(row.position_address));},
    async compactPositionManagementDecisionAudit(v){await db.query("BEGIN");try{const eligible=await db.query("SELECT l.lifecycle_id,l.created_at,l.settled_at,s.realized_sol_pnl_lamports FROM execution.position_lifecycles l JOIN LATERAL (SELECT realized_sol_pnl_lamports FROM execution.lifecycle_sol_settlements s WHERE s.lifecycle_id=l.lifecycle_id ORDER BY settlement_version DESC LIMIT 1) s ON true WHERE l.position_address=$1 AND l.status=$2 AND NOT EXISTS(SELECT 1 FROM execution.owned_positions o WHERE o.position_address=$1 AND o.lifecycle_state<>$3) FOR UPDATE",[v.positionAddress,"SOL_SETTLED","SOL_SETTLED"]),row=eligible.rows[0];if(!row){await db.query("COMMIT");return{compacted:false};}const refreshed=await db.query("UPDATE execution.position_management_summaries SET final_realized_pnl_lamports=$2,compacted_at=$3,payload=payload||jsonb_build_object('settlementRefresh','LATEST_IMMUTABLE_SETTLEMENT') WHERE position_address=$1 AND final_realized_pnl_lamports IS DISTINCT FROM $2 RETURNING position_address",[v.positionAddress,String(row.realized_sol_pnl_lamports),v.at]);if(refreshed.rows[0]){await db.query("COMMIT");return{compacted:true};}const auditExists=await db.query("SELECT EXISTS(SELECT 1 FROM execution.position_management_decision_audit audit WHERE audit.position_address=$1) AS present",[v.positionAddress]);if(!auditExists.rows[0]?.present){await db.query("COMMIT");return{compacted:false};}const pending=await db.query("SELECT EXISTS(SELECT 1 FROM execution.lifecycle_plan_links x JOIN execution.transaction_plans p ON p.plan_id=x.plan_id WHERE x.lifecycle_id=$1 AND p.state<>ALL($2::text[])) AS pending",[String(row.lifecycle_id),EXECUTION_TERMINAL_PLAN_STATES]);if(pending.rows[0]?.pending){await db.query("COMMIT");return{compacted:false};}const summary=await db.query("INSERT INTO execution.position_management_summaries(position_address,lifecycle_id,entry_timestamp,exit_timestamp,hold_duration_seconds,monitor_cycle_count,positive_continuation_ev_count,negative_continuation_ev_count,minimum_continuation_ev_lamports,maximum_continuation_ev_lamports,longest_confirmed_negative_sequence,terminal_continuation_ev_lamports,terminal_expected_close_cost_lamports,terminal_action,terminal_reason,entry_candidate_id,entry_geometry_identity,claim_count,realized_fees_lamports,final_realized_pnl_lamports,settlement_state,compacted_at,payload) SELECT $1,$2,$3,$4,GREATEST(0::bigint,EXTRACT(EPOCH FROM ($4::timestamptz-$3::timestamptz))::bigint),count(*),count(*) FILTER(WHERE position_continuation_ev_lamports>0),count(*) FILTER(WHERE position_continuation_ev_lamports<=0),min(position_continuation_ev_lamports),max(position_continuation_ev_lamports),COALESCE(max(confirmation_sequence_count),0),(array_agg(position_continuation_ev_lamports ORDER BY observed_at DESC))[1],(array_agg(expected_close_cost_lamports ORDER BY observed_at DESC))[1],(array_agg(management_action ORDER BY observed_at DESC))[1],(array_agg((reason_codes->>0) ORDER BY observed_at DESC))[1],(array_agg(source_economics_id ORDER BY observed_at ASC))[1],(array_agg(geometry_identity ORDER BY observed_at ASC))[1],count(*) FILTER(WHERE management_action=$5),COALESCE((SELECT sum(COALESCE(lamports,0)) FROM execution.position_cashflows WHERE position_address=$1 AND flow_type=$6),0),$7,$8,$9,'{}'::jsonb FROM execution.position_management_decision_audit WHERE position_address=$1 ON CONFLICT(position_address) DO NOTHING RETURNING position_address",[v.positionAddress,String(row.lifecycle_id),row.created_at,row.settled_at,"CLAIM","FEE_CLAIM",String(row.realized_sol_pnl_lamports),"SOL_SETTLED",v.at]);if(summary.rows[0])await db.query("DELETE FROM execution.position_management_decision_audit WHERE position_address=$1",[v.positionAddress]);await db.query("COMMIT");return{compacted:Boolean(summary.rows[0])};}catch(error){try{await db.query("ROLLBACK");}catch{}throw error;}},
    async createLiveSolSettledLearningOutcome(v){
      const r=await db.query("SELECT l.lifecycle_id,l.position_address,l.entry_plan_id,l.owner_address,l.pool_address,l.created_at AS entry_at,l.settled_at,o.strategy,o.orientation,o.lower_bin_id,o.upper_bin_id,o.initial_capital_lamports,s.settlement_id,s.settlement_version,s.realized_sol_pnl_lamports,s.net_rent_cost_lamports,s.source_commit,s.policy_hash,s.build_id,s.migration_head,s.evidence_hash AS settlement_evidence_hash,line.prediction_id,line.recommendation_id,line.thesis_id,sr.decision_at AS recommendation_decision_at,sr.payload AS recommendation_payload,t.thesis AS thesis_payload FROM execution.position_lifecycles l JOIN execution.lifecycle_sol_settlements s ON s.lifecycle_id=l.lifecycle_id JOIN execution.owned_positions o ON o.position_address=l.position_address JOIN research.lifecycle_prediction_lineage line ON line.lifecycle_id=l.lifecycle_id JOIN research.shadow_recommendations sr ON sr.recommendation_id=line.recommendation_id JOIN research.lp_theses t ON t.thesis_id=line.thesis_id WHERE l.position_address=$1 AND l.status='SOL_SETTLED'",[v.positionAddress]);
      const row=r.rows[0];if(!row)return{created:false,reasonCodes:["LPFORGE_LIVE_OUTCOME_SETTLEMENT_OR_LINEAGE_MISSING"]};
      const [flows,plans,exitState,feeAttribution]=await Promise.all([db.query("SELECT cashflow_id,flow_type,lamports,token_mint,token_amount_raw,payload FROM execution.position_cashflows WHERE lifecycle_id=$1 ORDER BY observed_at,cashflow_id",[row.lifecycle_id]),db.query("SELECT link.role,i.action,p.created_at,p.payload FROM execution.lifecycle_plan_links link JOIN execution.transaction_plans p ON p.plan_id=link.plan_id JOIN execution.intents i ON i.intent_id=p.intent_id WHERE link.lifecycle_id=$1 ORDER BY p.created_at",[row.lifecycle_id]),db.query("SELECT * FROM execution.position_exit_state WHERE lpforge_position_id=$1",[`position-${row.position_address}`]),db.query("SELECT attribution_status,reason_codes,realized_lp_fee_value_lamports,realized_rewards_value_lamports,principal_returned_value_lamports,inventory_unwind_result_lamports,transaction_cost_lamports,rent_recovered_lamports,accounting_reconciliation_difference_lamports,total_realized_fee_x_raw,total_realized_fee_y_raw,claimed_fee_x_raw,claimed_fee_y_raw,token_x_mint,token_y_mint,token_x_decimals,token_y_decimals FROM execution.close_fee_attributions WHERE position_address=$1 AND finalized_at IS NOT NULL ORDER BY created_at DESC LIMIT 1",[row.position_address])]);
      const amount=(flow:Record<string,unknown>)=>flow.lamports!==null&&flow.lamports!==undefined?BigInt(String(flow.lamports)):flow.token_mint===WSOL_MINT&&flow.token_amount_raw!==null&&flow.token_amount_raw!==undefined?BigInt(String(flow.token_amount_raw)):0n;
      const closeFee=feeAttribution.rows[0] as Record<string,unknown>|undefined,claimedFees=flows.rows.filter(flow=>String(flow.flow_type)==='FEE_CLAIM').reduce((total,flow)=>total+amount(flow),0n),rewardFees=flows.rows.filter(flow=>String(flow.flow_type)==='REWARD_CLAIM').reduce((total,flow)=>total+amount(flow),0n),terminalClaimedWsol=(closeFee?.token_x_mint===WSOL_MINT?BigInt(String(closeFee.claimed_fee_x_raw??0)):0n)+(closeFee?.token_y_mint===WSOL_MINT?BigInt(String(closeFee.claimed_fee_y_raw??0)):0n),totalCloseFees=closeFee?.attribution_status==='COMPLETE'&&closeFee.realized_lp_fee_value_lamports!==null&&closeFee.realized_lp_fee_value_lamports!==undefined?BigInt(String(closeFee.realized_lp_fee_value_lamports)):0n,embeddedCloseFees=totalCloseFees-terminalClaimedWsol,directFees=claimedFees+embeddedCloseFees,txCosts=flows.rows.filter(flow=>['TX_COST','SWAP_COST'].includes(String(flow.flow_type))).reduce((total,flow)=>total+amount(flow),0n),management=plans.rows.filter(plan=>String(plan.role)!=='ENTRY'),counts=(action:string)=>management.filter(plan=>String(plan.action)===action).length,rec=(row.recommendation_payload??{}) as Record<string,unknown>,regime=(rec.regime??{}) as Record<string,unknown>,exit=(exitState.rows[0]?.payload??{}) as Record<string,unknown>,entry=Date.parse(String(row.entry_at)),settled=Date.parse(String(row.settled_at)),capital=BigInt(String(row.initial_capital_lamports)),pnl=BigInt(String(row.realized_sol_pnl_lamports)),outcomeId=`live-outcome:${row.settlement_id}`,returnFraction=capital>0n?Number(pnl)/Number(capital):undefined;
      const thesis=(row.thesis_payload??{}) as Record<string,unknown>,decomposition={accountingConvention:'gross-sol-instruction-flows-v1',netRealizedSolPnlLamports:pnl.toString(),directClaimedFeeSolLamports:claimedFees.toString(),embeddedCloseLpFeeSolLamports:embeddedCloseFees.toString(),realizedLpFeeSolLamports:directFees.toString(),realizedRewardSolLamports:rewardFees.toString(),feeAttributionStatus:closeFee?.attribution_status??'UNAVAILABLE',feeAttributionReasons:closeFee?.reason_codes??['PRE_CLOSE_POSITION_STATE_UNAVAILABLE'],closeFeeRaw:{x:closeFee?.total_realized_fee_x_raw??null,y:closeFee?.total_realized_fee_y_raw??null,xDecimals:closeFee?.token_x_decimals??null,yDecimals:closeFee?.token_y_decimals??null},principalReturnedSolLamports:closeFee?.principal_returned_value_lamports??null,inventoryUnwindResultSolLamports:closeFee?.inventory_unwind_result_lamports??null,transactionAndSwapCostLamports:txCosts.toString(),netRentCostLamports:String(row.net_rent_cost_lamports),accountingReconciliationDifferenceLamports:closeFee?.accounting_reconciliation_difference_lamports??null,directionalContribution:'UNAVAILABLE_WITHOUT_COUNTERFACTUAL_HODL_ALLOCATION'};
      const evidenceHash=await sha256Hex(canonicalJson({settlementEvidenceHash:String(row.settlement_evidence_hash),predictionId:String(row.prediction_id),management:plans.rows.map(plan=>[plan.role,plan.action,plan.created_at]),decomposition}));
      const existing=await db.query("SELECT outcome_id,evidence_hash FROM research.live_learning_outcomes WHERE settlement_id=$1",[row.settlement_id]);if(existing.rows[0]){if(String(existing.rows[0].evidence_hash)!==evidenceHash)throw new Error('LPFORGE_LIVE_OUTCOME_EVIDENCE_MISMATCH');return{created:false,outcome:{outcomeId:String(existing.rows[0].outcome_id),outcomeKind:'LIVE_SOL_SETTLED',settlementId:String(row.settlement_id),lifecycleId:String(row.lifecycle_id),entryPlanId:String(row.entry_plan_id),predictionId:String(row.prediction_id),recommendationId:String(row.recommendation_id),thesisId:String(row.thesis_id),poolAddress:String(row.pool_address),realizedSolPnlLamports:pnl,...(returnFraction===undefined?{}:{realizedReturnFraction:returnFraction})},reasonCodes:[]};}
      await db.query("INSERT INTO research.live_learning_outcomes(outcome_id,outcome_kind,settlement_id,lifecycle_id,entry_plan_id,prediction_id,recommendation_id,thesis_id,pool_address,strategy,orientation,lower_bin_id,upper_bin_id,entry_regime,entry_regime_confidence,entry_transition_risk,capital_sol_lamports,entry_at,exit_at,holding_duration_seconds,realized_sol_pnl_lamports,realized_return_fraction,direct_fee_sol_lamports,transaction_cost_lamports,net_rent_cost_lamports,management_action_count,claim_count,reduce_count,reshape_count,rebalance_count,exit_reason,mfe_fraction,mae_fraction,oor_duration_seconds,management_path,decomposition,source_commit,policy_hash,build_id,migration_head,evidence_hash,created_at,payload) VALUES($1,'LIVE_SOL_SETTLED',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34::jsonb,$35::jsonb,$36,$37,$38,$39,$40,$41,$42::jsonb)",[outcomeId,row.settlement_id,row.lifecycle_id,row.entry_plan_id,row.prediction_id,row.recommendation_id,row.thesis_id,row.pool_address,row.strategy,row.orientation,row.lower_bin_id,row.upper_bin_id,typeof regime.primary==='string'?regime.primary:null,typeof regime.confidence==='number'?regime.confidence:null,typeof regime.transitionRisk==='number'?regime.transitionRisk:null,capital.toString(),row.entry_at,row.settled_at,Number.isFinite(entry)&&Number.isFinite(settled)?Math.max(0,Math.floor((settled-entry)/1000)):null,pnl.toString(),returnFraction??null,directFees.toString(),txCosts.toString(),String(row.net_rent_cost_lamports),management.length,counts('CLAIM'),counts('REDUCE'),counts('RESHAPE'),counts('REBALANCE'),typeof exit.lastAction==='string'?exit.lastAction:null,null,null,null,json(plans.rows.map(plan=>({role:plan.role,action:plan.action,at:plan.created_at,payload:plan.payload}))),json(decomposition),row.source_commit,row.policy_hash,row.build_id,row.migration_head,evidenceHash,v.at,json({predictionAuthority:'PHASE3_RECOMMENDATION',terminalAuthority:'SOL_SETTLED_ONLY',policyMutation:'FORBIDDEN',originalPrediction:{recommendationId:row.recommendation_id,decisionAt:row.recommendation_decision_at,economics:rec.economics??null,ranking:rec.ranking??null,regime:rec.regime??null,thesis}})]);
      return{created:true,outcome:{outcomeId,outcomeKind:'LIVE_SOL_SETTLED',settlementId:String(row.settlement_id),lifecycleId:String(row.lifecycle_id),entryPlanId:String(row.entry_plan_id),predictionId:String(row.prediction_id),recommendationId:String(row.recommendation_id),thesisId:String(row.thesis_id),poolAddress:String(row.pool_address),realizedSolPnlLamports:pnl,...(returnFraction===undefined?{}:{realizedReturnFraction:returnFraction})},reasonCodes:[]};
    },
    async createLiveEntryAbortedLearningOutcome(v){
      // A partially funded entry has no PositionV2 lifecycle.  Its plan,
      // thesis and durable plan cashflows are therefore the sole authoritative
      // accounting boundary; never infer one from a nearby pool observation.
      const r=await db.query("SELECT r.plan_id,r.pool_address,r.updated_at,t.thesis_id,t.recommendation_id,t.thesis AS thesis_payload,sr.decision_at,sr.payload AS recommendation_payload FROM execution.partial_entry_recovery r JOIN execution.transaction_plans p ON p.plan_id=r.plan_id JOIN execution.intents i ON i.intent_id=p.intent_id JOIN research.lp_theses t ON t.thesis_id=i.thesis_id JOIN research.shadow_recommendations sr ON sr.recommendation_id=t.recommendation_id WHERE r.plan_id=$1 AND r.state='ABORTED_SOL_SETTLED'",[v.planId]);
      const row=r.rows[0];if(!row)return{created:false,reasonCodes:['LPFORGE_LIVE_ABORTED_OUTCOME_RECOVERY_OR_LINEAGE_MISSING']};
      const flows=await db.query("SELECT flow_type,lamports,token_mint,token_amount_raw,payload FROM execution.plan_cashflows WHERE plan_id=$1 ORDER BY observed_at,cashflow_id",[v.planId]);
      const amount=(flow:Record<string,unknown>)=>flow.lamports!==null&&flow.lamports!==undefined?BigInt(String(flow.lamports)):flow.token_mint===WSOL_MINT&&flow.token_amount_raw!==null&&flow.token_amount_raw!==undefined?BigInt(String(flow.token_amount_raw)):0n;
      const ins=new Set(['RECOVERY_SOL_IN','SWAP_PROCEEDS']),outs=new Set(['ENTRY_FUNDING_SOL_OUT','FUNDING_TX_COST','RECOVERY_TX_COST','TX_COST','SWAP_COST']);
      const totalIn=flows.rows.filter(flow=>ins.has(String(flow.flow_type))).reduce((n,flow)=>n+amount(flow),0n),totalOut=flows.rows.filter(flow=>outs.has(String(flow.flow_type))).reduce((n,flow)=>n+amount(flow),0n),pnl=totalIn-totalOut;
      const evidenceHash=await sha256Hex(canonicalJson({planId:v.planId,recoveryUpdatedAt:row.updated_at,predictionId:row.recommendation_id,flows:flows.rows.map(flow=>[flow.flow_type,flow.lamports,flow.token_mint,flow.token_amount_raw,flow.payload])}));
      const existing=await db.query("SELECT outcome_id,evidence_hash FROM research.live_learning_outcomes WHERE outcome_kind='LIVE_ENTRY_ABORTED_SOL_SETTLED' AND entry_plan_id=$1",[v.planId]);
      if(existing.rows[0]){if(String(existing.rows[0].evidence_hash)!==evidenceHash)throw new Error('LPFORGE_LIVE_ABORTED_OUTCOME_EVIDENCE_MISMATCH');return{created:false,outcome:{outcomeId:String(existing.rows[0].outcome_id),outcomeKind:'LIVE_ENTRY_ABORTED_SOL_SETTLED',entryPlanId:v.planId,predictionId:String(row.recommendation_id),recommendationId:String(row.recommendation_id),thesisId:String(row.thesis_id),poolAddress:String(row.pool_address),realizedSolPnlLamports:pnl},reasonCodes:[]};}
      const rec=(row.recommendation_payload??{}) as Record<string,unknown>,thesis=(row.thesis_payload??{}) as Record<string,unknown>,regime=(rec.regime??{}) as Record<string,unknown>,outcomeId=`live-aborted-outcome:${v.planId}`;
      await db.query("INSERT INTO research.live_learning_outcomes(outcome_id,outcome_kind,entry_plan_id,prediction_id,recommendation_id,thesis_id,pool_address,entry_regime,entry_regime_confidence,entry_transition_risk,entry_at,exit_at,holding_duration_seconds,realized_sol_pnl_lamports,direct_fee_sol_lamports,transaction_cost_lamports,management_action_count,claim_count,reduce_count,reshape_count,rebalance_count,management_path,decomposition,evidence_hash,created_at,payload) VALUES($1,'LIVE_ENTRY_ABORTED_SOL_SETTLED',$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,0,$11,0,$12,0,0,0,0,0,'[]'::jsonb,$13::jsonb,$14,$15,$16::jsonb)",[outcomeId,v.planId,row.recommendation_id,row.recommendation_id,row.thesis_id,row.pool_address,typeof regime.primary==='string'?regime.primary:null,typeof regime.confidence==='number'?regime.confidence:null,typeof regime.transitionRisk==='number'?regime.transitionRisk:null,row.updated_at,pnl.toString(),totalOut.toString(),json({accountingConvention:'gross-sol-instruction-flows-v1',entryAborted:true,totalSolInLamports:totalIn.toString(),totalSolOutLamports:totalOut.toString(),netRealizedSolPnlLamports:pnl.toString()}),evidenceHash,v.at,json({predictionAuthority:'PHASE3_RECOMMENDATION',terminalAuthority:'ABORTED_ENTRY_SOL_SETTLED_ONLY',policyMutation:'FORBIDDEN',originalPrediction:{recommendationId:row.recommendation_id,decisionAt:row.decision_at,economics:rec.economics??null,ranking:rec.ranking??null,regime:rec.regime??null,thesis}})]);
      return{created:true,outcome:{outcomeId,outcomeKind:'LIVE_ENTRY_ABORTED_SOL_SETTLED',entryPlanId:v.planId,predictionId:String(row.recommendation_id),recommendationId:String(row.recommendation_id),thesisId:String(row.thesis_id),poolAddress:String(row.pool_address),realizedSolPnlLamports:pnl},reasonCodes:[]};
    },
    async loadPendingLiveSolSettledLearningOutcomes(limit=500){const r=await db.query("SELECT l.position_address FROM execution.position_lifecycles l JOIN execution.lifecycle_sol_settlements s ON s.lifecycle_id=l.lifecycle_id LEFT JOIN research.live_learning_outcomes o ON o.settlement_id=s.settlement_id WHERE l.status='SOL_SETTLED' AND o.outcome_id IS NULL ORDER BY l.settled_at ASC LIMIT $1",[Math.max(1,Math.min(5000,limit))]);return r.rows.map(row=>String(row.position_address));},
    async loadLiveLearningOutcomes(limit=5000){const r=await db.query("SELECT * FROM research.live_learning_outcomes ORDER BY created_at DESC LIMIT $1",[Math.max(1,Math.min(20000,limit))]);return r.rows as Array<Record<string,unknown>>;},
    async insertLiveLearningCalibration(v){await db.query("INSERT INTO research.live_learning_calibration_snapshots(snapshot_id,observed_at,sample_count,independent_episodes,brier_profit,net_pnl_mae_lamports,mean_bias_lamports,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(snapshot_id) DO NOTHING",[v.snapshotId,v.observedAt,v.sampleCount,v.independentEpisodes,v.brierProfit??null,v.netPnlMaeLamports??null,v.meanBiasLamports??null,json(v.payload)]);},
    async createPositionInventoryLot(v){
      const tx=db;
      try{
        await tx.query("BEGIN");
        const existing=await tx.query("SELECT position_address,plan_id,token_mint,raw_amount FROM execution.position_inventory_lots WHERE lot_id=$1 FOR UPDATE",[v.lotId]);
        if(existing.rows[0]){
          const row=existing.rows[0];
          if(String(row.position_address)!==v.positionAddress||String(row.plan_id)!==v.planId||String(row.token_mint)!==v.tokenMint||BigInt(String(row.raw_amount))!==v.rawAmount)throw new Error("LPFORGE_INVENTORY_LOT_ID_CONFLICT");
          await tx.query("COMMIT");
          return;
        }
        await tx.query("INSERT INTO execution.position_inventory_lots(lot_id,position_address,plan_id,owner_address,pool_address,token_mint,token_side,source_event,source_cashflow_id,raw_amount,remaining_raw_amount,decimals,acquired_at,status,payload,created_at,updated_at,lifecycle_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,'OPEN',$13::jsonb,$12,$12,(SELECT lifecycle_id FROM execution.position_lifecycles WHERE position_address=$2))",[v.lotId,v.positionAddress,v.planId,v.ownerAddress,v.poolAddress,v.tokenMint,v.tokenSide,v.sourceEvent,v.sourceCashflowId??null,v.rawAmount.toString(),v.decimals,v.acquiredAt,json(v.payload)]);
        await tx.query("INSERT INTO execution.position_inventory_lot_events(event_id,lot_id,plan_id,event_type,raw_amount,remaining_raw_amount,observed_at,transaction_signature,payload) VALUES($1,$2,$3,'CREATED',$4,$4,$5,$6,$7::jsonb)",[v.createdEventId,v.lotId,v.planId,v.rawAmount.toString(),v.acquiredAt,v.transactionSignature??null,json({sourceEvent:v.sourceEvent,...v.payload})]);
        await tx.query("COMMIT");
      }catch(error){try{await tx.query("ROLLBACK");}catch{}throw error;}
    },
    async settlePositionInventoryLot(v){
      const tx=db;
      try{
        await tx.query("BEGIN");
        const priorEvent=await tx.query("SELECT 1 FROM execution.position_inventory_lot_events WHERE event_id=$1 FOR UPDATE",[v.eventId]);
        const lot=await tx.query("SELECT remaining_raw_amount,status FROM execution.position_inventory_lots WHERE lot_id=$1 FOR UPDATE",[v.lotId]);
        if(!lot.rows[0])throw new Error("LPFORGE_INVENTORY_LOT_NOT_FOUND");
        const current={remainingRawAmount:BigInt(String(lot.rows[0].remaining_raw_amount)),status:String(lot.rows[0].status) as PositionInventoryLotStatus};
        if(priorEvent.rows[0]){await tx.query("COMMIT");return current;}
        const next=settlePositionInventoryLotBalance({remainingRawAmount:current.remainingRawAmount,settledRawAmount:v.settledRawAmount,eventType:v.eventType});
        await tx.query("UPDATE execution.position_inventory_lots SET remaining_raw_amount=$2,status=$3,updated_at=$4,payload=CASE WHEN $3 IN ('SETTLED','TRANSFERRED') THEN payload||jsonb_build_object('terminalSettlement',$5::jsonb) ELSE payload END WHERE lot_id=$1",[v.lotId,next.remainingRawAmount.toString(),next.status,v.observedAt,json({eventType:v.eventType,transactionSignature:v.transactionSignature??null,...v.payload})]);
        await tx.query("INSERT INTO execution.position_inventory_lot_events(event_id,lot_id,plan_id,event_type,raw_amount,remaining_raw_amount,observed_at,transaction_signature,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",[v.eventId,v.lotId,v.planId??null,v.eventType,v.settledRawAmount.toString(),next.remainingRawAmount.toString(),v.observedAt,v.transactionSignature??null,json(v.payload)]);
        await tx.query("COMMIT");
        return next;
      }catch(error){try{await tx.query("ROLLBACK");}catch{}throw error;}
    },
    async retainPositionInventoryLotDust(v){
      const tx=db;
      try{
        await tx.query("BEGIN");
        const existing=await tx.query("SELECT 1 FROM execution.position_inventory_lot_events WHERE event_id=$1 FOR UPDATE",[v.eventId]);
        if(existing.rows[0]){await tx.query("COMMIT");return;}
        const lot=await tx.query("SELECT remaining_raw_amount,status FROM execution.position_inventory_lots WHERE lot_id=$1 FOR UPDATE",[v.lotId]);
        if(!lot.rows[0])throw new Error("LPFORGE_INVENTORY_LOT_NOT_FOUND");
        const raw=BigInt(String(lot.rows[0].remaining_raw_amount));
        if(raw<=0n||!['OPEN','PARTIALLY_SETTLED'].includes(String(lot.rows[0].status)))throw new Error("LPFORGE_INVENTORY_DUST_DISPOSITION_INVALID_STATE");
        await tx.query("UPDATE execution.position_inventory_lots SET status='DUST_RETAINED',updated_at=$2,payload=payload||jsonb_build_object('dustDisposition',$3::jsonb) WHERE lot_id=$1",[v.lotId,v.observedAt,json(v.payload)]);
        await tx.query("INSERT INTO execution.position_inventory_lot_events(event_id,lot_id,plan_id,event_type,raw_amount,remaining_raw_amount,observed_at,payload) VALUES($1,$2,$3,'DUST_RETAINED',$4,$4,$5,$6::jsonb)",[v.eventId,v.lotId,v.planId??null,raw.toString(),v.observedAt,json(v.payload)]);
        await tx.query("COMMIT");
      }catch(error){try{await tx.query("ROLLBACK");}catch{}throw error;}
    },
    async correctAggregateCloseClaimAttribution(v){
      const tx=db;
      try{
        await tx.query("BEGIN");
        const prior=await tx.query("SELECT 1 FROM execution.position_inventory_lot_events WHERE event_id=$1 FOR UPDATE",[v.eventId]);
        if(prior.rows[0]){await tx.query("COMMIT");return;}
        const rows=await tx.query("SELECT lot_id,raw_amount,remaining_raw_amount,status,payload FROM execution.position_inventory_lots WHERE lot_id=ANY($1::text[]) FOR UPDATE",[[v.closeLotId,v.claimLotId]]);
        const close=rows.rows.find(row=>String(row.lot_id)===v.closeLotId),claim=rows.rows.find(row=>String(row.lot_id)===v.claimLotId);
        if(!close||!claim)throw new Error('LPFORGE_INVENTORY_ATTRIBUTION_LOT_MISSING');
        const closeRaw=BigInt(String(close.raw_amount)),claimRaw=BigInt(String(claim.raw_amount));
        if(claimRaw!==v.claimRawAmount||closeRaw<=claimRaw||String(close.status)!=='SETTLED'||String(claim.status)!=='OPEN')throw new Error('LPFORGE_INVENTORY_ATTRIBUTION_CORRECTION_INVALID');
        const corrected=closeRaw-claimRaw;
        const closePayload={...(close.payload as Record<string,unknown>),attributionCorrection:{...v.payload,originalRawAmount:closeRaw.toString(),correctedRawAmount:corrected.toString(),overlapRawAmount:claimRaw.toString(),transactionSignature:v.transactionSignature}};
        await tx.query("UPDATE execution.position_inventory_lots SET raw_amount=$2,updated_at=$3,payload=$4::jsonb WHERE lot_id=$1",[v.closeLotId,corrected.toString(),v.observedAt,json(closePayload)]);
        await tx.query("UPDATE execution.position_inventory_lots SET remaining_raw_amount=0,status='SETTLED',updated_at=$2,payload=payload||jsonb_build_object('terminalSettlement',$3::jsonb) WHERE lot_id=$1",[v.claimLotId,v.observedAt,json({eventType:'SETTLED',transactionSignature:v.transactionSignature,disposition:'AGGREGATE_CLOSE_UNWIND_RECEIPT_ALLOCATION',...v.payload})]);
        await tx.query("INSERT INTO execution.position_inventory_lot_events(event_id,lot_id,plan_id,event_type,raw_amount,remaining_raw_amount,observed_at,transaction_signature,payload) VALUES($1,$2,$3,'ATTRIBUTION_CORRECTED',$4,0,$5,$6,$7::jsonb),($1||':claim-settled',$8,$3,'SETTLED',$4,0,$5,$6,$7::jsonb)",[v.eventId,v.closeLotId,v.planId,claimRaw.toString(),v.observedAt,v.transactionSignature,json(v.payload),v.claimLotId]);
        await tx.query("COMMIT");
      }catch(error){try{await tx.query("ROLLBACK");}catch{}throw error;}
    },
    async loadPositionInventoryLots(positionAddress,tokenMint){
      const r=await db.query("SELECT lot_id,position_address,plan_id,owner_address,pool_address,token_mint,token_side,source_event,source_cashflow_id,raw_amount,remaining_raw_amount,decimals,acquired_at,status,payload FROM execution.position_inventory_lots WHERE position_address=$1 AND ($2::text IS NULL OR token_mint=$2) ORDER BY acquired_at ASC,lot_id ASC",[positionAddress,tokenMint??null]);
      return r.rows.map(row=>({lotId:String(row.lot_id),positionAddress:String(row.position_address),planId:String(row.plan_id),ownerAddress:String(row.owner_address),poolAddress:String(row.pool_address),tokenMint:String(row.token_mint),tokenSide:String(row.token_side) as PositionInventoryLotSide,sourceEvent:String(row.source_event) as PositionInventoryLotSource,...(row.source_cashflow_id?{sourceCashflowId:String(row.source_cashflow_id)}:{}),rawAmount:BigInt(String(row.raw_amount)),remainingRawAmount:BigInt(String(row.remaining_raw_amount)),decimals:Number(row.decimals),acquiredAt:toIsoTimestamp(row.acquired_at),status:String(row.status) as PositionInventoryLotStatus,payload:(row.payload??{}) as Record<string,unknown>}));
    },
    async loadOwnerPositionInventoryLots(ownerAddress){
      const r=await db.query("SELECT lot_id,position_address,plan_id,owner_address,pool_address,token_mint,token_side,source_event,source_cashflow_id,raw_amount,remaining_raw_amount,decimals,acquired_at,status,payload FROM execution.position_inventory_lots WHERE owner_address=$1 AND status IN ('OPEN','PARTIALLY_SETTLED') AND remaining_raw_amount>0 ORDER BY acquired_at ASC,lot_id ASC",[ownerAddress]);
      return r.rows.map(row=>({lotId:String(row.lot_id),positionAddress:String(row.position_address),planId:String(row.plan_id),ownerAddress:String(row.owner_address),poolAddress:String(row.pool_address),tokenMint:String(row.token_mint),tokenSide:String(row.token_side) as PositionInventoryLotSide,sourceEvent:String(row.source_event) as PositionInventoryLotSource,...(row.source_cashflow_id?{sourceCashflowId:String(row.source_cashflow_id)}:{}),rawAmount:BigInt(String(row.raw_amount)),remainingRawAmount:BigInt(String(row.remaining_raw_amount)),decimals:Number(row.decimals),acquiredAt:toIsoTimestamp(row.acquired_at),status:String(row.status) as PositionInventoryLotStatus,payload:(row.payload??{}) as Record<string,unknown>}));
    },
    async insertPlanCashflow(v){
      await db.query("INSERT INTO execution.plan_cashflows(cashflow_id,plan_id,flow_type,observed_at,lamports,token_mint,token_amount_raw,transaction_signature,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(cashflow_id) DO UPDATE SET lamports=EXCLUDED.lamports,token_mint=EXCLUDED.token_mint,token_amount_raw=EXCLUDED.token_amount_raw,transaction_signature=EXCLUDED.transaction_signature,payload=EXCLUDED.payload",[v.cashflowId,v.planId,v.flowType,v.observedAt,v.lamports?.toString()??null,v.tokenMint??null,v.tokenAmountRaw??null,v.transactionSignature??null,json(v.payload)]);
    },
    async loadPlanCashflows(planId){
      const r=await db.query("SELECT cashflow_id,plan_id,flow_type,observed_at,lamports,token_mint,token_amount_raw,transaction_signature,payload FROM execution.plan_cashflows WHERE plan_id=$1 ORDER BY observed_at,cashflow_id",[planId]);
      return r.rows.map(row=>({cashflowId:String(row.cashflow_id),planId:String(row.plan_id),flowType:String(row.flow_type) as PlanCashflowType,observedAt:toIsoTimestamp(row.observed_at),...(row.lamports===null?{}:{lamports:BigInt(String(row.lamports))}),...(row.token_mint?{tokenMint:String(row.token_mint)}:{}),...(row.token_amount_raw===null?{}:{tokenAmountRaw:String(row.token_amount_raw)}),...(row.transaction_signature?{transactionSignature:String(row.transaction_signature)}:{}),payload:(row.payload??{}) as Record<string,unknown>}));
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
        `SELECT r.* FROM execution.partial_entry_recovery r
         WHERE r.state IN ('ENTRY_FUNDED_NOT_OPEN','RESUME_OPEN','UNWIND_REQUIRED','UNWIND_SUBMITTED','RECONCILIATION_REQUIRED')
            OR (r.state='ABORTED_SOL_SETTLED' AND NOT EXISTS(
              SELECT 1 FROM research.live_learning_outcomes o
              WHERE o.outcome_kind='LIVE_ENTRY_ABORTED_SOL_SETTLED' AND o.entry_plan_id=r.plan_id
            ))
         ORDER BY r.updated_at ASC`,
      );
      return r.rows;
    },
    async loadPartialEntryRecovery(planId) {
      const r = await db.query(
        `SELECT * FROM execution.partial_entry_recovery WHERE plan_id=$1`,
        [planId],
      );
      return r.rows[0] as Record<string, unknown> | undefined;
    },
    async upsertOpenChunkDisposition(v) {
      await db.query(
        `INSERT INTO execution.open_chunk_dispositions(plan_id,transaction_id,sequence,kind,disposition,signature,last_valid_block_height,observed_at,payload)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         ON CONFLICT(plan_id,transaction_id) DO UPDATE SET disposition=EXCLUDED.disposition,signature=COALESCE(EXCLUDED.signature,execution.open_chunk_dispositions.signature),last_valid_block_height=COALESCE(EXCLUDED.last_valid_block_height,execution.open_chunk_dispositions.last_valid_block_height),observed_at=EXCLUDED.observed_at,payload=execution.open_chunk_dispositions.payload||EXCLUDED.payload`,
        [v.planId,v.transactionId,v.sequence,v.kind,v.disposition,v.signature??null,v.lastValidBlockHeight?.toString()??null,v.observedAt,json(v.payload)],
      );
    },
    async loadOpenChunkDispositions(planId) {
      const r=await db.query("SELECT plan_id,transaction_id,sequence,kind,disposition,signature,last_valid_block_height,observed_at,payload FROM execution.open_chunk_dispositions WHERE plan_id=$1 ORDER BY sequence,transaction_id",[planId]);
      return r.rows.map(row=>({planId:String(row.plan_id),transactionId:String(row.transaction_id),sequence:Number(row.sequence),kind:String(row.kind),disposition:String(row.disposition) as OpenChunkDisposition,...(row.signature?{signature:String(row.signature)}:{}),...(row.last_valid_block_height===null?{}:{lastValidBlockHeight:BigInt(String(row.last_valid_block_height))}),observedAt:toIsoTimestamp(row.observed_at),payload:(row.payload??{}) as Record<string,unknown>}));
    },
    async loadAutonomousPlan(planId) {
      const r = await db.query(
        `SELECT p.plan_id,p.intent_id,p.state,p.expires_at,p.payload AS plan_payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,COALESCE(i.position_address,(SELECT min(l.position_address) FROM execution.lifecycle_plan_links link JOIN execution.position_lifecycles l ON l.lifecycle_id=link.lifecycle_id WHERE link.plan_id=p.plan_id AND l.status='SOL_SETTLED' HAVING count(DISTINCT l.position_address)=1)) AS position_address,CASE WHEN i.position_address IS NOT NULL THEN 'DIRECT' WHEN (SELECT count(DISTINCT l.position_address) FROM execution.lifecycle_plan_links link JOIN execution.position_lifecycles l ON l.lifecycle_id=link.lifecycle_id WHERE link.plan_id=p.plan_id AND l.status='SOL_SETTLED')=1 THEN 'LIFECYCLE_SOL_SETTLED' END AS position_identity_source,EXISTS(SELECT 1 FROM execution.lifecycle_plan_links settled_link JOIN execution.position_lifecycles settled_lifecycle ON settled_lifecycle.lifecycle_id=settled_link.lifecycle_id WHERE settled_link.plan_id=p.plan_id AND settled_lifecycle.status='SOL_SETTLED' AND (i.position_address IS NULL OR settled_lifecycle.position_address=i.position_address)) AS position_lifecycle_settled,i.thesis_id,i.observed_at,i.payload AS intent_payload,COALESCE(json_agg(json_build_object('transactionId',s.transaction_id,'sequence',s.sequence,'kind',s.kind,'state',s.state,'requiredSignerAddresses',s.required_signers,'metadata',s.metadata) ORDER BY s.sequence) FILTER (WHERE s.transaction_id IS NOT NULL),'[]'::json) AS steps FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id LEFT JOIN execution.transaction_steps s ON s.plan_id=p.plan_id WHERE p.plan_id=$1 GROUP BY p.plan_id,p.intent_id,p.state,p.expires_at,p.payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload`,
        [planId],
      );
      return r.rows[0] ? autonomousPlanFromRow(r.rows[0]) : undefined;
    },
    async loadUnresolvedAutonomousPlans() {
      const r = await db.query(
        `SELECT p.plan_id,p.intent_id,p.state,p.expires_at,p.payload AS plan_payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,COALESCE(i.position_address,(SELECT min(l.position_address) FROM execution.lifecycle_plan_links link JOIN execution.position_lifecycles l ON l.lifecycle_id=link.lifecycle_id WHERE link.plan_id=p.plan_id AND l.status='SOL_SETTLED' HAVING count(DISTINCT l.position_address)=1)) AS position_address,CASE WHEN i.position_address IS NOT NULL THEN 'DIRECT' WHEN (SELECT count(DISTINCT l.position_address) FROM execution.lifecycle_plan_links link JOIN execution.position_lifecycles l ON l.lifecycle_id=link.lifecycle_id WHERE link.plan_id=p.plan_id AND l.status='SOL_SETTLED')=1 THEN 'LIFECYCLE_SOL_SETTLED' END AS position_identity_source,EXISTS(SELECT 1 FROM execution.lifecycle_plan_links settled_link JOIN execution.position_lifecycles settled_lifecycle ON settled_lifecycle.lifecycle_id=settled_link.lifecycle_id WHERE settled_link.plan_id=p.plan_id AND settled_lifecycle.status='SOL_SETTLED' AND (i.position_address IS NULL OR settled_lifecycle.position_address=i.position_address)) AS position_lifecycle_settled,i.thesis_id,i.observed_at,i.payload AS intent_payload,COALESCE(json_agg(json_build_object('transactionId',s.transaction_id,'sequence',s.sequence,'kind',s.kind,'state',s.state,'requiredSignerAddresses',s.required_signers,'metadata',s.metadata) ORDER BY s.sequence) FILTER (WHERE s.transaction_id IS NOT NULL),'[]'::json) AS steps FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id LEFT JOIN execution.transaction_steps s ON s.plan_id=p.plan_id WHERE p.cluster='mainnet-beta' AND (p.state IN ('CLAIMED','DISPATCHING','BUILDING','BUILT','SIMULATING','SIMULATED','RISK_APPROVED','SIGNING','SIGNED','SUBMITTING','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED','RECONCILING','RECOVERING','RECONCILIATION_REQUIRED') OR (p.state='FAILED' AND (EXISTS(SELECT 1 FROM execution.transaction_steps s JOIN execution.submission_attempts a ON a.transaction_id=s.transaction_id WHERE s.plan_id=p.plan_id AND a.state IN ('SENT','UNKNOWN')) OR p.payload->'autonomous_dispatch'->>'recovery'='CLOSE_PENDING_STAGE_EXPIRED_NO_CHAIN_EFFECT'))) GROUP BY p.plan_id,p.intent_id,p.state,p.expires_at,p.payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload ORDER BY p.created_at ASC`,
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
    async markSubmissionExpired(signature, at, reason) {
      await db.query(
        `UPDATE execution.submission_attempts SET state='EXPIRED',payload=payload||jsonb_build_object('terminal_recovery_reason',$3::text,'terminal_recovered_at',$2::timestamptz) WHERE signature=$1 AND state IN ('PREPARED','SENT','UNKNOWN')`,
        [signature, at, reason],
      );
    },
    async recoverNoEffectPreflightSubmissionAttempts(at) {
      const result=await db.query(
        `UPDATE execution.submission_attempts
         SET state='EXPIRED',payload=payload||jsonb_build_object('terminal_recovery_reason','P6_PREFLIGHT_REJECTED_NO_CHAIN_EFFECT','terminal_recovered_at',$1::timestamptz)
         WHERE state='UNKNOWN' AND signature IS NULL
           AND payload->>'submission_error' LIKE 'Simulation failed.%'
         RETURNING attempt_id`,
        [at],
      );
      return result.rows.length;
    },
    async loadSubmissionAttemptBySignature(signature) {
      const r = await db.query(
        `SELECT last_valid_block_height FROM execution.submission_attempts WHERE signature=$1 ORDER BY prepared_at DESC LIMIT 1`,
        [signature],
      );
      const value = r.rows[0]?.last_valid_block_height;
      return value === undefined || value === null
        ? undefined
        : { lastValidBlockHeight: Number(value) };
    },
    async loadConfirmedSubmissionByTransactionId(transactionId) {
      const r = await db.query(
        `SELECT a.signature,c.status,c.slot
         FROM execution.submission_attempts a
         JOIN execution.confirmations c ON c.attempt_id=a.attempt_id
         WHERE a.transaction_id=$1
           AND a.state='SENT'
           AND a.signature IS NOT NULL
           AND c.status IN ('CONFIRMED','FINALIZED')
         ORDER BY CASE c.status WHEN 'FINALIZED' THEN 0 ELSE 1 END,
                  c.observed_at DESC
         LIMIT 1`,
        [transactionId],
      );
      const row = r.rows[0];
      if (!row?.signature || (row.status !== "CONFIRMED" && row.status !== "FINALIZED"))
        return undefined;
      return {
        signature: String(row.signature),
        status: String(row.status) as "CONFIRMED" | "FINALIZED",
        ...(row.slot === null || row.slot === undefined
          ? {}
          : { slot: BigInt(String(row.slot)) }),
      };
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
        // A process can die after the submission ledger durably records SENT
        // but before the journal's SUBMITTED update commits.  Return an
        // effective recovery view so that window is never treated as an
        // unsent, rebuildable plan.  The underlying journal row stays
        // append-only/auditable; recovery later writes its normal terminal
        // state once chain truth is known.
        `SELECT j.*,
                COALESCE(j.signature,a.signature) AS signature,
                CASE
                  WHEN j.state='SIGNED' AND a.state='SENT' THEN 'SUBMITTED'
                  WHEN j.state='SIGNED' AND a.state='UNKNOWN' THEN 'UNKNOWN_SUBMISSION'
                  ELSE j.state
                END AS state
           FROM execution.execution_journal j
           LEFT JOIN LATERAL (
             SELECT a.state,a.signature
             FROM execution.transaction_steps s
             JOIN execution.submission_attempts a ON a.transaction_id=s.transaction_id
             WHERE s.plan_id=j.plan_id
             ORDER BY COALESCE(a.submitted_at,a.prepared_at) DESC,a.attempt DESC
             LIMIT 1
           ) a ON true
           WHERE j.idempotency_key=$1`,
        [idempotencyKey],
      );
      return r.rows[0];
    },
    async loadOperationalHistory(poolAddress, since, limit, through) {
      const lim = Math.max(1, Math.min(2000, limit));
      const window = operationalHistoryWindow(since, through);
      const market = await db.query(
        `WITH candidate AS (
           SELECT observed_at,price::double precision AS price,local_liquidity::double precision AS tvl,active_bin_id,resolution_ms,
             COALESCE(volume,0)::double precision AS volume_5m,COALESCE(fee_value,0)::double precision AS fee_5m,
             CASE source_type WHEN 'LIVE_OBSERVED' THEN 0 WHEN 'RECONSTRUCTED' THEN 1 ELSE 2 END AS source_rank
           FROM market.candidate_market_observations
           WHERE pool_address=$1 AND observed_at>=$2 AND ($3::timestamptz IS NULL OR observed_at<=$3)
         ), snapshots AS (
           SELECT d.observed_at,(d.payload->>'current_price')::double precision AS price,(d.payload->>'tvl')::double precision AS tvl,
             (SELECT p.active_bin_id FROM protocol.pool_snapshots p WHERE p.pool_address=d.pool_address AND p.observed_at<=d.observed_at ORDER BY p.observed_at DESC LIMIT 1) AS active_bin_id,
             COALESCE((d.payload->'volume'->>'5m')::double precision,0) AS volume_5m,
             COALESCE((d.payload->'fees'->>'5m')::double precision,0) AS fee_5m,60000::integer AS resolution_ms,1 AS source_rank
           FROM market.data_api_pool_snapshots d
           WHERE d.pool_address=$1 AND d.observed_at>=$2 AND ($3::timestamptz IS NULL OR d.observed_at<=$3) AND (d.payload->>'current_price') IS NOT NULL
         ), all_points AS (SELECT * FROM candidate UNION ALL SELECT * FROM snapshots),
         dedup AS (SELECT DISTINCT ON(observed_at) * FROM all_points ORDER BY observed_at,source_rank)
         SELECT observed_at,price,tvl,active_bin_id,resolution_ms,volume_5m,fee_5m FROM dedup ORDER BY observed_at ASC LIMIT $4`,
        [poolAddress, window.since, window.through ?? null, lim],
      );
      const active = await db.query(
        `SELECT observed_at,active_bin_id FROM protocol.pool_snapshots WHERE pool_address=$1 AND observed_at>=$2 AND ($3::timestamptz IS NULL OR observed_at<=$3) ORDER BY observed_at ASC LIMIT $4`,
        [poolAddress, window.since, window.through ?? null, lim],
      );
      /* A forward-outcome window is intrinsically bounded (baseline lookback
       * through frozen horizon). Do not apply the old newest-N timestamp cap
       * there: delayed maturation could otherwise hide valid historical
       * frames behind later wall-clock observations. The legacy live-history
       * path deliberately retains its existing bounded-recency behavior. */
      const stamps = window.through
        ? await db.query(
          `SELECT DISTINCT observed_at FROM protocol.bin_snapshots WHERE pool_address=$1 AND observed_at>=$2 AND observed_at<=$3 ORDER BY observed_at ASC`,
          [poolAddress, window.since, window.through],
        )
        : await db.query(
          `SELECT DISTINCT observed_at FROM protocol.bin_snapshots WHERE pool_address=$1 AND observed_at>=$2 ORDER BY observed_at DESC LIMIT $3`,
          [poolAddress, window.since, Math.min(lim, 240)],
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
      if (stampValues.length) {
        /* Preserve the former per-stamp active-bin lookup and ascending frame
         * order, but fetch the immutable bin frames in one bounded round trip.
         * This is access-path only: no frame, valuation, or outcome semantics
         * change. */
        const rows = await db.query(
          `WITH selected_stamps AS (SELECT unnest($2::timestamptz[]) AS observed_at)
           SELECT s.observed_at,p.active_bin_id,b.bin_id,b.price,b.amount_x,b.amount_y,b.liquidity_supply
           FROM selected_stamps s
           JOIN LATERAL (
             SELECT active_bin_id FROM protocol.pool_snapshots
             WHERE pool_address=$1 AND observed_at<=s.observed_at
             ORDER BY observed_at DESC LIMIT 1
           ) p ON true
           JOIN protocol.bin_snapshots b ON b.pool_address=$1 AND b.observed_at=s.observed_at
           ORDER BY s.observed_at ASC,b.bin_id ASC`,
          [poolAddress, stampValues],
        );
        let frameObservedAt: string | undefined;
        let frame: (typeof frames)[number] | undefined;
        for (const row of rows.rows) {
          const observedAt = new Date(String(row.observed_at)).toISOString();
          if (frameObservedAt !== observedAt) {
            frameObservedAt = observedAt;
            const activeBinId = operationalActiveBinIdFromDbValue(row.active_bin_id);
            frame = activeBinId === undefined ? undefined : { observedAt, activeBinId, bins: [] };
            if (frame) frames.push(frame);
          }
          if (!frame) continue;
          frame.bins.push({
            binId: Number(row.bin_id),
            price: String(row.price ?? "0"),
            amountX: String(row.amount_x ?? "0"),
            amountY: String(row.amount_y ?? "0"),
            ...(row.liquidity_supply !== null && row.liquidity_supply !== undefined
              ? { liquiditySupply: String(row.liquidity_supply) }
              : {}),
          });
        }
      }
      const swaps = await db.query(
        `SELECT signature,event_index,pool_address,chain_slot,block_time,observed_at,start_bin_id,end_bin_id,swap_for_y,amount_in,amount_left,amount_out,fee_bps,mm_fee,protocol_fee,limit_order_fee,host_fee,fees_on_input,fees_on_token_x,payload FROM protocol.swap_events WHERE pool_address=$1 AND observed_at>=$2 AND ($3::timestamptz IS NULL OR observed_at<=$3) ORDER BY observed_at ASC LIMIT $4`,
        [poolAddress, window.since, window.through ?? null, lim],
      );
      return {
        marketObservations: market.rows.flatMap((r) => {
          const observation = operationalMarketObservationFromDbRow(r);
          return observation ? [observation] : [];
        }),
        activeBins: active.rows.flatMap((r) => {
          const activeBinId = operationalActiveBinIdFromDbValue(r.active_bin_id);
          return activeBinId === undefined
            ? []
            : [{ observedAt: new Date(String(r.observed_at)).toISOString(), activeBinId }];
        }),
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
    async loadPhase7ControlDecision(runtimeId, decisionId) {
      const r = await db.query(
        `SELECT * FROM operations.phase7_control_decisions WHERE runtime_id=$1 AND decision_id=$2 LIMIT 1`,
        [runtimeId, decisionId],
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
            phase7ReconciliationDebtQuery,
          ),
          db.query(
            `SELECT count(*)::int AS n FROM execution.execution_journal j JOIN execution.transaction_plans p ON p.plan_id=j.plan_id WHERE j.state NOT IN ('RECONCILED','EXPIRED','FAILED','HOLD') AND p.state NOT IN ('BLOCKED','FAILED','EXPIRED','RECONCILED')`,
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
        unresolvedReconciliationDebt: Number(recon.rows[0]?.blocking_debt ?? 0),
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
      const [cycles, actions, queue, unknown, recon, partial] =
        await Promise.all([
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
            phase7ReconciliationDebtQuery,
          ),
          db.query(
            `SELECT count(*)::int AS n FROM execution.partial_entry_recovery WHERE state NOT IN ('RESOLVED','OPEN_RECOVERED','ABORTED_SOL_SETTLED')`,
          ),
        ]);
      return {
        previousCompletedCycleKeys: cycles.rows.map((r) => String(r.cycle_key)),
        completedEconomicActionKeys: actions.rows.map((r) =>
          String(r.idempotency_key),
        ),
        recoveryQueueCount: Number(queue.rows[0]?.n ?? 0),
        unknownSubmissionCount: Number(unknown.rows[0]?.n ?? 0),
        unresolvedReconciliationDebt: Number(recon.rows[0]?.blocking_debt ?? 0),
        supersededReconciliationHistoryCount: Number(recon.rows[0]?.superseded_history ?? 0),
        partialEntryRecoveryCount: Number(partial.rows[0]?.n ?? 0),
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
          phase7ReconciliationDebtQuery,
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
        unresolvedReconciliationDebt: Number(recon.rows[0]?.blocking_debt ?? 0),
        supersededReconciliationHistoryCount: Number(recon.rows[0]?.superseded_history ?? 0),
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
    async reconcileLiveEvidenceAdmission(v) { return {serviceableCapacity:v.serviceableCapacity,productionMonitoredCount:0,activeCount:0,qualifiedWaitingCount:0,promotedPoolAddresses:[],demotedPoolAddresses:[],replacements:[]}; },
    async reconcileEvidenceContinuityTracking(v) { return {capacity:v.capacity,trackedPoolAddresses:[],expiredPoolAddresses:[],evictedPoolAddresses:[]}; },
    async recordLiveEvidenceCollectionOutcome() {},
    async recordEvidenceContinuityCollectionOutcome() {},
    async recordPostEvidenceEvaluationOutcome() {},
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
    async loadDueDiscoveryCounterfactualPredictions() { return []; },
    async loadDiscoveryOutcomes() { return []; },
    async insertForensicEpisode() {
      return "memory-episode";
    },
    async insertCounterfactual() {},
    async insertExperiment() {},
    async insertExperimentResult() {},
    async insertShadowRecommendation() {},
    async loadShadowRecommendationPayload() { return undefined; },
    async insertProductionGlobalCandidate() {},
    async loadProductionGlobalCandidateFacts() { return []; },
    async verifyProductionGlobalWinnerAdmission() { return undefined; },
    async loadProductionPoolSettlementHistory() { return []; },
    async insertProductionGlobalSelection() {},
    async insertReset3cValidationUniverse() { return 'INSERTED' as const; },
    async loadReset3cValidationUniverse() { return undefined; },
    async markTerminalEligibleReset3cValidationUniverses() { return 0; },
    async purgeTerminalEligibleReset3cValidationEvidence() { return 0; },
    async insertCandidateUniverseRerankRetention() { return 'INSERTED' as const; },
    async compactEligibleCandidateUniverseRerankRetention() { return 0; },
    async loadFullUniverseOutcomeCoverageBackfill() { return []; },
    async refreshCandidateUniverseForwardOutcomeCoverage() {},
    async loadStaleCandidateUniverseForwardOutcomeCoverage() { return []; },
    async insertVariableCapitalEvaluation() { return 'INSERTED' as const; },
    async loadDueCandidateCounterfactualOutcomes() { return []; },
    async persistCandidateCounterfactualOutcome() { return 'APPLIED' as const; },
    async loadBinSnapshotRetentionPlan(now) { return {state:'READY' as const,protectionFloor:new Date(Date.parse(now)-4*60*60_000).toISOString(),protectionInputs:{OPERATIONAL_HISTORY:new Date(Date.parse(now)-4*60*60_000).toISOString()},reasonCodes:[]}; },
    async deleteBinSnapshotsBefore() { return {deleted:0}; },
    async insertPhase3ForwardDecision() { return false; },
    async ensurePhase3ForwardOutcome() { return false; },
    async loadDuePhase3ForwardOutcomes() { return []; },
    async persistPhase3ForwardOutcome() { return {writeApplied:false,stateTransition:false,retryNoProgress:false}; },
    async loadPhase3ForwardOutcomes() { return []; },
    async preparePostEntryTelemetryEpisodes() { return {created:0}; },
    async loadDuePostEntryTelemetryCheckpoints() { return []; },
    async appendPostEntryTelemetryObservation(v) { return {status:'INSERTED' as const,contentHash:await sha256Hex(canonicalJson(v.content))}; },
    async loadPostEntryTelemetryEpisode() { return undefined; },
    async ensureMarketContextTelemetryActivation(v) { return {created:false,activatedAt:v.activatedAt}; },
    async loadDueProspectiveMarketContextSnapshots() { return []; },
    async appendProspectiveMarketContextSnapshot(v) { return {status:'INSERTED' as const,contentHash:await sha256Hex(canonicalJson({telemetryEpisodeId:v.telemetryEpisodeId,recommendationId:v.recommendationId,poolAddress:v.poolAddress,decisionAt:v.decisionAt,captureStatus:v.captureStatus,reasonCodes:[...v.reasonCodes].sort(),availability:v.availability,rawPayload:v.rawPayload,derivedInterpretation:v.derivedInterpretation,provenance:v.provenance,facts:v.facts}))}; },
    async loadProspectiveMarketContextSnapshot() { return undefined; },
    async ensureInventoryForecastV2Activation(v) { return {created:false,activatedAt:v.activatedAt}; },
    async loadDueInventoryForecastV2Predictions() { return []; },
    async appendInventoryForecastV2Prediction(v) { return {status:'INSERTED' as const,contentHash:await sha256Hex(canonicalJson({telemetryEpisodeId:v.telemetryEpisodeId,recommendationId:v.recommendationId,candidateId:v.candidateId,poolAddress:v.poolAddress,decisionAt:v.decisionAt,captureStatus:v.captureStatus,reasonCodes:[...v.reasonCodes].sort(),rawFrozenInputs:v.rawFrozenInputs,derivedForecast:v.derivedForecast,provenance:v.provenance}))}; },
    async loadInventoryForecastV2ValidationRows() { return []; },
    async insertRegimeAssessment() {},
    async insertLpThesis() {},
    async insertEntryEvaluation() {},
    async loadFreshPhase4EntryAuthorization() { return undefined; },
    async insertRiskDecision() {},
    async upsertPaperPosition() {},
    async insertPaperPositionEvent() {},
    async insertManagementDecision() {},
    async insertCapitalAllocation() {},
    async insertPaperPortfolioSnapshot() {},
    async insertExecutionIntent() {},
    async insertTransactionPlan() {},
    async ensureExecutionTransactionStep() {},
    async claimNextAutonomousPlan() {
      return undefined;
    },
    async reserveExecutionCapital() { return {approved:true,reasonCodes:['P6_CAPITAL_RESERVED'],deployedLamports:0n,reservedLamports:0n,availableLamports:0n}; },
    async releaseExecutionCapital() {},
    async markExecutionCapitalSubmitted() {},
    async reconcileExecutionCapitalReservations() {},
    async countExecutionActionsSince() { return 0; },
    async reserveControlledCanaryCampaignOpen() { return {reserved:true}; },
    async claimNextAutonomousOpenPlan() {
      return undefined;
    },
    async transitionAutonomousPlan() {},
    async completeAutonomousPlan() {},
    async upsertOwnedPosition() {},
    async insertPositionObservation() {},
    async loadLatestPositionManagementMetrics() { return null; },
    async insertPositionManagementMetrics() {},
    async loadPositionOorLifecycleState() { return null; },
    async reconstructPositionOorLifecycleState() { return null; },
    async upsertPositionOorLifecycleState() {},
    async insertPositionManagementDecisionAudit() {},
    async loadOwnedPositions() {
      return [];
    },
    async upsertWalletPositionDiscovery() {},
    async loadWalletPositionDiscoveries() { return []; },
    async findAutonomousOpenPlansByPosition() { return []; },
    async loadOwnedPoolHistory() { return []; },
    async loadPhase7PortfolioFacts() { return {deployedLamports:0n,pendingReservedLamports:0n,pendingExecutionCount:0,openPositions:0,unresolvedReconciliationDebt:0,poolExposureLamports:{},poolPendingLamports:{},tokenExposureLamports:{},tokenPendingLamports:{}}; },
    async loadPhase7PortfolioRiskState() { return undefined; },
    async upsertPhase7PortfolioRiskState() {},
    async loadPositionExitState() { return null; },
    async upsertPositionExitState() {},
    async hasActiveAutonomousPlan() {
      return false;
    },
    async loadActiveAutonomousPlansForPosition() { return []; },
    async markOwnedPositionLifecycle() {},
    async adjustOwnedPositionCapital() {},
    async insertPositionCashflow() {},
    async loadPositionCashflows() { return []; },
    async ensurePositionLifecycle(v) { return {lifecycleId:`lifecycle:${v.positionAddress}`,positionAddress:v.positionAddress,...(v.entryPlanId?{entryPlanId:v.entryPlanId}:{}),ownerAddress:v.ownerAddress,poolAddress:v.poolAddress,...(v.predecessorLifecycleId?{predecessorLifecycleId:v.predecessorLifecycleId}:{}),status:"OPEN" as const}; },
    async linkPositionLifecyclePlan() {},
    async loadLifecycleSettlementInput() { return undefined; },
    async persistLifecycleSolSettlement(v) { if(!v.assessment.ready)throw new Error("LPFORGE_SETTLEMENT_NOT_READY");return{lifecycleId:v.input.lifecycle.lifecycleId,settlementId:`settlement:${v.input.lifecycle.lifecycleId}:v1`,created:true}; },
    async upsertLifecycleSettlementChainReconciliation() {},
    async upsertCloseFeeAttributionSnapshot() {},
    async finalizeCloseFeeAttribution() { return {status:'UNAVAILABLE' as const,reasonCodes:['FIXTURE_CLOSE_FEE_ATTRIBUTION_UNAVAILABLE']}; },
    async loadTerminalCloseRentRecoveryCandidates() { return []; },
    async loadPendingPositionManagementDecisionAuditCompactions() { return []; },
    async compactPositionManagementDecisionAudit() { return {compacted:false}; },
    async createLiveSolSettledLearningOutcome() { return {created:false,reasonCodes:["LPFORGE_LIVE_OUTCOME_SETTLEMENT_OR_LINEAGE_MISSING"]}; },
    async createLiveEntryAbortedLearningOutcome() { return {created:false,reasonCodes:["LPFORGE_LIVE_ABORTED_OUTCOME_RECOVERY_OR_LINEAGE_MISSING"]}; },
    async loadPendingLiveSolSettledLearningOutcomes() { return []; },
    async loadLiveLearningOutcomes() { return []; },
    async insertLiveLearningCalibration() {},
    async createPositionInventoryLot() {},
    async settlePositionInventoryLot() { return {remainingRawAmount:0n,status:"SETTLED" as PositionInventoryLotStatus}; },
    async retainPositionInventoryLotDust() {},
    async correctAggregateCloseClaimAttribution() {},
    async loadPositionInventoryLots() { return []; },
    async loadOwnerPositionInventoryLots() { return []; },
    async insertPlanCashflow() {},
    async loadPlanCashflows() { return []; },
    async upsertPartialEntryRecovery() {},
    async loadPartialEntryRecoveries() {
      return [];
    },
    async loadPartialEntryRecovery() { return undefined; },
    async upsertOpenChunkDisposition() {},
    async loadOpenChunkDispositions() { return []; },
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
    async markSubmissionExpired() {},
    async recoverNoEffectPreflightSubmissionAttempts() { return 0; },
    async loadSubmissionAttemptBySignature() { return undefined; },
    async loadConfirmedSubmissionByTransactionId() { return undefined; },
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
    async loadPhase7ControlDecision() {
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
        supersededReconciliationHistoryCount: 0,
        partialEntryRecoveryCount: 0,
      };
    },
    async loadPhase7EvidenceFacts() {
      return {
        runtimeCycleCount: 0,
        unresolvedReconciliationDebt: 0,
        supersededReconciliationHistoryCount: 0,
        canaryRunCount: 0,
        fullyReconciledCanaryCount: 0,
        phase7ExitPass: false,
        mainnetReadOnlyCycleCount: 0,
        submissionCount: 0,
      };
    },
  };
}
