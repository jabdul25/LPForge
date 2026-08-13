// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
import {assertManualApproval,type Phase7ManualApproval} from '../../phase7-contracts/src/index.js';
import type {Phase7RegisteredPolicy} from '../../phase7-policy-registry/src/index.js';
export interface Phase7RollbackDecision {decision:'ROLLBACK_READY'|'BLOCK';fromPolicyHash:string;toPolicyHash:string;reasonCodes:string[];effectiveAt?:string;approvalId?:string;executionSideEffect:false;resumeWrites:false;}
export function evaluatePhase7Rollback(input:{current:Phase7RegisteredPolicy;target:Phase7RegisteredPolicy;approvedRollbackTargets:string[];approval:Phase7ManualApproval;now:string}):Phase7RollbackDecision{
  const reasons:string[]=[];assertManualApproval(input.approval,input.now);
  if(input.approval.action!=='ROLLBACK_POLICY')reasons.push('P7_ROLLBACK_APPROVAL_ACTION');
  if(input.current.policyHash===input.target.policyHash)reasons.push('P7_ROLLBACK_TARGET_IS_CURRENT');
  if(!input.approvedRollbackTargets.includes(input.target.policyHash))reasons.push('P7_ROLLBACK_TARGET_NOT_APPROVED');
  if(input.target.status==='CANDIDATE')reasons.push('P7_ROLLBACK_TARGET_UNPROMOTED');
  if(Date.parse(input.target.createdAt)>Date.parse(input.current.createdAt))reasons.push('P7_ROLLBACK_TARGET_NEWER_THAN_CURRENT');
  if(reasons.length)return{decision:'BLOCK',fromPolicyHash:input.current.policyHash,toPolicyHash:input.target.policyHash,reasonCodes:[...new Set(reasons)].sort(),executionSideEffect:false,resumeWrites:false};
  return{decision:'ROLLBACK_READY',fromPolicyHash:input.current.policyHash,toPolicyHash:input.target.policyHash,reasonCodes:['P7_ROLLBACK_APPROVED'],effectiveAt:input.now,approvalId:input.approval.approvalId,executionSideEffect:false,resumeWrites:false};
}
