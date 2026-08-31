import { readFileSync } from "node:fs";
import type { PositionV2Fact } from "../../domain/src/index.js";
import type { LiveExitGovernorDecision } from "../../live-exit-governor/src/index.js";

export type LiveManagementAction =
  | "HOLD"
  | "CLAIM"
  | "RESHAPE"
  | "REBALANCE"
  | "REDUCE"
  | "CLOSE"
  | "EMERGENCY_CLOSE";

/**
 * A separate, durable post-entry policy.  This is deliberately not an entry
 * policy and cannot generate a replacement range.  A replacement, if ever
 * justified after settlement, must come from a new production thesis.
 */
export type OorLifecycleState =
  | "IN_RANGE"
  | "TRANSIENT_OOR"
  | "SUSTAINED_OOR"
  | "OOR_ACTION_REQUIRED"
  | "OOR_STALE_CAPITAL";
export type OorDirection = "ABOVE_MAX" | "BELOW_MIN";
export type OorInventoryClassification =
  | "SAFE_OOR_SOL"
  | "OOR_TOKEN_EXPOSURE"
  | "MIXED_INVENTORY"
  | "INVENTORY_UNAVAILABLE";
export type OorLifecycleAction =
  | "HOLD"
  | "FRESH_EVALUATION"
  | "TEMPORARY_HOLD"
  | "CLOSE"
  | "CLOSE_AND_REEVALUATE"
  | "HOLD_CHAIN_RECONCILIATION";

export interface OorLifecyclePolicy {
  schemaVersion: 1;
  policyVersion: "oor-lifecycle-v1";
  transientMinutes: number;
  /** Start of mandatory documented fresh evaluation. */
  sustainedMinutes: number;
  /** Start of mandatory action; this is also the stale-capital boundary. */
  actionRequiredMinutes: number;
}
export interface OorLifecyclePriorState {
  rangeState: "IN_RANGE" | "OUT_OF_RANGE";
  firstOorDetectedAt?: string;
  continuousOorStartedAt?: string;
  latestObservedAt?: string;
  lastReenteredAt?: string;
  excursionCount: number;
  totalOorDurationSeconds: number;
}
export interface OorLifecycleObservation {
  observedAt: string;
  rangeState: "IN_RANGE" | "OUT_OF_RANGE";
  activeBinId: number;
  lowerBinId: number;
  upperBinId: number;
  /** A full same-cycle SDK position + pool read, never a cached DB value. */
  chainTruthFresh: boolean;
  reconciliationClean: boolean;
  noActiveManagementPlan: boolean;
  inventoryClassification: OorInventoryClassification;
  feeValueLamports?: bigint;
}
export interface OorLifecycleAssessment {
  state: OorLifecycleState;
  action: OorLifecycleAction;
  direction?: OorDirection;
  inventoryClassification: OorInventoryClassification;
  firstOorDetectedAt?: string;
  continuousOorStartedAt?: string;
  latestObservedAt: string;
  lastReenteredAt?: string;
  excursionCount: number;
  totalOorDurationSeconds: number;
  continuousOorDurationSeconds: number;
  feeValueLamports?: bigint;
  reasonCodes: string[];
}
export interface LivePositionManagementPolicy {
  schemaVersion: 1;
  enabled: boolean;
  outOfRangeAction: "HOLD" | "RESHAPE" | "REBALANCE" | "CLOSE";
  claimAccruedFees: boolean;
  /** Conservative execution estimate used only to avoid claiming dust. */
  estimatedClaimCostLamports: bigint;
  /** Claim requires this much net SOL benefit after the execution estimate. */
  minimumClaimNetBenefitLamports: bigint;
  missingPositionAction: "HOLD" | "EMERGENCY_CLOSE";
  replacementRange: "PRESERVE_WIDTH_CENTER_ACTIVE";
  planTtlMs: number;
}
export function assessClaimEconomics(input:{expectedClaimValueLamports?:bigint|undefined;estimatedClaimCostLamports:bigint;minimumClaimNetBenefitLamports:bigint}):{approved:boolean;netBenefitLamports?:bigint;reasonCodes:string[]}{
  if(input.expectedClaimValueLamports===undefined)return{approved:false,reasonCodes:['POSITION_CLAIM_VALUE_UNAVAILABLE']};
  const netBenefitLamports=input.expectedClaimValueLamports-input.estimatedClaimCostLamports;
  return netBenefitLamports>=input.minimumClaimNetBenefitLamports?{approved:true,netBenefitLamports,reasonCodes:['POSITION_CLAIM_NET_BENEFIT_APPROVED']}:{approved:false,netBenefitLamports,reasonCodes:['POSITION_CLAIM_NET_BENEFIT_TOO_LOW']};
}
export interface OwnedLivePosition {
  lpforgePositionId: string;
  poolAddress: string;
  positionAddress: string;
  ownerAddress: string;
  strategy: "SPOT" | "CURVE" | "BID_ASK";
  orientation: string;
  lowerBinId: number;
  upperBinId: number;
  initialCapitalLamports: bigint;
  /** Actual attributable asset debit, when a chunked entry measured it. */
  actualEconomicCapitalLamports?: bigint;
  /** A partial entry is never eligible for ordinary reshaping/rebalancing. */
  partialEntry?: boolean;
  thesisId: string;
  enteredAt?: string;
}
export interface LivePositionManagementDecision {
  action: LiveManagementAction;
  reasonCodes: string[];
  replacementRange?: { lowerBinId: number; upperBinId: number };
}

