import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const terminal = await import('../.build/apps/terminal/src/model.js');

const snapshot = () => ({
  generatedAt: '2026-09-11T12:00:00.000Z',
  runtime: { releaseSha: '0123456789abcdef0123456789abcdef01234567', policyVersion: 'live-v1', policyHash: 'a'.repeat(64), cluster: 'mainnet-beta', maxOpenPositions: 2 },
  health: { authorityMode: 'PRODUCTION', healthStatus: 'HEALTHY', safetyMode: 'NORMAL', daemonPlan: 'DECISION_CYCLE', newEconomicActionAllowed: true, recoveryQueueCount: 0, unknownSubmissionCount: 0, activeManagementPlans: 0, partialEntryRecoveryCount: 0, activeIncidentCount: 0, telegramStatus: 'SENT', rpcHealth: [{ role: 'PRODUCTION', state: 'HEALTHY', latencyMs: 42, quotaState: 'OK', observedAt: '2026-09-11T11:59:59.000Z' }, { role: 'DISCOVERY', state: 'HEALTHY', quotaState: 'OK', observedAt: '2026-09-11T11:59:58.000Z' }, { role: 'EXECUTION', state: 'HEALTHY', quotaState: 'OK', observedAt: '2026-09-11T11:59:58.000Z' }] },
  candidates: [{ poolAddress: 'pool', poolDisplay: 'TOKEN/SOL', operationalState: 'ENTRY_READY', phase4State: 'ENTRY_READY', lowerBinId: -667, upperBinId: -595, activeBinId: -610, confidence: .92, uncertainty: .25, oorRisk: .11, riskAdjustedExpectedNetEv: .0012, reasonCodes: ['P4_READY'] }],
  entryWatchPools: [{ poolAddress: 'pool', poolDisplay: 'TOKEN/SOL', operationalState: 'ENTRY_READY', phase4State: 'ENTRY_READY', rank: 1, confidence: .92, riskAdjustedExpectedNetEv: .0012, reasonCodes: ['P4_READY'], registryState: 'ACTIVE_CANDIDATE' }],
  selectedCandidateIndex: 0,
  activePools: [{ lpforgePositionId: 'position-1', positionAddress: 'position-address', poolAddress: 'pool', poolDisplay: 'TOKEN/SOL', enteredAt: '2026-09-11T10:00:00.000Z', lifecycleState: 'OPEN', reconciliationStatus: 'MATCH', lowerBinId: -667, upperBinId: -595, activeBinId: -610, rangeState: 'IN_RANGE', liveControlReturnFraction: .024, liveControlPeakReturnFraction: .048, protection: 'TS5 WATCH' }],
  recentPositions: [{ lifecycleId: 'open:position-address', positionAddress: 'position-address', poolAddress: 'pool', poolDisplay: 'TOKEN/SOL', state: 'OPEN', observedAt: '2026-09-11T10:00:00.000Z', liveControlReturnFraction: .024, holdSeconds: 7200, exitReason: 'LIVE CONTROL MARK' }, { lifecycleId: 'closed:position-address', positionAddress: 'closed-position', poolAddress: 'pool2', poolDisplay: 'OTHER/SOL', state: 'CLOSED', observedAt: '2026-09-11T09:00:00.000Z', realizedReturnFraction: -.0137, holdSeconds: 3600, exitReason: 'PROFIT_RETENTION_TS5_CONFIRMED' }],
  engines: [{ name: 'P7 CONTROL', status: 'HEALTHY', observedAt: '2026-09-11T11:59:58.000Z', detail: 'PRODUCTION' }, { name: 'P6 EXECUTION', status: 'READY', detail: '0 active plans' }],
  events: [{ id: 'e1', observedAt: '2026-09-11T11:59:59.000Z', level: 'INFO', event: 'TS5_WATCH_ARMED', entityType: 'POSITION', entityId: 'position-address', status: 'SENT', message: 'Canonical protection watch armed.' }, { id: 'e2', observedAt: '2026-09-11T11:59:58.000Z', level: 'WARN', event: 'P6_EXECUTION_RECOVERY_PENDING', entityType: 'PLAN', entityId: 'plan-1', status: 'SENT', message: 'Recovery is being verified.' }]
});

