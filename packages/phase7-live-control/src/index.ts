// LPFORGE_PHASE7_RUNTIME_INTEGRATION_MODULE
import type {Phase7Authority} from '../../phase7-contracts/src/index.js';
import type {Phase7DriftAssessment} from '../../phase7-drift/src/index.js';
import type {Phase7HealthAssessment} from '../../phase7-health/src/index.js';
import {derivePhase7SafetyState,openPhase7Incident,type Phase7Incident} from '../../phase7-incidents/src/index.js';
export interface Phase7ReleaseIdentityAssessment {valid:boolean;reasonCodes:string[];}
export interface Phase7LiveControlDecision {authorityMode:Phase7Authority['mode'];healthStatus:Phase7HealthAssessment['status'];driftStatus:Phase7DriftAssessment['status'];safety:ReturnType<typeof derivePhase7SafetyState>;daemonPlan:'OBSERVE_ONLY'|'DECISION_CYCLE';newEconomicActionAllowed:boolean;reasonCodes:string[];directSigner:false;directTransactionSend:false;}
const autoId=(type:string,pool:string)=>`auto:${type}:${pool}`;
export function derivePhase7AutomaticIncidents(input:{poolAddress:string;observedAt:string;health:Phase7HealthAssessment;drift:Phase7DriftAssessment}):Phase7Incident[]{
  const out:Phase7Incident[]=[];const d=input.health.domainStatus;
  const add=(type:Parameters<typeof openPhase7Incident>[0]['type'],reasons:string[],severity?:'WARNING'|'CRITICAL')=>out.push(openPhase7Incident({incidentId:autoId(type,input.poolAddress),type,openedAt:input.observedAt,reasonCodes:reasons,pool:input.poolAddress,...(severity?{severity}:{})}));
  if(d.RPC==='CRITICAL')add('RPC_OUTAGE',['P7_AUTO_RPC_CRITICAL'],'WARNING');
  if(d.METEORA_API==='CRITICAL'||d.METEORA_API==='DEGRADED')add('METEORA_API_OUTAGE',['P7_AUTO_METEORA_API_UNHEALTHY'],'WARNING');
  if(d.DATABASE==='CRITICAL')add('DATABASE_FAILURE',['P7_AUTO_DATABASE_CRITICAL'],'CRITICAL');
  if(d.RECONCILIATION==='CRITICAL'||input.drift.reasonCodes.includes('P7_DRIFT_RECONCILIATION_MISMATCH'))add('RECONCILIATION_MISMATCH',['P7_AUTO_RECONCILIATION_CRITICAL'],'CRITICAL');
  if(d.EXECUTION==='CRITICAL')add('REPEATED_TX_FAILURE',['P7_AUTO_EXECUTION_CRITICAL'],'CRITICAL');
  if(input.drift.reasonCodes.some(x=>x==='P7_DRIFT_FEATURE_MISSINGNESS'||x==='P7_DRIFT_DECODER_SKIPS'||x==='P7_LIVE_DRIFT_DECODER_TELEMETRY_MISSING'))add('PROTOCOL_COMPATIBILITY',['P7_AUTO_DATA_INTEGRITY_DRIFT'],'CRITICAL');
  return out;
}
export function reconcilePhase7AutomaticIncidents(input:{existing:Phase7Incident[];current:Phase7Incident[];observedAt:string}):Phase7Incident[]{
  const current=new Map(input.current.map(i=>[i.incidentId,i]));const existing=new Map(input.existing.map(i=>[i.incidentId,i]));const out:Phase7Incident[]=[];
  for(const cur of input.current){const prev=existing.get(cur.incidentId);out.push(prev&&prev.status==='ACKNOWLEDGED'?{...cur,status:'ACKNOWLEDGED',...(prev.acknowledgedBy?{acknowledgedBy:prev.acknowledgedBy}:{})}:cur);}
  for(const prev of input.existing){if(current.has(prev.incidentId)||prev.status==='RESOLVED')continue;if(prev.incidentId.startsWith('auto:')&&prev.severity==='WARNING')out.push({...prev,status:'RESOLVED',resolvedAt:input.observedAt,reasonCodes:[...new Set([...prev.reasonCodes,'P7_AUTO_WARNING_CONDITION_CLEARED'])].sort()});else if(prev.severity==='CRITICAL')out.push({...prev,reasonCodes:[...new Set([...prev.reasonCodes,'P7_INCIDENT_MANUAL_RESOLUTION_REQUIRED'])].sort()});else out.push(prev);}
  return out.sort((a,b)=>a.incidentId.localeCompare(b.incidentId));
}
export function buildPhase7LiveControlDecision(input:{authority:Phase7Authority;health:Phase7HealthAssessment;drift:Phase7DriftAssessment;incidents:Phase7Incident[];releaseIdentity?:Phase7ReleaseIdentityAssessment}):Phase7LiveControlDecision{
  const safety=derivePhase7SafetyState({health:input.health,incidents:input.incidents});const baseAllowed=input.authority.mode!=='OBSERVE_ONLY'&&input.health.newEntriesAllowed&&input.drift.newEntriesAllowed&&!safety.entriesPaused;const release=input.releaseIdentity??{valid:false,reasonCodes:['P7_RELEASE_IDENTITY_MISSING']};const allowed=baseAllowed&&release.valid;const daemonPlan=allowed?'DECISION_CYCLE':'OBSERVE_ONLY';const reasons=[...new Set([...input.authority.reasonCodes,...input.health.reasonCodes,...input.drift.reasonCodes,...safety.reasonCodes,...(!input.drift.newEntriesAllowed?['P7_CONTROL_DRIFT_BLOCK']:[]),...(safety.entriesPaused?['P7_CONTROL_SAFETY_PAUSE']:[]),...(input.authority.mode==='OBSERVE_ONLY'?['P7_CONTROL_OBSERVE_AUTHORITY']:[]),...(baseAllowed&&!release.valid?release.reasonCodes:[])])].sort();return{authorityMode:input.authority.mode,healthStatus:input.health.status,driftStatus:input.drift.status,safety,daemonPlan,newEconomicActionAllowed:allowed,reasonCodes:reasons,directSigner:false,directTransactionSend:false};
}
