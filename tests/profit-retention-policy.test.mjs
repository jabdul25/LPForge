import test from 'node:test';
import assert from 'node:assert/strict';
import { assessProfitRetentionProtection, isManagementFactFreshForObservation, parseLiveExitGovernorPolicy } from '../.build/packages/live-exit-governor/src/index.js';

const policy=parseLiveExitGovernorPolicy({schemaVersion:1,enabled:true,hardStopLossFraction:.12,emergencyStopLossFraction:.2,takeProfitFraction:0,profitProtection:{enabled:true,triggerFraction:.08,maxGivebackFraction:.05,minRetainedProfitFraction:.02},profitRetention:{enabled:true,policyVersion:'profit-retention-ts5-oor-p4-v1',ts5:{enabled:true,mfeActivationFraction:.04,givebackFraction:.02,watchSeconds:300,lowerRangeFraction:1/3,model:'EXPIRE_REARM',previousUsableMaxAgeSeconds:300},oorP4:{enabled:true,mfeActivationFraction:.02,requiresBelowMin:true,requiresTokenExposure:true}},closeOnThesisInvalidated:true,closeOnNonPositiveForwardEv:true,reduceOnRiskBlock:true,reduceFraction:.5,maxHoldMinutes:0,maxHoldRequiresNonPositiveForwardEv:true,toxicityCloseThreshold:.8,toxicityEmergencyThreshold:.95}).profitRetention;
const at=seconds=>new Date(Date.parse('2026-09-07T12:00:00.000Z')+seconds*1000).toISOString();
const input=(overrides={})=>({policy,observedAt:at(0),economics:{evidenceState:'AVAILABLE',observedAt:at(0),netReturnFraction:.03,reasonCodes:[]},highWater:{peakNetReturnFraction:.06,peakObservedAt:at(-60)},currentFactsFresh:true,reconciliationClean:true,noActiveManagementPlan:true,poolAddress:'pool',rangeState:'IN_RANGE',activeBinId:10,lowerBinId:0,upperBinId:30,previousUsable:{observedAt:at(-30),managedReturnFraction:.04,fresh:true,poolAddress:'pool'},...overrides});

test('current management fact freshness accepts a fact fetched later in the same cycle but rejects stale or implausibly future facts',()=>{
  assert.equal(isManagementFactFreshForObservation({observationObservedAt:at(0),factObservedAt:at(.599),maxAgeSeconds:300}),true);
  assert.equal(isManagementFactFreshForObservation({observationObservedAt:at(0),factObservedAt:at(-300),maxAgeSeconds:300}),true);
  assert.equal(isManagementFactFreshForObservation({observationObservedAt:at(0),factObservedAt:at(-300.001),maxAgeSeconds:300}),false);
  assert.equal(isManagementFactFreshForObservation({observationObservedAt:at(0),factObservedAt:at(300.001),maxAgeSeconds:300}),false);
  assert.equal(isManagementFactFreshForObservation({observationObservedAt:at(0),factObservedAt:undefined,maxAgeSeconds:300}),false);
});

