import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {assessLifecycleSettlement,normalizeLifecycleChildTransactionState} from '../.build/packages/db/src/index.js';

test('settlement distinguishes deliberately skipped no-effect children from confirmed receipts',()=>{
  assert.equal(normalizeLifecycleChildTransactionState('SKIPPED_NO_EFFECT'),'PROVEN_NOT_LANDED');
  assert.equal(normalizeLifecycleChildTransactionState('EXPIRED'),'PROVEN_NOT_LANDED');
  assert.equal(normalizeLifecycleChildTransactionState('FAILED'),'FAILED_FINAL');
  assert.equal(normalizeLifecycleChildTransactionState('CONFIRMED'),'CONFIRMED');
});

const settlementInput=(transactions,cashflows=[])=>({
  lifecycle:{lifecycleId:'lifecycle:position',positionAddress:'position',entryPlanId:'entry',ownerAddress:'owner',poolAddress:'pool',status:'CLOSED'},
  cashflows,inventoryLots:[],transactions,positionAbsent:true,positionCheckedAt:'2026-09-08T00:00:00.000Z',reconciliationClean:true,reservationClean:true,
});

test('settlement requires exact fee evidence for a landed failed child but not an expired no-effect child',()=>{
  const failed={transactionId:'close:failed',planId:'close-plan',planRole:'CLOSE',kind:'METEORA_REMOVE',state:'FAILED_FINAL',signature:'failed-signature'};
  const missing=assessLifecycleSettlement(settlementInput([failed]));
  assert.equal(missing.ready,false);
  assert.ok(missing.reasonCodes.includes('SETTLEMENT_FAILED_TX_COST_RECEIPT_MISSING:close:failed'));
  const proven=assessLifecycleSettlement(settlementInput([failed],[{cashflowId:'fee',planId:'close-plan',flowType:'TX_COST',lamports:5000n,payload:{transactionId:'close:failed',signature:'failed-signature'}}]));
  assert.equal(proven.ready,true);
  assert.equal(proven.totalSolOutLamports,5000n);
  const expired=assessLifecycleSettlement(settlementInput([{transactionId:'close:expired',planId:'close-plan',planRole:'CLOSE',kind:'METEORA_REMOVE',state:'PROVEN_NOT_LANDED',signature:'expired-signature'}]));
  assert.equal(expired.ready,true);
});

