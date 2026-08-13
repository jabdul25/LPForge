import type { MarketContextSnapshot } from '../../market-context/src/index.js';
import type { RegimeAssessment } from '../../regime/src/index.js';
import type { StructureFeatureVector } from '../../structure-features/src/index.js';
import type { PoolAssessment } from '../../pool-intelligence/src/index.js';
import type { RangeStrategyCandidate } from '../../rangeforge/src/index.js';

export interface EntryTimingFeatureVector {
  downsidePressure:number;
  downsideDeceleration:number;
  upsideChaseRisk:number;
  volatilityExpansionRisk:number;
  supportReclaimStrength:number;
  twoWayFlowStrength:number;
  flowRecovery:number;
  regimeStability:number;
  dangerousRegimeMass:number;
  poolToxicity:number;
  referenceDivergenceRisk:number;
  activeBinPosition:number;
  lowerBufferRatio:number;
  upperBufferRatio:number;
  immediateOorRisk:number;
  dataCompleteness:number;
  reasonCodes:string[];
}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
function prob(r:RegimeAssessment,label:string){return r.probabilities.find((x)=>x.label===label)?.probability??0;}
export function computeEntryTimingFeatures(input:{context:MarketContextSnapshot;regime:RegimeAssessment;structure:StructureFeatureVector;pool:PoolAssessment;candidate:RangeStrategyCandidate;activeBinId:number;referenceDivergenceBps?:number;previousTwoWayRatio?:number;}):EntryTimingFeatureVector{
 const h5=input.context.horizons['5m'],h15=input.context.horizons['15m'];
 const downsidePressure=clamp(Math.max(0,-h5.returnPct)/3*.35+Math.max(0,-h5.netBins)/20*.35+input.structure.downsideAcceleration*.30);
 const downsideDeceleration=clamp(1-input.structure.downsideAcceleration);
 const upsideChaseRisk=clamp(Math.max(0,h5.returnPct)/4*.45+input.structure.upsideAcceleration*.35+Math.max(0,h5.binVelocityPerMinute-h15.binVelocityPerMinute)/10*.20);
 const volatilityExpansionRisk=clamp(input.structure.expansionScore*.55+(input.structure.volatilityState==='EXTREME'?1:input.structure.volatilityState==='HIGH'?.65:input.structure.volatilityState==='MODERATE'?.3:.1)*.45);
 const supportReclaimStrength=clamp(input.structure.supportIntegrity*.55+input.structure.reclaimScore*.45);
 const twoWayFlowStrength=clamp(input.structure.flowTwoWay);
 const flowRecovery=clamp(input.previousTwoWayRatio===undefined?twoWayFlowStrength:(twoWayFlowStrength-input.previousTwoWayRatio+.5));
 const dangerousRegimeMass=clamp(prob(input.regime,'FREEFALL')+prob(input.regime,'TREND_DOWN')*.7+prob(input.regime,'DISTRIBUTION')*.45);
 const regimeStability=clamp(input.regime.stability*(1-input.regime.transitionRisk));
 const poolToxicity=clamp(input.pool.toxicityProbability);
 const referenceDivergenceRisk=clamp(Math.abs(input.referenceDivergenceBps??0)/250);
 const width=Math.max(1,input.candidate.upperBinId-input.candidate.lowerBinId);
 const activeBinPosition=clamp((input.activeBinId-input.candidate.lowerBinId)/width);
 const lowerBufferRatio=clamp((input.activeBinId-input.candidate.lowerBinId)/Math.max(1,input.candidate.widthBins));
 const upperBufferRatio=clamp((input.candidate.upperBinId-input.activeBinId)/Math.max(1,input.candidate.widthBins));
 const immediateOorRisk=clamp(Math.max(0,.18-Math.min(lowerBufferRatio,upperBufferRatio))/.18*.55+downsidePressure*.25+volatilityExpansionRisk*.20);
 const dataCompleteness=Math.min(h5.completeness,h15.completeness,input.context.horizons['1h'].completeness);
 const reasonCodes:string[]=[];
 if(downsidePressure>.6)reasonCodes.push('ENTRY_DOWNSIDE_PRESSURE_HIGH');
 if(upsideChaseRisk>.65)reasonCodes.push('ENTRY_UPSIDE_CHASE_RISK');
 if(volatilityExpansionRisk>.7)reasonCodes.push('ENTRY_VOLATILITY_EXPANDING');
 if(supportReclaimStrength>.6)reasonCodes.push('ENTRY_SUPPORT_RECLAIM_STRONG');
 if(twoWayFlowStrength<.35)reasonCodes.push('ENTRY_FLOW_ONE_WAY');
 if(regimeStability<.25)reasonCodes.push('ENTRY_REGIME_UNSTABLE');
 if(poolToxicity>.55)reasonCodes.push('ENTRY_POOL_TOXICITY_HIGH');
 if(referenceDivergenceRisk>.5)reasonCodes.push('ENTRY_REFERENCE_DIVERGENCE');
 if(immediateOorRisk>.55)reasonCodes.push('ENTRY_IMMEDIATE_OOR_RISK');
 if(dataCompleteness<.6)reasonCodes.push('ENTRY_DATA_INCOMPLETE');
 return{downsidePressure,downsideDeceleration,upsideChaseRisk,volatilityExpansionRisk,supportReclaimStrength,twoWayFlowStrength,flowRecovery,regimeStability,dangerousRegimeMass,poolToxicity,referenceDivergenceRisk,activeBinPosition,lowerBufferRatio,upperBufferRatio,immediateOorRisk,dataCompleteness,reasonCodes};
}
