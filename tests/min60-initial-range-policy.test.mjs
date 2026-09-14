import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateRangeUniverse, generateStrategyCandidates, resolveFinalRangeWidthBins } from '../.build/packages/rangeforge/src/index.js';
import { initialIncludedBinCountWithinPolicy, parseDeploymentPolicy } from '../.build/packages/deployment-policy/src/index.js';

const maximum=100;
const resolve=derived=>resolveFinalRangeWidthBins({minimumIncludedBins:60,volatilityRequiredWidthBins:derived,survivalHorizonRequiredWidthBins:derived,maximumWidthBins:maximum});
const context={horizons:{'15m':{absoluteBins:4,returnPct:0},'1h':{absoluteBins:5,binVelocityPerMinute:.1,returnPct:0}}};
const build=(trendDirection=1)=>generateRangeUniverse({activeBinId:1000,binStep:80,horizonMinutes:60,context,structure:{volatilityState:'LOW',trendDirection,trendEfficiency:.8},regime:{transitionRisk:0},minWidthBins:60,maxWidthBins:100,enforceRequiredWidth:true});

test('MIN60 resolves derived widths below the floor without altering widths already in the 60-100 band',()=>{
  for(const derived of [35,45,59]) assert.equal(resolve(derived),60);
  for(const width of [60,61,80,100]) assert.equal(resolve(width),width);
  assert.throws(()=>resolve(101),/RANGE_REQUIRED_WIDTH_EXCEEDS_MAXIMUM/);
});

test('MIN60 uses inclusive bin counts and preserves directional strategy/orientation semantics',()=>{
  const universe=build(1);
  assert.equal(universe.finalMinimumWidthBins,60);
  const candidates=generateStrategyCandidates({universe,strategies:['CURVE'],orientations:['SKEWED_Y','ONE_SIDED_Y'],capitalFractions:[1]});
  assert.equal(candidates.length,8,'four existing range families for each requested orientation');
  for(const candidate of candidates){
    assert.equal(candidate.widthBins,60);
    assert.equal(candidate.upperBinId-candidate.lowerBinId+1,60);
    assert.equal(candidate.capitalFraction,1);
    assert.ok(candidate.upperOffsetBins>candidate.lowerOffsetBins,'uptrend skew keeps extra room on the intended upper side');
  }
  assert.equal(candidates.find(c=>c.orientation==='ONE_SIDED_Y')?.orientation,'ONE_SIDED_Y');
});

test('released policy and construction ceiling agree on MIN60/MAX100',()=>{
  const policy=JSON.parse(readFileSync('release-policy-templates/live-execution-policy.json','utf8'));
  const parsed=parseDeploymentPolicy(policy);
  assert.equal(parsed.range.minimumIncludedBins,60);
  assert.equal(parsed.positionConstruction.maxInitialPositionWidthBins,100);
  assert.ok(parsed.range.minimumIncludedBins<=parsed.positionConstruction.maxInitialPositionWidthBins);
});

test('execution-side initial OPEN validation rejects below-60 geometry without affecting the 60-100 band',()=>{
  const valid=width=>initialIncludedBinCountWithinPolicy({lowerBinId:100,upperBinId:100+width-1,minimumIncludedBins:60,maximumIncludedBins:100});
  for(const width of [35,45,59]) assert.equal(valid(width),false);
  for(const width of [60,61,80,100]) assert.equal(valid(width),true);
  assert.equal(valid(101),false);
});
