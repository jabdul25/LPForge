import test from 'node:test'; import assert from 'node:assert/strict';
import { evaluateEntryDelay } from '../.build/packages/entry-delay/src/index.js';
const at='2026-08-12T10:00:00Z';
const f=(option,delay,net,survival,readiness,extra={})=>({option,observedAt:at,delayMinutes:delay,conditionalProbability:.9,expectedNetLpValue:net,expectedSurvival:survival,expectedActiveTime:survival,readiness,missedFeeCost:delay*.00005,expiryRisk:delay/100,uncertainty:.15,...extra});
test('P4-04 waiting can dominate entering now when stabilization adds enough value',()=>{const r=evaluateEntryDelay(at,[f('ENTER_NOW',0,.01,.55,.5),f('WAIT_5M',5,.014,.78,.78),f('WAIT_15M',15,.013,.84,.82)]);assert.equal(r.winner,'WAIT_5M');});
test('P4-04 enter now wins when delay only loses fees/opportunity',()=>{const r=evaluateEntryDelay(at,[f('ENTER_NOW',0,.015,.85,.85),f('WAIT_5M',5,.014,.84,.84),f('WAIT_15M',15,.012,.82,.8)]);assert.equal(r.winner,'ENTER_NOW');});
test('P4-04 future-derived forecast is rejected as lookahead',()=>{assert.throws(()=>evaluateEntryDelay(at,[{...f('WAIT_5M',5,.01,.7,.7),observedAt:'2026-08-12T10:01:00Z'}]),/LPFORGE_LOOKAHEAD/);});
