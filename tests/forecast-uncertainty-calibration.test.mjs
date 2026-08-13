import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveRegimeAmbiguity,deriveOutcomeDispersion,estimateOpportunityEconomics} from '../.build/packages/opportunity/src/index.js';
import {buildMarketContext} from '../.build/packages/market-context/src/index.js';
import {computeStructureFeatures} from '../.build/packages/structure-features/src/index.js';
import {classifyRegime} from '../.build/packages/regime/src/index.js';

const pool={economicQualityScore:85,flowQualityScore:85,liquidityQualityScore:85,toxicityProbability:.1};
const structure={structureQuality:.85,downsideAcceleration:.05};
const rates={feeRatePerCapitalHour:.01,adverseInventoryRatePerCapitalHour:.0005,repositionRatePerCapitalHour:.0005,tailRiskRatePerCapitalHour:.00035,executionCostFixed:.00001,sampleCount:7,uncertainty:.4225,fidelity:'EVENT_PATH_ESTIMATE'};
const economics=(regime,regimeHistory)=>estimateOpportunityEconomics({capitalValue:1,horizonMinutes:60,rates,pool,regime,regimeHistory,structure});

test('mature 90-minute event evidence can pass the unchanged .72 gate without impossible top-label confidence',()=>{
 const regime={confidence:.45,stability:.25,transitionRisk:.05,probabilities:[{label:'SIDEWAYS',probability:.45},{label:'CONSOLIDATION',probability:.25},{label:'CONTROLLED_PULLBACK',probability:.15},{label:'RECOVERY',probability:.10},{label:'TREND_DOWN',probability:.05}]};
 const result=economics(regime,{transitionRisk:.05,flappingRate:.01,stableDurationMinutes:120});
 assert.ok(result.uncertainty<=.72,`reachable uncertainty=${result.uncertainty}`);assert.ok(result.forecastUncertaintyComponents.regimeAmbiguity>0);assert.equal(result.forecastUncertaintyComponents.outcomeDispersion,0);
});

test('real classifier output, rather than an injected .95 confidence, can reach the unchanged Phase-4 gate',async()=>{
 const end=Date.parse('2026-08-13T20:00:00.000Z');
 const observations=Array.from({length:241},(_,i)=>({observedAt:new Date(end-(240-i)*60_000).toISOString(),price:1,activeBinId:100,volume:1_000,feeValue:2,twoWayRatio:.8,localLiquidity:100_000}));
 const context=await buildMarketContext('P',new Date(end).toISOString(),observations);
 const realStructure=computeStructureFeatures({context,observations}),realRegime=classifyRegime({context,structure:realStructure});
 const result=estimateOpportunityEconomics({capitalValue:1,horizonMinutes:60,rates,pool,regime:realRegime,regimeHistory:{transitionRisk:realRegime.transitionRisk,flappingRate:0,stableDurationMinutes:120},structure:realStructure});
 assert.ok(realRegime.confidence<.5,'the actual 13-label classifier should not need synthetic near-certainty');
 assert.ok(result.uncertainty<=.72,`real-classifier reachable uncertainty=${result.uncertainty}`);
});

test('ambiguous, unstable regime remains above the unchanged .72 gate',()=>{
 const regime={confidence:.17,stability:.05,transitionRisk:.55,probabilities:[{label:'CONSOLIDATION',probability:.17},{label:'RECOVERY',probability:.12},{label:'TREND_DOWN',probability:.11},{label:'SIDEWAYS',probability:.10},{label:'TRANSITION',probability:.09},{label:'EXHAUSTION',probability:.08},{label:'FREEFALL',probability:.06},{label:'UNKNOWN',probability:.05},{label:'BREAKOUT',probability:.04},{label:'TREND_UP',probability:.03},{label:'DISTRIBUTION',probability:.03},{label:'CONTROLLED_PULLBACK',probability:.07},{label:'BREAKOUT_CONTROLLED_PULLBACK',probability:.15}]};
 const result=economics(regime,{transitionRisk:.60,flappingRate:.25,stableDurationMinutes:5});
 assert.ok(result.uncertainty>.72,`unstable uncertainty=${result.uncertainty}`);
});

test('regime ambiguity uses distribution shape and stability, not raw top-label confidence',()=>{
 const common={confidence:.25,stability:.25,transitionRisk:.08,probabilities:[{label:'SIDEWAYS',probability:.25},{label:'CONSOLIDATION',probability:.23},{label:'RECOVERY',probability:.20},{label:'CONTROLLED_PULLBACK',probability:.18},{label:'TREND_DOWN',probability:.14}]};
 const stable=deriveRegimeAmbiguity(common,{transitionRisk:.08,flappingRate:.01,stableDurationMinutes:120});
 const unstable=deriveRegimeAmbiguity({...common,transitionRisk:.55},{transitionRisk:.60,flappingRate:.30,stableDurationMinutes:2});
 assert.ok(unstable.penalty>stable.penalty);
});

test('candidate outcome disagreement is independent from evidence quality and raises forecast uncertainty',()=>{
 const regime={confidence:.45,stability:.25,transitionRisk:.05,probabilities:[{label:'SIDEWAYS',probability:.45},{label:'CONSOLIDATION',probability:.25},{label:'CONTROLLED_PULLBACK',probability:.15},{label:'RECOVERY',probability:.10},{label:'TREND_DOWN',probability:.05}]};
 const history={transitionRisk:.05,flappingRate:.01,stableDurationMinutes:120};
 const agreement=deriveOutcomeDispersion([{netValue:.01},{netValue:.011},{netValue:.009}]);
 const disagreement=deriveOutcomeDispersion([{netValue:.03},{netValue:-.02},{netValue:.001}]);
 assert.ok(disagreement>agreement);
 assert.ok(economics(regime,history).uncertainty<estimateOpportunityEconomics({capitalValue:1,horizonMinutes:60,rates,pool,regime,regimeHistory:history,structure,outcomeDispersion:disagreement}).uncertainty);
});
