// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
export interface Phase7RuntimeLease {runtimeId:string;holderId:string;acquiredAt:string;expiresAt:string;generation:number;}
export interface Phase7LeaseDecision {decision:'ACQUIRED'|'RENEWED'|'BLOCK';lease?:Phase7RuntimeLease;reasonCodes:string[];}
export interface Phase7DaemonTickEvidence {now:string;instanceId:string;cycleKey:string;previousCompletedCycleKeys:string[];economicActionKey?:string;completedEconomicActionKeys:string[];restarted:boolean;recoveryScanCompleted:boolean;recoveryQueueCount:number;unknownSubmissionCount:number;unresolvedReconciliationDebt:number;healthStatus:'HEALTHY'|'DEGRADED'|'CRITICAL';authorityMode:'OBSERVE_ONLY'|'LIMITED_LIVE'|'PRODUCTION';}
export interface Phase7DaemonTickPlan {plan:'RECOVER_ONLY'|'OBSERVE_ONLY'|'DECISION_CYCLE'|'HOLD';reasonCodes:string[];newEconomicActionAllowed:boolean;requiresExistingExecutionWorkflow:true;}
export function acquirePhase7RuntimeLease(input:{runtimeId:string;instanceId:string;now:string;ttlMs:number;current?:Phase7RuntimeLease}):Phase7LeaseDecision{
  if(!input.runtimeId.trim()||!input.instanceId.trim()||input.ttlMs<1000||input.ttlMs>300000)throw new Error('LPFORGE_P7_DAEMON_LEASE_FIELDS');const now=Date.parse(input.now);if(!Number.isFinite(now))throw new Error('LPFORGE_P7_DAEMON_TIME');
  const cur=input.current;if(cur&&Date.parse(cur.expiresAt)>now&&cur.holderId!==input.instanceId)return{decision:'BLOCK',reasonCodes:['P7_DAEMON_LEASE_HELD_BY_OTHER']};
  const generation=cur?.generation??0;const renewing=Boolean(cur&&cur.holderId===input.instanceId&&Date.parse(cur.expiresAt)>now);const lease={runtimeId:input.runtimeId,holderId:input.instanceId,acquiredAt:input.now,expiresAt:new Date(now+input.ttlMs).toISOString(),generation:renewing?generation:generation+1};return{decision:renewing?'RENEWED':'ACQUIRED',lease,reasonCodes:[renewing?'P7_DAEMON_LEASE_RENEWED':'P7_DAEMON_LEASE_ACQUIRED']};
}
export function planPhase7DaemonTick(e:Phase7DaemonTickEvidence):Phase7DaemonTickPlan{
  if(!e.cycleKey.trim()||!e.instanceId.trim()||!Number.isFinite(Date.parse(e.now)))throw new Error('LPFORGE_P7_DAEMON_TICK_FIELDS');
  if(e.previousCompletedCycleKeys.includes(e.cycleKey))return{plan:'HOLD',reasonCodes:['P7_DAEMON_DUPLICATE_CYCLE_KEY'],newEconomicActionAllowed:false,requiresExistingExecutionWorkflow:true};
  if(e.economicActionKey&&e.completedEconomicActionKeys.includes(e.economicActionKey))return{plan:'HOLD',reasonCodes:['P7_DAEMON_DUPLICATE_ECONOMIC_ACTION_KEY'],newEconomicActionAllowed:false,requiresExistingExecutionWorkflow:true};
  if(e.restarted&&!e.recoveryScanCompleted)return{plan:'RECOVER_ONLY',reasonCodes:['P7_DAEMON_RESTART_RECOVERY_REQUIRED'],newEconomicActionAllowed:false,requiresExistingExecutionWorkflow:true};
  if(e.recoveryQueueCount>0||e.unknownSubmissionCount>0||e.unresolvedReconciliationDebt>0)return{plan:'RECOVER_ONLY',reasonCodes:[...(e.recoveryQueueCount>0?['P7_DAEMON_RECOVERY_QUEUE_PENDING']:[]),...(e.unknownSubmissionCount>0?['P7_DAEMON_UNKNOWN_SUBMISSION_PENDING']:[]),...(e.unresolvedReconciliationDebt>0?['P7_DAEMON_RECONCILIATION_DEBT']:[])].sort(),newEconomicActionAllowed:false,requiresExistingExecutionWorkflow:true};
  if(e.healthStatus==='CRITICAL'||e.authorityMode==='OBSERVE_ONLY')return{plan:'OBSERVE_ONLY',reasonCodes:[e.healthStatus==='CRITICAL'?'P7_DAEMON_CRITICAL_HEALTH':'P7_DAEMON_OBSERVE_AUTHORITY'],newEconomicActionAllowed:false,requiresExistingExecutionWorkflow:true};
  if(e.healthStatus==='DEGRADED')return{plan:'OBSERVE_ONLY',reasonCodes:['P7_DAEMON_DEGRADED_HEALTH'],newEconomicActionAllowed:false,requiresExistingExecutionWorkflow:true};
  return{plan:'DECISION_CYCLE',reasonCodes:['P7_DAEMON_DECISION_CYCLE_READY'],newEconomicActionAllowed:true,requiresExistingExecutionWorkflow:true};
}
