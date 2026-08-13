import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildShadowRecommendation } from '../.build/packages/shadow/src/index.js';
import { regimeHistorySampleFromDbRow } from '../.build/packages/db/src/index.js';

const minute=(i)=>new Date(Date.parse('2026-08-12T00:00:00Z')+i*60000).toISOString();
const current=Array.from({length:61},(_,i)=>({observedAt:minute(200+i),price:100+Math.sin(i/8)*.2,activeBinId:100+Math.round(Math.sin(i/8)*4),twoWayRatio:.8,localLiquidity:10000}));
const hist=Array.from({length:181},(_,i)=>({observedAt:minute(i),activeBinId:100+Math.round(Math.sin(i/10)*6)}));
const bins=Array.from({length:81},(_,i)=>({pool:'p',binId:60+i,price:'1',amountX:'1000',amountY:'1000',liquiditySupply:'1000',stamp:{source:'FIXTURE',observedAt:minute(100)}}));
const frames=[100,110,120,130,140,150].map(i=>({observedAt:minute(i),activeBinId:100,bins:bins.map(b=>({...b,stamp:{...b.stamp,observedAt:minute(i)}}))}));
const pool={pool:'p',policyId:'p',eligibility:'ELIGIBLE',poolQualityScore:90,economicQualityScore:90,flowQualityScore:90,liquidityQualityScore:90,tokenRiskScore:90,toxicityProbability:.05,archetype:'MATURE_DEEP',dataQuality:'GOOD',blockers:[],warnings:[],evidence:{},assessedAt:minute(260)};
const baseInput={pool:'p',decisionAt:minute(260),expiresAt:minute(265),activeBinId:100,binStep:10,horizonMinutes:30,capitalValue:1,currentObservations:current,historicalActiveBins:hist,historicalFrames:frames,historicalEvents:[],poolAssessment:pool,rateEvidence:{feeRatePerCapitalHour:.02,adverseInventoryRatePerCapitalHour:.001,repositionRatePerCapitalHour:.0001,tailRiskRatePerCapitalHour:.0001,executionCostFixed:0,sampleCount:100,uncertainty:.1,fidelity:'ONCHAIN_POSITION'},totalPositionShareRaw:1000n,rawUnitValueX:.001,rawUnitValueY:.001};

function historyClone(regime,observedAt){return{primary:regime.primary,probabilities:regime.probabilities,confidence:regime.confidence,stability:regime.stability,transitionRisk:regime.transitionRisk,observedAt};}

test('v1.0.7 persisted regime row reconstructs the fields required by stability analysis',()=>{
  const row={primary_regime:'SIDEWAYS',probabilities:[{label:'SIDEWAYS',probability:.6},{label:'TRANSITION',probability:.4}],confidence:'.6',stability:'.2',transition_risk:'.3',decision_at:'2026-08-12T10:00:00Z'};
  const r=regimeHistorySampleFromDbRow(row);
  assert.equal(r.primary,'SIDEWAYS');assert.equal(r.confidence,.6);assert.equal(r.stability,.2);assert.equal(r.transitionRisk,.3);assert.equal(r.observedAt,'2026-08-12T10:00:00.000Z');assert.deepEqual(r.probabilities,row.probabilities);
});

test('v1.0.7 shadow stability analysis accumulates persisted prior regimes across cycles',async()=>{
  const first=await buildShadowRecommendation(baseInput);
  const prior=[historyClone(first.regime,minute(250)),historyClone(first.regime,minute(255))];
  const second=await buildShadowRecommendation({...baseInput,priorRegimeAssessments:prior});
  assert.equal(second.regimeHistory.samples,3);
  assert.equal(second.regimeHistory.labelChanges,0);
  assert.equal(second.regimeHistory.meanProbabilityDrift,0);
  assert.equal(second.regimeHistory.stableDurationMinutes,10);
});

test('v1.0.7 shadow still rejects a persisted regime observation after decisionAt',async()=>{
  const first=await buildShadowRecommendation(baseInput);
  await assert.rejects(()=>buildShadowRecommendation({...baseInput,priorRegimeAssessments:[historyClone(first.regime,minute(261))]}),/LOOKAHEAD_REGIME/);
});

test('v1.0.7 live operator loads only bounded strictly-prior regime history and passes it to runtime',async()=>{
  const db=await readFile(new URL('../packages/db/src/index.ts',import.meta.url),'utf8');
  const operator=await readFile(new URL('../apps/operator/src/main.ts',import.meta.url),'utf8');
  const runtime=await readFile(new URL('../packages/operational-runtime/src/index.ts',import.meta.url),'utf8');
  assert.match(db,/decision_at<\$2 ORDER BY decision_at DESC LIMIT \$3/);
  assert.match(db,/Math\.min\(500,\s*limit\)/);
  assert.match(operator,/loadRegimeAssessmentHistory\(\s*cfg\.smokePoolAddress,\s*decisionAt,\s*120,?\s*\)/);
  assert.match(operator,/history,\s*priorRegimeAssessments,\s*protocolCompatible:\s*true/);
  assert.match(runtime,/priorRegimeAssessments:input\.priorRegimeAssessments\?\?\[\]/);
});
