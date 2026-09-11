export type TerminalLevel = 'INFO' | 'WARN' | 'ERROR';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Presentation-only pool label using persisted pool topology and discovery
 * metadata. A paired token symbol is accepted only when its mint exactly
 * matches the non-WSOL side of the current pool.
 */
export function formatTerminalPoolDisplay(row: Record<string, unknown>): string {
  const field = (key: string): string | undefined => {
    const value = row[key];
    return value === null || value === undefined ? undefined : String(value).trim() || undefined;
  };
  const pool = field('pool_address') ?? 'unknown';
  const short = (value: string): string => value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
  const xMint = field('token_x_mint');
  const yMint = field('token_y_mint');
  const x = xMint === WSOL_MINT ? 'SOL' : field('token_x_symbol');
  const y = yMint === WSOL_MINT ? 'SOL' : field('token_y_symbol');
  const pairedMint = field('paired_token_mint');
  const pairedSymbol = field('paired_token_symbol');
  const exactWsolPair = Boolean(pairedSymbol && pairedMint && (
    (xMint === WSOL_MINT && pairedMint === yMint) || (yMint === WSOL_MINT && pairedMint === xMint)
  ));
  if (exactWsolPair) return `${pairedSymbol}/SOL`;
  return x && y ? `${x}/${y}` : short(pool);
}

export interface TerminalEvent {
  id: string;
  observedAt: string;
  level: TerminalLevel;
  event: string;
  entityType: string;
  entityId: string;
  status: string;
  message?: string | undefined;
}

export interface TerminalCandidate {
  poolAddress: string;
  poolDisplay: string;
  operationalState: string;
  phase4State: string;
  candidateId?: string | undefined;
  strategy?: string | undefined;
  orientation?: string | undefined;
  lowerBinId?: number | undefined;
  upperBinId?: number | undefined;
  activeBinId?: number | undefined;
  predictedGrossFees?: number | undefined;
  predictedNetEv?: number | undefined;
  riskAdjustedExpectedNetEv?: number | undefined;
  uncertainty?: number | undefined;
  confidence?: number | undefined;
  oorRisk?: number | undefined;
  /** Discovery's current durable evidence-collection state, if present. */
  registryState?: string | undefined;
  /** Canonical Discovery rank; it is display ordering only. */
  rank?: number | undefined;
  reasonCodes: string[];
}

export interface TerminalRpcHealth {
  /** Logical role only. Endpoint/provider identities are never rendered. */
  role: 'PRODUCTION' | 'DISCOVERY' | 'EXECUTION';
  state: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN';
  /** Current coordinator-pressure interpretation, not a provider quota claim. */
  quotaState?: 'OK' | 'WARN' | undefined;
  /** Existing canonical telemetry timestamp, if available. */
  observedAt?: string | undefined;
  /** Persisted measured latency only; the terminal never probes to populate it. */
  latencyMs?: number | undefined;
}

export interface TerminalPosition {
  lpforgePositionId: string;
  positionAddress: string;
  poolAddress: string;
  poolDisplay: string;
  enteredAt: string;
  lifecycleState: string;
  reconciliationStatus: string;
  lowerBinId?: number | undefined;
  upperBinId?: number | undefined;
  activeBinId?: number | undefined;
  rangeState?: string | undefined;
  /**
   * LP-local, receipt-backed live-control PnL. This is deliberately separate
   * from managed economics, which remains an exit/protection input and can
   * have a different valuation basis.
   */
  liveControlReturnFraction?: number | undefined;
  liveControlPeakReturnFraction?: number | undefined;
  feeLamports?: bigint | undefined;
  valuationState?: string | undefined;
  oorLifecycleState?: string | undefined;
  oorDirection?: string | undefined;
  inventoryClassification?: string | undefined;
  protection: string;
}

export interface TerminalRecentPosition {
  lifecycleId: string;
  positionAddress: string;
  poolAddress: string;
  poolDisplay: string;
  state: 'OPEN' | 'CLOSED';
  observedAt: string;
  /** Latest canonical settlement return. Present only for CLOSED rows. */
  realizedReturnFraction?: number | undefined;
  /** LP-local live-control mark. Present only for OPEN rows. */
  liveControlReturnFraction?: number | undefined;
  feeLamports?: bigint | undefined;
  holdSeconds?: number | undefined;
  exitReason?: string | undefined;
}

export interface TerminalEngine {
  name: string;
  status: string;
  observedAt?: string | undefined;
  detail?: string | undefined;
}

export interface TerminalHealth {
  authorityMode?: string | undefined;
  healthStatus?: string | undefined;
  safetyMode?: string | undefined;
  daemonPlan?: string | undefined;
  newEconomicActionAllowed?: boolean | undefined;
  recoveryQueueCount: number;
  unknownSubmissionCount: number;
  activeManagementPlans: number;
  partialEntryRecoveryCount: number;
  activeIncidentCount: number;
  telegramStatus: string;
  rpcHealth: TerminalRpcHealth[];
}

export interface TerminalRuntime {
  releaseSha?: string | undefined;
  policyVersion?: string | undefined;
  policyHash?: string | undefined;
  cluster: string;
  maxOpenPositions?: number;
}

export interface TerminalSnapshot {
  generatedAt: string;
  runtime: TerminalRuntime;
  health: TerminalHealth;
  candidates: TerminalCandidate[];
  /** Current ACTIVE_CANDIDATE evidence leases, distinct from the P7 cycle. */
  entryWatchPools: TerminalCandidate[];
  selectedCandidateIndex: number;
  activePools: TerminalPosition[];
  recentPositions: TerminalRecentPosition[];
  engines: TerminalEngine[];
  events: TerminalEvent[];
}

