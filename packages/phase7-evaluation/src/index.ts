// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
import type {Phase7PromotionDecision} from '../../phase7-promotion/src/index.js';
export interface Phase7ExitEvidence {
  stageGates:Record<string,'PASS'|'HOLD'|'BLOCK'>;
  fullRegressionPass:boolean;
  phaseBoundariesPass:boolean;
  migrationsPass:boolean;
  postgresRuntimeVerified:boolean;
  localMeteoraLifecyclePass:boolean;
  mainnetReadOnlyVerified:boolean;
  disasterRecoveryStatus:'PASS'|'HOLD'|'BLOCK';
  mainnetCanaryEvidenceReal:boolean;
  limitedLiveEvidenceSufficient:boolean;
  unresolvedReconciliationDebt:number;
  promotionDecision:Phase7PromotionDecision;
}
export interface Phase7ExitDecision {
  implementationStatus:'PASS'|'FAIL';
  operationalStatus:'PASS'|'HOLD'|'BLOCK';
  productionPromotion:'PRODUCTION_ELIGIBLE'|'NOT_ELIGIBLE';
  reasonCodes:string[];
  productionAuthorityIssued:false;
  automaticPolicyPromotion:false;
  scalingEnabled:false;
}
export function evaluatePhase7Exit(e:Phase7ExitEvidence):Phase7ExitDecision{
  const r:string[]=[];const expected=Array.from({length:15},(_,i)=>`P7-${String(i+1).padStart(2,'0')}`);
  for(const s of expected)if(e.stageGates[s]!=='PASS')r.push(`P7_EXIT_STAGE_NOT_PASS:${s}`);
  if(!e.fullRegressionPass)r.push('P7_EXIT_FULL_REGRESSION_NOT_PASS');if(!e.phaseBoundariesPass)r.push('P7_EXIT_BOUNDARIES_NOT_PASS');if(!e.migrationsPass)r.push('P7_EXIT_MIGRATIONS_NOT_PASS');if(!e.postgresRuntimeVerified)r.push('P7_EXIT_POSTGRES_NOT_VERIFIED');if(!e.localMeteoraLifecyclePass)r.push('P7_EXIT_LOCAL_METEORA_NOT_PASS');
  const implementationFailures=r.length;const implementationStatus=implementationFailures?'FAIL':'PASS';
  if(!e.mainnetReadOnlyVerified)r.push('P7_EXIT_MAINNET_READ_ONLY_NOT_VERIFIED');if(e.disasterRecoveryStatus!=='PASS')r.push(`P7_EXIT_DISASTER_RECOVERY_${e.disasterRecoveryStatus}`);if(!e.mainnetCanaryEvidenceReal)r.push('P7_EXIT_REAL_MAINNET_CANARY_MISSING');if(!e.limitedLiveEvidenceSufficient)r.push('P7_EXIT_LIMITED_LIVE_EVIDENCE_INSUFFICIENT');if(e.unresolvedReconciliationDebt>0)r.push('P7_EXIT_RECONCILIATION_DEBT');if(e.promotionDecision.promotion!=='PRODUCTION_ELIGIBLE'||e.promotionDecision.operationalStatus!=='PASS')r.push('P7_EXIT_PRODUCTION_PROMOTION_NOT_ELIGIBLE');
  const hard=r.some(x=>x.startsWith('P7_EXIT_STAGE_NOT_PASS')||['P7_EXIT_FULL_REGRESSION_NOT_PASS','P7_EXIT_BOUNDARIES_NOT_PASS','P7_EXIT_MIGRATIONS_NOT_PASS','P7_EXIT_POSTGRES_NOT_VERIFIED','P7_EXIT_RECONCILIATION_DEBT'].includes(x));
  const operationalStatus=hard?'BLOCK':r.length?'HOLD':'PASS';
  return{implementationStatus,operationalStatus,productionPromotion:operationalStatus==='PASS'?'PRODUCTION_ELIGIBLE':'NOT_ELIGIBLE',reasonCodes:[...new Set(r)].sort(),productionAuthorityIssued:false,automaticPolicyPromotion:false,scalingEnabled:false};
}
