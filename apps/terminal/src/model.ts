export type TerminalLevel = 'INFO' | 'WARN' | 'ERROR';

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
  reasonCodes: string[];
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
  selectedCandidateIndex: number;
  activePools: TerminalPosition[];
  recentPositions: TerminalRecentPosition[];
  engines: TerminalEngine[];
  events: TerminalEvent[];
}

export interface TerminalRenderOptions {
  columns: number;
  color: boolean;
  eventFilter?: 'ALL' | 'POOLS' | 'ENGINES' | 'EXECUTION' | undefined;
  positionFilter?: 'ALL' | 'OPEN' | 'CLOSED' | undefined;
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
  if (/(ERROR|FAILED|REJECT|NO_TRADE|CRITICAL|BLOCK)/.test(upper)) return /(ERROR|FAILED|CRITICAL)/.test(upper) ? 'red' : 'magenta';
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
function eventRows(snapshot: TerminalSnapshot, width: number, filter: TerminalRenderOptions['eventFilter'], color: boolean): string[] {
  const rows = snapshot.events.filter(e => !filter || filter === 'ALL' || eventCategory(e) === filter).slice(0, 18);
  if (!rows.length) return [paint('No canonical events in the current bounded window.', 'muted', color)];
  const eventWidth = Math.min(38, Math.max(18, width - 9 - 1 - 5 - 1 - 12 - 1 - 12 - 1));
  const head = `${pad('TIME', 9)} ${pad('LVL', 5)} ${pad('EVENT', eventWidth)} ${pad('ENTITY', 12)} MESSAGE`;
  const messageWidth = Math.max(12, width - 9 - 1 - 5 - 1 - eventWidth - 1 - 12 - 1);
  return [paint(head, 'muted', color), ...rows.map(row => {
    const time = new Date(row.observedAt).toISOString().slice(11, 19);
    const message = row.message || row.status;
    return `${pad(time, 9)} ${pad(state(row.level, color), 5)} ${pad(state(row.event, color), eventWidth)} ${pad(short(row.entityId), 12)} ${clip(message, messageWidth)}`;
  })];
}
function candidateLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const candidate = snapshot.candidates[snapshot.selectedCandidateIndex] || snapshot.candidates[0];
  if (!candidate) return [paint('No current canonical candidate cycle.', 'muted', color)];
  const range = candidate.lowerBinId === undefined || candidate.upperBinId === undefined ? 'n/a' : `${candidate.lowerBinId} → ${candidate.upperBinId}`;
  const lines = [
    `${paint('POOL', 'muted', color)}      ${state(candidate.poolDisplay, color)}`,
    `${paint('STATE', 'muted', color)}     ${state(candidate.operationalState, color)}`,
    `${paint('P4', 'muted', color)}        ${state(candidate.phase4State, color)}`,
    `${paint('RANGE', 'muted', color)}     ${range}`,
    `${paint('ACTIVE BIN', 'muted', color)} ${candidate.activeBinId ?? 'n/a'}`,
    `${paint('SCORE', 'muted', color)}     ${meter(candidate.confidence, Math.min(18, Math.max(8, width - 18)), color)} ${formatPercent(candidate.confidence, 0)}`,
    `${paint('UNCERTAINTY', 'muted', color)} ${meter(candidate.uncertainty, Math.min(18, Math.max(8, width - 18)), color, true)} ${candidate.uncertainty?.toFixed(2) ?? 'n/a'}`,
    `${paint('OOR RISK', 'muted', color)}  ${meter(candidate.oorRisk, Math.min(18, Math.max(8, width - 18)), color, true)} ${candidate.oorRisk?.toFixed(2) ?? 'n/a'}`,
    `${paint('NET EV', 'muted', color)}    ${candidate.riskAdjustedExpectedNetEv?.toFixed(6) ?? candidate.predictedNetEv?.toFixed(6) ?? 'n/a'}`,
    `${paint('REASONS', 'muted', color)}   ${clip(candidate.reasonCodes.join(', ') || '—', Math.max(8, width - 12))}`
  ];
  return lines;
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
function activePoolLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  if (!snapshot.activePools.length) return [paint('No active LP positions.', 'muted', color)];
  const head = `${pad('POOL', 14)} ${pad('STATE', 10)} ${pad('LIVE PNL', 10)} ${pad('LIVE PEAK', 10)} ${pad('RANGE', 15)} ALERT`;
  const alertWidth = Math.max(8, width - 14 - 1 - 10 - 1 - 10 - 1 - 10 - 1 - 15 - 1);
  return [paint(head, 'muted', color), ...snapshot.activePools.map(position => {
    const range = position.lowerBinId === undefined || position.upperBinId === undefined ? 'n/a' : `${position.lowerBinId}:${position.upperBinId} @${position.activeBinId ?? '?'}`;
    return `${pad(position.poolDisplay, 14)} ${pad(state(position.lifecycleState, color), 10)} ${pad(signedPercent(position.liveControlReturnFraction, color), 10)} ${pad(signedPercent(position.liveControlPeakReturnFraction, color), 10)} ${pad(range, 15)} ${clip(state(position.protection, color), alertWidth)}`;
  })];
}
function engineLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const head = `${pad('ENGINE', 13)} ${pad('STATUS', 14)} ${pad('AGE', 8)} INFO`;
  return [paint(head, 'muted', color), ...snapshot.engines.map(engine => `${pad(engine.name, 13)} ${pad(state(engine.status, color), 14)} ${pad(formatAge(engine.observedAt), 8)} ${clip(engine.detail || '—', Math.max(8, width - 39))}`)];
}
function recentPositionLines(snapshot: TerminalSnapshot, width: number, filter: TerminalRenderOptions['positionFilter'], color: boolean): string[] {
  const rows = snapshot.recentPositions.filter(row => !filter || filter === 'ALL' || row.state === filter).slice(0, 8);
  if (!rows.length) return [paint('No matching canonical lifecycle.', 'muted', color)];
  const head = `${pad('TIME', 8)} ${pad('POOL', 14)} ${pad('STATE', 7)} ${pad('SETTLED/LIVE', 12)} ${pad('AGE', 8)} REASON`;
  return [paint(head, 'muted', color), ...rows.map(row => {
    const time = new Date(row.observedAt).toISOString().slice(5, 16).replace('T', ' ');
    const label = row.state === 'OPEN' ? `LIVE ${formatPercent(row.liveControlReturnFraction)}` : formatPercent(row.realizedReturnFraction);
    const value = row.state === 'OPEN' ? label : signedPercent(row.realizedReturnFraction, color);
    return `${pad(time, 8)} ${pad(row.poolDisplay, 14)} ${pad(state(row.state, color), 7)} ${pad(value, 12)} ${pad(row.holdSeconds === undefined ? 'n/a' : formatAge(new Date(Date.now() - row.holdSeconds * 1000).toISOString()), 8)} ${clip(row.exitReason || (row.state === 'OPEN' ? 'LIVE CONTROL MARK' : 'n/a'), Math.max(8, width - 54))}`;
  })];
}
function healthLines(snapshot: TerminalSnapshot, color: boolean): string[] {
  const health = snapshot.health;
  return [
    `${paint('P7 MODE', 'muted', color)}        ${state(health.authorityMode, color)}`,
    `${paint('P7 HEALTH', 'muted', color)}      ${state(health.healthStatus, color)}`,
    `${paint('SAFETY', 'muted', color)}         ${state(health.safetyMode, color)}`,
    `${paint('NEW ENTRIES', 'muted', color)}    ${state(health.newEconomicActionAllowed ? 'ALLOWED' : 'BLOCKED', color)}`,
    `${paint('RECOVERY QUEUE', 'muted', color)} ${state(String(health.recoveryQueueCount), color)}`,
    `${paint('UNKNOWN TX', 'muted', color)}     ${state(String(health.unknownSubmissionCount), color)}`,
    `${paint('ACTIVE PLANS', 'muted', color)}   ${state(String(health.activeManagementPlans), color)}`,
    `${paint('PARTIAL ENTRY', 'muted', color)}  ${state(String(health.partialEntryRecoveryCount), color)}`,
    `${paint('INCIDENTS', 'muted', color)}      ${state(String(health.activeIncidentCount), color)}`,
    `${paint('TELEGRAM', 'muted', color)}       ${state(health.telegramStatus, color)}`
  ];
}

