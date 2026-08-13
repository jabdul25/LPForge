// LPFORGE_PHASE7_RUNTIME_INTEGRATION_MODULE
import {createHash} from 'node:crypto';
import type {Phase1Store} from '../../db/src/index.js';
import {assessPhase7Drift,type Phase7DriftAssessment,type Phase7DriftPolicy,type Phase7EvaluationMetrics} from '../../phase7-drift/src/index.js';
export const defaultPhase7LiveDriftPolicy:Phase7DriftPolicy={minSamples:50,maxForecastRelativeDegradation:.25,maxNetValueMaeRelativeDegradation:.5,maxDecisionRateShift:.2,maxExecutionCostRelativeDegradation:.5,maxReconciliationMismatchRate:.01,maxFeatureMissingRate:.05,maxDecoderSkipRate:.02};
export interface Phase7LiveDriftResult {assessment:Phase7DriftAssessment;baselineHash:string;current:Phase7EvaluationMetrics;coverage:{forecastOutcomeMetrics:boolean;decoderSkipTelemetry:boolean};reasonCodes:string[];}
const stable=(v:unknown):string=>Array.isArray(v)?`[${v.map(stable).join(',')}]`:v&&typeof v==='object'?`{${Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${stable(x)}`).join(',')}}`:JSON.stringify(v);
export function phase7DriftBaselineHash(metrics:Phase7EvaluationMetrics):string{return createHash('sha256').update(stable(metrics)).digest('hex');}
export async function assessPhase7LiveDrift(input:{store:Pick<Phase1Store,'loadPhase7DriftFacts'>;poolAddress:string;since:string;observedAt:string;baseline:Phase7EvaluationMetrics;policy:Phase7DriftPolicy;decoderSkipRate?:number;forecastOutcomeMetrics?:Pick<Phase7EvaluationMetrics,'regimeBrier'|'survivalBrier'|'netValueMae'>}):Promise<Phase7LiveDriftResult>{
  const f=await input.store.loadPhase7DriftFacts(input.poolAddress,input.since);const n=f.cycleCount;const forecast=input.forecastOutcomeMetrics;const decoderKnown=input.decoderSkipRate!==undefined;
  const current:Phase7EvaluationMetrics={sampleCount:n,regimeBrier:forecast?.regimeBrier??input.baseline.regimeBrier,survivalBrier:forecast?.survivalBrier??input.baseline.survivalBrier,netValueMae:forecast?.netValueMae??input.baseline.netValueMae,noTradeRate:n?f.noTradeCount/n:0,entryReadyRate:n?f.entryReadyCount/n:0,executionCostRate:f.canaryCapitalLamports>0?f.canaryExecutionCostLamports/f.canaryCapitalLamports:input.baseline.executionCostRate,reconciliationMismatchRate:f.reconciliationCount?f.reconciliationMismatchCount/f.reconciliationCount:0,featureMissingRate:n?f.featureMissingCount/n:0,decoderSkipRate:input.decoderSkipRate??input.baseline.decoderSkipRate};
  const base=assessPhase7Drift({baseline:input.baseline,current,policy:input.policy,observedAt:input.observedAt});const reasons=[...base.reasonCodes];let status=base.status;
  if(!forecast){reasons.push('P7_LIVE_DRIFT_FORECAST_OUTCOME_COVERAGE_INCOMPLETE');if(status==='STABLE')status='WATCH';}
  if(!decoderKnown){reasons.push('P7_LIVE_DRIFT_DECODER_TELEMETRY_MISSING');status='BLOCK';}
  const assessment:Phase7DriftAssessment={...base,status,reasonCodes:[...new Set(reasons)].sort(),newEntriesAllowed:status!=='BLOCK'};
  return{assessment,baselineHash:phase7DriftBaselineHash(input.baseline),current,coverage:{forecastOutcomeMetrics:Boolean(forecast),decoderSkipTelemetry:decoderKnown},reasonCodes:assessment.reasonCodes};
}
