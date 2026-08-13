// LPFORGE_PHASE5_EXECUTION_MODULE
export type ExecutionCluster = 'devnet' | 'mainnet-beta';
export type ExecutionAuthorityLevel =
  | 'READ_ONLY'
  | 'BUILD_ONLY'
  | 'SIMULATE_ONLY'
  | 'DEVNET_SIGN'
  | 'DEVNET_SUBMIT'
  | 'MAINNET_BUILD_SIMULATE'
  | 'MAINNET_CANARY';

export type ExecutionAction = 'OPEN'|'ADD'|'RESHAPE'|'REBALANCE'|'REDUCE'|'CLAIM'|'CLOSE'|'EMERGENCY_CLOSE';
export type TransactionPlanState = 'PLANNED'|'BUILT'|'SIMULATED'|'APPROVED'|'SIGNED'|'SUBMITTED'|'CONFIRMED'|'EXPIRED'|'FAILED'|'RECONCILIATION_REQUIRED'|'RECONCILED';
export type TransactionIntentKind = 'JUPITER_SWAP'|'METEORA_OPEN'|'METEORA_ADD'|'METEORA_REMOVE'|'METEORA_CLAIM'|'METEORA_CLOSE';

export interface ExecutionAuthority {
  phase:'P5';
  cluster:ExecutionCluster;
  level:ExecutionAuthorityLevel;
  liveExecution:boolean;
  issuedAt:string;
  expiresAt:string;
  reasonCodes:string[];
}

export interface ExecutionIntent {
  intentId:string;
  idempotencyKey:string;
  action:ExecutionAction;
  poolAddress:string;
  ownerAddress:string;
  positionAddress?:string;
  candidateId?:string;
  thesisId:string;
  observedAt:string;
  expiresAt:string;
  capitalLamports?:bigint;
  lowerBinId?:number;
  upperBinId?:number;
  strategy?:'SPOT'|'CURVE'|'BID_ASK';
  payload:Record<string,unknown>;
}

export interface PlannedTransaction {
  transactionId:string;
  sequence:number;
  kind:TransactionIntentKind;
  requiredSignerAddresses:string[];
  writableAccounts:string[];
  state:TransactionPlanState;
  serializedMessageBase64?:string;
  metadata:Record<string,unknown>;
}

export interface TransactionPlan {
  planId:string;
  intent:ExecutionIntent;
  cluster:ExecutionCluster;
  createdAt:string;
  expiresAt:string;
  state:TransactionPlanState;
  transactions:PlannedTransaction[];
  reasonCodes:string[];
}

export interface SimulationResultContract {
  transactionId:string;
  simulatedAt:string;
  ok:boolean;
  unitsConsumed?:number;
  logs:string[];
  error?:string;
  accountDiff?:Record<string,unknown>;
}

export interface SubmissionRecordContract {
  transactionId:string;
  signature:string;
  submittedAt:string;
  blockhash:string;
  lastValidBlockHeight:number;
  attempt:number;
}

export interface ConfirmationRecordContract {
  transactionId:string;
  signature:string;
  status:'PROCESSED'|'CONFIRMED'|'FINALIZED'|'EXPIRED'|'FAILED'|'UNKNOWN';
  observedAt:string;
  slot?:bigint;
  error?:string;
}

export interface ReconciliationResultContract {
  planId:string;
  observedAt:string;
  status:'MATCH'|'MISMATCH'|'PARTIAL'|'UNKNOWN';
  expected:Record<string,unknown>;
  actual:Record<string,unknown>;
  discrepancies:string[];
}

export function assertAuthority(authority:ExecutionAuthority, allowed:ExecutionAuthorityLevel[], now:string):void {
  if (!allowed.includes(authority.level)) throw new Error(`LPFORGE_EXECUTION_AUTHORITY_DENIED:${authority.level}`);
  if (Date.parse(authority.expiresAt) <= Date.parse(now)) throw new Error('LPFORGE_EXECUTION_AUTHORITY_EXPIRED');
  if (authority.cluster === 'mainnet-beta' && authority.level === 'MAINNET_CANARY' && !authority.liveExecution) throw new Error('LPFORGE_MAINNET_CANARY_LIVE_EXECUTION_REQUIRED');
}
