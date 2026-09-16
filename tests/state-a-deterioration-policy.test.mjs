import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeploymentPolicy } from '../.build/packages/deployment-policy/src/index.js';

const template=JSON.parse(readFileSync('release-policy-templates/live-execution-policy.json','utf8'));

test('State A values are parsed exclusively from the canonical live-execution policy',()=>{
  const policy=parseDeploymentPolicy(template).stateADeteriorationProtection;
  assert.deepEqual(policy,{enabled:true,action:'CLOSE',minimumPeakReturnFraction:0,givebackFraction:.5,minimumReturnThresholdFraction:0,cooldownSeconds:0,maximumObservationAgeSeconds:300});
});

test('State A policy rejects malformed actions, invalid fractions, and invalid cooldowns',()=>{
  const base=template.stateADeteriorationProtection;
  for(const stateADeteriorationProtection of [
    {...base,action:'EMERGENCY_CLOSE'},
    {...base,givebackFraction:0},
    {...base,givebackFraction:1.01},
    {...base,minimumReturnThresholdFraction:.001},
    {...base,cooldownSeconds:-1},
    {...base,maximumObservationAgeSeconds:0},
  ])assert.throws(()=>parseDeploymentPolicy({...template,stateADeteriorationProtection}),/STATE_A_DETERIORATION_PROTECTION/);
});

test('operator wires State A through live-control freshness, reconciliation, active-plan safety, audit, alert, and a protective close lock',()=>{
  const operator=readFileSync('apps/operator/src/main.ts','utf8');
  for(const required of ['assessStateADeterioration','STATE_A_POLICY_MISSING','EXIT_STATE_A_DETERIORATION','state_a_detected_at','state_a_peak_return','state_a_current_return','state_a_giveback','state_a_action','STATE_A_DETERIORATION_DETECTED','serializedProtectiveClose'])assert.match(operator,new RegExp(required));
  assert.match(operator,/currentFactsFresh:Boolean\(fact&&activeBinChainFresh&&apiPool/);
  assert.match(operator,/reconciliationClean:Boolean\(fact\).*reconciliation_status/);
  assert.match(operator,/noActiveManagementPlan:!activePlanForPosition/);
});
