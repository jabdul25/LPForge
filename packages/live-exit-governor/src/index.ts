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
  reasonCodes:string[];
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
/** Capital-normalized economic valuation. No value is fabricated when token price/decimals are unavailable. */
export function derivePositionEconomics(input:{position:PositionV2Fact;pool:DataApiPool;initialCapitalLamports:bigint;observedAt:string}):PositionEconomicsSnapshot{
  const {position,pool,initialCapitalLamports,observedAt}=input,x=pool.token_x,y=pool.token_y;
  const sol=x?.address==='So11111111111111111111111111111111111111112'?x:y?.address==='So11111111111111111111111111111111111111112'?y:undefined;
  const initial=finite(sol?.price)&&sol!.price!>0?Number(initialCapitalLamports)/1e9*sol!.price!:undefined;
  const xv=tokenUsd(position.totalXAmount,x?.decimals,x?.price),yv=tokenUsd(position.totalYAmount,y?.decimals,y?.price);
  const fux=tokenUsd(position.feeX,x?.decimals,x?.price)??0,fuy=tokenUsd(position.feeY,y?.decimals,y?.price)??0;
  const fcx=tokenUsd(position.claimedFeeX,x?.decimals,x?.price)??0,fcy=tokenUsd(position.claimedFeeY,y?.decimals,y?.price)??0;
  const reasons:string[]=[];if(initial===undefined||!(initial>0))reasons.push('EXIT_VALUATION_INITIAL_CAPITAL_UNAVAILABLE');if(xv===undefined)reasons.push('EXIT_VALUATION_TOKEN_X_UNAVAILABLE');if(yv===undefined)reasons.push('EXIT_VALUATION_TOKEN_Y_UNAVAILABLE');
  if(reasons.length)return{evidenceState:'UNAVAILABLE',observedAt,reasonCodes:reasons};
  const fees=fux+fuy+fcx+fcy,current=xv!+yv!+fees,net=current-initial!,fraction=net/initial!;
  return{evidenceState:'AVAILABLE',observedAt,initialCapitalUsd:initial!,currentEconomicValueUsd:current,netPnlUsd:net,netReturnFraction:fraction,feesValueUsd:fees,reasonCodes:['EXIT_VALUATION_CAPITAL_NORMALIZED']};
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
