import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const terminal = await import('../.build/apps/terminal/src/model.js');

const snapshot = () => ({
  generatedAt: '2026-09-11T12:00:00.000Z',
  runtime: { releaseSha: '0123456789abcdef0123456789abcdef01234567', policyVersion: 'live-v1', policyHash: 'a'.repeat(64), cluster: 'mainnet-beta', maxOpenPositions: 2 },
  health: { authorityMode: 'PRODUCTION', healthStatus: 'HEALTHY', safetyMode: 'NORMAL', daemonPlan: 'DECISION_CYCLE', newEconomicActionAllowed: true, recoveryQueueCount: 0, unknownSubmissionCount: 0, activeManagementPlans: 0, partialEntryRecoveryCount: 0, activeIncidentCount: 0, telegramStatus: 'SENT' },
  candidates: [{ poolAddress: 'pool', poolDisplay: 'TOKEN/SOL', operationalState: 'ENTRY_READY', phase4State: 'ENTRY_READY', lowerBinId: -667, upperBinId: -595, activeBinId: -610, confidence: .92, uncertainty: .25, oorRisk: .11, riskAdjustedExpectedNetEv: .0012, reasonCodes: ['P4_READY'] }],
  selectedCandidateIndex: 0,
  activePools: [{ lpforgePositionId: 'position-1', positionAddress: 'position-address', poolAddress: 'pool', poolDisplay: 'TOKEN/SOL', enteredAt: '2026-09-11T10:00:00.000Z', lifecycleState: 'OPEN', reconciliationStatus: 'MATCH', lowerBinId: -667, upperBinId: -595, activeBinId: -610, rangeState: 'IN_RANGE', liveControlReturnFraction: .024, liveControlPeakReturnFraction: .048, protection: 'TS5 WATCH' }],
  recentPositions: [{ lifecycleId: 'open:position-address', positionAddress: 'position-address', poolAddress: 'pool', poolDisplay: 'TOKEN/SOL', state: 'OPEN', observedAt: '2026-09-11T10:00:00.000Z', liveControlReturnFraction: .024, holdSeconds: 7200, exitReason: 'LIVE CONTROL MARK' }, { lifecycleId: 'closed:position-address', positionAddress: 'closed-position', poolAddress: 'pool2', poolDisplay: 'OTHER/SOL', state: 'CLOSED', observedAt: '2026-09-11T09:00:00.000Z', realizedReturnFraction: -.0137, holdSeconds: 3600, exitReason: 'PROFIT_RETENTION_TS5_CONFIRMED' }],
  engines: [{ name: 'P7 CONTROL', status: 'HEALTHY', observedAt: '2026-09-11T11:59:58.000Z', detail: 'PRODUCTION' }, { name: 'P6 EXECUTION', status: 'READY', detail: '0 active plans' }],
  events: [{ id: 'e1', observedAt: '2026-09-11T11:59:59.000Z', level: 'INFO', event: 'TS5_WATCH_ARMED', entityType: 'POSITION', entityId: 'position-address', status: 'SENT', message: 'Canonical protection watch armed.' }, { id: 'e2', observedAt: '2026-09-11T11:59:58.000Z', level: 'WARN', event: 'P6_EXECUTION_RECOVERY_PENDING', entityType: 'PLAN', entityId: 'plan-1', status: 'SENT', message: 'Recovery is being verified.' }]
});

test('shell terminal renders every required operational region without a portfolio dashboard', () => {
  const output = terminal.renderDecisionTerminal(snapshot(), { columns: 180, color: false, eventFilter: 'ALL', positionFilter: 'ALL' });
  for (const heading of ['LPFORGE DECISION TERMINAL', 'LIVE EVENT STREAM', 'DECISION TERMINAL', 'CANDIDATE PIPELINE', 'ACTIVE POOLS', 'AGENT / ENGINE DESK', 'FILLS / RECENT POSITIONS', 'SYSTEM HEALTH']) assert.match(output, new RegExp(heading));
  assert.match(output, /LIVE \+2\.40%/);
  assert.match(output, /LIVE PNL/);
  assert.match(output, /TS5 WATCH/);
  assert.doesNotMatch(output, /portfolio|equity chart|order book/i);
});

test('shell terminal filters loaded events and position rows locally', () => {
  const source = snapshot();
  const execution = terminal.renderDecisionTerminal(source, { columns: 180, color: false, eventFilter: 'EXECUTION', positionFilter: 'CLOSED' });
  assert.match(execution, /P6_EXECUTION_RECOVERY_PENDING/);
  assert.doesNotMatch(execution, /TS5_WATCH_ARMED/);
  assert.match(execution, /PROFIT_RETENTION_TS5_CONFIRMED/);
  assert.doesNotMatch(execution, /LIVE CONTROL MARK/);
});

test('shell terminal candidate and filter navigation are bounded and deterministic', () => {
  const source = snapshot();
  source.candidates.push({ ...source.candidates[0], poolAddress: 'pool-2', poolDisplay: 'OTHER/SOL' });
  assert.equal(terminal.advanceCandidateIndex(source, 0, -1), 1);
  assert.equal(terminal.advanceCandidateIndex(source, 1, 1), 0);
  assert.equal(terminal.nextEventFilter('ALL'), 'POOLS');
  assert.equal(terminal.nextPositionFilter('OPEN'), 'CLOSED');
});

test('terminal implementation has no browser, HTTP route, or economic control surface', () => {
  const source = fs.readFileSync('apps/terminal/src/main.ts', 'utf8');
  const launcher = fs.readFileSync('scripts/start-lpforge-service.sh', 'utf8');
  assert.doesNotMatch(source, /createServer|fetch\(|transaction_send|signMessage|submitTransaction|POST\s*\//);
  assert.match(source, /LPFORGE_PHASE1_LIVE_SIGNING_PROHIBITED|loadPhase1Config/);
  assert.match(source, /read-only/);
  assert.match(launcher, /terminal\)[\s\S]*node_args=\("\$\{service_args\[@\]\}"\)/);
});

test('open PnL is sourced from receipt-backed live-control marks, never managed economics', () => {
  const source = fs.readFileSync('apps/terminal/src/main.ts', 'utf8');
  assert.match(source, /lp_mtm_evidence_state AS live_control_state/);
  assert.match(source, /lp_mtm_net_return_fraction AS live_control_return_fraction/);
  assert.match(source, /lp_mtm_peak_return_fraction AS live_control_peak_return_fraction/);
  assert.doesNotMatch(source, /es\.net_return_fraction/);
  assert.doesNotMatch(source, /es\.peak_net_return_fraction/);
});
