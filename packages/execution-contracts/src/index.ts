import { createHmac, timingSafeEqual } from "node:crypto";
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
export type TransactionIntentKind = 'JUPITER_SWAP'|'JUPITER_UNWIND'|'METEORA_OPEN'|'METEORA_POSITION_EXTEND'|'METEORA_OPEN_CHUNK'|'METEORA_ADD'|'METEORA_REMOVE'|'METEORA_CLAIM'|'METEORA_CLOSE';

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

// Plan provenance HMAC. A PostgreSQL plan row is untrusted input: the claim
// guard cannot tell a forged provenance from a real one, so the operator
// stamps an HMAC-SHA256 over a canonical serialization of the provenance and
// the plan identity fields, and the claim guard recomputes it over the row it
// is about to authorize. The feature is inert until both processes share
// LPFORGE_PLAN_PROVENANCE_SECRET: while it is unset the operator stamps no
// hmac and the guard verifies none.
export interface PlanProvenanceFields {
  producer:string;
  schemaVersion:number;
  intentId:string;
  poolAddress:string;
  observedAt:string;
  action:string;
  ownerAddress:string;
  positionAddress:string|null;
  expiresAt:string;
}
function stableProvenance(v:unknown):string{if(Array.isArray(v))return`[${v.map(stableProvenance).join(',')}]`;if(v&&typeof v==='object')return`{${Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${stableProvenance(x)}`).join(',')}}`;return JSON.stringify(v);}
export function computePlanProvenanceHmac(fields:PlanProvenanceFields,secret:string):string{
  return createHmac('sha256',secret).update(stableProvenance(fields)).digest('hex');
}
export function verifyPlanProvenanceHmac(fields:PlanProvenanceFields,secret:string,hmacHex:string):boolean{
  if(!/^[0-9a-f]{64}$/i.test(hmacHex))return false;
  const expected=createHmac('sha256',secret).update(stableProvenance(fields)).digest();
  const received=new Uint8Array(32);
  for(let i=0;i<32;i++)received[i]=parseInt(hmacHex.slice(i*2,i*2+2),16);
  return timingSafeEqual(expected,received);
}
