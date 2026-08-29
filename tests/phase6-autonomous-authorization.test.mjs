import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePhase6LivePathAuthorization} from '../.build/packages/phase6-operational-gates/src/index.js';

test('P6 persistent live authorization does not require a per-run operator approval',()=>{
  const status=evaluatePhase6LivePathAuthorization({liveSigning:true,liveExecution:true,mainnetCanary:true,signerBackendConfigured:true,signerModeConfigured:true,privateWriteRpcConfigured:true,executionPolicyLoaded:true,executionPolicyEnabled:true});
  assert.equal(status.capitalDeploymentAuthorized,true);
  assert.equal(status.maximumReachableStage,'RECOVERY');
  assert.deepEqual(status.reasonCodes,[]);
});
