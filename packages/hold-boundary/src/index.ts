import type { PaperPosition } from '../../paper-position/src/index.js';
export interface HoldBoundaryInput {position:PaperPosition;activeBinId:number;survival15m:number;survival30m:number;feeVelocityPerHour:number;expectedInventoryLossPerHour:number;binVelocityPerMinute:number;volatilityRisk:number;interventionCost:number;thesisValid:boolean;}
export interface HoldBoundaryAssessment {holdEligible:boolean;managementReviewRequired:boolean;boundarySide:'LOWER'|'UPPER'|'NONE';binsRemaining:number;boundaryRisk:number;holdForwardValuePerHour:number;churnRisk:number;reasonCodes:string[];}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
export function assessHoldAndBoundary(i:HoldBoundaryInput):HoldBoundaryAssessment{
 const below=i.activeBinId-i.position.lowerBinId,above=i.position.upperBinId-i.activeBinId;const side=below<=above?'LOWER':'UPPER';const binsRemaining=Math.max(0,Math.min(below,above));const width=Math.max(1,i.position.upperBinId-i.position.lowerBinId);const proximity=clamp(1-binsRemaining/Math.max(1,width*.25));const survivalRisk=clamp(1-(.55*i.survival15m+.45*i.survival30m));const velocityRisk=clamp(i.binVelocityPerMinute/10);const boundaryRisk=clamp(.45*proximity+.30*survivalRisk+.15*velocityRisk+.10*clamp(i.volatilityRisk));const holdForwardValuePerHour=i.feeVelocityPerHour-i.expectedInventoryLossPerHour;const churnRisk=clamp(i.interventionCost/Math.max(Math.abs(holdForwardValuePerHour),.000001)*.25);const reasons:string[]=[];
 if(boundaryRisk>.6)reasons.push('BOUNDARY_RISK_HIGH');if(holdForwardValuePerHour<=0)reasons.push('HOLD_FORWARD_VALUE_NON_POSITIVE');if(churnRisk>.6)reasons.push('INTERVENTION_CHURN_COST_HIGH');if(!i.thesisValid)reasons.push('HOLD_THESIS_NOT_VALID');
 const managementReviewRequired=!i.thesisValid||boundaryRisk>.6||holdForwardValuePerHour<=0;const holdEligible=i.thesisValid&&holdForwardValuePerHour>0&&(boundaryRisk<.75||churnRisk>.7);
 if(holdEligible)reasons.push('HOLD_ELIGIBLE');
 return{holdEligible,managementReviewRequired,boundarySide:binsRemaining>width*.3?'NONE':side,binsRemaining,boundaryRisk,holdForwardValuePerHour,churnRisk,reasonCodes:[...new Set(reasons)].sort()};
}
