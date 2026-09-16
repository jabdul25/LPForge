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
  /** Bounded, persisted evidence maturity facts; terminal display only. */
  marketObservationCount?: number | undefined;
  liveObservationCount?: number | undefined;
  liveConfirmationState?: string | undefined;
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
  /** Canonical closed-lifecycle SOL result, never used to drive a decision. */
  realizedPnlLamports?: bigint | undefined;
  /** LP-local live-control mark. Present only for OPEN rows. */
  liveControlReturnFraction?: number | undefined;
  feeLamports?: bigint | undefined;
  holdSeconds?: number | undefined;
  exitReason?: string | undefined;
  entryRange?: string | undefined;
  /** Confirmed Meteora-compatible high-water mark; never managed NAV. */
  liveControlPeakReturnFraction?: number | undefined;
  /** Live-control peak less canonical final settlement return; display-only. */
  liveControlPeakGivebackFraction?: number | undefined;
  lossClass?: string | undefined;
  protectionUsed?: string | undefined;
}

/**
 * The fills panel is an operational queue, not a pure timestamp feed. Keep
 * every live lifecycle visible before settled history, then retain newest
 * first ordering within each group. This is deliberately pure so a caller's
 * snapshot ordering is never mutated during rendering.
 */
export function orderTerminalRecentPositions(rows: TerminalRecentPosition[]): TerminalRecentPosition[] {
  return [...rows].sort((left, right) => {
    const stateOrder = Number(right.state === 'OPEN') - Number(left.state === 'OPEN');
    if (stateOrder !== 0) return stateOrder;
    const observedOrder = Date.parse(right.observedAt) - Date.parse(left.observedAt);
    if (Number.isFinite(observedOrder) && observedOrder !== 0) return observedOrder;
    return left.lifecycleId.localeCompare(right.lifecycleId);
  });
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
  /** Canonical reasons from the same P7 control decision that gates entries. */
  entryControlReasonCodes: string[];
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
  minimumIncludedBins?: number;
  maximumIncludedBins?: number;
}

/** Bounded UTC-day canonical-settlement aggregate; display-only. */
export interface TerminalDailyPerformance {
  trades: number;
  wins: number;
  losses: number;
  netPnlLamports?: bigint | undefined;
  feeLamports?: bigint | undefined;
  bestPool?: string | undefined;
  bestReturnFraction?: number | undefined;
  worstPool?: string | undefined;
  worstReturnFraction?: number | undefined;
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
  dailyPerformance?: TerminalDailyPerformance | undefined;
  engines: TerminalEngine[];
  events: TerminalEvent[];
}

export interface TerminalRenderOptions {
  columns: number;
  rows?: number | undefined;
  color: boolean;
  eventFilter?: 'ALL' | 'DECISIONS' | 'TRADES' | 'PROTECTIONS' | 'RISK' | 'ERRORS' | undefined;
  positionFilter?: 'ALL' | 'OPEN' | 'CLOSED' | undefined;
  /** Compact shell presentation selected only on phone-sized terminal widths. */
  mobileView?: 'OVERVIEW' | 'ACTIVITY' | undefined;
  /** Plain diagnostic output keeps durable event identities visible. */
  showCanonicalEventCodes?: boolean | undefined;
  interactive?: boolean | undefined;
}

/**
 * P7's global-selection collection pass intentionally disables plan
 * persistence while it evaluates every pool.  The operational runtime records
 * this fact as a canonical reason on an otherwise eligible candidate.  It is
 * not an entry-authority block: only the identity-locked winner gets a later
 * dispatch-capable construction pass.  Keep the raw reason on the snapshot
 * for diagnostics, but do not present this collection-pass implementation
 * detail as an operator-facing reason in the shell terminal.
 */
const TERMINAL_COLLECTION_PASS_ONLY_REASONS = new Set([
  'OPERATIONAL_PLAN_DISPATCH_DISABLED'
]);

/** Display-only projection; it never mutates canonical candidate reasons. */
export function operatorVisibleCandidateReasonCodes(candidate: TerminalCandidate): string[] {
  return candidate.reasonCodes.filter(code => !TERMINAL_COLLECTION_PASS_ONLY_REASONS.has(code));
}

