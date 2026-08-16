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
  thesisId: string;
  enteredAt?: string;
}
export interface LivePositionManagementDecision {
  action: LiveManagementAction;
  reasonCodes: string[];
  replacementRange?: { lowerBinId: number; upperBinId: number };
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
}) {
  const matchingPoolContext = input.managementPoolAddress === input.positionPoolAddress;
  const independentlyProtective = input.action === "EMERGENCY_CLOSE";
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
        ? ["LIVE_MANAGEMENT_CONTEXT_EMERGENCY_INDEPENDENT"]
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
  if (input.exitDecision && input.exitDecision.action !== "HOLD") {
    const action = input.exitDecision.action === "EMERGENCY_CLOSE" ? "EMERGENCY_CLOSE" : input.exitDecision.action === "CLOSE" ? "CLOSE" : "REDUCE";
    return { action, reasonCodes: input.exitDecision.reasonCodes };
  }
  if (activeBinId < position.lowerBinId || activeBinId > position.upperBinId) {
    if (policy.outOfRangeAction === "HOLD")
      return {
        action: "HOLD",
        reasonCodes: ["POSITION_OUT_OF_RANGE_HOLD_POLICY"],
      };
    if (policy.outOfRangeAction === "CLOSE")
      return {
        action: "CLOSE",
        reasonCodes: ["POSITION_OUT_OF_RANGE_CLOSE_POLICY"],
      };
    return {
      action: policy.outOfRangeAction,
      reasonCodes: ["POSITION_OUT_OF_RANGE_REPLACEMENT_POLICY"],
      replacementRange: replacement(owned, activeBinId),
    };
  }
  if (policy.claimAccruedFees && (positive(position.feeX) || positive(position.feeY))) {
    const claim=assessClaimEconomics({expectedClaimValueLamports:input.claimExpectedValueLamports,estimatedClaimCostLamports:policy.estimatedClaimCostLamports,minimumClaimNetBenefitLamports:policy.minimumClaimNetBenefitLamports});
    return claim.approved?{action:"CLAIM",reasonCodes:["POSITION_ACCRUED_FEES",...claim.reasonCodes]}:{action:"HOLD",reasonCodes:claim.reasonCodes};
  }
  return { action: "HOLD", reasonCodes: ["POSITION_IN_RANGE_NO_ACTION"] };
}
