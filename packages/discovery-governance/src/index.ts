export type ProposalState='OBSERVE'|'RESEARCH'|'PROPOSED'|'BACKTESTED'|'OOS_VALIDATED'|'SHADOW'|'BASELINE_COMPARED'|'APPROVED'|'REJECTED';
export interface DiscoveryPolicyProposal {proposalId:string;createdAt:string;state:ProposalState;hypothesis:string;targetPolicy:string;changes:Record<string,unknown>;evidence:Record<string,unknown>;automaticPromotion:false;}
export function createPolicyProposal(input:Omit<DiscoveryPolicyProposal,'automaticPromotion'|'state'>):DiscoveryPolicyProposal{return{...input,state:'PROPOSED',automaticPromotion:false}}
const order:ProposalState[]=['OBSERVE','RESEARCH','PROPOSED','BACKTESTED','OOS_VALIDATED','SHADOW','BASELINE_COMPARED','APPROVED'];
export function advanceProposal(p:DiscoveryPolicyProposal,next:ProposalState,proof:Record<string,unknown>):DiscoveryPolicyProposal{
 if(next==='REJECTED')return{...p,state:'REJECTED',evidence:{...p.evidence,rejection:proof},automaticPromotion:false};
 const i=order.indexOf(p.state),j=order.indexOf(next);if(j!==i+1)throw new Error('LPFORGE_DISCOVERY_GOVERNANCE_INVALID_TRANSITION');
 return{...p,state:next,evidence:{...p.evidence,[next]:proof},automaticPromotion:false};
}
export function assertNoAutomaticPolicyMutation(_:DiscoveryPolicyProposal){return{policyMutationAllowed:false,automaticPromotion:false,reasonCodes:['DISCOVERY_LEARNING_ADVISORY_ONLY','VERSIONED_HUMAN_OR_OPERATOR_POLICY_PROMOTION_REQUIRED']} as const}
