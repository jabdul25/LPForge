import {createPostgresStore} from '../.build/packages/db/src/index.js';
import {Client} from 'pg';

const url=process.env.DATABASE_URL;
if(!url)throw new Error('DATABASE_URL required');
const suffix=process.env.LPFORGE_P6_JOURNAL_PG_VERIFY_SUFFIX??String(process.pid);
const id=(value)=>`${value}_${suffix}`;
const t0='2026-09-08T12:00:00.000Z';
const t1='2026-09-08T12:01:00.000Z';
const pool=id('POOL_P6_JOURNAL');
const owner=id('OWNER_P6_JOURNAL');
const intent=id('INTENT_P6_JOURNAL');
const plan=id('PLAN_P6_JOURNAL');
const plan2=id('PLAN_P6_JOURNAL_2');
const recommendation=id('RECOMMENDATION_P6_JOURNAL');
const thesis=id('THESIS_P6_JOURNAL');
const tx1=id('TX_P6_JOURNAL_1');
const tx2=id('TX_P6_JOURNAL_2');
const position=id('POSITION_P6_JOURNAL');
const lpforgePosition=id('LPFORGE_POSITION_P6_JOURNAL');
const attempt=id('ATTEMPT_P6_JOURNAL');
const signature=id('SIGNATURE_P6_JOURNAL');
const journalKey=id('JOURNAL_KEY_P6_JOURNAL');

const expectReject=async(fn,code)=>{
  let matched=false;
  try{await fn();}catch(error){matched=String(error?.message??error).includes(code);}
  if(!matched)throw new Error(`EXPECTED_REJECTION:${code}`);
};

