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
  reasonCodes:string[];
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
export interface LiveExitGovernorInput {
  policy:LiveExitGovernorPolicy;
  economics:PositionEconomicsSnapshot;
  highWater?:ExitHighWaterState;
  thesisStatus?:'VALID'|'DETERIORATING'|'INVALIDATED'|'EMERGENCY'|'UNKNOWN';
  currentForwardEv?:number;
  closeCost?:number;
  riskDecision?:'APPROVE'|'BLOCK'|'EMERGENCY';
  riskReasonCodes?:string[];
  toxicityProbability?:number;
  liquidityCollapse?:boolean;
  positionAgeMinutes?:number;
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
export function derivePositionEconomics(input:{position:PositionV2Fact;pool:DataApiPool;initialCapitalLamports:bigint;observedAt:string;realizedFeeCashflows?:readonly RealizedPositionCashflow[]}):PositionEconomicsSnapshot{
  const {position,pool,initialCapitalLamports,observedAt}=input,x=pool.token_x,y=pool.token_y;
  const sol=x?.address==='So11111111111111111111111111111111111111112'?x:y?.address==='So11111111111111111111111111111111111111112'?y:undefined;
  const initial=finite(sol?.price)&&sol!.price!>0?Number(initialCapitalLamports)/1e9*sol!.price!:undefined;
  const xv=tokenUsd(position.totalXAmount,x?.decimals,x?.price),yv=tokenUsd(position.totalYAmount,y?.decimals,y?.price);
  const fux=tokenUsd(position.feeX,x?.decimals,x?.price)??0,fuy=tokenUsd(position.feeY,y?.decimals,y?.price)??0;
  const onPositionClaimedX=tokenUsd(position.claimedFeeX,x?.decimals,x?.price)??0,onPositionClaimedY=tokenUsd(position.claimedFeeY,y?.decimals,y?.price)??0,
    ledger=input.realizedFeeCashflows&&input.realizedFeeCashflows.length>0?valuePositionCashflows({cashflows:input.realizedFeeCashflows,pool}):undefined;
  const reasons:string[]=[];if(initial===undefined||!(initial>0))reasons.push('EXIT_VALUATION_INITIAL_CAPITAL_UNAVAILABLE');if(xv===undefined)reasons.push('EXIT_VALUATION_TOKEN_X_UNAVAILABLE');if(yv===undefined)reasons.push('EXIT_VALUATION_TOKEN_Y_UNAVAILABLE');
  if(ledger&&!ledger.complete)reasons.push(...ledger.reasonCodes);
  if(reasons.length)return{evidenceState:'UNAVAILABLE',observedAt,reasonCodes:[...new Set(reasons)].sort()};
  // Once the durable ledger is present it is the authority for fees already
  // withdrawn to the wallet. This prevents a CLAIM from looking like a loss
  // and avoids double counting an SDK cumulative claimed-fee field.
  const realizedFees=ledger?.hasRealizedFeeFlow?ledger.realizedFeeUsd:(onPositionClaimedX+onPositionClaimedY),contributed=ledger?.contributionsUsd&&ledger.contributionsUsd>0?ledger.contributionsUsd:initial!,withdrawals=ledger?.realizedWithdrawalUsd??0,costs=ledger?.executionCostUsd??0,fees=fux+fuy+realizedFees,current=xv!+yv!+fees+withdrawals-costs,net=current-contributed,fraction=net/contributed;
  return{evidenceState:'AVAILABLE',observedAt,initialCapitalUsd:contributed,currentEconomicValueUsd:current,netPnlUsd:net,netReturnFraction:fraction,feesValueUsd:fees,realizedFeeValueUsd:realizedFees,realizedWithdrawalValueUsd:withdrawals,contributedCapitalUsd:contributed,executionCostUsd:costs,reasonCodes:['EXIT_VALUATION_CAPITAL_NORMALIZED',...(ledger?['EXIT_VALUATION_REALIZED_CASHFLOWS']:[])]};
}
function nextHighWater(e:PositionEconomicsSnapshot,prior?:ExitHighWaterState):ExitHighWaterState{
  const current=e.netReturnFraction??Number.NEGATIVE_INFINITY;
  if(!prior||current>prior.peakNetReturnFraction)return{peakNetReturnFraction:Number.isFinite(current)?current:prior?.peakNetReturnFraction??0,...(e.currentEconomicValueUsd!==undefined?{peakEconomicValueUsd:e.currentEconomicValueUsd}:{}),peakObservedAt:e.observedAt};
  return prior;
}
export function assessLiveExit(input:LiveExitGovernorInput):LiveExitGovernorDecision{
  const p=input.policy,e=input.economics,hw=nextHighWater(e,input.highWater),current=e.netReturnFraction,giveback=finite(current)?Math.max(0,hw.peakNetReturnFraction-current):null;
  const out=(action:LiveExitAction,family:LiveExitGovernorDecision['reasonFamily'],codes:string[],urgency:number,reduceFraction=0):LiveExitGovernorDecision=>({action,reasonFamily:family,reasonCodes:[...new Set(codes)].sort(),urgency:clamp(urgency),reduceFraction,economics:e,highWater:hw,peakGivebackFraction:giveback});
  if(!p.enabled)return out('HOLD','NONE',['EXIT_GOVERNOR_DISABLED'],0);
  const tox=finite(input.toxicityProbability)?input.toxicityProbability:0;
  if(input.liquidityCollapse||input.riskDecision==='EMERGENCY'||input.thesisStatus==='EMERGENCY'||tox>=p.toxicityEmergencyThreshold||(finite(current)&&current<=-p.emergencyStopLossFraction))return out('EMERGENCY_CLOSE','EMERGENCY',[input.liquidityCollapse?'EXIT_LIQUIDITY_COLLAPSE':'',input.riskDecision==='EMERGENCY'?'EXIT_EMERGENCY_RISK':'',input.thesisStatus==='EMERGENCY'?'EXIT_THESIS_EMERGENCY':'',tox>=p.toxicityEmergencyThreshold?'EXIT_TOXICITY_EMERGENCY':'',finite(current)&&current<=-p.emergencyStopLossFraction?'EXIT_EMERGENCY_STOP_LOSS':''].filter(Boolean),1,1);
  if(finite(current)&&current<=-p.hardStopLossFraction)return out('CLOSE','CAPITAL_PROTECTION',['EXIT_HARD_POSITION_STOP_LOSS'],.95,1);
  if(p.takeProfitFraction>0&&finite(current)&&current>=p.takeProfitFraction)return out('CLOSE','PROFIT_PROTECTION',['EXIT_TAKE_PROFIT_TARGET'],.88,1);
  if(p.closeOnThesisInvalidated&&input.thesisStatus==='INVALIDATED')return out('CLOSE','THESIS',['EXIT_THESIS_INVALIDATED'],.9,1);
  if(tox>=p.toxicityCloseThreshold)return out('CLOSE','RISK',['EXIT_TOXICITY_TOO_HIGH'],.85,1);
  if(p.profitProtection.enabled&&finite(current)&&hw.peakNetReturnFraction>=p.profitProtection.triggerFraction&&giveback!==null&&giveback>=p.profitProtection.maxGivebackFraction&&current>=p.profitProtection.minRetainedProfitFraction)return out('CLOSE','PROFIT_PROTECTION',['EXIT_PROFIT_GIVEBACK_LIMIT'],.82,1);
  const closeCost=Math.max(0,input.closeCost??0);if(p.closeOnNonPositiveForwardEv&&finite(input.currentForwardEv)&&input.currentForwardEv<=-closeCost)return out('CLOSE','FORWARD_EV',['EXIT_FORWARD_EV_INFERIOR_TO_CLOSE'],.75,1);
  if(p.reduceOnRiskBlock&&input.riskDecision==='BLOCK')return out('REDUCE','RISK',['EXIT_REDUCE_RISK_BLOCK',...(input.riskReasonCodes??[])],.7,p.reduceFraction);
  if(p.maxHoldMinutes>0&&finite(input.positionAgeMinutes)&&input.positionAgeMinutes!>=p.maxHoldMinutes&&(!p.maxHoldRequiresNonPositiveForwardEv||(finite(input.currentForwardEv)&&input.currentForwardEv!<=0)))return out('CLOSE','TIME',['EXIT_MAX_HOLD_REACHED'],.6,1);
  return out('HOLD','NONE',[e.evidenceState==='AVAILABLE'?'EXIT_HOLD_WITH_ECONOMIC_EVIDENCE':'EXIT_HOLD_ECONOMIC_EVIDENCE_UNAVAILABLE'],.1,0);
}
