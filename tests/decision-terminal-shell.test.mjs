import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const terminal = await import('../.build/apps/terminal/src/model.js');

const snapshot = () => ({
  generatedAt: '2026-09-11T12:00:00.000Z',
  runtime: { releaseSha: '0123456789abcdef0123456789abcdef01234567', policyVersion: 'live-v1', policyHash: 'a'.repeat(64), cluster: 'mainnet-beta', maxOpenPositions: 2, minimumIncludedBins: 60, maximumIncludedBins: 100 },
  health: { authorityMode: 'PRODUCTION', healthStatus: 'HEALTHY', safetyMode: 'NORMAL', daemonPlan: 'DECISION_CYCLE', newEconomicActionAllowed: true, entryControlReasonCodes: [], recoveryQueueCount: 0, unknownSubmissionCount: 0, activeManagementPlans: 0, partialEntryRecoveryCount: 0, activeIncidentCount: 0, telegramStatus: 'SENT', rpcHealth: [{ role: 'PRODUCTION', state: 'HEALTHY', latencyMs: 42, quotaState: 'OK', observedAt: '2026-09-11T11:59:59.000Z' }, { role: 'DISCOVERY', state: 'HEALTHY', quotaState: 'OK', observedAt: '2026-09-11T11:59:58.000Z' }, { role: 'EXECUTION', state: 'HEALTHY', quotaState: 'OK', observedAt: '2026-09-11T11:59:58.000Z' }] },
  candidates: [{ poolAddress: 'pool', poolDisplay: 'TOKEN/SOL', operationalState: 'ENTRY_READY', phase4State: 'ENTRY_READY', lowerBinId: -667, upperBinId: -595, activeBinId: -610, confidence: .92, uncertainty: .25, oorRisk: .11, riskAdjustedExpectedNetEv: .0012, reasonCodes: ['P4_READY'] }],
  entryWatchPools: [{ poolAddress: 'pool', poolDisplay: 'TOKEN/SOL', operationalState: 'ENTRY_READY', phase4State: 'ENTRY_READY', rank: 1, confidence: .92, riskAdjustedExpectedNetEv: .0012, reasonCodes: ['P4_READY'], registryState: 'ACTIVE_CANDIDATE' }],
  selectedCandidateIndex: 0,
  activePools: [{ lpforgePositionId: 'position-1', positionAddress: 'position-address', poolAddress: 'pool', poolDisplay: 'TOKEN/SOL', enteredAt: '2026-09-11T10:00:00.000Z', lifecycleState: 'OPEN', reconciliationStatus: 'MATCH', lowerBinId: -667, upperBinId: -595, activeBinId: -610, rangeState: 'IN_RANGE', liveControlReturnFraction: .024, liveControlPeakReturnFraction: .048, feeLamports: 113059n, protection: 'TS-5 WATCH' }],
  recentPositions: [{ lifecycleId: 'open:position-address', positionAddress: 'position-address', poolAddress: 'pool', poolDisplay: 'TOKEN/SOL', state: 'OPEN', observedAt: '2026-09-11T10:00:00.000Z', liveControlReturnFraction: .024, liveControlPeakReturnFraction: .048, holdSeconds: 7200, exitReason: 'LIVE CONTROL MARK', entryRange: '-667–-595', protectionUsed: 'TS-5 WATCH', lossClass: 'LIVE' }, { lifecycleId: 'closed:position-address', positionAddress: 'closed-position', poolAddress: 'pool2', poolDisplay: 'OTHER/SOL', state: 'CLOSED', observedAt: '2026-09-11T09:00:00.000Z', realizedReturnFraction: -.0137, realizedPnlLamports: -411000n, holdSeconds: 3600, exitReason: 'PROFIT_RETENTION_TS5_CONFIRMED', entryRange: '-344–-285', liveControlPeakReturnFraction: .0501, liveControlPeakGivebackFraction: .0638, protectionUsed: 'TS-5', lossClass: 'PROFIT GIVEBACK' }],
  dailyPerformance: { trades: 4, wins: 3, losses: 1, netPnlLamports: 18000000n, feeLamports: 4000000n, bestPool: 'pool', bestReturnFraction: .0304, worstPool: 'pool2', worstReturnFraction: -.1517 },
  engines: [{ name: 'P7 CONTROL', status: 'HEALTHY', observedAt: '2026-09-11T11:59:58.000Z', detail: 'PRODUCTION' }, { name: 'P6 EXECUTION', status: 'READY', detail: '0 active plans' }],
  events: [{ id: 'e1', observedAt: '2026-09-11T11:59:59.000Z', level: 'INFO', event: 'TS5_WATCH_ARMED', entityType: 'POSITION', entityId: 'position-address', status: 'SENT', message: 'Canonical protection watch armed.' }, { id: 'e2', observedAt: '2026-09-11T11:59:58.000Z', level: 'WARN', event: 'P6_EXECUTION_RECOVERY_PENDING', entityType: 'PLAN', entityId: 'plan-1', status: 'SENT', message: 'Recovery is being verified.' }]
});

