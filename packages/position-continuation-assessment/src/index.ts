/**
 * Observe-only continuation assessment for an already-open LP position.
 *
 * This module deliberately has no dependency on execution, plan construction,
 * or exit governance.  It classifies persisted/current facts only; callers
 * retain full responsibility for where the resulting record is stored.
 */
export type PositionContinuationDecision='CONTINUATION_APPROVED'|'CONTINUATION_DEGRADED';
export interface PositionContinuationAssessmentPolicy {enabled:boolean;firstAssessmentMinutes:number;}
export interface PositionContinuationPriorState {schemaVersion:1;status:'PENDING'|'COMPLETED';checkpoint:'FIRST_FORECAST_HORIZON';startedAt:string;completedAt?:string;decision?:PositionContinuationDecision;reasonCodes?:string[];}
export interface PositionContinuationAssessmentInput {
  policy:PositionContinuationAssessmentPolicy;
  positionOpen:boolean;
  observedAt:string;
  enteredAt?:string;
  prior?:PositionContinuationPriorState;
  liveControlEvidenceState:string;
  liveControlReturnFraction?:number;
  rangeState:'IN_RANGE'|'OUT_OF_RANGE'|'UNKNOWN';
  inventoryClassification?:string;
  continuationEvLamports?:bigint;
  regime?:string;
  feeCompensationClassification?:string;
}
export interface PositionContinuationAssessment {
  status:'NONE'|'PENDING'|'COMPLETED';
  due:boolean;
  decision?:PositionContinuationDecision;
  reasonCodes:string[];
  startedAt?:string;
  completedAt?:string;
}

const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const enteredAtMs=(value:string|undefined)=>value===undefined?undefined:(Number.isFinite(Date.parse(value))?Date.parse(value):undefined);

/**
 * The result is intentionally one-shot in V1.  A completed first-horizon
 * checkpoint is durable and suppresses duplicate alerts across restarts.
 */
export function assessPositionContinuation(input:PositionContinuationAssessmentInput):PositionContinuationAssessment{
  if(!input.policy.enabled||!input.positionOpen)return{status:'NONE',due:false,reasonCodes:[]};
  const observedAt=Date.parse(input.observedAt),enteredAt=enteredAtMs(input.enteredAt);
  if(!Number.isFinite(observedAt)||enteredAt===undefined)return{status:'NONE',due:false,reasonCodes:['POSITION_CONTINUATION_ENTRY_TIME_UNAVAILABLE']};
  const ageMinutes=Math.max(0,(observedAt-enteredAt)/60_000);
  if(ageMinutes<input.policy.firstAssessmentMinutes)return{status:'NONE',due:false,reasonCodes:[]};
  if(input.prior?.schemaVersion===1&&input.prior.checkpoint==='FIRST_FORECAST_HORIZON'&&input.prior.status==='COMPLETED')return{status:'COMPLETED',due:true,decision:input.prior.decision!,reasonCodes:[...(input.prior.reasonCodes??[])],startedAt:input.prior.startedAt,completedAt:input.prior.completedAt!};

  const startedAt=input.prior?.schemaVersion===1&&input.prior.checkpoint==='FIRST_FORECAST_HORIZON'&&input.prior.status==='PENDING'&&input.prior.startedAt?input.prior.startedAt:input.observedAt;
  const reasons:string[]=[];
  if(input.liveControlEvidenceState!=='AVAILABLE')reasons.push('LIVE_CONTROL_EVIDENCE_UNAVAILABLE');
  else if(finite(input.liveControlReturnFraction)&&input.liveControlReturnFraction<0)reasons.push('LIVE_CONTROL_NEGATIVE');
  if(input.rangeState==='OUT_OF_RANGE')reasons.push('RANGE_OUT_OF_RANGE');
  if(input.rangeState==='UNKNOWN')reasons.push('RANGE_EVIDENCE_UNAVAILABLE');
  if(input.inventoryClassification==='OOR_TOKEN_EXPOSURE')reasons.push('INVENTORY_STRESS');
  if(input.continuationEvLamports!==undefined&&input.continuationEvLamports<=0n)reasons.push('CONTINUATION_EV_NON_POSITIVE');
  if(['DISTRIBUTION','TREND_DOWN','FREEFALL'].includes(input.regime??''))reasons.push('REGIME_DETERIORATING');
  if(input.feeCompensationClassification==='NOT_FEE_COMPENSATED')reasons.push('FEE_INVENTORY_IMBALANCE');
  return{status:'COMPLETED',due:true,decision:reasons.length?'CONTINUATION_DEGRADED':'CONTINUATION_APPROVED',reasonCodes:[...new Set(reasons)].sort(),startedAt,completedAt:input.observedAt};
}

/** Invalid durable PCA data is ignored rather than allowed to manufacture a
 * completed assessment.  This can only lead to a fresh observe-only record. */
export function parsePositionContinuationPriorState(value:unknown):PositionContinuationPriorState|undefined{
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  const row=value as Record<string,unknown>;
  const status=row.status==='PENDING'||row.status==='COMPLETED'?row.status:undefined;
  const checkpoint=row.checkpoint==='FIRST_FORECAST_HORIZON'?row.checkpoint:undefined;
  const startedAt=typeof row.startedAt==='string'&&Number.isFinite(Date.parse(row.startedAt))?row.startedAt:undefined;
  const completedAt=typeof row.completedAt==='string'&&Number.isFinite(Date.parse(row.completedAt))?row.completedAt:undefined;
  const decision=row.decision==='CONTINUATION_APPROVED'||row.decision==='CONTINUATION_DEGRADED'?row.decision:undefined;
  const reasonCodes=Array.isArray(row.reasonCodes)?row.reasonCodes.filter((code):code is string=>typeof code==='string'&&code.length>0&&code.length<=160).slice(0,32):undefined;
  if(row.schemaVersion!==1||!status||!checkpoint||!startedAt||(status==='COMPLETED'&&(!completedAt||!decision)))return undefined;
  return{schemaVersion:1,status,checkpoint,startedAt,...(completedAt?{completedAt}:{}),...(decision?{decision}:{}),...(reasonCodes?{reasonCodes}:{} )};
}