const store=await createPostgresStore(url);
try{
  await store.upsertPool({address:pool,tokenXMint:id('TOKEN_X'),tokenYMint:id('TOKEN_Y'),binStep:10,functionType:'LIQUIDITY_MINING',collectFeeMode:'INPUT_ONLY'});
  await store.insertShadowRecommendation({recommendationId:recommendation,poolAddress:pool,decisionAt:t0,expiresAt:'2026-09-08T12:30:00.000Z',state:'ENTRY_READY',noTrade:false,marketContextHash:id('CONTEXT'),candidateCount:1,ranking:{winner:id('CANDIDATE')},economics:{},reasonCodes:[],payload:{postgresJournalContract:true}});
  await store.insertLpThesis({thesisId:thesis,recommendationId:recommendation,poolAddress:pool,observedAt:t0,expiresAt:'2026-09-08T12:30:00.000Z',selectedCandidateId:id('CANDIDATE'),thesis:{postgresJournalContract:true}});
  for(const [planId,intentId] of [[plan,intent],[plan2,id('INTENT_P6_JOURNAL_2')]]){
    await store.insertExecutionIntent({intentId,idempotencyKey:id(`IDEM_${intentId}`),action:'OPEN',poolAddress:pool,ownerAddress:owner,positionAddress:position,thesisId:thesis,observedAt:t0,expiresAt:'2026-09-08T12:30:00.000Z',payload:{postgresJournalContract:true}});
    await store.insertTransactionPlan({planId,intentId,cluster:'devnet',state:'BUILT',createdAt:t0,expiresAt:'2026-09-08T12:30:00.000Z',payload:{postgresJournalContract:true},steps:planId===plan?[
      {transactionId:tx1,sequence:1,kind:'ENTRY_FUNDING_SWAP',state:'BUILT',requiredSignerAddresses:[owner],metadata:{child:1}},
      {transactionId:tx2,sequence:2,kind:'METEORA_OPEN',state:'BUILT',requiredSignerAddresses:[owner],metadata:{child:2}},
    ]:[]});
  }

  const prepared={attemptId:attempt,transactionId:tx1,idempotencyKey:id('SUBMISSION_IDEM'),attempt:1,signedPayloadFingerprint:id('FINGERPRINT'),blockhash:id('BLOCKHASH'),lastValidBlockHeight:1234,preparedAt:t0,signature,payload:{wireSignaturePersisted:true}};
  if(await store.prepareSubmissionAttempt(prepared)!=='PREPARED')throw new Error('PREPARE_INSERT_FAILED');
  if(await store.prepareSubmissionAttempt({...prepared,payload:{}})!=='DUPLICATE')throw new Error('PREPARE_IDEMPOTENCY_FAILED');
  await expectReject(()=>store.prepareSubmissionAttempt({...prepared,transactionId:tx2}),'LPFORGE_SUBMISSION_ATTEMPT_IDENTITY_CONFLICT');
  await store.insertExecutionConfirmation({attemptId:attempt,signature,status:'CONFIRMED',observedAt:t1,slot:123n,payload:{confirmedBeforeSentPersistence:true}});
  const confirmed=await store.loadConfirmedSubmissionByTransactionId(tx1);
  if(confirmed?.signature!==signature||confirmed.status!=='CONFIRMED')throw new Error('PREPARED_EXACT_CONFIRMATION_NOT_RECOVERABLE');

  if(!await store.createExecutionJournal({journalId:id('JOURNAL'),idempotencyKey:journalKey,planId:plan,transactionId:tx1,state:'SIGNED',signature,blockhash:id('BLOCKHASH'),lastValidBlockHeight:1234,version:1,updatedAt:t0,payload:{child:1}}))throw new Error('JOURNAL_INSERT_FAILED');
  await store.updateExecutionJournal({idempotencyKey:journalKey,expectedVersion:1,transactionId:tx2,state:'SIGNING',updatedAt:t1,payload:{child:2}});
  const journal=await store.getExecutionJournal(journalKey);
  if(journal?.transaction_id!==tx2||journal?.signature!=null||Number(journal?.version)!==2)throw new Error('JOURNAL_CHILD_IDENTITY_NOT_REPLACED_ATOMICALLY');
  await expectReject(()=>store.updateExecutionJournal({idempotencyKey:journalKey,expectedVersion:1,state:'FAILED',updatedAt:t1,payload:{stale:true}}),'LPFORGE_EXECUTION_JOURNAL_VERSION_CONFLICT');

  await store.upsertOpenChunkDisposition({planId:plan,transactionId:tx2,sequence:2,kind:'METEORA_OPEN',disposition:'PENDING',observedAt:t0,payload:{}});
  await store.upsertOpenChunkDisposition({planId:plan,transactionId:tx2,sequence:2,kind:'METEORA_OPEN',disposition:'CONFIRMED',signature:id('OPEN_SIGNATURE'),observedAt:t1,payload:{}});
  await expectReject(()=>store.upsertOpenChunkDisposition({planId:plan,transactionId:tx2,sequence:2,kind:'METEORA_OPEN',disposition:'UNKNOWN_SUBMISSION',signature:id('OPEN_SIGNATURE'),observedAt:t1,payload:{}}),'LPFORGE_OPEN_CHUNK_DISPOSITION_IDENTITY_OR_STATE_CONFLICT');

  await store.insertExecutionReconciliation({reconciliationId:id('RECONCILIATION'),planId:plan,observedAt:t0,status:'UNKNOWN',expected:{position},actual:{},discrepancies:['CHAIN_UNKNOWN'],payload:{}});
  await expectReject(()=>store.insertExecutionReconciliation({reconciliationId:id('RECONCILIATION'),planId:plan,observedAt:t1,status:'MATCH',expected:{position},actual:{position},discrepancies:[],payload:{}}),'LPFORGE_EXECUTION_RECONCILIATION_IDENTITY_CONFLICT');

  const owned={lpforgePositionId:lpforgePosition,poolAddress:pool,positionAddress:position,ownerAddress:owner,strategy:'SPOT',orientation:'BALANCED',lowerBinId:-10,upperBinId:10,activeBinAtEntry:0,initialCapitalLamports:30_000_000n,enteredAt:t0,lifecycleState:'OPEN',reconciliationStatus:'MATCH',payload:{postgresJournalContract:true}};
  await store.upsertOwnedPosition(owned);
  await store.upsertOwnedPosition(owned);
  await expectReject(()=>store.ensurePositionLifecycle({positionAddress:position,ownerAddress:id('WRONG_OWNER'),poolAddress:pool,at:t1}),'LPFORGE_POSITION_LIFECYCLE_IDENTITY_CONFLICT');

  await store.insertPositionCashflow({cashflowId:id('POSITION_CASHFLOW'),positionAddress:position,planId:plan,flowType:'OPEN_CONTRIBUTION',observedAt:t0,lamports:30_000_000n,payload:{transactionId:tx2}});
  await expectReject(()=>store.insertPositionCashflow({cashflowId:id('POSITION_CASHFLOW'),positionAddress:position,planId:plan2,flowType:'OPEN_CONTRIBUTION',observedAt:t0,lamports:30_000_000n,payload:{transactionId:tx2}}),'LPFORGE_POSITION_CASHFLOW_IDENTITY_CONFLICT');
  await store.insertPlanCashflow({cashflowId:id('PLAN_CASHFLOW'),planId:plan,flowType:'ENTRY_FUNDING_SOL_OUT',observedAt:t0,lamports:10_000_000n,transactionSignature:signature,payload:{transactionId:tx1}});
  await expectReject(()=>store.insertPlanCashflow({cashflowId:id('PLAN_CASHFLOW'),planId:plan2,flowType:'ENTRY_FUNDING_SOL_OUT',observedAt:t0,lamports:10_000_000n,transactionSignature:signature,payload:{transactionId:tx1}}),'LPFORGE_PLAN_CASHFLOW_IDENTITY_CONFLICT');

  const recovery={planId:plan,poolAddress:pool,ownerAddress:owner,tokenMint:id('TOKEN_X'),fundingTransactionId:tx1,fundingSignature:signature,fundedAt:t0,pairedTokenAmount:'1000',intendedCapitalLamports:30_000_000n,intendedRange:{lowerBinId:-10,upperBinId:10},state:'ENTRY_FUNDED_NOT_OPEN',walletTruth:{},payload:{},updatedAt:t0};
  await store.upsertPartialEntryRecovery(recovery);
  await store.upsertPartialEntryRecovery({...recovery,state:'RESUME_OPEN',updatedAt:t1});
  await expectReject(()=>store.upsertPartialEntryRecovery({...recovery,pairedTokenAmount:'1001',updatedAt:t1}),'LPFORGE_PARTIAL_ENTRY_RECOVERY_IDENTITY_CONFLICT');

  await store.markOwnedPositionLifecycle({positionAddress:position,lifecycleState:'CLOSED',reconciliationStatus:'MATCH',at:t1,payload:{terminal:true}});
  await expectReject(()=>store.upsertOwnedPosition({...owned,enteredAt:t1,lifecycleState:'OPEN'}),'LPFORGE_OWNED_POSITION_IDENTITY_OR_TERMINAL_STATE_CONFLICT');
}finally{
  await store.close();
}

const db=new Client({connectionString:url});
await db.connect();
try{
  const rows=await db.query(`SELECT o.lifecycle_state,l.status,r.state,d.disposition
    FROM execution.owned_positions o
    JOIN execution.position_lifecycles l ON l.position_address=o.position_address
    JOIN execution.partial_entry_recovery r ON r.plan_id=$1
    JOIN execution.open_chunk_dispositions d ON d.plan_id=$1 AND d.transaction_id=$2
    WHERE o.lpforge_position_id=$3`,[plan,tx2,lpforgePosition]);
  const row=rows.rows[0];
  if(!row||row.lifecycle_state!=='CLOSED'||row.status!=='CLOSED'||row.state!=='RESUME_OPEN'||row.disposition!=='CONFIRMED')throw new Error('P6_JOURNAL_POSTGRES_FINAL_STATE_MISMATCH');
}finally{
  await db.end();
}

console.log('P6_JOURNAL_POSTGRES_OK submission_identity=PASS prepared_confirmation_recovery=PASS journal_cursor=PASS terminal_disposition=PASS reconciliation_identity=PASS position_lifecycle_atomicity=PASS receipt_identity=PASS partial_recovery_identity=PASS terminal_reopen_guard=PASS');
