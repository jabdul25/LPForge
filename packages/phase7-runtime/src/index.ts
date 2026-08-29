// LPFORGE_PHASE7_RUNTIME_INTEGRATION_MODULE
import {loadPhase7ControlConfig,resolvePhase7Authority,type Phase7ControlConfig} from '../../phase7-authority/src/index.js';
import type {Phase7ManualApproval} from '../../phase7-contracts/src/index.js';
import {acquirePhase7RuntimeLease,planPhase7DaemonTick,type Phase7RuntimeLease} from '../../phase7-daemon/src/index.js';
import {assessPhase7Drift,type Phase7DriftPolicy,type Phase7EvaluationMetrics} from '../../phase7-drift/src/index.js';
import {assessPhase7Health,type Phase7HealthObservation,type Phase7HealthPolicy} from '../../phase7-health/src/index.js';
import {derivePhase7SafetyState,type Phase7Incident} from '../../phase7-incidents/src/index.js';

export interface Phase7RuntimeTickInput {
  now:string;
  runtimeId:string;
  instanceId:string;
  cycleKey:string;
  leaseTtlMs:number;
  currentLease?:Phase7RuntimeLease;
  previousCompletedCycleKeys:string[];
  economicActionKey?:string;
  completedEconomicActionKeys:string[];
  restarted:boolean;
  recoveryScanCompleted:boolean;
  recoveryQueueCount:number;
  unknownSubmissionCount:number;
  unresolvedReconciliationDebt:number;
  healthObservations:Phase7HealthObservation[];
  healthPolicy:Phase7HealthPolicy;
  driftBaseline:Phase7EvaluationMetrics;
  driftCurrent:Phase7EvaluationMetrics;
  driftPolicy:Phase7DriftPolicy;
  incidents:Phase7Incident[];
  controlConfig?:Phase7ControlConfig;
  approval?:Phase7ManualApproval;
}

export interface Phase7RuntimeTickResult {
  observedAt:string;
  runtimeId:string;
  instanceId:string;
  cycleKey:string;
  lease:ReturnType<typeof acquirePhase7RuntimeLease>;
  authority:ReturnType<typeof resolvePhase7Authority>;
  health:ReturnType<typeof assessPhase7Health>;
  drift:ReturnType<typeof assessPhase7Drift>;
  safety:ReturnType<typeof derivePhase7SafetyState>;
  daemonPlan:ReturnType<typeof planPhase7DaemonTick>;
  decisionCycleAllowed:boolean;
  newEconomicActionAllowed:boolean;
  existingExecutionWorkflowRequired:true;
  directSigner:false;
  directTransactionSend:false;
  automaticPolicyPromotion:false;
  reasonCodes:string[];
}

export function composePhase7RuntimeTick(input:Phase7RuntimeTickInput):Phase7RuntimeTickResult {
  if(!input.runtimeId.trim()||!input.instanceId.trim()||!input.cycleKey.trim())throw new Error('LPFORGE_P7_RUNTIME_FIELDS');
  const nowMs=Date.parse(input.now);if(!Number.isFinite(nowMs))throw new Error('LPFORGE_P7_RUNTIME_TIME');
  const config=input.controlConfig??loadPhase7ControlConfig({});
  const authority=resolvePhase7Authority({config,now:input.now,...(input.approval?{approval:input.approval}:{})});
  const lease=acquirePhase7RuntimeLease({runtimeId:input.runtimeId,instanceId:input.instanceId,now:input.now,ttlMs:input.leaseTtlMs,...(input.currentLease?{current:input.currentLease}:{})});
  const health=assessPhase7Health(input.healthObservations,input.healthPolicy,input.now);
  const drift=assessPhase7Drift({baseline:input.driftBaseline,current:input.driftCurrent,policy:input.driftPolicy,observedAt:input.now});
  const safety=derivePhase7SafetyState({health,incidents:input.incidents});
  const effectiveHealth=safety.mode==='EMERGENCY_ONLY'?'CRITICAL':health.status;
  const daemonPlan=lease.decision==='BLOCK'
    ? {plan:'HOLD' as const,reasonCodes:['P7_RUNTIME_LEASE_BLOCKED',...lease.reasonCodes].sort(),newEconomicActionAllowed:false,requiresExistingExecutionWorkflow:true as const}
    : planPhase7DaemonTick({
        now:input.now,instanceId:input.instanceId,cycleKey:input.cycleKey,
        previousCompletedCycleKeys:input.previousCompletedCycleKeys,
        ...(input.economicActionKey?{economicActionKey:input.economicActionKey}:{}),
        completedEconomicActionKeys:input.completedEconomicActionKeys,restarted:input.restarted,
        recoveryScanCompleted:input.recoveryScanCompleted,recoveryQueueCount:input.recoveryQueueCount,
        unknownSubmissionCount:input.unknownSubmissionCount,unresolvedReconciliationDebt:input.unresolvedReconciliationDebt,
        healthStatus:effectiveHealth,authorityMode:authority.mode
      });
  const driftAllows=drift.newEntriesAllowed;
  const safetyAllows=!safety.entriesPaused;
  const decisionCycleAllowed=daemonPlan.plan==='DECISION_CYCLE'&&driftAllows&&safetyAllows;
  const newEconomicActionAllowed=decisionCycleAllowed&&daemonPlan.newEconomicActionAllowed&&health.newEntriesAllowed;
  const reasonCodes=[...new Set([
    ...lease.reasonCodes,...authority.reasonCodes,...health.reasonCodes,...drift.reasonCodes,...safety.reasonCodes,...daemonPlan.reasonCodes,
    ...(!driftAllows?['P7_RUNTIME_DRIFT_BLOCKS_ENTRY']:[]),...(!safetyAllows?['P7_RUNTIME_SAFETY_BLOCKS_ENTRY']:[])
  ])].sort();
  return {observedAt:input.now,runtimeId:input.runtimeId,instanceId:input.instanceId,cycleKey:input.cycleKey,lease,authority,health,drift,safety,daemonPlan,decisionCycleAllowed,newEconomicActionAllowed,existingExecutionWorkflowRequired:true,directSigner:false,directTransactionSend:false,automaticPolicyPromotion:false,reasonCodes};
}
