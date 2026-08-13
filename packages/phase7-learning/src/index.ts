// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
import type {Phase7DriftAssessment} from '../../phase7-drift/src/index.js';
export type Phase7LearningScope='FEATURE'|'REGIME'|'OPPORTUNITY'|'RANGE'|'RISK'|'EXECUTION_COST'|'POOL_POLICY';
export interface Phase7LearningProposal {proposalId:string;sourcePolicyHash:string;hypothesis:string;scope:Phase7LearningScope;trigger:'DRIFT'|'SCHEDULED_RESEARCH'|'MANUAL_HYPOTHESIS';proposedChanges:Record<string,unknown>;evidenceHashes:string[];createdAt:string;status:'RESEARCH_PROPOSAL';targetPolicyStatus:'CANDIDATE';automaticPolicyPromotion:false;directProductionMutation:false;}
export interface Phase7LearningGateEvidence {sampleCount:number;minimumSampleCount:number;chronologicalSplit:boolean;noLookahead:boolean;reproducibleRunHash?:string;controlPolicyHash:string;}
export interface Phase7LearningDecision {decision:'EXPERIMENT_ELIGIBLE'|'HOLD'|'BLOCK';reasonCodes:string[];proposal:Phase7LearningProposal;productionPolicyChanged:false;automaticPolicyPromotion:false;}
export function createPhase7LearningProposal(input:Omit<Phase7LearningProposal,'status'|'targetPolicyStatus'|'automaticPolicyPromotion'|'directProductionMutation'>):Phase7LearningProposal{
  if(!input.proposalId.trim()||!input.sourcePolicyHash.trim()||!input.hypothesis.trim()||!input.evidenceHashes.length||Object.keys(input.proposedChanges).length===0||!Number.isFinite(Date.parse(input.createdAt)))throw new Error('LPFORGE_P7_LEARNING_PROPOSAL_FIELDS');
  return{...input,evidenceHashes:[...new Set(input.evidenceHashes)].sort(),status:'RESEARCH_PROPOSAL',targetPolicyStatus:'CANDIDATE',automaticPolicyPromotion:false,directProductionMutation:false};
}
export function evaluatePhase7LearningProposal(input:{proposal:Phase7LearningProposal;drift:Phase7DriftAssessment;evidence:Phase7LearningGateEvidence}):Phase7LearningDecision{
  const r:string[]=[];const e=input.evidence;
  if(e.sampleCount<e.minimumSampleCount)r.push('P7_LEARNING_SAMPLE_INSUFFICIENT');
  if(!e.chronologicalSplit)r.push('P7_LEARNING_CHRONOLOGICAL_SPLIT_REQUIRED');
  if(!e.noLookahead)r.push('P7_LEARNING_LOOKAHEAD_VIOLATION');
  if(!e.reproducibleRunHash?.trim())r.push('P7_LEARNING_REPRODUCIBLE_RUN_REQUIRED');
  if(e.controlPolicyHash!==input.proposal.sourcePolicyHash)r.push('P7_LEARNING_CONTROL_POLICY_MISMATCH');
  if(input.proposal.trigger==='DRIFT'&&input.drift.status==='STABLE')r.push('P7_LEARNING_DRIFT_TRIGGER_NOT_PRESENT');
  const hard=new Set(['P7_LEARNING_CHRONOLOGICAL_SPLIT_REQUIRED','P7_LEARNING_LOOKAHEAD_VIOLATION','P7_LEARNING_CONTROL_POLICY_MISMATCH']);
  const decision=r.some(x=>hard.has(x))?'BLOCK':r.length?'HOLD':'EXPERIMENT_ELIGIBLE';
  return{decision,reasonCodes:[...new Set(r)].sort(),proposal:input.proposal,productionPolicyChanged:false,automaticPolicyPromotion:false};
}
