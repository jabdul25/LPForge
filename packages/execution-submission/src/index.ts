// LPFORGE_PHASE5_EXECUTION_MODULE
import { assertAuthority, type ConfirmationRecordContract, type ExecutionAuthority, type SubmissionRecordContract } from '../../execution-contracts/src/index.js';
import type { ExecutionRiskDecision } from '../../execution-risk/src/index.js';
export interface BlockhashLease {blockhash:string;lastValidBlockHeight:number;}
export interface SubmissionLedger {
  prepare(value:{attemptId:string;transactionId:string;idempotencyKey:string;attempt:number;signedPayloadFingerprint:string;blockhash:string;lastValidBlockHeight:number;preparedAt:string;signature?:string;payload:Record<string,unknown>}):Promise<'PREPARED'|'DUPLICATE'>;
  markSent(attemptId:string,signature:string,submittedAt:string):Promise<void>;
  /** Preserve a signature returned by the transport even when the subsequent
   * SENT ledger write fails.  Recovery must never lose a known transaction
   * identity at the exact send/persistence boundary. */
  markUnknown(attemptId:string,at:string,error:string,signature?:string):Promise<void>;
  recordConfirmation(value:{attemptId:string;signature?:string;status:ConfirmationRecordContract['status'];observedAt:string;slot?:bigint;error?:string;payload:Record<string,unknown>}):Promise<void>;
}
export interface SubmissionTransport {sendRawTransaction(raw:Uint8Array,options:{skipPreflight:false;maxRetries:0}):Promise<string>;getBlockHeight():Promise<number>;getSignatureStatus(signature:string):Promise<{confirmationStatus?:'processed'|'confirmed'|'finalized';err?:unknown;slot?:number}|null>;}
export class SubmissionStatusUnknownError extends Error{
  readonly signature?:string;
  constructor(signature?:string){super('LPFORGE_SUBMISSION_STATUS_UNKNOWN');this.name='SubmissionStatusUnknownError';if(signature!==undefined)this.signature=signature;}
}
function fingerprint(raw:Uint8Array):string{let a=0x811c9dc5>>>0;for(const b of raw){a^=b;a=Math.imul(a,16777619)>>>0;}return `${raw.length}:${a.toString(16).padStart(8,'0')}`;}
const BASE58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes:Uint8Array):string{
  let value=0n;for(const byte of bytes)value=(value<<8n)+BigInt(byte);
  let encoded='';while(value>0n){const remainder=Number(value%58n);encoded=BASE58[remainder]+encoded;value/=58n;}
  let zeroes=0;while(zeroes<bytes.length&&bytes[zeroes]===0)zeroes++;
  return '1'.repeat(zeroes)+(encoded||'');
}
/** Solana transaction IDs are the first signature in the signed wire bytes.
 * Persisting that identity before transport closes the otherwise unknowable
 * crash window after the RPC receives bytes but before it returns a value. */
