import type { Phase4EntryRecommendationContract } from '../../contracts/src/index.js';
import type { EntryTimingFeatureVector } from '../../entry-features/src/index.js';
import type { OpportunityEconomics } from '../../opportunity/src/index.js';
import type { MachineReadableLpThesis } from '../../thesis/src/index.js';

export interface EntryPolicy {id:string;minReadiness:number;minDataCompleteness:number;maxDownsidePressure:number;maxDangerousRegimeMass:number;maxToxicity:number;maxReferenceDivergenceRisk:number;maxImmediateOorRisk:number;minExpectedNetValue:number;maxUncertainty:number;}
export const ENTRY_RESEARCH_POLICY_V1:EntryPolicy={id:'entry-research-v1',minReadiness:.60,minDataCompleteness:.60,maxDownsidePressure:.72,maxDangerousRegimeMass:.48,maxToxicity:.62,maxReferenceDivergenceRisk:.60,maxImmediateOorRisk:.65,minExpectedNetValue:0,maxUncertainty:.72};
export interface EntryRecommendation extends Phase4EntryRecommendationContract {policyId:string;readinessScore:number;thesisId:string;expectedNetLpValue:number;hardBlocks:string[];waitReasons:string[];}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
export function evaluateEntry(input:{features:EntryTimingFeatureVector;economics:OpportunityEconomics;thesis:MachineReadableLpThesis;observedAt:string;expiresAt:string;policy?:EntryPolicy;}):EntryRecommendation{
 const p=input.policy??ENTRY_RESEARCH_POLICY_V1,f=input.features,e=input.economics,primaryExpectedNetLpValue=input.thesis.expectedEconomics?.netLpValue??e.expectedNetLpValue;
 if(Date.parse(input.observedAt)>=Date.parse(input.expiresAt))return{phase:'P4',paperOnly:true,liveSigning:false,decision:'REJECT',observedAt:input.observedAt,expiresAt:input.expiresAt,reasonCodes:['ENTRY_RECOMMENDATION_EXPIRED'],confidence:0,policyId:p.id,readinessScore:0,thesisId:input.thesis.thesisId,expectedNetLpValue:primaryExpectedNetLpValue,hardBlocks:['ENTRY_RECOMMENDATION_EXPIRED'],waitReasons:[]};
 const hard:string[]=[];
 if(primaryExpectedNetLpValue<=p.minExpectedNetValue)hard.push('ENTRY_NET_VALUE_NON_POSITIVE');
 if(f.dataCompleteness<p.minDataCompleteness)hard.push('ENTRY_DATA_QUALITY_BLOCK');
 if(f.dangerousRegimeMass>p.maxDangerousRegimeMass)hard.push('ENTRY_DANGEROUS_REGIME_BLOCK');
 if(f.poolToxicity>p.maxToxicity)hard.push('ENTRY_TOXICITY_BLOCK');
 if(f.referenceDivergenceRisk>p.maxReferenceDivergenceRisk)hard.push('ENTRY_REFERENCE_DIVERGENCE_BLOCK');
 if(f.downsidePressure>p.maxDownsidePressure)hard.push('ENTRY_DOWNSIDE_PRESSURE_BLOCK');
 const readiness=clamp(.20*f.downsideDeceleration+.18*f.supportReclaimStrength+.16*f.twoWayFlowStrength+.10*f.flowRecovery+.14*f.regimeStability+.12*(1-f.volatilityExpansionRisk)+.10*(1-f.immediateOorRisk));
 const wait:string[]=[];
 if(f.immediateOorRisk>p.maxImmediateOorRisk)wait.push('WAIT_IMMEDIATE_OOR_RISK');
 if(f.supportReclaimStrength<.48)wait.push('WAIT_RECLAIM_NOT_CONFIRMED');
 if(f.twoWayFlowStrength<.42)wait.push('WAIT_FLOW_NOT_RECOVERED');
 if(f.volatilityExpansionRisk>.70)wait.push('WAIT_VOLATILITY_EXPANSION');
 if(f.regimeStability<.30)wait.push('WAIT_REGIME_UNSTABLE');
 if(e.uncertainty>p.maxUncertainty)wait.push('WAIT_ECONOMIC_UNCERTAINTY');
 if(readiness<p.minReadiness)wait.push('WAIT_READINESS_BELOW_THRESHOLD');
 const decision=hard.length?'REJECT':wait.length?'WAIT':'ENTRY_READY';
 const reasonCodes=decision==='ENTRY_READY'?['ENTRY_TIMING_APPROVED']:[...new Set([...hard,...wait])].sort();
 const confidence=clamp(readiness*(1-e.uncertainty)*(1-f.dangerousRegimeMass));
 return{phase:'P4',paperOnly:true,liveSigning:false,decision,observedAt:input.observedAt,expiresAt:input.expiresAt,reasonCodes,confidence,policyId:p.id,readinessScore:readiness,thesisId:input.thesis.thesisId,expectedNetLpValue:primaryExpectedNetLpValue,hardBlocks:hard,waitReasons:wait};
}
