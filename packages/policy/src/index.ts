export const PHASE1_POLICY = Object.freeze({
  version: 'phase1-foundation-v1',
  liveSigning: false,
  strategyDecisionsEnabled: false,
  maxDataApiRps: 30,
  maxPositionWidthProtocolBaseline: 1400,
  binsPerBinArray: 70,
  basePositionBins: 70
});
export function assertPhase1PolicyInvariant(): void {
  if (PHASE1_POLICY.liveSigning !== false || PHASE1_POLICY.strategyDecisionsEnabled !== false) throw new Error('LPFORGE_PHASE1_POLICY_BREACH');
}

export const PHASE3_POLICY = Object.freeze({
  version: 'phase3-recommendation-v1',
  liveSigning: false,
  transactionBuildEnabled: false,
  strategyExecutionEnabled: false,
  recommendationOnly: true,
  noTradeIsValidWinner: true,
});
export function assertPhase3PolicyInvariant(): void {
  if (PHASE3_POLICY.liveSigning !== false || PHASE3_POLICY.transactionBuildEnabled !== false || PHASE3_POLICY.strategyExecutionEnabled !== false || PHASE3_POLICY.recommendationOnly !== true) {
    throw new Error('LPFORGE_PHASE3_POLICY_BREACH');
  }
}
