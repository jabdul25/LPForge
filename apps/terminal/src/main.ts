/**
 * LPForge Decision Terminal is deliberately a shell-native, read-only
 * observer.  It owns no policy, signer, transaction, execution, or recovery
 * authority.  Every refresh reads bounded durable facts and renders them to
 * the attached TTY only.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { loadPhase1Config } from '../../../packages/config/src/index.js';
import {
  advanceCandidateIndex,
  nextEventFilter,
  nextPositionFilter,
  renderDecisionTerminal,
  type TerminalCandidate,
  type TerminalEngine,
  type TerminalEvent,
  type TerminalHealth,
  type TerminalPosition,
  type TerminalRecentPosition,
  type TerminalRuntime,
  type TerminalSnapshot
} from './model.js';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const OPEN_POSITION_STATES = ['OPEN', 'CLOSING', 'RECONCILIATION_REQUIRED', 'ENTRY_FUNDED_NOT_OPEN'];
const ACTIVE_PLAN_STATES = ['PLANNED', 'CLAIMED', 'DISPATCHING', 'BUILDING', 'BUILT', 'SIMULATING', 'SIMULATED', 'RISK_APPROVED', 'SIGNING', 'SIGNED', 'SUBMITTING', 'SUBMITTED', 'UNKNOWN_SUBMISSION', 'CONFIRMED', 'RECONCILING', 'RECOVERING', 'RECONCILIATION_REQUIRED'];
const PARTIAL_TERMINAL_STATES = ['RESOLVED', 'OPEN_RECOVERED', 'SUPERSEDED_BY_SUCCESSFUL_ENTRY', 'ABORTED_SOL_SETTLED'];

type Row = Record<string, unknown>;
type Manifest = { sourceCommit?: unknown; policyHash?: unknown };
type RuntimePolicy = { policyVersion?: unknown; version?: unknown; policyId?: unknown };
type TerminalIo = {
  stdin: { isTTY?: boolean; setRawMode(enabled: boolean): void; resume(): void; setEncoding(encoding: string): void; on(event: 'data', listener: (value: string) => void): void };
  stdout: { isTTY?: boolean; columns?: number; write(value: string): void };
  stderr: { write(value: string): void };
  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): void;
};
const io = process as unknown as TerminalIo;

const text = (row: Row, key: string): string | undefined => {
  const value = row[key];
  return value === null || value === undefined ? undefined : String(value);
};
const number = (row: Row, key: string): number | undefined => {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : undefined;
};
const integer = (row: Row, key: string): number | undefined => {
  const value = number(row, key);
  return value !== undefined && Number.isInteger(value) ? value : undefined;
};
const lamports = (row: Row, key: string): bigint | undefined => {
  const value = row[key];
  if (value === null || value === undefined || value === '') return undefined;
  try { return BigInt(String(value)); } catch { return undefined; }
};
const iso = (value: unknown): string | undefined => {
  const at = new Date(String(value ?? '')).getTime();
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
};
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const short = (value: string): string => value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
const displayPool = (row: Row): string => {
  const pool = text(row, 'pool_address') || 'unknown';
  const xMint = text(row, 'token_x_mint');
  const yMint = text(row, 'token_y_mint');
  const x = xMint === WSOL_MINT ? 'SOL' : text(row, 'token_x_symbol');
  const y = yMint === WSOL_MINT ? 'SOL' : text(row, 'token_y_symbol');
  return x && y ? `${x}/${y}` : short(pool);
};

function terminalProtection(row: Row): string {
  const reasons = strings(row.last_reason_codes);
  if (reasons.includes('PROFIT_RETENTION_TS5_CONFIRMED')) return 'TS5 CONFIRMED';
  if (reasons.includes('PROFIT_RETENTION_OOR_P4_CONFIRMED')) return 'OOR-P4 CONFIRMED';
  const payload = record(row.exit_payload);
  const assessment = record(payload.profitRetentionAssessment);
  if (assessment.kind === 'TS5_PROTECTION_CONFIRMED') return 'TS5 CONFIRMED';
  if (assessment.kind === 'OOR_P4_PROTECTION_CONFIRMED') return 'OOR-P4 CONFIRMED';
  const watch = record(payload.profitRetentionWatch);
  if (watch.state === 'WATCH_ARMED') return 'TS5 WATCH';
  if (text(row, 'oor_direction') === 'BELOW_MIN') return 'BELOW_MIN';
  if (text(row, 'inventory_classification') === 'SAFE_OOR_SOL') return 'SAFE OOR';
  if (text(row, 'oor_lifecycle_state') && text(row, 'oor_lifecycle_state') !== 'IN_RANGE') return text(row, 'oor_lifecycle_state') || 'OOR';
  return 'NONE';
}

function alertLevel(value: string | undefined): TerminalEvent['level'] {
  return value === 'CRITICAL' ? 'ERROR' : value === 'WARNING' ? 'WARN' : 'INFO';
}
function alertMessage(row: Row): string | undefined {
  const payload = record(row.payload);
  const direct = payload.message ?? payload.title;
  if (typeof direct === 'string' && direct.trim()) return direct.replace(/\s+/g, ' ').trim();
  const reason = strings(payload.reasonCodes)[0];
  return reason || undefined;
}

function readRuntime(): TerminalRuntime {
  let manifest: Manifest = {};
  let policy: RuntimePolicy = {};
  try { manifest = JSON.parse(readFileSync('RELEASE_MANIFEST.json', 'utf8')) as Manifest; } catch { /* development invocation */ }
  const policyPath = process.env.LPFORGE_EXECUTION_POLICY_PATH;
  let policyHash: string | undefined;
  if (policyPath) {
    try {
      const policyText = readFileSync(policyPath, 'utf8');
      policyHash = createHash('sha256').update(policyText).digest('hex');
      policy = JSON.parse(policyText) as RuntimePolicy;
    } catch { /* read-only terminal degrades to n/a */ }
  }
  const maxOpen = Number(process.env.LPFORGE_MAX_OPEN_POSITIONS ?? 2);
  return {
    ...(typeof manifest.sourceCommit === 'string' ? { releaseSha: manifest.sourceCommit } : {}),
    ...(typeof policy.policyVersion === 'string' ? { policyVersion: policy.policyVersion } : typeof policy.version === 'string' ? { policyVersion: policy.version } : typeof policy.policyId === 'string' ? { policyVersion: policy.policyId } : {}),
    ...(policyHash ? { policyHash } : typeof manifest.policyHash === 'string' ? { policyHash: manifest.policyHash } : {}),
    cluster: (process.env.LPFORGE_CLUSTER ?? 'mainnet-beta').trim(),
    ...(Number.isInteger(maxOpen) && maxOpen > 0 ? { maxOpenPositions: maxOpen } : {})
  };
}

