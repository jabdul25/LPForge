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
  missingPositionAction: "HOLD" | "EMERGENCY_CLOSE";
  replacementRange: "PRESERVE_WIDTH_CENTER_ACTIVE";
  planTtlMs: number;
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
  if (
    policy.claimAccruedFees &&
    (positive(position.feeX) || positive(position.feeY))
  )
    return { action: "CLAIM", reasonCodes: ["POSITION_ACCRUED_FEES"] };
  return { action: "HOLD", reasonCodes: ["POSITION_IN_RANGE_NO_ACTION"] };
}
