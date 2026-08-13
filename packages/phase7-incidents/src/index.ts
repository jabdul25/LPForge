// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
import type {Phase7HealthAssessment} from '../../phase7-health/src/index.js';
export type Phase7IncidentType='RPC_OUTAGE'|'METEORA_API_OUTAGE'|'DATABASE_FAILURE'|'RECONCILIATION_MISMATCH'|'SIGNER_ANOMALY'|'DAILY_LOSS_BREAKER'|'TOKEN_LIQUIDITY_EMERGENCY'|'PROTOCOL_COMPATIBILITY'|'REPEATED_TX_FAILURE'|'MANUAL_EMERGENCY';
export type Phase7IncidentSeverity='WARNING'|'CRITICAL';
export interface Phase7Incident {incidentId:string;type:Phase7IncidentType;severity:Phase7IncidentSeverity;openedAt:string;status:'OPEN'|'ACKNOWLEDGED'|'RESOLVED';reasonCodes:string[];pool?:string;token?:string;acknowledgedBy?:string;resolvedAt?:string;}
export interface Phase7SafetyState {mode:'NORMAL'|'ENTRIES_PAUSED'|'EMERGENCY_ONLY';entriesPaused:boolean;nonEmergencyWritesPaused:boolean;emergencyCloseAllowed:true;blockedPools:string[];blockedTokens:string[];activeCriticalIncidentIds:string[];reasonCodes:string[];}
const criticalTypes=new Set<Phase7IncidentType>(['DATABASE_FAILURE','RECONCILIATION_MISMATCH','SIGNER_ANOMALY','DAILY_LOSS_BREAKER','TOKEN_LIQUIDITY_EMERGENCY','PROTOCOL_COMPATIBILITY','REPEATED_TX_FAILURE','MANUAL_EMERGENCY']);
export function openPhase7Incident(input:{incidentId:string;type:Phase7IncidentType;openedAt:string;reasonCodes:string[];pool?:string;token?:string;severity?:Phase7IncidentSeverity}):Phase7Incident{
  if(!input.incidentId.trim()||!Number.isFinite(Date.parse(input.openedAt)))throw new Error('LPFORGE_P7_INCIDENT_FIELDS');
  return{incidentId:input.incidentId,type:input.type,severity:input.severity??(criticalTypes.has(input.type)?'CRITICAL':'WARNING'),openedAt:input.openedAt,status:'OPEN',reasonCodes:[...new Set(input.reasonCodes)].sort(),...(input.pool?{pool:input.pool}:{}),...(input.token?{token:input.token}:{})};
}
export function acknowledgePhase7Incident(incident:Phase7Incident,operatorId:string):Phase7Incident{if(!operatorId.trim())throw new Error('LPFORGE_P7_INCIDENT_ACK_OPERATOR');if(incident.status==='RESOLVED')throw new Error('LPFORGE_P7_INCIDENT_ALREADY_RESOLVED');return{...incident,status:'ACKNOWLEDGED',acknowledgedBy:operatorId};}
export function resolvePhase7Incident(incident:Phase7Incident,resolvedAt:string,evidenceConfirmed:boolean):Phase7Incident{if(!evidenceConfirmed)throw new Error('LPFORGE_P7_INCIDENT_RESOLUTION_EVIDENCE_REQUIRED');if(Date.parse(resolvedAt)<Date.parse(incident.openedAt))throw new Error('LPFORGE_P7_INCIDENT_RESOLUTION_TIME');return{...incident,status:'RESOLVED',resolvedAt};}
export function derivePhase7SafetyState(input:{health:Phase7HealthAssessment;incidents:Phase7Incident[]}):Phase7SafetyState{
  const active=input.incidents.filter(i=>i.status!=='RESOLVED');const critical=active.filter(i=>i.severity==='CRITICAL');const warnings=active.filter(i=>i.severity==='WARNING');
  const blockedPools=[...new Set(active.flatMap(i=>i.pool?[i.pool]:[]))].sort();const blockedTokens=[...new Set(active.flatMap(i=>i.token?[i.token]:[]))].sort();const reasons=[...new Set([...input.health.reasonCodes,...active.flatMap(i=>i.reasonCodes)])].sort();
  let mode:Phase7SafetyState['mode']='NORMAL';
  if(critical.length||input.health.status==='CRITICAL')mode='EMERGENCY_ONLY';
  else if(input.health.status==='DEGRADED'||warnings.length)mode='ENTRIES_PAUSED';
  return{mode,entriesPaused:mode!=='NORMAL',nonEmergencyWritesPaused:mode==='EMERGENCY_ONLY',emergencyCloseAllowed:true,blockedPools,blockedTokens,activeCriticalIncidentIds:critical.map(i=>i.incidentId).sort(),reasonCodes:reasons};
}
