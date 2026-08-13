// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
import {createHash} from 'node:crypto';
import {assertManualApproval,type Phase7ControlAction,type Phase7ManualApproval} from '../../phase7-contracts/src/index.js';
import type {Phase7HealthAssessment} from '../../phase7-health/src/index.js';
import type {Phase7SafetyState} from '../../phase7-incidents/src/index.js';

export interface Phase7OperatorControlRequest {actionId:string;action:Phase7ControlAction;operatorId:string;requestedAt:string;reason:string;targetPool?:string;targetToken?:string;}
export interface Phase7OperatorAuditRecord {actionId:string;operatorId:string;action:Phase7ControlAction;requestedAt:string;approvalId:string;reason:string;targetType?:'POOL'|'TOKEN';targetId?:string;beforeHash:string;afterHash:string;result:'APPLIED'|'WORKFLOW_REQUESTED';workflowRequest?:'EXISTING_EXECUTION_CLOSE'|'POLICY_ROLLBACK_WORKFLOW'|'RECONCILIATION_ACK_WORKFLOW';payload:Record<string,unknown>;}
export interface Phase7OperatorControlResult {safetyState:Phase7SafetyState;audit:Phase7OperatorAuditRecord;}
function stable(value:unknown):string{if(Array.isArray(value))return`[${value.map(stable).join(',')}]`;if(value&&typeof value==='object')return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;return JSON.stringify(value);}
function hash(value:unknown):string{return createHash('sha256').update(stable(value)).digest('hex');}
function unique(xs:string[]):string[]{return[...new Set(xs)].sort();}
export function applyPhase7OperatorControl(input:{request:Phase7OperatorControlRequest;approval:Phase7ManualApproval;now:string;health:Phase7HealthAssessment;safetyState:Phase7SafetyState;unresolvedIncidentIds:string[]}):Phase7OperatorControlResult{
  const {request,approval,now}=input;if(!request.actionId.trim()||!request.operatorId.trim()||!request.reason.trim())throw new Error('LPFORGE_P7_OPERATOR_CONTROL_FIELDS');
  if(request.operatorId!==approval.operatorId)throw new Error('LPFORGE_P7_OPERATOR_APPROVAL_OPERATOR_MISMATCH');
  if(request.action!==approval.action)throw new Error('LPFORGE_P7_OPERATOR_APPROVAL_ACTION_MISMATCH');
  assertManualApproval(approval,now);
  if(Date.parse(request.requestedAt)>Date.parse(now))throw new Error('LPFORGE_P7_OPERATOR_REQUEST_FROM_FUTURE');
  let next:Phase7SafetyState={...input.safetyState,blockedPools:[...input.safetyState.blockedPools],blockedTokens:[...input.safetyState.blockedTokens],activeCriticalIncidentIds:[...input.safetyState.activeCriticalIncidentIds],reasonCodes:[...input.safetyState.reasonCodes]};
  let result:Phase7OperatorAuditRecord['result']='APPLIED';let workflowRequest:Phase7OperatorAuditRecord['workflowRequest'];let targetType:Phase7OperatorAuditRecord['targetType'];let targetId:string|undefined;
  if(request.action==='PAUSE_ENTRIES'){next={...next,mode:next.nonEmergencyWritesPaused?'EMERGENCY_ONLY':'ENTRIES_PAUSED',entriesPaused:true,reasonCodes:unique([...next.reasonCodes,'P7_MANUAL_ENTRIES_PAUSED'])};}
  else if(request.action==='PAUSE_ALL_WRITES'){next={...next,mode:'EMERGENCY_ONLY',entriesPaused:true,nonEmergencyWritesPaused:true,reasonCodes:unique([...next.reasonCodes,'P7_MANUAL_WRITES_PAUSED'])};}
  else if(request.action==='BLOCK_POOL'){if(!request.targetPool)throw new Error('LPFORGE_P7_OPERATOR_POOL_TARGET_REQUIRED');targetType='POOL';targetId=request.targetPool;next={...next,blockedPools:unique([...next.blockedPools,request.targetPool])};}
  else if(request.action==='BLOCK_TOKEN'){if(!request.targetToken)throw new Error('LPFORGE_P7_OPERATOR_TOKEN_TARGET_REQUIRED');targetType='TOKEN';targetId=request.targetToken;next={...next,blockedTokens:unique([...next.blockedTokens,request.targetToken])};}
  else if(request.action==='REQUEST_CLOSE'){if(!request.targetPool)throw new Error('LPFORGE_P7_OPERATOR_POOL_TARGET_REQUIRED');targetType='POOL';targetId=request.targetPool;result='WORKFLOW_REQUESTED';workflowRequest='EXISTING_EXECUTION_CLOSE';}
  else if(request.action==='ROLLBACK_POLICY'){result='WORKFLOW_REQUESTED';workflowRequest='POLICY_ROLLBACK_WORKFLOW';}
  else if(request.action==='ACK_RECONCILIATION'){result='WORKFLOW_REQUESTED';workflowRequest='RECONCILIATION_ACK_WORKFLOW';}
  else if(request.action==='RESUME_ENTRIES'||request.action==='RESUME_WRITES'){
    if(input.health.status!=='HEALTHY')throw new Error('LPFORGE_P7_OPERATOR_RESUME_HEALTH_NOT_HEALTHY');
    if(input.unresolvedIncidentIds.length||input.safetyState.activeCriticalIncidentIds.length)throw new Error('LPFORGE_P7_OPERATOR_RESUME_INCIDENTS_UNRESOLVED');
    next={...next,mode:'NORMAL',entriesPaused:false,nonEmergencyWritesPaused:false,reasonCodes:next.reasonCodes.filter(r=>!r.startsWith('P7_MANUAL_'))};
  }
  const beforeHash=hash(input.safetyState),afterHash=hash(next);
  return{safetyState:next,audit:{actionId:request.actionId,operatorId:request.operatorId,action:request.action,requestedAt:request.requestedAt,approvalId:approval.approvalId,reason:request.reason,...(targetType?{targetType}:{}),...(targetId?{targetId}:{}),beforeHash,afterHash,result,...(workflowRequest?{workflowRequest}:{}),payload:{healthStatus:input.health.status,unresolvedIncidentIds:[...input.unresolvedIncidentIds].sort()}}};
}
