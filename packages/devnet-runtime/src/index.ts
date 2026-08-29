// LPFORGE_PHASE5_EXECUTION_MODULE
import { determineRecoveryAction, type ExecutionJournal, type RecoveryFacts } from '../../execution-recovery/src/index.js';
export const DEVNET_ACK='NON_REAL_ASSETS_ONLY';
export interface DevnetOperatorConfig {cluster:string;liveExecution:string|undefined;mainnetCanary:string|undefined;liveSigning:string|undefined;ack:string|undefined;rpcUrl:string;referenceRpcUrl:string;}
export function assertDevnetOperatorConfig(c:DevnetOperatorConfig):void{
  if(c.cluster!=='devnet')throw new Error('LPFORGE_DEVNET_CLUSTER_REQUIRED');
  if(c.liveExecution!=='true')throw new Error('LPFORGE_DEVNET_LIVE_EXECUTION_EXPLICIT_TRUE_REQUIRED');
  if(c.mainnetCanary==='true')throw new Error('LPFORGE_DEVNET_MAINNET_CANARY_MUST_BE_FALSE');
  if(c.liveSigning==='true')throw new Error('LPFORGE_DEVNET_GENERIC_LIVE_SIGNING_FLAG_MUST_REMAIN_FALSE');
  if(c.ack!==DEVNET_ACK)throw new Error('LPFORGE_DEVNET_NON_REAL_ASSET_ACK_REQUIRED');
  if(!/^https?:\/\//.test(c.rpcUrl)||!/^https?:\/\//.test(c.referenceRpcUrl))throw new Error('LPFORGE_DEVNET_RPC_URL_REQUIRED');
}
export function assertMatchingDevnetGenesis(configuredGenesis:string,referenceGenesis:string):void{if(!configuredGenesis||!referenceGenesis||configuredGenesis!==referenceGenesis)throw new Error('LPFORGE_DEVNET_GENESIS_MISMATCH');}
export function devnetRecoveryEvidence():Array<{caseId:string;expected:string;actual:string;pass:boolean}>{
 const base:ExecutionJournal={journalId:'j',idempotencyKey:'k',planId:'p',transactionId:'t',state:'UNKNOWN_SUBMISSION',blockhash:'bh',lastValidBlockHeight:100,version:1,updatedAt:'2026-08-12T00:00:00Z',payload:{}};
 const rows:Array<{caseId:string;facts:RecoveryFacts;expected:string}>=[
  {caseId:'unknown-valid',facts:{journal:base,currentBlockHeight:99,confirmationStatus:'UNKNOWN',economicEffect:'UNKNOWN'},expected:'WAIT_DO_NOT_RESUBMIT'},
  {caseId:'expired-absent',facts:{journal:base,currentBlockHeight:101,confirmationStatus:'EXPIRED',economicEffect:'ABSENT'},expected:'REBUILD_WITH_NEW_BLOCKHASH'},
  {caseId:'effect-present',facts:{journal:base,currentBlockHeight:101,confirmationStatus:'UNKNOWN',economicEffect:'PRESENT'},expected:'MARK_RECONCILED'},
  {caseId:'expired-unknown-effect',facts:{journal:base,currentBlockHeight:101,confirmationStatus:'UNKNOWN',economicEffect:'UNKNOWN'},expected:'HOLD_FOR_OPERATOR'}
 ];return rows.map(r=>{const actual=determineRecoveryAction(r.facts);return{caseId:r.caseId,expected:r.expected,actual,pass:actual===r.expected};});
}
