import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assessExpiredClaimRecovery} from '../.build/packages/phase6-live-worker/src/index.js';

test('expired CLAIM with a successful signature-status read terminalizes only as no-effect',()=>{
  const r=assessExpiredClaimRecovery({signaturePresent:true,signatureStatusReadUnknown:false,confirmationStatus:'EXPIRED'});
  assert.equal(r.terminal,true);assert.ok(r.reasonCodes.includes('P6_CLAIM_EXPIRED_NO_CHAIN_EFFECT'));
});
test('UNKNOWN CLAIM remains blocking and cannot be turned into a retry',()=>{
  assert.equal(assessExpiredClaimRecovery({signaturePresent:true,signatureStatusReadUnknown:true,confirmationStatus:'EXPIRED'}).terminal,false);
  assert.equal(assessExpiredClaimRecovery({signaturePresent:true,signatureStatusReadUnknown:false,confirmationStatus:'UNKNOWN'}).terminal,false);
});
test('operator has a read-only owned-position observation before expensive evaluation and active CLAIM blocks action, not observation',()=>{
  const source=fs.readFileSync('apps/operator/src/main.ts','utf8');
  assert.ok(source.indexOf('const preEvaluationManagementObservation')<source.lastIndexOf('const result = await evaluateOperationalCycle'));
  assert.match(source,/LPFORGE_CONTINUOUS_POSITION_OBSERVER/);
  assert.match(source,/CLAIM_RECONCILIATION_REQUIRED/);
  assert.match(source,/HOLD_RECONCILIATION_ONLY/);
});
