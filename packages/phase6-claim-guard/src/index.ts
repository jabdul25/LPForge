import type { MainnetCanaryDeploymentPolicy } from "../../deployment-policy/src/index.js";
import type { AutonomousPlan } from "../../db/src/index.js";
import { verifyPlanProvenanceHmac } from "../../execution-contracts/src/index.js";

export interface ClaimGuardResult {
  approved: boolean;
  reasonCodes: string[];
  capitalLamports: bigint;
}
export interface ProductionAdmissionCandidate {poolAddress:string;state:string;tier:string;lastSeenAt:string;tokenYMint?:string|undefined;pairedTokenMint?:string|undefined;}
export interface VerifiedGlobalWinnerAdmission {globalCycleId:string;poolAddress:string;candidateId:string;selectionTier:string;selectionState:string;selectionDynamicEligible:boolean;verified:boolean;}
const WSOL_MINT='So11111111111111111111111111111111111111112';
export interface Phase7ExecutionControl {decisionId?:string;cycleKey?:string;authorityMode:string;healthStatus:string;driftStatus:string;safetyMode:string;newEconomicActionAllowed:boolean;observedAt:string;poolDrift?:Record<string,string>;activeIncidentIds?:string[];releaseIntegrityValid?:boolean;portfolioValid?:boolean;revokedApprovalIds?:string[];}
/** Canonical projection used by both claim-time and execution-time P7 checks. */
export function phase7ExecutionControlFromRow(controlRow:Record<string,unknown>|undefined):Phase7ExecutionControl|undefined{
 if(!controlRow)return undefined;
 const payload=record(controlRow.payload),rawPoolDrift=Array.isArray(payload.poolDrift)?payload.poolDrift:[],releaseIdentity=record(payload.releaseIdentity),portfolio=record(payload.portfolio),strings=(value:unknown)=>Array.isArray(value)?value.map(String).filter(Boolean):[];
 return{decisionId:String(controlRow.decision_id),cycleKey:String(controlRow.cycle_key),authorityMode:String(controlRow.authority_mode),healthStatus:String(controlRow.health_status),driftStatus:String(controlRow.drift_status),safetyMode:String(controlRow.safety_mode),newEconomicActionAllowed:Boolean(controlRow.new_economic_action_allowed),observedAt:new Date(String(controlRow.observed_at)).toISOString(),poolDrift:Object.fromEntries(rawPoolDrift.filter(row=>row&&typeof row==="object").map(row=>{const value=row as Record<string,unknown>;return[String(value.poolAddress??""),String(value.rawStatus??value.status??"")]}).filter(([pool])=>Boolean(pool))),activeIncidentIds:strings(payload.activeIncidentIds),releaseIntegrityValid:releaseIdentity.valid===true,portfolioValid:portfolio.valid===true,revokedApprovalIds:strings(payload.controlledCanaryRevokedApprovalIds)};
}
export function validateFreshPhase7ExecutionControl(control:Phase7ExecutionControl|undefined,now:string,maxAgeMs=60_000):string[]{
 if(!control)return ['P6_CLAIM_P7_CONTROL_MISSING'];
 const reasons:string[]=[];const age=Date.parse(now)-Date.parse(control.observedAt);
 if(control.authorityMode!=='PRODUCTION')reasons.push('P6_CLAIM_P7_AUTHORITY_NOT_PRODUCTION');if(control.healthStatus!=='HEALTHY')reasons.push('P6_CLAIM_P7_HEALTH_NOT_HEALTHY');if(control.driftStatus==='BLOCK')reasons.push('P6_CLAIM_P7_DRIFT_BLOCK');if(control.safetyMode!=='NORMAL')reasons.push('P6_CLAIM_P7_SAFETY_NOT_NORMAL');if(!control.newEconomicActionAllowed)reasons.push('P6_CLAIM_P7_NEW_ACTION_BLOCKED');
 if(!Number.isFinite(age)||age<0||age>maxAgeMs)reasons.push('P6_CLAIM_P7_CONTROL_STALE');
 return reasons.sort();
}
/**
 * A production OPEN is HMAC-bound to the P7 decision that governed plan
 * preparation. P7 deliberately emits a new control record every cycle, so
 * equality with the latest decision id would turn harmless healthy refreshes
 * into a race. The bound record must have been valid when the plan was made;
 * the current record must independently be fresh and entry-authorizing.
 */
