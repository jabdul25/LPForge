import assert from 'node:assert/strict';
import test from 'node:test';
import {assessPositionHealth} from '../.build/packages/live-position-management/src/index.js';

test('position health is monitoring-only but distinguishes lower-range danger from upside OOR', () => {
  const lowerThird = assessPositionHealth({activeBinId: 3, lowerBinId: 0, upperBinId: 12, liveControlReturnFraction: -.02});
  assert.equal(lowerThird.rangeState, 'LOWER_THIRD');
  assert.equal(lowerThird.healthState, 'YELLOW');
  assert.equal(lowerThird.monitoringTier, 'DANGER');

  const edge = assessPositionHealth({activeBinId: 0, lowerBinId: 0, upperBinId: 12, liveControlReturnFraction: -.07});
  assert.equal(edge.rangeState, 'LOWER_EDGE');
  assert.equal(edge.healthState, 'ORANGE');
  assert.equal(edge.monitoringTier, 'CRITICAL');

  const below = assessPositionHealth({activeBinId: -1, lowerBinId: 0, upperBinId: 12, liveControlReturnFraction: -.08});
  assert.equal(below.rangeState, 'BELOW_MIN');
  assert.equal(below.oorDirection, 'BELOW_MIN');
  assert.equal(below.healthState, 'RED');
  assert.equal(below.monitoringTier, 'CRITICAL');

  const upside = assessPositionHealth({activeBinId: 13, lowerBinId: 0, upperBinId: 12, liveControlReturnFraction: .03});
  assert.equal(upside.rangeState, 'OOR_UPSIDE');
  assert.equal(upside.oorDirection, 'ABOVE_MAX');
  assert.equal(upside.healthState, 'GREEN');
  assert.equal(upside.monitoringTier, 'NORMAL');
});

test('rapid adverse live-control movement elevates monitoring without creating an exit action', () => {
  const result = assessPositionHealth({
    activeBinId: 8,
    lowerBinId: 0,
    upperBinId: 12,
    previousLiveControlReturnFraction: .02,
    liveControlReturnFraction: -.012,
  });
  assert.equal(result.rangeState, 'IN_RANGE');
  assert.equal(result.rapidNegativeMove, true);
  assert.equal(result.healthState, 'YELLOW');
  assert.equal(result.monitoringTier, 'DANGER');
  assert.ok(result.reasonCodes.includes('POSITION_HEALTH_RAPID_NEGATIVE_MOVE'));
});
