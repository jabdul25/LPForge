import { readFileSync } from 'node:fs';
import type { DataApiPool, MeteoraPositionPnl } from '../../data-api/src/index.js';
import type { PositionV2Fact } from '../../domain/src/index.js';

const WSOL_MINT='So11111111111111111111111111111111111111112';

export type ExitEvidenceState='AVAILABLE'|'UNAVAILABLE'|'STALE'|'CONTRADICTORY';
export type LiveExitAction='HOLD'|'REDUCE'|'CLOSE'|'EMERGENCY_CLOSE';
export interface ProfitProtectionPolicy {enabled:boolean;triggerFraction:number;maxGivebackFraction:number;minRetainedProfitFraction:number;}
/**
 * The historical +8% Meteora-compatible profit protection remains its own
 * authority.  This narrower policy governs only the two independently
 * protective, receipt-backed managed-economic signals added after the TS-5
 * forensic.  Its state is owned by the canonical exit-state projection.
 */
export interface ProfitRetentionTs5Policy {
  enabled:boolean;
  mfeActivationFraction:number;
  givebackFraction:number;
  watchSeconds:number;
  lowerRangeFraction:number;
  /** The only accepted semantic; a fixed watch may re-arm after expiry. */
  model:'EXPIRE_REARM';
  /** Maximum age of the preceding usable mark used for TS-5 confirmation. */
  previousUsableMaxAgeSeconds:number;
}
export interface ProfitRetentionOorP4Policy {enabled:boolean;mfeActivationFraction:number;requiresBelowMin:true;requiresTokenExposure:true;}
export interface ProfitRetentionPolicy {enabled:boolean;policyVersion:string;ts5:ProfitRetentionTs5Policy;oorP4:ProfitRetentionOorP4Policy;}
export interface LiveExitGovernorPolicy {
  schemaVersion:1;
  enabled:boolean;
  hardStopLossFraction:number;
  emergencyStopLossFraction:number;
  takeProfitFraction:number;
  profitProtection:ProfitProtectionPolicy;
  profitRetention:ProfitRetentionPolicy;
  closeOnThesisInvalidated:boolean;
  closeOnNonPositiveForwardEv:boolean;
  reduceOnRiskBlock:boolean;
  reduceFraction:number;
  maxHoldMinutes:number;
  maxHoldRequiresNonPositiveForwardEv:boolean;
  toxicityCloseThreshold:number;
  toxicityEmergencyThreshold:number;
}
export type ProfitRetentionWatchState='IDLE'|'WATCH_ARMED'|'EXPIRED'|'PROTECTION_CONFIRMED'|'TERMINAL_INVALIDATED';
export interface ProfitRetentionWatch {
  schemaVersion:1;
  policyVersion:string;
  policyHash?:string|undefined;
  state:ProfitRetentionWatchState;
  openedAt?:string|undefined;
  expiresAt?:string|undefined;
  anchorMfeReturn?:number|undefined;
  anchorReturn?:number|undefined;
  openingObservationTimestamp?:string|undefined;
  priorUsableObservationTimestamp?:string|undefined;
  priorUsableReturn?:number|undefined;
  poolAddress?:string|undefined;
  lowerBin?:number|undefined;
  upperBin?:number|undefined;
  lastProcessedObservationTimestamp?:string|undefined;
  invalidationOrExpiryReason?:string|undefined;
  confirmedAt?:string|undefined;
}
export type ProfitRetentionAssessmentKind='NONE'|'TS5_WATCH_ARMED'|'TS5_WATCH_EXPIRED'|'TS5_PROTECTION_CONFIRMED'|'OOR_P4_PROTECTION_CONFIRMED';
export interface ProfitRetentionAssessment {kind:ProfitRetentionAssessmentKind;reasonCodes:string[];watch:ProfitRetentionWatch;rangeFraction?:number|undefined;}

/**
 * A chain fact is gathered during a management observation.  The observation
 * timestamp is taken when that cycle begins, so a successfully fetched fact
 * is normally stamped a little later.  Freshness is therefore a bounded
 * distance from the cycle timestamp, not a one-sided "fact must be older"
 * check.  Invalid timestamps and either direction beyond the policy window
 * still fail closed.
 */
export function isManagementFactFreshForObservation(input:{
  observationObservedAt:string;
  factObservedAt:string|undefined;
  maxAgeSeconds:number;
}):boolean{
  const observationAt=Date.parse(input.observationObservedAt),factAt=input.factObservedAt===undefined?Number.NaN:Date.parse(input.factObservedAt),maxAgeMs=input.maxAgeSeconds*1000;
  return Number.isFinite(observationAt)&&Number.isFinite(factAt)&&Number.isFinite(maxAgeMs)&&maxAgeMs>=0&&Math.abs(factAt-observationAt)<=maxAgeMs;
}
export interface PositionEconomicsSnapshot {
  evidenceState:ExitEvidenceState;
  observedAt:string;
  initialCapitalUsd?:number;
  currentEconomicValueUsd?:number;
  netPnlUsd?:number;
  netReturnFraction?:number;
  feesValueUsd?:number;
  /** Fees/rewards already moved out of PositionV2 and recorded durably. */
  realizedFeeValueUsd?:number;
  realizedWithdrawalValueUsd?:number;
  contributedCapitalUsd?:number;
  executionCostUsd?:number;
  /** Value of position-attributable inventory that remains in the owner wallet. */
  walletInventoryValueUsd?:number;
  reasonCodes:string[];
}
/**
 * Receipt/chain LP-local performance uses LP-only economic scope:
 * position liquidity, unclaimed/claimed LP fees, and withdrawals, less the
 * immutable receipt-backed value deposited into PositionV2.  It deliberately
 * excludes execution cost, rent and position-attributable wallet inventory.
 * It is a diagnostic/accounting cross-check only while a position is live.
 * It must never independently trigger a numerical PnL exit.
 */
export interface LpPositionMarkToMarketSnapshot {
  evidenceState:ExitEvidenceState;
  observedAt:string;
  entryPositionValueUsd?:number;
  currentPositionValueUsd?:number;
  netPnlUsd?:number;
  netReturnFraction?:number;
  realizedFeeValueUsd?:number;
  realizedWithdrawalValueUsd?:number;
  reasonCodes:string[];
}
/**
 * Meteora-comparable LP performance.  This intentionally uses the exact
 * deposit/withdrawal/fee scope exposed by Meteora's position PnL endpoint;
 * it is separate from receipt-backed managed NAV and from the chain-only
 * capital-loss mark.
 */
export interface MeteoraComparableLpPositionMarkToMarketSnapshot {
  evidenceState:ExitEvidenceState;
  observedAt:string;
  entryPositionValueUsd?:number;
  currentPositionValueUsd?:number;
  netPnlUsd?:number;
  netReturnFraction?:number;
  reportedNetReturnFraction?:number;
  reportedReturnDeltaFraction?:number;
  source:'METEORA_POSITION_PNL_API';
  scope:'LIVE_POSITION_CONTROL';
  fetchedAt:string;
  positionAddress?:string;
  depositsUsd?:number;
  balanceUsd?:number;
  withdrawalsUsd?:number;
  claimedFeesUsd?:number;
  unclaimedFeeXUsd?:number;
  unclaimedFeeYUsd?:number;
  reasonCodes:string[];
}
/** The only numerical PnL authority while a position is OPEN. */
export type LiveControlPnlSnapshot=MeteoraComparableLpPositionMarkToMarketSnapshot;
/** Source-schema consistency, not a trading threshold: 0.5 percentage points. */
export const METEORA_CONTROL_REPORTED_RETURN_TOLERANCE_FRACTION=.005;
export interface LpProfitHighWaterState {
  peakNetReturnFraction?:number;
  peakPositionValueUsd?:number;
  peakObservedAt?:string;
  pendingPeakNetReturnFraction?:number;
  pendingPeakPositionValueUsd?:number;
  pendingPeakObservedAt?:string;
  pendingPeakConfirmations:number;
}
/**
 * Wallet inventory is included only when a durable position inventory lot
 * identifies it as belonging to this PositionV2.  Aggregate wallet balances
 * are intentionally not accepted here: they may include manual holdings or
 * inventory attributable to another LPForge position.
 */
