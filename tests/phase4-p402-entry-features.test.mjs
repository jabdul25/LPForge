import test from 'node:test'; import assert from 'node:assert/strict';
import { computeEntryTimingFeatures } from '../.build/packages/entry-features/src/index.js';
const ctx={horizons:{'5m':{returnPct:-.2,netBins:-1,binVelocityPerMinute:.4,completeness:1},'15m':{binVelocityPerMinute:.7,completeness:1},'1h':{completeness:1}}};
const regime={probabilities:[{label:'CONTROLLED_PULLBACK',probability:.6},{label:'FREEFALL',probability:.05},{label:'TREND_DOWN',probability:.1},{label:'DISTRIBUTION',probability:.05}],stability:.7,transitionRisk:.15};
const structure={downsideAcceleration:.1,upsideAcceleration:.05,expansionScore:.2,volatilityState:'MODERATE',supportIntegrity:.8,reclaimScore:.75,flowTwoWay:.7};
const pool={toxicityProbability:.15};
const candidate={lowerBinId:90,upperBinId:110,widthBins:21};
test('P4-02 strong stabilizing entry has good reclaim and low immediate risk',()=>{const f=computeEntryTimingFeatures({context:ctx,regime,structure,pool,candidate,activeBinId:100,referenceDivergenceBps:20,previousTwoWayRatio:.55});assert.ok(f.supportReclaimStrength>.7);assert.ok(f.downsideDeceleration>.8);assert.ok(f.immediateOorRisk<.5);assert.ok(f.flowRecovery>.5);});
test('P4-02 boundary pressure and collapse are exposed, not hidden',()=>{const f=computeEntryTimingFeatures({context:{...ctx,horizons:{...ctx.horizons,'5m':{returnPct:-4,netBins:-18,binVelocityPerMinute:7,completeness:1}}},regime:{...regime,stability:.15,transitionRisk:.7},structure:{...structure,downsideAcceleration:.95,expansionScore:.9,volatilityState:'EXTREME',flowTwoWay:.1},pool:{toxicityProbability:.8},candidate,activeBinId:91,referenceDivergenceBps:300});assert.ok(f.downsidePressure>.8);assert.ok(f.immediateOorRisk>.5);assert.ok(f.reasonCodes.includes('ENTRY_POOL_TOXICITY_HIGH'));});