/**
 * Observational only: this deliberately carries no close/claim authority.
 * It makes the economic result of accepting DLMM inventory conversion durable
 * without promoting a single live lifecycle into a new exit policy.
 */
export function assessFeeCompensationObservation(input:{
  mfeInventoryValue?:number;
  currentInventoryValue?:number;
  mfeCumulativeGrossFees?:number;
  currentCumulativeGrossFees?:number;
}) {
  const finite=(value:number|undefined)=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
  if(!finite(input.mfeInventoryValue)||!finite(input.currentInventoryValue)||!finite(input.mfeCumulativeGrossFees)||!finite(input.currentCumulativeGrossFees))return{economicClassification:'INSUFFICIENT_EVIDENCE',reasonCodes:['FEE_COMPENSATION_EVIDENCE_UNAVAILABLE']};
  const deterioration=Math.max(0,input.mfeInventoryValue!-input.currentInventoryValue!);
  const fees=Math.max(0,input.currentCumulativeGrossFees!-input.mfeCumulativeGrossFees!);
  if(deterioration===0)return{inventoryDeteriorationSinceMfe:deterioration,grossFeesSinceMfe:fees,economicClassification:'NO_INVENTORY_DETERIORATION',reasonCodes:['NO_INVENTORY_DETERIORATION']};
  const ratio=fees/deterioration;
  return{inventoryDeteriorationSinceMfe:deterioration,grossFeesSinceMfe:fees,feeCompensationRatio:ratio,economicClassification:ratio>=1?'FULLY_FEE_COMPENSATED':ratio>0?'PARTIALLY_FEE_COMPENSATED':'UNCOMPENSATED_INVENTORY_DETERIORATION',reasonCodes:[ratio>=1?'FULLY_FEE_COMPENSATED':ratio>0?'PARTIALLY_FEE_COMPENSATED':'UNCOMPENSATED_INVENTORY_DETERIORATION']};
}
/**
 * Normal management actions are economic decisions and must be bound to the
 * pool result that produced their regime, flow, and forward-EV context.  An
 * emergency close is deliberately different: it may be issued from durable
 * position or chain-truth safety evidence when no current market assessment
 * is available for that pool.
 */
export function assessLiveManagementContext(input: {
  positionPoolAddress: string;
  managementPoolAddress?: string;
  action: LiveManagementAction;
  /** Fresh chain-backed stale-capital close is a terminal lifecycle action,
   * never a replacement OPEN and therefore does not need a stale candidate. */
  oorLifecycleClose?: boolean;
}) {
  const matchingPoolContext = input.managementPoolAddress === input.positionPoolAddress;
  const independentlyProtective = input.action === "EMERGENCY_CLOSE" || input.oorLifecycleClose === true;
  const normalManagementAllowed = matchingPoolContext && input.action !== "HOLD";
  const protectiveManagementAllowed = independentlyProtective;
  return {
    matchingPoolContext,
    normalManagementAllowed,
    protectiveManagementAllowed,
    planAllowed:
      input.action !== "HOLD" &&
      (normalManagementAllowed || protectiveManagementAllowed),
    reasonCodes: matchingPoolContext
      ? ["LIVE_MANAGEMENT_CONTEXT_POOL_MATCH"]
      : independentlyProtective
        ? [input.oorLifecycleClose?"LIVE_MANAGEMENT_CONTEXT_OOR_LIFECYCLE_INDEPENDENT":"LIVE_MANAGEMENT_CONTEXT_EMERGENCY_INDEPENDENT"]
        : ["LIVE_MANAGEMENT_CONTEXT_POOL_MISMATCH"],
  };
}

