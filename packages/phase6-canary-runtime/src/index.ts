// LPFORGE_PHASE6_MAINNET_MODULE
import {assertPhase6Authority,type Phase6Authority,type Phase6CanaryTicket} from '../../phase6-contracts/src/index.js';
import {signMainnetCanaryWithAuxiliaries,type MainnetSignerBackend,type AuxiliaryMainnetSignerBackend,type MainnetSignableEnvelope} from '../../phase6-mainnet-signer/src/index.js';
import {submitSignedTransaction,type BlockhashLease,type SubmissionLedger,type SubmissionTransport} from '../../execution-submission/src/index.js';
import type {ExecutionAuthority} from '../../execution-contracts/src/index.js';import type {ExecutionRiskDecision} from '../../execution-risk/src/index.js';
export interface SerializableMainnetEnvelope extends MainnetSignableEnvelope {serializeSigned():Uint8Array;}
export interface CanaryOpenResult {status:'SUBMITTED';ticketId:string;transactionId:string;signature:string;submittedAt:string;signerBackendId:string;}
export interface CanaryJournalCallbacks {
  /** The signature is resident only in the signing envelope at this point; it
   * has not been handed to the network transport. */
  onSigned?: (value:{transactionId:string;signerBackendId:string;submittedAt:string})=>Promise<void>;
  /** sendRawTransaction may have reached the RPC even when its response is
   * lost. The caller must persist UNKNOWN_SUBMISSION and recover by ledger /
   * chain lookup, never retry blindly. */
  onSubmissionUnknown?: (value:{transactionId:string;submittedAt:string;error:string})=>Promise<void>;
  /** Runs after local signing but before the signed bytes reach any network
   * transport. A failure here is a deterministic pre-submission abort, not an
   * unknown submission. */
  beforeSubmit?: (value:{transactionId:string;submittedAt:string})=>Promise<void>;
}
function phase5Authority(a:Phase6Authority):ExecutionAuthority{return{phase:'P5',cluster:'mainnet-beta',level:'MAINNET_CANARY',liveExecution:true,issuedAt:a.issuedAt,expiresAt:a.expiresAt,reasonCodes:['DERIVED_FROM_PHASE6',a.ticketId]};}
async function signThenSubmit(input:{authority:Phase6Authority;ticket:Phase6CanaryTicket;transactionId:string;idempotencyKey:string;requiredSignerAddresses:string[];backend:MainnetSignerBackend;auxiliaryBackends?:AuxiliaryMainnetSignerBackend[];envelope:SerializableMainnetEnvelope;phase5RiskDecision:ExecutionRiskDecision;lease:BlockhashLease;ledger:SubmissionLedger;transport:SubmissionTransport;submittedAt:string}&CanaryJournalCallbacks):Promise<CanaryOpenResult>{
  const audits=await signMainnetCanaryWithAuxiliaries({authority:input.authority,ticket:input.ticket,transactionId:input.transactionId,requiredSignerAddresses:input.requiredSignerAddresses,ownerBackend:input.backend,auxiliaryBackends:input.auxiliaryBackends??[],envelope:input.envelope,signedAt:input.submittedAt});
  const signerBackendId=audits.find(a=>a.purpose==='OWNER')?.backendId??input.backend.backendId;
  await input.onSigned?.({transactionId:input.transactionId,signerBackendId,submittedAt:input.submittedAt});
  await input.beforeSubmit?.({transactionId:input.transactionId,submittedAt:input.submittedAt});
  let record;
  try{record=await submitSignedTransaction({authority:phase5Authority(input.authority),riskDecision:input.phase5RiskDecision,transactionId:input.transactionId,idempotencyKey:input.idempotencyKey,attempt:1,raw:input.envelope.serializeSigned(),lease:input.lease,ledger:input.ledger,transport:input.transport,submittedAt:input.submittedAt});}
  catch(error){await input.onSubmissionUnknown?.({transactionId:input.transactionId,submittedAt:input.submittedAt,error:error instanceof Error?error.message:String(error)});throw error;}
  return{status:'SUBMITTED',ticketId:input.ticket.ticketId,transactionId:input.transactionId,signature:record.signature,submittedAt:input.submittedAt,signerBackendId};
}
export async function executeMainnetCanaryOpen(input:{authority:Phase6Authority;ticket:Phase6CanaryTicket;transactionId:string;idempotencyKey:string;requiredSignerAddresses:string[];backend:MainnetSignerBackend;auxiliaryBackends?:AuxiliaryMainnetSignerBackend[];envelope:SerializableMainnetEnvelope;phase5RiskDecision:ExecutionRiskDecision;lease:BlockhashLease;ledger:SubmissionLedger;transport:SubmissionTransport;submittedAt:string}&CanaryJournalCallbacks):Promise<CanaryOpenResult>{assertPhase6Authority(input.authority,['MAINNET_CANARY_OPEN'],input.submittedAt);if(input.ticket.action!=='OPEN')throw new Error('LPFORGE_P6_OPEN_TICKET_ACTION');if(input.authority.ticketId!==input.ticket.ticketId)throw new Error('LPFORGE_P6_OPEN_TICKET_MISMATCH');return signThenSubmit(input);}
export async function executeMainnetCanaryClose(input:{authority:Phase6Authority;ticket:Phase6CanaryTicket;transactionId:string;idempotencyKey:string;requiredSignerAddresses:string[];backend:MainnetSignerBackend;envelope:SerializableMainnetEnvelope;phase5RiskDecision:ExecutionRiskDecision;lease:BlockhashLease;ledger:SubmissionLedger;transport:SubmissionTransport;submittedAt:string}&CanaryJournalCallbacks):Promise<CanaryOpenResult>{assertPhase6Authority(input.authority,['MAINNET_CANARY_CLOSE'],input.submittedAt);if(input.ticket.action!=='CLOSE'&&input.ticket.action!=='EMERGENCY_CLOSE')throw new Error('LPFORGE_P6_CLOSE_TICKET_ACTION');if(input.authority.ticketId!==input.ticket.ticketId)throw new Error('LPFORGE_P6_CLOSE_TICKET_MISMATCH');return signThenSubmit(input);}
/** Shared live mutation path for ADD, CLAIM, REDUCE, RESHAPE and REBALANCE steps. */
export async function executeMainnetCanaryManage(input:{authority:Phase6Authority;ticket:Phase6CanaryTicket;transactionId:string;idempotencyKey:string;requiredSignerAddresses:string[];backend:MainnetSignerBackend;envelope:SerializableMainnetEnvelope;phase5RiskDecision:ExecutionRiskDecision;lease:BlockhashLease;ledger:SubmissionLedger;transport:SubmissionTransport;submittedAt:string}&CanaryJournalCallbacks):Promise<CanaryOpenResult>{assertPhase6Authority(input.authority,['MAINNET_CANARY_MANAGE'],input.submittedAt);if(!['ADD','CLAIM','REDUCE','RESHAPE','REBALANCE'].includes(input.ticket.action))throw new Error('LPFORGE_P6_MANAGE_TICKET_ACTION');if(input.authority.ticketId!==input.ticket.ticketId)throw new Error('LPFORGE_P6_MANAGE_TICKET_MISMATCH');return signThenSubmit(input);}