export function renderDecisionTerminal(snapshot: TerminalSnapshot, options: TerminalRenderOptions): string {
  const color = options.color;
  const width = Math.max(100, Math.min(220, options.columns));
  const health = snapshot.health;
  const headerStatus = health.healthStatus === 'HEALTHY' ? 'HEALTHY' : health.healthStatus || 'UNKNOWN';
  const header = [
    `${paint('LPForge', 'lime', color)}  ${paint('LPFORGE DECISION TERMINAL', 'bold', color)}  ${state(health.authorityMode || 'UNKNOWN', color)} | ${state(headerStatus, color)} | ${state(health.safetyMode || 'UNKNOWN', color)}`,
    `${paint('REFRESH 2s', 'muted', color)} | OPEN POSITIONS ${snapshot.activePools.length}/${snapshot.runtime.maxOpenPositions ?? 'n/a'} | CANDIDATES ${snapshot.candidates.length} | POLICY ${short(snapshot.runtime.policyVersion, 10, 0)} | ${paint('UTC', 'cyan', color)} ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
    `${paint(`SOLANA | ${snapshot.runtime.cluster.toUpperCase()} | RELEASE ${short(snapshot.runtime.releaseSha)} | POLICY HASH ${short(snapshot.runtime.policyHash)}`, 'muted', color)}`
  ].map(value => clip(value, width));
  const divider = paint('═'.repeat(width), 'muted', color);
  if (width < 135) {
    const narrow = [
      ...panel('● LIVE EVENT STREAM', width, 18, eventRows(snapshot, width - 2, options.eventFilter, color), color, options.eventFilter || 'ALL'),
      ...panel('◎ DECISION TERMINAL', width, 14, candidateLines(snapshot, width - 2, color), color),
      ...panel('▥ CANDIDATE PIPELINE', width, 8, pipelineLines(snapshot, width - 2, color), color),
      ...panel(`▰ ACTIVE POOLS (${snapshot.activePools.length})`, width, 7, activePoolLines(snapshot, width - 2, color), color),
      ...panel('⚙ ENGINE DESK', width, 11, engineLines(snapshot, width - 2, color), color),
      ...panel('▤ FILLS / RECENT POSITIONS', width, 10, recentPositionLines(snapshot, width - 2, options.positionFilter, color), color, options.positionFilter || 'ALL'),
      ...panel('♥ SYSTEM HEALTH', width, 12, healthLines(snapshot, color), color)
    ];
    return [...header, divider, ...narrow, paint('LPFORGE | SOLANA | METEORA DLMM | AUTONOMOUS LIQUIDITY', 'muted', color)].join('\n');
  }
  const gap = 2;
  const left = Math.floor((width - gap * 2) * .45);
  const center = Math.floor((width - gap * 2) * .29);
  const rightWidth = width - left - center - gap * 2;
  const top = joinPanels([
    panel('● LIVE EVENT STREAM', left, 22, eventRows(snapshot, left - 2, options.eventFilter, color), color, options.eventFilter || 'ALL'),
    panel('◎ DECISION TERMINAL', center, 22, candidateLines(snapshot, center - 2, color), color, snapshot.candidates.length ? `${snapshot.selectedCandidateIndex + 1}/${snapshot.candidates.length}` : '0/0'),
    panel('▥ CANDIDATE PIPELINE', rightWidth, 22, pipelineLines(snapshot, rightWidth - 2, color), color)
  ]);
  const lowerLeft = left + center + gap;
  const middle = joinPanels([
    panel(`▰ ACTIVE POOLS (${snapshot.activePools.length})`, lowerLeft, 11, activePoolLines(snapshot, lowerLeft - 2, color), color),
    panel('⚙ AGENT / ENGINE DESK', rightWidth, 11, engineLines(snapshot, rightWidth - 2, color), color, health.healthStatus || 'UNKNOWN')
  ]);
  const bottom = joinPanels([
    panel('▤ FILLS / RECENT POSITIONS', lowerLeft, 12, recentPositionLines(snapshot, lowerLeft - 2, options.positionFilter, color), color, options.positionFilter || 'ALL'),
    panel('♥ SYSTEM HEALTH', rightWidth, 12, healthLines(snapshot, color), color, health.healthStatus || 'UNKNOWN')
  ]);
  return [...header, divider, ...top, ...middle, ...bottom, paint('LPFORGE | SOLANA | METEORA DLMM | AUTONOMOUS LIQUIDITY', 'muted', color)].join('\n');
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
