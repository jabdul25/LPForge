import type { Phase4ManagementAction, Phase4ManagementDecisionContract } from '../../contracts/src/index.js';
import type { ThesisStatus } from '../../thesis-monitor/src/index.js';
export interface ActionForecast {action:Phase4ManagementAction;grossForwardValue:number;implementationCost:number;tailRiskCharge:number;uncertainty:number;feasibility:number;}
export interface ForwardEvPolicy {id:string;uncertaintyPenalty:number;minimumIncrementalBenefit:number;}
export const FORWARD_EV_POLICY_V1:ForwardEvPolicy={id:'forward-ev-research-v1',uncertaintyPenalty:.20,minimumIncrementalBenefit:.0001};
export interface ForwardEvActionResult extends ActionForecast {netForwardEv:number;utility:number;}
export interface ForwardEvDecision extends Phase4ManagementDecisionContract {policyId:string;alternatives:ForwardEvActionResult[];incrementalBenefit:number;}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
export function compareForwardEv(input:{positionId:string;observedAt:string;thesisStatus:ThesisStatus;forecasts:ActionForecast[];policy?:ForwardEvPolicy;}):ForwardEvDecision{
 const p=input.policy??FORWARD_EV_POLICY_V1;if(!input.forecasts.length)throw new Error('LPFORGE_FORWARD_EV_NO_ACTIONS');
 const alternatives=input.forecasts.map((x)=>{const net=x.grossForwardValue-Math.max(0,x.implementationCost)-Math.max(0,x.tailRiskCharge);const utility=net*(1-p.uncertaintyPenalty*clamp(x.uncertainty))*clamp(x.feasibility);return{...x,netForwardEv:net,utility};}).sort((a,b)=>b.utility-a.utility||a.action.localeCompare(b.action));
 let best=alternatives[0]!;const hold=alternatives.find((x)=>x.action==='HOLD');const close=alternatives.find((x)=>x.action==='CLOSE_TO_NUMERAIRE');
 if((input.thesisStatus==='INVALIDATED'||input.thesisStatus==='EMERGENCY')&&close)best=close;
 else if(hold&&best.action!=='HOLD'&&best.utility-hold.utility<p.minimumIncrementalBenefit)best=hold;
 const holdUtility=hold?.utility??0,incremental=best.utility-holdUtility;const reasons=[input.thesisStatus==='INVALIDATED'?'THESIS_INVALIDATED':input.thesisStatus==='EMERGENCY'?'THESIS_EMERGENCY':best.action==='HOLD'?'HOLD_FORWARD_EV_DOMINATES':'ALTERNATIVE_FORWARD_EV_DOMINATES'];
 return{phase:'P4',paperOnly:true,liveSigning:false,positionId:input.positionId,action:best.action,observedAt:input.observedAt,reasonCodes:reasons,forwardEv:best.netForwardEv,...(hold?{alternativeEv:hold.netForwardEv}:{}),policyId:p.id,alternatives,incrementalBenefit:incremental};
}