async function loadCandidates(pool: Pool): Promise<TerminalCandidate[]> {
  const result = await pool.query<Row>(`
    WITH latest AS (
      SELECT global_cycle_id,winner_pool_address
      FROM execution.production_global_selection_cycles
      ORDER BY completed_at DESC,decision_cutoff DESC
      LIMIT 1
    )
    SELECT c.*,p.token_x_mint,p.token_y_mint,tx.symbol AS token_x_symbol,ty.symbol AS token_y_symbol,
      latest.winner_pool_address
    FROM latest
    JOIN execution.production_global_candidates c ON c.global_cycle_id=latest.global_cycle_id
    LEFT JOIN protocol.pools p ON p.address=c.pool_address
    LEFT JOIN protocol.tokens tx ON tx.mint=p.token_x_mint
    LEFT JOIN protocol.tokens ty ON ty.mint=p.token_y_mint
    ORDER BY CASE WHEN c.pool_address=latest.winner_pool_address THEN 0 WHEN c.operational_state='ENTRY_READY' THEN 1 WHEN c.operational_state='WARMING' THEN 2 ELSE 3 END,
      c.confidence DESC NULLS LAST,c.pool_address ASC
  `);
  return result.rows.map(row => ({
    poolAddress: text(row, 'pool_address') || 'unknown', poolDisplay: displayPool(row), operationalState: text(row, 'operational_state') || 'UNKNOWN', phase4State: text(row, 'phase4_state') || 'UNKNOWN',
    ...(text(row, 'candidate_id') ? { candidateId: text(row, 'candidate_id') } : {}), ...(text(row, 'strategy') ? { strategy: text(row, 'strategy') } : {}), ...(text(row, 'orientation') ? { orientation: text(row, 'orientation') } : {}),
    ...(integer(row, 'lower_bin_id') !== undefined ? { lowerBinId: integer(row, 'lower_bin_id') } : {}), ...(integer(row, 'upper_bin_id') !== undefined ? { upperBinId: integer(row, 'upper_bin_id') } : {}), ...(integer(row, 'active_bin_id') !== undefined ? { activeBinId: integer(row, 'active_bin_id') } : {}),
    ...(number(row, 'predicted_gross_fees') !== undefined ? { predictedGrossFees: number(row, 'predicted_gross_fees') } : {}), ...(number(row, 'predicted_net_ev') !== undefined ? { predictedNetEv: number(row, 'predicted_net_ev') } : {}), ...(number(row, 'risk_adjusted_expected_net_ev') !== undefined ? { riskAdjustedExpectedNetEv: number(row, 'risk_adjusted_expected_net_ev') } : {}), ...(number(row, 'uncertainty') !== undefined ? { uncertainty: number(row, 'uncertainty') } : {}), ...(number(row, 'confidence') !== undefined ? { confidence: number(row, 'confidence') } : {}), ...(number(row, 'oor_risk') !== undefined ? { oorRisk: number(row, 'oor_risk') } : {}),
    reasonCodes: strings(row.reason_codes)
  }));
}