test('TS-5 arms only with managed MFE >=4%, two percentage point giveback, and fresh in-range facts',()=>{
  assert.equal(assessProfitRetentionProtection(input({highWater:{peakNetReturnFraction:.039,peakObservedAt:at(-60)}})).kind,'NONE');
  assert.equal(assessProfitRetentionProtection(input({economics:{evidenceState:'AVAILABLE',observedAt:at(0),netReturnFraction:.041,reasonCodes:[]}})).kind,'NONE');
  const r=assessProfitRetentionProtection(input());
  assert.equal(r.kind,'TS5_WATCH_ARMED'); assert.equal(r.watch.state,'WATCH_ARMED'); assert.equal(r.watch.expiresAt,at(300));
});
test('TS-5 is fixed, confirms at exact boundary, and never rolls',()=>{
  const armed=assessProfitRetentionProtection(input()).watch;
  const middle=assessProfitRetentionProtection(input({observedAt:at(120),priorWatch:armed,activeBinId:20,previousUsable:{observedAt:at(90),managedReturnFraction:.04,fresh:true,poolAddress:'pool'}}));
  assert.equal(middle.kind,'NONE'); assert.equal(middle.watch.expiresAt,at(300));
  const boundary=assessProfitRetentionProtection(input({observedAt:at(300),priorWatch:middle.watch,activeBinId:10,previousUsable:{observedAt:at(270),managedReturnFraction:.04,fresh:true,poolAddress:'pool'}}));
  assert.equal(boundary.kind,'TS5_PROTECTION_CONFIRMED');
});
test('Model C expiry does not rearm on detecting observation but rearms on next eligible observation without a new MFE',()=>{
  const armed=assessProfitRetentionProtection(input()).watch;
  const expired=assessProfitRetentionProtection(input({observedAt:at(301),priorWatch:armed}));
  assert.equal(expired.kind,'TS5_WATCH_EXPIRED'); assert.equal(expired.watch.state,'EXPIRED');
  const rearmed=assessProfitRetentionProtection(input({observedAt:at(330),priorWatch:expired.watch}));
  assert.equal(rearmed.kind,'TS5_WATCH_ARMED'); assert.equal(rearmed.watch.expiresAt,at(630));
});
test('TS-5 requires a later fresh lower-third lower return and cannot confirm below or above range',()=>{
  const armed=assessProfitRetentionProtection(input()).watch;
  for(const rangeState of ['BELOW_MIN','ABOVE_MAX'])assert.equal(assessProfitRetentionProtection(input({observedAt:at(30),priorWatch:armed,rangeState,activeBinId:10})).kind,'NONE');
  assert.equal(assessProfitRetentionProtection(input({observedAt:at(30),priorWatch:armed,activeBinId:11,previousUsable:{observedAt:at(-1),managedReturnFraction:.02,fresh:true,poolAddress:'pool'}})).kind,'NONE');
  assert.equal(assessProfitRetentionProtection(input({observedAt:at(30),priorWatch:armed,previousUsable:{observedAt:at(-1),managedReturnFraction:.04,fresh:false,poolAddress:'pool'}})).kind,'NONE');
  assert.equal(assessProfitRetentionProtection(input({observedAt:at(30),priorWatch:armed,activeBinId:10,previousUsable:{observedAt:at(-1),managedReturnFraction:.04,fresh:true,poolAddress:'pool'}})).kind,'TS5_PROTECTION_CONFIRMED');
});
test('OOR-P4 is exact, independent, and excludes safe/mixed/unavailable inventory',()=>{
  const base={...input({rangeState:'BELOW_MIN',activeBinId:-1,lowerBinId:0,upperBinId:30,highWater:{peakNetReturnFraction:.02,peakObservedAt:at(-60)}}),inventoryClassification:'OOR_TOKEN_EXPOSURE'};
  assert.equal(assessProfitRetentionProtection(base).kind,'OOR_P4_PROTECTION_CONFIRMED');
  for(const inventoryClassification of ['SAFE_OOR_SOL','MIXED_INVENTORY','INVENTORY_UNAVAILABLE'])assert.equal(assessProfitRetentionProtection({...base,inventoryClassification}).kind,'NONE');
  assert.equal(assessProfitRetentionProtection({...base,rangeState:'IN_RANGE',activeBinId:10}).kind,'NONE');
  assert.equal(assessProfitRetentionProtection({...base,currentFactsFresh:false}).kind,'NONE');
});
test('unavailable, stale, active-plan, terminal, and out-of-order facts fail closed',()=>{
  assert.equal(assessProfitRetentionProtection(input({economics:{evidenceState:'UNAVAILABLE',observedAt:at(0),reasonCodes:[]}})).kind,'NONE');
  assert.equal(assessProfitRetentionProtection(input({currentFactsFresh:false})).kind,'NONE');
  assert.equal(assessProfitRetentionProtection(input({noActiveManagementPlan:false})).kind,'NONE');
  assert.equal(assessProfitRetentionProtection(input({positionTerminal:true})).watch.state,'TERMINAL_INVALIDATED');
  const armed=assessProfitRetentionProtection(input()).watch;
  assert.equal(assessProfitRetentionProtection(input({observedAt:at(0),priorWatch:{...armed,lastProcessedObservationTimestamp:at(1)}})).kind,'NONE');
});
test('opening observation cannot confirm its own TS-5 watch',()=>{
  const r=assessProfitRetentionProtection(input({activeBinId:10,previousUsable:{observedAt:at(-1),managedReturnFraction:.04,fresh:true,poolAddress:'pool'}}));
  assert.equal(r.kind,'TS5_WATCH_ARMED');
});
test('a new MFE during an active watch never moves its fixed expiry',()=>{
  const armed=assessProfitRetentionProtection(input()).watch;
  const r=assessProfitRetentionProtection(input({observedAt:at(120),priorWatch:armed,highWater:{peakNetReturnFraction:.08,peakObservedAt:at(120)},economics:{evidenceState:'AVAILABLE',observedAt:at(120),netReturnFraction:.06,reasonCodes:[]},activeBinId:20,previousUsable:{observedAt:at(110),managedReturnFraction:.07,fresh:true,poolAddress:'pool'}}));
  assert.equal(r.kind,'NONE'); assert.equal(r.watch.openedAt,at(0)); assert.equal(r.watch.expiresAt,at(300));
});
test('lower-third geometry includes exactly one third and rejects invalid contemporaneous bounds',()=>{
  const armed=assessProfitRetentionProtection(input()).watch;
  const exact=assessProfitRetentionProtection(input({observedAt:at(1),priorWatch:armed,activeBinId:10,previousUsable:{observedAt:at(-1),managedReturnFraction:.04,fresh:true,poolAddress:'pool'}}));
  assert.equal(exact.kind,'TS5_PROTECTION_CONFIRMED'); assert.equal(exact.rangeFraction,1/3);
  assert.equal(assessProfitRetentionProtection(input({observedAt:at(1),priorWatch:armed,upperBinId:0})).kind,'NONE');
});
test('stale or unavailable economics cannot arm or confirm an existing watch',()=>{
  const armed=assessProfitRetentionProtection(input()).watch;
  for(const economics of [{evidenceState:'STALE',observedAt:at(1),reasonCodes:[]},{evidenceState:'UNAVAILABLE',observedAt:at(1),reasonCodes:[]}]){
    assert.equal(assessProfitRetentionProtection(input({economics})).kind,'NONE');
    assert.equal(assessProfitRetentionProtection(input({observedAt:at(1),priorWatch:armed,economics})).kind,'NONE');
  }
});
test('durable unexpired state confirms after restart and expired state never resurrects missed observations',()=>{
  const armed=JSON.parse(JSON.stringify(assessProfitRetentionProtection(input()).watch));
  const restarted=assessProfitRetentionProtection(input({observedAt:at(30),priorWatch:armed,previousUsable:{observedAt:at(29),managedReturnFraction:.04,fresh:true,poolAddress:'pool'}}));
  assert.equal(restarted.kind,'TS5_PROTECTION_CONFIRMED');
  const expired=assessProfitRetentionProtection(input({observedAt:at(301),priorWatch:armed}));
  assert.equal(expired.kind,'TS5_WATCH_EXPIRED');
  assert.equal(assessProfitRetentionProtection(input({observedAt:at(302),priorWatch:expired.watch,noActiveManagementPlan:false})).kind,'NONE');
});
test('active plan, unsafe reconciliation, and stale chain truth suppress both protective reasons',()=>{
  const p4=input({rangeState:'BELOW_MIN',activeBinId:-1,lowerBinId:0,upperBinId:30,highWater:{peakNetReturnFraction:.02,peakObservedAt:at(-1)},inventoryClassification:'OOR_TOKEN_EXPOSURE'});
  for(const overrides of [{noActiveManagementPlan:false},{reconciliationClean:false},{currentFactsFresh:false}])assert.equal(assessProfitRetentionProtection({...p4,...overrides}).kind,'NONE');
});
test('OOR-P4 only accepts BELOW_MIN with exact OOR_TOKEN_EXPOSURE',()=>{
  const p4=input({rangeState:'BELOW_MIN',activeBinId:-1,lowerBinId:0,upperBinId:30,highWater:{peakNetReturnFraction:.02,peakObservedAt:at(-1)},inventoryClassification:'OOR_TOKEN_EXPOSURE'});
  assert.equal(assessProfitRetentionProtection({...p4,highWater:{peakNetReturnFraction:.019,peakObservedAt:at(-1)}}).kind,'NONE');
  assert.equal(assessProfitRetentionProtection(p4).kind,'OOR_P4_PROTECTION_CONFIRMED');
});