export interface AttributedWalletInventory {
  tokenMint:string;
  tokenAmountRaw:string;
}
/**
 * Value only the assets that are still inside PositionV2.  Portfolio NAV adds
 * the owner wallet independently, so it must not include claimed fees or
 * prior withdrawals again.  Lifecycle/PnL accounting belongs in
 * derivePositionEconomics(), which consumes the durable cashflow ledger.
 */
export function derivePositionMarkToMarket(input:{position:PositionV2Fact;pool:DataApiPool;observedAt:string}):{evidenceState:ExitEvidenceState;observedAt:string;currentPositionValueUsd?:number;reasonCodes:string[]}{
  const {position,pool,observedAt}=input,x=pool.token_x,y=pool.token_y;
  const xv=tokenUsd(position.totalXAmount,x?.decimals,x?.price),yv=tokenUsd(position.totalYAmount,y?.decimals,y?.price);
  const fux=tokenUsd(position.feeX,x?.decimals,x?.price),fuy=tokenUsd(position.feeY,y?.decimals,y?.price);
  const reasons:string[]=[];
  if(xv===undefined)reasons.push('EXIT_VALUATION_TOKEN_X_UNAVAILABLE');
  if(yv===undefined)reasons.push('EXIT_VALUATION_TOKEN_Y_UNAVAILABLE');
  if(fux===undefined)reasons.push('EXIT_VALUATION_FEE_X_UNAVAILABLE');
  if(fuy===undefined)reasons.push('EXIT_VALUATION_FEE_Y_UNAVAILABLE');
  if(reasons.length)return{evidenceState:'UNAVAILABLE',observedAt,reasonCodes:reasons.sort()};
  return{evidenceState:'AVAILABLE',observedAt,currentPositionValueUsd:xv!+yv!+fux!+fuy!,reasonCodes:['EXIT_VALUATION_POSITION_MARK_TO_MARKET']};
}
/**
 * LP-local performance intentionally excludes attributed wallet residuals,
 * realized cashflows, and execution cost.  The denominator is the
 * receipt-proven value deposited into PositionV2, expressed at the same SOL
 * mark as the current observation and is never presented as settled PnL.
 */
export function deriveLpPositionMarkToMarket(input:{position:PositionV2Fact;pool:DataApiPool;lpPositionPrincipalLamports?:bigint;observedAt:string;realizedCashflows?:readonly RealizedPositionCashflow[]}):LpPositionMarkToMarketSnapshot{
  if(input.lpPositionPrincipalLamports===undefined||input.lpPositionPrincipalLamports<=0n)return{evidenceState:'UNAVAILABLE',observedAt:input.observedAt,reasonCodes:['LP_MTM_ENTRY_BASIS_UNPROVEN']};
  const marked=derivePositionMarkToMarket({position:input.position,pool:input.pool,observedAt:input.observedAt});
  const sol=[input.pool.token_x,input.pool.token_y].find(token=>token?.address===WSOL_MINT);
  if(marked.evidenceState!=='AVAILABLE'||!finite(sol?.price)||sol.price!<=0||marked.currentPositionValueUsd===undefined)return{evidenceState:'UNAVAILABLE',observedAt:input.observedAt,reasonCodes:[...marked.reasonCodes,'LP_MTM_SOL_MARK_UNAVAILABLE'].sort()};
  const entry=Number(input.lpPositionPrincipalLamports)/1e9*sol.price!;
  if(!Number.isFinite(entry)||entry<=0)return{evidenceState:'UNAVAILABLE',observedAt:input.observedAt,reasonCodes:['LP_MTM_ENTRY_BASIS_INVALID']};
  const realized=valueLpPositionCashflows({cashflows:input.realizedCashflows??[],pool:input.pool});
  if(!realized.complete)return{evidenceState:'UNAVAILABLE',observedAt:input.observedAt,reasonCodes:realized.reasonCodes};
  // Cumulative SDK claimed-fee counters are useful reconciliation hints but
  // not an immutable receipt. A claimed amount with no matching durable claim
  // ledger is therefore not decision-grade and cannot create a close signal.
  let claimedRaw=0n;try{claimedRaw=BigInt(input.position.claimedFeeX??'0')+BigInt(input.position.claimedFeeY??'0');}catch{return{evidenceState:'UNAVAILABLE',observedAt:input.observedAt,reasonCodes:['LP_MTM_CLAIM_COUNTER_INVALID']};}
  if(claimedRaw>0n&&!realized.hasClaim)return{evidenceState:'UNAVAILABLE',observedAt:input.observedAt,reasonCodes:['LP_MTM_CLAIM_RECEIPT_UNAVAILABLE']};
  const current=marked.currentPositionValueUsd+realized.feesUsd+realized.withdrawalsUsd;
  const net=current-entry;
  return{evidenceState:'AVAILABLE',observedAt:input.observedAt,entryPositionValueUsd:entry,currentPositionValueUsd:current,netPnlUsd:net,netReturnFraction:net/entry,realizedFeeValueUsd:realized.feesUsd,realizedWithdrawalValueUsd:realized.withdrawalsUsd,reasonCodes:['LP_POSITION_MARK_TO_MARKET','LP_POSITION_RECEIPT_BACKED_DEPOSIT']};
}
function apiNumber(value:unknown):number|undefined{
  const n=typeof value==='number'?value:typeof value==='string'&&value.trim()!==''?Number(value):NaN;
  return Number.isFinite(n)&&n>=0?n:undefined;
}
function apiFiniteNumber(value:unknown):number|undefined{
  const n=typeof value==='number'?value:typeof value==='string'&&value.trim()!==''?Number(value):NaN;
  return Number.isFinite(n)?n:undefined;
}
/**
 * Derives the exact component formula shown by Meteora's position PnL API.
 * The returned percentage is retained as a source-integrity cross-check; a
 * material disagreement makes the live control mark contradictory rather
 * than silently selecting the more convenient number.
 */
