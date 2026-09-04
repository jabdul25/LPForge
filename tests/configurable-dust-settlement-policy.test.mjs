import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDeploymentPolicy} from '../.build/packages/deployment-policy/src/index.js';
import {assessLifecycleSettlement} from '../.build/packages/db/src/index.js';
import {assessResidualDustDisposition} from '../.build/packages/phase6-live-worker/src/index.js';

const now='2026-09-04T12:00:00.000Z';
const dust=(threshold,price=.0004)=>assessResidualDustDisposition({rawAmount:100_000_000_000n,decimals:9,unitPriceUsd:price,valuationAt:now,now,thresholdUsd:threshold});
test('policy dust threshold is numeric, finite, and defaults fail-closed',()=>{
  const base={schemaVersion:1,policyId:'p',status:'ENABLED',approvalTtlMs:15000,minDevnetConfirmedRuns:1,maxActionsPerDay:1,maxOpenPositions:1,pools:[{address:'pool',maxCapitalSol:'0.03',maxOpenPositions:1}],settlement:{residualDustThresholdUsd:.10}};
  assert.equal(parseDeploymentPolicy(base).settlement.residualDustThresholdUsd,.10);
  assert.equal(parseDeploymentPolicy({...base,settlement:undefined}).settlement.residualDustThresholdUsd,0);
  assert.throws(()=>parseDeploymentPolicy({...base,settlement:{residualDustThresholdUsd:-.01}}),/RESIDUAL_DUST_THRESHOLD_USD/);
  assert.throws(()=>parseDeploymentPolicy({...base,settlement:{residualDustThresholdUsd:'no'}}),/RESIDUAL_DUST_THRESHOLD_USD/);
});
test('dust threshold is configurable and valuation is fail-closed',()=>{
  assert.equal(dust(.10).eligible,true); // $0.04 <= $0.10
  assert.equal(dust(.05).eligible,true);
  assert.equal(dust(.01).eligible,false);
  assert.equal(assessResidualDustDisposition({rawAmount:1n,decimals:9,unitPriceUsd:undefined,valuationAt:now,now,thresholdUsd:.10}).eligible,false);
  assert.equal(assessResidualDustDisposition({rawAmount:1n,decimals:9,unitPriceUsd:1,valuationAt:'2026-09-04T11:58:00.000Z',now,thresholdUsd:.10}).eligible,false);
});
test('only an audited retained-dust lot can cross lifecycle settlement',()=>{
  const base={lifecycle:{lifecycleId:'l',positionAddress:'p',ownerAddress:'o',poolAddress:'pool',status:'CLOSED'},cashflows:[],transactions:[],positionAbsent:true,positionCheckedAt:now,reconciliationClean:true,reservationClean:true};
  const lot={lotId:'lot',positionAddress:'p',planId:'plan',ownerAddress:'o',poolAddress:'pool',tokenMint:'mint',tokenSide:'X',sourceEvent:'OPEN_RESIDUAL',rawAmount:100n,remainingRawAmount:100n,decimals:9,acquiredAt:now,status:'DUST_RETAINED',payload:{dustDisposition:{state:'DUST_RETAINED',rawAmount:'100',usdValue:.04,thresholdUsd:.10,valuationSource:'METEORA_DATA_API_POOL_TOKEN_PRICE',valuationAt:now}}};
  assert.equal(assessLifecycleSettlement({...base,inventoryLots:[lot]}).ready,true);
  assert.equal(assessLifecycleSettlement({...base,inventoryLots:[{...lot,payload:{}}]}).ready,false);
});
