export interface CapitalPolicy {id:string;reserveFraction:number;maxDeployedFraction:number;maxPerPoolFraction:number;maxPerTokenFraction:number;maxSingleAllocationFraction:number;minAllocation:number;}
export const CAPITAL_RESEARCH_POLICY_V1:CapitalPolicy={id:'capital-research-v1',reserveFraction:.25,maxDeployedFraction:.65,maxPerPoolFraction:.15,maxPerTokenFraction:.25,maxSingleAllocationFraction:.12,minAllocation:.01};
export interface CapitalRequest {id:string;pool:string;token:string;requested:number;confidence:number;expectedNetValueRate:number;downsideRisk:number;}
export interface ExposureState {deployed:number;poolExposure:Record<string,number|undefined>;tokenExposure:Record<string,number|undefined>;reserved:number;}
export interface CapitalAllocation {requestId:string;pool:string;token:string;allocated:number;requested:number;reasonCodes:string[];}
export interface CapitalAllocationResult {policyId:string;walletCapital:number;feeAndSafetyReserve:number;deployableLimit:number;allocations:CapitalAllocation[];totalAllocated:number;remainingDeployable:number;}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));

/**
 * Production sizing deliberately does not repeat Phase-4 thesis scoring.
 * Phase 4 decides whether an entry is worthwhile; this layer applies only
 * configured capital envelopes, exposure facts, and minimum executable size.
 */