test('shell terminal renders the operator-intelligence panels from bounded read-only facts', () => {
  const output = terminal.renderDecisionTerminal(snapshot(), { columns: 220, color: false, eventFilter: 'ALL', positionFilter: 'ALL' });
  for (const heading of ['LPFORGE DECISION TERMINAL', 'DECISION PIPELINE', 'CURRENT BLOCKER', 'ECONOMIC ENGINE', 'CANDIDATE PIPELINE', 'RANGE MONITOR', 'POSITION HEALTH', 'FILLS / RECENT POSITIONS', 'EVENT STREAM', 'TODAY', 'SYSTEM HEALTH']) assert.match(output, new RegExp(heading));
  assert.match(output, /ACTIVE POLICY 60–100 bins/);
  assert.match(output, /LIVE PEAK/);
  assert.match(output, /PEAK GAP/);
  assert.match(output, /STATUS/);
  assert.match(output, /TIME/);
  assert.match(output, /● LIVE/);
  assert.match(output, /✓ CLOSED/);
  assert.match(output, /Sep 11 10:00/);
  assert.match(output, /Sep 11 09:00/);
  assert.match(output, /\+2\.40%/);
  assert.match(output, /-1\.37%/);
  assert.doesNotMatch(output, /OPEN 10:00|CLOSED Sep 11 09:00|LIVE \+2\.40%|REALIZED -1\.37%/);
  assert.match(output, /PATH \/ RECORDED REASON/);
  assert.match(output, /TS-5/);
  assert.match(output, /NET PNL/);
  for (const field of ['P7 MODE', 'P7 HEALTH', 'SAFETY', 'NEW ENTRIES', 'RPC PRODUCTION', 'RPC DISCOVERY', 'RPC EXECUTION', 'RECOVERY QUEUE', 'UNKNOWN TX', 'ACTIVE PLANS', 'PARTIAL ENTRY', 'INCIDENTS', 'TELEGRAM', 'RELEASE SHA']) assert.match(output, new RegExp(field));
  assert.doesNotMatch(output, /portfolio|equity chart|order book/i);
});

test('desktop hierarchy expands Event Stream and moves compact Position Health below open positions', () => {
  const output = terminal.renderDecisionTerminal(snapshot(), { columns: 220, rows: 50, color: false });
  const event = output.indexOf('EVENT STREAM ALL');
  const decision = output.indexOf('DECISION PIPELINE');
  const open = output.lastIndexOf('OPEN POSITIONS');
  const health = output.indexOf('POSITION HEALTH');
  const system = output.indexOf('SYSTEM HEALTH');
  const fills = output.indexOf('FILLS / RECENT POSITIONS');

  assert.ok(event >= 0);
  assert.ok(decision > event, 'Decision Pipeline should follow the upper Event Stream row');
  assert.ok(open > decision, 'Open Positions should retain its own full-width row');
  assert.ok(health > open, 'Position Health should occupy the former lower Event Stream area');
  assert.ok(system > open && system < fills, 'System Health should occupy the lower-left Position Health slot');
  assert.match(output, /DISCOVERED 1\s+FILTERED 1\s+WATCHING 1/);
  assert.match(output, /BELOW_MIN 0\s+ABOVE_MAX 0/);
});

test('top status uses operator wording while the event stream retains the raw PnL status', () => {
  const source = snapshot();
  source.events = [{ ...source.events[0], event: 'POSITION_LIVE_CONTROL_PNL_UNAVAILABLE' }];
  const output = terminal.renderDecisionTerminal(source, { columns: 220, rows: 50, color: false, showCanonicalEventCodes: true });
  assert.match(output, /LAST ACTION WAITING - LIVE PNL REFRESH/);
  assert.match(output, /POSITION_LIVE_CONTROL_PNL/);
});