export interface TerminalRenderOptions {
  columns: number;
  rows?: number | undefined;
  color: boolean;
  eventFilter?: 'ALL' | 'POOLS' | 'ENGINES' | 'EXECUTION' | undefined;
  positionFilter?: 'ALL' | 'OPEN' | 'CLOSED' | undefined;
  /** Compact shell presentation selected only on phone-sized terminal widths. */
  mobileView?: 'OVERVIEW' | 'ACTIVITY' | undefined;
  /** Plain diagnostic output keeps durable event identities visible. */
  showCanonicalEventCodes?: boolean | undefined;
  interactive?: boolean | undefined;
}

const ansi = {
  reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', lime: '\u001b[38;5;154m', green: '\u001b[38;5;84m', cyan: '\u001b[38;5;80m', amber: '\u001b[38;5;220m', magenta: '\u001b[38;5;205m', red: '\u001b[38;5;204m', gray: '\u001b[38;5;250m', muted: '\u001b[38;5;245m'
} as const;

function paint(value: string, color: keyof typeof ansi, enabled: boolean): string {
  return enabled ? `${ansi[color]}${value}${ansi.reset}` : value;
}

function visible(value: string): string { return value.replace(/\u001b\[[0-9;]*m/g, ''); }
function clip(value: string, width: number): string {
  if (width <= 0) return '';
  const raw = visible(value);
  return raw.length <= width ? value : `${raw.slice(0, Math.max(0, width - 1))}…`;
}
function pad(value: string, width: number): string {
  const clipped = clip(value, width);
  return `${clipped}${' '.repeat(Math.max(0, width - visible(clipped).length))}`;
}
function right(value: string, width: number): string {
  const clipped = clip(value, width);
  return `${' '.repeat(Math.max(0, width - visible(clipped).length))}${clipped}`;
}
function line(width: number, value = ''): string { return pad(value, Math.max(0, width)); }
function short(value: string | undefined, head = 6, tail = 4): string {
  if (!value) return '—';
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${tail > 0 ? value.slice(-tail) : ''}`;
}
function finite(value: number | undefined): number | undefined { return value !== undefined && Number.isFinite(value) ? value : undefined; }

export function formatPercent(value: number | undefined, digits = 2): string {
  const n = finite(value);
  return n === undefined ? 'n/a' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`;
}
export function formatSolLamports(value: bigint | undefined, digits = 5): string {
  return value === undefined ? 'n/a' : `${(Number(value) / 1_000_000_000).toFixed(digits)} SOL`;
}
export function formatAge(value: string | undefined, now = Date.now()): string {
  if (!value) return 'n/a';
  const ms = now - Date.parse(value);
  if (!Number.isFinite(ms) || ms < 0) return 'n/a';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ${min % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

function stateColor(state: string): keyof typeof ansi {
  const upper = state.toUpperCase();
  if (/(ERROR|FAILED|REJECT|NO_TRADE|CRITICAL|BLOCK|UNAVAILABLE)/.test(upper)) return /(ERROR|FAILED|CRITICAL|UNAVAILABLE)/.test(upper) ? 'red' : 'magenta';
  if (/(WARN|WAIT|WARM|OOR|RECOVER|UNKNOWN|PAUSED|DEGRADED)/.test(upper)) return 'amber';
  if (/(HEALTHY|READY|OPEN|NORMAL|PASS|CONNECTED|PRODUCTION|SETTLED)/.test(upper)) return 'green';
  return 'cyan';
}
function state(value: string | undefined, color: boolean): string { return paint(value || 'n/a', stateColor(value || ''), color); }
function signedPercent(value: number | undefined, color: boolean): string {
  const text = formatPercent(value);
  if (value === undefined) return paint(text, 'muted', color);
  return paint(text, value >= 0 ? 'green' : 'red', color);
}
function meter(value: number | undefined, width: number, color: boolean, invert = false): string {
  const n = finite(value);
  if (n === undefined) return paint('—'.repeat(width), 'muted', color);
  const bounded = Math.max(0, Math.min(1, invert ? 1 - n : n));
  const used = Math.round(bounded * width);
  return `${paint('█'.repeat(used), used ? (invert ? 'green' : 'cyan') : 'muted', color)}${paint('░'.repeat(width - used), 'muted', color)}`;
}

function metric(value: number | undefined, digits: number, color: boolean, withMeter = false, invert = false): string {
  if (value === undefined || !Number.isFinite(value)) return paint('—', 'muted', color);
  const text = value.toFixed(digits);
  return withMeter ? `${text} ${meter(value, 12, color, invert)}` : text;
}

function signedSol(value: number | undefined, color: boolean): string {
  if (value === undefined || !Number.isFinite(value)) return paint('—', 'muted', color);
  return paint(`${value >= 0 ? '+' : ''}${value.toFixed(6)} SOL`, value >= 0 ? 'green' : 'red', color);
}

function panel(title: string, width: number, height: number, content: string[], color: boolean, suffix?: string): string[] {
  const inner = Math.max(8, width - 2);
  const heading = `${paint(title, 'lime', color)}${suffix ? right(paint(suffix, 'muted', color), Math.max(0, inner - visible(title).length)) : ''}`;
  const lines = [line(inner, heading), ...content.map(item => line(inner, item))];
  while (lines.length < Math.max(1, height - 2)) lines.push(' '.repeat(inner));
  return [`┌${'─'.repeat(inner)}┐`, ...lines.slice(0, Math.max(1, height - 2)).map(item => `│${item}│`), `└${'─'.repeat(inner)}┘`];
}
function joinPanels(panels: string[][], gap = '  '): string[] {
  const count = Math.max(...panels.map(p => p.length));
  return Array.from({ length: count }, (_, index) => panels.map(p => p[index] || ' '.repeat(visible(p[0] || '').length)).join(gap));
}
function eventCategory(event: TerminalEvent): 'POOLS' | 'ENGINES' | 'EXECUTION' {
  if (event.entityType === 'PLAN' || /^(P6|P7_EXECUTION|PLAN|CLOSE|OPEN|SETTLED|RECOVERY)/.test(event.event)) return 'EXECUTION';
  if (event.entityType === 'RUNTIME' || /^(P7|DISCOVERY|TELEGRAM|RPC)/.test(event.event)) return 'ENGINES';
  return 'POOLS';
}
const EVENT_DISPLAY_ALIASES: Readonly<Record<string, string>> = {
  POSITION_LIVE_CONTROL_PNL_RESTORED: 'PNL_RESTORED',
  POSITION_LIVE_CONTROL_PNL_UNAVAILABLE: 'PNL_UNAVAILABLE',
  POSITION_OOR_STALE_CAPITAL: 'OOR_STALE_CAPITAL',
  POSITION_OOR_SUSTAINED: 'OOR_SUSTAINED',
  LPFORGE_RPC_USAGE_QUOTA_RECOVERED: 'RPC_QUOTA_RECOVERED',
  LPFORGE_RPC_USAGE_QUOTA_EXCEEDED: 'RPC_QUOTA_EXCEEDED',
  P6_EXECUTION_RECOVERY_PENDING: 'P6_RECOVERY_PENDING',
  P6_EXECUTION_SUBMISSION_UNKNOWN: 'P6_SUBMISSION_UNKNOWN',
  P6_EXECUTION_RECONCILED: 'P6_RECONCILED',
  POSITION_OPENED: 'POSITION_OPENED',
  POSITION_CLOSE_TRIGGERED: 'CLOSE_TRIGGERED'
};

export function displayEventCode(eventCode: string): string { return EVENT_DISPLAY_ALIASES[eventCode] || eventCode; }

function eventRows(snapshot: TerminalSnapshot, width: number, filter: TerminalRenderOptions['eventFilter'], color: boolean, showCanonical = false): string[] {
  const rows = snapshot.events.filter(e => !filter || filter === 'ALL' || eventCategory(e) === filter).slice(0, 18);
  if (!rows.length) return [paint('No canonical events in the current bounded window.', 'muted', color)];
  const entityWidth = Math.max(8, Math.min(10, Math.floor(width / 7)));
  const eventCap = showCanonical ? 38 : 21;
  const eventWidth = Math.min(eventCap, Math.max(14, width - 9 - 1 - 5 - 1 - entityWidth - 1 - 18 - 1));
  const head = `${pad('TIME', 9)} ${pad('LVL', 5)} ${pad('EVENT', eventWidth)} ${pad('ENTITY', entityWidth)} MESSAGE`;
  const messageWidth = Math.max(12, width - 9 - 1 - 5 - 1 - eventWidth - 1 - entityWidth - 1);
  return [paint(head, 'muted', color), ...rows.map(row => {
    const time = new Date(row.observedAt).toISOString().slice(11, 19);
    const message = row.message || row.status;
    const event = showCanonical ? row.event : displayEventCode(row.event);
    return `${pad(time, 9)} ${pad(state(row.level, color), 5)} ${pad(state(event, color), eventWidth)} ${pad(short(row.entityId, 5, 3), entityWidth)} ${clip(message, messageWidth)}`;
  })];
}
function candidateLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const candidate = snapshot.candidates[snapshot.selectedCandidateIndex] || snapshot.candidates[0];
  if (!candidate) return [paint('No current canonical candidate cycle.', 'muted', color)];
  const range = candidate.lowerBinId === undefined || candidate.upperBinId === undefined ? '—' : `${candidate.lowerBinId} → ${candidate.upperBinId}`;
  const score = metric(candidate.confidence, 2, color, true);
  const uncertainty = metric(candidate.uncertainty, 2, color, true, true);
  const oorRisk = metric(candidate.oorRisk, 2, color, true, true);
  const netEv = signedSol(candidate.riskAdjustedExpectedNetEv ?? candidate.predictedNetEv, color);
  return [
    `${paint('POOL', 'muted', color)}      ${state(candidate.poolDisplay, color)}`,
    `${paint('STATE', 'muted', color)}     ${state(candidate.operationalState, color)}`,
    '',
    `${paint('P3', 'muted', color)}        ${state(candidate.operationalState, color)}`,
    `${paint('P4', 'muted', color)}        ${state(candidate.phase4State, color)}`,
    '',
    `${paint('SCORE', 'muted', color)}     ${score}`,
    `${paint('UNCERTAINTY', 'muted', color)} ${uncertainty}`,
    `${paint('NET EV', 'muted', color)}    ${netEv}`,
    '',
    `${paint('RANGE', 'muted', color)}     ${range}`,
    `${paint('ACTIVE BIN', 'muted', color)} ${candidate.activeBinId === undefined ? '—' : candidate.activeBinId}`,
    `${paint('OOR RISK', 'muted', color)}  ${oorRisk}`,
    '',
    `${paint('REASON', 'muted', color)}    ${clip(candidate.reasonCodes.join(', ') || '—', Math.max(8, width - 12))}`
  ];
}
function pipelineLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const totals = new Map<string, number>();
  for (const candidate of snapshot.candidates) totals.set(candidate.operationalState, (totals.get(candidate.operationalState) || 0) + 1);
  if (!totals.size) return [paint('No current candidate-cycle facts.', 'muted', color)];
  const max = Math.max(...totals.values());
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => {
    const barWidth = Math.max(6, Math.min(16, width - 20));
    const used = Math.max(1, Math.round((count / max) * barWidth));
    return `${pad(state(name, color), 14)} ${right(String(count), 3)} ${paint('█'.repeat(used), stateColor(name), color)}${paint('░'.repeat(barWidth - used), 'muted', color)}`;
  });
}

/** Compact display-only synopsis of durable current candidate reasons. */
function nextWatchGate(candidate: TerminalCandidate): string {
  const reasons = candidate.reasonCodes.join('|');
  if (/RAW_REPLAY|REPLAY/.test(reasons)) return 'REPLAY';
  if (/P4|PHASE4/.test(reasons) || (candidate.operationalState === 'ENTRY_READY' && candidate.phase4State !== 'ENTRY_READY')) return 'P4';
  if (/CAPITAL/.test(reasons)) return 'CAPITAL';
  if (/UNCERTAINTY/.test(reasons)) return 'UNCERTAINTY';
  if (/RANGE/.test(reasons)) return 'RANGE';
  if (/LIVE_EVIDENCE|LIVE_CONFIRMATION|OBSERVATION|HISTORY/.test(reasons) || candidate.operationalState === 'WARMING') return 'MORE DATA';
  return candidate.reasonCodes[0] ? candidate.reasonCodes[0].replace(/^OPERATIONAL_/, '').replace(/^ENTRY_/, '') : '—';
}

function entryWatchLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const pools = snapshot.entryWatchPools;
  if (!pools.length) return [paint('No actively monitored entry pools.', 'muted', color)];
  const showEv = width >= 50;
  const poolWidth = Math.min(12, Math.max(8, Math.floor(width * .25)));
  const stateWidth = Math.min(12, Math.max(9, Math.floor(width * .25)));
  const scoreWidth = 6;
  const evWidth = showEv ? 10 : 0;
  const fixed = poolWidth + 1 + stateWidth + 1 + scoreWidth + (showEv ? 1 + evWidth : 0) + 1;
  const gateWidth = Math.max(7, width - fixed);
  const head = `${pad('POOL', poolWidth)} ${pad('STATE', stateWidth)} ${pad('SCORE', scoreWidth)}${showEv ? ` ${pad('EV', evWidth)}` : ''} NEXT GATE`;
  const maxRows = Math.max(1, Math.min(6, pools.length));
  const rows = pools.slice(0, maxRows).map(candidate => {
    const score = candidate.confidence === undefined ? '—' : candidate.confidence.toFixed(2);
    const evValue = candidate.riskAdjustedExpectedNetEv ?? candidate.predictedNetEv;
    const ev = evValue === undefined || !Number.isFinite(evValue) ? paint('—', 'muted', color) : paint(`${evValue >= 0 ? '+' : ''}${evValue.toFixed(6)}`, evValue >= 0 ? 'green' : 'red', color);
    return `${pad(candidate.poolDisplay, poolWidth)} ${pad(state(candidate.operationalState, color), stateWidth)} ${pad(score, scoreWidth)}${showEv ? ` ${pad(ev, evWidth)}` : ''} ${clip(state(nextWatchGate(candidate), color), gateWidth)}`;
  });
  if (pools.length > maxRows) rows.push(paint(`+${pools.length - maxRows} more`, 'muted', color));
  return [paint(head, 'muted', color), ...rows];
}

function activePoolLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  if (!snapshot.activePools.length) return [paint('No open LP positions.', 'muted', color)];
  const head = `${pad('POOL', 12)} ${pad('POSITION', 12)} ${pad('STATE', 9)} ${pad('LIVE PNL', 10)} ${pad('LIVE PEAK', 10)} ${pad('RANGE', 15)} ALERT`;
  const alertWidth = Math.max(8, width - 12 - 1 - 12 - 1 - 9 - 1 - 10 - 1 - 10 - 1 - 15 - 1);
  return [paint(head, 'muted', color), ...snapshot.activePools.map(position => {
    const range = position.lowerBinId === undefined || position.upperBinId === undefined ? '—' : `${position.lowerBinId}:${position.upperBinId} @${position.activeBinId ?? '?'}`;
    return `${pad(position.poolDisplay, 12)} ${pad(short(position.positionAddress), 12)} ${pad(state(position.lifecycleState, color), 9)} ${pad(signedPercent(position.liveControlReturnFraction, color), 10)} ${pad(signedPercent(position.liveControlPeakReturnFraction, color), 10)} ${pad(range, 15)} ${clip(state(position.protection, color), alertWidth)}`;
  })];
}

function rpcSummary(snapshot: TerminalSnapshot): string {
  const roles = ['PRODUCTION', 'DISCOVERY', 'EXECUTION'] as const;
  const byRole = new Map(snapshot.health.rpcHealth.map(value => [value.role, value]));
  const rpc = roles.map(role => byRole.get(role) || { role, state: 'UNKNOWN' as const });
  const execution = rpc.find(value => value.role === 'EXECUTION');
  if (execution?.state === 'UNAVAILABLE') return 'RPC EXECUTION DOWN';
  if (rpc.some(value => value.state === 'UNAVAILABLE')) return 'RPC DEGRADED';
  const healthy = rpc.filter(value => value.state === 'HEALTHY').length;
  return healthy === 3 ? 'RPC 3/3 HEALTHY' : `RPC ${healthy}/3 HEALTHY`;
}

function rpcLines(snapshot: TerminalSnapshot, color: boolean): string[] {
  const byRole = new Map(snapshot.health.rpcHealth.map(value => [value.role, value]));
  return (['PRODUCTION', 'DISCOVERY', 'EXECUTION'] as const).map(role => {
    const rpc = byRole.get(role) || { role, state: 'UNKNOWN' as const };
    const latency = rpc.latencyMs === undefined ? '—' : `${Math.max(0, Math.round(rpc.latencyMs))}ms`;
    const quota = rpc.quotaState ? `QUOTA ${rpc.quotaState}` : 'QUOTA —';
    return `${paint(`RPC ${role}`, 'muted', color)} ${pad(state(rpc.state, color), 11)} ${pad(latency, 7)} ${state(quota, color)}`;
  });
}
function engineLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const head = `${pad('ENGINE', 13)} ${pad('STATUS', 14)} ${pad('AGE', 8)} INFO`;
  return [paint(head, 'muted', color), ...snapshot.engines.map(engine => `${pad(engine.name, 13)} ${pad(state(engine.status, color), 14)} ${pad(formatAge(engine.observedAt), 8)} ${clip(engine.detail || '—', Math.max(8, width - 39))}`)];
}
function recentPositionLines(snapshot: TerminalSnapshot, width: number, filter: TerminalRenderOptions['positionFilter'], color: boolean): string[] {
  const rows = snapshot.recentPositions.filter(row => !filter || filter === 'ALL' || row.state === filter).slice(0, 8);
  if (!rows.length) return [paint('No matching canonical lifecycle.', 'muted', color)];
  const head = `${pad('TIME', 8)} ${pad('POOL', 12)} ${pad('POSITION', 12)} ${pad('STATE', 7)} ${pad('SETTLED/LIVE', 12)} ${pad('AGE', 8)} REASON`;
  return [paint(head, 'muted', color), ...rows.map(row => {
    const time = new Date(row.observedAt).toISOString().slice(5, 16).replace('T', ' ');
    const label = row.state === 'OPEN' ? `LIVE ${formatPercent(row.liveControlReturnFraction)}` : formatPercent(row.realizedReturnFraction);
    const value = row.state === 'OPEN' ? label : signedPercent(row.realizedReturnFraction, color);
    return `${pad(time, 8)} ${pad(row.poolDisplay, 12)} ${pad(short(row.positionAddress), 12)} ${pad(state(row.state, color), 7)} ${pad(value, 12)} ${pad(row.holdSeconds === undefined ? 'n/a' : formatAge(new Date(Date.now() - row.holdSeconds * 1000).toISOString()), 8)} ${clip(row.exitReason || (row.state === 'OPEN' ? 'LIVE CONTROL MARK' : 'n/a'), Math.max(8, width - 67))}`;
  })];
}
function healthLines(snapshot: TerminalSnapshot, color: boolean): string[] {
  const health = snapshot.health;
  return [
    `${paint('P7 MODE', 'muted', color)}        ${state(health.authorityMode, color)}`,
    `${paint('P7 HEALTH', 'muted', color)}      ${state(health.healthStatus, color)}`,
    `${paint('SAFETY', 'muted', color)}         ${state(health.safetyMode, color)}`,
    `${paint('NEW ENTRIES', 'muted', color)}    ${state(health.newEconomicActionAllowed ? 'ALLOWED' : 'BLOCKED', color)}`,
    ...rpcLines(snapshot, color),
    `${paint('RECOVERY QUEUE', 'muted', color)} ${state(String(health.recoveryQueueCount), color)}`,
    `${paint('UNKNOWN TX', 'muted', color)}     ${state(String(health.unknownSubmissionCount), color)}`,
    `${paint('ACTIVE PLANS', 'muted', color)}   ${state(String(health.activeManagementPlans), color)}`,
    `${paint('PARTIAL ENTRY', 'muted', color)}  ${state(String(health.partialEntryRecoveryCount), color)}`,
    `${paint('INCIDENTS', 'muted', color)}      ${state(String(health.activeIncidentCount), color)}`,
    `${paint('TELEGRAM', 'muted', color)}       ${state(health.telegramStatus, color)}`,
    `${paint('RELEASE', 'muted', color)}        ${paint(short(snapshot.runtime.releaseSha), 'cyan', color)}`,
    `${paint('POLICY', 'muted', color)}         ${paint(short(snapshot.runtime.policyHash), 'cyan', color)}`
  ];
}

function mobileSection(title: string, content: string[], width: number, color: boolean): string[] {
  return [paint(`── ${title} ${'─'.repeat(Math.max(0, width - visible(title).length - 4))}`, 'lime', color), ...content.map(value => clip(value, width))];
}

function compactCandidateLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const candidate = snapshot.candidates[snapshot.selectedCandidateIndex] || snapshot.candidates[0];
  if (!candidate) return [paint('No current candidate cycle.', 'muted', color)];
  const range = candidate.lowerBinId === undefined || candidate.upperBinId === undefined ? '—' : `${candidate.lowerBinId}→${candidate.upperBinId}`;
  const score = candidate.confidence === undefined ? '—' : candidate.confidence.toFixed(2);
  const ev = candidate.riskAdjustedExpectedNetEv ?? candidate.predictedNetEv;
  const evText = ev === undefined || !Number.isFinite(ev) ? '—' : `${ev >= 0 ? '+' : ''}${ev.toFixed(6)}`;
  return [
    `${paint('POOL', 'muted', color)} ${state(candidate.poolDisplay, color)}`,
    `${paint('STATE', 'muted', color)} ${state(candidate.operationalState, color)}  ${paint('P3', 'muted', color)} ${state(candidate.operationalState, color)}`,
    `${paint('P4', 'muted', color)} ${state(candidate.phase4State, color)}  ${paint('SCORE', 'muted', color)} ${paint(score, score === '—' ? 'muted' : 'cyan', color)}`,
    `${paint('EV', 'muted', color)} ${paint(evText, evText === '—' ? 'muted' : ev !== undefined && ev >= 0 ? 'green' : 'red', color)}  ${paint('RANGE', 'muted', color)} ${range}`,
    `${paint('NEXT', 'muted', color)} ${state(nextWatchGate(candidate), color)}`
  ].map(value => clip(value, width));
}

function compactPipelineLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const totals = new Map<string, number>();
  for (const candidate of snapshot.candidates) totals.set(candidate.operationalState, (totals.get(candidate.operationalState) || 0) + 1);
  if (!totals.size) return [paint('No current candidate facts.', 'muted', color)];
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 2).map(([name, count]) => `${pad(state(name, color), Math.max(10, Math.min(16, width - 5)))} ${count}`);
}

function compactWatchLines(snapshot: TerminalSnapshot, width: number, color: boolean, limit: number): string[] {
  const pools = snapshot.entryWatchPools;
  if (!pools.length) return [paint('No actively monitored pools.', 'muted', color)];
  const visiblePools = pools.slice(0, Math.max(1, limit));
  const rows = visiblePools.map(pool => clip(`${state(pool.poolDisplay, color)} ${state(pool.operationalState, color)} → ${state(nextWatchGate(pool), color)}`, width));
  if (pools.length > visiblePools.length) rows.push(paint(`+${pools.length - visiblePools.length} more`, 'muted', color));
  return rows;
}

function compactOpenPositionLines(snapshot: TerminalSnapshot, width: number, color: boolean, limit: number): string[] {
  if (!snapshot.activePools.length) return [paint('No open LP positions.', 'muted', color)];
  return snapshot.activePools.slice(0, Math.max(1, limit)).map(position => clip(`${state(position.poolDisplay, color)} ${state(position.lifecycleState, color)} ${signedPercent(position.liveControlReturnFraction, color)} ${paint('PK', 'muted', color)} ${signedPercent(position.liveControlPeakReturnFraction, color)} ${state(position.protection, color)}`, width));
}

function compactEventLines(snapshot: TerminalSnapshot, width: number, filter: TerminalRenderOptions['eventFilter'], color: boolean, limit: number, showCanonical = false): string[] {
  const rows = snapshot.events.filter(event => !filter || filter === 'ALL' || eventCategory(event) === filter).slice(0, Math.max(1, limit));
  if (!rows.length) return [paint('No canonical events.', 'muted', color)];
  return rows.map(row => {
    const time = new Date(row.observedAt).toISOString().slice(11, 16);
    const event = showCanonical ? row.event : displayEventCode(row.event);
    const prefix = `${time} ${event}`;
    return clip(`${paint(time, 'muted', color)} ${state(event, color)} ${clip(row.message || row.status, Math.max(8, width - visible(prefix).length - 1))}`, width);
  });
}

function compactRecentPositionLines(snapshot: TerminalSnapshot, width: number, filter: TerminalRenderOptions['positionFilter'], color: boolean, limit: number): string[] {
  const positions = snapshot.recentPositions.filter(position => !filter || filter === 'ALL' || position.state === filter).slice(0, Math.max(1, limit));
  if (!positions.length) return [paint('No matching positions.', 'muted', color)];
  return positions.map(position => {
    const coloured = position.state === 'OPEN' ? signedPercent(position.liveControlReturnFraction, color) : signedPercent(position.realizedReturnFraction, color);
    const age = position.holdSeconds === undefined ? 'n/a' : formatAge(new Date(Date.now() - position.holdSeconds * 1000).toISOString());
    return clip(`${state(position.poolDisplay, color)} ${state(position.state, color)} ${coloured} ${paint(age, 'muted', color)}`, width);
  });
}

function compactEngineLines(snapshot: TerminalSnapshot, width: number, color: boolean, limit: number): string[] {
  return snapshot.engines.slice(0, Math.max(1, limit)).map(engine => clip(`${paint(engine.name, 'muted', color)} ${state(engine.status, color)} ${paint(formatAge(engine.observedAt), 'muted', color)}`, width));
}

function compactSystemLines(snapshot: TerminalSnapshot, width: number, color: boolean, limit: number): string[] {
  const health = snapshot.health;
  const byRole = new Map(health.rpcHealth.map(rpc => [rpc.role, rpc]));
  const rpc = (role: 'PRODUCTION' | 'DISCOVERY' | 'EXECUTION'): string => byRole.get(role)?.state || 'UNKNOWN';
  const mobileRpcState = (role: 'PRODUCTION' | 'DISCOVERY' | 'EXECUTION'): string => {
    const value = rpc(role);
    const label = value === 'HEALTHY' ? 'OK' : value === 'DEGRADED' ? 'DEG' : value === 'UNAVAILABLE' ? 'DOWN' : '?';
    return state(label, color);
  };
  return [
    `${paint('P7', 'muted', color)} ${state(health.healthStatus, color)} ${paint('SAFE', 'muted', color)} ${state(health.safetyMode, color)}`,
    `${paint('ENTRY', 'muted', color)} ${state(health.newEconomicActionAllowed ? 'ALLOWED' : 'BLOCKED', color)} ${paint('REC', 'muted', color)} ${state(String(health.recoveryQueueCount), color)}`,
    `${paint('RPC', 'muted', color)} P:${mobileRpcState('PRODUCTION')} D:${mobileRpcState('DISCOVERY')} E:${mobileRpcState('EXECUTION')}`,
    `${paint('PLAN', 'muted', color)} ${state(String(health.activeManagementPlans), color)} ${paint('UNK', 'muted', color)} ${state(String(health.unknownSubmissionCount), color)}`
  ].slice(0, Math.max(1, limit)).map(value => clip(value, width));
}

function renderMobileDecisionTerminal(snapshot: TerminalSnapshot, options: TerminalRenderOptions): string {
  const color = options.color;
  const width = Math.max(36, Math.min(99, Math.floor(options.columns)));
  const rows = Math.max(18, Math.min(60, Math.floor(options.rows ?? 24)));
  const health = snapshot.health;
  const mobileView = options.mobileView || 'OVERVIEW';
  const header = [
    paint(width >= 52 ? 'LPFORGE DECISION TERMINAL' : 'LPFORGE TERMINAL', 'lime', color),
    `${paint('P7', 'muted', color)} ${state(health.healthStatus, color)}  ${paint('SAFE', 'muted', color)} ${state(health.safetyMode, color)}`,
    `${paint('ENTRY', 'muted', color)} ${state(health.newEconomicActionAllowed ? 'ALLOWED' : 'BLOCKED', color)}  ${paint('POS', 'muted', color)} ${snapshot.activePools.length}/${snapshot.runtime.maxOpenPositions ?? 'n/a'}`,
    `${paint(`WATCH ${snapshot.entryWatchPools.length}`, 'amber', color)}  ${paint(`CAND ${snapshot.candidates.length}`, 'cyan', color)}  ${paint(`REC ${health.recoveryQueueCount}`, health.recoveryQueueCount ? 'amber' : 'muted', color)}`,
    `${state(rpcSummary(snapshot), color)}  ${paint(new Date().toISOString().slice(11, 19), 'muted', color)}`
  ].map(value => clip(value, width));
  const footer = options.interactive
    ? clip(paint(`q quit | m ${mobileView === 'OVERVIEW' ? 'activity' : 'overview'} | h/l candidate | r refresh`, 'muted', color), width)
    : paint('LPFORGE | SOLANA | READ-ONLY', 'muted', color);
  const bodyBudget = Math.max(8, rows - header.length - 2);
  const body: string[] = [];
  const append = (title: string, content: string[], minimum = 2): void => {
    const section = mobileSection(title, content, width, color);
    if (body.length + Math.min(minimum, section.length) <= bodyBudget) body.push(...section.slice(0, Math.max(minimum, Math.min(section.length, bodyBudget - body.length))));
  };
  if (mobileView === 'OVERVIEW') {
    append(`◎ DECISION ${snapshot.candidates.length ? `${snapshot.selectedCandidateIndex + 1}/${snapshot.candidates.length}` : '0/0'}`, compactCandidateLines(snapshot, width, color), 5);
    append(`■ ENTRY WATCH (${snapshot.entryWatchPools.length})`, compactWatchLines(snapshot, width, color, bodyBudget >= 20 ? 3 : 2), 3);
    append(`■ OPEN POSITIONS (${snapshot.activePools.length}/${snapshot.runtime.maxOpenPositions ?? 'n/a'})`, compactOpenPositionLines(snapshot, width, color, 2), 2);
    append('♥ SYSTEM HEALTH', compactSystemLines(snapshot, width, color, bodyBudget >= 20 ? 4 : 3), 3);
    append('▥ CANDIDATE PIPELINE', compactPipelineLines(snapshot, width, color), 2);
  } else {
    append(`● LIVE EVENTS ${options.eventFilter || 'ALL'}`, compactEventLines(snapshot, width, options.eventFilter, color, bodyBudget >= 20 ? 6 : 4, options.showCanonicalEventCodes), 5);
    append(`▤ RECENT POSITIONS ${options.positionFilter || 'ALL'}`, compactRecentPositionLines(snapshot, width, options.positionFilter, color, bodyBudget >= 20 ? 5 : 3), 4);
    append('⚙ ENGINE DESK', compactEngineLines(snapshot, width, color, 3), 3);
    append('♥ SYSTEM HEALTH', compactSystemLines(snapshot, width, color, 3), 3);
  }
  return [...header, paint('─'.repeat(width), 'muted', color), ...body.slice(0, bodyBudget), footer].join('\n');
}

export function renderDecisionTerminal(snapshot: TerminalSnapshot, options: TerminalRenderOptions): string {
  const color = options.color;
  if (options.columns < 100) return renderMobileDecisionTerminal(snapshot, options);
  const width = Math.max(100, Math.min(220, options.columns));
  const rows = Math.max(30, Math.min(80, Math.floor(options.rows ?? 50)));
  const health = snapshot.health;
  const headerStatus = health.healthStatus === 'HEALTHY' ? 'HEALTHY' : health.healthStatus || 'UNKNOWN';
  const entry = health.newEconomicActionAllowed ? 'ENTRY ALLOWED' : 'ENTRY BLOCKED';
  const recovery = health.recoveryQueueCount > 0 ? `RECOVERY ${health.recoveryQueueCount}` : 'RECOVERY 0';
  const watch = `WATCH ${snapshot.entryWatchPools.length}`;
  const rpc = rpcSummary(snapshot);
  const recoveryState = paint(recovery, health.recoveryQueueCount > 0 ? 'amber' : 'muted', color);
  const header = [
    `${paint('LPFORGE DECISION TERMINAL', 'lime', color)}  ${state(health.authorityMode === 'PRODUCTION' ? 'PROD' : health.authorityMode || 'UNKNOWN', color)} | ${state(`P7 ${headerStatus}`, color)} | ${state(`SAFETY ${health.safetyMode || 'UNKNOWN'}`, color)} | ${state(entry, color)}`,
    `${paint(`POS ${snapshot.activePools.length}/${snapshot.runtime.maxOpenPositions ?? 'n/a'}`, 'cyan', color)} | ${paint(watch, 'amber', color)} | ${paint(`CAND ${snapshot.candidates.length}`, 'cyan', color)} | ${recoveryState} | ${state(rpc, color)} | ${paint('REFRESH 2s', 'muted', color)} | ${paint(`UTC ${new Date().toISOString().slice(11, 19)}`, 'cyan', color)}`
  ].map(value => clip(value, width));
  const divider = paint('═'.repeat(width), 'muted', color);
  const panelRows = Math.max(25, rows - header.length - 2);
  const topHeight = Math.max(14, Math.min(22, Math.floor(panelRows * .44)));
  const engineHeight = 8;
  const activeHeight = Math.max(4, Math.min(7, snapshot.activePools.length + 4));
  const middleHeight = Math.max(engineHeight, activeHeight);
  const bottomHeight = Math.max(9, panelRows - topHeight - middleHeight);
  const help = 'q quit  h/l candidate  e events  f fills  r refresh';
  const identity = 'LPFORGE | SOLANA | METEORA DLMM | READ-ONLY';
  const helpText = clip(help, Math.max(0, width - identity.length - 1));
  const footer = options.interactive
    ? `${paint(helpText, 'muted', color)}${right(paint(identity, 'muted', color), Math.max(0, width - visible(helpText).length))}`
    : paint(identity, 'muted', color);
  if (width < 135) {
    const narrow = [
      ...panel('● LIVE EVENT STREAM', width, Math.max(9, Math.min(18, topHeight)), eventRows(snapshot, width - 2, options.eventFilter, color, options.showCanonicalEventCodes), color, options.eventFilter || 'ALL'),
      ...panel('◎ DECISION TERMINAL', width, Math.max(12, Math.min(18, topHeight)), candidateLines(snapshot, width - 2, color), color),
      ...panel('▥ CANDIDATE PIPELINE', width, 8, pipelineLines(snapshot, width - 2, color), color),
      ...panel(`■ ENTRY WATCH POOLS (${snapshot.entryWatchPools.length})`, width, Math.max(5, Math.min(10, snapshot.entryWatchPools.length + 4)), entryWatchLines(snapshot, width - 2, color), color),
      ...panel(`■ OPEN POSITIONS (${snapshot.activePools.length}/${snapshot.runtime.maxOpenPositions ?? 'n/a'})`, width, activeHeight, activePoolLines(snapshot, width - 2, color), color),
      ...panel('⚙ ENGINE DESK', width, engineHeight, engineLines(snapshot, width - 2, color), color),
      ...panel('▤ FILLS / RECENT POSITIONS', width, bottomHeight, recentPositionLines(snapshot, width - 2, options.positionFilter, color), color, options.positionFilter || 'ALL'),
      ...panel('♥ SYSTEM HEALTH', width, Math.max(10, bottomHeight), healthLines(snapshot, color), color)
    ];
    return [...header, divider, ...narrow, footer].join('\n');
  }
  const gap = 2;
  const left = Math.floor((width - gap * 2) * .45);
  const center = Math.floor((width - gap * 2) * .29);
  const rightWidth = width - left - center - gap * 2;
  const rightPipelineLines = pipelineLines(snapshot, rightWidth - 2, color);
  const pipelineHeight = Math.max(4, Math.min(7, rightPipelineLines.length + 2, topHeight - 5));
  const watchHeight = Math.max(5, topHeight - pipelineHeight);
  const rightTop = [
    ...panel('▥ CANDIDATE PIPELINE', rightWidth, pipelineHeight, rightPipelineLines, color),
    ...panel(`■ ENTRY WATCH POOLS (${snapshot.entryWatchPools.length})`, rightWidth, watchHeight, entryWatchLines(snapshot, rightWidth - 2, color), color)
  ];
  const top = joinPanels([
    panel('● LIVE EVENT STREAM', left, topHeight, eventRows(snapshot, left - 2, options.eventFilter, color, options.showCanonicalEventCodes), color, options.eventFilter || 'ALL'),
    panel('◎ DECISION TERMINAL', center, topHeight, candidateLines(snapshot, center - 2, color), color, snapshot.candidates.length ? `${snapshot.selectedCandidateIndex + 1}/${snapshot.candidates.length}` : '0/0'),
    rightTop
  ]);
  const lowerLeft = left + center + gap;
  const middle = joinPanels([
    panel(`■ OPEN POSITIONS (${snapshot.activePools.length}/${snapshot.runtime.maxOpenPositions ?? 'n/a'})`, lowerLeft, activeHeight, activePoolLines(snapshot, lowerLeft - 2, color), color),
    panel('⚙ AGENT / ENGINE DESK', rightWidth, engineHeight, engineLines(snapshot, rightWidth - 2, color), color, health.healthStatus || 'UNKNOWN')
  ]);
  const bottom = joinPanels([
    panel('▤ FILLS / RECENT POSITIONS', lowerLeft, bottomHeight, recentPositionLines(snapshot, lowerLeft - 2, options.positionFilter, color), color, options.positionFilter || 'ALL'),
    panel('♥ SYSTEM HEALTH', rightWidth, bottomHeight, healthLines(snapshot, color), color, health.healthStatus || 'UNKNOWN')
  ]);
  return [...header, divider, ...top, ...middle, ...bottom, footer].join('\n');
}

export function advanceCandidateIndex(snapshot: TerminalSnapshot, index: number, direction: -1 | 1): number {
  if (!snapshot.candidates.length) return 0;
  return (index + direction + snapshot.candidates.length) % snapshot.candidates.length;
}

export function nextEventFilter(value: TerminalRenderOptions['eventFilter'] = 'ALL'): NonNullable<TerminalRenderOptions['eventFilter']> {
  const filters: NonNullable<TerminalRenderOptions['eventFilter']>[] = ['ALL', 'POOLS', 'ENGINES', 'EXECUTION'];
  return filters[(filters.indexOf(value) + 1) % filters.length] ?? 'ALL';
}

export function nextPositionFilter(value: TerminalRenderOptions['positionFilter'] = 'ALL'): NonNullable<TerminalRenderOptions['positionFilter']> {
  const filters: NonNullable<TerminalRenderOptions['positionFilter']>[] = ['ALL', 'OPEN', 'CLOSED'];
  return filters[(filters.indexOf(value) + 1) % filters.length] ?? 'ALL';
}

export function nextMobileView(value: NonNullable<TerminalRenderOptions['mobileView']> = 'OVERVIEW'): NonNullable<TerminalRenderOptions['mobileView']> {
  return value === 'OVERVIEW' ? 'ACTIVITY' : 'OVERVIEW';
}