async function loadActivePools(pool: Pool): Promise<TerminalPosition[]> {
  const result = await pool.query<Row>(`
    SELECT p.lpforge_position_id,p.position_address,p.pool_address,p.entered_at,p.lifecycle_state,p.reconciliation_status,p.lower_bin_id,p.upper_bin_id,
      tx.symbol AS token_x_symbol,ty.symbol AS token_y_symbol,proto.token_x_mint,proto.token_y_mint,
      obs.active_bin_id,obs.range_state,es.evidence_state AS valuation_state,
      es.lp_mtm_evidence_state AS live_control_state,
      es.lp_mtm_net_return_fraction AS live_control_return_fraction,
      es.lp_mtm_peak_return_fraction AS live_control_peak_return_fraction,
      es.last_reason_codes,es.payload AS exit_payload,
      oor.lifecycle_state AS oor_lifecycle_state,oor.direction AS oor_direction,oor.inventory_classification,oor.fee_value_lamports
    FROM execution.owned_positions p
    LEFT JOIN protocol.pools proto ON proto.address=p.pool_address
    LEFT JOIN protocol.tokens tx ON tx.mint=proto.token_x_mint
    LEFT JOIN protocol.tokens ty ON ty.mint=proto.token_y_mint
    LEFT JOIN LATERAL (
      SELECT active_bin_id,range_state FROM execution.position_observations
      WHERE lpforge_position_id=p.lpforge_position_id ORDER BY observed_at DESC LIMIT 1
    ) obs ON true
    LEFT JOIN execution.position_exit_state es ON es.lpforge_position_id=p.lpforge_position_id
    LEFT JOIN execution.position_oor_lifecycle_state oor ON oor.position_address=p.position_address
    WHERE p.lifecycle_state=ANY($1::text[])
    ORDER BY p.entered_at ASC
  `, [OPEN_POSITION_STATES]);
  return result.rows.map(row => {
    const liveControlAvailable = text(row, 'live_control_state') === 'AVAILABLE';
    const enteredAt = iso(row.entered_at) || new Date(0).toISOString();
    return {
      lpforgePositionId: text(row, 'lpforge_position_id') || 'unknown', positionAddress: text(row, 'position_address') || 'unknown', poolAddress: text(row, 'pool_address') || 'unknown', poolDisplay: displayPool(row), enteredAt,
      lifecycleState: text(row, 'lifecycle_state') || 'UNKNOWN', reconciliationStatus: text(row, 'reconciliation_status') || 'UNKNOWN',
      ...(integer(row, 'lower_bin_id') !== undefined ? { lowerBinId: integer(row, 'lower_bin_id') } : {}), ...(integer(row, 'upper_bin_id') !== undefined ? { upperBinId: integer(row, 'upper_bin_id') } : {}), ...(integer(row, 'active_bin_id') !== undefined ? { activeBinId: integer(row, 'active_bin_id') } : {}), ...(text(row, 'range_state') ? { rangeState: text(row, 'range_state') } : {}),
      ...(liveControlAvailable && number(row, 'live_control_return_fraction') !== undefined ? { liveControlReturnFraction: number(row, 'live_control_return_fraction') } : {}), ...(liveControlAvailable && number(row, 'live_control_peak_return_fraction') !== undefined ? { liveControlPeakReturnFraction: number(row, 'live_control_peak_return_fraction') } : {}), ...(lamports(row, 'fee_value_lamports') !== undefined ? { feeLamports: lamports(row, 'fee_value_lamports') } : {}),
      ...(text(row, 'valuation_state') ? { valuationState: text(row, 'valuation_state') } : {}), ...(text(row, 'oor_lifecycle_state') ? { oorLifecycleState: text(row, 'oor_lifecycle_state') } : {}), ...(text(row, 'oor_direction') ? { oorDirection: text(row, 'oor_direction') } : {}), ...(text(row, 'inventory_classification') ? { inventoryClassification: text(row, 'inventory_classification') } : {}), protection: terminalProtection(row)
    };
  });
}