test('shell terminal filters loaded events and position rows locally', () => {
  const source = snapshot();
  const execution = terminal.renderDecisionTerminal(source, { columns: 180, color: false, eventFilter: 'RISK', positionFilter: 'CLOSED' });
  assert.match(execution, /EVENT STREAM RISK/);
  assert.match(execution, /PROFIT GIVEBACK/);
  assert.doesNotMatch(execution, /LIVE CONTROL MARK/);
});

test('recent-position ordering always keeps live positions before newer settled fills', () => {
  const source = snapshot();
  const live = source.recentPositions[0];
  const closed = source.recentPositions[1];
  const newerClosed = { ...closed, lifecycleId: 'closed:newer', observedAt: '2026-09-11T12:30:00.000Z' };
  const ordered = terminal.orderTerminalRecentPositions([newerClosed, live, closed]);

  assert.deepEqual(ordered.map(position => position.lifecycleId), [live.lifecycleId, newerClosed.lifecycleId, closed.lifecycleId]);
  assert.deepEqual(source.recentPositions.map(position => position.lifecycleId), [live.lifecycleId, closed.lifecycleId]);
});

test('fills explicitly labels lifecycle status and preserves the live-versus-realized return authority', () => {
  const output = terminal.renderDecisionTerminal(snapshot(), { columns: 220, rows: 50, color: false, positionFilter: 'ALL' });
  const live = output.indexOf('● LIVE');
  const closed = output.indexOf('✓ CLOSED');

  assert.ok(live >= 0 && closed > live, 'active lifecycles must render before settled history');
  assert.match(output, /STATUS/);
  assert.match(output, /TIME/);
  assert.match(output, /Sep 11 10:00/);
  assert.match(output, /Sep 11 09:00/);
  assert.match(output, /\+2\.40%/);
  assert.match(output, /-1\.37%/);
  assert.doesNotMatch(output, /OPEN 10:00|CLOSED Sep 11 09:00|LIVE \+2\.40%|REALIZED -1\.37%/);
  assert.match(output, /TS-5 WATCH/);
  assert.match(output, /PROFIT GIVEBACK \/ TS-5/);
});

test('fills highlight every negative return and settled positive outcomes as rows', () => {
  const source = snapshot();
  source.recentPositions[0] = { ...source.recentPositions[0], liveControlReturnFraction: -.024 };
  source.recentPositions.push({
    ...source.recentPositions[1], lifecycleId: 'closed:winner', poolDisplay: 'WINNER/SOL',
    observedAt: '2026-09-11T08:00:00.000Z', realizedReturnFraction: .024
  });
  const output = terminal.renderDecisionTerminal(source, { columns: 220, rows: 50, color: true, positionFilter: 'ALL' });
  const lines = output.split('\n');
  const live = lines.find(line => line.includes('TOKEN/SOL'));
  const loss = lines.find(line => line.includes('OTHER/SOL'));
  const winner = lines.find(line => line.includes('WINNER/SOL'));
  const red = '\u001b[1;91m';
  const green = '\u001b[38;5;84m';

  assert.ok(live && loss && winner);
  assert.ok(live.indexOf(red) < live.indexOf('TOKEN/SOL'), 'negative live row is red from its start');
  assert.ok(loss.indexOf(red) < loss.indexOf('OTHER/SOL'), 'negative settled row is red from its start');
  assert.ok(winner.indexOf(green) < winner.indexOf('WINNER/SOL'), 'positive settled row is green from its start');

  const narrowOutput = terminal.renderDecisionTerminal(source, { columns: 160, rows: 50, color: true, positionFilter: 'ALL' });
  const narrowLoss = narrowOutput.split('\n').find(line => line.includes('OTHER/SOL'));
  assert.ok(narrowLoss && narrowLoss.indexOf(red) < narrowLoss.indexOf('OTHER/SOL'), 'a clipped negative row preserves its red styling');
});

test('top status and current blocker keep entry authority, safety, watch pools, and RPC distinct', () => {
  const source = snapshot();
  source.health = { ...source.health, newEconomicActionAllowed: false, entryControlReasonCodes: ['P7_PORTFOLIO_DAILY_DRAWDOWN'], recoveryQueueCount: 3, unknownSubmissionCount: 1 };
  const output = terminal.renderDecisionTerminal(source, { columns: 180, rows: 50, color: false, interactive: true });
  assert.match(output, /MODE PRODUCTION/);
  assert.match(output, /SAFETY NORMAL/);
  assert.match(output, /ENTRY DISABLED/);
  assert.match(output, /DAILY DRAWDOWN LIMIT/);
  assert.match(output, /WATCH POOLS 1/);
  assert.match(output, /RPC 3\/3 HEALTHY/);
  assert.match(output, /q quit  h\/l candidate/);
});

