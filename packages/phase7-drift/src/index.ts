// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
export interface Phase7EvaluationMetrics {
  sampleCount:number;
  regimeBrier:number;
  survivalBrier:number;
  netValueMae:number;
  noTradeRate:number;
  entryReadyRate:number;
  executionCostRate:number;
  reconciliationMismatchRate:number;
  featureMissingRate:number;
  decoderSkipRate:number;
}
export interface Phase7DriftPolicy {
  minSamples:number;
  maxForecastRelativeDegradation:number;
  maxNetValueMaeRelativeDegradation:number;
  maxDecisionRateShift:number;
  maxExecutionCostRelativeDegradation:number;
  maxReconciliationMismatchRate:number;
  maxFeatureMissingRate:number;
  maxDecoderSkipRate:number;
}
export interface Phase7DriftAssessment {
  status:'STABLE'|'WATCH'|'BLOCK';
  reasonCodes:string[];
  observedAt:string;
  sampleCount:number;
  newEntriesAllowed:boolean;
  managementAllowed:true;
  policyMutationAllowed:false;
  automaticPolicyPromotion:false;
  deltas:Record<string,number>;
}
const finite=(v:number)=>Number.isFinite(v)&&v>=0;
const rel=(base:number,current:number)=>base>0?(current-base)/base:(current>0?Infinity:0);
export function assessPhase7Drift(input:{baseline:Phase7EvaluationMetrics;current:Phase7EvaluationMetrics;policy:Phase7DriftPolicy;observedAt:string}):Phase7DriftAssessment{
  const {baseline:b,current:c,policy:p}=input;for(const v of Object.values({...b,...c}))if(typeof v==='number'&&!finite(v))throw new Error('LPFORGE_P7_DRIFT_METRIC');
  if(p.minSamples<1||p.maxForecastRelativeDegradation<0||p.maxNetValueMaeRelativeDegradation<0||p.maxDecisionRateShift<0||p.maxExecutionCostRelativeDegradation<0||p.maxReconciliationMismatchRate<0||p.maxFeatureMissingRate<0||p.maxDecoderSkipRate<0)throw new Error('LPFORGE_P7_DRIFT_POLICY');
  const deltas={regimeBrierRelative:rel(b.regimeBrier,c.regimeBrier),survivalBrierRelative:rel(b.survivalBrier,c.survivalBrier),netValueMaeRelative:rel(b.netValueMae,c.netValueMae),noTradeRateShift:Math.abs(c.noTradeRate-b.noTradeRate),entryReadyRateShift:Math.abs(c.entryReadyRate-b.entryReadyRate),executionCostRelative:rel(b.executionCostRate,c.executionCostRate),reconciliationMismatchRate:c.reconciliationMismatchRate,featureMissingRate:c.featureMissingRate,decoderSkipRate:c.decoderSkipRate};
  const watch:string[]=[];const hard:string[]=[];
  if(c.sampleCount<p.minSamples)watch.push('P7_DRIFT_SAMPLE_INSUFFICIENT');
  if(deltas.regimeBrierRelative>p.maxForecastRelativeDegradation)watch.push('P7_DRIFT_REGIME_CALIBRATION');
  if(deltas.survivalBrierRelative>p.maxForecastRelativeDegradation)watch.push('P7_DRIFT_SURVIVAL_CALIBRATION');
  if(deltas.netValueMaeRelative>p.maxNetValueMaeRelativeDegradation)watch.push('P7_DRIFT_NET_VALUE_ERROR');
  if(deltas.noTradeRateShift>p.maxDecisionRateShift||deltas.entryReadyRateShift>p.maxDecisionRateShift)watch.push('P7_DRIFT_DECISION_RATE_SHIFT');
  if(deltas.executionCostRelative>p.maxExecutionCostRelativeDegradation)watch.push('P7_DRIFT_EXECUTION_COST');
  if(c.reconciliationMismatchRate>p.maxReconciliationMismatchRate)hard.push('P7_DRIFT_RECONCILIATION_MISMATCH');
  if(c.featureMissingRate>p.maxFeatureMissingRate)hard.push('P7_DRIFT_FEATURE_MISSINGNESS');
  if(c.decoderSkipRate>p.maxDecoderSkipRate)hard.push('P7_DRIFT_DECODER_SKIPS');
  const status=hard.length?'BLOCK':watch.length?'WATCH':'STABLE';
  return{status,reasonCodes:[...new Set([...hard,...watch])].sort(),observedAt:input.observedAt,sampleCount:c.sampleCount,newEntriesAllowed:status!=='BLOCK',managementAllowed:true,policyMutationAllowed:false,automaticPolicyPromotion:false,deltas};
}