async function loadRecentPositions(pool: Pool, active: TerminalPosition[]): Promise<TerminalRecentPosition[]> {
  const settled = await pool.query<Row>(`
    WITH latest AS (
      SELECT DISTINCT ON (lifecycle_id) lifecycle_id,position_address,pool_address,realized_sol_pnl_lamports,settled_at
      FROM execution.lifecycle_sol_settlements ORDER BY lifecycle_id,settlement_version DESC
    )
    SELECT l.lifecycle_id,l.position_address,l.pool_address,l.created_at,latest.settled_at,latest.realized_sol_pnl_lamports,
      COALESCE(re.entry_capital_lamports,o.initial_capital_lamports) AS capital_lamports,
      re.gross_lp_fee_lamports,COALESCE(summary.terminal_reason,re.close_reason) AS exit_reason,
      p.token_x_mint,p.token_y_mint,tx.symbol AS token_x_symbol,ty.symbol AS token_y_symbol
    FROM latest
    JOIN execution.position_lifecycles l ON l.lifecycle_id=latest.lifecycle_id AND l.status='SOL_SETTLED'
    LEFT JOIN execution.owned_positions o ON o.position_address=l.position_address
    LEFT JOIN execution.position_realized_economics re ON re.lifecycle_id=l.lifecycle_id
    LEFT JOIN execution.position_management_summaries summary ON summary.lifecycle_id=l.lifecycle_id
    LEFT JOIN protocol.pools p ON p.address=l.pool_address
    LEFT JOIN protocol.tokens tx ON tx.mint=p.token_x_mint
    LEFT JOIN protocol.tokens ty ON ty.mint=p.token_y_mint
    ORDER BY latest.settled_at DESC LIMIT 12
  `);
  const closed = settled.rows.map(row => {
    const value = lamports(row, 'realized_sol_pnl_lamports');
    const capital = lamports(row, 'capital_lamports');
    const openedAt = iso(row.created_at);
    const settledAt = iso(row.settled_at) || new Date(0).toISOString();
    return {
      lifecycleId: text(row, 'lifecycle_id') || 'unknown', positionAddress: text(row, 'position_address') || 'unknown', poolAddress: text(row, 'pool_address') || 'unknown', poolDisplay: displayPool(row), state: 'CLOSED' as const, observedAt: settledAt,
      ...(value !== undefined && capital !== undefined && capital > 0n ? { realizedReturnFraction: Number(value) / Number(capital) } : {}), ...(lamports(row, 'gross_lp_fee_lamports') !== undefined ? { feeLamports: lamports(row, 'gross_lp_fee_lamports') } : {}), ...(openedAt ? { holdSeconds: Math.max(0, Math.floor((Date.parse(settledAt) - Date.parse(openedAt)) / 1000)) } : {}), ...(text(row, 'exit_reason') ? { exitReason: text(row, 'exit_reason') } : {})
    };
  });
  const open = active.map(position => ({
    lifecycleId: `open:${position.positionAddress}`, positionAddress: position.positionAddress, poolAddress: position.poolAddress, poolDisplay: position.poolDisplay, state: 'OPEN' as const, observedAt: position.enteredAt,
    ...(position.liveControlReturnFraction !== undefined ? { liveControlReturnFraction: position.liveControlReturnFraction } : {}), ...(position.feeLamports !== undefined ? { feeLamports: position.feeLamports } : {}), holdSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(position.enteredAt)) / 1000)), exitReason: 'LIVE CONTROL MARK'
  }));
  return [...open, ...closed].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)).slice(0, 12);
}