export function signedTransactionSignature(raw:Uint8Array):string|undefined{
  let offset=0,count=0,shift=0;
  while(offset<raw.length&&shift<=21){const byte=raw[offset++]!;count|=(byte&0x7f)<<shift;if((byte&0x80)===0)break;shift+=7;}
  if(count<1||offset+64>raw.length)return undefined;
  const signature=raw.slice(offset,offset+64);
  if(signature.every(byte=>byte===0))return undefined;
  return base58(signature);
}
export async function submitSignedTransaction(input:{authority:ExecutionAuthority;riskDecision:ExecutionRiskDecision;transactionId:string;idempotencyKey:string;attempt:number;raw:Uint8Array;lease:BlockhashLease;ledger:SubmissionLedger;transport:SubmissionTransport;submittedAt:string}):Promise<SubmissionRecordContract>{
  assertAuthority(input.authority,['DEVNET_SUBMIT','MAINNET_CANARY'],input.submittedAt);if(input.authority.cluster==='mainnet-beta'&&input.authority.level!=='MAINNET_CANARY')throw new Error('LPFORGE_MAINNET_SUBMISSION_CANARY_ONLY');if(input.riskDecision.decision!=='APPROVE'||!input.riskDecision.permitId||!input.riskDecision.expiresAt)throw new Error('LPFORGE_SUBMISSION_RISK_PERMIT_REQUIRED');if(Date.parse(input.riskDecision.expiresAt)<=Date.parse(input.submittedAt))throw new Error('LPFORGE_SUBMISSION_RISK_PERMIT_EXPIRED');if(!Number.isInteger(input.attempt)||input.attempt<1)throw new Error('LPFORGE_SUBMISSION_ATTEMPT_INVALID');
  const attemptId=`${input.transactionId}:attempt:${input.attempt}`,wireSignature=signedTransactionSignature(input.raw);const prepared=await input.ledger.prepare({attemptId,transactionId:input.transactionId,idempotencyKey:input.idempotencyKey,attempt:input.attempt,signedPayloadFingerprint:fingerprint(input.raw),blockhash:input.lease.blockhash,lastValidBlockHeight:input.lease.lastValidBlockHeight,preparedAt:input.submittedAt,...(wireSignature?{signature:wireSignature}:{}),payload:{permitId:input.riskDecision.permitId,cluster:input.authority.cluster,...(wireSignature?{wireSignature}: {})}});if(prepared==='DUPLICATE')throw new Error('LPFORGE_DUPLICATE_SUBMISSION_ATTEMPT');
  let signature:string|undefined=wireSignature;
  try{
    const returnedSignature=await input.transport.sendRawTransaction(input.raw,{skipPreflight:false,maxRetries:0});
    if(wireSignature&&returnedSignature!==wireSignature)throw new Error('LPFORGE_SUBMISSION_SIGNATURE_MISMATCH');
    signature=returnedSignature;
    await input.ledger.markSent(attemptId,signature,input.submittedAt);
    return{transactionId:input.transactionId,signature,submittedAt:input.submittedAt,blockhash:input.lease.blockhash,lastValidBlockHeight:input.lease.lastValidBlockHeight,attempt:input.attempt};
  }catch(error){
    const reason=error instanceof Error?error.message:String(error);
    try{await input.ledger.markUnknown(attemptId,input.submittedAt,reason,signature);}catch{/* journal callback remains the independent durable boundary */}
    throw new SubmissionStatusUnknownError(signature);
  }
}
export async function observeConfirmation(input:{attemptId:string;record:SubmissionRecordContract;transport:SubmissionTransport;ledger:SubmissionLedger;observedAt:string}):Promise<ConfirmationRecordContract>{const s=await input.transport.getSignatureStatus(input.record.signature);let status:ConfirmationRecordContract['status']='UNKNOWN';let slot:bigint|undefined;let error:string|undefined;if(s?.err!=null){status='FAILED';error=typeof s.err==='string'?s.err:JSON.stringify(s.err);}else if(s?.confirmationStatus){status=s.confirmationStatus==='processed'?'PROCESSED':s.confirmationStatus==='confirmed'?'CONFIRMED':'FINALIZED';if(s.slot!==undefined)slot=BigInt(s.slot);}else if(await input.transport.getBlockHeight()>input.record.lastValidBlockHeight)status='EXPIRED';const result:ConfirmationRecordContract={transactionId:input.record.transactionId,signature:input.record.signature,status,observedAt:input.observedAt,...(slot!==undefined?{slot}:{}),...(error?{error}:{})};await input.ledger.recordConfirmation({attemptId:input.attemptId,signature:input.record.signature,status,observedAt:input.observedAt,...(slot!==undefined?{slot}:{}),...(error?{error}:{}),payload:{lastValidBlockHeight:input.record.lastValidBlockHeight}});return result;}
export function createWeb3SubmissionTransport(connection:{sendRawTransaction(raw:Uint8Array,options:Record<string,unknown>):Promise<string>;getBlockHeight():Promise<number>;getSignatureStatuses(signatures:string[]):Promise<{value:Array<{confirmationStatus?:'processed'|'confirmed'|'finalized'|null;err?:unknown;slot?:number}|null>}>}):SubmissionTransport{return{sendRawTransaction(raw,options){return connection.sendRawTransaction(raw,options);},getBlockHeight(){return connection.getBlockHeight();},async getSignatureStatus(signature){const r=await connection.getSignatureStatuses([signature]);const v=r.value[0];if(!v)return null;return{...(v.confirmationStatus?{confirmationStatus:v.confirmationStatus}:{}),...(v.err!==undefined?{err:v.err}:{}),...(v.slot!==undefined?{slot:v.slot}:{})};}};}
