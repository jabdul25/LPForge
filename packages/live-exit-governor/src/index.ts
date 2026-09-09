import { readFileSync } from 'node:fs';
import type { DataApiPool, MeteoraPositionPnl } from '../../data-api/src/index.js';
import type { PositionV2Fact } from '../../domain/src/index.js';

const WSOL_MINT='So11111111111111111111111111111111111111112';

export type ExitEvidenceState='AVAILABLE'|'UNAVAILABLE'|'STALE'|'CONTRADICTORY';
export type LiveExitAction='HOLD'|'REDUCE'|'CLOSE'|'EMERGENCY_CLOSE';
export interface ProfitProtectionPolicy {enabled:boolean;triggerFraction:number;maxGivebackFraction:number;minRetainedProfitFraction:number;}
export interface LiveExitGovernorPolicy {
  schemaVersion:1;
  enabled:boolean;
  hardStopLossFraction:number;
  emergencyStopLossFraction:number;
  takeProfitFraction:number;
  profitProtection:ProfitProtectionPolicy;
  closeOnThesisInvalidated:boolean;
  closeOnNonPositiveForwardEv:boolean;
  reduceOnRiskBlock:boolean;
  reduceFraction:number;
  maxHoldMinutes:number;
  maxHoldRequiresNonPositiveForwardEv:boolean;
  toxicityCloseThreshold:number;
  toxicityEmergencyThreshold:number;
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
 * It remains the capital-protection mark. Meteora-comparable UI/profit
 * performance is intentionally derived separately below.
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
  reasonCodes:string[];
}
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
/** Derives, rather than trusts, Meteora's displayed LP PnL formula. */
export function deriveMeteoraComparableLpPositionMarkToMarket(input:{positionPnl?:MeteoraPositionPnl;observedAt:string}):MeteoraComparableLpPositionMarkToMarketSnapshot{
  const p=input.positionPnl;
  if(!p)return{evidenceState:'UNAVAILABLE',observedAt:input.observedAt,reasonCodes:['LP_MTM_METEORA_POSITION_PNL_MISSING']};
  const deposits=apiNumber(p.allTimeDeposits?.total?.usd),balances=apiNumber(p.unrealizedPnl?.balances),withdrawals=apiNumber(p.allTimeWithdrawals?.total?.usd),claimedFees=apiNumber(p.allTimeFees?.total?.usd),feeX=apiNumber(p.unrealizedPnl?.unclaimedFeeTokenX?.usd),feeY=apiNumber(p.unrealizedPnl?.unclaimedFeeTokenY?.usd);
  if(deposits===undefined||deposits<=0||balances===undefined||withdrawals===undefined||claimedFees===undefined||feeX===undefined||feeY===undefined)return{evidenceState:'UNAVAILABLE',observedAt:input.observedAt,reasonCodes:['LP_MTM_METEORA_POSITION_PNL_INCOMPLETE']};
  const current=balances+withdrawals+claimedFees+feeX+feeY,net=current-deposits,reported=apiFiniteNumber(p.pnlPctChange);
  return{evidenceState:'AVAILABLE',observedAt:input.observedAt,entryPositionValueUsd:deposits,currentPositionValueUsd:current,netPnlUsd:net,netReturnFraction:net/deposits,...(reported===undefined?{}:{reportedNetReturnFraction:reported/100}),reasonCodes:['LP_POSITION_METEORA_COMPARABLE_MARK','LP_POSITION_METEORA_DEPOSIT_HISTORY']};
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
  /**
   * The receipt-backed LP-local mark. Hard/emergency stop policy consumes
   * this scope, never the broader managed-economic accounting mark.
   */
  lpPositionMtm?:LpPositionMarkToMarketSnapshot;
  /** True only when the LP mark has current chain facts and durable provenance. */
  lpPositionMtmFresh?:boolean;
  /** Fresh Meteora-comparable LP mark used only for profit/take-profit return semantics. */
  meteoraComparableLpMtm?:MeteoraComparableLpPositionMarkToMarketSnapshot;
  meteoraComparableLpMtmFresh?:boolean;
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
export function parseLiveExitGovernorPolicy(raw:unknown):LiveExitGovernorPolicy{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('LPFORGE_EXIT_POLICY_OBJECT');
  const v=raw as Record<string,unknown>,pp=v.profitProtection as Record<string,unknown>|undefined;
  const nums=['hardStopLossFraction','emergencyStopLossFraction','takeProfitFraction','reduceFraction','maxHoldMinutes','toxicityCloseThreshold','toxicityEmergencyThreshold'];
  if(v.schemaVersion!==1||typeof v.enabled!=='boolean'||!pp||typeof pp.enabled!=='boolean'||typeof v.closeOnThesisInvalidated!=='boolean'||typeof v.closeOnNonPositiveForwardEv!=='boolean'||typeof v.reduceOnRiskBlock!=='boolean'||typeof v.maxHoldRequiresNonPositiveForwardEv!=='boolean'||nums.some(k=>!finite(v[k])))throw new Error('LPFORGE_EXIT_POLICY_INVALID');
  if(!finite(pp.triggerFraction)||!finite(pp.maxGivebackFraction)||!finite(pp.minRetainedProfitFraction))throw new Error('LPFORGE_EXIT_POLICY_PROFIT_INVALID');
  const p=v as unknown as LiveExitGovernorPolicy;
  if(p.hardStopLossFraction<=0||p.emergencyStopLossFraction<=p.hardStopLossFraction||p.emergencyStopLossFraction>=1||p.takeProfitFraction<0||p.takeProfitFraction>=1||p.reduceFraction<=0||p.reduceFraction>=1||p.maxHoldMinutes<0||p.toxicityCloseThreshold<0||p.toxicityCloseThreshold>1||p.toxicityEmergencyThreshold<=p.toxicityCloseThreshold||p.toxicityEmergencyThreshold>1||p.profitProtection.triggerFraction<=0||p.profitProtection.maxGivebackFraction<=0||p.profitProtection.minRetainedProfitFraction<0)throw new Error('LPFORGE_EXIT_POLICY_RANGE');
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
function completeLpPositionMtm(input:LiveExitGovernorInput){const e=input.lpPositionMtm;return input.lpPositionMtmFresh===true&&e?.evidenceState==='AVAILABLE'&&e.reasonCodes.includes('LP_POSITION_MARK_TO_MARKET')&&finite(e.netReturnFraction);}
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
  const comparable=input.meteoraComparableLpMtmFresh===true&&input.meteoraComparableLpMtm?.evidenceState==='AVAILABLE'?input.meteoraComparableLpMtm:undefined;
  const lpProfitHighWater=confirmLpProfitHighWater({...(input.lpProfitHighWater?{prior:input.lpProfitHighWater}:{}),...(comparable?{current:comparable}:{})});
  const lpProfitCurrent=comparable?.netReturnFraction;
  const lpProfitPeak=lpProfitHighWater.peakNetReturnFraction;
  const lpProfitGiveback=finite(lpProfitCurrent)&&finite(lpProfitPeak)?Math.max(0,lpProfitPeak-lpProfitCurrent):null;
  let authority=marketAuthority(input);
  const out=(action:LiveExitAction,family:LiveExitGovernorDecision['reasonFamily'],codes:string[],urgency:number,reduceFraction=0):LiveExitGovernorDecision=>({action,reasonFamily:family,reasonCodes:[...new Set(codes)].sort(),urgency:clamp(urgency),reduceFraction,economics:e,highWater:hw,peakGivebackFraction:giveback,marketConfirmation:authority.confirmation,lpProfitHighWater,lpProfitGivebackFraction:lpProfitGiveback});
  if(!p.enabled)return out('HOLD','NONE',['EXIT_GOVERNOR_DISABLED'],0);
  const tox=finite(input.toxicityProbability)?input.toxicityProbability:0;
  const lpReturn=input.lpPositionMtm?.netReturnFraction;
  // Hard capital-loss actions use the receipt-backed LP-position return. The
  // broader managed NAV remains an accounting/risk context, but execution
  // cost, rent and wallet residuals must not independently close an LP.
  if(completeLpPositionMtm(input)&&finite(lpReturn)&&lpReturn<=-p.emergencyStopLossFraction)return out('EMERGENCY_CLOSE','EMERGENCY',['EXIT_EMERGENCY_STOP_LOSS'],1,1);
  const defaultEvidence:MarketExitEvidence[]=[
    ...(input.liquidityCollapse?[{family:'LIQUIDITY' as const,code:'EXIT_LIQUIDITY_COLLAPSE',severe:true,quality:'TRUSTWORTHY' as const}]:[]),
    ...(tox>=p.toxicityEmergencyThreshold?[{family:'TOXICITY' as const,code:'EXIT_TOXICITY_EMERGENCY',severe:true,quality:'TRUSTWORTHY' as const}]:tox>=p.toxicityCloseThreshold?[{family:'TOXICITY' as const,code:'EXIT_TOXICITY_TOO_HIGH',severe:true,quality:'TRUSTWORTHY' as const}]:[]),
    ...(completeLpPositionMtm(input)&&finite(lpReturn)&&lpReturn<=-p.hardStopLossFraction?[{family:'COMPLETE_NAV' as const,code:'EXIT_HARD_POSITION_STOP_LOSS',severe:true,quality:'TRUSTWORTHY' as const}]:[]),
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
  return out('HOLD','NONE',[e.evidenceState==='AVAILABLE'?'EXIT_HOLD_WITH_ECONOMIC_EVIDENCE':'EXIT_HOLD_ECONOMIC_EVIDENCE_UNAVAILABLE'],.1,0);
}