test('header explains an entry block caused by the open-position limit', () => {
  const source = snapshot();
  source.health = { ...source.health, newEconomicActionAllowed: false, entryControlReasonCodes: ['P7_PORTFOLIO_POSITION_LIMIT'] };
  const output = terminal.renderDecisionTerminal(source, { columns: 180, rows: 50, color: false, interactive: true });
  assert.match(output, /POSITION CAP REACHED/);
});

test('decision pipeline preserves actual zero and renders unavailable values as an em dash', () => {
  const zero = snapshot();
  zero.candidates = [{ ...zero.candidates[0], lowerBinId: 0, upperBinId: 0, activeBinId: 0, confidence: 0, uncertainty: 0, oorRisk: 0, riskAdjustedExpectedNetEv: 0 }];
  const zeroOutput = terminal.renderDecisionTerminal(zero, { columns: 180, color: false });
  assert.match(zeroOutput, /SCORE \/ UNCERTAINTY 0\.00 \/ 0\.00/);
  assert.match(zeroOutput, /NET EV\s+\+0\.000000 SOL/);

  const unavailable = snapshot();
  unavailable.candidates = [{ ...unavailable.candidates[0], lowerBinId: undefined, upperBinId: undefined, activeBinId: undefined, confidence: undefined, uncertainty: undefined, oorRisk: undefined, riskAdjustedExpectedNetEv: undefined, predictedNetEv: undefined }];
  const unavailableOutput = terminal.renderDecisionTerminal(unavailable, { columns: 180, color: false });
  assert.match(unavailableOutput, /SCORE \/ UNCERTAINTY — \/ —/);
  assert.match(unavailableOutput, /NET EV\s+—/);
  assert.doesNotMatch(unavailableOutput, /SCORE \/ UNCERTAINTY \+?0\.00/);
});

test('terminal hides the deliberate global-selection collection-pass marker but preserves raw canonical reasons', () => {
  const source = snapshot();
  source.candidates = [{
    ...source.candidates[0],
    reasonCodes: ['OPERATIONAL_PLAN_DISPATCH_DISABLED', 'ENTRY_LIVE_CONFIRMATION_PENDING']
  }];
  source.entryWatchPools = [{
    ...source.entryWatchPools[0],
    reasonCodes: ['OPERATIONAL_PLAN_DISPATCH_DISABLED']
  }];
  const output = terminal.renderDecisionTerminal(source, { columns: 180, rows: 50, color: false });

  assert.deepEqual(source.candidates[0].reasonCodes, ['OPERATIONAL_PLAN_DISPATCH_DISABLED', 'ENTRY_LIVE_CONFIRMATION_PENDING']);
  assert.deepEqual(terminal.operatorVisibleCandidateReasonCodes(source.candidates[0]), ['ENTRY_LIVE_CONFIRMATION_PENDING']);
  assert.match(output, /ENTRY_LIVE_CONFIRMATION_PENDING/);
  assert.doesNotMatch(output, /OPERATIONAL_PLAN_DISPATCH_DISABLED/);
  assert.match(output, /Live confirmation window is still incomplete\./);
});

test('event aliases are display-only and plain diagnostics retain canonical event identity', () => {
  const source = snapshot();
  assert.equal(terminal.displayEventCode('P6_EXECUTION_RECOVERY_PENDING'), '[RECOVERY] verifying previous execution');
  assert.equal(terminal.displayEventCode('UNRECOGNISED_EVENT'), 'UNRECOGNISED_EVENT');
  const visual = terminal.renderDecisionTerminal(source, { columns: 220, color: false });
  const diagnostic = terminal.renderDecisionTerminal(source, { columns: 220, color: false, showCanonicalEventCodes: true });
  assert.match(visual, /EVENT STREAM ALL/);
  assert.match(visual, /EVENT STREAM ALL/);
  assert.match(diagnostic, /P6_EXECUTION_RECOVERY/);
  assert.equal(source.events[1].event, 'P6_EXECUTION_RECOVERY_PENDING');
});

