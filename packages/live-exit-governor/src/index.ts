import { readFileSync } from 'node:fs';
import type { DataApiPool } from '../../data-api/src/index.js';
import type { PositionV2Fact } from '../../domain/src/index.js';

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
export function loadLiveExitGovernorPolicy(path='policies/live-exit-governor-policy.json'):LiveExitGovernorPolicy{return parseLiveExitGovernorPolicy(JSON.parse(readFileSync(path,'utf8')));}
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
    if(!['OPEN_CONTRIBUTION','ADD_CONTRIBUTION','FEE_CLAIM','REWARD_CLAIM','REDUCE_WITHDRAWAL','CLOSE_WITHDRAWAL','SWAP_PROCEEDS','SWAP_COST','TX_COST'].includes(flow.flowType))continue;
    hasEconomicCashflow=true;
    // Legacy reductions stored an estimated capital basis in lamports. That
    // is not a wallet realization and is never treated as PnL.
    if((flow.flowType==='REDUCE_WITHDRAWAL'||flow.flowType==='CLOSE_WITHDRAWAL')&&!flow.tokenMint&&!flow.tokenAmountRaw)continue;
    const token=tokens.find(candidate=>candidate.address===flow.tokenMint);
    const tokenValue=flow.tokenMint?tokenUsd(flow.tokenAmountRaw,token?.decimals,token?.price):undefined;
    const lamportValue=flow.lamports!==undefined&&sol?Number(flow.lamports)/1e9*(sol.price??Number.NaN):undefined;
    const value=tokenValue??lamportValue;
    if(value===undefined||!Number.isFinite(value)){complete=false;reasons.push('EXIT_CASHFLOW_VALUE_UNAVAILABLE');continue;}
    if(flow.flowType==='OPEN_CONTRIBUTION'||flow.flowType==='ADD_CONTRIBUTION')contributionsUsd+=value;
    else if(flow.flowType==='FEE_CLAIM'||flow.flowType==='REWARD_CLAIM'){realizedFeeUsd+=value;hasRealizedFeeFlow=true;}
    else if(flow.flowType==='REDUCE_WITHDRAWAL'||flow.flowType==='CLOSE_WITHDRAWAL'||flow.flowType==='SWAP_PROCEEDS')realizedWithdrawalUsd+=value;
    else executionCostUsd+=value;
  }
  return{contributionsUsd,realizedFeeUsd,realizedWithdrawalUsd,executionCostUsd,complete,hasEconomicCashflow,hasRealizedFeeFlow,reasonCodes:[...new Set(reasons)].sort()};
}
/** Backward-compatible fee-only view for reporting callers. */
export function valueRealizedFeeCashflows(input:{cashflows:readonly RealizedPositionCashflow[];pool:DataApiPool}){const v=valuePositionCashflows(input);return{valueUsd:v.realizedFeeUsd,complete:v.complete,reasonCodes:v.reasonCodes};}
/** Capital-normalized economic valuation. No value is fabricated when token price/decimals are unavailable. */
export function derivePositionEconomics(input:{position:PositionV2Fact;pool:DataApiPool;initialCapitalLamports:bigint;observedAt:string;realizedFeeCashflows?:readonly RealizedPositionCashflow[];attributedWalletInventory?:readonly AttributedWalletInventory[];actualContributedLamports?:bigint}):PositionEconomicsSnapshot{
  const {position,pool,initialCapitalLamports,observedAt}=input,x=pool.token_x,y=pool.token_y;
  const tokens=[x,y].filter((token):token is NonNullable<typeof token>=>Boolean(token));
  const sol=x?.address==='So11111111111111111111111111111111111111112'?x:y?.address==='So11111111111111111111111111111111111111112'?y:undefined;
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
function completeNav(input:LiveExitGovernorInput){const e=input.economics;return input.completeNavFresh===true&&e.evidenceState==='AVAILABLE'&&e.reasonCodes.includes('EXIT_VALUATION_COMPLETE_MANAGED_NAV')&&finite(e.netReturnFraction);}
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
  let authority=marketAuthority(input);
  const out=(action:LiveExitAction,family:LiveExitGovernorDecision['reasonFamily'],codes:string[],urgency:number,reduceFraction=0):LiveExitGovernorDecision=>({action,reasonFamily:family,reasonCodes:[...new Set(codes)].sort(),urgency:clamp(urgency),reduceFraction,economics:e,highWater:hw,peakGivebackFraction:giveback,marketConfirmation:authority.confirmation});
  if(!p.enabled)return out('HOLD','NONE',['EXIT_GOVERNOR_DISABLED'],0);
  const tox=finite(input.toxicityProbability)?input.toxicityProbability:0;
  // The -20% stop is a verified complete-NAV safety boundary.  Market-model
  // signals, including liquidity, toxicity, thesis, and risk labels, are
  // deliberately below it and must pass marketAuthority().
  if(completeNav(input)&&finite(current)&&current<=-p.emergencyStopLossFraction)return out('EMERGENCY_CLOSE','EMERGENCY',['EXIT_EMERGENCY_STOP_LOSS'],1,1);
  const defaultEvidence:MarketExitEvidence[]=[
    ...(input.liquidityCollapse?[{family:'LIQUIDITY' as const,code:'EXIT_LIQUIDITY_COLLAPSE',severe:true,quality:'TRUSTWORTHY' as const}]:[]),
    ...(tox>=p.toxicityEmergencyThreshold?[{family:'TOXICITY' as const,code:'EXIT_TOXICITY_EMERGENCY',severe:true,quality:'TRUSTWORTHY' as const}]:tox>=p.toxicityCloseThreshold?[{family:'TOXICITY' as const,code:'EXIT_TOXICITY_TOO_HIGH',severe:true,quality:'TRUSTWORTHY' as const}]:[]),
    ...(completeNav(input)&&finite(current)&&current<=-p.hardStopLossFraction?[{family:'COMPLETE_NAV' as const,code:'EXIT_HARD_POSITION_STOP_LOSS',severe:true,quality:'TRUSTWORTHY' as const}]:[]),
    ...((input.thesisStatus==='EMERGENCY'||(p.closeOnThesisInvalidated&&input.thesisStatus==='INVALIDATED'))?[{family:'THESIS' as const,code:input.thesisStatus==='EMERGENCY'?'EXIT_THESIS_EMERGENCY':'EXIT_THESIS_INVALIDATED',severe:true,quality:'TRUSTWORTHY' as const}]:[]),
  ];
  // Callers that provide provenance own the complete evidence set.  The
  // fallback preserves safe behaviour for non-operator callers and tests.
  const governed=marketAuthority({...input,marketEvidence:[...(input.marketEvidence??[]),...defaultEvidence]});
  authority=governed;
  if(governed.confirmed)return out('CLOSE','EMERGENCY',governed.reasonCodes,.9,1);
  if(governed.pending)return out('HOLD','EMERGENCY',governed.reasonCodes,.35,0);
  if(p.takeProfitFraction>0&&finite(current)&&current>=p.takeProfitFraction)return out('CLOSE','PROFIT_PROTECTION',['EXIT_TAKE_PROFIT_TARGET'],.88,1);
  if(p.profitProtection.enabled&&finite(current)&&hw.peakNetReturnFraction>=p.profitProtection.triggerFraction&&giveback!==null&&giveback>=p.profitProtection.maxGivebackFraction&&current>=p.profitProtection.minRetainedProfitFraction)return out('CLOSE','PROFIT_PROTECTION',['EXIT_PROFIT_GIVEBACK_LIMIT'],.82,1);
  if(p.closeOnNonPositiveForwardEv&&finite(input.currentForwardEv)){if(input.forwardEvEvidenceAvailable===false)return out('HOLD','NONE',['EXIT_POSITION_CONTINUATION_EVIDENCE_UNAVAILABLE'],.1,0);if(!finite(input.closeCost))return out('HOLD','NONE',['EXIT_CLOSE_COST_UNAVAILABLE'],.1,0);const closeCost=Math.max(0,input.closeCost);if(input.currentForwardEv<=-closeCost){const confirmations=Math.max(0,Math.floor(input.forwardEvConfirmationCount??0));if(confirmations<2)return out('HOLD','FORWARD_EV',['EXIT_FORWARD_EV_CONFIRMATION_PENDING'],.1,0);return out('CLOSE','FORWARD_EV',['EXIT_FORWARD_EV_INFERIOR_TO_CLOSE'],.75,1);}}
  if(p.reduceOnRiskBlock&&input.riskDecision==='BLOCK')return out('REDUCE','RISK',['EXIT_REDUCE_RISK_BLOCK',...(input.riskReasonCodes??[])],.7,p.reduceFraction);
  if(p.maxHoldMinutes>0&&finite(input.positionAgeMinutes)&&input.positionAgeMinutes!>=p.maxHoldMinutes&&(!p.maxHoldRequiresNonPositiveForwardEv||(finite(input.currentForwardEv)&&input.currentForwardEv!<=0)))return out('CLOSE','TIME',['EXIT_MAX_HOLD_REACHED'],.6,1);
  return out('HOLD','NONE',[e.evidenceState==='AVAILABLE'?'EXIT_HOLD_WITH_ECONOMIC_EVIDENCE':'EXIT_HOLD_ECONOMIC_EVIDENCE_UNAVAILABLE'],.1,0);
}
