import type { DeepScreenResult } from '../../pool-deep-screen/src/index.js';
export type UniverseTier='A'|'B'|'C'|'CONTROL'|'COOLDOWN'|'REJECTED'|'QUARANTINED';
export interface UniversePolicy {id:string;maxActive:number;maxWatch:number;controlCount:number;urgentHalfLifeMinutes:number;controlSeed:string;}
export const DEFAULT_UNIVERSE_POLICY:UniversePolicy={id:'pool-universe-v2.1.1',maxActive:10,maxWatch:30,controlCount:20,urgentHalfLifeMinutes:20,controlSeed:'lpforge-v2.1.1'};
export interface UniverseAssignment {poolAddress:string;tier:UniverseTier;rank:number|null;deepPriority:number;selectionReason:string[];control:boolean;selectionProbability:number;opportunityHalfLifeMinutes:number|null;}
const hash=(s:string)=>{let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0)/4294967295};
export function assignUniverseTiers(results:DeepScreenResult[],policy:UniversePolicy=DEFAULT_UNIVERSE_POLICY):UniverseAssignment[]{
  const qualified=results.filter(x=>x.eligibility==='QUALIFIED').sort((a,b)=>b.currentOpportunityScore-a.currentOpportunityScore||b.poolQualityScore-a.poolQualityScore||a.poolAddress.localeCompare(b.poolAddress));
  const watches=results.filter(x=>x.eligibility==='WATCHLIST').sort((a,b)=>b.poolQualityScore-a.poolQualityScore||a.poolAddress.localeCompare(b.poolAddress));
  const out:UniverseAssignment[]=[];qualified.forEach((x,i)=>{const tier:UniverseTier=i<policy.maxActive?'A':i<policy.maxActive+policy.maxWatch?'B':'C';const reason=['DEEP_QUALIFIED',...(x.opportunityHalfLifeMinutes!==null&&x.opportunityHalfLifeMinutes<=policy.urgentHalfLifeMinutes?['OPPORTUNITY_SHORT_HALF_LIFE']:[])];out.push({poolAddress:x.poolAddress,tier,rank:i+1,deepPriority:.6*x.currentOpportunityScore+.4*x.poolQualityScore,selectionReason:reason,control:false,selectionProbability:1,opportunityHalfLifeMinutes:x.opportunityHalfLifeMinutes});});
  watches.forEach(x=>{if(!out.some(y=>y.poolAddress===x.poolAddress))out.push({poolAddress:x.poolAddress,tier:'C',rank:null,deepPriority:.4*x.currentOpportunityScore+.6*x.poolQualityScore,selectionReason:['DEEP_WATCHLIST'],control:false,selectionProbability:1,opportunityHalfLifeMinutes:x.opportunityHalfLifeMinutes});});
  const controls=results.filter(x=>!out.some(y=>y.poolAddress===x.poolAddress)&&x.eligibility!=='BLOCK'&&x.eligibility!=='QUARANTINED').map(x=>({x,r:hash(`${policy.controlSeed}:${x.poolAddress}`)})).sort((a,b)=>a.r-b.r).slice(0,policy.controlCount);
  for(const {x} of controls)out.push({poolAddress:x.poolAddress,tier:'CONTROL',rank:null,deepPriority:0,selectionReason:['RANDOM_QUALIFIED_CONTROL'],control:true,selectionProbability:Math.min(1,policy.controlCount/Math.max(1,results.length)),opportunityHalfLifeMinutes:x.opportunityHalfLifeMinutes});
  for(const x of results.filter(x=>x.eligibility==='BLOCK'))out.push({poolAddress:x.poolAddress,tier:'REJECTED',rank:null,deepPriority:0,selectionReason:x.reasonCodes,control:false,selectionProbability:0,opportunityHalfLifeMinutes:x.opportunityHalfLifeMinutes});
  for(const x of results.filter(x=>x.eligibility==='QUARANTINED'))out.push({poolAddress:x.poolAddress,tier:'QUARANTINED',rank:null,deepPriority:0,selectionReason:x.reasonCodes,control:false,selectionProbability:0,opportunityHalfLifeMinutes:x.opportunityHalfLifeMinutes});
  return out;
}
export function activeCandidateAddresses(assignments:UniverseAssignment[]):string[]{return assignments.filter(x=>x.tier==='A').sort((a,b)=>(a.rank??999)-(b.rank??999)).map(x=>x.poolAddress)}
