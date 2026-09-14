import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateRangeUniverse, generateStrategyCandidates, resolveFinalRangeWidthBins } from '../.build/packages/rangeforge/src/index.js';
import { initialIncludedBinCountWithinPolicy, parseDeploymentPolicy, requireInitialRangeConstructionPolicy } from '../.build/packages/deployment-policy/src/index.js';

const context={horizons:{'15m':{absoluteBins:4,returnPct:0},'1h':{absoluteBins:5,binVelocityPerMinute:.1,returnPct:0}}};
const structure={volatilityState:'LOW',trendDirection:0,trendEfficiency:0};
const regime={transitionRisk:0};
const universe=(minWidthBins,maxWidthBins=100,horizonMinutes=60)=>generateRangeUniverse({activeBinId:100,binStep:80,horizonMinutes,context,structure,regime,minWidthBins,maxWidthBins,enforceRequiredWidth:true});

test('the live policy owns the production floor and rejects an invalid floor',()=>{
  const policy=JSON.parse(readFileSync('release-policy-templates/live-execution-policy.json','utf8'));
  assert.equal(parseDeploymentPolicy(policy).range.minimumIncludedBins,60);
  assert.throws(()=>parseDeploymentPolicy({...policy,range:{minimumIncludedBins:101}}),/RANGE_MINIMUM_EXCEEDS_MAXIMUM/);
  assert.throws(()=>parseDeploymentPolicy({...policy,range:{minimumIncludedBins:0}}),/RANGE_MINIMUM_INCLUDED_BINS/);
});

test('policy floor is inclusive, configurable, and preserved by skew geometry',()=>{
  for(const [floor,expected] of [[60,60],[20,20],[50,50]]){
    const u=universe(floor);
    assert.ok(u.finalMinimumWidthBins>=expected);
    for(const c of generateStrategyCandidates({universe:u,strategies:['CURVE'],orientations:['SKEWED_Y','SKEWED_X']})){
      assert.ok(c.upperBinId-c.lowerBinId+1>=expected);
      assert.ok(c.widthBins>=expected);
    }
  }
});

test('volatility/survival requirements cannot fall below the policy floor',()=>{
  const u=universe(60);
  assert.equal(u.minimumIncludedBins,60);
  assert.equal(u.finalMinimumWidthBins,Math.max(u.minimumIncludedBins,u.volatilityRequiredWidthBins,u.survivalHorizonRequiredWidthBins));
});

test('required width over the construction maximum fails closed',()=>{
  const extreme={horizons:{'15m':{absoluteBins:200,returnPct:0},'1h':{absoluteBins:200,binVelocityPerMinute:10,returnPct:0}}};
  assert.throws(()=>generateRangeUniverse({activeBinId:100,binStep:80,horizonMinutes:60,context:extreme,structure:{...structure,volatilityState:'EXTREME'},regime,minWidthBins:35,maxWidthBins:100,enforceRequiredWidth:true}),/RANGE_REQUIRED_WIDTH_EXCEEDS_MAXIMUM/);
});

test('final width is the maximum of policy, volatility, and survival requirements',()=>{
  const resolve=(minimumIncludedBins,volatilityRequiredWidthBins,survivalHorizonRequiredWidthBins)=>resolveFinalRangeWidthBins({minimumIncludedBins,volatilityRequiredWidthBins,survivalHorizonRequiredWidthBins,maximumWidthBins:100});
  assert.equal(resolve(60,17,25),60);
  assert.equal(resolve(60,42,38),60);
  assert.equal(resolve(60,30,47),60);
  assert.equal(resolve(60,20,25),60);
  assert.throws(()=>resolve(60,110,38),/RANGE_REQUIRED_WIDTH_EXCEEDS_MAXIMUM/);
});

test('RangeForge, deployment validation, and P6-bound geometry obey arbitrary supplied min/max policy',()=>{
  for(const [minimumIncludedBins,maximumIncludedBins] of [[35,100],[60,100],[65,100],[75,90]]){
    const policy=parseDeploymentPolicy({schemaVersion:1,policyId:'fixture',status:'DISABLED',approvalTtlMs:5000,minDevnetConfirmedRuns:1,maxActionsPerDay:1,maxOpenPositions:1,pools:[],range:{minimumIncludedBins},positionConstruction:{maxInitialPositionWidthBins:maximumIncludedBins,maxPositionAccountRentSol:'0.01',requirePreinitializedBinArrays:true,liquiditySlippageBps:100}});
    const bounds=requireInitialRangeConstructionPolicy(policy);
    const valid=width=>initialIncludedBinCountWithinPolicy({lowerBinId:100,upperBinId:100+width-1,minimumIncludedBins:bounds.minimumIncludedBins,maximumIncludedBins:bounds.maximumIncludedBins});
    assert.equal(valid(minimumIncludedBins-1),false,`min ${minimumIncludedBins}`);
    assert.equal(valid(minimumIncludedBins),true,`min ${minimumIncludedBins}`);
    assert.equal(valid(maximumIncludedBins),true,`max ${maximumIncludedBins}`);
    assert.equal(valid(maximumIncludedBins+1),false,`max ${maximumIncludedBins}`);
    assert.equal(resolveFinalRangeWidthBins({minimumIncludedBins:bounds.minimumIncludedBins,volatilityRequiredWidthBins:1,survivalHorizonRequiredWidthBins:1,maximumWidthBins:bounds.maximumIncludedBins}),minimumIncludedBins);
  }
});

test('policy-fixture simulations prove 60 to 65 and 100 to 95 require no engine constant change',()=>{
  const min65={minimumIncludedBins:65,maximumIncludedBins:100};
  assert.equal(initialIncludedBinCountWithinPolicy({lowerBinId:0,upperBinId:63,...min65}),false);
  assert.equal(initialIncludedBinCountWithinPolicy({lowerBinId:0,upperBinId:64,...min65}),true);
  const max95={minimumIncludedBins:60,maximumIncludedBins:95};
  assert.equal(resolveFinalRangeWidthBins({minimumIncludedBins:max95.minimumIncludedBins,volatilityRequiredWidthBins:95,survivalHorizonRequiredWidthBins:95,maximumWidthBins:max95.maximumIncludedBins}),95);
  assert.equal(initialIncludedBinCountWithinPolicy({lowerBinId:0,upperBinId:95,...max95}),false);
  assert.equal(initialIncludedBinCountWithinPolicy({lowerBinId:0,upperBinId:94,...max95}),true);
});