function object(v: unknown) {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("LPFORGE_LIVE_MANAGEMENT_POLICY_OBJECT");
  return v as Record<string, unknown>;
}
export function parseLivePositionManagementPolicy(
  raw: unknown,
): LivePositionManagementPolicy {
  const v = object(raw),
    action = v.outOfRangeAction;
  const lamports=(value:unknown,code:string)=>{try{const parsed=BigInt(String(value));if(parsed<0n)throw new Error();return parsed;}catch{throw new Error(code);}},estimatedClaimCostLamports=lamports(v.estimatedClaimCostLamports,'LPFORGE_LIVE_MANAGEMENT_CLAIM_COST'),minimumClaimNetBenefitLamports=lamports(v.minimumClaimNetBenefitLamports,'LPFORGE_LIVE_MANAGEMENT_CLAIM_BENEFIT');
  if (
    v.schemaVersion !== 1 ||
    typeof v.enabled !== "boolean" ||
    !["HOLD", "RESHAPE", "REBALANCE", "CLOSE"].includes(String(action)) ||
    typeof v.claimAccruedFees !== "boolean" ||
    !["HOLD", "EMERGENCY_CLOSE"].includes(String(v.missingPositionAction)) ||
    v.replacementRange !== "PRESERVE_WIDTH_CENTER_ACTIVE" ||
    !Number.isSafeInteger(v.planTtlMs) ||
    Number(v.planTtlMs) < 5_000
  )
    throw new Error("LPFORGE_LIVE_MANAGEMENT_POLICY_INVALID");
  return {
    schemaVersion: 1,
    enabled: v.enabled,
    outOfRangeAction:
      action as LivePositionManagementPolicy["outOfRangeAction"],
    claimAccruedFees: v.claimAccruedFees,
    estimatedClaimCostLamports,
    minimumClaimNetBenefitLamports,
    missingPositionAction:
      v.missingPositionAction as LivePositionManagementPolicy["missingPositionAction"],
    replacementRange: "PRESERVE_WIDTH_CENTER_ACTIVE",
    planTtlMs: Number(v.planTtlMs),
  };
}
export function loadLivePositionManagementPolicy(
  path = "policies/live-position-management-policy.json",
) {
  return parseLivePositionManagementPolicy(
    JSON.parse(readFileSync(path, "utf8")),
  );
}
export function parseOorLifecyclePolicy(raw: unknown): OorLifecyclePolicy {
  const v = object(raw);
  const values = [
    v.transientMinutes,
    v.sustainedMinutes,
    v.actionRequiredMinutes,
  ];
  if (
    v.schemaVersion !== 1 ||
    v.policyVersion !== "oor-lifecycle-v1" ||
    values.some((value) => !Number.isSafeInteger(value) || Number(value) <= 0) ||
    !(Number(v.transientMinutes) < Number(v.sustainedMinutes)) ||
    !(Number(v.sustainedMinutes) < Number(v.actionRequiredMinutes))
  ) throw new Error("LPFORGE_OOR_LIFECYCLE_POLICY_INVALID");
  return {
    schemaVersion: 1,
    policyVersion: "oor-lifecycle-v1",
    transientMinutes: Number(v.transientMinutes),
    sustainedMinutes: Number(v.sustainedMinutes),
    actionRequiredMinutes: Number(v.actionRequiredMinutes),
  };
}
export function loadOorLifecyclePolicy(path = "policies/oor-lifecycle-policy.json") {
  return parseOorLifecyclePolicy(JSON.parse(readFileSync(path, "utf8")));
}
const validTime=(value:string|undefined)=>value!==undefined&&Number.isFinite(Date.parse(value));
const elapsedSeconds=(from:string|undefined,to:string)=>{
  if(!validTime(from)||!validTime(to))return 0;
  return Math.max(0,Math.floor((Date.parse(to)-Date.parse(from!))/1000));
};
/**
 * Advance the persisted OOR aggregate only from a fresh position/pool read.
 * It is idempotent for a repeated observation timestamp and deliberately
 * retains the timer across process restarts because `prior` comes from SQL.
 */