test('execution journal cursor atomically follows the exact current child',()=>{
  const source=fs.readFileSync('packages/db/src/index.ts','utf8');
  assert.match(source,/transaction_id=CASE WHEN \$10 THEN NULL ELSE COALESCE\(\$3,transaction_id\) END/);
  assert.match(source,/WHEN \$10 THEN NULL WHEN \$3 IS NOT NULL AND \$3 IS DISTINCT FROM transaction_id THEN \$5/);
  assert.match(source,/WHERE a\.transaction_id=j\.transaction_id/);
  assert.doesNotMatch(source,/WHERE s\.plan_id=j\.plan_id\s+ORDER BY COALESCE\(a\.submitted_at/);
});

test('close recovery selects exact persisted retry children rather than first matching kind',()=>{
  const source=fs.readFileSync('packages/phase6-live-worker/src/index.ts','utf8');
  assert.doesNotMatch(source,/plan\.steps\.find\(\(step\) => step\.kind === "JUPITER_UNWIND"\)/);
  assert.doesNotMatch(source,/plan\.steps\.find\(step=>step\.kind==='JUPITER_UNWIND'\)/);
  assert.match(source,/step\.transactionId === unwindTransactionId && step\.kind === "JUPITER_UNWIND"/);
  const pendingStart=source.indexOf('function closePendingTransactionId');
  const pendingEnd=source.indexOf('type DurableCloseRemoveChild',pendingStart);
  assert.doesNotMatch(source.slice(pendingStart,pendingEnd),/\.find\(step=>step\.kind==='METEORA_CLOSE'\)/);
  assert.match(source,/closeSteps\.length!==1\|\|input\.plan\.steps\.length!==1/);
});

test('plan and step creation fail closed on identity collisions and remain transactional',()=>{
  const source=fs.readFileSync('packages/db/src/index.ts','utf8');
  assert.match(source,/async insertTransactionPlan\(v\) \{\s*await db\.query\("BEGIN"\)/s);
  assert.match(source,/LPFORGE_EXECUTION_PLAN_IDENTITY_CONFLICT/);
  assert.match(source,/LPFORGE_EXECUTION_STEP_IDENTITY_CONFLICT/);
  assert.match(source,/await db\.query\("ROLLBACK"\)/);
  assert.match(source,/LPFORGE_EXECUTION_JOURNAL_VERSION_CONFLICT/);
  assert.match(source,/LPFORGE_SUBMISSION_ATTEMPT_MISSING_AT_EXPIRY/);
  const ensureStart=source.indexOf('async ensureExecutionTransactionStep(v)');
  const ensureEnd=source.indexOf('async claimNextAutonomousPlan(now)',ensureStart);
  const ensure=source.slice(ensureStart,ensureEnd);
  assert.match(ensure,/required_signers='\[\]'::jsonb/);
  assert.match(ensure,/FROM jsonb_each\(execution\.transaction_steps\.metadata\) existing\(key,value\)/);
  assert.match(ensure,/existing\.value IS DISTINCT FROM incoming\.value/);
});

test('terminal failed receipts do not keep failed plans in the recovery queue forever',()=>{
  const source=fs.readFileSync('packages/db/src/index.ts','utf8');
  const start=source.indexOf('async loadUnresolvedAutonomousPlans()');
  const end=source.indexOf('async insertExecutionSimulation',start);
  const query=source.slice(start,end);
  assert.match(query,/terminal_confirmation\.status IN \('CONFIRMED','FINALIZED','FAILED','EXPIRED'\)/);
  assert.match(query,/LPFORGE_EXECUTION_JOURNAL_INVALID_TRANSITION:CONFIRMED->SIGNING/);
  assert.doesNotMatch(query,/s\.plan_id=p\.plan_id AND a\.state IN \('SENT','UNKNOWN'\)\) OR/);
});

test('submission and open-child ledgers cannot regress terminal receipt truth',()=>{
  const source=fs.readFileSync('packages/db/src/index.ts','utf8');
  const dispositionStart=source.indexOf('async upsertOpenChunkDisposition(v)');
  const dispositionEnd=source.indexOf('async loadOpenChunkDispositions',dispositionStart);
  const disposition=source.slice(dispositionStart,dispositionEnd);
  assert.match(disposition,/disposition NOT IN \('CONFIRMED','CONFIRMED_FAILED','PROVEN_NOT_LANDED'\)/);
  assert.match(disposition,/LPFORGE_OPEN_CHUNK_DISPOSITION_IDENTITY_OR_STATE_CONFLICT/);
  const prepareStart=source.indexOf('async prepareSubmissionAttempt(v)');
  const prepareEnd=source.indexOf('async insertExecutionConfirmation',prepareStart);
  const attempts=source.slice(prepareStart,prepareEnd);
  assert.match(attempts,/LPFORGE_SUBMISSION_ATTEMPT_IDENTITY_CONFLICT/);
  assert.match(attempts,/state IN \('PREPARED','SENT'\)/);
  assert.match(attempts,/state IN \('PREPARED','SENT','UNKNOWN'\)/);
  assert.match(attempts,/a\.state IN \('PREPARED','SENT','UNKNOWN'\)/);
});

test('autonomous plan claim is serialized and atomic across restart overlap',()=>{
  const source=fs.readFileSync('packages/db/src/index.ts','utf8');
  const start=source.indexOf('async claimNextAutonomousPlan(now, options)');
  const end=source.indexOf('async reserveExecutionCapital',start);
  const claim=source.slice(start,end);
  assert.match(claim,/await db\.query\("BEGIN"\)/);
  assert.match(claim,/pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.match(claim,/lpforge:execution-plan-claim:v1/);
  assert.match(claim,/await db\.query\("COMMIT"\)/);
  assert.match(claim,/await db\.query\("ROLLBACK"\)/);
  assert.match(claim,/\$2::boolean=false OR i\.action IN \('CLOSE','EMERGENCY_CLOSE'\)/);
});

test('plan state, state-event audit, and terminal journal state commit atomically',()=>{
  const source=fs.readFileSync('packages/db/src/index.ts','utf8');
  for(const [startMarker,endMarker] of [
    ['async transitionAutonomousPlan(v)','async resumePreSubmissionClosePlan'],
    ['async completeAutonomousPlan(v)','async upsertOwnedPosition'],
  ]){
    const start=source.indexOf(startMarker),end=source.indexOf(endMarker,start),section=source.slice(start,end);
    assert.match(section,/await db\.query\("BEGIN"\)/);
    assert.match(section,/execution\.plan_state_events/);
    assert.match(section,/execution\.execution_journal/);
    assert.match(section,/await db\.query\("COMMIT"\)/);
    assert.match(section,/await db\.query\("ROLLBACK"\)/);
  }
  const resumeStart=source.indexOf('async resumePreSubmissionClosePlan(v)');
  const resumeEnd=source.indexOf('async completeAutonomousPlan(v)',resumeStart);
  const resume=source.slice(resumeStart,resumeEnd);
  assert.match(resume,/await db\.query\("BEGIN"\)/);
  assert.match(resume,/execution\.plan_state_events/);
  assert.match(resume,/execution\.execution_journal/);
  assert.match(resume,/await db\.query\("COMMIT"\)/);
  assert.match(resume,/await db\.query\("ROLLBACK"\)/);
  assert.match(source,/LPFORGE_EXECUTION_PLAN_MISSING_AT_TRANSITION/);
  assert.match(source,/state NOT IN \('RECONCILED','COMPLETED','EXPIRED'\) OR state=\$2/);
  assert.match(source,/LPFORGE_EXECUTION_PLAN_MISSING_OR_TERMINAL_CONFLICT_AT_COMPLETION/);
});

test('position lifecycle and deterministic receipt identities fail closed atomically',()=>{
  const source=fs.readFileSync('packages/db/src/index.ts','utf8');
  const markStart=source.indexOf('async markOwnedPositionLifecycle(v)');
  const markEnd=source.indexOf('async adjustOwnedPositionCapital',markStart);
  const mark=source.slice(markStart,markEnd);
  assert.match(mark,/await db\.query\("BEGIN"\)/);
  assert.match(mark,/LPFORGE_OWNED_POSITION_MISSING_AT_LIFECYCLE_TRANSITION/);
  assert.match(mark,/await db\.query\("COMMIT"\)/);
  assert.match(mark,/await db\.query\("ROLLBACK"\)/);
  const lifecycleStart=source.indexOf('async ensurePositionLifecycle(v)');
  const lifecycleEnd=source.indexOf('async linkPositionLifecyclePlan',lifecycleStart);
  const lifecycle=source.slice(lifecycleStart,lifecycleEnd);
  assert.match(lifecycle,/LPFORGE_POSITION_LIFECYCLE_IDENTITY_CONFLICT/);
  assert.match(lifecycle,/position_lifecycles\.owner_address=EXCLUDED\.owner_address/);
  assert.match(lifecycle,/await db\.query\("BEGIN"\)/);
  assert.match(source,/LPFORGE_POSITION_CASHFLOW_IDENTITY_CONFLICT/);
  assert.match(source,/LPFORGE_PLAN_CASHFLOW_IDENTITY_CONFLICT/);
  assert.match(source,/LPFORGE_OWNED_POSITION_IDENTITY_OR_TERMINAL_STATE_CONFLICT/);
  assert.match(source,/LPFORGE_POSITION_LIFECYCLE_IDENTITY_OR_TERMINAL_STATE_CONFLICT/);
  assert.match(source,/LPFORGE_PARTIAL_ENTRY_RECOVERY_IDENTITY_CONFLICT/);
  assert.match(source,/partial_entry_recovery\.funded_at=EXCLUDED\.funded_at/);
  assert.match(source,/partial_entry_recovery\.paired_token_amount=EXCLUDED\.paired_token_amount/);
  assert.match(source,/LPFORGE_LIVE_OUTCOME_PREDICTION_LINEAGE_IDENTITY_CONFLICT/);
  const ownedStart=source.indexOf('async upsertOwnedPosition(v)');
  const ownedEnd=source.indexOf('async insertPositionObservation',ownedStart);
  const owned=source.slice(ownedStart,ownedEnd);
  assert.match(owned,/await db\.query\("BEGIN"\)/);
  assert.match(owned,/lifecycle_state NOT IN \('CLOSED','SOL_SETTLED'\)/);
  assert.match(owned,/await db\.query\("COMMIT"\)/);
  assert.match(owned,/await db\.query\("ROLLBACK"\)/);
  assert.match(source,/LPFORGE_LIFECYCLE_PLAN_ROLE_CONFLICT/);
  assert.match(source,/LPFORGE_SETTLEMENT_LIFECYCLE_IDENTITY_CONFLICT/);
  assert.match(source,/LPFORGE_SETTLEMENT_OWNED_POSITION_IDENTITY_CONFLICT/);
  assert.match(source,/LPFORGE_EXECUTION_RECONCILIATION_IDENTITY_CONFLICT/);
  const worker=fs.readFileSync('packages/phase6-live-worker/src/index.ts','utf8');
  assert.match(worker,/LPFORGE_EXECUTION_JOURNAL_IDEMPOTENCY_IDENTITY_CONFLICT/);
});

test('close execution has no single-transaction terminal claim guard',()=>{
  const source=fs.readFileSync('packages/phase6-live-worker/src/index.ts','utf8');
  const close=source.slice(source.indexOf('async function executeCloseSettlement'),source.indexOf('/** A recovered close reaches'));
  assert.doesNotMatch(close,/LPFORGE_P6_MULTI_TRANSACTION_CLAIM_UNSUPPORTED/);
  assert.match(close,/claimChildCount/);
  assert.match(close,/claimChildrenConfirmed/);
});
