// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
export type Phase7GateStatus='PASS'|'HOLD'|'BLOCK';
export type Phase7OperationalMode='OBSERVE_ONLY'|'LIMITED_LIVE'|'PRODUCTION';
export type Phase7ScalingMode='DISABLED'|'OPERATOR_STEP'|'POLICY_BOUNDED';
/**
 * TEMPORARY authorities always carry an expiring operator approval.  The
 * bounded unattended variant is deliberately separate: it is allowed only for
 * the already bounded Production path and remains subject to every runtime
 * safety, portfolio, freshness, simulation, and reconciliation gate.
 */
export type Phase7AuthorityKind='TEMPORARY'|'BOUNDED_UNATTENDED_PRODUCTION';
export type Phase7ControlAction=
  |'PAUSE_ENTRIES'
  |'PAUSE_ALL_WRITES'
  |'BLOCK_POOL'
  |'BLOCK_TOKEN'
  |'REQUEST_CLOSE'
  |'ACK_RECONCILIATION'
  |'ROLLBACK_POLICY'
  |'RESUME_ENTRIES'
  |'RESUME_WRITES';

export interface Phase7Authority {
  phase:'P7';
  cluster:'mainnet-beta';
  mode:Phase7OperationalMode;
  authorityKind:Phase7AuthorityKind;
  issuedAt:string;
  expiresAt:string|null;
  approvalId:string|null;
  productionAuthorityIssued:boolean;
  scalingMode:Phase7ScalingMode;
  automaticPolicyPromotion:false;
  reasonCodes:string[];
}

export interface Phase7EvidenceRef {
  kind:string;
  id:string;
  observedAt:string;
  status:Phase7GateStatus;
  hash?:string;
}

export interface Phase7StageDecision {
  stage:`P7-${string}`;
  status:Phase7GateStatus;
  reasonCodes:string[];
  evidence:Phase7EvidenceRef[];
}

export interface Phase7ManualApproval {
  approvalId:string;
  action:Phase7ControlAction|'PROMOTE_LIMITED_LIVE'|'PROMOTE_PRODUCTION'|'SCALE_STEP';
  operatorId:string;
  issuedAt:string;
  expiresAt:string;
  reason:string;
}

export function assertPhase7Authority(authority:Phase7Authority,now:string):void {
  if(authority.phase!=='P7'||authority.cluster!=='mainnet-beta') throw new Error('LPFORGE_P7_AUTHORITY_CLUSTER');
  const boundedUnattended=authority.authorityKind==='BOUNDED_UNATTENDED_PRODUCTION';
  if(boundedUnattended){
    if(authority.mode!=='PRODUCTION'||!authority.productionAuthorityIssued)throw new Error('LPFORGE_P7_UNATTENDED_PRODUCTION_AUTHORITY_REQUIRED');
    if(authority.expiresAt!==null)throw new Error('LPFORGE_P7_UNATTENDED_AUTHORITY_MUST_NOT_EXPIRE');
    if(authority.approvalId!==null)throw new Error('LPFORGE_P7_UNATTENDED_AUTHORITY_MUST_NOT_BIND_TEMPORARY_APPROVAL');
    if(authority.scalingMode!=='DISABLED')throw new Error('LPFORGE_P7_UNATTENDED_SCALING_FORBIDDEN');
  }else{
    if(typeof authority.expiresAt!=='string'||Date.parse(authority.expiresAt)<=Date.parse(now)) throw new Error('LPFORGE_P7_AUTHORITY_EXPIRED');
  }
  if(authority.automaticPolicyPromotion!==false) throw new Error('LPFORGE_P7_AUTOMATIC_POLICY_PROMOTION_FORBIDDEN');
  if(authority.mode==='OBSERVE_ONLY'){
    if(authority.productionAuthorityIssued) throw new Error('LPFORGE_P7_OBSERVE_PRODUCTION_AUTHORITY_FORBIDDEN');
    if(authority.scalingMode!=='DISABLED') throw new Error('LPFORGE_P7_OBSERVE_SCALING_FORBIDDEN');
  }
  if(authority.mode==='LIMITED_LIVE'){
    if(!authority.approvalId) throw new Error('LPFORGE_P7_LIMITED_LIVE_APPROVAL_REQUIRED');
    if(authority.productionAuthorityIssued) throw new Error('LPFORGE_P7_LIMITED_LIVE_IS_NOT_PRODUCTION');
    if(authority.scalingMode==='POLICY_BOUNDED') throw new Error('LPFORGE_P7_LIMITED_LIVE_POLICY_SCALING_FORBIDDEN');
  }
  if(authority.mode==='PRODUCTION'){
    if(!boundedUnattended&&!authority.approvalId) throw new Error('LPFORGE_P7_PRODUCTION_APPROVAL_REQUIRED');
    if(!authority.productionAuthorityIssued) throw new Error('LPFORGE_P7_PRODUCTION_AUTHORITY_REQUIRED');
  }
}

export function issuePhase7ObserveAuthority(input:{now:string;ttlMs:number;reasonCodes?:string[]}):Phase7Authority {
  if(!Number.isFinite(input.ttlMs)||input.ttlMs<1_000||input.ttlMs>300_000) throw new Error('LPFORGE_P7_AUTHORITY_TTL');
  return {
    phase:'P7',
    cluster:'mainnet-beta',
    mode:'OBSERVE_ONLY',
    authorityKind:'TEMPORARY',
    issuedAt:input.now,
    expiresAt:new Date(Date.parse(input.now)+input.ttlMs).toISOString(),
    approvalId:null,
    productionAuthorityIssued:false,
    scalingMode:'DISABLED',
    automaticPolicyPromotion:false,
    reasonCodes:input.reasonCodes??['P7_OBSERVE_ONLY']
  };
}

export function assertManualApproval(approval:Phase7ManualApproval,now:string):void {
  if(!approval.approvalId.trim()||!approval.operatorId.trim()||!approval.reason.trim()) throw new Error('LPFORGE_P7_APPROVAL_FIELDS_REQUIRED');
  if(Date.parse(approval.expiresAt)<=Date.parse(now)) throw new Error('LPFORGE_P7_APPROVAL_EXPIRED');
  if(Date.parse(approval.issuedAt)>Date.parse(now)) throw new Error('LPFORGE_P7_APPROVAL_FROM_FUTURE');
}