test('compact active-pool and empty states remain intentional', () => {
  const none = snapshot();
  none.activePools = [];
  none.recentPositions = [];
  none.candidates = [];
  none.events = [];
  const output = terminal.renderDecisionTerminal(none, { columns: 180, rows: 50, color: false });
  assert.match(output, /OPEN POSITIONS 0\/2/);
  assert.match(output, /OPEN POSITIONS 0\/2/);
  assert.match(output, /No canonical events in the current bounded window\./);
  assert.match(output, /No matching canonical lifecycle\./);
});

test('open positions use one full-width row per active position with derived edge distances', () => {
  const source = snapshot();
  source.activePools.push({
    ...source.activePools[0],
    lpforgePositionId: 'position-2', positionAddress: 'position-address-2', poolAddress: 'pool-2', poolDisplay: 'SECOND/SOL',
    lowerBinId: -720, upperBinId: -660, activeBinId: -718, rangeState: 'LOWER_EDGE', liveControlReturnFraction: -.081, protection: 'HARD STOP ACTIVE'
  });
  const output = terminal.renderDecisionTerminal(source, { columns: 220, rows: 50, color: false });
  assert.match(output, /OPEN POSITIONS \(2\/2\)/);
  assert.match(output, /CURRENT BIN/);
  assert.match(output, /DIST TO LOWER \/ UPPER/);
  assert.match(output, /TOKEN\/SOL/);
  assert.match(output, /SECOND\/SOL/);
  assert.match(output, /L 57 \/ U 15/);
  assert.match(output, /L 2 \/ U 58/);
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
  assert.match(output, /◎ DECISION PIPELINE/);
  assert.match(output, /CURRENT BLOCKER/);
  assert.match(output, /WATCH 1/);
  assert.match(output, /POS 1\/2/);
  assert.match(output, /m activity/);
  assert.doesNotMatch(output, /┌|└|│/);
});

test('phone activity view keeps loaded events, fills, engines, and filters accessible', () => {
  const output = terminal.renderDecisionTerminal(snapshot(), { columns: 80, rows: 24, color: false, interactive: true, mobileView: 'ACTIVITY', eventFilter: 'RISK', positionFilter: 'CLOSED' });
  assert.match(output, /● LIVE EVENTS RISK/);
  assert.match(output, /verifying previous execution/);
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
  assert.equal(terminal.nextEventFilter('ALL'), 'DECISIONS');
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

test('open and closed terminal peaks use Meteora-compatible live-control fields, never managed NAV', () => {
  const source = fs.readFileSync('apps/terminal/src/main.ts', 'utf8');
  assert.match(source, /lp_mtm_evidence_state AS live_control_state/);
  assert.match(source, /lp_mtm_net_return_fraction AS live_control_return_fraction/);
  assert.match(source, /lp_mtm_peak_return_fraction AS live_control_peak_return_fraction/);
  assert.doesNotMatch(source, /es\.net_return_fraction AS live_control_return_fraction/);
  assert.match(source, /es\.lp_mtm_peak_return_fraction AS live_control_peak_return_fraction/);
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
  assert.match(output, /RPC DISCOVERY.*DEGRADED/);
  assert.match(output, /RPC EXECUTION.*UNAVAILABLE/);
});

test('entry watch pools are a distinct display cohort and retain unavailable evidence as em dashes', () => {
  const source = snapshot();
  source.entryWatchPools = [
    { poolAddress: 'ready', poolDisplay: 'READY/SOL', operationalState: 'ENTRY_READY', phase4State: 'WAIT', rank: 4, confidence: .31, riskAdjustedExpectedNetEv: .00077, reasonCodes: ['AWAITING_P4_CONFIRMATION'], registryState: 'ACTIVE_CANDIDATE' },
    { poolAddress: 'warming', poolDisplay: 'WARM/SOL', operationalState: 'WARMING', phase4State: 'WARMING', rank: 1, reasonCodes: ['ENTRY_LIVE_CONFIRMATION_INSUFFICIENT_OBSERVATIONS'], registryState: 'ACTIVE_CANDIDATE' }
  ];
  const output = terminal.renderDecisionTerminal(source, { columns: 220, rows: 50, color: false });
  assert.match(output, /WATCHING\s+2/);
  assert.match(output, /CANDIDATE PIPELINE/);
});

test('empty entry watch set remains intentional and has no fabricated observation progress', () => {
  const source = snapshot();
  source.entryWatchPools = [];
  const output = terminal.renderDecisionTerminal(source, { columns: 180, rows: 50, color: false });
  assert.match(output, /WATCH POOLS 0/);
  assert.match(output, /WATCHING\s+0/);
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
