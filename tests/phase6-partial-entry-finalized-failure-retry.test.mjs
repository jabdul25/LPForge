import assert from 'node:assert/strict';
import test from 'node:test';
import {decidePartialEntryUnwindRetry} from '../.build/packages/phase6-live-worker/src/index.js';

const base={planId:'plan-1',planIdempotencyKey:'entry-1'};

test('a partial-entry unwind starts with its stable first-child identity only when no prior send exists',()=>{
  const decision=decidePartialEntryUnwindRetry({...base,payload:{},statusReadSucceeded:true});
  assert.deepEqual(decision,{action:'SUBMIT',retryCount:0,transactionId:'plan-1:unwind',idempotencyKey:'entry-1:plan-1:unwind',reasonCodes:['P6_PARTIAL_UNWIND_INITIAL_SUBMISSION']});
});

test('only a finalized failed unwind receives one fresh, separately journaled recovery child',()=>{
  const decision=decidePartialEntryUnwindRetry({...base,payload:{unwindSignature:'failed-sig',partialEntryUnwindRetryCount:0},statusReadSucceeded:true,priorStatus:{confirmationStatus:'finalized',err:{InstructionError:[3,{Custom:14}]}}});
  assert.deepEqual(decision,{action:'SUBMIT',retryCount:1,transactionId:'plan-1:unwind:retry-1',idempotencyKey:'entry-1:plan-1:unwind:retry-1',reasonCodes:['P6_PARTIAL_UNWIND_PRIOR_FINALIZED_FAILED','P6_PARTIAL_UNWIND_RETRY_AUTHORIZED']});
});

test('unknown, pending, non-final, successful, and exhausted unwind evidence cannot authorize a fresh send',()=>{
  const payload={unwindSignature:'sig',partialEntryUnwindRetryCount:0};
  for(const input of [
    {...base,payload,statusReadSucceeded:false},
    {...base,payload,statusReadSucceeded:true,priorStatus:null},
    {...base,payload,statusReadSucceeded:true,priorStatus:{confirmationStatus:'confirmed',err:'failed'}},
    {...base,payload,statusReadSucceeded:true,priorStatus:{confirmationStatus:'finalized'}},
    {...base,payload:{...payload,partialEntryUnwindRetryCount:1},statusReadSucceeded:true,priorStatus:{confirmationStatus:'finalized',err:'failed'}},
  ])assert.equal(decidePartialEntryUnwindRetry(input).action,'HOLD');
});