async function loadEvents(pool: Pool): Promise<TerminalEvent[]> {
  const result = await pool.query<Row>(`
    SELECT alert_id,observed_at,severity,code,entity_type,entity_id,status,payload
    FROM execution.phase7_telegram_alert_outbox
    ORDER BY observed_at DESC,created_at DESC LIMIT 100
  `);
  return result.rows.map(row => ({
    id: text(row, 'alert_id') || 'unknown', observedAt: iso(row.observed_at) || new Date(0).toISOString(), level: alertLevel(text(row, 'severity')), event: text(row, 'code') || 'UNKNOWN', entityType: text(row, 'entity_type') || 'RUNTIME', entityId: text(row, 'entity_id') || 'unknown', status: text(row, 'status') || 'UNKNOWN', ...(alertMessage(row) ? { message: alertMessage(row) } : {})
  }));
}

async function loadHealth(pool: Pool, runtimeId: string): Promise<{ health: TerminalHealth; engines: TerminalEngine[] }> {
  const result = await pool.query<Row>(`
    SELECT
      (SELECT observed_at FROM operations.phase7_control_decisions WHERE runtime_id=$1 ORDER BY observed_at DESC LIMIT 1) AS control_observed_at,
      (SELECT authority_mode FROM operations.phase7_control_decisions WHERE runtime_id=$1 ORDER BY observed_at DESC LIMIT 1) AS authority_mode,
      (SELECT health_status FROM operations.phase7_control_decisions WHERE runtime_id=$1 ORDER BY observed_at DESC LIMIT 1) AS health_status,
      (SELECT safety_mode FROM operations.phase7_control_decisions WHERE runtime_id=$1 ORDER BY observed_at DESC LIMIT 1) AS safety_mode,
      (SELECT daemon_plan FROM operations.phase7_control_decisions WHERE runtime_id=$1 ORDER BY observed_at DESC LIMIT 1) AS daemon_plan,
      (SELECT new_economic_action_allowed FROM operations.phase7_control_decisions WHERE runtime_id=$1 ORDER BY observed_at DESC LIMIT 1) AS new_economic_action_allowed,
      (SELECT count(*)::int FROM execution.execution_journal WHERE state IN ('SIGNED','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED','RECONCILIATION_REQUIRED')) AS recovery_queue,
      (SELECT count(*)::int FROM execution.execution_journal WHERE state='UNKNOWN_SUBMISSION') AS unknown_journal,
      (SELECT max(updated_at) FROM execution.execution_journal WHERE state IN ('SIGNED','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED','RECONCILIATION_REQUIRED')) AS p6_observed_at,
      (SELECT count(*)::int FROM execution.transaction_plans WHERE state=ANY($2::text[])) AS active_plans,
      (SELECT count(*)::int FROM execution.partial_entry_recovery WHERE state<>ALL($3::text[])) AS partial_entry_count,
      (SELECT count(*)::int FROM operations.phase7_incident_states WHERE status IN ('OPEN','ACKNOWLEDGED')) AS incident_count,
      (SELECT status FROM execution.phase7_telegram_alert_outbox ORDER BY updated_at DESC LIMIT 1) AS telegram_status,
      (SELECT observed_at FROM execution.phase7_telegram_alert_outbox ORDER BY updated_at DESC LIMIT 1) AS telegram_observed_at,
      (SELECT completed_at FROM execution.production_global_selection_cycles ORDER BY completed_at DESC LIMIT 1) AS candidate_completed_at,
      (SELECT outcome FROM execution.production_global_selection_cycles ORDER BY completed_at DESC LIMIT 1) AS candidate_outcome,
      (SELECT settled_at FROM execution.lifecycle_sol_settlements ORDER BY settled_at DESC LIMIT 1) AS settlement_observed_at
  `, [runtimeId, ACTIVE_PLAN_STATES, PARTIAL_TERMINAL_STATES]);
  const c = result.rows[0] || {};
  const recoveryQueue = integer(c, 'recovery_queue') || 0;
  const unknown = integer(c, 'unknown_journal') || 0;
  const activePlans = integer(c, 'active_plans') || 0;
  const partialCount = integer(c, 'partial_entry_count') || 0;
  const incidentCount = integer(c, 'incident_count') || 0;
  const telegramStatus = text(c, 'telegram_status') || 'NO_EVIDENCE';
  const health: TerminalHealth = {
    ...(text(c, 'authority_mode') ? { authorityMode: text(c, 'authority_mode') } : {}), ...(text(c, 'health_status') ? { healthStatus: text(c, 'health_status') } : {}), ...(text(c, 'safety_mode') ? { safetyMode: text(c, 'safety_mode') } : {}), ...(text(c, 'daemon_plan') ? { daemonPlan: text(c, 'daemon_plan') } : {}), ...(typeof c.new_economic_action_allowed === 'boolean' ? { newEconomicActionAllowed: c.new_economic_action_allowed } : {}),
    recoveryQueueCount: recoveryQueue, unknownSubmissionCount: unknown, activeManagementPlans: activePlans, partialEntryRecoveryCount: partialCount, activeIncidentCount: incidentCount, telegramStatus
  };
  const p6Status = unknown > 0 || recoveryQueue > 0 || partialCount > 0 ? 'RECOVERY' : 'READY';
  return {
    health,
    engines: [
      { name: 'P7 CONTROL', status: text(c, 'health_status') || 'NO_EVIDENCE', ...(iso(c.control_observed_at) ? { observedAt: iso(c.control_observed_at) } : {}), detail: text(c, 'authority_mode') || 'n/a' },
      { name: 'DISCOVERY/P3/P4', status: text(c, 'candidate_outcome') || 'NO_EVIDENCE', ...(iso(c.candidate_completed_at) ? { observedAt: iso(c.candidate_completed_at) } : {}), detail: 'latest canonical selection cycle' },
      { name: 'P6 EXECUTION', status: p6Status, ...(iso(c.p6_observed_at) ? { observedAt: iso(c.p6_observed_at) } : {}), detail: `${activePlans} active plan${activePlans === 1 ? '' : 's'}` },
      { name: 'SETTLEMENT', status: iso(c.settlement_observed_at) ? 'OBSERVED' : 'NO_EVIDENCE', ...(iso(c.settlement_observed_at) ? { observedAt: iso(c.settlement_observed_at) } : {}), detail: 'latest canonical settlement' },
      { name: 'TELEGRAM', status: telegramStatus, ...(iso(c.telegram_observed_at) ? { observedAt: iso(c.telegram_observed_at) } : {}), detail: 'durable outbox evidence' }
    ]
  };
}

