import test from 'node:test';
import assert from 'node:assert/strict';
import {derivePhase7ReconciliationFamilies} from '../.build/packages/db/src/index.js';

const subject={poolAddress:'pool-a',ownerAddress:'owner-a',positionAddress:'position-a'};
const member=(planId,status,extra={})=>({planId,status,observedAt:'2026-09-06T14:19:14.403Z',...subject,...extra});
const family=(rows)=>derivePhase7ReconciliationFamilies(rows);

test('P7 recovery family: explicit terminal successor MATCH supersedes only its provisional parent UNKNOWN',()=>{
  const parent=member('plan-49f5bf9002c05a2219622e9a62960b0d','UNKNOWN');
  const successor=member('plan-49f5bf9002c05a2219622e9a62960b0d:account-close-only:1','MATCH',{predecessorPlanId:parent.planId,terminalRecovery:true});
  const result=family([parent,successor]);
  assert.equal(parent.status,'UNKNOWN','historical parent row remains immutable input');
  assert.deepEqual(result.map(x=>({root:x.rootPlanId,outcome:x.canonicalOutcome,members:x.memberPlanIds})),[{root:parent.planId,outcome:'MATCH',members:[parent.planId,successor.planId].sort()}]);
});

test('P7 recovery family: no explicit relationship, even with a matching-looking plan id, cannot supersede',()=>{
  const parent=member('plan-parent','UNKNOWN');
  const unrelated=member('plan-parent:account-close-only:1','MATCH',{terminalRecovery:true});
  const result=family([parent,unrelated]);
  assert.equal(result.length,2);
  assert.equal(result.find(x=>x.rootPlanId===parent.planId)?.canonicalOutcome,'UNKNOWN');
});

for(const [label,extra] of [
  ['pool mismatch',{poolAddress:'pool-b'}],
  ['owner mismatch',{ownerAddress:'owner-b'}],
  ['position mismatch',{positionAddress:'position-b'}],
]) test(`P7 recovery family: ${label} fails closed`,()=>{
  const parent=member('parent','UNKNOWN');
  const successor=member('successor','MATCH',{predecessorPlanId:'parent',terminalRecovery:true,...extra});
  const result=family([parent,successor]);
  assert.equal(result.length,2);
  assert.equal(result.find(x=>x.rootPlanId==='parent')?.canonicalOutcome,'UNKNOWN');
});

test('P7 recovery family: unresolved and genuine mismatch outcomes remain mismatches',()=>{
  const unknown=family([member('parent-u','UNKNOWN'),member('child-u','UNKNOWN',{predecessorPlanId:'parent-u',terminalRecovery:true})]);
  assert.equal(unknown[0].canonicalOutcome,'UNKNOWN');
  const mismatch=family([member('parent-m','UNKNOWN'),member('child-m','MISMATCH',{predecessorPlanId:'parent-m',terminalRecovery:true})]);
  assert.equal(mismatch[0].canonicalOutcome,'MISMATCH');
});

test('P7 recovery family: an unresolved sibling prevents family MATCH and one family is counted once',()=>{
  const rows=[member('root','UNKNOWN'),member('resolved','MATCH',{predecessorPlanId:'root',terminalRecovery:true}),member('unresolved','UNKNOWN',{predecessorPlanId:'root',terminalRecovery:true})];
  const result=family(rows);
  assert.equal(result.length,1);
  assert.equal(result[0].canonicalOutcome,'UNKNOWN');
});