const ansi = {
  reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', lime: '\u001b[38;5;154m', green: '\u001b[38;5;84m', cyan: '\u001b[38;5;80m', amber: '\u001b[38;5;220m', magenta: '\u001b[38;5;205m', red: '\u001b[31m', gray: '\u001b[38;5;250m', muted: '\u001b[38;5;245m'
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
function eventCategory(event: TerminalEvent): NonNullable<TerminalRenderOptions['eventFilter']> {
  const code = event.event.toUpperCase();
  if (event.level === 'ERROR') return 'ERRORS';
  if (/(PROFIT|TS5|OOR|HARD_STOP|EMERGENCY|PROTECTION|CLOSE_TRIGGERED)/.test(code)) return 'PROTECTIONS';
  if (event.entityType === 'POSITION' || /(?:POSITION_OPENED|POSITION_SETTLED|POSITION_CLOSED|EXECUTION_SUBMITTED)/.test(code)) return 'TRADES';
  if (/(P3|P4|NO_TRADE|CANDIDATE|DISCOVERY|ENTRY_|GLOBAL_SELECTION)/.test(code)) return 'DECISIONS';
  return 'RISK';
}
const EVENT_DISPLAY_ALIASES: Readonly<Record<string, string>> = {
  POSITION_LIVE_CONTROL_PNL_RESTORED: 'PNL_RESTORED',
  POSITION_LIVE_CONTROL_PNL_UNAVAILABLE: 'PNL_UNAVAILABLE',
  POSITION_OOR_STALE_CAPITAL: 'OOR_STALE_CAPITAL',
  POSITION_OOR_SUSTAINED: 'OOR_SUSTAINED',
  LPFORGE_RPC_USAGE_QUOTA_RECOVERED: 'RPC_QUOTA_RECOVERED',
  LPFORGE_RPC_USAGE_QUOTA_EXCEEDED: 'RPC_QUOTA_EXCEEDED',
  P6_EXECUTION_RECOVERY_PENDING: '[RECOVERY] verifying previous execution',
  P6_EXECUTION_SUBMISSION_UNKNOWN: 'P6_SUBMISSION_UNKNOWN',
  P6_EXECUTION_RECONCILED: 'P6_RECONCILED',
  POSITION_OPENED: '[POSITION OPENED]',
  POSITION_SETTLED: '[POSITION CLOSED]',
  POSITION_SETTLED_REPORT: '[POSITION CLOSED]',
  POSITION_CLOSE_TRIGGERED: '[PROTECTIVE CLOSE]'
};

export function displayEventCode(eventCode: string): string { return EVENT_DISPLAY_ALIASES[eventCode] || eventCode; }

function eventRows(snapshot: TerminalSnapshot, width: number, filter: TerminalRenderOptions['eventFilter'], color: boolean, showCanonical = false): string[] {
  const rows = snapshot.events.filter(e => !filter || filter === 'ALL' || eventCategory(e) === filter).slice(0, 18);
  if (!rows.length) return [paint('No canonical events in the current bounded window.', 'muted', color)];
  // Plain --once output is the diagnostic path. Preserve the complete stored
  // event identity there even when the visual dashboard reserves its width
  // for friendly description and entity context.
  if (showCanonical) {
    const eventWidth = Math.max(8, width - 9 - 1 - 5 - 1);
    return [paint(`${pad('TIME', 9)} ${pad('LVL', 5)} EVENT`, 'muted', color), ...rows.map(row => {
      const time = new Date(row.observedAt).toISOString().slice(11, 19);
      return `${pad(time, 9)} ${pad(state(row.level, color), 5)} ${clip(row.event, eventWidth)}`;
    })];
  }
  const entityWidth = Math.max(8, Math.min(10, Math.floor(width / 7)));
  const eventCap = 21;
  const eventWidth = Math.min(eventCap, Math.max(14, width - 9 - 1 - 5 - 1 - entityWidth - 1 - 18 - 1));
  const head = `${pad('TIME', 9)} ${pad('LVL', 5)} ${pad('EVENT', eventWidth)} ${pad('ENTITY', entityWidth)} MESSAGE`;
  const messageWidth = Math.max(12, width - 9 - 1 - 5 - 1 - eventWidth - 1 - entityWidth - 1);
  return [paint(head, 'muted', color), ...rows.map(row => {
    const time = new Date(row.observedAt).toISOString().slice(11, 19);
    const message = row.message || row.status;
    const event = displayEventCode(row.event);
    return `${pad(time, 9)} ${pad(state(row.level, color), 5)} ${pad(state(event, color), eventWidth)} ${pad(short(row.entityId, 5, 3), entityWidth)} ${clip(message, messageWidth)}`;
  })];
}
function candidateLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const candidate = snapshot.candidates[snapshot.selectedCandidateIndex] || snapshot.candidates[0];
  if (!candidate) return [paint('No current canonical candidate cycle.', 'muted', color)];
  const visibleReasons = operatorVisibleCandidateReasonCodes(candidate);
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
    `${paint('REASON', 'muted', color)}    ${clip(visibleReasons.join(', ') || '—', Math.max(8, width - 12))}`
  ];
}
function pipelineLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const totals = new Map<string, number>();
  for (const candidate of snapshot.candidates) totals.set(candidate.operationalState, (totals.get(candidate.operationalState) || 0) + 1);
  if (!totals.size && !snapshot.entryWatchPools.length) return [paint('No current candidate-cycle facts.', 'muted', color)];
  const filtered = snapshot.candidates.filter(candidate => candidate.operationalState !== 'REJECTED').length;
  const armed = snapshot.candidates.filter(candidate => candidate.phase4State === 'WAIT' || candidate.phase4State === 'ENTRY_READY').length;
  const ready = snapshot.candidates.filter(candidate => candidate.operationalState === 'ENTRY_READY' && candidate.phase4State === 'ENTRY_READY').length;
  const noTrade = snapshot.candidates.filter(candidate => candidate.operationalState === 'NO_TRADE').length;
  // This is deliberately a compact funnel rather than a bar chart. The
  // desktop panel is a decision summary; detailed candidate rows remain
  // available through the existing navigation and event views.
  return [
    `${paint('DISCOVERED', 'muted', color)} ${snapshot.candidates.length}  ${paint('FILTERED', 'muted', color)} ${filtered}  ${paint('WATCHING', 'muted', color)} ${snapshot.entryWatchPools.length}`,
    `${paint('ARMED', 'muted', color)} ${armed}  ${paint('ENTRY READY', 'muted', color)} ${ready}  ${paint('NO TRADE', 'muted', color)} ${noTrade}`
  ].map(value => clip(value, width));
}

/** Compact display-only synopsis of durable current candidate reasons. */
function nextWatchGate(candidate: TerminalCandidate): string {
  const visibleReasons = operatorVisibleCandidateReasonCodes(candidate);
  const reasons = visibleReasons.join('|');
  if (/RAW_REPLAY|REPLAY/.test(reasons)) return 'REPLAY';
  if (/P4|PHASE4/.test(reasons) || (candidate.operationalState === 'ENTRY_READY' && candidate.phase4State !== 'ENTRY_READY')) return 'P4';
  if (/CAPITAL/.test(reasons)) return 'CAPITAL';
  if (/UNCERTAINTY/.test(reasons)) return 'UNCERTAINTY';
  if (/RANGE/.test(reasons)) return 'RANGE';
  if (/LIVE_EVIDENCE|LIVE_CONFIRMATION|OBSERVATION|HISTORY/.test(reasons) || candidate.operationalState === 'WARMING') return 'MORE DATA';
  return visibleReasons[0] ? visibleReasons[0].replace(/^OPERATIONAL_/, '').replace(/^ENTRY_/, '') : '—';
}

/** Deterministic operator wording for durable decision/control reason codes. */
function explainReason(code: string | undefined): string {
  if (!code) return 'No executable candidate in the current cycle.';
  const upper = code.toUpperCase();
  if (/LIVE_CONFIRMATION|OBSERVATION|HISTORY|INSUFFICIENT.*EVIDENCE/.test(upper)) return 'Live confirmation window is still incomplete.';
  if (/UNCERTAINTY/.test(upper)) return 'Uncertainty remains above the entry allowance.';
  if (/NEGATIVE|NET_EV|ECONOMIC/.test(upper)) return 'Expected economics are not positive enough to enter.';
  if (/CAPITAL|POSITION_LIMIT|EXPOSURE/.test(upper)) return 'Capital or position capacity is currently unavailable.';
  if (/RECOVERY|UNKNOWN_SUBMISSION|RECONCILIATION/.test(upper)) return 'Recovery or reconciliation must finish before a new action.';
  if (/PAUS/.test(upper)) return 'Entries are paused by the operator control.';
  if (/HEALTH|SAFETY|RPC|INCIDENT/.test(upper)) return 'A current health or safety gate is preventing entries.';
  if (/RANGE/.test(upper)) return 'The proposed range did not meet the active range policy.';
  return code.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
}

function primaryCandidate(snapshot: TerminalSnapshot): TerminalCandidate | undefined {
  return snapshot.candidates[snapshot.selectedCandidateIndex] || snapshot.candidates[0] || snapshot.entryWatchPools[0];
}
function primaryBlockerCode(snapshot: TerminalSnapshot): string | undefined {
  if (snapshot.health.newEconomicActionAllowed === false) return snapshot.health.entryControlReasonCodes[0];
  const candidate = primaryCandidate(snapshot);
  return candidate ? operatorVisibleCandidateReasonCodes(candidate)[0] : undefined;
}
function currentBlockerLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const code = primaryBlockerCode(snapshot);
  const candidate = primaryCandidate(snapshot);
  const entryAllowed = snapshot.health.newEconomicActionAllowed !== false;
  return [
    `${paint('ENTRY', 'muted', color)}       ${state(entryAllowed ? 'ENABLED' : 'DISABLED', color)}`,
    `${paint('STATE / REASON', 'muted', color)} ${state(entryAllowed ? candidate?.operationalState || 'SEARCHING' : 'BLOCKED', color)} — ${clip(explainReason(code), Math.max(8, width - 25))}`,
    `${paint('OBSERVATIONS', 'muted', color)} ${candidate?.liveObservationCount ?? '—'} live / ${candidate?.marketObservationCount ?? '—'} market${candidate?.liveConfirmationState ? ` (${candidate.liveConfirmationState})` : ''}`,
    `${paint('NEXT CHECK', 'muted', color)}   next normal evaluation cycle`,
    `${paint('RAW CODE', 'muted', color)}     ${clip(code || 'NO_EXECUTABLE_CANDIDATE', Math.max(8, width - 14))}`,
    `${paint('OPERATOR', 'muted', color)}     ${clip(code ? explainReason(code) : 'Discovery continues observing; no action required.', Math.max(8, width - 14))}`
  ];
}
function decisionPipelineLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const candidate = primaryCandidate(snapshot);
  if (!candidate) return [paint('Discovery is searching; no current candidate snapshot.', 'muted', color)];
  const code = operatorVisibleCandidateReasonCodes(candidate)[0];
  const ev = candidate.riskAdjustedExpectedNetEv ?? candidate.predictedNetEv;
  return [
    `${paint('POOL', 'muted', color)}        ${state(candidate.poolDisplay, color)}`,
    `${paint('STATUS', 'muted', color)}      ${state(candidate.operationalState === 'WARMING' ? 'OBSERVING' : candidate.operationalState, color)}  ${paint('PHASE', 'muted', color)} ${state(candidate.phase4State === 'ENTRY_READY' ? 'P4' : 'P3', color)} → ${state(candidate.phase4State, color)}`,
    `${paint('NEXT GATE', 'muted', color)}   ${state(nextWatchGate(candidate), color)}`,
    `${paint('BLOCKER', 'muted', color)}     ${clip(explainReason(code), Math.max(8, width - 14))}`,
    `${paint('OBS', 'muted', color)}         ${candidate.liveObservationCount ?? '—'} live / ${candidate.marketObservationCount ?? '—'} market${candidate.liveConfirmationState ? ` (${candidate.liveConfirmationState})` : ''}`,
    `${paint('SCORE / UNCERTAINTY', 'muted', color)} ${candidate.confidence === undefined ? '—' : candidate.confidence.toFixed(2)} / ${candidate.uncertainty === undefined ? '—' : candidate.uncertainty.toFixed(2)}`,
    `${paint('NET EV', 'muted', color)}      ${signedSol(ev, color)}`
  ];
}
function topBlockerLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const counts = new Map<string, number>();
  for (const candidate of [...snapshot.candidates, ...snapshot.entryWatchPools]) {
    const code = operatorVisibleCandidateReasonCodes(candidate)[0];
    if (code) counts.set(code, (counts.get(code) || 0) + 1);
  }
  if (snapshot.health.newEconomicActionAllowed === false) {
    for (const code of snapshot.health.entryControlReasonCodes) counts.set(code, (counts.get(code) || 0) + 1);
  }
  const rows = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 3);
  return rows.length ? rows.map(([code, count], index) => `${index + 1}. ${clip(explainReason(code), Math.max(8, width - 8))} ${paint(`(${count})`, 'muted', color)}`) : [paint('No durable blocker reason in the current snapshot.', 'muted', color)];
}
function operatorExplanationLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const code = primaryBlockerCode(snapshot);
  const candidateCount = snapshot.candidates.length;
  const watchCount = snapshot.entryWatchPools.length;
  const entry = snapshot.health.newEconomicActionAllowed === false ? 'New entries are currently blocked by P7.' : 'LPForge is waiting for an executable setup.';
  return [
    state(entry, color),
    `${candidateCount} current candidate${candidateCount === 1 ? '' : 's'}; ${watchCount} watch pool${watchCount === 1 ? '' : 's'}.`,
    clip(code ? `Primary blocker: ${explainReason(code)}` : 'No action is required while Discovery continues observing.', width),
    paint('No trading decision is made by this terminal.', 'muted', color)
  ];
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

function rangeLabel(position: TerminalPosition): string {
  if (position.oorDirection === 'BELOW_MIN' || position.rangeState === 'BELOW_MIN') return 'BELOW_MIN WARNING';
  if (position.oorDirection === 'ABOVE_MAX' || position.rangeState === 'ABOVE_MAX') return 'ABOVE_MAX';
  if (position.rangeState === 'LOWER_EDGE') return 'NEAR LOWER EDGE';
  return position.rangeState === 'IN_RANGE' ? 'IN RANGE' : position.rangeState || 'UNKNOWN';
}
function riskLabel(position: TerminalPosition): string {
  const range = rangeLabel(position);
  if (/BELOW_MIN|ABOVE_MAX/.test(range) || position.lifecycleState === 'CLOSING') return 'CRITICAL';
  if (/LOWER EDGE|LOWER_THIRD|RECONCILIATION|UNKNOWN/.test(`${range} ${position.lifecycleState} ${position.valuationState || ''}`)) return 'ELEVATED';
  return 'NORMAL';
}
function nextActionLabel(position: TerminalPosition): string {
  if (position.lifecycleState === 'CLOSING') return 'CLOSE IN PROGRESS';
  if (position.reconciliationStatus !== 'MATCH' && position.reconciliationStatus !== 'HEALTHY') return 'RECONCILE';
  if (position.protection !== 'NONE') return 'MONITOR PROTECTION';
  return 'WAIT';
}
/** Existing bin facts expressed as a display-only distance to either range edge. */
function edgeDistanceLabel(position: TerminalPosition): string {
  if (position.lowerBinId === undefined || position.upperBinId === undefined || position.activeBinId === undefined) return '—';
  return `L ${position.activeBinId - position.lowerBinId} / U ${position.upperBinId - position.activeBinId}`;
}
function activePoolLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  if (!snapshot.activePools.length) return [paint('No open LP positions.', 'muted', color)];
  if (width < 150) return snapshot.activePools.flatMap(position => {
    const range = position.lowerBinId === undefined || position.upperBinId === undefined ? '—' : `${position.lowerBinId}–${position.upperBinId}`;
    return [
      `${state(position.poolDisplay, color)}  ${paint('RANGE', 'muted', color)} ${range}  ${paint('BIN', 'muted', color)} ${position.activeBinId ?? '—'}`,
      `${paint('PNL', 'muted', color)} ${signedPercent(position.liveControlReturnFraction, color)}  ${paint('AGE', 'muted', color)} ${formatAge(position.enteredAt)}  ${paint('EDGE', 'muted', color)} ${edgeDistanceLabel(position)}  ${state(rangeLabel(position), color)} / ${state(riskLabel(position), color)}`,
      `${paint('PROTECTION', 'muted', color)} ${state(position.protection, color)}  → ${state(nextActionLabel(position), color)}`
    ];
  });
  const head = `${pad('POOL', 14)} ${pad('ENTRY RANGE', 15)} ${pad('CURRENT BIN', 11)} ${pad('CURRENT PNL', 12)} ${pad('AGE', 8)} ${pad('RANGE STATE', 20)} ${pad('DIST TO LOWER / UPPER', 22)} ${pad('RISK STATE', 12)} ${pad('ACTIVE PROTECTION', 21)} NEXT ACTION`;
  const actionWidth = Math.max(8, width - 14 - 1 - 15 - 1 - 11 - 1 - 12 - 1 - 8 - 1 - 20 - 1 - 22 - 1 - 12 - 1 - 21 - 1);
  return [paint(head, 'muted', color), ...snapshot.activePools.map(position => {
    const range = position.lowerBinId === undefined || position.upperBinId === undefined ? '—' : `${position.lowerBinId}–${position.upperBinId}`;
    return `${pad(position.poolDisplay, 14)} ${pad(range, 15)} ${pad(String(position.activeBinId ?? '—'), 11)} ${pad(signedPercent(position.liveControlReturnFraction, color), 12)} ${pad(formatAge(position.enteredAt), 8)} ${pad(state(rangeLabel(position), color), 20)} ${pad(edgeDistanceLabel(position), 22)} ${pad(state(riskLabel(position), color), 12)} ${pad(state(position.protection, color), 21)} ${clip(state(nextActionLabel(position), color), actionWidth)}`;
  })];
}

function economicEngineLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const candidate = primaryCandidate(snapshot);
  if (!candidate) return [paint('No current economic evaluation.', 'muted', color)];
  const expectedFee = candidate.predictedGrossFees;
  const netEv = candidate.riskAdjustedExpectedNetEv ?? candidate.predictedNetEv;
  return [
    `${paint('POOL', 'muted', color)}          ${state(candidate.poolDisplay, color)}`,
    `${paint('EXPECTED FEE', 'muted', color)}  ${signedSol(expectedFee, color)}`,
    `${paint('EXPECTED RISK', 'muted', color)} ${candidate.oorRisk === undefined ? '—' : formatPercent(-Math.abs(candidate.oorRisk))}`,
    `${paint('NET EV', 'muted', color)}        ${signedSol(netEv, color)}`,
    `${paint('DECISION', 'muted', color)}      ${state(candidate.phase4State === 'ENTRY_READY' && netEv !== undefined && netEv > 0 ? 'ENTRY READY' : 'NO TRADE / WAIT', color)}`,
    `${paint('SOURCE', 'muted', color)}        existing P4 candidate facts`
  ];
}