async function loadSnapshot(pool: Pool, runtimeId: string): Promise<TerminalSnapshot> {
  const [candidates, activePools, events, healthResult] = await Promise.all([loadCandidates(pool), loadActivePools(pool), loadEvents(pool), loadHealth(pool, runtimeId)]);
  const recentPositions = await loadRecentPositions(pool, activePools);
  return { generatedAt: new Date().toISOString(), runtime: readRuntime(), health: healthResult.health, candidates, selectedCandidateIndex: 0, activePools, recentPositions, engines: healthResult.engines, events };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function showHelp(): void {
  io.stdout.write('LPForge Decision Terminal (read-only)\n\nUsage: pnpm terminal [--once] [--refresh-seconds N] [--plain]\n\nInteractive keys: q quit | ←/h previous candidate | →/l next candidate | e event filter | f fills filter | r refresh\n');
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) { showHelp(); return; }
  const cfg = loadPhase1Config(); // rejects signer material and live-signing mode.
  const once = process.argv.includes('--once');
  const plain = process.argv.includes('--plain') || process.env.NO_COLOR !== undefined;
  const refreshRaw = arg('--refresh-seconds');
  const refreshSeconds = refreshRaw === undefined ? 2 : Number(refreshRaw);
  if (!Number.isFinite(refreshSeconds) || refreshSeconds < 1 || refreshSeconds > 60) throw new Error('LPFORGE_TERMINAL_REFRESH_SECONDS_INVALID');
  if (!once && !io.stdout.isTTY) throw new Error('LPFORGE_TERMINAL_TTY_REQUIRED: use --once for non-interactive output');
  const pool = new Pool({ connectionString: cfg.databaseUrl, max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000, application_name: 'lpforge-decision-terminal-read-only' });
  const runtimeId = (process.env.LPFORGE_P7_RUNTIME_ID ?? 'lpforge-production').trim();
  let stopped = false;
  let refreshing = false;
  let candidateIndex = 0;
  let eventFilter: Parameters<typeof renderDecisionTerminal>[1]['eventFilter'] = 'ALL';
  let positionFilter: Parameters<typeof renderDecisionTerminal>[1]['positionFilter'] = 'ALL';
  let lastSnapshot: TerminalSnapshot | undefined;
  const cleanup = async (exitCode?: number): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (io.stdin.isTTY) io.stdin.setRawMode(false);
    if (io.stdout.isTTY) io.stdout.write('\u001b[?25h\u001b[0m\n');
    await pool.end();
    if (exitCode !== undefined) process.exitCode = exitCode;
  };
  const draw = (snapshot: TerminalSnapshot): void => {
    snapshot.selectedCandidateIndex = candidateIndex;
    const output = renderDecisionTerminal(snapshot, { columns: io.stdout.columns || 160, color: !plain && Boolean(io.stdout.isTTY), eventFilter, positionFilter });
    io.stdout.write(`\u001b[?25l\u001b[2J\u001b[H${output}\n${plain ? '' : '\u001b[2m'}q quit | ←/→ candidate | e events ${eventFilter} | f fills ${positionFilter} | r refresh${plain ? '' : '\u001b[0m'}`);
  };
  const refresh = async (): Promise<void> => {
    if (refreshing || stopped) return;
    refreshing = true;
    try {
      const snapshot = await loadSnapshot(pool, runtimeId);
      candidateIndex = snapshot.candidates.length ? candidateIndex % snapshot.candidates.length : 0;
      lastSnapshot = snapshot;
      if (once) io.stdout.write(`${renderDecisionTerminal(snapshot, { columns: io.stdout.columns || 160, color: false, eventFilter, positionFilter })}\n`);
      else draw(snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted]') : 'LPFORGE_TERMINAL_SNAPSHOT_FAILED';
      if (once) throw error;
      io.stdout.write(`\u001b[2J\u001b[HLPFORGE DECISION TERMINAL\n\nSNAPSHOT UNAVAILABLE: ${message}\n\nRead-only terminal will retry. Trading authority is unchanged.\n`);
    } finally { refreshing = false; }
  };
  io.once('SIGINT', () => { void cleanup(0); });
  io.once('SIGTERM', () => { void cleanup(0); });
  await refresh();
  if (once) { await cleanup(0); return; }
  io.stdin.setRawMode(true);
  io.stdin.resume();
  io.stdin.setEncoding('utf8');
  io.stdin.on('data', (key: string) => {
    if (key === '\u0003' || key === 'q' || key === 'Q') { void cleanup(0); return; }
    if (key === '\u001b[D' || key === 'h') candidateIndex = lastSnapshot ? advanceCandidateIndex(lastSnapshot, candidateIndex, -1) : 0;
    if (key === '\u001b[C' || key === 'l') candidateIndex = lastSnapshot ? advanceCandidateIndex(lastSnapshot, candidateIndex, 1) : 0;
    if (key === 'e' || key === 'E') eventFilter = nextEventFilter(eventFilter);
    if (key === 'f' || key === 'F') positionFilter = nextPositionFilter(positionFilter);
    if (lastSnapshot) draw(lastSnapshot);
    if (key === 'r' || key === 'R') void refresh();
  });
  const timer = setInterval(() => { void refresh(); }, refreshSeconds * 1000);
  timer.unref();
}

void main().catch(error => {
  const message = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted]') : 'LPFORGE_TERMINAL_FAILED';
  io.stderr.write(`LPFORGE_TERMINAL_FAILED: ${message}\n`);
  process.exitCode = 1;
});
