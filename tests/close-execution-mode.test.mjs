import assert from 'node:assert/strict';
import test from 'node:test';
import {closeConfirmationPollMs, deriveCloseExecutionMode} from '../.build/packages/phase6-live-worker/src/index.js';

const base = {intentPayload: {managementReasonCodes: []}};

test('close execution mode is derived from immutable action/reason facts', () => {
  assert.equal(deriveCloseExecutionMode({...base, action: 'CLOSE'}), 'NORMAL_CLOSE');
  assert.equal(deriveCloseExecutionMode({action: 'CLOSE', intentPayload: {managementReasonCodes: ['EXIT_HARD_POSITION_STOP_LOSS'], closeExecution: {mode: 'HARD_STOP_CLOSE'}}}), 'HARD_STOP_CLOSE');
  assert.equal(deriveCloseExecutionMode({...base, action: 'EMERGENCY_CLOSE'}), 'EMERGENCY_CLOSE');
  assert.equal(deriveCloseExecutionMode({action: 'CLOSE', intentPayload: {managementReasonCodes: [], closeExecution: {mode: 'HARD_STOP_CLOSE'}}}), 'NORMAL_CLOSE');
});

test('stop confirmation polling is faster but remains bounded and leaves normal closes unchanged', () => {
  assert.equal(closeConfirmationPollMs('NORMAL_CLOSE', 1000), 1000);
  assert.equal(closeConfirmationPollMs('HARD_STOP_CLOSE', 1000), 500);
  assert.equal(closeConfirmationPollMs('EMERGENCY_CLOSE', 300), 300);
  assert.equal(closeConfirmationPollMs('HARD_STOP_CLOSE', 10_000), 500);
});