test('shell terminal renders every required operational region without a portfolio dashboard', () => {
  const output = terminal.renderDecisionTerminal(snapshot(), { columns: 180, color: false, eventFilter: 'ALL', positionFilter: 'ALL' });
  for (const heading of ['LPFORGE DECISION TERMINAL', 'LIVE EVENT STREAM', 'DECISION TERMINAL', 'CANDIDATE PIPELINE', 'ENTRY WATCH POOLS', 'OPEN POSITIONS', 'AGENT / ENGINE DESK', 'FILLS / RECENT POSITIONS', 'SYSTEM HEALTH']) assert.match(output, new RegExp(heading));
  assert.match(output, /LIVE \+2\.40%/);
  assert.match(output, /LIVE PNL/);
  assert.match(output, /POSITION/);
  assert.match(output, /positi…ress/);
  assert.match(output, /TS5 WATCH/);
  assert.doesNotMatch(output, /portfolio|equity chart|order book/i);
});

test('shell terminal filters loaded events and position rows locally', () => {
  const source = snapshot();
  const execution = terminal.renderDecisionTerminal(source, { columns: 180, color: false, eventFilter: 'EXECUTION', positionFilter: 'CLOSED' });
  assert.match(execution, /P6_RECOVERY_PENDING/);
  assert.doesNotMatch(execution, /TS5_WATCH_ARMED/);
  assert.match(execution, /PROFIT_RETENTION_TS5_CONFIRMED/);
  assert.doesNotMatch(execution, /LIVE CONTROL MARK/);
});

test('header keeps P7 health, entry authority, recovery, watch pools, and RPC status distinct', () => {
  const source = snapshot();
  source.health = { ...source.health, newEconomicActionAllowed: false, recoveryQueueCount: 3, unknownSubmissionCount: 1 };
  const output = terminal.renderDecisionTerminal(source, { columns: 180, rows: 50, color: false, interactive: true });
  assert.match(output, /P7 HEALTHY/);
  assert.match(output, /SAFETY NORMAL/);
  assert.match(output, /ENTRY BLOCKED/);
  assert.match(output, /RECOVERY 3/);
  assert.match(output, /WATCH 1/);
  assert.match(output, /RPC 3\/3 HEALTHY/);
  assert.match(output, /q quit  h\/l candidate/);
});

test('candidate renderer preserves actual zero and renders unavailable values as an em dash', () => {
  const zero = snapshot();
  zero.candidates = [{ ...zero.candidates[0], lowerBinId: 0, upperBinId: 0, activeBinId: 0, confidence: 0, uncertainty: 0, oorRisk: 0, riskAdjustedExpectedNetEv: 0 }];
  const zeroOutput = terminal.renderDecisionTerminal(zero, { columns: 180, color: false });
  assert.match(zeroOutput, /RANGE     0 → 0/);
  assert.match(zeroOutput, /ACTIVE BIN 0/);
  assert.match(zeroOutput, /SCORE     0\.00/);
  assert.match(zeroOutput, /NET EV    \+0\.000000 SOL/);

  const unavailable = snapshot();
  unavailable.candidates = [{ ...unavailable.candidates[0], lowerBinId: undefined, upperBinId: undefined, activeBinId: undefined, confidence: undefined, uncertainty: undefined, oorRisk: undefined, riskAdjustedExpectedNetEv: undefined, predictedNetEv: undefined }];
  const unavailableOutput = terminal.renderDecisionTerminal(unavailable, { columns: 180, color: false });
  assert.match(unavailableOutput, /RANGE     —/);
  assert.match(unavailableOutput, /ACTIVE BIN —/);
  assert.match(unavailableOutput, /SCORE     —/);
  assert.match(unavailableOutput, /NET EV    —/);
  assert.doesNotMatch(unavailableOutput, /RANGE     0 → 0/);
  assert.doesNotMatch(unavailableOutput, /SCORE     \+?0\.00/);
});

test('event aliases are display-only and plain diagnostics retain canonical event identity', () => {
  const source = snapshot();
  assert.equal(terminal.displayEventCode('P6_EXECUTION_RECOVERY_PENDING'), 'P6_RECOVERY_PENDING');
  assert.equal(terminal.displayEventCode('UNRECOGNISED_EVENT'), 'UNRECOGNISED_EVENT');
  const visual = terminal.renderDecisionTerminal(source, { columns: 180, color: false });
  const diagnostic = terminal.renderDecisionTerminal(source, { columns: 180, color: false, showCanonicalEventCodes: true });
  assert.match(visual, /P6_RECOVERY_PENDING/);
  assert.doesNotMatch(visual, /P6_EXECUTION_RECOVERY_PENDING/);
  assert.match(diagnostic, /P6_EXECUTION_RECOVERY_PENDING/);
  assert.equal(source.events[1].event, 'P6_EXECUTION_RECOVERY_PENDING');
});

