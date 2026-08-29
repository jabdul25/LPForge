export type HealthState = 'UP' | 'DEGRADED' | 'DOWN';
export interface ApiErrorEnvelope { error: { code: string; message: string; request_id: string; details: unknown[] } }
export interface HealthComponent { name: string; state: HealthState; latencyMs?: number; detail?: string; }
export interface HealthResponse { status: HealthState; phase: 'P1'|'P2'|'P3'|'P4'|'P5'; liveSigning: false; components: HealthComponent[]; }
export interface InspectionEnvelope<T> { data: T; observed_at: string; source: string; read_only: true; }

export function errorEnvelope(code: string, message: string, requestId: string, details: unknown[] = []): ApiErrorEnvelope {
  return { error: { code, message, request_id: requestId, details } };
}

// ---------------- Phase 3 recommendation-only contracts ----------------
/**
 * Forward-outcome identities are research-evidence contracts, not trading
 * policy. V1 remains supported for immutable historical reads; V2 is the
 * only model permitted for new forward-outcome creation and maturation.
 */
export const PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V1 = 'phase3-forward-outcome-v1';
export const PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2 = 'phase3-forward-outcome-v2';
export const PHASE3_FORWARD_CURRENT_OUTCOME_MODEL_VERSION = PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2;
export const PHASE3_FORWARD_OUTCOME_MODEL_VERSIONS = [PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V1, PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2] as const;

export type Phase3RegimeLabel =
  | 'SIDEWAYS' | 'CONSOLIDATION' | 'CONTROLLED_PULLBACK' | 'BREAKOUT'
  | 'BREAKOUT_CONTROLLED_PULLBACK' | 'TREND_UP' | 'TREND_DOWN' | 'DISTRIBUTION'
  | 'EXHAUSTION' | 'FREEFALL' | 'RECOVERY' | 'TRANSITION' | 'UNKNOWN';

export type Phase3OpportunityState =
  | 'DISCOVERED' | 'SCREENED' | 'QUALIFIED' | 'WATCHING' | 'ARMED' | 'ENTRY_READY'
  | 'REJECTED' | 'EXPIRED' | 'INVALIDATED' | 'DATA_BLOCKED' | 'RISK_BLOCKED';

export type Phase3StrategyFamily = 'SPOT' | 'CURVE' | 'BID_ASK';
export type Phase3Orientation = 'ONE_SIDED_X' | 'ONE_SIDED_Y' | 'BALANCED' | 'SKEWED_X' | 'SKEWED_Y';

export interface ProbabilityEntry { label: Phase3RegimeLabel; probability: number; }
export interface Phase3RegimeAssessmentContract {
  primary: Phase3RegimeLabel;
  probabilities: ProbabilityEntry[];
  confidence: number;
  stability: number;
  transitionRisk: number;
  observedAt: string;
  reasonCodes: string[];
}

export interface Phase3OpportunityEconomicsContract {
  horizonMinutes: number;
  expectedFeeValue: number;
  expectedRewardValue: number;
  expectedInventoryPnl: number;
  expectedHodlRelativePnl: number;
  expectedExecutionCost: number;
  expectedRepositionCost: number;
  expectedTailRiskCharge: number;
  expectedNetLpValue: number;
  uncertainty: number;
}

export interface Phase3RangeCandidateContract {
  candidateId: string;
  strategy: Phase3StrategyFamily;
  orientation: Phase3Orientation;
  lowerBinId: number;
  upperBinId: number;
  widthBins: number;
  centerBinId: number;
  capitalFraction: number;
  perBinWeights: Array<{binId:number;weight:number}>;
}

export interface Phase3RecommendationContract {
  phase: 'P3';
  recommendationOnly: true;
  liveSigning: false;
  opportunityState: Phase3OpportunityState;
  selectedCandidateId?: string;
  noTrade: boolean;
  reasonCodes: string[];
  observedAt: string;
}


// ---------------- Phase 4 paper-management contracts ----------------
export type Phase4EntryDecision = 'WAIT' | 'ENTRY_READY' | 'REJECT';
export type Phase4RiskDecision = 'APPROVE' | 'BLOCK' | 'EMERGENCY';
export type Phase4PositionState =
  | 'PLANNED' | 'ENTRY_READY' | 'OPEN_PENDING' | 'OPEN' | 'IN_RANGE'
  | 'NEAR_LOWER_BOUND' | 'NEAR_UPPER_BOUND' | 'OUT_OF_RANGE_BELOW' | 'OUT_OF_RANGE_ABOVE'
  | 'MANAGEMENT_PENDING' | 'REBALANCE_PENDING' | 'CLOSE_PENDING' | 'CLOSED'
  | 'FAILED' | 'RECONCILIATION_REQUIRED' | 'EMERGENCY';
export type Phase4ManagementAction =
  | 'HOLD' | 'CLAIM_FEES' | 'RESHAPE' | 'REBALANCE' | 'REDUCE'
  | 'CLOSE_TO_NUMERAIRE' | 'EMERGENCY_CLOSE' | 'NO_ACTION_DATA_BLOCKED';
export interface Phase4EntryRecommendationContract {
  phase:'P4'; paperOnly:true; liveSigning:false; decision:Phase4EntryDecision; observedAt:string; expiresAt:string; reasonCodes:string[]; confidence:number;
}
export interface Phase4RiskDecisionContract {
  phase:'P4'; paperOnly:true; liveSigning:false; decision:Phase4RiskDecision; scope:'GLOBAL'|'PORTFOLIO'|'POOL'|'TOKEN'|'POSITION'|'ACTION'; reasonCodes:string[]; expiresAt:string;
}
export interface Phase4ManagementDecisionContract {
  phase:'P4'; paperOnly:true; liveSigning:false; positionId:string; action:Phase4ManagementAction; observedAt:string; reasonCodes:string[]; forwardEv:number; alternativeEv?:number;
}

// ---------------- Phase 5 controlled-execution contracts ----------------
export type Phase5AuthorityLevel = 'READ_ONLY'|'BUILD_ONLY'|'SIMULATE_ONLY'|'DEVNET_SIGN'|'DEVNET_SUBMIT'|'MAINNET_BUILD_SIMULATE'|'MAINNET_CANARY';
export interface Phase5CapabilityContract {phase:'P5';controlledExecution:true;defaultAuthority:'BUILD_ONLY';mainnetCanaryDefault:false;walletSecretInStrategy:false;}
