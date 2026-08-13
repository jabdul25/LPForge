// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
import {assertManualApproval,assertPhase7Authority,type Phase7Authority,type Phase7ManualApproval} from '../../phase7-contracts/src/index.js';
export interface Phase7ScalingPolicy {maxStepBpsOfCurrent:number;maxAbsoluteExposureLamports:bigint;cooldownMs:number;minReconciledRunsSinceLastScale:number;maxDrawdownFraction:number;maxReconciliationMismatchRate:number;minPositiveNetRuns:number;maxScaleStepsPerDay:number;}
export interface Phase7ScalingEvidence {currentExposureLamports:bigint;requestedTargetExposureLamports:bigint;lastScaleAt?:string;reconciledRunsSinceLastScale:number;unresolvedReconciliationDebt:number;recentDrawdownFraction:number;reconciliationMismatchRate:number;positiveNetRuns:number;scaleStepsToday:number;healthStatus:'HEALTHY'|'DEGRADED'|'CRITICAL';now:string;}
export interface Phase7ScaleDecision {decision:'APPROVE_STEP'|'HOLD'|'BLOCK';approvedIncreaseLamports:bigint;approvedTargetExposureLamports:bigint;reasonCodes:string[];approvalId?:string;autonomousScaling:false;requiresExistingExecutionWorkflow:true;}
function validBps(v:number){return Number.isInteger(v)&&v>0&&v<=10_000;}
export function evaluatePhase7ScaleStep(input:{authority:Phase7Authority;approval:Phase7ManualApproval;evidence:Phase7ScalingEvidence;policy:Phase7ScalingPolicy}):Phase7ScaleDecision{
  const {authority,approval,evidence:e,policy:p}=input;assertPhase7Authority(authority,e.now);assertManualApproval(approval,e.now);
  if(approval.action!=='SCALE_STEP')throw new Error('LPFORGE_P7_SCALE_APPROVAL_ACTION');
  if(!validBps(p.maxStepBpsOfCurrent)||p.maxAbsoluteExposureLamports<=0n||p.cooldownMs<0||p.minReconciledRunsSinceLastScale<0||p.maxDrawdownFraction<0||p.maxReconciliationMismatchRate<0||p.minPositiveNetRuns<0||p.maxScaleStepsPerDay<1)throw new Error('LPFORGE_P7_SCALE_POLICY');
  const hard:string[]=[];const hold:string[]=[];
  if(authority.mode==='OBSERVE_ONLY'||authority.scalingMode==='DISABLED')hard.push('P7_SCALE_AUTHORITY_DISABLED');
  if(e.currentExposureLamports<=0n)hard.push('P7_SCALE_REQUIRES_EXISTING_EXPOSURE');
  if(e.requestedTargetExposureLamports<=e.currentExposureLamports)hard.push('P7_SCALE_TARGET_NOT_INCREASE');
  if(e.unresolvedReconciliationDebt>0)hard.push('P7_SCALE_RECONCILIATION_DEBT');
  if(e.healthStatus!=='HEALTHY')hard.push('P7_SCALE_HEALTH_NOT_HEALTHY');
  if(e.reconciliationMismatchRate>p.maxReconciliationMismatchRate)hard.push('P7_SCALE_MISMATCH_RATE');
  if(e.recentDrawdownFraction>p.maxDrawdownFraction)hard.push('P7_SCALE_DRAWDOWN');
  if(e.scaleStepsToday>=p.maxScaleStepsPerDay)hold.push('P7_SCALE_DAILY_STEP_LIMIT');
  if(e.reconciledRunsSinceLastScale<p.minReconciledRunsSinceLastScale)hold.push('P7_SCALE_RECONCILED_RUNS_INSUFFICIENT');
  if(e.positiveNetRuns<p.minPositiveNetRuns)hold.push('P7_SCALE_POSITIVE_RUNS_INSUFFICIENT');
  if(e.lastScaleAt&&Date.parse(e.now)-Date.parse(e.lastScaleAt)<p.cooldownMs)hold.push('P7_SCALE_COOLDOWN');
  if(hard.length)return{decision:'BLOCK',approvedIncreaseLamports:0n,approvedTargetExposureLamports:e.currentExposureLamports,reasonCodes:[...new Set(hard)].sort(),autonomousScaling:false,requiresExistingExecutionWorkflow:true};
  if(hold.length)return{decision:'HOLD',approvedIncreaseLamports:0n,approvedTargetExposureLamports:e.currentExposureLamports,reasonCodes:[...new Set(hold)].sort(),autonomousScaling:false,requiresExistingExecutionWorkflow:true};
  const stepCap=e.currentExposureLamports*BigInt(p.maxStepBpsOfCurrent)/10_000n;
  const requestedIncrease=e.requestedTargetExposureLamports-e.currentExposureLamports;
  const absoluteCapacity=p.maxAbsoluteExposureLamports>e.currentExposureLamports?p.maxAbsoluteExposureLamports-e.currentExposureLamports:0n;
  const approvedIncrease=[requestedIncrease,stepCap,absoluteCapacity].reduce((a,b)=>a<b?a:b);
  if(approvedIncrease<=0n)return{decision:'BLOCK',approvedIncreaseLamports:0n,approvedTargetExposureLamports:e.currentExposureLamports,reasonCodes:['P7_SCALE_ABSOLUTE_LIMIT'],autonomousScaling:false,requiresExistingExecutionWorkflow:true};
  return{decision:'APPROVE_STEP',approvedIncreaseLamports:approvedIncrease,approvedTargetExposureLamports:e.currentExposureLamports+approvedIncrease,reasonCodes:['P7_SCALE_STEP_APPROVED'],approvalId:approval.approvalId,autonomousScaling:false,requiresExistingExecutionWorkflow:true};
}
