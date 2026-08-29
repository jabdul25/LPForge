import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPool,estimateToxicity,summarizeEconomics,poolInputFromDataApi,PHASE6_CANARY_POOL_POLICY_V1} from '../.build/packages/pool-intelligence/src/index.js';

const healthy={pool:'p',protocolCompatible:true,dataFreshness:'GOOD',observedAt:'2026-08-12T00:00:00Z',dataAgeSeconds:5,tvl:250000,tokenX:{freezeAuthorityDisabled:true,isVerified:true,holders:5000},tokenY:{freezeAuthorityDisabled:true,isVerified:true,holders:100000},bin:{binCount:61,localAmountX:1,localAmountY:1,liquiditySkew:0,nonEmptyRatio:.95,emptyGapCount:0,maxConsecutiveEmpty:0,activeBinLiquidityShare:.05},movement:{observations:10,netBins:2,absoluteBins:10,reversals:4,directionality:.2,velocityBinsPerMinute:1},flow:{swaps:100,upwardBinMoves:52,downwardBinMoves:48,flatBinMoves:0,twoWayRatio:.96,netDirection:.04,meanBinsCrossed:2,totalMmFeeRaw:'1000'},fee:{tvl:250000,fees:{'1h':100,'24h':1800},volume:{'1h':20000,'24h':300000},feeTvlRatio:{'1h':.04,'24h':.72},feeBurstRatio1hTo24h:1.33}};
test('healthy two-way pool can become research eligible',()=>{const a=assessPool(healthy);assert.equal(a.eligibility,'ELIGIBLE');assert.ok(a.toxicityProbability<.5);assert.equal(a.blockers.length,0);});
test('blacklist is a hard block even when fees are attractive',()=>{const a=assessPool({...healthy,tokenX:{...healthy.tokenX,isBlacklisted:true}});assert.equal(a.eligibility,'BLOCK');assert.ok(a.blockers.includes('TOKEN_OR_POOL_BLACKLISTED'));});
test('one-way high-velocity flow raises toxicity',()=>{const toxic={...healthy,movement:{...healthy.movement,directionality:.98,velocityBinsPerMinute:30},flow:{...healthy.flow,twoWayRatio:.02,netDirection:.98,meanBinsCrossed:40}};assert.ok(estimateToxicity(toxic)>.65);assert.notEqual(assessPool(toxic).eligibility,'ELIGIBLE');});
test('economics summary separates fee from adverse inventory',()=>{const s=summarizeEconomics([{netValue:1,feeValue:3,inventoryPnl:-2,hodlRelativePnl:-1,activeTimeRatio:.8},{netValue:2,feeValue:4,inventoryPnl:-1,hodlRelativePnl:1,activeTimeRatio:.9}]);assert.equal(s.samples,2);assert.equal(s.meanNetValue,1.5);assert.ok(s.feeToAdverseInventoryRatio>2);});

import {computeSustainability} from '../.build/packages/pool-intelligence/src/index.js';
test('historical fee persistence rewards recurring rather than one-bucket fees',()=>{const stable=computeSustainability(Array.from({length:12},(_,i)=>({timestamp:i,fees:100+(i%2)*5,protocol_fees:10,volume:1000})));const burst=computeSustainability(Array.from({length:12},(_,i)=>({timestamp:i,fees:i===11?1200:0,protocol_fees:i===11?120:0,volume:i===11?12000:0})));assert.ok(stable.persistenceScore>burst.persistenceScore);assert.equal(stable.activeFeeBucketRatio,1);});


test('exact canonical USDC freeze-authority exception removes only the hard blocker',()=>{
  const a=assessPool({...healthy,pool:'5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',tokenX:{...healthy.tokenX,mintAddress:'So11111111111111111111111111111111111111112'},tokenY:{...healthy.tokenY,mintAddress:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',freezeAuthorityDisabled:false}},PHASE6_CANARY_POOL_POLICY_V1);
  assert.ok(!a.blockers.includes('FREEZE_AUTHORITY_ENABLED'));
  assert.ok(a.warnings.includes('TRUSTED_FREEZE_AUTHORITY_EXCEPTION'));
  assert.deepEqual(a.evidence.freezeAuthorityExceptions,[{pool:'5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',tokenMint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',reason:'CANONICAL_USDC_EXACT_POOL_ALLOWLIST'}]);
});

test('canonical USDC mint outside the exact approved pool remains freeze-authority blocked',()=>{
  const a=assessPool({...healthy,pool:'unapproved-pool',tokenY:{...healthy.tokenY,mintAddress:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',freezeAuthorityDisabled:false}},PHASE6_CANARY_POOL_POLICY_V1);
  assert.equal(a.eligibility,'BLOCK');
  assert.ok(a.blockers.includes('FREEZE_AUTHORITY_ENABLED'));
  assert.ok(!a.warnings.includes('TRUSTED_FREEZE_AUTHORITY_EXCEPTION'));
});

test('unknown or spoofed mint in approved pool remains freeze-authority blocked',()=>{
  const a=assessPool({...healthy,pool:'5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',tokenY:{...healthy.tokenY,mintAddress:'FakeUSDCMint111111111111111111111111111111111',freezeAuthorityDisabled:false}},PHASE6_CANARY_POOL_POLICY_V1);
  assert.equal(a.eligibility,'BLOCK');
  assert.ok(a.blockers.includes('FREEZE_AUTHORITY_ENABLED'));
  assert.ok(!a.warnings.includes('TRUSTED_FREEZE_AUTHORITY_EXCEPTION'));
});

test('freeze-enabled token without a mint identity can never consume a trusted exception',()=>{
  const a=assessPool({...healthy,pool:'5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',tokenY:{...healthy.tokenY,freezeAuthorityDisabled:false}},PHASE6_CANARY_POOL_POLICY_V1);
  assert.equal(a.eligibility,'BLOCK');
  assert.ok(a.blockers.includes('FREEZE_AUTHORITY_ENABLED'));
});


test('Data API normalization preserves exact mint identity for the canonical exception path',()=>{
  const apiPool={
    address:'5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',
    tvl:250000,
    is_blacklisted:false,
    token_x:{address:'So11111111111111111111111111111111111111112',freeze_authority_disabled:true,is_verified:true,holders:5000},
    token_y:{address:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',freeze_authority_disabled:false,is_verified:true,holders:100000},
  };
  const input=poolInputFromDataApi(apiPool,{bin:healthy.bin,movement:healthy.movement,flow:healthy.flow,fee:healthy.fee},{protocolCompatible:true,dataFreshness:'GOOD',observedAt:'2026-08-12T00:00:00Z',dataAgeSeconds:5});
  assert.equal(input.tokenX.mintAddress,'So11111111111111111111111111111111111111112');
  assert.equal(input.tokenY.mintAddress,'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const a=assessPool(input,PHASE6_CANARY_POOL_POLICY_V1);
  assert.ok(!a.blockers.includes('FREEZE_AUTHORITY_ENABLED'));
  assert.ok(a.warnings.includes('TRUSTED_FREEZE_AUTHORITY_EXCEPTION'));
});


test('generic research policy remains strict even for canonical USDC',()=>{
  const a=assessPool({...healthy,pool:'5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',tokenY:{...healthy.tokenY,mintAddress:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',freezeAuthorityDisabled:false}});
  assert.equal(a.policyId,'research-pool-policy-v1');
  assert.equal(a.eligibility,'BLOCK');
  assert.ok(a.blockers.includes('FREEZE_AUTHORITY_ENABLED'));
});
