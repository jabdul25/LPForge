import test from 'node:test';
import assert from 'node:assert/strict';
import {assessLiveExit,parseLiveExitGovernorPolicy} from '../.build/packages/live-exit-governor/src/index.js';
const p=parseLiveExitGovernorPolicy({schemaVersion:1,enabled:true,hardStopLossFraction:.12,emergencyStopLossFraction:.20,takeProfitFraction:0,profitProtection:{enabled:true,triggerFraction:.08,maxGivebackFraction:.05,minRetainedProfitFraction:.02},closeOnThesisInvalidated:true,closeOnNonPositiveForwardEv:true,reduceOnRiskBlock:true,reduceFraction:.5,maxHoldMinutes:0,maxHoldRequiresNonPositiveForwardEv:true,toxicityCloseThreshold:.8,toxicityEmergencyThreshold:.95});
const e=(r)=>({evidenceState:'AVAILABLE',observedAt:'2026-08-13T14:00:00Z',initialCapitalUsd:100,currentEconomicValueUsd:100*(1+r),netPnlUsd:100*r,netReturnFraction:r,feesValueUsd:2,reasonCodes:[]});
test('hard stop closes a losing position',()=>{const r=assessLiveExit({policy:p,economics:e(-.13)});assert.equal(r.action,'CLOSE');assert.ok(r.reasonCodes.includes('EXIT_HARD_POSITION_STOP_LOSS'));});
test('emergency stop overrides ordinary close',()=>{const r=assessLiveExit({policy:p,economics:e(-.21)});assert.equal(r.action,'EMERGENCY_CLOSE');});
test('profit giveback protects retained profit',()=>{const r=assessLiveExit({policy:p,economics:e(.04),highWater:{peakNetReturnFraction:.11,peakEconomicValueUsd:111,peakObservedAt:'2026-08-13T13:00:00Z'}});assert.equal(r.action,'CLOSE');assert.ok(r.reasonCodes.includes('EXIT_PROFIT_GIVEBACK_LIMIT'));});
test('non-positive forward EV can close even before stop loss',()=>{const r=assessLiveExit({policy:p,economics:e(-.01),currentForwardEv:-.002,closeCost:.001});assert.equal(r.action,'CLOSE');assert.ok(r.reasonCodes.includes('EXIT_FORWARD_EV_INFERIOR_TO_CLOSE'));});
test('risk block can reduce rather than force full exit',()=>{const r=assessLiveExit({policy:p,economics:e(.01),riskDecision:'BLOCK',riskReasonCodes:['RISK_TOKEN_EXPOSURE_LIMIT']});assert.equal(r.action,'REDUCE');assert.equal(r.reduceFraction,.5);});
test('unavailable valuation never fabricates a stop loss',()=>{const r=assessLiveExit({policy:p,economics:{evidenceState:'UNAVAILABLE',observedAt:'2026-08-13T14:00:00Z',reasonCodes:['MISSING']}});assert.equal(r.action,'HOLD');});
test('liquidity collapse is emergency regardless of PnL',()=>{const r=assessLiveExit({policy:p,economics:e(.1),liquidityCollapse:true});assert.equal(r.action,'EMERGENCY_CLOSE');});

test('optional fixed take profit is supported but disabled by default',()=>{const enabled={...p,takeProfitFraction:.15};const r=assessLiveExit({policy:enabled,economics:e(.16)});assert.equal(r.action,'CLOSE');assert.ok(r.reasonCodes.includes('EXIT_TAKE_PROFIT_TARGET'));});
