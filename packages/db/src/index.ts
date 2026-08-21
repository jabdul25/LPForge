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
const WSOL_MINT="So11111111111111111111111111111111111111112";

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
  admissionEligible?:boolean;
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
 if(value.eventPathEstimateFresh&&value.phase3CurrentLiveReady)return 'LIVE_EVIDENCE_LEASE_PHASE3_READY';
 if(value.phase3Status==='ENTRY_READY'||value.phase3Status==='NO_TRADE')return 'LIVE_EVIDENCE_LEASE_TERMINAL_PHASE3';
 if(!value.startedAt)return undefined;
 if(Number(value.failureCount??0)>=ACTIVE_EVIDENCE_LEASE_MAX_FAILURES)return 'LIVE_EVIDENCE_LEASE_COLLECTION_FAILURE_LIMIT';
 return isLiveEvidenceLeaseActive(value,observedAt)?undefined:'LIVE_EVIDENCE_LEASE_TIMEOUT';
}
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

export function selectLiveEvidenceAdmissionCandidates<T extends LiveEvidenceAdmissionCandidate>(candidates:readonly T[],capacity:number):T[]{
  const stateRank=(state:string)=>state==='ACTIVE_CANDIDATE'?0:1;
  const base=(a:T,b:T)=>
    Number(b.matureForPhase3)-Number(a.matureForPhase3)
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
  const slots=Math.max(0,Math.floor(capacity)),eligible=candidates.filter(candidate=>!candidate.phase3Terminal&&candidate.admissionEligible!==false),leased=eligible.filter(candidate=>candidate.evidenceLeaseActive).sort(base),selected=leased.slice(0,slots),protectedCandidates=eligible.filter(candidate=>!candidate.evidenceLeaseActive&&candidate.matureForPhase3).sort(base);
  for(const candidate of protectedCandidates){if(selected.length>=slots)break;selected.push(candidate);}
  let remaining=slots-selected.length;
  if(!remaining)return selected;
  const ordinary=eligible.filter(candidate=>!candidate.matureForPhase3),bootstrap=ordinary.filter(candidate=>!candidate.economicQuality).sort(base),economicallyComparable=ordinary.filter(candidate=>candidate.economicQuality).sort(economic);
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
  | "TRANSFERRED";
export type PositionInventoryLotEventType =
  | "CREATED"
  | "SETTLED"
  | "TRANSFERRED";
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
export interface LifecycleChildTransaction {transactionId:string;signature?:string;state:LifecycleChildTransactionState;}
export interface LifecycleSettlementCashflow {cashflowId:string;flowType:string;lamports?:bigint;tokenMint?:string;tokenAmountRaw?:string;}
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
const SETTLEMENT_SOL_IN=new Set(["FEE_CLAIM","REWARD_CLAIM","REDUCE_WITHDRAWAL","CLOSE_WITHDRAWAL","SWAP_PROCEEDS","RENT_RECOVERY"]);
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
    if(lot.remainingRawAmount!==0n||!(lot.status==="SETTLED"||lot.status==="TRANSFERRED")){reasons.push(`SETTLEMENT_INVENTORY_REMAINS:${lot.lotId}`);continue;}
    const terminal=lot.payload.terminalSettlement;
    if(lot.status==="SETTLED"&&(!terminal||typeof terminal!=="object"||typeof (terminal as Record<string,unknown>).transactionSignature!=="string"))reasons.push(`SETTLEMENT_INVENTORY_DISPOSITION_MISSING:${lot.lotId}`);
    if(lot.status==="TRANSFERRED"&&(!terminal||typeof terminal!=="object"||typeof (terminal as Record<string,unknown>).successorPositionAddress!=="string"||String((terminal as Record<string,unknown>).transferredRawAmount??"")!==lot.rawAmount.toString()))reasons.push(`SETTLEMENT_INVENTORY_SUCCESSOR_MISSING:${lot.lotId}`);
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
  reconcileLiveEvidenceAdmission(value:{observedAt:string;serviceableCapacity:number;productionMonitoredPoolAddresses?:string[]}):Promise<{serviceableCapacity:number;productionMonitoredCount:number;activeCount:number;qualifiedWaitingCount:number;promotedPoolAddresses:string[];demotedPoolAddresses:string[]}>;
  recordLiveEvidenceCollectionOutcome(value:{poolAddress:string;observedAt:string;success:boolean;eventPathEstimate?:boolean;phase3CurrentLiveReady?:boolean}):Promise<void>;
  recordPostEvidenceEvaluationOutcome(value:{poolAddress:string;observedAt:string;phase3Status:string}):Promise<void>;
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
  loadOwnedPositions(ownerAddress: string): Promise<Record<string, unknown>[]>;
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
  persistLifecycleSolSettlement(value:{assessment:LifecycleSettlementAssessment;input:LifecycleSettlementInput;sourceCommit?:string;policyHash?:string;migrationHead?:string;buildId?:string;at:string}):Promise<{lifecycleId:string;settlementId:string;created:boolean}>;
  createLiveSolSettledLearningOutcome(value:{positionAddress:string;at:string}):Promise<{created:boolean;outcome?:LiveLearningOutcome;reasonCodes:string[]}>;
  createLiveEntryAbortedLearningOutcome(value:{planId:string;at:string}):Promise<{created:boolean;outcome?:LiveLearningOutcome;reasonCodes:string[]}>;
  loadPendingLiveSolSettledLearningOutcomes(limit?:number):Promise<string[]>;
  loadLiveLearningOutcomes(limit?:number):Promise<Array<Record<string,unknown>>>;
  insertLiveLearningCalibration(value:{snapshotId:string;observedAt:string;sampleCount:number;independentEpisodes:number;brierProfit?:number;netPnlMaeLamports?:number;meanBiasLamports?:number;payload:Record<string,unknown>}):Promise<void>;
  createPositionInventoryLot(value:Omit<PositionInventoryLot,"remainingRawAmount"|"status">&{createdEventId:string;transactionSignature?:string}):Promise<void>;
  settlePositionInventoryLot(value:{eventId:string;lotId:string;planId?:string;eventType:"SETTLED"|"TRANSFERRED";settledRawAmount:bigint;observedAt:string;transactionSignature?:string;payload:Record<string,unknown>}):Promise<{remainingRawAmount:bigint;status:PositionInventoryLotStatus}>;
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
    partialEntryRecoveryCount: number;
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
    state: String(row.state),
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
        `INSERT INTO market.pool_discovery_registry(pool_address,first_seen_at,last_seen_at,source_manual,source_auto,token_x_mint,token_y_mint,paired_token_mint,paired_token_symbol,market_cap_cohort,current_state,current_tier,last_priority_score,last_rank,last_universe_percentile,reason_codes,evidence_state,payload) VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb) ON CONFLICT(pool_address) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at,source_manual=market.pool_discovery_registry.source_manual OR EXCLUDED.source_manual,source_auto=market.pool_discovery_registry.source_auto OR EXCLUDED.source_auto,token_x_mint=COALESCE(EXCLUDED.token_x_mint,market.pool_discovery_registry.token_x_mint),token_y_mint=COALESCE(EXCLUDED.token_y_mint,market.pool_discovery_registry.token_y_mint),paired_token_mint=COALESCE(EXCLUDED.paired_token_mint,market.pool_discovery_registry.paired_token_mint),paired_token_symbol=COALESCE(EXCLUDED.paired_token_symbol,market.pool_discovery_registry.paired_token_symbol),market_cap_cohort=EXCLUDED.market_cap_cohort,current_state=CASE WHEN EXCLUDED.current_state='PREFILTERED' AND market.pool_discovery_registry.current_state IN ('ACTIVE_CANDIDATE','WATCHLIST','QUALIFIED') AND COALESCE(EXCLUDED.payload->>'deepScreened','false')<>'true' THEN market.pool_discovery_registry.current_state WHEN EXCLUDED.current_state='QUALIFIED' AND EXCLUDED.current_tier='A' AND market.pool_discovery_registry.current_state='ACTIVE_CANDIDATE' THEN market.pool_discovery_registry.current_state ELSE EXCLUDED.current_state END,current_tier=CASE WHEN EXCLUDED.current_state='PREFILTERED' AND market.pool_discovery_registry.current_state IN ('ACTIVE_CANDIDATE','WATCHLIST','QUALIFIED') AND COALESCE(EXCLUDED.payload->>'deepScreened','false')<>'true' THEN market.pool_discovery_registry.current_tier WHEN EXCLUDED.current_state='QUALIFIED' AND EXCLUDED.current_tier='A' AND market.pool_discovery_registry.current_state='ACTIVE_CANDIDATE' THEN market.pool_discovery_registry.current_tier ELSE EXCLUDED.current_tier END,last_priority_score=EXCLUDED.last_priority_score,last_rank=EXCLUDED.last_rank,last_universe_percentile=EXCLUDED.last_universe_percentile,reason_codes=EXCLUDED.reason_codes,evidence_state=EXCLUDED.evidence_state,payload=market.pool_discovery_registry.payload || EXCLUDED.payload`,
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
    async reconcileLiveEvidenceAdmission(v) {
      const capacity=Math.max(0,Math.floor(v.serviceableCapacity)),monitored=[...new Set((v.productionMonitoredPoolAddresses??[]).map(x=>x.trim()).filter(Boolean))],tx=db;
      try {
        await tx.query('BEGIN');
        await tx.query("SELECT pg_advisory_xact_lock(hashtext('LPFORGE_LIVE_EVIDENCE_ADMISSION'))");
        const rows=await tx.query(`SELECT registry.pool_address,registry.current_state,registry.last_priority_score,registry.last_rank,registry.first_seen_at,registry.payload,maturity.state AS maturity_state,maturity.payload->>'historicalMaturity' AS historical_maturity,maturity.payload->>'liveConfirmation' AS live_confirmation,cycle.phase3_status,economic.as_of AS event_path_as_of,economic.fee_rate_per_capital_hour,economic.uncertainty AS event_path_uncertainty,prediction.observed_at AS forecast_as_of,(prediction.prediction#>>'{deep,toxicity,adverseInventoryPressure}') AS adverse_inventory_pressure,(prediction.prediction#>>'{strategy,strategies,0,uncertainty}') AS forecast_uncertainty FROM market.pool_discovery_registry registry LEFT JOIN market.active_candidate_history_maturity maturity ON maturity.pool_address=registry.pool_address LEFT JOIN LATERAL (SELECT phase3_status FROM operations.forward_cycles WHERE pool_address=registry.pool_address ORDER BY observed_at DESC LIMIT 1) cycle ON true LEFT JOIN LATERAL (SELECT as_of,fee_rate_per_capital_hour,uncertainty FROM research.economic_estimates WHERE pool_address=registry.pool_address AND fidelity='EVENT_PATH_ESTIMATE' AND as_of<=$2::timestamptz ORDER BY as_of DESC LIMIT 1) economic ON true LEFT JOIN LATERAL (SELECT observed_at,prediction FROM research.discovery_predictions WHERE pool_address=registry.pool_address AND observed_at<=$2::timestamptz ORDER BY observed_at DESC LIMIT 1) prediction ON true WHERE registry.current_tier='A' AND registry.current_state IN ('ACTIVE_CANDIDATE','QUALIFIED') AND NOT(registry.pool_address=ANY($1::text[])) FOR UPDATE OF registry`,[monitored,v.observedAt]);
        const now=Date.parse(v.observedAt),targets=rows.rows.map(row=>{const payload=(row.payload??{}) as Record<string,unknown>,eventPathAt=row.event_path_as_of?new Date(String(row.event_path_as_of)).toISOString():undefined,eventPathFresh=eventPathAt!==undefined&&Number.isFinite(now)&&now-Date.parse(eventPathAt)<=LIVE_EVIDENCE_ECONOMIC_RANKING_FRESHNESS_SECONDS*1000,phase3Status=String(row.phase3_status??''),hasLease=typeof payload.liveEvidenceLeaseStartedAt==='string',leaseActive=isLiveEvidenceLeaseActive({startedAt:typeof payload.liveEvidenceLeaseStartedAt==='string'?payload.liveEvidenceLeaseStartedAt:undefined,expiresAt:typeof payload.liveEvidenceLeaseExpiresAt==='string'?payload.liveEvidenceLeaseExpiresAt:undefined,failureCount:Number(payload.liveEvidenceLeaseFailures??0)},v.observedAt),cooling=typeof payload.liveEvidenceLeaseNextEligibleAt==='string'&&Date.parse(payload.liveEvidenceLeaseNextEligibleAt)>now,releaseReason=liveEvidenceLeaseReleaseReason({state:String(row.current_state),startedAt:hasLease?String(payload.liveEvidenceLeaseStartedAt):undefined,expiresAt:typeof payload.liveEvidenceLeaseExpiresAt==='string'?payload.liveEvidenceLeaseExpiresAt:undefined,failureCount:Number(payload.liveEvidenceLeaseFailures??0),eventPathEstimateFresh:eventPathFresh,phase3Status},v.observedAt),release=releaseReason!==undefined,economicQuality=freshLiveEvidenceEconomicQuality(eventPathAt?{eventPathAsOf:eventPathAt,forecastAsOf:new Date(String(row.forecast_as_of??row.event_path_as_of)).toISOString(),feeRatePerCapitalHour:Number(row.fee_rate_per_capital_hour),...(Number.isFinite(Number(row.adverse_inventory_pressure))?{adverseInventoryPressure:Number(row.adverse_inventory_pressure)}:{}),forecastUncertainty:Number(row.forecast_uncertainty??row.event_path_uncertainty)}:undefined,v.observedAt);return{poolAddress:String(row.pool_address),state:String(row.current_state),priorityScore:Number(row.last_priority_score??0),rank:row.last_rank===null?undefined:Number(row.last_rank),firstSeenAt:new Date(String(row.first_seen_at)).toISOString(),matureForPhase3:String(row.maturity_state??'')==='MATURE'&&String(row.historical_maturity??'')==='MATURE'&&String(row.live_confirmation??'')==='CONFIRMED',phase3Terminal:isLiveEvidenceAdmissionTerminal(phase3Status)||release,evidenceLeaseActive:String(row.current_state)==='ACTIVE_CANDIDATE'&&leaseActive&&!release,admissionEligible:!cooling&&!release,...(economicQuality?{economicQuality}:{})};}),available=dynamicLiveEvidenceAdmissionCapacity({serviceableCapacity:capacity,staticPolicyPoolCount:monitored.length}),admitted=selectLiveEvidenceAdmissionCandidates(targets,available),admittedSet=new Set(admitted.map(x=>x.poolAddress)),promoted=admitted.filter(x=>x.state==='QUALIFIED'),demoted=targets.filter(x=>x.state==='ACTIVE_CANDIDATE'&&!admittedSet.has(x.poolAddress));
        if(demoted.length)await tx.query(`UPDATE market.pool_discovery_registry SET current_state='QUALIFIED',reason_codes=(reason_codes-'LIVE_EVIDENCE_ADMITTED')||'["LIVE_EVIDENCE_WAITING_FOR_CAPACITY"]'::jsonb,payload=payload||jsonb_build_object('liveEvidenceAdmission','WAITING','liveEvidenceAdmissionAt',$2::text,'liveEvidenceLeaseReleasedAt',$2::text,'liveEvidenceLeaseNextEligibleAt',($2::timestamptz + interval '15 minutes')::text) WHERE pool_address=ANY($1::text[])`,[demoted.map(x=>x.poolAddress),v.observedAt]);
        if(promoted.length)await tx.query(`UPDATE market.pool_discovery_registry SET current_state='ACTIVE_CANDIDATE',reason_codes=(reason_codes-'LIVE_EVIDENCE_WAITING_FOR_CAPACITY')||'["LIVE_EVIDENCE_ADMITTED"]'::jsonb,payload=payload||jsonb_build_object('liveEvidenceAdmission','ADMITTED','liveEvidenceAdmissionAt',$2::text) WHERE pool_address=ANY($1::text[])`,[promoted.map(x=>x.poolAddress),v.observedAt]);
        await tx.query('COMMIT');
        return{serviceableCapacity:capacity,productionMonitoredCount:monitored.length,activeCount:admitted.length,qualifiedWaitingCount:targets.length-admitted.length,promotedPoolAddresses:promoted.map(x=>x.poolAddress),demotedPoolAddresses:demoted.map(x=>x.poolAddress)};
      } catch(error) {try{await tx.query('ROLLBACK');}catch{} throw error;}
    },
    async recordLiveEvidenceCollectionOutcome(v) {
      const tx=db,now=Date.parse(v.observedAt),nextEligibleAt=new Date(now+ACTIVE_EVIDENCE_LEASE_RETRY_COOLDOWN_MS).toISOString();
      try {
        await tx.query('BEGIN');
        await tx.query("SELECT pg_advisory_xact_lock(hashtext('LPFORGE_LIVE_EVIDENCE_ADMISSION'))");
        const found=await tx.query(`SELECT current_state,payload FROM market.pool_discovery_registry WHERE pool_address=$1 FOR UPDATE`,[v.poolAddress]),row=found.rows[0];
        if(!row||row.current_state!=='ACTIVE_CANDIDATE'){await tx.query('COMMIT');return;}
        const payload=(row.payload??{}) as Record<string,unknown>,priorFailures=Math.max(0,Math.floor(Number(payload.liveEvidenceLeaseFailures??0)));
        if(v.success&&v.eventPathEstimate&&v.phase3CurrentLiveReady){const handoffExpiresAt=new Date(now+POST_EVIDENCE_EVALUATION_WINDOW_MS).toISOString();await tx.query(`UPDATE market.pool_discovery_registry SET current_state='QUALIFIED',reason_codes=(reason_codes-'LIVE_EVIDENCE_ADMITTED')||'["LIVE_EVIDENCE_LEASE_PHASE3_READY"]'::jsonb,payload=payload||jsonb_build_object('liveEvidenceAdmission','WAITING','liveEvidenceLeaseReleaseReason','LIVE_EVIDENCE_LEASE_PHASE3_READY','liveEvidenceLeaseReleasedAt',$2::text,'liveEvidenceLeaseNextEligibleAt',$3::text,'liveEvidenceLeaseFailures',0,'postEvidenceEvaluationState','ELIGIBLE','postEvidenceEvaluationEligibleAt',$2::text,'postEvidenceEvaluationExpiresAt',$4::text,'postEvidenceEventPathAt',$2::text) WHERE pool_address=$1`,[v.poolAddress,v.observedAt,nextEligibleAt,handoffExpiresAt]);}
        else if(v.success){const startedAt=typeof payload.liveEvidenceLeaseStartedAt==='string'&&Number.isFinite(Date.parse(payload.liveEvidenceLeaseStartedAt))?payload.liveEvidenceLeaseStartedAt:v.observedAt,expiresAt=typeof payload.liveEvidenceLeaseExpiresAt==='string'&&Number.isFinite(Date.parse(payload.liveEvidenceLeaseExpiresAt))?payload.liveEvidenceLeaseExpiresAt:liveEvidenceLeaseExpiresAt(startedAt);await tx.query(`UPDATE market.pool_discovery_registry SET payload=payload||jsonb_build_object('liveEvidenceAdmission','ADMITTED','liveEvidenceLeaseStartedAt',$2::text,'liveEvidenceLeaseExpiresAt',$3::text,'liveEvidenceLeaseFailures',0,'liveEvidenceLastSuccessfulAt',$4::text) WHERE pool_address=$1`,[v.poolAddress,startedAt,expiresAt??v.observedAt,v.observedAt]);}
        else {const failures=priorFailures+1;if(failures>=ACTIVE_EVIDENCE_LEASE_MAX_FAILURES)await tx.query(`UPDATE market.pool_discovery_registry SET current_state='QUALIFIED',reason_codes=(reason_codes-'LIVE_EVIDENCE_ADMITTED')||'["LIVE_EVIDENCE_LEASE_COLLECTION_FAILURE_LIMIT"]'::jsonb,payload=payload||jsonb_build_object('liveEvidenceAdmission','WAITING','liveEvidenceLeaseReleaseReason','LIVE_EVIDENCE_LEASE_COLLECTION_FAILURE_LIMIT','liveEvidenceLeaseReleasedAt',$2::text,'liveEvidenceLeaseNextEligibleAt',$3::text,'liveEvidenceLeaseFailures',$4::int) WHERE pool_address=$1`,[v.poolAddress,v.observedAt,nextEligibleAt,failures]);else await tx.query(`UPDATE market.pool_discovery_registry SET payload=payload||jsonb_build_object('liveEvidenceLeaseFailures',$2::int,'liveEvidenceLastFailureAt',$3::text) WHERE pool_address=$1`,[v.poolAddress,failures,v.observedAt]);}
        await tx.query('COMMIT');
      } catch(error) {try{await tx.query('ROLLBACK');}catch{} throw error;}
    },
    async recordPostEvidenceEvaluationOutcome(v) {
      if(v.phase3Status!=='ENTRY_READY'&&v.phase3Status!=='NO_TRADE')return;
      await db.query(`UPDATE market.pool_discovery_registry SET payload=payload||jsonb_build_object('postEvidenceEvaluationState','COMPLETED','postEvidenceEvaluationCompletedAt',$2::text,'postEvidenceEvaluationClearReason',$3::text) WHERE pool_address=$1 AND payload->>'postEvidenceEvaluationState'='ELIGIBLE' AND COALESCE(NULLIF(payload->>'postEvidenceEvaluationEligibleAt','')::timestamptz,'epoch'::timestamptz)<=$2::timestamptz`,[v.poolAddress,v.observedAt,`POST_EVIDENCE_PHASE3_${v.phase3Status}`]);
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
            : undefined;
      if (terminalJournalState)
        await db.query(
          `UPDATE execution.execution_journal SET state=$2,updated_at=$3,payload=payload||jsonb_build_object('terminalPlanState',$4,'terminalizedAt',$3::text) WHERE plan_id=$1 AND state IN ('PLAN_CREATED','BUILT','SIMULATED','APPROVED','SIGNED')`,
          [v.planId, terminalJournalState, v.at, v.state],
        );
    },
    async completeAutonomousPlan(v) {
      await db.query(
        `UPDATE execution.transaction_plans SET state=$2,payload=payload||jsonb_build_object('autonomous_dispatch_completed_at',$3::text,'autonomous_dispatch',COALESCE(payload->'autonomous_dispatch','{}'::jsonb)||$4::jsonb) WHERE plan_id=$1`,
        [v.planId, v.state, v.at, json(v.payload)],
      );
      const terminalJournalState =
        v.state === "BLOCKED" || v.state === "FAILED" ? "FAILED" : undefined;
      if (terminalJournalState)
        await db.query(
          `UPDATE execution.execution_journal SET state=$2,updated_at=$3,payload=payload||jsonb_build_object('terminalPlanState',$4,'terminalizedAt',$3::text) WHERE plan_id=$1 AND state IN ('PLAN_CREATED','BUILT','SIMULATED','APPROVED','SIGNED')`,
          [v.planId, terminalJournalState, v.at, v.state],
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
    async loadOwnedPositions(ownerAddress) {
      const r = await db.query(
        `SELECT * FROM execution.owned_positions WHERE owner_address=$1 AND lifecycle_state IN ('OPEN','CLOSING','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN') ORDER BY entered_at ASC`,
        [ownerAddress],
      );
      return r.rows;
    },
    async loadOwnedPoolHistory(ownerAddress){const r=await db.query("SELECT DISTINCT o.pool_address,p.token_x_mint,p.token_y_mint FROM execution.owned_positions o LEFT JOIN protocol.pools p ON p.address=o.pool_address WHERE o.owner_address=$1",[ownerAddress]);return r.rows.map(row=>({poolAddress:String(row.pool_address),...(row.token_x_mint?{tokenXMint:String(row.token_x_mint)}:{}),...(row.token_y_mint?{tokenYMint:String(row.token_y_mint)}:{})}));},
    async loadPhase7PortfolioFacts(ownerAddress){const [positions,reservations,recon,pending]=await Promise.all([db.query("SELECT COALESCE(sum(o.initial_capital_lamports),0)::text AS deployed,count(*)::int AS open_positions,COALESCE((SELECT jsonb_object_agg(g.pool_address,g.deployed) FROM (SELECT p.address AS pool_address,COALESCE(sum(o2.initial_capital_lamports),0) AS deployed FROM execution.owned_positions o2 JOIN protocol.pools p ON p.address=o2.pool_address WHERE o2.owner_address=$1 AND o2.lifecycle_state IN ('OPEN','CLOSING','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN') GROUP BY p.address) g),'{}'::jsonb) AS by_pool,COALESCE((SELECT jsonb_object_agg(g.token_x_mint,g.deployed) FROM (SELECT p.token_x_mint,COALESCE(sum(o3.initial_capital_lamports),0) AS deployed FROM execution.owned_positions o3 JOIN protocol.pools p ON p.address=o3.pool_address WHERE o3.owner_address=$1 AND o3.lifecycle_state IN ('OPEN','CLOSING','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN') AND p.token_x_mint IS NOT NULL GROUP BY p.token_x_mint) g),'{}'::jsonb) AS by_token FROM execution.owned_positions o WHERE o.owner_address=$1 AND o.lifecycle_state IN ('OPEN','CLOSING','RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN')",[ownerAddress]),db.query("SELECT COALESCE(sum(capital_lamports),0)::text AS reserved,COALESCE((SELECT jsonb_object_agg(g.pool_address,g.reserved) FROM (SELECT pool_address,COALESCE(sum(capital_lamports),0) AS reserved FROM execution.capital_reservations WHERE owner_address=$1 AND state IN ('RESERVED','SUBMITTED') AND pool_address IS NOT NULL GROUP BY pool_address) g),'{}'::jsonb) AS by_pool,COALESCE((SELECT jsonb_object_agg(g.token_mint,g.reserved) FROM (SELECT token_mint,COALESCE(sum(capital_lamports),0) AS reserved FROM execution.capital_reservations WHERE owner_address=$1 AND state IN ('RESERVED','SUBMITTED') AND token_mint IS NOT NULL GROUP BY token_mint) g),'{}'::jsonb) AS by_token FROM execution.capital_reservations WHERE owner_address=$1 AND state IN ('RESERVED','SUBMITTED')",[ownerAddress]),db.query("SELECT count(*)::int AS n FROM execution.owned_positions WHERE owner_address=$1 AND lifecycle_state IN ('RECONCILIATION_REQUIRED','ENTRY_FUNDED_NOT_OPEN')",[ownerAddress]),db.query("SELECT count(DISTINCT p.plan_id)::int AS n FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id LEFT JOIN execution.execution_journal j ON j.plan_id=p.plan_id WHERE i.owner_address=$1 AND (p.state NOT IN ('BLOCKED','FAILED','EXPIRED','RECONCILED') OR (j.journal_id IS NOT NULL AND j.state NOT IN ('RECONCILED','EXPIRED','FAILED','HOLD')))",[ownerAddress])]);const map=(v:unknown)=>Object.fromEntries(Object.entries((v??{}) as Record<string,unknown>).map(([k,x])=>[k,BigInt(String(x))]));return{deployedLamports:BigInt(String(positions.rows[0]?.deployed??'0')),pendingReservedLamports:BigInt(String(reservations.rows[0]?.reserved??'0')),pendingExecutionCount:Number(pending.rows[0]?.n??0),openPositions:Number(positions.rows[0]?.open_positions??0),unresolvedReconciliationDebt:Number(recon.rows[0]?.n??0),poolExposureLamports:map(positions.rows[0]?.by_pool),poolPendingLamports:map(reservations.rows[0]?.by_pool),tokenExposureLamports:map(positions.rows[0]?.by_token),tokenPendingLamports:map(reservations.rows[0]?.by_token)};},
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
        db.query("SELECT cashflow_id,flow_type,lamports,token_mint,token_amount_raw FROM execution.position_cashflows WHERE lifecycle_id=$1 ORDER BY observed_at,cashflow_id",[l.lifecycle_id]),
        db.query("SELECT lot_id,position_address,plan_id,owner_address,pool_address,token_mint,token_side,source_event,source_cashflow_id,raw_amount,remaining_raw_amount,decimals,acquired_at,status,payload FROM execution.position_inventory_lots WHERE lifecycle_id=$1 ORDER BY acquired_at,lot_id",[l.lifecycle_id]),
        db.query("SELECT s.transaction_id,a.signature,COALESCE(c.status,a.state,CASE WHEN s.state IN ('CONFIRMED','COMPLETED') THEN 'CONFIRMED' ELSE s.state END) state FROM execution.lifecycle_plan_links link JOIN execution.transaction_steps s ON s.plan_id=link.plan_id LEFT JOIN LATERAL (SELECT attempt_id,signature,state FROM execution.submission_attempts WHERE transaction_id=s.transaction_id ORDER BY attempt DESC LIMIT 1) a ON true LEFT JOIN LATERAL (SELECT status FROM execution.confirmations WHERE attempt_id=a.attempt_id ORDER BY observed_at DESC LIMIT 1) c ON true WHERE link.lifecycle_id=$1 ORDER BY s.sequence",[l.lifecycle_id]),
        db.query("SELECT NOT EXISTS(SELECT 1 FROM execution.owned_positions WHERE position_address=$1 AND lifecycle_state='RECONCILIATION_REQUIRED') AS reconciliation_clean,NOT EXISTS(SELECT 1 FROM execution.capital_reservations r JOIN execution.lifecycle_plan_links link ON link.plan_id=r.plan_id WHERE link.lifecycle_id=$2 AND r.state IN ('RESERVED','SUBMITTED')) AS reservation_clean",[positionAddress,l.lifecycle_id])
      ]);
      const normalize=(state:string):LifecycleChildTransactionState=>state==='CONFIRMED'||state==='FINALIZED'?"CONFIRMED":state==='FAILED'||state==='EXPIRED'?"FAILED_FINAL":state==='PROVEN_NOT_LANDED'?"PROVEN_NOT_LANDED":state==='UNKNOWN'?"UNKNOWN":state==='SUBMITTED'||state==='SENT'||state==='PROCESSED'?"SUBMITTED":state==='PREPARED'?"CONFIRMATION_PENDING":"RECOVERY_PENDING";
      return {lifecycle:{lifecycleId:String(l.lifecycle_id),positionAddress:String(l.position_address),...(l.entry_plan_id?{entryPlanId:String(l.entry_plan_id)}:{}),ownerAddress:String(l.owner_address),poolAddress:String(l.pool_address),...(l.predecessor_lifecycle_id?{predecessorLifecycleId:String(l.predecessor_lifecycle_id)}:{}),status:String(l.status) as PositionLifecycle["status"]},cashflows:cash.rows.map(row=>({cashflowId:String(row.cashflow_id),flowType:String(row.flow_type),...(row.lamports===null?{}:{lamports:BigInt(String(row.lamports))}),...(row.token_mint?{tokenMint:String(row.token_mint)}:{}),...(row.token_amount_raw===null?{}:{tokenAmountRaw:String(row.token_amount_raw)} )})),inventoryLots:lots.rows.map(row=>({lotId:String(row.lot_id),positionAddress:String(row.position_address),planId:String(row.plan_id),ownerAddress:String(row.owner_address),poolAddress:String(row.pool_address),tokenMint:String(row.token_mint),tokenSide:String(row.token_side) as PositionInventoryLotSide,sourceEvent:String(row.source_event) as PositionInventoryLotSource,...(row.source_cashflow_id?{sourceCashflowId:String(row.source_cashflow_id)}:{}),rawAmount:BigInt(String(row.raw_amount)),remainingRawAmount:BigInt(String(row.remaining_raw_amount)),decimals:Number(row.decimals),acquiredAt:toIsoTimestamp(row.acquired_at),status:String(row.status) as PositionInventoryLotStatus,payload:(row.payload??{}) as Record<string,unknown>})),transactions:tx.rows.map(row=>({transactionId:String(row.transaction_id),...(row.signature?{signature:String(row.signature)}:{}),state:normalize(String(row.state))})),reconciliationClean:Boolean(res.rows[0]?.reconciliation_clean),reservationClean:Boolean(res.rows[0]?.reservation_clean)};
    },
    async persistLifecycleSolSettlement(v){
      if(!v.assessment.ready)throw new Error(`LPFORGE_SETTLEMENT_NOT_READY:${v.assessment.reasonCodes.join(',')}`);const input=v.input,assessment=v.assessment,evidenceHash=await lifecycleSettlementEvidenceHash(input,assessment),settlementId=`settlement:${input.lifecycle.lifecycleId}:v1`;
      const existing=await db.query("SELECT settlement_id,evidence_hash FROM execution.lifecycle_sol_settlements WHERE lifecycle_id=$1 AND settlement_version=1",[input.lifecycle.lifecycleId]);if(existing.rows[0]){if(String(existing.rows[0].evidence_hash)!==evidenceHash)throw new Error("LPFORGE_SETTLEMENT_EVIDENCE_MISMATCH");return{lifecycleId:input.lifecycle.lifecycleId,settlementId:String(existing.rows[0].settlement_id),created:false};}
      await db.query("BEGIN");try{const inserted=await db.query("INSERT INTO execution.lifecycle_sol_settlements(settlement_id,lifecycle_id,settlement_version,position_address,owner_address,pool_address,entry_plan_id,total_sol_in_lamports,total_sol_out_lamports,rent_locked_lamports,rent_recovered_lamports,net_rent_cost_lamports,realized_sol_pnl_lamports,cashflow_count,inventory_lot_count,child_transaction_count,position_checked_at,position_checked_slot,reconciliation_verified_at,source_commit,policy_hash,migration_head,build_id,evidence_hash,settled_at,payload) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb) ON CONFLICT(lifecycle_id,settlement_version) DO NOTHING RETURNING settlement_id,evidence_hash",[settlementId,input.lifecycle.lifecycleId,input.lifecycle.positionAddress,input.lifecycle.ownerAddress,input.lifecycle.poolAddress,input.lifecycle.entryPlanId??null,assessment.totalSolInLamports.toString(),assessment.totalSolOutLamports.toString(),assessment.rentLockedLamports.toString(),assessment.rentRecoveredLamports.toString(),assessment.netRentCostLamports.toString(),assessment.realizedSolPnlLamports.toString(),input.cashflows.length,input.inventoryLots.length,input.transactions.length,input.positionCheckedAt,input.positionCheckedSlot?.toString()??null,v.at,v.sourceCommit??null,v.policyHash??null,v.migrationHead??null,v.buildId??null,evidenceHash,v.at,json({accountingConvention:'gross-sol-instruction-flows-v1',reasonCodes:assessment.reasonCodes,positionAbsence:{checkedAt:input.positionCheckedAt,slot:input.positionCheckedSlot?.toString()??null,commitment:'confirmed'}})]);if(!inserted.rows[0]){const same=await db.query("SELECT settlement_id,evidence_hash FROM execution.lifecycle_sol_settlements WHERE lifecycle_id=$1 AND settlement_version=1 FOR UPDATE",[input.lifecycle.lifecycleId]),row=same.rows[0];if(!row||String(row.evidence_hash)!==evidenceHash)throw new Error("LPFORGE_SETTLEMENT_EVIDENCE_MISMATCH");await db.query("COMMIT");return{lifecycleId:input.lifecycle.lifecycleId,settlementId:String(row.settlement_id),created:false};}await db.query("UPDATE execution.position_lifecycles SET status='SOL_SETTLED',settled_at=$2 WHERE lifecycle_id=$1",[input.lifecycle.lifecycleId,v.at]);await db.query("UPDATE execution.owned_positions SET lifecycle_state='SOL_SETTLED',reconciliation_status='MATCH' WHERE position_address=$1",[input.lifecycle.positionAddress]);await db.query("COMMIT");return{lifecycleId:input.lifecycle.lifecycleId,settlementId,created:true};}catch(error){try{await db.query("ROLLBACK");}catch{}throw error;}
    },
    async createLiveSolSettledLearningOutcome(v){
      const r=await db.query("SELECT l.lifecycle_id,l.position_address,l.entry_plan_id,l.owner_address,l.pool_address,l.created_at AS entry_at,l.settled_at,o.strategy,o.orientation,o.lower_bin_id,o.upper_bin_id,o.initial_capital_lamports,s.settlement_id,s.settlement_version,s.realized_sol_pnl_lamports,s.net_rent_cost_lamports,s.source_commit,s.policy_hash,s.build_id,s.migration_head,s.evidence_hash AS settlement_evidence_hash,line.prediction_id,line.recommendation_id,line.thesis_id,sr.decision_at AS recommendation_decision_at,sr.payload AS recommendation_payload,t.thesis AS thesis_payload FROM execution.position_lifecycles l JOIN execution.lifecycle_sol_settlements s ON s.lifecycle_id=l.lifecycle_id JOIN execution.owned_positions o ON o.position_address=l.position_address JOIN research.lifecycle_prediction_lineage line ON line.lifecycle_id=l.lifecycle_id JOIN research.shadow_recommendations sr ON sr.recommendation_id=line.recommendation_id JOIN research.lp_theses t ON t.thesis_id=line.thesis_id WHERE l.position_address=$1 AND l.status='SOL_SETTLED'",[v.positionAddress]);
      const row=r.rows[0];if(!row)return{created:false,reasonCodes:["LPFORGE_LIVE_OUTCOME_SETTLEMENT_OR_LINEAGE_MISSING"]};
      const [flows,plans,exitState]=await Promise.all([db.query("SELECT cashflow_id,flow_type,lamports,token_mint,token_amount_raw,payload FROM execution.position_cashflows WHERE lifecycle_id=$1 ORDER BY observed_at,cashflow_id",[row.lifecycle_id]),db.query("SELECT link.role,i.action,p.created_at,p.payload FROM execution.lifecycle_plan_links link JOIN execution.transaction_plans p ON p.plan_id=link.plan_id JOIN execution.intents i ON i.intent_id=p.intent_id WHERE link.lifecycle_id=$1 ORDER BY p.created_at",[row.lifecycle_id]),db.query("SELECT * FROM execution.position_exit_state WHERE lpforge_position_id=$1",[`position-${row.position_address}`])]);
      const amount=(flow:Record<string,unknown>)=>flow.lamports!==null&&flow.lamports!==undefined?BigInt(String(flow.lamports)):flow.token_mint===WSOL_MINT&&flow.token_amount_raw!==null&&flow.token_amount_raw!==undefined?BigInt(String(flow.token_amount_raw)):0n;
      const directFees=flows.rows.filter(flow=>['FEE_CLAIM','REWARD_CLAIM'].includes(String(flow.flow_type))).reduce((total,flow)=>total+amount(flow),0n),txCosts=flows.rows.filter(flow=>['TX_COST','SWAP_COST'].includes(String(flow.flow_type))).reduce((total,flow)=>total+amount(flow),0n),management=plans.rows.filter(plan=>String(plan.role)!=='ENTRY'),counts=(action:string)=>management.filter(plan=>String(plan.action)===action).length,rec=(row.recommendation_payload??{}) as Record<string,unknown>,regime=(rec.regime??{}) as Record<string,unknown>,exit=(exitState.rows[0]?.payload??{}) as Record<string,unknown>,entry=Date.parse(String(row.entry_at)),settled=Date.parse(String(row.settled_at)),capital=BigInt(String(row.initial_capital_lamports)),pnl=BigInt(String(row.realized_sol_pnl_lamports)),outcomeId=`live-outcome:${row.settlement_id}`,returnFraction=capital>0n?Number(pnl)/Number(capital):undefined;
      const thesis=(row.thesis_payload??{}) as Record<string,unknown>,decomposition={accountingConvention:'gross-sol-instruction-flows-v1',netRealizedSolPnlLamports:pnl.toString(),directClaimedFeeSolLamports:directFees.toString(),transactionAndSwapCostLamports:txCosts.toString(),netRentCostLamports:String(row.net_rent_cost_lamports),unwoundTokenXFeeContribution:'UNAVAILABLE_WITHOUT_PER_LOT_SWAP_ALLOCATION',directionalContribution:'UNAVAILABLE_WITHOUT_COUNTERFACTUAL_HODL_ALLOCATION'};
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
    async loadAutonomousPlan(planId) {
      const r = await db.query(
        `SELECT p.plan_id,p.intent_id,p.state,p.expires_at,p.payload AS plan_payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload AS intent_payload,COALESCE(json_agg(json_build_object('transactionId',s.transaction_id,'sequence',s.sequence,'kind',s.kind,'state',s.state,'requiredSignerAddresses',s.required_signers,'metadata',s.metadata) ORDER BY s.sequence) FILTER (WHERE s.transaction_id IS NOT NULL),'[]'::json) AS steps FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id LEFT JOIN execution.transaction_steps s ON s.plan_id=p.plan_id WHERE p.plan_id=$1 GROUP BY p.plan_id,p.intent_id,p.state,p.expires_at,p.payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload`,
        [planId],
      );
      return r.rows[0] ? autonomousPlanFromRow(r.rows[0]) : undefined;
    },
    async loadUnresolvedAutonomousPlans() {
      const r = await db.query(
        `SELECT p.plan_id,p.intent_id,p.state,p.expires_at,p.payload AS plan_payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload AS intent_payload,COALESCE(json_agg(json_build_object('transactionId',s.transaction_id,'sequence',s.sequence,'kind',s.kind,'state',s.state,'requiredSignerAddresses',s.required_signers,'metadata',s.metadata) ORDER BY s.sequence) FILTER (WHERE s.transaction_id IS NOT NULL),'[]'::json) AS steps FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id LEFT JOIN execution.transaction_steps s ON s.plan_id=p.plan_id WHERE p.cluster='mainnet-beta' AND p.state IN ('CLAIMED','DISPATCHING','BUILDING','BUILT','SIMULATING','SIMULATED','RISK_APPROVED','SIGNING','SIGNED','SUBMITTING','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED','RECONCILING','RECOVERING','RECONCILIATION_REQUIRED') OR (p.state='FAILED' AND EXISTS(SELECT 1 FROM execution.transaction_steps s JOIN execution.submission_attempts a ON a.transaction_id=s.transaction_id WHERE s.plan_id=p.plan_id AND a.state IN ('SENT','UNKNOWN'))) GROUP BY p.plan_id,p.intent_id,p.state,p.expires_at,p.payload,i.idempotency_key,i.action,i.pool_address,i.owner_address,i.position_address,i.thesis_id,i.observed_at,i.payload ORDER BY p.created_at ASC`,
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
            `WITH latest AS (SELECT DISTINCT ON (plan_id) plan_id,status FROM execution.reconciliations ORDER BY plan_id,observed_at DESC) SELECT count(*)::int AS n FROM latest WHERE status<>'MATCH'`,
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
        unresolvedReconciliationDebt: Number(recon.rows[0]?.n ?? 0),
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
    async reconcileLiveEvidenceAdmission(v) { return {serviceableCapacity:v.serviceableCapacity,productionMonitoredCount:0,activeCount:0,qualifiedWaitingCount:0,promotedPoolAddresses:[],demotedPoolAddresses:[]}; },
    async recordLiveEvidenceCollectionOutcome() {},
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
    async loadOwnedPoolHistory() { return []; },
    async loadPhase7PortfolioFacts() { return {deployedLamports:0n,pendingReservedLamports:0n,pendingExecutionCount:0,openPositions:0,unresolvedReconciliationDebt:0,poolExposureLamports:{},poolPendingLamports:{},tokenExposureLamports:{},tokenPendingLamports:{}}; },
    async loadPhase7PortfolioRiskState() { return undefined; },
    async upsertPhase7PortfolioRiskState() {},
    async loadPositionExitState() { return null; },
    async upsertPositionExitState() {},
    async hasActiveAutonomousPlan() {
      return false;
    },
    async markOwnedPositionLifecycle() {},
    async adjustOwnedPositionCapital() {},
    async insertPositionCashflow() {},
    async loadPositionCashflows() { return []; },
    async ensurePositionLifecycle(v) { return {lifecycleId:`lifecycle:${v.positionAddress}`,positionAddress:v.positionAddress,...(v.entryPlanId?{entryPlanId:v.entryPlanId}:{}),ownerAddress:v.ownerAddress,poolAddress:v.poolAddress,...(v.predecessorLifecycleId?{predecessorLifecycleId:v.predecessorLifecycleId}:{}),status:"OPEN" as const}; },
    async linkPositionLifecyclePlan() {},
    async loadLifecycleSettlementInput() { return undefined; },
    async persistLifecycleSolSettlement(v) { if(!v.assessment.ready)throw new Error("LPFORGE_SETTLEMENT_NOT_READY");return{lifecycleId:v.input.lifecycle.lifecycleId,settlementId:`settlement:${v.input.lifecycle.lifecycleId}:v1`,created:true}; },
    async createLiveSolSettledLearningOutcome() { return {created:false,reasonCodes:["LPFORGE_LIVE_OUTCOME_SETTLEMENT_OR_LINEAGE_MISSING"]}; },
    async createLiveEntryAbortedLearningOutcome() { return {created:false,reasonCodes:["LPFORGE_LIVE_ABORTED_OUTCOME_RECOVERY_OR_LINEAGE_MISSING"]}; },
    async loadPendingLiveSolSettledLearningOutcomes() { return []; },
    async loadLiveLearningOutcomes() { return []; },
    async insertLiveLearningCalibration() {},
    async createPositionInventoryLot() {},
    async settlePositionInventoryLot() { return {remainingRawAmount:0n,status:"SETTLED" as PositionInventoryLotStatus}; },
    async loadPositionInventoryLots() { return []; },
    async loadOwnerPositionInventoryLots() { return []; },
    async insertPlanCashflow() {},
    async loadPlanCashflows() { return []; },
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
        partialEntryRecoveryCount: 0,
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