test('compact active-pool and empty states remain intentional', () => {
  const none = snapshot();
  none.activePools = [];
  none.recentPositions = [];
  none.candidates = [];
  none.events = [];
  const output = terminal.renderDecisionTerminal(none, { columns: 180, rows: 50, color: false });
  assert.match(output, /OPEN POSITIONS \(0\/2\)/);
  assert.match(output, /No open LP positions\./);
  assert.match(output, /No current canonical candidate cycle\./);
  assert.match(output, /No canonical events in the current bounded window\./);
  assert.match(output, /No matching canonical lifecycle\./);
});

test('wide, narrow, and phone dimensions do not exceed terminal width', () => {
  for (const [columns, rows] of [[180, 50], [160, 45], [140, 40], [120, 35], [80, 24], [60, 20], [40, 18]]) {
    const output = terminal.renderDecisionTerminal(snapshot(), { columns, rows, color: false, interactive: true });
    for (const rendered of output.split('\n')) assert.ok(rendered.length <= columns, `${columns} columns: ${rendered}`);
    if (columns < 100) assert.ok(output.split('\n').length <= rows, `${columns}x${rows}: too many rendered rows`);
  }
});

test('phone renderer uses a compact overview instead of squeezing the desktop grid', () => {
  const output = terminal.renderDecisionTerminal(snapshot(), { columns: 80, rows: 24, color: false, interactive: true, mobileView: 'OVERVIEW' });
  assert.match(output, /LPFORGE DECISION TERMINAL/);
  assert.match(output, /◎ DECISION 1\/1/);
  assert.match(output, /■ ENTRY WATCH \(1\)/);
  assert.match(output, /■ OPEN POSITIONS \(1\/2\)/);
  assert.match(output, /♥ SYSTEM HEALTH/);
  assert.match(output, /m activity/);
  assert.doesNotMatch(output, /┌|└|│/);
});

test('phone activity view keeps loaded events, fills, engines, and filters accessible', () => {
  const output = terminal.renderDecisionTerminal(snapshot(), { columns: 80, rows: 24, color: false, interactive: true, mobileView: 'ACTIVITY', eventFilter: 'EXECUTION', positionFilter: 'CLOSED' });
  assert.match(output, /● LIVE EVENTS EXECUTION/);
  assert.match(output, /P6_RECOVERY_PENDING/);
  assert.match(output, /▤ RECENT POSITIONS CLOSED/);
  assert.match(output, /OTHER\/SOL CLOSED -1\.37%/);
  assert.match(output, /⚙ ENGINE DESK/);
  assert.match(output, /m overview/);
  assert.equal(terminal.nextMobileView('OVERVIEW'), 'ACTIVITY');
  assert.equal(terminal.nextMobileView('ACTIVITY'), 'OVERVIEW');
});

