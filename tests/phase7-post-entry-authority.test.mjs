import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assessPostEntryAuthority} from '../.build/packages/phase7-post-entry-authority/src/index.js';

const observe={authorityMode:'OBSERVE_ONLY',healthStatus:'HEALTHY',safetyMode:'NORMAL',newEconomicActionAllowed:false,riskIncreasingPlanDispatchEnabled:false,protectiveActionDispatchEnabled:true};

test('P7 containment blocks new risk while preserving observation and protective actions',()=>{
  for(const action of ['OPEN','ADD','RESHAPE_REOPEN']) assert.equal(assessPostEntryAuthority(observe,action).allowed,false,action);
  for(const action of ['CLAIM','REMOVE','RESHAPE_REMOVE','CLOSE','EMERGENCY_CLOSE','RECONCILIATION','MONITORING']) assert.equal(assessPostEntryAuthority(observe,action).allowed,true,action);
});

test('protective action dispatch remains an explicit switch rather than an unguarded bypass',()=>{
  const denied=assessPostEntryAuthority({...observe,protectiveActionDispatchEnabled:false},'EMERGENCY_CLOSE');
  assert.equal(denied.allowed,false);
  assert.deepEqual(denied.reasonCodes,['P7_PROTECTIVE_ACTION_DISPATCH_DISABLED']);
});

test('production-normal control is required for any replacement or new capital',()=>{
  const enabled={authorityMode:'PRODUCTION',healthStatus:'HEALTHY',safetyMode:'NORMAL',newEconomicActionAllowed:true,riskIncreasingPlanDispatchEnabled:true,protectiveActionDispatchEnabled:true};
  assert.equal(assessPostEntryAuthority(enabled,'OPEN').allowed,true);
  assert.equal(assessPostEntryAuthority(enabled,'RESHAPE_REOPEN').allowed,true);
  assert.equal(assessPostEntryAuthority({...enabled,newEconomicActionAllowed:false},'RESHAPE_REOPEN').allowed,false);
});

test('operator containment turns a reshape into a protective terminal close and never plans a replacement open',()=>{
  const source=fs.readFileSync(new URL('../apps/operator/src/main.ts',import.meta.url),'utf8');
  assert.match(source,/CLOSE_OLD_POSITION_NO_REPLACEMENT/);
  assert.match(source,/const planAction = containmentTerminalClose \? "CLOSE" : decision\.action/);
});
