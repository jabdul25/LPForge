import type { MachineReadableLpThesis } from '../../thesis/src/index.js';
import type { RegimeAssessment } from '../../regime/src/index.js';
import type { RiskDecision } from '../../risk-governor/src/index.js';
export type ThesisStatus='VALID'|'DETERIORATING'|'INVALIDATED'|'EMERGENCY';
export interface ThesisMonitorInput {thesis:MachineReadableLpThesis;regime:RegimeAssessment;currentForwardEv:number;currentSurvivalProbability:number;poolEligibility:'ELIGIBLE'|'WATCH'|'BLOCK';toxicityProbability:number;referenceDivergenceBps:number;supportIntegrity?:number;risk:RiskDecision;observedAt:string;}
export interface ThesisMonitorResult {thesisId:string;status:ThesisStatus;observedAt:string;improvedEvidence:string[];deterioratedEvidence:string[];invalidatedEvidence:string[];reasonCodes:string[];confidence:number;}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
function p(r:RegimeAssessment,label:string){return r.probabilities.find((x)=>x.label===label)?.probability??0;}
export function monitorThesis(i:ThesisMonitorInput):ThesisMonitorResult{
 const improved:string[]=[],deteriorated:string[]=[],invalid:string[]=[];
 if(i.risk.decision==='EMERGENCY')invalid.push(...i.risk.emergencyReasons.map((x)=>`RISK:${x}`));
 if(i.risk.decision==='BLOCK'&&i.risk.hardBlocks.includes('RISK_RECONCILIATION_REQUIRED'))invalid.push('RISK_RECONCILIATION_REQUIRED');
 if(i.currentForwardEv<=0)invalid.push('FORWARD_EV_NON_POSITIVE'); else if(i.currentForwardEv<i.thesis.expectedEconomics.netLpValue*.25)deteriorated.push('FORWARD_EV_ERODED'); else if(i.currentForwardEv>i.thesis.expectedEconomics.netLpValue*.75)improved.push('FORWARD_EV_HEALTHY');
 if(p(i.regime,'FREEFALL')>.45)invalid.push('REGIME_FREEFALL_PROBABILITY_EXCEEDS_POLICY'); else if(i.regime.transitionRisk>.55)deteriorated.push('REGIME_TRANSITION_RISK_RISING');
 if(i.poolEligibility==='BLOCK')invalid.push('POOL_ELIGIBILITY_BLOCK'); else if(i.poolEligibility==='WATCH')deteriorated.push('POOL_ELIGIBILITY_WATCH');
 if(i.toxicityProbability>.70)invalid.push('FLOW_TOXICITY_EXCEEDS_POLICY'); else if(i.toxicityProbability>.50)deteriorated.push('FLOW_TOXICITY_RISING');
 if(Math.abs(i.referenceDivergenceBps)>300)invalid.push('REFERENCE_DIVERGENCE_EXCEEDS_POLICY'); else if(Math.abs(i.referenceDivergenceBps)>180)deteriorated.push('REFERENCE_DIVERGENCE_RISING');
 if(i.currentSurvivalProbability<.35)invalid.push('RANGE_SURVIVAL_BELOW_POLICY'); else if(i.currentSurvivalProbability<.55)deteriorated.push('RANGE_SURVIVAL_DETERIORATING'); else improved.push('RANGE_SURVIVAL_ACCEPTABLE');
 if(i.supportIntegrity!==undefined){if(i.supportIntegrity<.2&&i.thesis.invalidation.includes('PULLBACK_SUPPORT_INVALIDATED'))invalid.push('PULLBACK_SUPPORT_INVALIDATED');else if(i.supportIntegrity<.45)deteriorated.push('SUPPORT_WEAKENING');}
 const status:ThesisStatus=i.risk.decision==='EMERGENCY'?'EMERGENCY':invalid.length?'INVALIDATED':deteriorated.length?'DETERIORATING':'VALID';
 const confidence=clamp(i.regime.confidence*(1-i.regime.transitionRisk)*(status==='VALID'?1:status==='DETERIORATING'?.65:.25));
 const reasonCodes=status==='VALID'?['THESIS_VALID']:[...new Set([...deteriorated,...invalid])].sort();return{thesisId:i.thesis.thesisId,status,observedAt:i.observedAt,improvedEvidence:[...new Set(improved)].sort(),deterioratedEvidence:[...new Set(deteriorated)].sort(),invalidatedEvidence:[...new Set(invalid)].sort(),reasonCodes,confidence};
}
