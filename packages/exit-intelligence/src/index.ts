import type { Phase4ManagementAction } from '../../contracts/src/index.js';
import type { ThesisStatus } from '../../thesis-monitor/src/index.js';
import type { RiskDecision } from '../../risk-governor/src/index.js';
import type { OorInventoryAssessment } from '../../oor-inventory/src/index.js';
export interface ExitInput {thesisStatus:ThesisStatus;risk:RiskDecision;currentForwardEv:number;closeCost:number;reduceFraction?:number;opportunityCostEv?:number;oor:OorInventoryAssessment;drawdownFraction:number;}
export interface ExitAssessment {action:Extract<Phase4ManagementAction,'HOLD'|'REDUCE'|'CLOSE_TO_NUMERAIRE'|'EMERGENCY_CLOSE'>;reasonFamily:'NONE'|'THESIS'|'ECONOMICS'|'RISK'|'OPPORTUNITY_COST'|'EMERGENCY';reasonCodes:string[];urgency:number;reduceFraction:number;}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
export function assessExit(i:ExitInput):ExitAssessment{
 if(i.risk.decision==='EMERGENCY'||i.thesisStatus==='EMERGENCY')return{action:'EMERGENCY_CLOSE',reasonFamily:'EMERGENCY',reasonCodes:['EXIT_EMERGENCY_RISK'],urgency:1,reduceFraction:1};
 if(i.thesisStatus==='INVALIDATED')return{action:'CLOSE_TO_NUMERAIRE',reasonFamily:'THESIS',reasonCodes:['EXIT_THESIS_INVALIDATED'],urgency:.9,reduceFraction:1};
 const closeNet=-Math.max(0,i.closeCost);if(i.currentForwardEv<=closeNet)return{action:'CLOSE_TO_NUMERAIRE',reasonFamily:'ECONOMICS',reasonCodes:['EXIT_FORWARD_EV_INFERIOR_TO_CLOSE'],urgency:clamp(.65+i.oor.managementUrgency*.25),reduceFraction:1};
 if(i.risk.decision==='BLOCK'&&(i.risk.hardBlocks.includes('RISK_DAILY_DRAWDOWN_LIMIT')||i.risk.hardBlocks.includes('RISK_TOKEN_EXPOSURE_LIMIT')||i.risk.hardBlocks.includes('RISK_POOL_EXPOSURE_LIMIT')))return{action:'REDUCE',reasonFamily:'RISK',reasonCodes:['EXIT_REDUCE_RISK_BUDGET'],urgency:.7,reduceFraction:clamp(i.reduceFraction??.5,.1,.9)};
 if((i.opportunityCostEv??0)>i.currentForwardEv+Math.max(.0002,i.closeCost))return{action:'CLOSE_TO_NUMERAIRE',reasonFamily:'OPPORTUNITY_COST',reasonCodes:['EXIT_SUPERIOR_CAPITAL_OPPORTUNITY'],urgency:.55,reduceFraction:1};
 if(i.oor.suggestedDisposition==='EXIT_REVIEW'&&i.oor.inventoryRisk>.7)return{action:'REDUCE',reasonFamily:'RISK',reasonCodes:['EXIT_REDUCE_OOR_INVENTORY_RISK'],urgency:i.oor.managementUrgency,reduceFraction:clamp(i.reduceFraction??.5,.1,.9)};
 return{action:'HOLD',reasonFamily:'NONE',reasonCodes:['EXIT_NOT_JUSTIFIED'],urgency:clamp(i.oor.managementUrgency*.4+i.drawdownFraction*.5),reduceFraction:0};
}
