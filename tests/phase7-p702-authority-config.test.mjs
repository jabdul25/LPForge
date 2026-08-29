import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPhase7ControlConfig,phase7CapabilityModel,resolvePhase7Authority} from '../.build/packages/phase7-authority/src/index.js';
import {phase7Capabilities} from '../.build/packages/config/src/index.js';
const now='2026-08-13T00:10:00.000Z';
const approval=(action)=>({approvalId:`a-${action}`,action,operatorId:'operator-1',issuedAt:now,expiresAt:'2026-08-13T00:12:00.000Z',reason:'evidence reviewed'});

test('P7-02 defaults to observe-only with no production authority or scaling',()=>{
  const c=loadPhase7ControlConfig({});
  assert.deepEqual(c,{mode:'OBSERVE_ONLY',productionAuthorityRequested:false,scalingMode:'DISABLED',automaticPolicyPromotion:false,authorityTtlMs:60000});
  const a=resolvePhase7Authority({config:c,now});
  const caps=phase7CapabilityModel(a);
  assert.equal(a.productionAuthorityIssued,false);assert.equal(caps.directSigner,false);assert.equal(caps.directTransactionSend,false);
});

test('P7-02 rejects implicit or unsafe authority configuration',()=>{
  assert.throws(()=>loadPhase7ControlConfig({LPFORGE_P7_PRODUCTION_AUTHORITY:'true'}),/OBSERVE_ONLY_DEFAULT_DENY/);
  assert.throws(()=>loadPhase7ControlConfig({LPFORGE_P7_SCALING_MODE:'OPERATOR_STEP'}),/OBSERVE_ONLY_DEFAULT_DENY/);
  assert.throws(()=>loadPhase7ControlConfig({LPFORGE_P7_AUTOMATIC_POLICY_PROMOTION:'true'}),/AUTOMATIC_POLICY_PROMOTION_FORBIDDEN/);
});

test('P7-02 limited live requires matching explicit approval and never becomes production',()=>{
  const c=loadPhase7ControlConfig({LPFORGE_P7_MODE:'LIMITED_LIVE',LPFORGE_P7_SCALING_MODE:'OPERATOR_STEP'});
  assert.throws(()=>resolvePhase7Authority({config:c,now}),/EXPLICIT_APPROVAL_REQUIRED/);
  assert.throws(()=>resolvePhase7Authority({config:c,now,approval:approval('PROMOTE_PRODUCTION')}),/APPROVAL_ACTION_MISMATCH/);
  const a=resolvePhase7Authority({config:c,now,approval:approval('PROMOTE_LIMITED_LIVE')});
  assert.equal(a.productionAuthorityIssued,false);assert.equal(a.scalingMode,'OPERATOR_STEP');
});

test('P7-02 production envelope is explicit, expiring, and still has no direct signer/send capability',()=>{
  const c=loadPhase7ControlConfig({LPFORGE_P7_MODE:'PRODUCTION',LPFORGE_P7_PRODUCTION_AUTHORITY:'true',LPFORGE_P7_SCALING_MODE:'POLICY_BOUNDED',LPFORGE_P7_AUTHORITY_TTL_MS:'300000'});
  const a=resolvePhase7Authority({config:c,now,approval:approval('PROMOTE_PRODUCTION')});
  assert.equal(a.productionAuthorityIssued,true);
  assert.equal(a.expiresAt,'2026-08-13T00:12:00.000Z');
  const caps=phase7CapabilityModel(a);assert.equal(caps.directSigner,false);assert.equal(caps.directTransactionSend,false);assert.equal(caps.automaticPolicyPromotion,false);
});

test('P7-02 global capability declaration remains default deny',()=>{
  const c=phase7Capabilities();assert.equal(c.defaultMode,'OBSERVE_ONLY');assert.equal(c.productionAuthorityIssued,false);assert.equal(c.scalingMode,'DISABLED');assert.equal(c.directSigner,false);assert.equal(c.directTransactionSend,false);assert.ok(c.prohibitedByDefault.includes('automatic_policy_promotion'));
});
