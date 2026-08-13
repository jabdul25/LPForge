import type { MainnetCanaryDeploymentPolicy } from "../../canary/src/index.js";
import type { AutonomousPlan } from "../../db/src/index.js";

export interface ClaimGuardResult {
  approved: boolean;
  reasonCodes: string[];
  capitalLamports: bigint;
}
export interface ProductionAdmissionCandidate {poolAddress:string;state:string;tier:string;lastSeenAt:string;}
export interface Phase7ExecutionControl {authorityMode:string;healthStatus:string;driftStatus:string;safetyMode:string;newEconomicActionAllowed:boolean;observedAt:string;}
export function validateFreshPhase7ExecutionControl(control:Phase7ExecutionControl|undefined,now:string,maxAgeMs=60_000):string[]{
 const reasons:string[]=[];const age=control?Date.parse(now)-Date.parse(control.observedAt):NaN;
 if(!control)reasons.push('P6_CLAIM_P7_CONTROL_MISSING');
 else {if(control.authorityMode!=='PRODUCTION')reasons.push('P6_CLAIM_P7_AUTHORITY_NOT_PRODUCTION');if(control.healthStatus!=='HEALTHY')reasons.push('P6_CLAIM_P7_HEALTH_NOT_HEALTHY');if(control.driftStatus==='BLOCK')reasons.push('P6_CLAIM_P7_DRIFT_BLOCK');if(control.safetyMode!=='NORMAL')reasons.push('P6_CLAIM_P7_SAFETY_NOT_NORMAL');if(!control.newEconomicActionAllowed)reasons.push('P6_CLAIM_P7_NEW_ACTION_BLOCKED');}
 if(!Number.isFinite(age)||age<0||age>maxAgeMs)reasons.push('P6_CLAIM_P7_CONTROL_STALE');return reasons.sort();
}
function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
function policyPoolForPlan(input:{plan:AutonomousPlan;policy:MainnetCanaryDeploymentPolicy;productionCandidates:ProductionAdmissionCandidate[];now:string},reasons:string[]){
 const staticPool=input.policy.pools.find(x=>x.address===input.plan.poolAddress);if(staticPool)return staticPool;
 const admission=input.policy.productionAdmission;
 if(!admission?.enabled){reasons.push('P6_CLAIM_POOL_NOT_ALLOWLISTED');return undefined;}
 const candidate=input.productionCandidates.find(x=>x.poolAddress===input.plan.poolAddress),age=candidate?Date.parse(input.now)-Date.parse(candidate.lastSeenAt):NaN;
 if(!candidate||candidate.state!=='ACTIVE_CANDIDATE'||!admission.eligibleTiers.includes(candidate.tier as 'A'|'B'|'C')||!Number.isFinite(age)||age<0||age>admission.maxCandidateAgeMs||input.productionCandidates.indexOf(candidate)>=admission.maxCandidates){reasons.push('P6_CLAIM_PRODUCTION_ADMISSION_INVALID');return undefined;}
 return{address:candidate.poolAddress,maxCapitalLamports:admission.maxCapitalLamports,maxOpenPositions:admission.maxOpenPositions};
}
/** Signing-boundary validation. A PostgreSQL plan is untrusted until this passes. */
export function validateClaimedPlan(input: {
  plan: AutonomousPlan;
  policy: MainnetCanaryDeploymentPolicy;
  ownedPositions: Record<string, unknown>[];
  positionTruth?: { owner: string; pool: string };
  productionCandidates?: ProductionAdmissionCandidate[];
  phase7Control?:Phase7ExecutionControl;
  actionsToday?:number;
  now?: string;
}): ClaimGuardResult {
  const reasons: string[] = [],
    p = input.plan,
    amount = capital(p),
    provenance = record(record(p.planPayload).provenance),
    policyPool = policyPoolForPlan({plan:p,policy:input.policy,productionCandidates:input.productionCandidates??[],now:input.now??new Date().toISOString()},reasons);
  if (
    provenance.producer !== "LPFORGE_PRODUCTION" ||
    provenance.schemaVersion !== 1 ||
    provenance.intentId !== p.intentId ||
    provenance.poolAddress !== p.poolAddress ||
    provenance.observedAt !== p.observedAt
  )
    reasons.push("P6_CLAIM_PROVENANCE_INVALID");
  if (amount < 0n) reasons.push("P6_CLAIM_CAPITAL_INVALID");
  if (
    ["OPEN", "ADD", "RESHAPE", "REBALANCE"].includes(p.action) &&
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
  if(input.phase7Control)reasons.push(...validateFreshPhase7ExecutionControl(input.phase7Control,input.now??new Date().toISOString()));
  if(input.actionsToday!==undefined&&input.actionsToday>=input.policy.maxActionsPerDay)reasons.push('P6_CLAIM_DAILY_ACTION_LIMIT');
  return {
    approved: reasons.length === 0,
    reasonCodes: reasons.sort(),
    capitalLamports: amount,
  };
}
