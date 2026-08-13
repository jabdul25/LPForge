import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { createPostgresStore } from '../.build/packages/db/src/index.js';
import { createEphemeralDevnetSignerHarness } from '../.build/packages/devnet-signing/src/index.js';
import { simulateExecutionTransaction, createWeb3SimulationTransport } from '../.build/packages/simulation-gateway/src/index.js';
import { governExecutionRisk } from '../.build/packages/execution-risk/src/index.js';
import { submitSignedTransaction, createWeb3SubmissionTransport } from '../.build/packages/execution-submission/src/index.js';
import { determineRecoveryAction } from '../.build/packages/execution-recovery/src/index.js';

const rpc=process.env.SOLANA_RPC_HTTP_URL;
const db=process.env.DATABASE_URL;
if(!rpc||!db)throw new Error('LPFORGE_LOCAL_VALIDATOR_RPC_AND_DATABASE_REQUIRED');
const u=new URL(rpc);
if(!['127.0.0.1','localhost','::1'].includes(u.hostname))throw new Error('LPFORGE_LOCAL_VALIDATOR_LOOPBACK_REQUIRED');
const connection=new Connection(rpc,'confirmed');
const store=await createPostgresStore(db);
const runId=`local-recovery-${Date.now()}`;
const signer=createEphemeralDevnetSignerHarness({cluster:'devnet',allowEphemeralSigner:true});
const sender=new PublicKey(signer.publicKeyAddress);
const receiver=new PublicKey(signer.createEphemeralReceiverAddress());
const airdropSig=await connection.requestAirdrop(sender,10_000_000);
await connection.confirmTransaction(airdropSig,'confirmed');
const receiverBefore=await connection.getBalance(receiver,'confirmed');
const transferLamports=Math.max(1,await connection.getMinimumBalanceForRentExemption(0,'confirmed'));
const latest=await connection.getLatestBlockhash('confirmed');
const tx=new Transaction({feePayer:sender,recentBlockhash:latest.blockhash});
tx.add(SystemProgram.transfer({fromPubkey:sender,toPubkey:receiver,lamports:transferLamports}));
const now=new Date().toISOString();
const expiresAt=new Date(Date.parse(now)+10*60_000).toISOString();
const intentId=`${runId}-intent`,planId=`${runId}-plan`,transactionId=`${runId}-tx`,idempotencyKey=`${runId}-key`;
await store.insertExecutionIntent({intentId,idempotencyKey,action:'VALIDATION_TRANSFER',ownerAddress:sender.toBase58(),thesisId:'LOCAL_RECOVERY_VALIDATION',observedAt:now,expiresAt,payload:{environment:'local-validator',nonEconomic:true}});
await store.insertTransactionPlan({planId,intentId,cluster:'devnet',state:'PLANNED',createdAt:now,expiresAt,payload:{environment:'local-validator'},steps:[{transactionId,sequence:1,kind:'SYSTEM_TRANSFER_VALIDATION',state:'PLANNED',requiredSignerAddresses:[sender.toBase58()],metadata:{receiver:receiver.toBase58(),transferLamports}}]});
const authority={phase:'P5',cluster:'devnet',level:'DEVNET_SUBMIT',liveExecution:true,issuedAt:now,expiresAt,reasonCodes:['LOCAL_VALIDATOR_NON_REAL_ASSET_TEST']};
const simulation=await simulateExecutionTransaction({authority,transactionId,transaction:tx,transport:createWeb3SimulationTransport(connection),simulatedAt:now,freshnessMs:30_000});
if(!simulation.ok)throw new Error(`LOCAL_SIM_FAILED:${simulation.error??'unknown'}`);
await store.insertExecutionSimulation({transactionId,simulatedAt:simulation.simulatedAt,freshUntil:simulation.simulationFreshUntil,ok:true,...(simulation.unitsConsumed!==undefined?{unitsConsumed:simulation.unitsConsumed}:{}),logs:simulation.logs,payload:{environment:'local-validator'}});
const risk=governExecutionRisk({action:'OPEN',planId,now,thesisExpiresAt:expiresAt,planExpiresAt:expiresAt,simulationOk:true,simulationFreshUntil:simulation.simulationFreshUntil,walletTruthConsistent:true,protocolCompatible:true,rpcHealthy:true,referenceDivergenceBps:0,activeBinId:0,intendedCenterBinId:0,costApproved:true,reconciliationRequired:false,globalKillSwitch:false,liquidityCollapse:false},{maxReferenceDivergenceBps:250,maxActiveBinDriftBins:5,approvalTtlMs:30_000,allowEmergencyCostOverride:true});
if(risk.decision!=='APPROVE'||!risk.permitId||!risk.expiresAt)throw new Error('LOCAL_RISK_NOT_APPROVED');
await store.insertExecutionRiskPermit({permitId:risk.permitId,planId,decision:risk.decision,issuedAt:risk.issuedAt,expiresAt:risk.expiresAt,reasonCodes:risk.reasonCodes,payload:{environment:'local-validator'}});
const raw=signer.signLegacyTransaction(tx,{authority,riskDecision:risk,transactionId,signedAt:new Date().toISOString()});
await store.createExecutionJournal({journalId:`${runId}-journal`,idempotencyKey,planId,transactionId,state:'SIGNED',blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight,version:1,updatedAt:new Date().toISOString(),payload:{environment:'local-validator'}});
const base=createWeb3SubmissionTransport(connection);
let actualSignature='';let sends=0;
const sendThenThrow={
 async sendRawTransaction(rawBytes,options){sends++;actualSignature=await base.sendRawTransaction(rawBytes,options);throw new Error('INJECTED_RPC_TIMEOUT_AFTER_SEND');},
 getBlockHeight(){return base.getBlockHeight();},
 getSignatureStatus(sig){return base.getSignatureStatus(sig);}
};
let unknownCaught=false;
try{await submitSignedTransaction({authority,riskDecision:risk,transactionId,idempotencyKey,attempt:1,raw,lease:latest,ledger:{prepare:v=>store.prepareSubmissionAttempt(v),markSent:(a,s,t)=>store.markSubmissionSent(a,s,t),markUnknown:(a,t,e)=>store.markSubmissionUnknown(a,t,e),recordConfirmation:v=>store.insertExecutionConfirmation({attemptId:v.attemptId,...(v.signature?{signature:v.signature}:{}),status:v.status,observedAt:v.observedAt,...(v.slot!==undefined?{slot:v.slot}:{}),...(v.error?{error:v.error}:{}),payload:v.payload})},transport:sendThenThrow,submittedAt:new Date().toISOString()});}catch(e){if(String(e).includes('LPFORGE_SUBMISSION_STATUS_UNKNOWN'))unknownCaught=true;else throw e;}
if(!unknownCaught||!actualSignature||sends!==1)throw new Error('LOCAL_UNKNOWN_INJECTION_DID_NOT_OCCUR');
await store.updateExecutionJournal({idempotencyKey,expectedVersion:1,state:'UNKNOWN_SUBMISSION',signature:actualSignature,blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight,updatedAt:new Date().toISOString(),payload:{injectedTimeout:true}});
let status=null;
for(let i=0;i<30;i++){status=await base.getSignatureStatus(actualSignature);if(status?.confirmationStatus==='confirmed'||status?.confirmationStatus==='finalized')break;await new Promise(r=>setTimeout(r,200));}
if(!status?.confirmationStatus)throw new Error('LOCAL_ORIGINAL_TX_NOT_OBSERVED');
const receiverAfter=await connection.getBalance(receiver,'confirmed');
if(receiverAfter-receiverBefore!==transferLamports)throw new Error('LOCAL_RECOVERY_EFFECT_MISMATCH');
const journalRow=await store.getExecutionJournal(idempotencyKey);
if(!journalRow)throw new Error('LOCAL_JOURNAL_MISSING');
const journal={journalId:String(journalRow.journal_id),idempotencyKey:String(journalRow.idempotency_key),planId:String(journalRow.plan_id),transactionId:String(journalRow.transaction_id),state:String(journalRow.state),signature:String(journalRow.signature),blockhash:String(journalRow.blockhash),lastValidBlockHeight:Number(journalRow.last_valid_block_height),version:Number(journalRow.version),updatedAt:new Date(String(journalRow.updated_at)).toISOString(),payload:journalRow.payload??{}};
const recovery=determineRecoveryAction({journal,currentBlockHeight:await connection.getBlockHeight('confirmed'),confirmationStatus:status.confirmationStatus==='finalized'?'FINALIZED':'CONFIRMED',economicEffect:'PRESENT'});
if(recovery!=='RECONCILE_FIRST')throw new Error(`LOCAL_RECOVERY_WRONG_ACTION:${recovery}`);
let duplicateBlocked=false;let secondSends=0;
const noSend={async sendRawTransaction(){secondSends++;throw new Error('SHOULD_NOT_SEND');},getBlockHeight(){return base.getBlockHeight();},getSignatureStatus(sig){return base.getSignatureStatus(sig);}};
try{await submitSignedTransaction({authority,riskDecision:risk,transactionId,idempotencyKey,attempt:1,raw,lease:latest,ledger:{prepare:v=>store.prepareSubmissionAttempt(v),markSent:(a,s,t)=>store.markSubmissionSent(a,s,t),markUnknown:(a,t,e)=>store.markSubmissionUnknown(a,t,e),recordConfirmation:v=>store.insertExecutionConfirmation({attemptId:v.attemptId,...(v.signature?{signature:v.signature}:{}),status:v.status,observedAt:v.observedAt,...(v.slot!==undefined?{slot:v.slot}:{}),...(v.error?{error:v.error}:{}),payload:v.payload})},transport:noSend,submittedAt:new Date().toISOString()});}catch(e){if(String(e).includes('LPFORGE_DUPLICATE_SUBMISSION_ATTEMPT'))duplicateBlocked=true;else throw e;}
if(!duplicateBlocked||secondSends!==0)throw new Error('LOCAL_DUPLICATE_WAS_NOT_BLOCKED_BEFORE_SEND');
console.log(JSON.stringify({status:'PASS',environment:'local-validator',actualSignature,unknownPersisted:true,originalEffectObserved:true,recoveryAction:recovery,duplicateRetryBlocked:true,sendCountFirstAttempt:sends,sendCountDuplicateAttempt:secondSends,receiverDeltaLamports:receiverAfter-receiverBefore,secretExposed:false},null,2));
await store.close();