function validateBoundProductionAuthority(input:{plan:AutonomousPlan;bound:Phase7ExecutionControl|undefined;current:Phase7ExecutionControl|undefined;now:string}):string[]{
 const provenance=record(record(input.plan.planPayload).provenance),binding=record(provenance.phase7Control),boundDecisionId=String(binding.decisionId??''),boundObservedAt=String(binding.observedAt??'');
 if(!boundDecisionId||!boundObservedAt)return ['P6_CLAIM_P7_CONTROL_BINDING_MISSING'];
 if(!input.current)return ['P6_CLAIM_P7_CONTROL_MISSING'];
 // The exact-current case remains valid without an additional database lookup;
 // after a refresh, execution must supply the persisted plan-bound control.
 const bound=input.bound??(input.current?.decisionId===boundDecisionId?input.current:undefined);
 if(!bound)return ['P6_CLAIM_P7_BOUND_CONTROL_MISSING'];
 const reasons:string[]=[];
 if(!input.current?.decisionId)reasons.push('P6_CLAIM_P7_CONTROL_ID_MISSING');
 if(bound.decisionId!==boundDecisionId)reasons.push('P6_CLAIM_P7_CONTROL_BINDING_MISMATCH');
 if(!validTimestamp(boundObservedAt)||!validTimestamp(input.plan.observedAt)||Date.parse(boundObservedAt)>Date.parse(input.plan.observedAt)||bound.observedAt!==boundObservedAt)reasons.push('P6_CLAIM_P7_CONTROL_BINDING_INVALID');
 // Validate the historical authority at the time it authorized this exact
 // plan, rather than against wall-clock claim time.
 reasons.push(...validateFreshPhase7ExecutionControl(bound,input.plan.observedAt));
 // Current control remains a fresh, fail-closed hard-safety gate.
 reasons.push(...validateFreshPhase7ExecutionControl(input.current,input.now));
 return [...new Set(reasons)].sort();
}
function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function immutablePlanMaterial(plan:AutonomousPlan):Record<string,unknown>{
 const intent=record(plan.planPayload.intent),planIntent=Object.fromEntries(Object.entries({capitalLamports:intent.capitalLamports,candidateId:intent.candidateId,lowerBinId:intent.lowerBinId,upperBinId:intent.upperBinId,activeBinId:intent.activeBinId,binStep:intent.binStep,strategy:intent.strategy,maxPositionWidthBins:intent.maxPositionWidthBins}).filter(([,value])=>value!==undefined));
 return{intentPayload:plan.intentPayload,planIntent,steps:plan.steps.map(step=>({transactionId:step.transactionId,sequence:step.sequence,kind:step.kind,requiredSignerAddresses:[...step.requiredSignerAddresses],metadata:step.metadata}))};
}
function capital(plan: AutonomousPlan) {
  try {
    return BigInt(
      String(
        (record(plan.planPayload).intent &&
          record(record(plan.planPayload).intent).capitalLamports) ??
          "0",
      ),
    );
  } catch {
    return -1n;
  }
}
function isRiskIncreasingAction(action: string) {
  return ["OPEN", "ADD", "RESHAPE", "REBALANCE"].includes(action);
}
function verifiedGlobalWinnerAdmission(input:{plan:AutonomousPlan;admission:VerifiedGlobalWinnerAdmission|undefined}){
 const provenance=record(record(input.plan.planPayload).provenance),selection=record(provenance.globalSelection),intent=record(input.plan.planPayload.intent),admission=input.admission;
 return Boolean(admission?.verified&&admission.selectionTier==='A'&&admission.selectionDynamicEligible===true&&equals(selection.globalCycleId,admission.globalCycleId)&&equals(selection.selectedCandidateId,admission.candidateId)&&equals(intent.candidateId,admission.candidateId)&&equals(input.plan.poolAddress,admission.poolAddress));
}
function currentHardDiscoveryDisqualification(candidate:ProductionAdmissionCandidate|undefined){return Boolean(candidate&&(['REJECTED','QUARANTINED','OBSERVING'].includes(candidate.state)||['REJECTED','QUARANTINED'].includes(candidate.tier)));}
function policyPoolForPlan(input:{plan:AutonomousPlan;policy:MainnetCanaryDeploymentPolicy;productionCandidates:ProductionAdmissionCandidate[];globalWinnerAdmission?:VerifiedGlobalWinnerAdmission;now:string;controlledCanary:boolean},reasons:string[]){
 // A static policy pool is a bounded canary/healthcheck identity, not a
 // general new-entry admission.  Ordinary risk-increasing plans, including
 // plans targeting a listed pool, must prove the same fresh dynamic admission
 // as every discovered pool.  The separately authenticated canary envelope
 // remains its explicit exception and is validated below.
 const staticPool=input.policy.pools.find(x=>x.address===input.plan.poolAddress);if(input.controlledCanary&&staticPool)return staticPool;
 const admission=input.policy.productionAdmission;
 if(!admission?.enabled){reasons.push('P6_CLAIM_PRODUCTION_ADMISSION_INVALID');return undefined;}
 const candidate=input.productionCandidates.find(x=>x.poolAddress===input.plan.poolAddress),age=candidate?Date.parse(input.now)-Date.parse(candidate.lastSeenAt):NaN,
   activeEconomicLease=candidate?.state==='ACTIVE_CANDIDATE'&&admission.eligibleTiers.includes(candidate.tier as 'A'|'B'|'C')&&input.productionCandidates.indexOf(candidate)>=0&&input.productionCandidates.indexOf(candidate)<admission.maxCandidates,
   selectionBoundWinner=verifiedGlobalWinnerAdmission({plan:input.plan,admission:input.globalWinnerAdmission});
 // A current Tier-B/PREFILTERED rank is mutable ranking/lease drift. It
 // cannot revoke the exact, fresh Tier-A winner snapshot. Terminal and stale
 // discovery facts remain current hard disqualifiers at the signing boundary.
 if(!candidate||(!activeEconomicLease&&!selectionBoundWinner)||currentHardDiscoveryDisqualification(candidate)||!Number.isFinite(age)||age<0||age>admission.maxCandidateAgeMs){reasons.push('P6_CLAIM_PRODUCTION_ADMISSION_INVALID');return undefined;}
 if(candidate.tokenYMint!==WSOL_MINT){reasons.push('P6_PRODUCTION_REQUIRES_WSOL_TOKEN_Y');return undefined;}
 return{address:candidate.poolAddress,maxCapitalLamports:admission.maxCapitalLamports,maxOpenPositions:admission.maxOpenPositions};
}
function equals(value:unknown, expected:unknown){return String(value??'')===String(expected??'');}
function validTimestamp(value:unknown){return Number.isFinite(Date.parse(String(value??'')));}
function validateCanaryHardRevocation(input:{current:Phase7ExecutionControl|undefined;approvalId:string;now:string}):string[]{
 const control=input.current,reasons:string[]=[];
 if(!control){reasons.push('P6_CANARY_CURRENT_CONTROL_MISSING');return reasons;}
 const age=Date.parse(input.now)-Date.parse(control.observedAt);
 if(!Number.isFinite(age)||age<0||age>60_000)reasons.push('P6_CANARY_CURRENT_CONTROL_STALE');
 if(control.healthStatus!=='HEALTHY')reasons.push('P6_CANARY_CURRENT_HEALTH_NOT_HEALTHY');
 if(control.driftStatus==='BLOCK')reasons.push('P6_CANARY_CURRENT_DRIFT_BLOCK');
 if(control.safetyMode!=='NORMAL')reasons.push('P6_CANARY_CURRENT_SAFETY_NOT_NORMAL');
 if(control.releaseIntegrityValid!==true)reasons.push('P6_CANARY_CURRENT_RELEASE_INTEGRITY_UNAVAILABLE');
 if(control.portfolioValid!==true)reasons.push('P6_CANARY_CURRENT_PORTFOLIO_UNAVAILABLE');
 if((control.activeIncidentIds??[]).length)reasons.push('P6_CANARY_CURRENT_ACTIVE_INCIDENT');
 if((control.revokedApprovalIds??[]).includes(input.approvalId))reasons.push('P6_CANARY_APPROVAL_REVOKED');
 return reasons.sort();
}
function validateBoundCanaryAuthorization(input:{plan:AutonomousPlan;provenance:Record<string,unknown>;bound:Phase7ExecutionControl|undefined;current:Phase7ExecutionControl|undefined;now:string}):string[]{
 const authorization=record(input.provenance.controlledCanaryAuthorization),intent=record(input.plan.planPayload.intent),binding=record(input.provenance.phase7Control),reasons:string[]=[];
 const approvalId=String(authorization.approvalId??''),issuedAt=String(authorization.issuedAt??''),expiresAt=String(authorization.expiresAt??''),boundDecisionId=String(authorization.boundControlDecisionId??'');
 if(authorization.schemaVersion!==1||authorization.action!=='PROMOTE_PRODUCTION'||!approvalId||!String(authorization.operatorId??'')||!validTimestamp(issuedAt)||!validTimestamp(expiresAt)||Date.parse(expiresAt)<=Date.parse(issuedAt))reasons.push('P6_CANARY_AUTHORIZATION_INVALID');
 if(!equals(authorization.planId,input.plan.planId)||!equals(authorization.wallet,input.plan.ownerAddress)||!equals(authorization.pool,input.plan.poolAddress)||!equals(authorization.thesisId,input.plan.thesisId)||!equals(authorization.intentId,input.plan.intentId)||!equals(authorization.candidateId,intent.candidateId)||!equals(authorization.capitalLamports,intent.capitalLamports)||authorization.maxConcurrentPositions!==1)reasons.push('P6_CANARY_AUTHORIZATION_SCOPE_MISMATCH');
 if(!boundDecisionId||!equals(boundDecisionId,binding.decisionId)||!equals(boundDecisionId,input.bound?.decisionId))reasons.push('P6_CANARY_BOUND_CONTROL_MISMATCH');
 if(Date.parse(input.plan.expiresAt)<=Date.parse(input.now))reasons.push('P6_CANARY_PLAN_EXPIRED');
 if(!validTimestamp(expiresAt)||Date.parse(expiresAt)<=Date.parse(input.now))reasons.push('P6_CANARY_APPROVAL_EXPIRED');
 reasons.push(...validateFreshPhase7ExecutionControl(input.bound,input.now));
 reasons.push(...validateCanaryHardRevocation({current:input.current,approvalId,now:input.now}));
 if(input.current?.poolDrift?.[input.plan.poolAddress]==='BLOCK')reasons.push('P6_CLAIM_P7_POOL_DRIFT_BLOCK');
 return [...new Set(reasons)].sort();
}
/** Fresh pre-sign safety preserves a bound controlled-canary authorization across harmless later observe-only controls, while still applying every current hard revocation. */
export function validateFreshOpenPhase7Safety(input:{plan:AutonomousPlan;current:Phase7ExecutionControl|undefined;bound:Phase7ExecutionControl|undefined;now:string;controlledCanary:boolean}):string[]{
 const provenance=record(record(input.plan.planPayload).provenance),boundCanary=input.plan.action==="OPEN"&&input.controlledCanary&&Object.keys(record(provenance.controlledCanaryAuthorization)).length>0;
 return boundCanary?validateBoundCanaryAuthorization({plan:input.plan,provenance,bound:input.bound,current:input.current,now:input.now}):validateFreshPhase7ExecutionControl(input.current,input.now);
}