export function deriveMeteoraComparableLpPositionMarkToMarket(input:{positionPnl?:MeteoraPositionPnl;observedAt:string;expectedPositionAddress?:string}):MeteoraComparableLpPositionMarkToMarketSnapshot{
  const p=input.positionPnl;
  const base={source:'METEORA_POSITION_PNL_API' as const,scope:'LIVE_POSITION_CONTROL' as const,fetchedAt:input.observedAt};
  if(!p)return{...base,evidenceState:'UNAVAILABLE',observedAt:input.observedAt,reasonCodes:['LIVE_CONTROL_PNL_UNAVAILABLE','LP_MTM_METEORA_POSITION_PNL_MISSING']};
  if(input.expectedPositionAddress!==undefined&&p.positionAddress!==input.expectedPositionAddress)return{...base,evidenceState:'CONTRADICTORY',observedAt:input.observedAt,positionAddress:p.positionAddress,reasonCodes:['LIVE_CONTROL_PNL_CONTRADICTORY','LP_MTM_METEORA_POSITION_IDENTITY_MISMATCH']};
  const deposits=apiNumber(p.allTimeDeposits?.total?.usd),balances=apiNumber(p.unrealizedPnl?.balances),withdrawals=apiNumber(p.allTimeWithdrawals?.total?.usd),claimedFees=apiNumber(p.allTimeFees?.total?.usd),feeX=apiNumber(p.unrealizedPnl?.unclaimedFeeTokenX?.usd),feeY=apiNumber(p.unrealizedPnl?.unclaimedFeeTokenY?.usd);
  if(deposits===undefined||deposits<=0||balances===undefined||withdrawals===undefined||claimedFees===undefined||feeX===undefined||feeY===undefined)return{...base,evidenceState:'UNAVAILABLE',observedAt:input.observedAt,positionAddress:p.positionAddress,reasonCodes:['LIVE_CONTROL_PNL_INCOMPLETE','LP_MTM_METEORA_POSITION_PNL_INCOMPLETE']};
  const current=balances+withdrawals+claimedFees+feeX+feeY,net=current-deposits,reported=apiFiniteNumber(p.pnlPctChange);
  const derived=net/deposits,reportedReturn=reported===undefined?undefined:reported/100,delta=reportedReturn===undefined?undefined:Math.abs(derived-reportedReturn);
  const contradictory=delta!==undefined&&delta>METEORA_CONTROL_REPORTED_RETURN_TOLERANCE_FRACTION;
  return{...base,evidenceState:contradictory?'CONTRADICTORY':'AVAILABLE',observedAt:input.observedAt,positionAddress:p.positionAddress,entryPositionValueUsd:deposits,currentPositionValueUsd:current,netPnlUsd:net,netReturnFraction:derived,depositsUsd:deposits,balanceUsd:balances,withdrawalsUsd:withdrawals,claimedFeesUsd:claimedFees,unclaimedFeeXUsd:feeX,unclaimedFeeYUsd:feeY,...(reportedReturn===undefined||delta===undefined?{}:{reportedNetReturnFraction:reportedReturn,reportedReturnDeltaFraction:delta}),reasonCodes:contradictory?['LIVE_CONTROL_PNL_CONTRADICTORY','METEORA_CONTROL_PNL_COMPONENT_DISCREPANCY']:['LIVE_CONTROL_PNL_AVAILABLE','METEORA_CONTROL_PNL_RECONCILED','LP_POSITION_METEORA_DEPOSIT_HISTORY']};
}
/**
 * Meridian-style peak confirmation, made deterministic and durable by the
 * caller's persisted state.  A transient single observation never raises the
 * trailing high-water mark.
 */
export function confirmLpProfitHighWater(input:{prior?:LpProfitHighWaterState;current?:MeteoraComparableLpPositionMarkToMarketSnapshot;requiredConfirmations?:number}):LpProfitHighWaterState{
  const prior=input.prior??{pendingPeakConfirmations:0},current=input.current,required=Math.max(1,Math.floor(input.requiredConfirmations??2));
  if(current?.evidenceState!=='AVAILABLE'||!finite(current.netReturnFraction)||!finite(current.currentPositionValueUsd))return prior;
  const peak=prior.peakNetReturnFraction;
  if(peak!==undefined&&current.netReturnFraction<=peak){const {pendingPeakNetReturnFraction:_pendingReturn,pendingPeakPositionValueUsd:_pendingValue,pendingPeakObservedAt:_pendingAt,...retained}=prior;return{...retained,pendingPeakConfirmations:0};}
  const sameOrHigherPending=prior.pendingPeakNetReturnFraction!==undefined&&current.netReturnFraction>=prior.pendingPeakNetReturnFraction;
  const count=sameOrHigherPending?prior.pendingPeakConfirmations+1:1;
  if(count<required)return{...prior,pendingPeakNetReturnFraction:current.netReturnFraction,pendingPeakPositionValueUsd:current.currentPositionValueUsd,pendingPeakObservedAt:current.observedAt,pendingPeakConfirmations:count};
  return{peakNetReturnFraction:current.netReturnFraction,peakPositionValueUsd:current.currentPositionValueUsd,peakObservedAt:current.observedAt,pendingPeakConfirmations:0};
}
export interface ExitHighWaterState {peakNetReturnFraction:number;peakEconomicValueUsd?:number;peakObservedAt:string;}
/**
 * Market evidence is deliberately distinct from chain/lifecycle truth.  The
 * latter is handled by live-position-management; this structure makes it
 * impossible for aliases such as FREEFALL -> thesis EMERGENCY to be counted
 * twice as independent confirmation.
 */
export type MarketExitEvidenceFamily='REGIME_DIRECTIONAL'|'TOXICITY'|'LIQUIDITY'|'COMPLETE_NAV'|'MARKET_RISK'|'THESIS';
export interface MarketExitEvidence {family:MarketExitEvidenceFamily;code:string;severe:boolean;quality:'TRUSTWORTHY'|'LOW_CONFIDENCE'|'INCOMPLETE'|'STALE'|'UNKNOWN';}
export interface MarketExitConfirmationState {families:Partial<Record<MarketExitEvidenceFamily,number>>;}
export interface LiveExitGovernorInput {
  policy:LiveExitGovernorPolicy;
  economics:PositionEconomicsSnapshot;
  highWater?:ExitHighWaterState;
  thesisStatus?:'VALID'|'DETERIORATING'|'INVALIDATED'|'EMERGENCY'|'UNKNOWN';
  currentForwardEv?:number;
  closeCost?:number;
  /** Immediately preceding valid continuation evaluations for this exact PositionV2. */
  forwardEvConfirmationCount?:number;
  /** False means currentForwardEv is not exact-position continuation evidence. */
  forwardEvEvidenceAvailable?:boolean;
  riskDecision?:'APPROVE'|'BLOCK'|'EMERGENCY';
  riskReasonCodes?:string[];
  toxicityProbability?:number;
  liquidityCollapse?:boolean;
  positionAgeMinutes?:number;
  /** True only when the PositionV2 and valuation inputs were fetched for this management cycle. */
  completeNavFresh?:boolean;
  /** Receipt-backed LP-local accounting diagnostic; never PnL-exit authority. */
  lpPositionMtm?:LpPositionMarkToMarketSnapshot;
  /** True only when the diagnostic LP mark has current chain facts and durable provenance. */
  lpPositionMtmFresh?:boolean;
  /** Fresh complete Meteora-compatible mark: the sole numerical exit authority. */
  liveControlPnl?:LiveControlPnlSnapshot;
  liveControlPnlFresh?:boolean;
  lpProfitHighWater?:LpProfitHighWaterState;
  /** Model/market evidence with source-family provenance, supplied by the live operator. */
  marketEvidence?:readonly MarketExitEvidence[];
  marketConfirmation?:MarketExitConfirmationState;
}
export interface LiveExitGovernorDecision {
  action:LiveExitAction;
  reasonFamily:'NONE'|'CAPITAL_PROTECTION'|'PROFIT_PROTECTION'|'THESIS'|'FORWARD_EV'|'RISK'|'EMERGENCY'|'TIME';
  reasonCodes:string[];
  urgency:number;
  reduceFraction:number;
  economics:PositionEconomicsSnapshot;
  highWater:ExitHighWaterState;
  peakGivebackFraction:number|null;
  marketConfirmation:MarketExitConfirmationState;
  lpProfitHighWater?:LpProfitHighWaterState;
  lpProfitGivebackFraction?:number|null;
}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);

