import test from 'node:test';
import assert from 'node:assert/strict';
import { assessLiveControlLossProtection } from '../.build/packages/live-exit-governor/src/index.js';

const policy={enabled:true,thresholdReturnFraction:-.08,confirmationSeconds:60};
const control=(netReturnFraction)=>({evidenceState:'AVAILABLE',source:'METEORA_POSITION_PNL_API',scope:'LIVE_POSITION_CONTROL',observedAt:'2026-09-20T00:00:00.000Z',netReturnFraction});
const assess=(overrides={})=>assessLiveControlLossProtection({policy,observedAt:'2026-09-20T00:00:00.000Z',liveControlPnl:control(-.08),liveControlPnlFresh:true,currentFactsFresh:true,positionOpen:true,reconciliationClean:true,noActiveManagementPlan:true,...overrides});

test('live-control loss protection starts only at or below the configured policy threshold',()=>{
  assert.equal(assess({liveControlPnl:control(-.079)}).status,'NONE');
  const exact=assess();
  assert.equal(exact.status,'PENDING');
  assert.equal(exact.pending?.confirmationDueAt,'2026-09-20T00:01:00.000Z');
  assert.equal(assess({liveControlPnl:control(-.09)}).status,'PENDING');
});

test('a fresh recovery cancels pending immediately and a later loss begins an independent window',()=>{
  const first=assess();
  const recovered=assess({observedAt:'2026-09-20T00:00:59.000Z',liveControlPnl:control(-.079),priorPending:first.pending});
  assert.equal(recovered.status,'RECOVERED');
  const second=assess({observedAt:'2026-09-20T00:01:10.000Z'});
  assert.equal(second.status,'PENDING');
  assert.equal(second.confirmationDueAt,'2026-09-20T00:02:10.000Z');
});

test('only fresh continuously qualifying facts confirm at the configured due time',()=>{
  const first=assess();
  for(const second of [30,59])assert.equal(assess({observedAt:`2026-09-20T00:00:${String(second).padStart(2,'0')}.000Z`,priorPending:first.pending}).status,'PENDING');
  const confirmed=assess({observedAt:'2026-09-20T00:01:00.000Z',priorPending:first.pending});
  assert.equal(confirmed.status,'CONFIRMED');
  assert.equal(confirmed.detected,true);
  assert.ok(confirmed.reasonCodes.includes('EXIT_LIVE_CONTROL_LOSS_PROTECTION'));
});

test('restart timing is durable, stale evidence cannot confirm, and disabled policy cleanly does nothing',()=>{
  const first=assess();
  assert.equal(assess({observedAt:'2026-09-20T00:01:10.000Z',priorPending:first.pending}).status,'CONFIRMED');
  assert.equal(assess({observedAt:'2026-09-20T00:01:10.000Z',priorPending:first.pending,currentFactsFresh:false}).status,'EVIDENCE_UNAVAILABLE');
  assert.equal(assess({policy:{...policy,enabled:false}}).status,'NONE');
});

test('configured durations and position-local pending state remain independent',()=>{
  const short=assess({policy:{...policy,confirmationSeconds:30}}),long=assess({policy:{...policy,confirmationSeconds:120},observedAt:'2026-09-20T00:00:10.000Z'});
  assert.equal(short.confirmationDueAt,'2026-09-20T00:00:30.000Z');
  assert.equal(long.confirmationDueAt,'2026-09-20T00:02:10.000Z');
  assert.equal(assess({policy:{...policy,thresholdReturnFraction:-.06},liveControlPnl:control(-.06)}).status,'PENDING');
  assert.equal(assess({policy:{...policy,thresholdReturnFraction:-.10},liveControlPnl:control(-.09)}).status,'NONE');
});

test('terminal, reconciliation-debt, or active-plan states fail closed and never create duplicate protection',()=>{
  assert.equal(assess({positionOpen:false}).status,'NONE');
  assert.equal(assess({reconciliationClean:false}).status,'NONE');
  assert.equal(assess({noActiveManagementPlan:false}).status,'NONE');
  const first=assess();
  assert.equal(assess({observedAt:'2026-09-20T00:01:00.000Z',priorPending:first.pending,noActiveManagementPlan:false}).status,'SUPERSEDED');
});
