import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateRangeUniverse, generateStrategyCandidates, resolveFinalRangeWidthBins } from '../.build/packages/rangeforge/src/index.js';
import { parseDeploymentPolicy } from '../.build/packages/deployment-policy/src/index.js';

const context={horizons:{'15m':{absoluteBins:4,returnPct:0},'1h':{absoluteBins:5,binVelocityPerMinute:.1,returnPct:0}}};
const structure={volatilityState:'LOW',trendDirection:0,trendEfficiency:0};
const regime={transitionRisk:0};
const universe=(minWidthBins,maxWidthBins=100,horizonMinutes=60)=>generateRangeUniverse({activeBinId:100,binStep:80,horizonMinutes,context,structure,regime,minWidthBins,maxWidthBins,enforceRequiredWidth:true});

test('the live policy owns the production floor and rejects an invalid floor',()=>{
  const policy=JSON.parse(readFileSync('policies/live-execution-policy.json','utf8'));
  assert.equal(parseDeploymentPolicy(policy).range.minimumIncludedBins,35);
  assert.throws(()=>parseDeploymentPolicy({...policy,range:{minimumIncludedBins:101}}),/RANGE_MINIMUM_EXCEEDS_MAXIMUM/);
  assert.throws(()=>parseDeploymentPolicy({...policy,range:{minimumIncludedBins:0}}),/RANGE_MINIMUM_INCLUDED_BINS/);
});

test('policy floor is inclusive, configurable, and preserved by skew geometry',()=>{
  for(const [floor,expected] of [[35,35],[20,20],[50,50]]){
    const u=universe(floor);
    assert.ok(u.finalMinimumWidthBins>=expected);
    for(const c of generateStrategyCandidates({universe:u,strategies:['CURVE'],orientations:['SKEWED_Y','SKEWED_X']})){
      assert.ok(c.upperBinId-c.lowerBinId+1>=expected);
      assert.ok(c.widthBins>=expected);
    }
  }
});

test('volatility/survival requirements cannot fall below the policy floor',()=>{
  const u=universe(35);
  assert.equal(u.minimumIncludedBins,35);
  assert.equal(u.finalMinimumWidthBins,Math.max(u.minimumIncludedBins,u.volatilityRequiredWidthBins,u.survivalHorizonRequiredWidthBins));
});

test('required width over the construction maximum fails closed',()=>{
  const extreme={horizons:{'15m':{absoluteBins:200,returnPct:0},'1h':{absoluteBins:200,binVelocityPerMinute:10,returnPct:0}}};
  assert.throws(()=>generateRangeUniverse({activeBinId:100,binStep:80,horizonMinutes:60,context:extreme,structure:{...structure,volatilityState:'EXTREME'},regime,minWidthBins:35,maxWidthBins:100,enforceRequiredWidth:true}),/RANGE_REQUIRED_WIDTH_EXCEEDS_MAXIMUM/);
});

test('final width is the maximum of policy, volatility, and survival requirements',()=>{
  const resolve=(minimumIncludedBins,volatilityRequiredWidthBins,survivalHorizonRequiredWidthBins)=>resolveFinalRangeWidthBins({minimumIncludedBins,volatilityRequiredWidthBins,survivalHorizonRequiredWidthBins,maximumWidthBins:100});
  assert.equal(resolve(35,17,25),35);
  assert.equal(resolve(35,42,38),42);
  assert.equal(resolve(35,30,47),47);
  assert.equal(resolve(35,20,25),35);
  assert.throws(()=>resolve(35,110,38),/RANGE_REQUIRED_WIDTH_EXCEEDS_MAXIMUM/);
});
