import type { CandidateEconomicSimulation } from '../../candidate-simulator/src/index.js';

/** Frozen from chronological 60-minute canonical forward-outcome fitting. */
export const FEE_EVIDENCE_CALIBRATION_VERSION='fee-evidence-calibration-v1' as const;
const FIT_LOG_NORMALIZATION_SCALE_MEAN=0.0089274613073259;
const FIT_LOG_NORMALIZATION_SCALE_STANDARD_DEVIATION=0.02288845827728153;
const FIT_CREDIBILITY_INTERCEPT=0.46130841877268086;
const FIT_NORMALIZATION_SCALE_COEFFICIENT=-0.0968457048995752;

export type FeeEvidenceCalibrationStatus='CALIBRATED'|'EVIDENCE_INSUFFICIENT'|'NOT_APPLIED';
export interface FeeEvidenceCalibration {
  version:typeof FEE_EVIDENCE_CALIBRATION_VERSION;
  status:FeeEvidenceCalibrationStatus;
  rawReplayFeeValue:number;
  calibratedFeeValue:number;
  credibility:number|null;
  normalizationScale:number|null;
  reasonCodes:string[];
}

const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

/**
 * Calibrates the capital-normalised replay result, not the simulator itself.
 * A larger normalisation scale expands a smaller synthetic inventory further
 * to 0.03 SOL; held-out outcomes identified that expansion as the stable
 * over-prediction signal. This is bounded, deterministic, and not a gate.
 */
export function calibrateCandidateReplayFee(input:{rawReplayFeeValue:number;normalizationScale:number|undefined}):FeeEvidenceCalibration {
  const rawReplayFeeValue=finite(input.rawReplayFeeValue)?Math.max(0,input.rawReplayFeeValue):0;
  const normalizationScale=input.normalizationScale;
  if(!finite(normalizationScale)||!(normalizationScale>0)||!finite(input.rawReplayFeeValue)){
    return{version:FEE_EVIDENCE_CALIBRATION_VERSION,status:'EVIDENCE_INSUFFICIENT',rawReplayFeeValue,calibratedFeeValue:0,credibility:null,normalizationScale:finite(normalizationScale)?normalizationScale:null,reasonCodes:['FEE_CALIBRATION_EVIDENCE_INSUFFICIENT']};
  }
  const standardized=(Math.log1p(normalizationScale)-FIT_LOG_NORMALIZATION_SCALE_MEAN)/FIT_LOG_NORMALIZATION_SCALE_STANDARD_DEVIATION;
  const unbounded=FIT_CREDIBILITY_INTERCEPT+FIT_NORMALIZATION_SCALE_COEFFICIENT*standardized;
  const credibility=clamp(unbounded);
  const reasonCodes=['FEE_CALIBRATION_NORMALIZATION_SCALE_CREDIBILITY'];
  if(unbounded<=0)reasonCodes.push('FEE_CALIBRATION_CREDIBILITY_CLAMPED_LOW');
  if(unbounded>=1)reasonCodes.push('FEE_CALIBRATION_CREDIBILITY_CLAMPED_HIGH');
  return{version:FEE_EVIDENCE_CALIBRATION_VERSION,status:'CALIBRATED',rawReplayFeeValue,calibratedFeeValue:rawReplayFeeValue*credibility,credibility,normalizationScale,reasonCodes};
}

/** Applies calibration while retaining all raw replay values for audit/research. */
export function applyFeeEvidenceCalibration(simulation:CandidateEconomicSimulation):CandidateEconomicSimulation {
  if(simulation.evidenceActionable===false){
    return{...simulation,rawReplayFeeValue:simulation.feeValue,rawReplayGrossValueChange:simulation.grossValueChange,rawReplayNetValue:simulation.netValue,feeEvidenceCalibration:{version:FEE_EVIDENCE_CALIBRATION_VERSION,status:'NOT_APPLIED',rawReplayFeeValue:simulation.feeValue,calibratedFeeValue:simulation.feeValue,credibility:null,normalizationScale:finite(simulation.normalizationScale)?simulation.normalizationScale:null,reasonCodes:['FEE_CALIBRATION_RAW_REPLAY_NOT_ACTIONABLE']}};
  }
  const calibration=calibrateCandidateReplayFee({rawReplayFeeValue:simulation.feeValue,normalizationScale:simulation.normalizationScale});
  const grossValueChange=calibration.calibratedFeeValue+simulation.inventoryChangeValue;
  const netValue=grossValueChange-simulation.totalCostValue;
  const warnings=[...new Set([...simulation.warnings,...(calibration.status==='EVIDENCE_INSUFFICIENT'?calibration.reasonCodes:[])])].sort();
  return{...simulation,rawReplayFeeValue:simulation.feeValue,rawReplayGrossValueChange:simulation.grossValueChange,rawReplayNetValue:simulation.netValue,feeValue:calibration.calibratedFeeValue,grossValueChange,netValue,evidenceActionable:calibration.status==='CALIBRATED'&&simulation.evidenceActionable,feeEvidenceCalibration:calibration,warnings};
}
