import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertExecutionJournalTransition,
  determineRecoveryAction,
  executionJournalStates,
  MemoryExecutionJournalStore,
} from '../.build/packages/execution-recovery/src/index.js';

const now='2026-08-28T00:00:00.000Z';
const journal={journalId:'journal',idempotencyKey:'idem',planId:'plan',state:'PLAN_CREATED',version:1,updatedAt:now,payload:{action:'OPEN'}};

test('execution journal source state contract is exactly represented by M0059',async()=>{
  const migration=await readFile('packages/db/migrations/M0059_execution_journal_state_contract.sql','utf8');
  assert.match(migration,/DROP CONSTRAINT IF EXISTS execution_journal_state_check/);
  for(const state of executionJournalStates)
    assert.match(migration,new RegExp(`'${state}'`),`M0059 permits ${state}`);
  assert.match(migration,/canary_pre_sign_replacements/,'replacement is separately audited rather than rewriting canary_runs');
  assert.doesNotMatch(migration,/UPDATE execution\.canary_runs/,'attempt 1 history is not rewritten');
  assert.doesNotMatch(migration,/DELETE FROM execution/,'the migration preserves execution evidence');
});

test('journal accepts the signing-to-settlement lifecycle and rejects skipped transitions',()=>{
  const store=new MemoryExecutionJournalStore();
  store.create(journal);
  let current=store.transition('idem',1,'SIGNING',now);
  current=store.transition('idem',current.version,'SIGNED',now);
  current=store.transition('idem',current.version,'SUBMITTED',now,{signature:'sig'});
  current=store.transition('idem',current.version,'CONFIRMED',now);
  current=store.transition('idem',current.version,'SIGNING',now);
  current=store.transition('idem',current.version,'SIGNED',now,{signature:'next-sig'});
  current=store.transition('idem',current.version,'SUBMITTED',now,{signature:'next-sig'});
  current=store.transition('idem',current.version,'CONFIRMED',now);
  current=store.transition('idem',current.version,'RECONCILED',now);
  assert.equal(current.state,'RECONCILED');
  assert.throws(()=>assertExecutionJournalTransition('PLAN_CREATED','SIGNED'),/INVALID_TRANSITION/);
  assert.throws(()=>store.transition('idem',current.version,'SUBMITTED',now),/INVALID_TRANSITION/);
});

test('post-sign recovery never treats a durable signature as an unsent plan',()=>{
  const signed={...journal,state:'SIGNED',signature:'sig',lastValidBlockHeight:100};
  assert.equal(
    determineRecoveryAction({journal:signed,currentBlockHeight:99,confirmationStatus:'UNKNOWN',economicEffect:'UNKNOWN'}),
    'WAIT_DO_NOT_RESUBMIT',
  );
  assert.equal(
    determineRecoveryAction({journal:signed,currentBlockHeight:101,confirmationStatus:'UNKNOWN',economicEffect:'UNKNOWN'}),
    'HOLD_FOR_OPERATOR',
  );
});

test('live worker records SIGNING, SIGNED, UNKNOWN_SUBMISSION and reconciliation-required journal boundaries',async()=>{
  const worker=await readFile('packages/phase6-live-worker/src/index.ts','utf8');
  const runtime=await readFile('packages/phase6-canary-runtime/src/index.ts','utf8');
  for(const state of ['"SIGNING"','"SIGNED"','"UNKNOWN_SUBMISSION"','"RECONCILIATION_REQUIRED"'])
    assert.match(worker,new RegExp(state));
  assert.match(runtime,/onSigned/);
  assert.match(runtime,/onSubmissionUnknown/);
  assert.match(runtime,/await input\.onSigned/);
  assert.match(runtime,/await input\.onSubmissionUnknown/);
});
