import test from 'node:test'; import assert from 'node:assert/strict';
import { evaluateEntry } from '../.build/packages/entry-intelligence/src/index.js';
const thesis={thesisId:'t1'}; const economics={expectedNetLpValue:.02,uncertainty:.2};
const good={downsideDeceleration:.9,supportReclaimStrength:.85,twoWayFlowStrength:.8,flowRecovery:.7,regimeStability:.8,volatilityExpansionRisk:.2,immediateOorRisk:.15,dataCompleteness:1,dangerousRegimeMass:.08,poolToxicity:.1,referenceDivergenceRisk:.1,downsidePressure:.1};
const base={features:good,economics,thesis,observedAt:'2026-08-12T10:00:00Z',expiresAt:'2026-08-12T10:10:00Z'};
test('P4-03 stable positive opportunity becomes paper ENTRY_READY',()=>{const r=evaluateEntry(base);assert.equal(r.decision,'ENTRY_READY');assert.equal(r.paperOnly,true);assert.equal(r.liveSigning,false);assert.ok(r.readinessScore>.6);});
test('P4-03 qualified economics can still WAIT for timing',()=>{const r=evaluateEntry({...base,features:{...good,supportReclaimStrength:.2,twoWayFlowStrength:.3,regimeStability:.25}});assert.equal(r.decision,'WAIT');assert.ok(r.waitReasons.length>0);});
test('P4-03 accelerating dangerous downside is rejected, not merely delayed',()=>{const r=evaluateEntry({...base,features:{...good,downsidePressure:.95,dangerousRegimeMass:.7,poolToxicity:.75}});assert.equal(r.decision,'REJECT');assert.ok(r.hardBlocks.includes('ENTRY_DOWNSIDE_PRESSURE_BLOCK'));});