function closedRecent(snapshot: TerminalSnapshot, limit: number): TerminalRecentPosition[] {
  return snapshot.recentPositions.filter(position => position.state === 'CLOSED').slice(0, limit);
}
function average(values: number[]): number | undefined {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : undefined;
}
function rangeMonitorLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const rows = closedRecent(snapshot, 20);
  const ranges = rows.map(row => {
    const [lower, upper] = (row.entryRange || '').split('–').map(Number);
    return lower !== undefined && upper !== undefined && Number.isFinite(lower) && Number.isFinite(upper) ? upper - lower + 1 : undefined;
  }).filter((value): value is number => value !== undefined);
  const below = rows.filter(row => row.lossClass === 'BELOW_MIN INVENTORY').length;
  const above = rows.filter(row => row.lossClass === 'ABOVE_MAX EXIT').length;
  const inRange = rows.length - below - above;
  const mostCommon = [...new Map(rows.filter(row => row.lossClass && row.lossClass !== 'WIN').map(row => [row.lossClass!, 0])).keys()]
    .map(name => [name, rows.filter(row => row.lossClass === name).length] as const)
    .sort((left, right) => right[1] - left[1])[0]?.[0] || 'NO CLOSED LOSS CLASS';
  return [
    `${paint('ACTIVE POLICY', 'muted', color)} ${snapshot.runtime.minimumIncludedBins ?? '—'}–${snapshot.runtime.maximumIncludedBins ?? '—'} bins`,
    `${paint('LAST CLOSED', 'muted', color)} ${rows.length}  ${paint('AVG RANGE', 'muted', color)} ${average(ranges) === undefined ? '—' : `${average(ranges)!.toFixed(1)} bins`}`,
    `${paint('BELOW_MIN', 'muted', color)} ${below}  ${paint('ABOVE_MAX', 'muted', color)} ${above}  ${paint('NO OBSERVED OOR', 'muted', color)} ${inRange}/${rows.length || '—'}`,
    `${paint('OBSERVED LOSS PATH', 'muted', color)} ${clip(mostCommon, Math.max(8, width - 22))}`
  ].map(value => clip(value, width));
}

function positionHealthLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const rows = closedRecent(snapshot, 10);
  const winners = rows.filter(row => (row.realizedReturnFraction ?? 0) > 0);
  const losers = rows.filter(row => (row.realizedReturnFraction ?? 0) < 0);
  const net = rows.reduce((total, row) => total + (row.realizedPnlLamports || 0n), 0n);
  const causes = new Map<string, number>();
  for (const row of losers) if (row.lossClass) causes.set(row.lossClass, (causes.get(row.lossClass) || 0) + 1);
  const topCause = [...causes.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 2);
  return [
    `${paint('LAST 10 CLOSED', 'muted', color)} ${rows.length}`,
    `${paint('WIN RATE', 'muted', color)}       ${winners.length}/${rows.length || '—'}`,
    `${paint('AVERAGE WIN', 'muted', color)}    ${signedPercent(average(winners.map(row => row.realizedReturnFraction!).filter(Number.isFinite)), color)}`,
    `${paint('AVERAGE LOSS', 'muted', color)}   ${signedPercent(average(losers.map(row => row.realizedReturnFraction!).filter(Number.isFinite)), color)}`,
    `${paint('NET', 'muted', color)}            ${formatSolLamports(net)}`,
    ...(topCause.length ? topCause.map(([cause, count], index) => `${paint(`OBSERVED PATH ${index + 1}`, 'muted', color)} ${clip(`${cause} (${count})`, Math.max(8, width - 20))}`) : [paint('No closed losses in the bounded window.', 'muted', color)])
  ];
}

function dailyPerformanceLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const daily = snapshot.dailyPerformance;
  if (!daily) return [paint('No daily aggregate available.', 'muted', color)];
  return [
    `${paint('TRADES', 'muted', color)}   ${daily.trades}   ${paint('WIN', 'muted', color)} ${daily.wins}   ${paint('LOSS', 'muted', color)} ${daily.losses}`,
    `${paint('WIN RATE', 'muted', color)} ${daily.trades ? `${((daily.wins / daily.trades) * 100).toFixed(0)}%` : '—'}`,
    `${paint('NET PNL', 'muted', color)}  ${formatSolLamports(daily.netPnlLamports)}`,
    `${paint('FEES', 'muted', color)}     ${formatSolLamports(daily.feeLamports)}`,
    `${paint('BEST', 'muted', color)}     ${daily.bestPool ? short(daily.bestPool) : '—'} ${formatPercent(daily.bestReturnFraction)}`,
    `${paint('WORST', 'muted', color)}    ${daily.worstPool ? short(daily.worstPool) : '—'} ${formatPercent(daily.worstReturnFraction)}`
  ].map(line => clip(line, width));
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

/**
 * The lifecycle query already supplies `observedAt` as the opening timestamp
 * for OPEN rows and the canonical settlement timestamp for CLOSED rows. This
 * function only formats that existing authority for a compact table cell.
 */