export function assessOorLifecycle(input:{policy:OorLifecyclePolicy;prior?:OorLifecyclePriorState;observation:OorLifecycleObservation}):OorLifecycleAssessment {
  const {policy,prior,observation}=input, now=observation.observedAt;
  const baseTotal=Math.max(0,Math.floor(prior?.totalOorDurationSeconds??0));
  const wasOor=prior?.rangeState==='OUT_OF_RANGE'&&validTime(prior.continuousOorStartedAt);
  const delta=wasOor?elapsedSeconds(prior?.latestObservedAt,now):0;
  const total=baseTotal+delta;
  if(!observation.chainTruthFresh||!observation.reconciliationClean||!observation.noActiveManagementPlan){
    return {state:wasOor?"SUSTAINED_OOR":"IN_RANGE",action:"HOLD_CHAIN_RECONCILIATION",inventoryClassification:observation.inventoryClassification,...(prior?.firstOorDetectedAt?{firstOorDetectedAt:prior.firstOorDetectedAt}:{}),...(prior?.continuousOorStartedAt?{continuousOorStartedAt:prior.continuousOorStartedAt}:{}),latestObservedAt:now,...(prior?.lastReenteredAt?{lastReenteredAt:prior.lastReenteredAt}:{}),excursionCount:Math.max(0,Math.floor(prior?.excursionCount??0)),totalOorDurationSeconds:baseTotal,continuousOorDurationSeconds:wasOor?elapsedSeconds(prior?.continuousOorStartedAt,now):0,...(observation.feeValueLamports===undefined?{}:{feeValueLamports:observation.feeValueLamports}),reasonCodes:[!observation.chainTruthFresh?"POSITION_OOR_CHAIN_TRUTH_UNAVAILABLE":!observation.reconciliationClean?"POSITION_OOR_RECONCILIATION_REQUIRED":"POSITION_OOR_MANAGEMENT_PLAN_PENDING"]};
  }
  if(observation.rangeState==='IN_RANGE'){
    const reentered=wasOor;
    return {state:"IN_RANGE",action:"HOLD",inventoryClassification:observation.inventoryClassification,...(prior?.firstOorDetectedAt?{firstOorDetectedAt:prior.firstOorDetectedAt}:{}),latestObservedAt:now,...(reentered?{lastReenteredAt:now}:prior?.lastReenteredAt?{lastReenteredAt:prior.lastReenteredAt}:{}),excursionCount:Math.max(0,Math.floor(prior?.excursionCount??0)),totalOorDurationSeconds:total,continuousOorDurationSeconds:0,...(observation.feeValueLamports===undefined?{}:{feeValueLamports:observation.feeValueLamports}),reasonCodes:[reentered?"POSITION_OOR_REENTERED":"POSITION_IN_RANGE"]};
  }
  const started=wasOor?prior!.continuousOorStartedAt!:now;
  const continuous=elapsedSeconds(started,now);
  const direction:OorDirection=observation.activeBinId>observation.upperBinId?"ABOVE_MAX":"BELOW_MIN";
  const excursions=Math.max(0,Math.floor(prior?.excursionCount??0))+(wasOor?0:1);
  const common={direction,inventoryClassification:observation.inventoryClassification,firstOorDetectedAt:prior?.firstOorDetectedAt??now,continuousOorStartedAt:started,latestObservedAt:now,excursionCount:excursions,totalOorDurationSeconds:total,continuousOorDurationSeconds:continuous,...(observation.feeValueLamports===undefined?{}:{feeValueLamports:observation.feeValueLamports})};
  const minutes=continuous/60;
  if(minutes<policy.transientMinutes)return{state:"TRANSIENT_OOR",action:"HOLD",...common,reasonCodes:["POSITION_OOR_ENTERED","POSITION_OOR_TRANSIENT"]};
  if(minutes<policy.sustainedMinutes)return{state:"SUSTAINED_OOR",action:"FRESH_EVALUATION",...common,reasonCodes:["POSITION_OOR_SUSTAINED","POSITION_OOR_FRESH_EVALUATION_REQUIRED"]};
  if(minutes<policy.actionRequiredMinutes){
    if(observation.inventoryClassification==='OOR_TOKEN_EXPOSURE')return{state:"OOR_ACTION_REQUIRED",action:"CLOSE",...common,reasonCodes:["POSITION_OOR_ACTION_REQUIRED","POSITION_OOR_TOKEN_RISK"]};
    return{state:"OOR_ACTION_REQUIRED",action:"TEMPORARY_HOLD",...common,reasonCodes:["POSITION_OOR_ACTION_REQUIRED","POSITION_OOR_BOUNDED_HOLD"]};
  }
  return{state:"OOR_STALE_CAPITAL",action:"CLOSE_AND_REEVALUATE",...common,reasonCodes:["POSITION_OOR_STALE_CAPITAL","POSITION_CLOSE_AND_REEVALUATE_REQUIRED",...(observation.inventoryClassification==='OOR_TOKEN_EXPOSURE'?["POSITION_OOR_TOKEN_RISK"]:["POSITION_SAFE_OOR_SOL_IDLE_CAPITAL"])]};
}
function positive(raw: string | undefined) {
  try {
    return raw !== undefined && BigInt(raw) > 0n;
  } catch {
    return false;
  }
}
function replacement(position: OwnedLivePosition, activeBinId: number) {
  const width = position.upperBinId - position.lowerBinId;
  const lower = activeBinId - Math.floor(width / 2);
  return { lowerBinId: lower, upperBinId: lower + width };
}
/** Pure policy evaluation.  It never infers a token-side strategy or changes the stored strategy/orientation. */
export function decideLivePositionManagement(input: {
  policy: LivePositionManagementPolicy;
  owned: OwnedLivePosition;
  position?: PositionV2Fact;
  activeBinId: number;
  exitDecision?: LiveExitGovernorDecision;
  claimExpectedValueLamports?: bigint | undefined;
  currentForwardEv?: number | undefined;
  /** OOR authority is supplied by the persistent oor-lifecycle-v1 layer. */
  oor?: OorLifecycleAssessment;
}): LivePositionManagementDecision {
  const { policy, owned, position, activeBinId } = input;
  if (!policy.enabled)
    return { action: "HOLD", reasonCodes: ["LIVE_MANAGEMENT_DISABLED"] };
  if (!position)
    return policy.missingPositionAction === "EMERGENCY_CLOSE"
      ? {
          action: "EMERGENCY_CLOSE",
          reasonCodes: ["OWNED_POSITION_CHAIN_TRUTH_MISSING"],
        }
      : { action: "HOLD", reasonCodes: ["OWNED_POSITION_CHAIN_TRUTH_MISSING"] };
  if (
    position.owner !== owned.ownerAddress ||
    position.pool !== owned.poolAddress
  )
    return {
      action: "HOLD",
      reasonCodes: ["OWNED_POSITION_IDENTITY_MISMATCH"],
    };
  if (owned.partialEntry) {
    if (input.exitDecision?.action === "EMERGENCY_CLOSE")
      return { action: "EMERGENCY_CLOSE", reasonCodes: [...input.exitDecision.reasonCodes, "PARTIAL_ENTRY_PROTECTIVE_CLOSE"] };
    // An expired or chain-proven missing liquidity child cannot be recreated
    // under an old entry authorization. Keep the partial position and its
    // attributed wallet inventory in one protective settlement path instead.
    return { action: "CLOSE", reasonCodes: ["PARTIAL_ENTRY_PROTECTIVE_CLOSE_REQUIRED"] };
  }
  if (input.exitDecision && input.exitDecision.action !== "HOLD") {
    const action = input.exitDecision.action === "EMERGENCY_CLOSE" ? "EMERGENCY_CLOSE" : input.exitDecision.action === "CLOSE" ? "CLOSE" : "REDUCE";
    return { action, reasonCodes: input.exitDecision.reasonCodes };
  }
  if (activeBinId < position.lowerBinId || activeBinId > position.upperBinId) {
    // Old policy could recenter the current range using stale entry evidence.
    // That path is intentionally removed: OOR is managed by a durable timer,
    // then any later entry must be a new current-time production thesis.
    if(!input.oor)return{action:"HOLD",reasonCodes:["POSITION_OOR_LIFECYCLE_DECISION_REQUIRED"]};
    if(input.oor.action==='CLOSE'||input.oor.action==='CLOSE_AND_REEVALUATE')return{action:"CLOSE",reasonCodes:input.oor.reasonCodes};
    return{action:"HOLD",reasonCodes:input.oor.reasonCodes};
  }
  if (policy.claimAccruedFees && (positive(position.feeX) || positive(position.feeY))) {
    const claim=assessClaimEconomics({expectedClaimValueLamports:input.claimExpectedValueLamports,estimatedClaimCostLamports:policy.estimatedClaimCostLamports,minimumClaimNetBenefitLamports:policy.minimumClaimNetBenefitLamports});
    return claim.approved?{action:"CLAIM",reasonCodes:["POSITION_ACCRUED_FEES",...claim.reasonCodes]}:{action:"HOLD",reasonCodes:claim.reasonCodes};
  }
  return { action: "HOLD", reasonCodes: ["POSITION_IN_RANGE_NO_ACTION"] };
}