function validTimestamp(value:unknown):value is string{return typeof value==='string'&&Number.isFinite(Date.parse(value));}
function objectRecord(value:unknown):Record<string,unknown>|undefined{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
/** Decode only the bounded durable contract.  Unknown or malformed old state
 * is deliberately treated as IDLE rather than as a positive authority. */
export function parseProfitRetentionWatch(raw:unknown):ProfitRetentionWatch {
  const v=objectRecord(raw);
  const states:ProfitRetentionWatchState[]=['IDLE','WATCH_ARMED','EXPIRED','PROTECTION_CONFIRMED','TERMINAL_INVALIDATED'];
  if(!v||v.schemaVersion!==1||typeof v.policyVersion!=='string'||!states.includes(v.state as ProfitRetentionWatchState))return{schemaVersion:1,policyVersion:'UNINITIALIZED',state:'IDLE'};
  const takeString=(key:string)=>typeof v[key]==='string'?String(v[key]):undefined;
  const takeNumber=(key:string)=>finite(v[key])?Number(v[key]):undefined;
  return{schemaVersion:1,policyVersion:String(v.policyVersion),...(typeof v.policyHash==='string'?{policyHash:v.policyHash}:{}),state:v.state as ProfitRetentionWatchState,...(validTimestamp(takeString('openedAt'))?{openedAt:takeString('openedAt')!}:{}),...(validTimestamp(takeString('expiresAt'))?{expiresAt:takeString('expiresAt')!}:{}),...(finite(takeNumber('anchorMfeReturn'))?{anchorMfeReturn:takeNumber('anchorMfeReturn')}:{}),...(finite(takeNumber('anchorReturn'))?{anchorReturn:takeNumber('anchorReturn')}:{}),...(validTimestamp(takeString('openingObservationTimestamp'))?{openingObservationTimestamp:takeString('openingObservationTimestamp')!}:{}),...(validTimestamp(takeString('priorUsableObservationTimestamp'))?{priorUsableObservationTimestamp:takeString('priorUsableObservationTimestamp')!}:{}),...(finite(takeNumber('priorUsableReturn'))?{priorUsableReturn:takeNumber('priorUsableReturn')}:{}),...(typeof v.poolAddress==='string'?{poolAddress:v.poolAddress}:{}),...(Number.isInteger(v.lowerBin)?{lowerBin:Number(v.lowerBin)}:{}),...(Number.isInteger(v.upperBin)?{upperBin:Number(v.upperBin)}:{}),...(validTimestamp(takeString('lastProcessedObservationTimestamp'))?{lastProcessedObservationTimestamp:takeString('lastProcessedObservationTimestamp')!}:{}),...(typeof v.invalidationOrExpiryReason==='string'?{invalidationOrExpiryReason:v.invalidationOrExpiryReason}:{}),...(validTimestamp(takeString('confirmedAt'))?{confirmedAt:takeString('confirmedAt')!}:{})};
}
export interface ProfitRetentionProtectionInput {
  policy:ProfitRetentionPolicy;
  policyHash?:string|undefined;
  priorWatch?:ProfitRetentionWatch|undefined;
  observedAt:string;
  economics:PositionEconomicsSnapshot;
  highWater:ExitHighWaterState;
  /** Current facts are from one reconciled canonical management cycle. */
  currentFactsFresh:boolean;
  reconciliationClean:boolean;
  noActiveManagementPlan:boolean;
  positionTerminal?:boolean;
  poolAddress:string;
  rangeState:'IN_RANGE'|'BELOW_MIN'|'ABOVE_MAX'|'UNKNOWN';
  activeBinId?:number|undefined;
  lowerBinId?:number|undefined;
  upperBinId?:number|undefined;
  inventoryClassification?:'SAFE_OOR_SOL'|'OOR_TOKEN_EXPOSURE'|'MIXED_INVENTORY'|'INVENTORY_UNAVAILABLE'|undefined;
  previousUsable?:{observedAt:string;managedReturnFraction:number;fresh:boolean;poolAddress:string}|undefined;
}
function sameOrNewer(current:string,prior:string|undefined){return!prior||Date.parse(current)>Date.parse(prior);}
/**
 * Pure Model-C TS-5 plus OOR-P4 assessment.  This is intentionally separate
 * from the old Meteora-compatible numeric profit-protection authority: it
 * consumes only a guarded, receipt-backed managed mark supplied by the
 * canonical manager.  The caller persists the returned watch atomically with
 * its canonical exit state.
 */
export function assessProfitRetentionProtection(input:ProfitRetentionProtectionInput):ProfitRetentionAssessment {
  const p=input.policy,ts=p.ts5,prior=input.priorWatch??{schemaVersion:1,policyVersion:p.policyVersion,state:'IDLE' as const};
  const now=Date.parse(input.observedAt);
  const base=(state:ProfitRetentionWatchState,extra:Partial<ProfitRetentionWatch>={}):ProfitRetentionWatch=>({schemaVersion:1,policyVersion:p.policyVersion,...(input.policyHash?{policyHash:input.policyHash}:{}),state,...extra,lastProcessedObservationTimestamp:input.observedAt});
  const none=(watch:ProfitRetentionWatch,codes:string[]=['PROFIT_RETENTION_NONE']):ProfitRetentionAssessment=>({kind:'NONE',reasonCodes:codes,watch});
  if(!validTimestamp(input.observedAt))return none(prior,['PROFIT_RETENTION_OBSERVATION_TIMESTAMP_INVALID']);
  if(!sameOrNewer(input.observedAt,prior.lastProcessedObservationTimestamp))return none(prior,['PROFIT_RETENTION_OUT_OF_ORDER_OBSERVATION']);
  if(input.positionTerminal)return none(base('TERMINAL_INVALIDATED',{invalidationOrExpiryReason:'POSITION_TERMINAL'}),['PROFIT_RETENTION_POSITION_TERMINAL']);
  const currentReturn=input.economics.netReturnFraction;
  const economicsUsable=input.economics.evidenceState==='AVAILABLE'&&finite(currentReturn);
  const guardClean=economicsUsable&&input.currentFactsFresh&&input.reconciliationClean&&input.noActiveManagementPlan;
  const boundsValid=Number.isInteger(input.activeBinId)&&Number.isInteger(input.lowerBinId)&&Number.isInteger(input.upperBinId)&&input.upperBinId!>input.lowerBinId!&&input.activeBinId!>=input.lowerBinId!&&input.activeBinId!<=input.upperBinId!;
  const fraction=boundsValid?(input.activeBinId!-input.lowerBinId!)/(input.upperBinId!-input.lowerBinId!):undefined;
  const armEligible=Boolean(p.enabled&&ts.enabled&&guardClean&&input.rangeState==='IN_RANGE'&&input.highWater.peakNetReturnFraction>=ts.mfeActivationFraction&&finite(currentReturn)&&input.highWater.peakNetReturnFraction-currentReturn>=ts.givebackFraction);
  const previous=input.previousUsable;
  const previousFresh=Boolean(previous&&previous.fresh&&previous.poolAddress===input.poolAddress&&validTimestamp(previous.observedAt)&&now-Date.parse(previous.observedAt)<=ts.previousUsableMaxAgeSeconds*1000&&now>Date.parse(previous.observedAt));
  const confirmEligible=Boolean(guardClean&&input.rangeState==='IN_RANGE'&&boundsValid&&fraction!==undefined&&fraction>=0&&fraction<=ts.lowerRangeFraction&&previousFresh&&finite(currentReturn)&&currentReturn<previous!.managedReturnFraction);
  // OOR-P4 is independent of, and must not be hidden behind, an existing
  // in-range TS-5 watch.  It can only fire from the exact below/token state.
  const oorP4=Boolean(p.enabled&&p.oorP4.enabled&&guardClean&&input.highWater.peakNetReturnFraction>=p.oorP4.mfeActivationFraction&&input.rangeState==='BELOW_MIN'&&input.inventoryClassification==='OOR_TOKEN_EXPOSURE');
  if(oorP4)return{kind:'OOR_P4_PROTECTION_CONFIRMED',reasonCodes:['PROFIT_RETENTION_OOR_P4_CONFIRMED'],watch:base('PROTECTION_CONFIRMED',{openedAt:prior.openedAt,expiresAt:prior.expiresAt,anchorMfeReturn:prior.anchorMfeReturn,anchorReturn:prior.anchorReturn,openingObservationTimestamp:prior.openingObservationTimestamp,poolAddress:input.poolAddress,lowerBin:input.lowerBinId,upperBin:input.upperBinId,confirmedAt:input.observedAt,invalidationOrExpiryReason:'OOR_P4_PROTECTION_CONFIRMED'})};
  const active=prior.state==='WATCH_ARMED'&&validTimestamp(prior.openedAt)&&validTimestamp(prior.expiresAt);
  if(active){
    const opened=Date.parse(prior.openedAt!),expires=Date.parse(prior.expiresAt!);
    // Exact five-minute boundary qualifies; a later observation expires first
    // and may not simultaneously create the replacement Model-C watch.
    if(now>expires)return{kind:'TS5_WATCH_EXPIRED',reasonCodes:['PROFIT_RETENTION_TS5_WATCH_EXPIRED'],watch:base('EXPIRED',{openedAt:prior.openedAt,expiresAt:prior.expiresAt,anchorMfeReturn:prior.anchorMfeReturn,anchorReturn:prior.anchorReturn,openingObservationTimestamp:prior.openingObservationTimestamp,priorUsableObservationTimestamp:prior.priorUsableObservationTimestamp,priorUsableReturn:prior.priorUsableReturn,poolAddress:prior.poolAddress,lowerBin:prior.lowerBin,upperBin:prior.upperBin,invalidationOrExpiryReason:'WATCH_EXPIRED'})};
    if(now>opened&&now<=expires&&confirmEligible)return{kind:'TS5_PROTECTION_CONFIRMED',reasonCodes:['PROFIT_RETENTION_TS5_CONFIRMED'],rangeFraction:fraction,watch:base('PROTECTION_CONFIRMED',{openedAt:prior.openedAt,expiresAt:prior.expiresAt,anchorMfeReturn:prior.anchorMfeReturn,anchorReturn:prior.anchorReturn,openingObservationTimestamp:prior.openingObservationTimestamp,priorUsableObservationTimestamp:previous?.observedAt,priorUsableReturn:previous?.managedReturnFraction,poolAddress:input.poolAddress,lowerBin:input.lowerBinId,upperBin:input.upperBinId,confirmedAt:input.observedAt})};
    return none(base('WATCH_ARMED',{openedAt:prior.openedAt,expiresAt:prior.expiresAt,anchorMfeReturn:prior.anchorMfeReturn,anchorReturn:prior.anchorReturn,openingObservationTimestamp:prior.openingObservationTimestamp,priorUsableObservationTimestamp:prior.priorUsableObservationTimestamp,priorUsableReturn:prior.priorUsableReturn,poolAddress:prior.poolAddress,lowerBin:prior.lowerBin,upperBin:prior.upperBin}),guardClean?['PROFIT_RETENTION_TS5_WATCH_ACTIVE']:['PROFIT_RETENTION_TS5_WATCH_FACTS_UNAVAILABLE']);
  }
  // A successful confirmed state is terminal for the watch and must never
  // create another candidate while a close intent is in flight.
  if(prior.state==='PROTECTION_CONFIRMED')return none(base('PROTECTION_CONFIRMED',{openedAt:prior.openedAt,expiresAt:prior.expiresAt,anchorMfeReturn:prior.anchorMfeReturn,anchorReturn:prior.anchorReturn,openingObservationTimestamp:prior.openingObservationTimestamp,poolAddress:prior.poolAddress,lowerBin:prior.lowerBin,upperBin:prior.upperBin,confirmedAt:prior.confirmedAt}),['PROFIT_RETENTION_TS5_ALREADY_CONFIRMED']);
  if(armEligible)return{kind:'TS5_WATCH_ARMED',reasonCodes:['PROFIT_RETENTION_TS5_WATCH_ARMED'],watch:base('WATCH_ARMED',{openedAt:input.observedAt,expiresAt:new Date(now+ts.watchSeconds*1000).toISOString(),anchorMfeReturn:input.highWater.peakNetReturnFraction,anchorReturn:currentReturn,openingObservationTimestamp:input.observedAt,priorUsableObservationTimestamp:previous?.observedAt,priorUsableReturn:previous?.managedReturnFraction,poolAddress:input.poolAddress,lowerBin:input.lowerBinId,upperBin:input.upperBinId})};
  return none(base(prior.state==='EXPIRED'?'EXPIRED':'IDLE',{...(prior.state==='EXPIRED'?{openedAt:prior.openedAt,expiresAt:prior.expiresAt,invalidationOrExpiryReason:prior.invalidationOrExpiryReason}: {})}),guardClean?['PROFIT_RETENTION_NO_TRIGGER']:['PROFIT_RETENTION_GUARDS_NOT_MET']);
}
export function parseLiveExitGovernorPolicy(raw:unknown):LiveExitGovernorPolicy{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('LPFORGE_EXIT_POLICY_OBJECT');
  const v=raw as Record<string,unknown>,pp=v.profitProtection as Record<string,unknown>|undefined,pr=v.profitRetention as Record<string,unknown>|undefined;
  const ts5=pr?.ts5 as Record<string,unknown>|undefined,oorP4=pr?.oorP4 as Record<string,unknown>|undefined;
  const nums=['hardStopLossFraction','emergencyStopLossFraction','takeProfitFraction','reduceFraction','maxHoldMinutes','toxicityCloseThreshold','toxicityEmergencyThreshold'];
  if(v.schemaVersion!==1||typeof v.enabled!=='boolean'||!pp||typeof pp.enabled!=='boolean'||!pr||typeof pr.enabled!=='boolean'||typeof pr.policyVersion!=='string'||!ts5||!oorP4||typeof ts5.enabled!=='boolean'||typeof oorP4.enabled!=='boolean'||oorP4.requiresBelowMin!==true||oorP4.requiresTokenExposure!==true||typeof v.closeOnThesisInvalidated!=='boolean'||typeof v.closeOnNonPositiveForwardEv!=='boolean'||typeof v.reduceOnRiskBlock!=='boolean'||typeof v.maxHoldRequiresNonPositiveForwardEv!=='boolean'||nums.some(k=>!finite(v[k])))throw new Error('LPFORGE_EXIT_POLICY_INVALID');
  if(!finite(pp.triggerFraction)||!finite(pp.maxGivebackFraction)||!finite(pp.minRetainedProfitFraction))throw new Error('LPFORGE_EXIT_POLICY_PROFIT_INVALID');
  if(ts5.model!=='EXPIRE_REARM'||!finite(ts5.mfeActivationFraction)||!finite(ts5.givebackFraction)||!finite(ts5.watchSeconds)||!finite(ts5.lowerRangeFraction)||!finite(ts5.previousUsableMaxAgeSeconds)||!finite(oorP4.mfeActivationFraction))throw new Error('LPFORGE_EXIT_POLICY_PROFIT_RETENTION_INVALID');
  const p=v as unknown as LiveExitGovernorPolicy;
  if(p.hardStopLossFraction<=0||p.emergencyStopLossFraction<=p.hardStopLossFraction||p.emergencyStopLossFraction>=1||p.takeProfitFraction<0||p.takeProfitFraction>=1||p.reduceFraction<=0||p.reduceFraction>=1||p.maxHoldMinutes<0||p.toxicityCloseThreshold<0||p.toxicityCloseThreshold>1||p.toxicityEmergencyThreshold<=p.toxicityCloseThreshold||p.toxicityEmergencyThreshold>1||p.profitProtection.triggerFraction<=0||p.profitProtection.maxGivebackFraction<=0||p.profitProtection.minRetainedProfitFraction<0||p.profitRetention.ts5.mfeActivationFraction<=0||p.profitRetention.ts5.mfeActivationFraction>=1||p.profitRetention.ts5.givebackFraction<=0||p.profitRetention.ts5.givebackFraction>=1||!Number.isSafeInteger(p.profitRetention.ts5.watchSeconds)||p.profitRetention.ts5.watchSeconds<=0||p.profitRetention.ts5.lowerRangeFraction<=0||p.profitRetention.ts5.lowerRangeFraction>=1||!Number.isSafeInteger(p.profitRetention.ts5.previousUsableMaxAgeSeconds)||p.profitRetention.ts5.previousUsableMaxAgeSeconds<=0||p.profitRetention.oorP4.mfeActivationFraction<=0||p.profitRetention.oorP4.mfeActivationFraction>=1)throw new Error('LPFORGE_EXIT_POLICY_RANGE');
  return p;
}
export function loadLiveExitGovernorPolicy(path='release-policy-templates/live-exit-governor-policy.json'):LiveExitGovernorPolicy{return parseLiveExitGovernorPolicy(JSON.parse(readFileSync(path,'utf8')));}
function tokenUsd(raw:string|undefined,decimals:number|undefined,price:number|undefined):number|undefined{
  if(raw===undefined||!Number.isInteger(decimals)||decimals!<0||!finite(price)||price!<0)return undefined;
  let n:number;try{n=Number(BigInt(raw))/10**decimals!;}catch{return undefined;}return Number.isFinite(n)?n*price!:undefined;
}
export interface RealizedPositionCashflow {flowType:string;lamports?:bigint;tokenMint?:string;tokenAmountRaw?:string;payload?:Record<string,unknown>;}
/**
 * Values the durable lifecycle ledger at current pool prices. Unknown values
 * are reported rather than guessed, so exit governance never invents PnL.
 * Legacy capital-basis-only withdrawal rows are deliberately ignored.
 */
export function valuePositionCashflows(input:{cashflows:readonly RealizedPositionCashflow[];pool:DataApiPool}):{contributionsUsd:number;realizedFeeUsd:number;realizedWithdrawalUsd:number;executionCostUsd:number;complete:boolean;hasEconomicCashflow:boolean;hasRealizedFeeFlow:boolean;reasonCodes:string[]}{
  const tokens=[input.pool.token_x,input.pool.token_y].filter((x):x is NonNullable<typeof x>=>Boolean(x));
  const sol=tokens.find(token=>token.address==='So11111111111111111111111111111111111111112');
  let contributionsUsd=0,realizedFeeUsd=0,realizedWithdrawalUsd=0,executionCostUsd=0,complete=true,hasEconomicCashflow=false,hasRealizedFeeFlow=false;const reasons:string[]=[];
  for(const flow of input.cashflows){
    if(!['OPEN_CONTRIBUTION','ENTRY_BASIS_CORRECTION','ADD_CONTRIBUTION','FEE_CLAIM','REWARD_CLAIM','REDUCE_WITHDRAWAL','CLOSE_WITHDRAWAL','SWAP_PROCEEDS','SWAP_COST','TX_COST'].includes(flow.flowType))continue;
    hasEconomicCashflow=true;
    // Legacy reductions stored an estimated capital basis in lamports. That
    // is not a wallet realization and is never treated as PnL.
    if((flow.flowType==='REDUCE_WITHDRAWAL'||flow.flowType==='CLOSE_WITHDRAWAL')&&!flow.tokenMint&&!flow.tokenAmountRaw)continue;
    const token=tokens.find(candidate=>candidate.address===flow.tokenMint);
    const tokenValue=flow.tokenMint?tokenUsd(flow.tokenAmountRaw,token?.decimals,token?.price):undefined;
    const lamportValue=flow.lamports!==undefined&&sol?Number(flow.lamports)/1e9*(sol.price??Number.NaN):undefined;
    const value=tokenValue??lamportValue;
    if(value===undefined||!Number.isFinite(value)){complete=false;reasons.push('EXIT_CASHFLOW_VALUE_UNAVAILABLE');continue;}
    if(flow.flowType==='OPEN_CONTRIBUTION'||flow.flowType==='ENTRY_BASIS_CORRECTION'||flow.flowType==='ADD_CONTRIBUTION')contributionsUsd+=value;
    else if(flow.flowType==='FEE_CLAIM'||flow.flowType==='REWARD_CLAIM'){realizedFeeUsd+=value;hasRealizedFeeFlow=true;}
    else if(flow.flowType==='REDUCE_WITHDRAWAL'||flow.flowType==='CLOSE_WITHDRAWAL'||flow.flowType==='SWAP_PROCEEDS')realizedWithdrawalUsd+=value;
    else executionCostUsd+=value;
  }
  return{contributionsUsd,realizedFeeUsd,realizedWithdrawalUsd,executionCostUsd,complete,hasEconomicCashflow,hasRealizedFeeFlow,reasonCodes:[...new Set(reasons)].sort()};
}
/** LP-local realization ledger: only LP fee claims and position withdrawals. */
function valueLpPositionCashflows(input:{cashflows:readonly RealizedPositionCashflow[];pool:DataApiPool}):{feesUsd:number;withdrawalsUsd:number;hasClaim:boolean;complete:boolean;reasonCodes:string[]}{
  const tokens=[input.pool.token_x,input.pool.token_y].filter((x):x is NonNullable<typeof x>=>Boolean(x));
  const sol=tokens.find(token=>token.address===WSOL_MINT);
  let feesUsd=0,withdrawalsUsd=0,hasClaim=false,complete=true;const reasons:string[]=[];
  for(const flow of input.cashflows){
    if(!['FEE_CLAIM','REWARD_CLAIM','REDUCE_WITHDRAWAL','CLOSE_WITHDRAWAL'].includes(flow.flowType))continue;
    // A legacy basis-only row is not an actual withdrawal receipt.
    if((flow.flowType==='REDUCE_WITHDRAWAL'||flow.flowType==='CLOSE_WITHDRAWAL')&&!flow.tokenMint&&!flow.tokenAmountRaw)continue;
    const token=tokens.find(candidate=>candidate.address===flow.tokenMint);
    const tokenValue=flow.tokenMint?tokenUsd(flow.tokenAmountRaw,token?.decimals,token?.price):undefined;
    const lamportValue=flow.lamports!==undefined&&sol?Number(flow.lamports)/1e9*(sol.price??Number.NaN):undefined;
    const value=tokenValue??lamportValue;
    if(value===undefined||!Number.isFinite(value)){complete=false;reasons.push('LP_MTM_REALIZATION_VALUE_UNAVAILABLE');continue;}
    if(flow.flowType==='FEE_CLAIM'||flow.flowType==='REWARD_CLAIM'){feesUsd+=value;hasClaim=true;}
    else withdrawalsUsd+=value;
  }
  return{feesUsd,withdrawalsUsd,hasClaim,complete,reasonCodes:[...new Set(reasons)].sort()};
}
/** Backward-compatible fee-only view for reporting callers. */
export function valueRealizedFeeCashflows(input:{cashflows:readonly RealizedPositionCashflow[];pool:DataApiPool}){const v=valuePositionCashflows(input);return{valueUsd:v.realizedFeeUsd,complete:v.complete,reasonCodes:v.reasonCodes};}
/** Capital-normalized economic valuation. No value is fabricated when token price/decimals are unavailable. */
export function derivePositionEconomics(input:{position:PositionV2Fact;pool:DataApiPool;initialCapitalLamports:bigint;observedAt:string;realizedFeeCashflows?:readonly RealizedPositionCashflow[];attributedWalletInventory?:readonly AttributedWalletInventory[];actualContributedLamports?:bigint;requireReceiptProvenContribution?:boolean}):PositionEconomicsSnapshot{
  const {position,pool,initialCapitalLamports,observedAt}=input,x=pool.token_x,y=pool.token_y;
  const tokens=[x,y].filter((token):token is NonNullable<typeof token>=>Boolean(token));
  const sol=x?.address==='So11111111111111111111111111111111111111112'?x:y?.address==='So11111111111111111111111111111111111111112'?y:undefined;
  if(input.requireReceiptProvenContribution&&input.actualContributedLamports===undefined)return{evidenceState:'UNAVAILABLE',observedAt,reasonCodes:['EXIT_VALUATION_ENTRY_BASIS_UNPROVEN']};
  const contributionLamports=input.actualContributedLamports??initialCapitalLamports;
  const initial=finite(sol?.price)&&sol!.price!>0?Number(contributionLamports)/1e9*sol!.price!:undefined;
  const xv=tokenUsd(position.totalXAmount,x?.decimals,x?.price),yv=tokenUsd(position.totalYAmount,y?.decimals,y?.price);
  const fux=tokenUsd(position.feeX,x?.decimals,x?.price)??0,fuy=tokenUsd(position.feeY,y?.decimals,y?.price)??0;
  const onPositionClaimedX=tokenUsd(position.claimedFeeX,x?.decimals,x?.price)??0,onPositionClaimedY=tokenUsd(position.claimedFeeY,y?.decimals,y?.price)??0,
    ledger=input.realizedFeeCashflows&&input.realizedFeeCashflows.length>0?valuePositionCashflows({cashflows:input.realizedFeeCashflows,pool}):undefined;
  const reasons:string[]=[];if(initial===undefined||!(initial>0))reasons.push('EXIT_VALUATION_INITIAL_CAPITAL_UNAVAILABLE');if(xv===undefined)reasons.push('EXIT_VALUATION_TOKEN_X_UNAVAILABLE');if(yv===undefined)reasons.push('EXIT_VALUATION_TOKEN_Y_UNAVAILABLE');
  if(ledger&&!ledger.complete)reasons.push(...ledger.reasonCodes);
  let walletInventory=0;
  for(const asset of input.attributedWalletInventory??[]){
    const token=tokens.find(candidate=>candidate.address===asset.tokenMint),value=tokenUsd(asset.tokenAmountRaw,token?.decimals,token?.price);
    if(value===undefined){reasons.push('EXIT_VALUATION_ATTRIBUTED_WALLET_INVENTORY_UNAVAILABLE');continue;}
    walletInventory+=value;
  }
  if(reasons.length)return{evidenceState:'UNAVAILABLE',observedAt,reasonCodes:[...new Set(reasons)].sort()};
  // Once the durable ledger is present it is the authority for fees already
  // withdrawn to the wallet. This prevents a CLAIM from looking like a loss
  // and avoids double counting an SDK cumulative claimed-fee field.
  const realizedFees=ledger?.hasRealizedFeeFlow?ledger.realizedFeeUsd:(onPositionClaimedX+onPositionClaimedY),contributed=input.actualContributedLamports!==undefined?initial!:(ledger?.contributionsUsd&&ledger.contributionsUsd>0?ledger.contributionsUsd:initial!),withdrawals=ledger?.realizedWithdrawalUsd??0,costs=ledger?.executionCostUsd??0,fees=fux+fuy+realizedFees,current=xv!+yv!+fees+walletInventory+withdrawals-costs,net=current-contributed,fraction=net/contributed;
  return{evidenceState:'AVAILABLE',observedAt,initialCapitalUsd:contributed,currentEconomicValueUsd:current,netPnlUsd:net,netReturnFraction:fraction,feesValueUsd:fees,realizedFeeValueUsd:realizedFees,realizedWithdrawalValueUsd:withdrawals,contributedCapitalUsd:contributed,executionCostUsd:costs,walletInventoryValueUsd:walletInventory,reasonCodes:['EXIT_VALUATION_COMPLETE_MANAGED_NAV',...(walletInventory>0?['EXIT_VALUATION_ATTRIBUTED_WALLET_INVENTORY']:[]),...(ledger?['EXIT_VALUATION_REALIZED_CASHFLOWS']:[])]};
}
function nextHighWater(e:PositionEconomicsSnapshot,prior?:ExitHighWaterState):ExitHighWaterState{
  const current=e.netReturnFraction??Number.NEGATIVE_INFINITY;
  if(!prior||current>prior.peakNetReturnFraction)return{peakNetReturnFraction:Number.isFinite(current)?current:prior?.peakNetReturnFraction??0,...(e.currentEconomicValueUsd!==undefined?{peakEconomicValueUsd:e.currentEconomicValueUsd}:{}),peakObservedAt:e.observedAt};
  return prior;
}
function completeLiveControlPnl(input:LiveExitGovernorInput){const e=input.liveControlPnl;return input.liveControlPnlFresh===true&&e?.evidenceState==='AVAILABLE'&&e.source==='METEORA_POSITION_PNL_API'&&e.scope==='LIVE_POSITION_CONTROL'&&finite(e.netReturnFraction);}
function marketAuthority(input:LiveExitGovernorInput):{confirmed:boolean;pending:boolean;reasonCodes:string[];confirmation:MarketExitConfirmationState}{
  const prior=input.marketConfirmation?.families??{}, next:Partial<Record<MarketExitEvidenceFamily,number>>={}, trustworthy=new Map<MarketExitEvidenceFamily,MarketExitEvidence>();
  for(const evidence of input.marketEvidence??[]){
    if(!evidence.severe)continue;
    if(evidence.quality==='TRUSTWORTHY'&&!trustworthy.has(evidence.family))trustworthy.set(evidence.family,evidence);
  }
  for(const family of trustworthy.keys())next[family]=Math.max(0,Math.floor(prior[family]??0))+1;
  const active=[...trustworthy.values()], persistent=active.filter(e=>(next[e.family]??0)>=2);
  const confirmed=active.length>=2||persistent.length>0;
  const codes=[...active.map(e=>e.code),...((input.marketEvidence??[]).filter(e=>e.severe&&e.quality!=='TRUSTWORTHY').map(e=>`EXIT_MARKET_EVIDENCE_${e.quality}`))];
  if(confirmed)codes.push('EXIT_MARKET_AUTHORITY_CONFIRMED');
  else if(active.length||codes.length)codes.push('EXIT_CONFIRMATION_PENDING');
  return{confirmed,pending:!confirmed&&(active.length>0||codes.length>0),reasonCodes:[...new Set(codes)].sort(),confirmation:{families:next}};
}
export function assessLiveExit(input:LiveExitGovernorInput):LiveExitGovernorDecision{
  const p=input.policy,e=input.economics,hw=nextHighWater(e,input.highWater),current=e.netReturnFraction,giveback=finite(current)?Math.max(0,hw.peakNetReturnFraction-current):null;
  const control=completeLiveControlPnl(input)?input.liveControlPnl:undefined;
  const lpProfitHighWater=confirmLpProfitHighWater({...(input.lpProfitHighWater?{prior:input.lpProfitHighWater}:{}),...(control?{current:control}:{})});
  const lpProfitCurrent=control?.netReturnFraction;
  const lpProfitPeak=lpProfitHighWater.peakNetReturnFraction;
  const lpProfitGiveback=finite(lpProfitCurrent)&&finite(lpProfitPeak)?Math.max(0,lpProfitPeak-lpProfitCurrent):null;
  let authority=marketAuthority(input);
  const out=(action:LiveExitAction,family:LiveExitGovernorDecision['reasonFamily'],codes:string[],urgency:number,reduceFraction=0):LiveExitGovernorDecision=>({action,reasonFamily:family,reasonCodes:[...new Set(codes)].sort(),urgency:clamp(urgency),reduceFraction,economics:e,highWater:hw,peakGivebackFraction:giveback,marketConfirmation:authority.confirmation,lpProfitHighWater,lpProfitGivebackFraction:lpProfitGiveback});
  if(!p.enabled)return out('HOLD','NONE',['EXIT_GOVERNOR_DISABLED'],0);
  const tox=finite(input.toxicityProbability)?input.toxicityProbability:0;
  const controlReturn=control?.netReturnFraction;
  // Every numerical PnL rule consumes this one Meteora-compatible control
  // return. Receipt and managed-economic marks remain diagnostics only.
  if(finite(controlReturn)&&controlReturn<=-p.emergencyStopLossFraction)return out('EMERGENCY_CLOSE','EMERGENCY',['EXIT_EMERGENCY_STOP_LOSS'],1,1);
  if(finite(controlReturn)&&controlReturn<=-p.hardStopLossFraction)return out('CLOSE','CAPITAL_PROTECTION',['EXIT_HARD_POSITION_STOP_LOSS'],.9,1);
  const defaultEvidence:MarketExitEvidence[]=[
    ...(input.liquidityCollapse?[{family:'LIQUIDITY' as const,code:'EXIT_LIQUIDITY_COLLAPSE',severe:true,quality:'TRUSTWORTHY' as const}]:[]),
    ...(tox>=p.toxicityEmergencyThreshold?[{family:'TOXICITY' as const,code:'EXIT_TOXICITY_EMERGENCY',severe:true,quality:'TRUSTWORTHY' as const}]:tox>=p.toxicityCloseThreshold?[{family:'TOXICITY' as const,code:'EXIT_TOXICITY_TOO_HIGH',severe:true,quality:'TRUSTWORTHY' as const}]:[]),
    ...((input.thesisStatus==='EMERGENCY'||(p.closeOnThesisInvalidated&&input.thesisStatus==='INVALIDATED'))?[{family:'THESIS' as const,code:input.thesisStatus==='EMERGENCY'?'EXIT_THESIS_EMERGENCY':'EXIT_THESIS_INVALIDATED',severe:true,quality:'TRUSTWORTHY' as const}]:[]),
  ];
  // Callers that provide provenance own the complete evidence set.  The
  // fallback preserves safe behaviour for non-operator callers and tests.
  const governed=marketAuthority({...input,marketEvidence:[...(input.marketEvidence??[]),...defaultEvidence]});
  authority=governed;
  if(governed.confirmed)return out('CLOSE','EMERGENCY',governed.reasonCodes,.9,1);
  if(governed.pending)return out('HOLD','EMERGENCY',governed.reasonCodes,.35,0);
  if(p.takeProfitFraction>0&&finite(lpProfitCurrent)&&lpProfitCurrent>=p.takeProfitFraction)return out('CLOSE','PROFIT_PROTECTION',['EXIT_TAKE_PROFIT_TARGET'],.88,1);
  if(p.profitProtection.enabled&&finite(lpProfitCurrent)&&finite(lpProfitPeak)&&lpProfitPeak>=p.profitProtection.triggerFraction&&lpProfitGiveback!==null&&lpProfitGiveback>=p.profitProtection.maxGivebackFraction&&lpProfitCurrent>=p.profitProtection.minRetainedProfitFraction)return out('CLOSE','PROFIT_PROTECTION',['EXIT_LP_POSITION_PROFIT_GIVEBACK_LIMIT'],.82,1);
  if(p.closeOnNonPositiveForwardEv&&finite(input.currentForwardEv)){if(input.forwardEvEvidenceAvailable===false)return out('HOLD','NONE',['EXIT_POSITION_CONTINUATION_EVIDENCE_UNAVAILABLE'],.1,0);if(!finite(input.closeCost))return out('HOLD','NONE',['EXIT_CLOSE_COST_UNAVAILABLE'],.1,0);const closeCost=Math.max(0,input.closeCost);if(input.currentForwardEv<=-closeCost){const confirmations=Math.max(0,Math.floor(input.forwardEvConfirmationCount??0));if(confirmations<2)return out('HOLD','FORWARD_EV',['EXIT_FORWARD_EV_CONFIRMATION_PENDING'],.1,0);return out('CLOSE','FORWARD_EV',['EXIT_FORWARD_EV_INFERIOR_TO_CLOSE'],.75,1);}}
  if(p.reduceOnRiskBlock&&input.riskDecision==='BLOCK')return out('REDUCE','RISK',['EXIT_REDUCE_RISK_BLOCK',...(input.riskReasonCodes??[])],.7,p.reduceFraction);
  if(p.maxHoldMinutes>0&&finite(input.positionAgeMinutes)&&input.positionAgeMinutes!>=p.maxHoldMinutes&&(!p.maxHoldRequiresNonPositiveForwardEv||(finite(input.currentForwardEv)&&input.currentForwardEv!<=0)))return out('CLOSE','TIME',['EXIT_MAX_HOLD_REACHED'],.6,1);
  const controlCode=input.liveControlPnl?.evidenceState==='STALE'?'LIVE_CONTROL_PNL_STALE':input.liveControlPnl?.evidenceState==='CONTRADICTORY'?'LIVE_CONTROL_PNL_CONTRADICTORY':input.liveControlPnl?.evidenceState==='UNAVAILABLE'?'LIVE_CONTROL_PNL_UNAVAILABLE':control?'EXIT_HOLD_WITH_LIVE_CONTROL_PNL':'LIVE_CONTROL_PNL_UNAVAILABLE';
  return out('HOLD','NONE',[controlCode],.1,0);
}