/** Signing-boundary validation. A PostgreSQL plan is untrusted until this passes. */
export function validateClaimedPlan(input: {
  plan: AutonomousPlan;
  policy: MainnetCanaryDeploymentPolicy;
  ownedPositions: Record<string, unknown>[];
  positionTruth?: { owner: string; pool: string };
  productionCandidates?: ProductionAdmissionCandidate[];
  /** Exact database-verified global-winner binding; this does not admit a static pool. */
  globalWinnerAdmission?:VerifiedGlobalWinnerAdmission;
  phase7Control?:Phase7ExecutionControl;
  /** The immutable P7 control that the authenticated canary plan binds. */
  boundPhase7Control?:Phase7ExecutionControl;
  actionsToday?:number;
  /** Includes the just-claimed OPEN plan. A controlled canary admits that
   * one unresolved entry workflow and no second OPEN. */
  pendingExecutionCount?:number;
  unresolvedReconciliationDebt?:number;
  controlledCanary?:boolean;
  provenanceSecret?: string;
  now?: string;
}): ClaimGuardResult {
  const reasons: string[] = [],
    p = input.plan,
    amount = capital(p),
    provenance = record(record(p.planPayload).provenance),
    riskIncreasing = isRiskIncreasingAction(p.action),
    policyPool = riskIncreasing
      ? policyPoolForPlan({plan:p,policy:input.policy,productionCandidates:input.productionCandidates??[],...(input.globalWinnerAdmission?{globalWinnerAdmission:input.globalWinnerAdmission}:{}),now:input.now??new Date().toISOString(),controlledCanary:Boolean(input.controlledCanary)},reasons)
      : undefined;
  if (
    provenance.producer !== "LPFORGE_PRODUCTION" ||
    provenance.schemaVersion !== 1 ||
    provenance.intentId !== p.intentId ||
    provenance.poolAddress !== p.poolAddress ||
    provenance.observedAt !== p.observedAt
  )
    reasons.push("P6_CLAIM_PROVENANCE_INVALID");
  // Once the provenance secret is configured the plan must carry a valid
  // operator HMAC over the same identity fields the row asserts; before
  // that the guard stays backward compatible and verifies nothing.
  if (input.provenanceSecret) {
    const hmac = provenance.hmac;
    if (typeof hmac !== "string")
      reasons.push("P6_CLAIM_PROVENANCE_HMAC_MISSING");
    else if (
      !verifyPlanProvenanceHmac(
        {
          producer: String(provenance.producer),
          schemaVersion: Number(provenance.schemaVersion),
          intentId: p.intentId,
          poolAddress: p.poolAddress,
          observedAt: p.observedAt,
          action: p.action,
          ownerAddress: p.ownerAddress,
          positionAddress: p.positionAddress ?? null,
          expiresAt: p.expiresAt,
          immutablePlan:immutablePlanMaterial(p),
          // The exact P7 decision is part of the authenticated immutable
          // instruction. A database edit cannot retarget a valid economic
          // plan to a different control decision without invalidating HMAC.
          phase7Control:record(provenance.phase7Control),
          ...(Object.keys(record(provenance.globalSelection)).length?{globalSelection:record(provenance.globalSelection)}:{}),
          ...(Object.keys(record(provenance.controlledCanaryAuthorization)).length?{controlledCanaryAuthorization:record(provenance.controlledCanaryAuthorization)}:{}),
        },
        input.provenanceSecret,
        hmac,
      )
    )
      reasons.push("P6_CLAIM_PROVENANCE_HMAC_INVALID");
  }
  if (amount < 0n) reasons.push("P6_CLAIM_CAPITAL_INVALID");
  if (
    riskIncreasing &&
    amount <= 0n
  )
    reasons.push("P6_CLAIM_CAPITAL_REQUIRED");
  if (policyPool && amount > policyPool.maxCapitalLamports)
    reasons.push("P6_CLAIM_CAPITAL_EXCEEDS_POOL_POLICY");
  const open = input.ownedPositions.filter(
      (row) => String(row.lifecycle_state) === "OPEN",
    ),
    poolOpen = open.filter((row) => String(row.pool_address) === p.poolAddress);
  if (
    p.action === "OPEN" &&
    (open.length >= input.policy.maxOpenPositions ||
      poolOpen.length >= policyPool?.maxOpenPositions!)
  )
    reasons.push("P6_CLAIM_POSITION_LIMIT");
  if(input.controlledCanary){
    const canary=input.policy.controlledCanary;
    if(!canary)reasons.push('P6_CONTROLLED_CANARY_POLICY_REQUIRED');
    else {
      if(p.action==='OPEN'&&amount!==canary.exactLiquidityCapitalLamports)reasons.push('P6_CONTROLLED_CANARY_EXACT_CAPITAL_REQUIRED');
      if(p.action==='OPEN'&&input.pendingExecutionCount!==undefined&&input.pendingExecutionCount!==1)reasons.push('P6_CONTROLLED_CANARY_UNRESOLVED_OPEN_EXISTS');
      if(['ADD','RESHAPE','REBALANCE'].includes(p.action)&&!canary.replacementOpenAllowed)reasons.push('P6_CONTROLLED_CANARY_REPLACEMENT_OPEN_BLOCKED');
      if(p.action==='OPEN'&&input.ownedPositions.some(row=>!['CLOSED','SOL_SETTLED'].includes(String(row.lifecycle_state))))reasons.push('P6_CONTROLLED_CANARY_POSITION_ALREADY_EXISTS');
      if(p.action==='OPEN'&&input.unresolvedReconciliationDebt!==undefined&&input.unresolvedReconciliationDebt!==0)reasons.push('P6_CONTROLLED_CANARY_RECONCILIATION_DEBT');
    }
  }
  if (p.action !== "OPEN") {
    const owned = input.ownedPositions.find(
      (row) =>
        String(row.position_address) === p.positionAddress &&
        String(row.owner_address) === p.ownerAddress &&
        String(row.pool_address) === p.poolAddress,
    );
    if (!owned) reasons.push("P6_CLAIM_POSITION_NOT_OWNED");
    if (!input.positionTruth) reasons.push("P6_CLAIM_POSITION_TRUTH_MISSING");
    else if (
      input.positionTruth.owner !== p.ownerAddress ||
      input.positionTruth.pool !== p.poolAddress
    )
      reasons.push("P6_CLAIM_POSITION_TRUTH_MISMATCH");
  }
  // Risk-increasing mutations are fail-closed when P7 authority is unavailable.
  // Protective actions retain their dedicated degraded-control authorization path.
  if(riskIncreasing){
    const binding=record(provenance.phase7Control),boundDecisionId=String(binding.decisionId??''),boundObservedAt=String(binding.observedAt??''),control=input.phase7Control;
    // P7 controls are persisted *before* the operator creates a plan.  A
    // signed plan therefore binds the decision that governed it by identity;
    // chronological control-before-plan is expected, not a rejection reason.
    const boundCanary=p.action==='OPEN'&&input.controlledCanary&&Object.keys(record(provenance.controlledCanaryAuthorization)).length>0;
    if(boundCanary){
      reasons.push(...validateBoundCanaryAuthorization({plan:p,provenance,bound:input.boundPhase7Control,current:control,now:input.now??new Date().toISOString()}));
      if(!boundDecisionId||!boundObservedAt||!Number.isFinite(Date.parse(boundObservedAt))||Date.parse(boundObservedAt)>Date.parse(p.observedAt))reasons.push('P6_CLAIM_P7_CONTROL_BINDING_INVALID');
    }else{
      reasons.push(...validateBoundProductionAuthority({plan:p,bound:input.boundPhase7Control,current:control,now:input.now??new Date().toISOString()}));
      if(control?.poolDrift?.[p.poolAddress]==='BLOCK')reasons.push('P6_CLAIM_P7_POOL_DRIFT_BLOCK');
    }
  }
  // Protective actions (close/reduce/claim) must never be starved by the daily
  // action cap; the cap budgets only risk-increasing mutations.
  if(input.actionsToday!==undefined&&input.actionsToday>=input.policy.maxActionsPerDay&&riskIncreasing)reasons.push('P6_CLAIM_DAILY_ACTION_LIMIT');
  return {
    approved: reasons.length === 0,
    reasonCodes: reasons.sort(),
    capitalLamports: amount,
  };
}
