import type { MainnetCanaryDeploymentPolicy } from "../../canary/src/index.js";
import type { AutonomousPlan } from "../../db/src/index.js";

export interface ClaimGuardResult {
  approved: boolean;
  reasonCodes: string[];
  capitalLamports: bigint;
}
function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function capital(plan: AutonomousPlan) {
  try {
    return BigInt(
      String(
        (record(plan.planPayload).intent &&
          record(record(plan.planPayload).intent).capitalLamports) ??
          "0",
      ),
    );
  } catch {
    return -1n;
  }
}
/** Signing-boundary validation. A PostgreSQL plan is untrusted until this passes. */
export function validateClaimedPlan(input: {
  plan: AutonomousPlan;
  policy: MainnetCanaryDeploymentPolicy;
  ownedPositions: Record<string, unknown>[];
  positionTruth?: { owner: string; pool: string };
}): ClaimGuardResult {
  const reasons: string[] = [],
    p = input.plan,
    policyPool = input.policy.pools.find((x) => x.address === p.poolAddress),
    amount = capital(p),
    provenance = record(record(p.planPayload).provenance);
  if (
    provenance.producer !== "LPFORGE_PRODUCTION" ||
    provenance.schemaVersion !== 1 ||
    provenance.intentId !== p.intentId
  )
    reasons.push("P6_CLAIM_PROVENANCE_INVALID");
  if (!policyPool) reasons.push("P6_CLAIM_POOL_NOT_ALLOWLISTED");
  if (amount < 0n) reasons.push("P6_CLAIM_CAPITAL_INVALID");
  if (
    ["OPEN", "ADD", "RESHAPE", "REBALANCE"].includes(p.action) &&
    amount <= 0n
  )
    reasons.push("P6_CLAIM_CAPITAL_REQUIRED");
  if (policyPool && amount > policyPool.maxCapitalLamports)
    reasons.push("P6_CLAIM_CAPITAL_EXCEEDS_POOL_POLICY");
  const open = input.ownedPositions.filter(
      (row) => String(row.lifecycle_state) === "OPEN",
    ),
    poolOpen = open.filter((row) => String(row.pool_address) === p.poolAddress);
  if (
    p.action === "OPEN" &&
    (open.length >= input.policy.maxOpenPositions ||
      poolOpen.length >= policyPool?.maxOpenPositions!)
  )
    reasons.push("P6_CLAIM_POSITION_LIMIT");
  if (p.action !== "OPEN") {
    const owned = input.ownedPositions.find(
      (row) =>
        String(row.position_address) === p.positionAddress &&
        String(row.owner_address) === p.ownerAddress &&
        String(row.pool_address) === p.poolAddress,
    );
    if (!owned) reasons.push("P6_CLAIM_POSITION_NOT_OWNED");
    if (!input.positionTruth) reasons.push("P6_CLAIM_POSITION_TRUTH_MISSING");
    else if (
      input.positionTruth.owner !== p.ownerAddress ||
      input.positionTruth.pool !== p.poolAddress
    )
      reasons.push("P6_CLAIM_POSITION_TRUTH_MISMATCH");
  }
  return {
    approved: reasons.length === 0,
    reasonCodes: reasons.sort(),
    capitalLamports: amount,
  };
}
