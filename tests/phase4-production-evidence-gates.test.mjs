import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionTimeEconomicEvidenceAgeSeconds,evaluateOperationalCycle,hasConfirmedEvidenceMaturity} from '../.build/packages/operational-runtime/src/index.js';
import {fixtureBins,fixtureDataApiPool,fixturePool} from '../.build/packages/test-fixtures/src/index.js';

const at='2026-08-12T12:00:00.000Z';
const pool={...fixturePool,stamp:{...fixturePool.stamp,observedAt:at}};
const bins=fixtureBins.map(bin=>({...bin,stamp:{...bin.stamp,observedAt:at}}));
const productionCapitalPolicy={id:'test',reserveCapital:0,maxPortfolioCapital:1,maxTokenCapital:1,targetInitialPosition:0.1,maxInitialPosition:0.1,minInitialPosition:0.01};
const base={observedAt:at,pool,bins,dataApiPool:fixtureDataApiPool,history:{marketObservations:[],activeBins:[],binFrames:[],swapEvents:[]},protocolCompatible:true,walletCapital:1,productionCapitalPolicy,productionPoolCapital:1,planPreparationEnabled:true};

test('automatic capital path fails closed when maturity evidence is absent',async()=>{
 const result=await evaluateOperationalCycle(base);
 assert.equal(result.phase3Status,'WARMING');
 assert.ok(result.reasonCodes.includes('OPERATIONAL_EVIDENCE_MATURITY_MISSING'));
});

test('automatic capital path requires historical maturity and confirmed live evidence',async()=>{
 assert.equal(hasConfirmedEvidenceMaturity({state:'MATURE',historicalState:'MATURE',liveConfirmationState:'CONFIRMED'}),true);
 assert.equal(hasConfirmedEvidenceMaturity({state:'MATURE',historicalState:'MATURE',liveConfirmationState:'WARMING'}),false);
 const result=await evaluateOperationalCycle({...base,evidenceMaturity:{state:'MATURE',historicalState:'MATURE',liveConfirmationState:'CONFIRMED'}});
 assert.equal(result.phase3Status,'WARMING');
 assert.ok(result.reasonCodes.includes('OPERATIONAL_ECONOMIC_EVIDENCE_MISSING'));
});

test('economic evidence age is recalculated at the decision timestamp',()=>{
 assert.equal(decisionTimeEconomicEvidenceAgeSeconds({estimateAsOf:'2026-08-12T12:00:00.000Z',storedEvidenceAgeSeconds:30,decisionAt:'2026-08-12T12:04:31.000Z'}),301);
 assert.equal(decisionTimeEconomicEvidenceAgeSeconds({estimateAsOf:'invalid',storedEvidenceAgeSeconds:0,decisionAt:at}),Infinity);
});
