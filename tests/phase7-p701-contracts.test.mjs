import test from 'node:test';
import assert from 'node:assert/strict';
import {assertManualApproval,assertPhase7Authority,issuePhase7ObserveAuthority} from '../.build/packages/phase7-contracts/src/index.js';
const now='2026-08-13T00:00:00.000Z';

test('P7-01 observe authority is default-deny for production and scaling',()=>{
  const a=issuePhase7ObserveAuthority({now,ttlMs:60_000});
  assert.equal(a.mode,'OBSERVE_ONLY');
  assert.equal(a.productionAuthorityIssued,false);
  assert.equal(a.scalingMode,'DISABLED');
  assert.equal(a.automaticPolicyPromotion,false);
  assert.doesNotThrow(()=>assertPhase7Authority(a,now));
});

test('P7-01 observe authority refuses production authority or scaling',()=>{
  const base=issuePhase7ObserveAuthority({now,ttlMs:60_000});
  assert.throws(()=>assertPhase7Authority({...base,productionAuthorityIssued:true},now),/OBSERVE_PRODUCTION_AUTHORITY_FORBIDDEN/);
  assert.throws(()=>assertPhase7Authority({...base,scalingMode:'OPERATOR_STEP'},now),/OBSERVE_SCALING_FORBIDDEN/);
});

test('P7-01 limited live and production require explicit approval semantics',()=>{
  const expiresAt='2026-08-13T00:01:00.000Z';
  assert.throws(()=>assertPhase7Authority({phase:'P7',cluster:'mainnet-beta',mode:'LIMITED_LIVE',authorityKind:'TEMPORARY',issuedAt:now,expiresAt,approvalId:null,productionAuthorityIssued:false,scalingMode:'DISABLED',automaticPolicyPromotion:false,reasonCodes:[]},now),/LIMITED_LIVE_APPROVAL_REQUIRED/);
  assert.throws(()=>assertPhase7Authority({phase:'P7',cluster:'mainnet-beta',mode:'PRODUCTION',authorityKind:'TEMPORARY',issuedAt:now,expiresAt,approvalId:'approval',productionAuthorityIssued:false,scalingMode:'OPERATOR_STEP',automaticPolicyPromotion:false,reasonCodes:[]},now),/PRODUCTION_AUTHORITY_REQUIRED/);
});

test('P7-01 bounded unattended Production authority is non-expiring but remains strictly bounded',()=>{
  const authority={phase:'P7',cluster:'mainnet-beta',mode:'PRODUCTION',authorityKind:'BOUNDED_UNATTENDED_PRODUCTION',issuedAt:now,expiresAt:null,approvalId:null,productionAuthorityIssued:true,scalingMode:'DISABLED',automaticPolicyPromotion:false,reasonCodes:['P7_BOUNDED_UNATTENDED_PRODUCTION']};
  assert.doesNotThrow(()=>assertPhase7Authority(authority,now));
  assert.throws(()=>assertPhase7Authority({...authority,expiresAt:'2026-08-13T00:01:00.000Z'},now),/UNATTENDED_AUTHORITY_MUST_NOT_EXPIRE/);
  assert.throws(()=>assertPhase7Authority({...authority,scalingMode:'POLICY_BOUNDED'},now),/UNATTENDED_SCALING_FORBIDDEN/);
});

test('P7-01 manual approval is expiring, attributable and not from future',()=>{
  const approval={approvalId:'a-1',action:'PROMOTE_LIMITED_LIVE',operatorId:'operator',issuedAt:now,expiresAt:'2026-08-13T00:05:00.000Z',reason:'evidence reviewed'};
  assert.doesNotThrow(()=>assertManualApproval(approval,now));
  assert.throws(()=>assertManualApproval({...approval,operatorId:''},now),/FIELDS_REQUIRED/);
  assert.throws(()=>assertManualApproval({...approval,expiresAt:'2026-08-12T23:59:59.000Z'},now),/APPROVAL_EXPIRED/);
});
