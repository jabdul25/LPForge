import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeploymentPolicy } from '../.build/packages/deployment-policy/src/index.js';

const template=JSON.parse(readFileSync('release-policy-templates/live-execution-policy.json','utf8'));

test('State A values are parsed exclusively from the canonical live-execution policy',()=>{
  const policy=parseDeploymentPolicy(template).stateADeteriorationProtection;
  assert.deepEqual(policy, template.stateADeteriorationProtection);
});

test('State A policy rejects malformed actions, invalid fractions, and invalid cooldowns',()=>{
  const base=template.stateADeteriorationProtection;
  for(const stateADeteriorationProtection of [
    {...base,action:'EMERGENCY_CLOSE'},
    {...base,givebackFraction:0},
    {...base,givebackFraction:1.01},
    {...base,minimumReturnThresholdFraction:.001},
    {...base,confirmationSeconds:-1},
    {...base,confirmationSeconds:600.5},
    {...base,cooldownSeconds:-1},
    {...base,maximumObservationAgeSeconds:0},
  ])assert.throws(()=>parseDeploymentPolicy({...template,stateADeteriorationProtection}),/STATE_A_DETERIORATION_PROTECTION/);
});

test('live-control loss protection is required, policy-owned, and rejects invalid thresholds or durations',()=>{
  assert.deepEqual(parseDeploymentPolicy(template).liveControlLossProtection,template.liveControlLossProtection);
  for(const liveControlLossProtection of [
    undefined,
    {...template.liveControlLossProtection,enabled:'true'},
    {...template.liveControlLossProtection,thresholdReturnFraction:0},
    {...template.liveControlLossProtection,thresholdReturnFraction:-1.01},
    {...template.liveControlLossProtection,confirmationSeconds:-1},
    {...template.liveControlLossProtection,confirmationSeconds:60.5},
  ])assert.throws(()=>parseDeploymentPolicy({...template,liveControlLossProtection}),/LIVE_CONTROL_LOSS_PROTECTION/);
});

test('operator wires durable State A confirmation through live-control freshness, reconciliation, active-plan safety, audit, alert, and a protective close lock',()=>{
  const operator=readFileSync('apps/operator/src/main.ts','utf8');
  for(const required of ['assessStateADeterioration','parseStateAPendingConfirmation','STATE_A_POLICY_MISSING','EXIT_STATE_A_DETERIORATION','state_a_pending','state_a_confirmed_at','STATE_A_PENDING_STARTED','STATE_A_PENDING_CANCELLED','STATE_A_DETERIORATION_CONFIRMED','STATE_A_SUPERSEDED_BY_INDEPENDENT_CLOSE','assessLiveControlLossProtection','parseLiveControlLossPendingConfirmation','LPFORGE_LIVE_CONTROL_LOSS_PROTECTION_POLICY_MISSING','EXIT_LIVE_CONTROL_LOSS_PROTECTION','live_control_loss_pending','LIVE_CONTROL_LOSS_PENDING_STARTED','LIVE_CONTROL_LOSS_PENDING_CANCELLED','LIVE_CONTROL_LOSS_PROTECTION_CONFIRMED','serializedProtectiveClose'])assert.match(operator,new RegExp(required));
  assert.match(operator,/currentFactsFresh:Boolean\(fact&&activeBinChainFresh&&apiPool/);
  assert.match(operator,/reconciliationClean:Boolean\(fact\).*reconciliation_status/);
  assert.match(operator,/noActiveManagementPlan:!activePlanForPosition/);
  assert.match(operator,/state_a_pending:stateADeterioration\.pending\?/);
});
