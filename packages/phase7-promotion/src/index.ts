// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
import type {Phase6ExitDecision} from '../../phase6-evaluation/src/index.js';
import type {Phase7HealthAssessment} from '../../phase7-health/src/index.js';
import type {Phase7PromotionBundle,Phase7PromotionTarget} from '../../phase7-policy-registry/src/index.js';
export interface Phase7LimitedLiveEvidence {runs:number;fullyReconciledRuns:number;failedRuns:number;duplicateEconomicActions:number;unresolvedReconciliationDebt:number;reconciliationMismatchRate:number;maxDrawdownFraction:number;emergencyStopEvidence:boolean;rollbackTested:boolean;}
export interface Phase7PromotionPolicy {minLimitedLiveRuns:number;minFullyReconciledLimitedLiveRuns:number;maxLimitedLiveFailures:number;maxReconciliationMismatchRate:number;maxDrawdownFraction:number;requireEmergencyStopEvidence:boolean;requireRollbackTest:boolean;}
export interface Phase7PromotionDecision {target:Phase7PromotionTarget;implementationStatus:'PASS';operationalStatus:'PASS'|'HOLD'|'BLOCK';promotion:'LIMITED_LIVE_ELIGIBLE'|'PRODUCTION_ELIGIBLE'|'NOT_ELIGIBLE';reasonCodes:string[];productionAuthorityIssued:false;automaticPolicyPromotion:false;scalingEnabled:false;}
export function evaluatePhase7Promotion(input:{target:Phase7PromotionTarget;bundle:Phase7PromotionBundle;health:Phase7HealthAssessment;phase6:Phase6ExitDecision;limitedLive:Phase7LimitedLiveEvidence;policy:Phase7PromotionPolicy}):Phase7PromotionDecision{
  const r:string[]=[];const p=input.policy;if(p.minLimitedLiveRuns<1||p.minFullyReconciledLimitedLiveRuns<1||p.maxLimitedLiveFailures<0||p.maxReconciliationMismatchRate<0||p.maxDrawdownFraction<0)throw new Error('LPFORGE_P7_PROMOTION_POLICY');
  if(input.bundle.target!==input.target)r.push('P7_PROMOTION_BUNDLE_TARGET_MISMATCH');if(!input.bundle.complete)r.push('P7_PROMOTION_BUNDLE_INCOMPLETE');
  if(input.health.status!=='HEALTHY')r.push('P7_PROMOTION_HEALTH_NOT_HEALTHY');
  if(input.phase6.operationalStatus!=='PASS'||input.phase6.productionPromotion!=='LIMITED_LIVE_ELIGIBLE')r.push('P7_PROMOTION_PHASE6_NOT_READY');
  if(input.limitedLive.unresolvedReconciliationDebt>0)r.push('P7_PROMOTION_RECONCILIATION_DEBT');
  if(input.limitedLive.duplicateEconomicActions>0)r.push('P7_PROMOTION_DUPLICATE_ECONOMIC_ACTION');
  if(input.target==='PRODUCTION'){
    if(input.limitedLive.runs<p.minLimitedLiveRuns)r.push('P7_PROMOTION_LIMITED_LIVE_RUNS_INSUFFICIENT');
    if(input.limitedLive.fullyReconciledRuns<p.minFullyReconciledLimitedLiveRuns)r.push('P7_PROMOTION_LIMITED_LIVE_RECONCILIATION_INSUFFICIENT');
    if(input.limitedLive.failedRuns>p.maxLimitedLiveFailures)r.push('P7_PROMOTION_LIMITED_LIVE_FAILURE_LIMIT');
    if(input.limitedLive.reconciliationMismatchRate>p.maxReconciliationMismatchRate)r.push('P7_PROMOTION_MISMATCH_RATE_LIMIT');
    if(input.limitedLive.maxDrawdownFraction>p.maxDrawdownFraction)r.push('P7_PROMOTION_DRAWDOWN_LIMIT');
    if(p.requireEmergencyStopEvidence&&!input.limitedLive.emergencyStopEvidence)r.push('P7_PROMOTION_EMERGENCY_STOP_NOT_PROVEN');
    if(p.requireRollbackTest&&!input.limitedLive.rollbackTested)r.push('P7_PROMOTION_ROLLBACK_NOT_PROVEN');
  }
  const hard=new Set(['P7_PROMOTION_BUNDLE_TARGET_MISMATCH','P7_PROMOTION_RECONCILIATION_DEBT','P7_PROMOTION_DUPLICATE_ECONOMIC_ACTION','P7_PROMOTION_MISMATCH_RATE_LIMIT','P7_PROMOTION_DRAWDOWN_LIMIT']);
  const operationalStatus=r.some(x=>hard.has(x))?'BLOCK':r.length?'HOLD':'PASS';
  return{target:input.target,implementationStatus:'PASS',operationalStatus,promotion:operationalStatus==='PASS'?(input.target==='LIMITED_LIVE'?'LIMITED_LIVE_ELIGIBLE':'PRODUCTION_ELIGIBLE'):'NOT_ELIGIBLE',reasonCodes:[...new Set(r)].sort(),productionAuthorityIssued:false,automaticPolicyPromotion:false,scalingEnabled:false};
}
