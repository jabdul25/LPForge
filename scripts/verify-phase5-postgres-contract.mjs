import { createPostgresStore } from '../.build/packages/db/src/index.js';
import { Client } from 'pg';

const url=process.env.DATABASE_URL;
if(!url)throw new Error('DATABASE_URL required');
const suffix=process.env.LPFORGE_P5_PG_VERIFY_SUFFIX ?? `${process.pid}`;
const ids=(base)=>`${base}_${suffix}`;
const pool=ids('POOL_P5'); const intent=ids('INT_P5'); const plan=ids('PLAN_P5'); const tx1=ids('TX_P5_1'); const tx2=ids('TX_P5_2');
const attempt1=ids('ATTEMPT_P5_1'); const attempt2=ids('ATTEMPT_P5_2'); const journalKey=ids('journal-p5'); const t0='2026-08-12T14:40:00Z';
const store=await createPostgresStore(url);
try{
  if(!(await store.health()))throw new Error('LPFORGE_P5_POSTGRES_HEALTH');
  await store.upsertPool({address:pool,tokenXMint:ids('TOKEN_X'),tokenYMint:ids('TOKEN_Y'),binStep:10,functionType:'LiquidityMining',collectFeeMode:'InputOnly'});
  await store.insertExecutionIntent({intentId:intent,idempotencyKey:ids('idem-int'),action:'OPEN',poolAddress:pool,ownerAddress:ids('OWNER'),positionAddress:ids('POS'),thesisId:ids('THESIS'),observedAt:t0,expiresAt:'2026-08-12T14:45:00Z',payload:{runtimeContract:true}});
  await store.insertTransactionPlan({planId:plan,intentId:intent,cluster:'devnet',state:'BUILT',createdAt:t0,expiresAt:'2026-08-12T14:45:00Z',payload:{kind:'OPEN'},steps:[
    {transactionId:tx1,sequence:1,kind:'OPEN',state:'BUILT',requiredSignerAddresses:[ids('OWNER'),ids('POS')],metadata:{chunk:1}},
    {transactionId:tx2,sequence:2,kind:'FOLLOWUP',state:'BUILT',requiredSignerAddresses:[ids('OWNER')],metadata:{chunk:2}}
  ]});
  await store.insertExecutionSimulation({transactionId:tx1,simulatedAt:'2026-08-12T14:40:05Z',freshUntil:'2026-08-12T14:40:35Z',ok:true,unitsConsumed:100000,logs:['ok'],payload:{computeUnitLimit:110001}});
  await store.insertExecutionRiskPermit({permitId:ids('PERMIT'),planId:plan,decision:'APPROVE',issuedAt:'2026-08-12T14:40:06Z',expiresAt:'2026-08-12T14:40:21Z',reasonCodes:['SIMULATION_OK'],payload:{authority:'DEVNET_SUBMIT'}});
  const prepared=await store.prepareSubmissionAttempt({attemptId:attempt1,transactionId:tx1,idempotencyKey:ids('submit-1'),attempt:1,signedPayloadFingerprint:'fingerprint1',blockhash:'blockhash1',lastValidBlockHeight:12345,preparedAt:'2026-08-12T14:40:07Z',payload:{preSendDurable:true}});
  const duplicate=await store.prepareSubmissionAttempt({attemptId:attempt1,transactionId:tx1,idempotencyKey:ids('submit-1'),attempt:1,signedPayloadFingerprint:'fingerprint1',blockhash:'blockhash1',lastValidBlockHeight:12345,preparedAt:'2026-08-12T14:40:07Z',payload:{}});
  if(prepared!=='PREPARED'||duplicate!=='DUPLICATE')throw new Error(`LPFORGE_P5_SUBMISSION_IDEMPOTENCY:${prepared}/${duplicate}`);
  await store.markSubmissionSent(attempt1,ids('SIG'),'2026-08-12T14:40:08Z');
  await store.insertExecutionConfirmation({attemptId:attempt1,signature:ids('SIG'),status:'CONFIRMED',observedAt:'2026-08-12T14:40:10Z',slot:999n,payload:{}});
  await store.prepareSubmissionAttempt({attemptId:attempt2,transactionId:tx2,idempotencyKey:ids('submit-2'),attempt:1,signedPayloadFingerprint:'fingerprint2',blockhash:'blockhash2',lastValidBlockHeight:12346,preparedAt:'2026-08-12T14:40:11Z',payload:{}});
  await store.markSubmissionUnknown(attempt2,'2026-08-12T14:40:12Z','RPC_TIMEOUT_AFTER_SEND');
  await store.insertExecutionReconciliation({reconciliationId:ids('REC'),planId:plan,observedAt:'2026-08-12T14:40:13Z',status:'MATCH',expected:{owner:ids('OWNER'),pool,range:[-20,20]},actual:{owner:ids('OWNER'),pool,range:[-20,20]},discrepancies:[],payload:{}});
  const created=await store.createExecutionJournal({journalId:ids('J'),idempotencyKey:journalKey,planId:plan,transactionId:tx2,state:'UNKNOWN_SUBMISSION',blockhash:'blockhash2',lastValidBlockHeight:12346,version:1,updatedAt:'2026-08-12T14:40:13Z',payload:{}});
  const duplicateJournal=await store.createExecutionJournal({journalId:ids('J_DUP'),idempotencyKey:journalKey,planId:plan,state:'HOLD',version:1,updatedAt:'2026-08-12T14:40:13Z',payload:{}});
  const advanced=await store.updateExecutionJournal({idempotencyKey:journalKey,expectedVersion:1,state:'HOLD',updatedAt:'2026-08-12T14:40:14Z',payload:{decision:'WAIT_DO_NOT_RESUBMIT'}});
  const stale=await store.updateExecutionJournal({idempotencyKey:journalKey,expectedVersion:1,state:'EXPIRED',updatedAt:'2026-08-12T14:40:15Z',payload:{}});
  const journal=await store.getExecutionJournal(journalKey);
  if(!created||duplicateJournal||!advanced||stale||journal?.state!=='HOLD'||Number(journal?.version)!==2)throw new Error('LPFORGE_P5_JOURNAL_CONCURRENCY');
  await store.insertCanaryRun({runId:ids('CANARY'),planId:plan,poolAddress:pool,action:'OPEN',capitalLamports:10_000_000n,status:'BUILD_ONLY',startedAt:'2026-08-12T14:40:16Z',payload:{noMainnetSubmission:true}});
}finally{await store.close();}
const db=new Client({connectionString:url});await db.connect();
try{
  const m=await db.query(`SELECT count(*)::int AS count FROM governance.schema_migrations`);
  if(Number(m.rows[0]?.count)<15)throw new Error(`LPFORGE_P5_MIGRATIONS:${m.rows[0]?.count}`);
  const e=await db.query(`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='execution'`);
  if(Number(e.rows[0]?.count)!==10)throw new Error(`LPFORGE_P5_EXECUTION_TABLES:${e.rows[0]?.count}`);
  const s=await db.query(`SELECT state,payload->>'submission_error' AS submission_error FROM execution.submission_attempts WHERE attempt_id=$1`,[attempt2]);
  if(s.rows[0]?.state!=='UNKNOWN'||s.rows[0]?.submission_error!=='RPC_TIMEOUT_AFTER_SEND')throw new Error('LPFORGE_P5_UNKNOWN_SUBMISSION_PERSISTENCE');
}finally{await db.end();}
console.log('PHASE5_POSTGRES_CONTRACT_OK migrations>=15 execution_tables=10 submission_idempotency=PASS unknown_after_send=PASS journal_optimistic_concurrency=PASS canary_persistence=PASS');