function terminalTimestamp(row: TerminalRecentPosition): string {
  const at = new Date(row.observedAt);
  if (!Number.isFinite(at.getTime())) return 'TIME N/A';
  const clock = `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][at.getUTCMonth()];
  return `${month} ${String(at.getUTCDate()).padStart(2, '0')} ${clock}`;
}

function recentPositionLines(snapshot: TerminalSnapshot, width: number, filter: TerminalRenderOptions['positionFilter'], color: boolean): string[] {
  const rows = snapshot.recentPositions.filter(row => !filter || filter === 'ALL' || row.state === filter).slice(0, 8);
  if (!rows.length) return [paint('No matching canonical lifecycle.', 'muted', color)];
  const compact = width < 154;
  const head = compact
    ? `${pad('TIME', 13)} ${pad('STATUS', 8)} ${pad('POOL', 10)} ${pad('RANGE', 13)} ${pad('RETURN', 10)} ${pad('LIVE PEAK', 9)} ${pad('PEAK GAP', 8)} PATH / RECORDED REASON`
    : `${pad('TIME', 13)} ${pad('STATUS', 10)} ${pad('POOL', 11)} ${pad('ENTRY RANGE', 13)} ${pad('EXIT TYPE', 14)} ${pad('RETURN', 10)} ${pad('LIVE-CONTROL PEAK', 17)} ${pad('PEAK GIVEBACK', 14)} ${pad('OBSERVED LOSS PATH', 22)} RECORDED EXIT/PROTECTION REASON`;
  return [paint(head, 'muted', color), ...rows.map(row => {
    const rawReturn = row.state === 'OPEN' ? row.liveControlReturnFraction : row.realizedReturnFraction;
    const outcomeColor: 'red' | 'green' | undefined = rawReturn !== undefined
      ? rawReturn < 0 ? 'red' : row.state === 'CLOSED' && rawReturn > 0 ? 'green' : undefined
      : undefined;
    // Every negative return is a single red row; settled gains are green.
    // Disable per-cell ANSI in that case so a nested reset cannot break it.
    const cellColor = outcomeColor ? false : color;
    const value = signedPercent(rawReturn, cellColor);
    const status = row.state === 'OPEN'
      ? paint('● LIVE', outcomeColor ? 'red' : 'green', cellColor)
      : paint('✓ CLOSED', 'muted', cellColor);
    const range = row.entryRange || '—';
    const peak = row.liveControlPeakReturnFraction === undefined ? paint('UNAVAILABLE', 'muted', cellColor) : signedPercent(row.liveControlPeakReturnFraction, cellColor);
    const gap = row.liveControlPeakGivebackFraction === undefined ? paint('N/A', 'muted', cellColor) : signedPercent(row.liveControlPeakGivebackFraction, cellColor);
    const time = terminalTimestamp(row);
    const line = compact
      ? `${pad(time, 13)} ${pad(status, 8)} ${pad(row.poolDisplay, 10)} ${pad(range, 13)} ${pad(value, 10)} ${pad(peak, 9)} ${pad(gap, 8)} ${clip(row.state === 'OPEN' ? row.protectionUsed || 'LIVE' : `${row.lossClass || '—'} / ${row.protectionUsed || '—'}`, Math.max(8, width - 75))}`
      : `${pad(time, 13)} ${pad(status, 10)} ${pad(row.poolDisplay, 11)} ${pad(range, 13)} ${pad(row.exitReason || (row.state === 'OPEN' ? 'LIVE' : '—'), 14)} ${pad(value, 10)} ${pad(peak, 17)} ${pad(gap, 14)} ${pad(row.lossClass || '—', 22)} ${clip(row.protectionUsed || '—', Math.max(8, width - 144))}`;
    return outcomeColor ? paint(line, outcomeColor, color) : line;
  })];
}
function entryBlockSummary(health: TerminalHealth): string | undefined {
  if (health.newEconomicActionAllowed !== false) return undefined;
  const decisive = health.entryControlReasonCodes.filter(code => /(?:BLOCK|DRAWDOWN|RECOVERY|UNKNOWN|RECONCILIATION|PAUS|LIMIT|EXPOSURE|RESERVE|RELEASE|IDENTITY|INCIDENT|HEALTH|SAFETY|EMERGENCY|EXPIRED|REVOKED|MISSING|MISMATCH)/.test(code));
  const selected = decisive.length ? decisive : health.entryControlReasonCodes;
  if (!selected.length) return 'P7_CONTROL_REASON_UNAVAILABLE';
  return selected.map(code => {
    if (code === 'P7_PORTFOLIO_DAILY_DRAWDOWN') return 'DAILY DRAWDOWN LIMIT';
    if (code === 'P7_PORTFOLIO_ROLLING_DRAWDOWN') return 'ROLLING DRAWDOWN LIMIT';
    if (code === 'P7_PORTFOLIO_POSITION_LIMIT' || code === 'P7_PLAN_OPEN_POSITION_LIMIT') return 'POSITION CAP REACHED';
    if (code === 'P7_CONTROL_RECOVERY_PENDING') return 'RECOVERY PENDING';
    return code;
  }).join(', ');
}

/**
 * Complete health facts arranged for the terminal's status column. This is a
 * presentation-only compaction: every value remains sourced from the same
 * bounded health snapshot and no control state is inferred or altered.
 */
function healthLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const health = snapshot.health;
  const entryBlock = entryBlockSummary(health);
  return [
    `${paint('P7 MODE', 'muted', color)} ${state(health.authorityMode, color)} | ${paint('P7 HEALTH', 'muted', color)} ${state(health.healthStatus, color)}`,
    `${paint('SAFETY', 'muted', color)} ${state(health.safetyMode, color)} | ${paint('NEW ENTRIES', 'muted', color)} ${state(health.newEconomicActionAllowed ? 'ALLOWED' : 'BLOCKED', color)}`,
    ...(entryBlock ? [`${paint('ENTRY BLOCK', 'muted', color)} ${state(entryBlock, color)}`] : []),
    ...rpcLines(snapshot, color),
    `${paint('RECOVERY QUEUE', 'muted', color)} ${state(String(health.recoveryQueueCount), color)} | ${paint('UNKNOWN TX', 'muted', color)} ${state(String(health.unknownSubmissionCount), color)}`,
    `${paint('ACTIVE PLANS', 'muted', color)} ${state(String(health.activeManagementPlans), color)} | ${paint('PARTIAL ENTRY', 'muted', color)} ${state(String(health.partialEntryRecoveryCount), color)}`,
    `${paint('INCIDENTS', 'muted', color)} ${state(String(health.activeIncidentCount), color)} | ${paint('TELEGRAM', 'muted', color)} ${state(health.telegramStatus, color)}`,
    `${paint('RELEASE SHA', 'muted', color)} ${paint(short(snapshot.runtime.releaseSha), 'cyan', color)} | ${paint('POLICY', 'muted', color)} ${paint(short(snapshot.runtime.policyHash), 'cyan', color)}`,
    ...(entryBlock ? [`${paint('ENTRY BLOCK', 'muted', color)} ${state(entryBlock, color)}`] : [])
  ].map(line => clip(line, width));
}

function compactDailyPerformanceLines(snapshot: TerminalSnapshot, width: number, color: boolean): string[] {
  const daily = snapshot.dailyPerformance;
  if (!daily) return [paint('No daily aggregate available.', 'muted', color)];
  return [
    `${paint('NET PNL', 'muted', color)} ${formatSolLamports(daily.netPnlLamports)} | ${paint('TRADES', 'muted', color)} ${daily.trades} | ${paint('WIN', 'muted', color)} ${daily.wins} | ${paint('LOSS', 'muted', color)} ${daily.losses} | ${paint('WIN RATE', 'muted', color)} ${daily.trades ? `${((daily.wins / daily.trades) * 100).toFixed(0)}%` : '—'}`,
    `${paint('FEES', 'muted', color)} ${formatSolLamports(daily.feeLamports)} | ${paint('BEST', 'muted', color)} ${daily.bestPool ? short(daily.bestPool) : '—'} ${formatPercent(daily.bestReturnFraction)} | ${paint('WORST', 'muted', color)} ${daily.worstPool ? short(daily.worstPool) : '—'} ${formatPercent(daily.worstReturnFraction)}`
  ].map(line => clip(line, width));
}

function operatorLastAction(event: TerminalEvent | undefined): string {
  if (!event) return 'WAITING - DISCOVERY';
  const code = event.event.toUpperCase();
  if (/PNL_UNAVAILABLE/.test(code)) return 'WAITING - LIVE PNL REFRESH';
  if (/RECOVERY|RECONCIL/.test(code)) return 'WAITING - RECOVERY CHECK';
  if (/P4|ECONOMIC|NO_TRADE|CANDIDATE|ENTRY_/.test(code)) return 'WAITING - ECONOMIC VALIDATION';
  if (/POSITION_OPENED/.test(code)) return 'POSITION OPENED';
  if (/POSITION_SETTLED|POSITION_CLOSED/.test(code)) return 'POSITION CLOSED';
  if (/CLOSE_TRIGGERED|PROTECTION/.test(code)) return 'PROTECTIVE CLOSE';
  return displayEventCode(event.event);
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
  return snapshot.activePools.slice(0, Math.max(1, limit)).map(position => clip(`${state(position.poolDisplay, color)} ${state(position.lifecycleState, color)} ${signedPercent(position.liveControlReturnFraction, color)} ${paint('PK', 'muted', color)} ${signedPercent(position.liveControlPeakReturnFraction, color)} ${paint('FEE', 'muted', color)} ${formatSolLamports(position.feeLamports)} ${state(position.protection, color)}`, width));
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
    return clip(`${paint(terminalTimestamp(position), 'muted', color)} ${state(position.poolDisplay, color)} ${state(position.state, color)} ${coloured}`, width);
  });
}

function compactEngineLines(snapshot: TerminalSnapshot, width: number, color: boolean, limit: number): string[] {
  return snapshot.engines.slice(0, Math.max(1, limit)).map(engine => clip(`${paint(engine.name, 'muted', color)} ${state(engine.status, color)} ${paint(formatAge(engine.observedAt), 'muted', color)}`, width));
}

function compactSystemLines(snapshot: TerminalSnapshot, width: number, color: boolean, limit: number): string[] {
  const health = snapshot.health;
  const entryBlock = entryBlockSummary(health);
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
    ...(entryBlock ? [`${paint('BLOCK', 'muted', color)} ${state(entryBlock, color)}`] : []),
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
    append('◎ DECISION PIPELINE', decisionPipelineLines(snapshot, width, color), 5);
    append('! CURRENT BLOCKER', currentBlockerLines(snapshot, width, color), 3);
    append('✦ OPERATOR EXPLANATION', operatorExplanationLines(snapshot, width, color), 2);
    append(`■ ENTRY WATCH (${snapshot.entryWatchPools.length})`, compactWatchLines(snapshot, width, color, bodyBudget >= 20 ? 3 : 2), 3);
    append(`■ OPEN POSITIONS (${snapshot.activePools.length}/${snapshot.runtime.maxOpenPositions ?? 'n/a'})`, compactOpenPositionLines(snapshot, width, color, 2), 2);
    append('▥ CANDIDATE PIPELINE', [...compactPipelineLines(snapshot, width, color), ...topBlockerLines(snapshot, width, color)], 2);
    append('♥ SYSTEM HEALTH', healthLines(snapshot, width, color), health.newEconomicActionAllowed === false ? 13 : 12);
  } else {
    append(`● LIVE EVENTS ${options.eventFilter || 'ALL'}`, compactEventLines(snapshot, width, options.eventFilter, color, bodyBudget >= 20 ? 6 : 4, options.showCanonicalEventCodes), 5);
    append(`▤ RECENT POSITIONS ${options.positionFilter || 'ALL'}`, compactRecentPositionLines(snapshot, width, options.positionFilter, color, bodyBudget >= 20 ? 5 : 3), 4);
    append('⚙ ENGINE DESK', compactEngineLines(snapshot, width, color, 3), 3);
    append('◫ RANGE MONITOR', rangeMonitorLines(snapshot, width, color), 2);
    append('♥ SYSTEM HEALTH', healthLines(snapshot, width, color), health.newEconomicActionAllowed === false ? 13 : 12);
  }
  return [...header, paint('─'.repeat(width), 'muted', color), ...body.slice(0, bodyBudget), footer].join('\n');
}

export function renderDecisionTerminal(snapshot: TerminalSnapshot, options: TerminalRenderOptions): string {
  const color = options.color;
  if (options.columns < 100) return renderMobileDecisionTerminal(snapshot, options);
  const width = Math.max(100, Math.min(220, options.columns));
  const rows = Math.max(30, Math.min(80, Math.floor(options.rows ?? 50)));
  const health = snapshot.health;
  const terminalStatus = health.newEconomicActionAllowed === false ? 'PAUSED' : snapshot.activePools.length ? 'MANAGING' : snapshot.candidates.length || snapshot.entryWatchPools.length ? 'SEARCHING' : 'ACTIVE';
  const lastAction = operatorLastAction(snapshot.events[0]);
  const header = [
    `${paint('LPFORGE DECISION TERMINAL', 'lime', color)}  ${paint('MODE', 'muted', color)} ${state(health.authorityMode || 'UNKNOWN', color)}  ${paint('STATUS', 'muted', color)} ${state(terminalStatus, color)}  ${paint('SAFETY', 'muted', color)} ${state(health.safetyMode || 'UNKNOWN', color)}  ${paint('ENTRY', 'muted', color)} ${state(health.newEconomicActionAllowed === false ? 'DISABLED' : 'ENABLED', color)}`,
    `${paint(`OPEN POSITIONS ${snapshot.activePools.length}/${snapshot.runtime.maxOpenPositions ?? 'n/a'}`, 'cyan', color)}  ${paint(`WATCH POOLS ${snapshot.entryWatchPools.length}`, 'amber', color)}  ${paint(`CANDIDATES ${snapshot.candidates.length}`, 'cyan', color)}  ${paint('LAST ACTION', 'muted', color)} ${state(lastAction, color)}  ${state(rpcSummary(snapshot), color)}  ${paint(`UTC ${new Date().toISOString().slice(11, 19)}`, 'muted', color)}`
  ].map(value => clip(value, width));
  const divider = paint('═'.repeat(width), 'muted', color);
  const panelRows = Math.max(25, rows - header.length - 2);
  // Keep the intelligence panels concise. Their detail is intentionally
  // available through candidate navigation and the expanded event stream,
  // rather than consuming the operator's entire viewport.
  const topHeight = Math.max(9, Math.floor(panelRows * .20));
  const middleHeight = Math.max(9, Math.floor(panelRows * .20));
  const openPanelHeight = Math.max(6, snapshot.activePools.length + 4);
  const bottomHeight = Math.max(10, panelRows - topHeight - middleHeight - openPanelHeight);
  const help = 'q quit  h/l candidate  e events  f fills  r refresh';
  const identity = 'LPFORGE | SOLANA | METEORA DLMM | READ-ONLY';
  const helpText = clip(help, Math.max(0, width - identity.length - 1));
  const footer = options.interactive
    ? `${paint(helpText, 'muted', color)}${right(paint(identity, 'muted', color), Math.max(0, width - visible(helpText).length))}`
    : paint(identity, 'muted', color);
  if (width < 190) {
    const narrow = [
      ...panel(`● EVENT STREAM ${options.eventFilter || 'ALL'}`, width, 9, eventRows(snapshot, width - 2, options.eventFilter, color, options.showCanonicalEventCodes), color),
      ...panel('◎ DECISION PIPELINE', width, 9, decisionPipelineLines(snapshot, width - 2, color), color),
      ...panel('! CURRENT BLOCKER / OPERATOR EXPLANATION', width, 9, currentBlockerLines(snapshot, width - 2, color), color),
      ...panel('⚙ ECONOMIC ENGINE', width, 9, economicEngineLines(snapshot, width - 2, color), color),
      ...panel('▥ CANDIDATE PIPELINE / TOP BLOCKERS', width, 9, [...pipelineLines(snapshot, width - 2, color), ...topBlockerLines(snapshot, width - 2, color)], color),
      ...panel('◫ RANGE MONITOR', width, 9, rangeMonitorLines(snapshot, width - 2, color), color),
      ...panel(`■ OPEN POSITIONS (${snapshot.activePools.length}/${snapshot.runtime.maxOpenPositions ?? 'n/a'})`, width, openPanelHeight, activePoolLines(snapshot, width - 2, color), color),
      ...panel('♥ SYSTEM HEALTH', width, health.newEconomicActionAllowed === false ? 13 : 12, healthLines(snapshot, width - 2, color), color),
      ...panel('▤ FILLS / RECENT POSITIONS', width, bottomHeight, recentPositionLines(snapshot, width - 2, options.positionFilter, color), color, options.positionFilter || 'ALL'),
      ...panel('♥ POSITION HEALTH', width, 9, positionHealthLines(snapshot, width - 2, color), color)
    ];
    return [...header, divider, ...narrow, footer].join('\n');
  }
  const gap = 2;
  const topAvailable = width - gap * 2;
  const decisionWidth = Math.floor(topAvailable * .38);
  const blockerWidth = Math.floor(topAvailable * .31);
  const economicWidth = topAvailable - decisionWidth - blockerWidth;
  const left = Math.floor((width - gap * 2) * .35);
  const center = Math.floor((width - gap * 2) * .32);
  const rightWidth = width - left - center - gap * 2;
  const top = joinPanels([
    panel(`● EVENT STREAM ${options.eventFilter || 'ALL'}`, decisionWidth, topHeight, eventRows(snapshot, decisionWidth - 2, options.eventFilter, color, options.showCanonicalEventCodes), color),
    panel('! CURRENT BLOCKER / OPERATOR EXPLANATION', blockerWidth, topHeight, currentBlockerLines(snapshot, blockerWidth - 2, color), color),
    panel('⚙ ECONOMIC ENGINE', economicWidth, topHeight, economicEngineLines(snapshot, economicWidth - 2, color), color)
  ]);
  const middle = joinPanels([
    panel('◎ DECISION PIPELINE', left, middleHeight, decisionPipelineLines(snapshot, left - 2, color), color),
    panel('▥ CANDIDATE PIPELINE / TOP BLOCKERS', center, middleHeight, [...pipelineLines(snapshot, center - 2, color), ...topBlockerLines(snapshot, center - 2, color)], color),
    panel('◫ RANGE MONITOR', rightWidth, middleHeight, rangeMonitorLines(snapshot, rightWidth - 2, color), color)
  ]);
  const openPositions = panel(`■ OPEN POSITIONS (${snapshot.activePools.length}/${snapshot.runtime.maxOpenPositions ?? 'n/a'})`, width, openPanelHeight, activePoolLines(snapshot, width - 2, color), color);
  // The fills table carries authority labels. Give it enough width to show
  // LIVE-CONTROL PEAK rather than collapsing the source name into a generic
  // historical "MAX" label.
  const positionHealthWidth = Math.floor((width - gap * 2) * .24);
  const fillsWidth = Math.floor((width - gap * 2) * .53);
  const sideWidth = width - positionHealthWidth - fillsWidth - gap * 2;
  const positionHealthHeight = Math.min(9, bottomHeight);
  const dailyHeight = Math.max(4, bottomHeight - positionHealthHeight);
  const bottom = joinPanels([
    panel('♥ SYSTEM HEALTH', positionHealthWidth, bottomHeight, healthLines(snapshot, positionHealthWidth - 2, color), color, health.healthStatus || 'UNKNOWN'),
    panel('▤ FILLS / RECENT POSITIONS', fillsWidth, bottomHeight, recentPositionLines(snapshot, fillsWidth - 2, options.positionFilter, color), color, options.positionFilter || 'ALL'),
    [...panel('▣ TODAY', sideWidth, dailyHeight, compactDailyPerformanceLines(snapshot, sideWidth - 2, color), color), ...panel('♥ POSITION HEALTH', sideWidth, positionHealthHeight, positionHealthLines(snapshot, sideWidth - 2, color), color)]
  ]);
  return [...header, divider, ...top, ...middle, ...openPositions, ...bottom, footer].join('\n');
}

export function advanceCandidateIndex(snapshot: TerminalSnapshot, index: number, direction: -1 | 1): number {
  if (!snapshot.candidates.length) return 0;
  return (index + direction + snapshot.candidates.length) % snapshot.candidates.length;
}

export function nextEventFilter(value: TerminalRenderOptions['eventFilter'] = 'ALL'): NonNullable<TerminalRenderOptions['eventFilter']> {
  const filters: NonNullable<TerminalRenderOptions['eventFilter']>[] = ['ALL', 'DECISIONS', 'TRADES', 'PROTECTIONS', 'RISK', 'ERRORS'];
  return filters[(filters.indexOf(value) + 1) % filters.length] ?? 'ALL';
}

export function nextPositionFilter(value: TerminalRenderOptions['positionFilter'] = 'ALL'): NonNullable<TerminalRenderOptions['positionFilter']> {
  const filters: NonNullable<TerminalRenderOptions['positionFilter']>[] = ['ALL', 'OPEN', 'CLOSED'];
  return filters[(filters.indexOf(value) + 1) % filters.length] ?? 'ALL';
}

export function nextMobileView(value: NonNullable<TerminalRenderOptions['mobileView']> = 'OVERVIEW'): NonNullable<TerminalRenderOptions['mobileView']> {
  return value === 'OVERVIEW' ? 'ACTIVITY' : 'OVERVIEW';
}
