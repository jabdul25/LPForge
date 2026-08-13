import type { Phase4ManagementAction } from '../../contracts/src/index.js';
import type { PaperPosition } from '../../paper-position/src/index.js';
import { transitionPaperPosition } from '../../paper-position/src/index.js';
import { governRisk, type RiskFacts } from '../../risk-governor/src/index.js';
import { assessOorAndInventory } from '../../oor-inventory/src/index.js';
import { assessExit } from '../../exit-intelligence/src/index.js';
import { compareForwardEv, type ActionForecast } from '../../forward-ev/src/index.js';
import type { ThesisStatus } from '../../thesis-monitor/src/index.js';
export interface PaperManagementCycleInput {position:PaperPosition;observedAt:string;activeBinId:number;thesisStatus:ThesisStatus;riskFacts:RiskFacts;currentForwardEv:number;actionForecasts:ActionForecast[];expectedReturnProbability:number;expectedReturnMinutes:number;binVelocityPerMinute:number;regimeDanger:number;volatileTokenValue:number;numeraireValue:number;maxAdverseTokenValue:number;feeVelocityBeforeOor:number;rebalanceCost:number;closeCost:number;opportunityCostEv?:number;drawdownFraction:number;}
export interface PaperManagementCycleResult {phase:'P4';paperOnly:true;liveSigning:false;riskDecision:string;rangeState:string;oorDisposition:string;managementAction:Phase4ManagementAction;reasonCodes:string[];position:PaperPosition;}
export function runPaperManagementCycle(i:PaperManagementCycleInput):PaperManagementCycleResult{const risk=governRisk(i.riskFacts);let position=transitionPaperPosition(i.position,'MARK_RANGE',i.observedAt,i.activeBinId);const oor=assessOorAndInventory({position,activeBinId:i.activeBinId,expectedReturnProbability:i.expectedReturnProbability,expectedReturnMinutes:i.expectedReturnMinutes,binVelocityPerMinute:i.binVelocityPerMinute,regimeDanger:i.regimeDanger,volatileTokenValue:i.volatileTokenValue,numeraireValue:i.numeraireValue,maxAdverseTokenValue:i.maxAdverseTokenValue,feeVelocityBeforeOor:i.feeVelocityBeforeOor,rebalanceCost:i.rebalanceCost});const exit=assessExit({thesisStatus:i.thesisStatus,risk,currentForwardEv:i.currentForwardEv,closeCost:i.closeCost,...(i.opportunityCostEv!==undefined?{opportunityCostEv:i.opportunityCostEv}:{}),oor,drawdownFraction:i.drawdownFraction});let action:Phase4ManagementAction=exit.action;const reasons=[...risk.reasonCodes,...oor.reasonCodes,...exit.reasonCodes];if(action==='HOLD'){const forward=compareForwardEv({positionId:position.id,observedAt:i.observedAt,thesisStatus:i.thesisStatus,forecasts:i.actionForecasts});action=forward.action;reasons.push(...forward.reasonCodes);}return{phase:'P4',paperOnly:true,liveSigning:false,riskDecision:risk.decision,rangeState:position.state,oorDisposition:oor.suggestedDisposition,managementAction:action,reasonCodes:[...new Set(reasons)].sort(),position};}


export interface PaperManagementEvidenceStore {
  upsertPaperPosition(value:{paperPositionId:string;poolAddress:string;thesisId:string;candidateId:string;state:string;capital:number;lowerBinId:number;upperBinId:number;openedAt?:string;closedAt?:string;payload:Record<string,unknown>}):Promise<void>;
  insertPaperPositionEvent(value:{paperPositionId:string;observedAt:string;priorState?:string;nextState:string;eventType:string;payload:Record<string,unknown>}):Promise<void>;
  insertManagementDecision(value:{managementDecisionId:string;paperPositionId:string;observedAt:string;action:string;forwardEv:number;alternativeEv?:number;reasonCodes:string[];payload:Record<string,unknown>}):Promise<void>;
}
const forecastNet=(f:ActionForecast)=>f.grossForwardValue-Math.max(0,f.implementationCost)-Math.max(0,f.tailRiskCharge);
export async function persistPaperManagementCycleEvidence(store:PaperManagementEvidenceStore,input:PaperManagementCycleInput,result:PaperManagementCycleResult):Promise<void>{
 const p=result.position;const selected=input.actionForecasts.find((x)=>x.action===result.managementAction);const hold=input.actionForecasts.find((x)=>x.action==='HOLD');
 const forwardEv=selected?forecastNet(selected):(result.managementAction==='CLOSE_TO_NUMERAIRE'||result.managementAction==='EMERGENCY_CLOSE'?-Math.max(0,input.closeCost):input.currentForwardEv);
 await store.upsertPaperPosition({paperPositionId:p.id,poolAddress:p.pool,thesisId:p.thesisId,candidateId:p.candidateId,state:p.state,capital:p.capital,lowerBinId:p.lowerBinId,upperBinId:p.upperBinId,...(p.openedAt?{openedAt:p.openedAt}:{}),...(p.closedAt?{closedAt:p.closedAt}:{}),payload:{...p,paperOnly:true}});
 await store.insertPaperPositionEvent({paperPositionId:p.id,observedAt:input.observedAt,priorState:input.position.state,nextState:p.state,eventType:'MANAGEMENT_CYCLE',payload:{activeBinId:input.activeBinId,riskDecision:result.riskDecision,oorDisposition:result.oorDisposition,paperOnly:true}});
 await store.insertManagementDecision({managementDecisionId:`MGMT:${p.id}:${input.observedAt}`,paperPositionId:p.id,observedAt:input.observedAt,action:result.managementAction,forwardEv,...(hold?{alternativeEv:forecastNet(hold)}:{}),reasonCodes:result.reasonCodes,payload:{rangeState:result.rangeState,riskDecision:result.riskDecision,oorDisposition:result.oorDisposition,paperOnly:true,liveSigning:false}});
}
