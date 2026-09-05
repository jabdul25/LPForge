import test from 'node:test';
import assert from 'node:assert/strict';
import { operationalActiveBinIdFromDbValue, operationalMarketObservationFromDbRow } from '../.build/packages/db/src/index.js';
import { buildMarketContext } from '../.build/packages/market-context/src/index.js';
import { derivePhase3EvidenceWidthRequirement, generateRangeUniverse, generateStrategyCandidates } from '../.build/packages/rangeforge/src/index.js';

const start = Date.parse('2026-08-23T00:00:00.000Z');
const stamp = minute => new Date(start + minute * 60_000).toISOString();
const dbRow = (minute, activeBinId, extra = {}) => ({
  observed_at: stamp(minute),
  price: 1 + minute / 10_000,
  active_bin_id: activeBinId,
  resolution_ms: 300_000,
  volume_5m: 10 + minute,
  fee_5m: 1 + minute / 100,
  tvl: 1_000,
  ...extra,
});
const project = row => {
  const value = operationalMarketObservationFromDbRow(row);
  assert.ok(value);
  return value;
};
const structure = volatilityState => ({
  volatilityState,
  trendDirection: 0,
  trendEfficiency: 0.1,
});
const regime = { transitionRisk: 0.1 };
const rangeUniverse = (context, volatilityState = 'MODERATE') =>
  generateRangeUniverse({
    activeBinId: 3_229,
    binStep: 20,
    horizonMinutes: 60,
    context,
    structure: structure(volatilityState),
    regime,
    maxWidthBins: 100,
  });

test('NULLBIN-001/002 preserves SQL NULL as absent and legitimate active bin zero', () => {
  assert.equal(operationalActiveBinIdFromDbValue(null), undefined);
  assert.equal(operationalActiveBinIdFromDbValue(undefined), undefined);
  assert.equal(operationalActiveBinIdFromDbValue(0), 0);
  assert.equal(operationalActiveBinIdFromDbValue('not-a-bin'), undefined);
  const missing = project(dbRow(0, null));
  assert.equal('activeBinId' in missing, false);
  const zero = project(dbRow(0, 0));
  assert.equal(zero.activeBinId, 0);
  const malformed = project(dbRow(0, 'not-a-bin'));
  assert.equal('activeBinId' in malformed, false);
  const missingLiquidity = project(dbRow(0, 1, { tvl: null }));
  assert.equal('localLiquidity' in missingLiquidity, false);
});

test('NULLBIN-003/004 retains OHLCV but excludes missing active bins from bin motion', async () => {
  const rows = [project(dbRow(0, 3_200)), project(dbRow(5, null)), project(dbRow(10, 3_214))];
  const context = await buildMarketContext('pool', stamp(10), rows);
  const h = context.horizons['15m'];
  assert.equal(context.sourceObservationCount, 3);
  assert.equal(h.volumeTotal, 45);
  assert.ok(h.returnPct > 0);
  assert.equal(h.absoluteBins, 14);
  assert.equal(h.binVelocityPerMinute, 1.4);
});

test('NULLBIN-005 avoids fabricated 3200 -> 0 -> 3214 motion', async () => {
  const rows = [project(dbRow(0, 3_200)), project(dbRow(5, null)), project(dbRow(10, 3_214))];
  const context = await buildMarketContext('pool', stamp(10), rows);
  assert.equal(context.horizons['15m'].absoluteBins, 14);
  assert.notEqual(context.horizons['15m'].absoluteBins, 6_414);
});

test('NULLBIN-006/007 reproduces 5A15-shaped corrected 15m and 1h movement', async () => {
  const fifteen = [
    project(dbRow(0, -1_086)),
    project(dbRow(5, null)),
    project(dbRow(10, -1_080)),
    project(dbRow(15, -1_072)),
  ];
  const fifteenContext = await buildMarketContext('5A15', stamp(15), fifteen);
  assert.equal(fifteenContext.horizons['15m'].absoluteBins, 14);
  assert.ok(fifteenContext.horizons['15m'].absoluteBins < 100);

  const hourly = [
    project(dbRow(0, 3_200)),
    project(dbRow(15, null)),
    project(dbRow(30, 3_214)),
    project(dbRow(45, null)),
    project(dbRow(60, 3_229)),
  ];
  const hourlyContext = await buildMarketContext('5A15', stamp(60), hourly);
  const h = hourlyContext.horizons['1h'];
  assert.equal(h.absoluteBins, 29);
  assert.ok(Math.abs(h.binVelocityPerMinute - 29 / 60) < 1e-12);
  assert.ok(h.absoluteBins < 100);
  assert.ok(h.binVelocityPerMinute < 1);
});

test('NULLBIN-008/009 corrected motion resolves one canonical width across families', async () => {
  const rows = [
    project(dbRow(0, 3_200)),
    project(dbRow(15, null)),
    project(dbRow(30, 3_214)),
    project(dbRow(45, null)),
    project(dbRow(60, 3_229)),
  ];
  const context = await buildMarketContext('pool', stamp(60), rows);
  const universe = rangeUniverse(context);
  const widths = universe.candidates.map(candidate => candidate.widthBins);
  assert.equal(new Set(widths).size, 1);
  assert.ok(widths.some(width => width < 99));
});

test('NULLBIN-010 preserves legitimate extreme 99-bin maximum', () => {
  const context = {
    horizons: {
      '5m': { absoluteBins: 100, returnPct: 0 },
      '15m': { absoluteBins: 500, returnPct: 0 },
      '30m': {},
      '1h': { absoluteBins: 1_000, binVelocityPerMinute: 20 },
    },
  };
  const universe = generateRangeUniverse({ activeBinId: 100, binStep: 20, horizonMinutes: 60, context, structure: structure('EXTREME'), regime, maxWidthBins: 100 });
  assert.ok(universe.candidates.some(candidate => candidate.widthBins === 99));
});

test('NULLBIN-011/012 collector envelope and orientation do not force executable width', async () => {
  const requirement = derivePhase3EvidenceWidthRequirement(100);
  assert.equal(requirement.requiredEvidenceRadius, 147);
  const rows = [project(dbRow(0, 3_200)), project(dbRow(30, 3_214)), project(dbRow(60, 3_229))];
  const context = await buildMarketContext('pool', stamp(60), rows);
  const universe = rangeUniverse(context);
  const narrow = universe.candidates.find(candidate => candidate.widthBins < 99);
  assert.ok(narrow);
  const candidates = generateStrategyCandidates({
    universe: { ...universe, candidates: [narrow] },
    strategyOrientations: { BID_ASK: ['BALANCED', 'ONE_SIDED_Y'] },
  });
  const balanced = candidates.find(candidate => candidate.orientation === 'BALANCED');
  const oneSided = candidates.find(candidate => candidate.orientation === 'ONE_SIDED_Y');
  assert.ok(balanced && oneSided);
  assert.equal(oneSided.widthBins, balanced.widthBins);
  assert.equal(oneSided.upperBinId, oneSided.centerBinId);
  assert.ok(oneSided.widthBins < 99);
});
