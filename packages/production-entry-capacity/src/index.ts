export interface ProductionOpenPlanCapacityInput {
  walletLamports: bigint;
  reserveLamports: bigint;
  minInitialPositionLamports: bigint;
  maxPortfolioLamports: bigint;
  maxOpenPositions: number;
  openPositions: number;
  deployedLamports: bigint;
  pendingReservedLamports: bigint;
}

export interface ProductionOpenPlanCapacity {
  approved: boolean;
  availableWalletLamports: bigint;
  reasonCodes: string[];
}

/**
 * This is the pre-plan gate for new exposure.  It deliberately makes no
 * reservation: execution still obtains the durable, owner-locked reservation
 * immediately before signing.  Its job is to avoid creating recommendations
 * that cannot possibly fit the current wallet or portfolio facts.
 */
export function assessProductionOpenPlanCapacity(
  input: ProductionOpenPlanCapacityInput,
): ProductionOpenPlanCapacity {
  const reasons: string[] = [];
  const availableWalletLamports =
    input.walletLamports > input.reserveLamports
      ? input.walletLamports - input.reserveLamports
      : 0n;

  if (input.openPositions >= input.maxOpenPositions)
    reasons.push("P7_PLAN_OPEN_POSITION_LIMIT");
  if (availableWalletLamports < input.minInitialPositionLamports)
    reasons.push("P7_PLAN_WALLET_RESERVE_INSUFFICIENT");
  if (
    input.deployedLamports +
      input.pendingReservedLamports +
      input.minInitialPositionLamports >
    input.maxPortfolioLamports
  )
    reasons.push("P7_PLAN_PORTFOLIO_CAPACITY_INSUFFICIENT");

  return {
    approved: reasons.length === 0,
    availableWalletLamports,
    reasonCodes: reasons.sort(),
  };
}