export interface ProductionCapitalPolicy {id:string;reserveCapital:number;maxPortfolioCapital:number;maxTokenCapital:number;targetInitialPosition:number;maxInitialPosition:number;minInitialPosition:number;}
export interface ProductionCapitalRequest {id:string;pool:string;token:string;requested:number;maxPoolCapital:number;entryReady:boolean;expectedNetValue:number;}
export function allocateProductionCapital(input:{walletCapital:number;requests:ProductionCapitalRequest[];exposure?:ExposureState;policy:ProductionCapitalPolicy}):CapitalAllocationResult{
 const p=input.policy;if(!(input.walletCapital>0)||!(p.maxPortfolioCapital>0)||!(p.maxTokenCapital>0)||!(p.targetInitialPosition>0)||!(p.maxInitialPosition>0)||!(p.minInitialPosition>0)||p.reserveCapital<0||p.minInitialPosition>p.targetInitialPosition||p.targetInitialPosition>p.maxInitialPosition)throw new Error('LPFORGE_PRODUCTION_CAPITAL_POLICY');
 const ex=input.exposure??{deployed:0,poolExposure:{},tokenExposure:{},reserved:0},reserve=Math.max(p.reserveCapital,ex.reserved),deployableLimit=Math.max(0,Math.min(input.walletCapital-reserve,p.maxPortfolioCapital)-ex.deployed);let remaining=deployableLimit;const pool={...ex.poolExposure},token={...ex.tokenExposure},allocations:CapitalAllocation[]=[];
 for(const r of [...input.requests].sort((a,b)=>a.id.localeCompare(b.id))){const reasons:string[]=[];const requested=Math.max(0,r.requested),initialPositionCap=Math.max(0,p.maxInitialPosition),poolCap=Math.max(0,r.maxPoolCapital-(pool[r.pool]??0)),tokenCap=Math.max(0,p.maxTokenCapital-(token[r.token]??0));let amount=Math.min(requested,initialPositionCap,poolCap,tokenCap,remaining);
  if(!r.entryReady){amount=0;reasons.push('CAPITAL_ENTRY_NOT_READY');}
  if(!(r.expectedNetValue>0)){amount=0;reasons.push('CAPITAL_EXPECTED_VALUE_NON_POSITIVE');}
  if(requested>initialPositionCap)reasons.push('CAPITAL_INITIAL_POSITION_LIMIT');
  if(amount<p.minInitialPosition){if(amount>0)reasons.push('CAPITAL_BELOW_MINIMUM');amount=0;}
  if(poolCap<=0)reasons.push('CAPITAL_POOL_LIMIT');if(tokenCap<=0)reasons.push('CAPITAL_TOKEN_LIMIT');if(remaining<=0)reasons.push('CAPITAL_GLOBAL_LIMIT');
  if(amount>0){pool[r.pool]=(pool[r.pool]??0)+amount;token[r.token]=(token[r.token]??0)+amount;remaining-=amount;reasons.push('CAPITAL_ALLOCATED');}
  allocations.push({requestId:r.id,pool:r.pool,token:r.token,allocated:amount,requested,reasonCodes:reasons});
 }
 const totalAllocated=allocations.reduce((a,b)=>a+b.allocated,0);return{policyId:p.id,walletCapital:input.walletCapital,feeAndSafetyReserve:reserve,deployableLimit,allocations,totalAllocated,remainingDeployable:Math.max(0,remaining)};
}
export function allocateCapital(input:{walletCapital:number;requests:CapitalRequest[];exposure?:ExposureState;policy?:CapitalPolicy;}):CapitalAllocationResult{
 const p=input.policy??CAPITAL_RESEARCH_POLICY_V1;if(!(input.walletCapital>0))throw new Error('LPFORGE_CAPITAL_INVALID_WALLET');
 const ex=input.exposure??{deployed:0,poolExposure:{},tokenExposure:{},reserved:0};
 const reserve=Math.max(input.walletCapital*p.reserveFraction,ex.reserved);const deployableLimit=Math.max(0,Math.min(input.walletCapital-reserve,input.walletCapital*p.maxDeployedFraction)-ex.deployed);
 let remaining=deployableLimit;const pool={...ex.poolExposure},token={...ex.tokenExposure};const allocations:CapitalAllocation[]=[];
 const sorted=[...input.requests].sort((a,b)=>((b.expectedNetValueRate*b.confidence*(1-b.downsideRisk))-(a.expectedNetValueRate*a.confidence*(1-a.downsideRisk)))||a.id.localeCompare(b.id));
 for(const r of sorted){const reasons:string[]=[];const quality=clamp(r.confidence)*(1-clamp(r.downsideRisk));const requested=Math.max(0,r.requested);const singleCap=input.walletCapital*p.maxSingleAllocationFraction;const poolCap=Math.max(0,input.walletCapital*p.maxPerPoolFraction-(pool[r.pool]??0));const tokenCap=Math.max(0,input.walletCapital*p.maxPerTokenFraction-(token[r.token]??0));let amount=Math.min(requested,singleCap,poolCap,tokenCap,remaining)*quality;
  if(r.expectedNetValueRate<=0){amount=0;reasons.push('CAPITAL_EXPECTED_VALUE_NON_POSITIVE');}
  if(quality<.25){amount=0;reasons.push('CAPITAL_QUALITY_TOO_LOW');}
  if(amount<p.minAllocation){if(amount>0)reasons.push('CAPITAL_BELOW_MINIMUM');amount=0;}
  if(poolCap<=0)reasons.push('CAPITAL_POOL_LIMIT');if(tokenCap<=0)reasons.push('CAPITAL_TOKEN_LIMIT');if(remaining<=0)reasons.push('CAPITAL_GLOBAL_LIMIT');
  if(amount>0){pool[r.pool]=(pool[r.pool]??0)+amount;token[r.token]=(token[r.token]??0)+amount;remaining-=amount;reasons.push('CAPITAL_ALLOCATED');}
  allocations.push({requestId:r.id,pool:r.pool,token:r.token,allocated:amount,requested,reasonCodes:reasons});
 }
 const totalAllocated=allocations.reduce((a,b)=>a+b.allocated,0);return{policyId:p.id,walletCapital:input.walletCapital,feeAndSafetyReserve:reserve,deployableLimit,allocations,totalAllocated,remainingDeployable:Math.max(0,remaining)};
}