test('phone health keeps an execution RPC outage visible without horizontal overflow', () => {
  const source = snapshot();
  source.health = { ...source.health, rpcHealth: [
    { role: 'PRODUCTION', state: 'HEALTHY' },
    { role: 'DISCOVERY', state: 'DEGRADED' },
    { role: 'EXECUTION', state: 'UNAVAILABLE' }
  ] };
  const output = terminal.renderDecisionTerminal(source, { columns: 40, rows: 18, color: false, interactive: true, mobileView: 'OVERVIEW' });
  assert.match(output, /RPC EXECUTION DOWN/);
  for (const rendered of output.split('\n')) assert.ok(rendered.length <= 40, rendered);
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
  assert.match(source, /SIGWINCH/);
  assert.match(source, /showCanonicalEventCodes: true/);
  assert.match(source, /io\.stdin\.pause\(\)/);
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

test('row number parsing does not turn nullable database evidence into a numeric zero', () => {
  const source = fs.readFileSync('apps/terminal/src/main.ts', 'utf8');
  assert.match(source, /raw === null \|\| raw === undefined \|\| raw === ''/);
  assert.doesNotMatch(source, /Number\(row\[key\]\)/);
});

test('terminal uses the exact persisted paired-token symbol for a WSOL pool and otherwise falls back', () => {
  const row = {
    pool_address: 'EAf6shtt8QGJ7UiSRrDc6pzwXKEmb5s7tCCpSDe5zpzZ',
    token_x_mint: 'TokenMint111111111111111111111111111111111111',
    token_y_mint: 'So11111111111111111111111111111111111111112',
    paired_token_mint: 'TokenMint111111111111111111111111111111111111',
    paired_token_symbol: 'CLANKER'
  };
  assert.equal(terminal.formatTerminalPoolDisplay(row), 'CLANKER/SOL');
  assert.equal(terminal.formatTerminalPoolDisplay({ ...row, paired_token_mint: 'different-mint' }), 'EAf6sh…zpzZ');
});

test('RPC health renders each logical role, preserves missing telemetry, and prioritizes execution down', () => {
  const source = snapshot();
  source.health = { ...source.health, rpcHealth: [
    { role: 'PRODUCTION', state: 'HEALTHY', latencyMs: 42, quotaState: 'OK' },
    { role: 'DISCOVERY', state: 'DEGRADED', quotaState: 'WARN' },
    { role: 'EXECUTION', state: 'UNAVAILABLE' }
  ] };
  const output = terminal.renderDecisionTerminal(source, { columns: 180, rows: 50, color: false });
  assert.match(output, /RPC EXECUTION DOWN/);
  assert.match(output, /RPC PRODUCTION.*HEALTHY.*42ms.*QUOTA OK/);
  assert.match(output, /RPC DISCOVERY.*DEGRADED.*—.*QUOTA WARN/);
  assert.match(output, /RPC EXECUTION.*UNAVAILABLE.*—.*QUOTA —/);
});

test('entry watch pools are a distinct display cohort and retain unavailable evidence as em dashes', () => {
  const source = snapshot();
  source.entryWatchPools = [
    { poolAddress: 'ready', poolDisplay: 'READY/SOL', operationalState: 'ENTRY_READY', phase4State: 'WAIT', rank: 4, confidence: .31, riskAdjustedExpectedNetEv: .00077, reasonCodes: ['AWAITING_P4_CONFIRMATION'], registryState: 'ACTIVE_CANDIDATE' },
    { poolAddress: 'warming', poolDisplay: 'WARM/SOL', operationalState: 'WARMING', phase4State: 'WARMING', rank: 1, reasonCodes: ['ENTRY_LIVE_CONFIRMATION_INSUFFICIENT_OBSERVATIONS'], registryState: 'ACTIVE_CANDIDATE' }
  ];
  const output = terminal.renderDecisionTerminal(source, { columns: 220, rows: 50, color: false });
  assert.match(output, /ENTRY WATCH POOLS \(2\)/);
  assert.match(output, /READY\/SOL.*ENTRY_READY.*0\.31.*\+0\.000770.*P4/);
  assert.match(output, /WARM\/SOL.*WARMING.*—.*—.*MORE DATA/);
  assert.ok(output.indexOf('READY/SOL') < output.indexOf('WARM/SOL'));
});

test('empty entry watch set remains intentional and has no fabricated observation progress', () => {
  const source = snapshot();
  source.entryWatchPools = [];
  const output = terminal.renderDecisionTerminal(source, { columns: 180, rows: 50, color: false });
  assert.match(output, /WATCH 0/);
  assert.match(output, /ENTRY WATCH POOLS \(0\)/);
  assert.match(output, /No actively monitored entry pools\./);
  assert.doesNotMatch(output, /0\/12/);
});

test('terminal read model uses existing bounded facts and never serializes RPC endpoints or credentials', () => {
  const source = fs.readFileSync('apps/terminal/src/main.ts', 'utf8');
  assert.match(source, /registry\.current_state='ACTIVE_CANDIDATE'/);
  assert.match(source, /rpc_provider_budget_state/);
  assert.match(source, /rpc_provider_metrics/);
  assert.doesNotMatch(source, /LPFORGE_P6_PRIVATE_WRITE_RPC_URL/);
  assert.doesNotMatch(source, /console\.log\(.*RPC_URL/);
  assert.doesNotMatch(source, /fetch\(/);
});
