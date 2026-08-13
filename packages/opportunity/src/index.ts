import type { Phase3OpportunityEconomicsContract, Phase3OpportunityState } from '../../contracts/src/index.js';
import type { PoolAssessment } from '../../pool-intelligence/src/index.js';
import type { RegimeAssessment } from '../../regime/src/index.js';
import type { StructureFeatureVector } from '../../structure-features/src/index.js';

export interface OpportunityRateEvidence {
  feeRatePerCapitalHour:number;
  rewardRatePerCapitalHour?:number;
  adverseInventoryRatePerCapitalHour:number;
  repositionRatePerCapitalHour:number;
  tailRiskRatePerCapitalHour:number;
  executionCostFixed:number;
  sampleCount:number;
  uncertainty:number;
  fidelity:'ONCHAIN_POSITION'|'BIN_SHARE_REPLAY'|'EVENT_PATH_ESTIMATE'|'AGGREGATE_ESTIMATE';
}
export interface OpportunityEconomics extends Phase3OpportunityEconomicsContract {
  capitalValue:number;
  expectedActiveTimeRatio:number;
  favorableRegimeMass:number;
  dangerousRegimeMass:number;
  evidenceFidelity:OpportunityRateEvidence['fidelity'];
  evidenceSampleCount:number;
  economicallyPositive:boolean;
  reasonCodes:string[];
}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
function prob(r:RegimeAssessment,label:string){return r.probabilities.find((x)=>x.label===label)?.probability??0;}
export function estimateOpportunityEconomics(input:{capitalValue:number;horizonMinutes:number;rates:OpportunityRateEvidence;pool:PoolAssessment;regime:RegimeAssessment;structure:StructureFeatureVector;}):OpportunityEconomics{
 const {capitalValue, horizonMinutes, rates, pool, regime:r, structure:s}=input;if(!(capitalValue>0)||!(horizonMinutes>0))throw new Error('LPFORGE_OPPORTUNITY_INVALID_CAPITAL_OR_HORIZON');
 const hours=horizonMinutes/60;
 const favorable=clamp(prob(r,'SIDEWAYS')+prob(r,'CONSOLIDATION')+prob(r,'CONTROLLED_PULLBACK')*.8+prob(r,'BREAKOUT_CONTROLLED_PULLBACK')*.65+prob(r,'RECOVERY')*.55);
 const dangerous=clamp(prob(r,'FREEFALL')+prob(r,'TREND_DOWN')*.75+prob(r,'DISTRIBUTION')*.5+prob(r,'EXHAUSTION')*.25);
 const poolEconomic=pool.economicQualityScore/100,flow=pool.flowQualityScore/100,liquidity=pool.liquidityQualityScore/100;
 const active=clamp(.20+.38*favorable+.18*flow+.14*liquidity+.10*s.structureQuality-.32*dangerous-.12*r.transitionRisk);
 const feeMultiplier=clamp(.35+.35*poolEconomic+.20*flow+.10*active,.2,1.2);
 const riskMultiplier=clamp(.55+.75*dangerous+.35*s.downsideAcceleration+.25*r.transitionRisk+.25*pool.toxicityProbability,.4,2.2);
 const expectedFeeValue=capitalValue*rates.feeRatePerCapitalHour*hours*active*feeMultiplier;
 const expectedRewardValue=capitalValue*(rates.rewardRatePerCapitalHour??0)*hours*active;
 const expectedInventoryPnl=-capitalValue*rates.adverseInventoryRatePerCapitalHour*hours*riskMultiplier;
 const expectedHodlRelativePnl=expectedInventoryPnl-capitalValue*.002*hours*dangerous;
 const expectedExecutionCost=Math.max(0,rates.executionCostFixed);
 const expectedRepositionCost=capitalValue*rates.repositionRatePerCapitalHour*hours*clamp((1-active)+r.transitionRisk);
 const expectedTailRiskCharge=capitalValue*rates.tailRiskRatePerCapitalHour*hours*clamp(.5+dangerous+r.transitionRisk);
 const expectedNetLpValue=expectedFeeValue+expectedRewardValue+expectedInventoryPnl-expectedExecutionCost-expectedRepositionCost-expectedTailRiskCharge;
 const uncertainty=clamp(rates.uncertainty+.25*(1-r.confidence)+.2*(1-Math.min(1,rates.sampleCount/50))+.15*(rates.fidelity==='AGGREGATE_ESTIMATE'?1:rates.fidelity==='EVENT_PATH_ESTIMATE'?.6:.2));
 const reasonCodes:string[]=[];if(expectedNetLpValue<=0)reasonCodes.push('EXPECTED_NET_VALUE_NON_POSITIVE');if(dangerous>.35)reasonCodes.push('DANGEROUS_REGIME_MASS_HIGH');if(pool.toxicityProbability>.55)reasonCodes.push('FLOW_TOXICITY_HIGH');if(active<.5)reasonCodes.push('EXPECTED_ACTIVE_TIME_LOW');if(uncertainty>.65)reasonCodes.push('ECONOMIC_FORECAST_UNCERTAIN');
 return{capitalValue,horizonMinutes,expectedFeeValue,expectedRewardValue,expectedInventoryPnl,expectedHodlRelativePnl,expectedExecutionCost,expectedRepositionCost,expectedTailRiskCharge,expectedNetLpValue,uncertainty,expectedActiveTimeRatio:active,favorableRegimeMass:favorable,dangerousRegimeMass:dangerous,evidenceFidelity:rates.fidelity,evidenceSampleCount:rates.sampleCount,economicallyPositive:expectedNetLpValue>0,reasonCodes};
}

export interface OpportunityRecord { id:string; state:Phase3OpportunityState; observedAt:string; expiresAt:string; reasonCodes:string[]; economics:OpportunityEconomics; }

export type OpportunityEvent='SCREEN'|'QUALIFY'|'WATCH'|'ARM'|'READY'|'REJECT'|'EXPIRE'|'INVALIDATE'|'DATA_BLOCK'|'RISK_BLOCK';
const transitionMap:Record<Phase3OpportunityState,Partial<Record<OpportunityEvent,Phase3OpportunityState>>>={
 DISCOVERED:{SCREEN:'SCREENED',REJECT:'REJECTED',DATA_BLOCK:'DATA_BLOCKED'},
 SCREENED:{QUALIFY:'QUALIFIED',WATCH:'WATCHING',REJECT:'REJECTED',DATA_BLOCK:'DATA_BLOCKED',RISK_BLOCK:'RISK_BLOCKED',EXPIRE:'EXPIRED'},
 QUALIFIED:{WATCH:'WATCHING',ARM:'ARMED',REJECT:'REJECTED',INVALIDATE:'INVALIDATED',DATA_BLOCK:'DATA_BLOCKED',RISK_BLOCK:'RISK_BLOCKED',EXPIRE:'EXPIRED'},
 WATCHING:{ARM:'ARMED',REJECT:'REJECTED',INVALIDATE:'INVALIDATED',DATA_BLOCK:'DATA_BLOCKED',RISK_BLOCK:'RISK_BLOCKED',EXPIRE:'EXPIRED'},
 ARMED:{READY:'ENTRY_READY',WATCH:'WATCHING',INVALIDATE:'INVALIDATED',DATA_BLOCK:'DATA_BLOCKED',RISK_BLOCK:'RISK_BLOCKED',EXPIRE:'EXPIRED'},
 ENTRY_READY:{WATCH:'WATCHING',INVALIDATE:'INVALIDATED',DATA_BLOCK:'DATA_BLOCKED',RISK_BLOCK:'RISK_BLOCKED',EXPIRE:'EXPIRED'},
 REJECTED:{},EXPIRED:{},INVALIDATED:{},DATA_BLOCKED:{},RISK_BLOCKED:{}
};
export interface OpportunityTransition {from:Phase3OpportunityState;to:Phase3OpportunityState;event:OpportunityEvent;at:string;reasonCodes:string[];recommendationOnly:true;}
export function transitionOpportunity(state:Phase3OpportunityState,event:OpportunityEvent,at:string,reasonCodes:string[]=[]):OpportunityTransition{
 const to=transitionMap[state][event];if(!to)throw new Error(`LPFORGE_OPPORTUNITY_ILLEGAL_TRANSITION:${state}:${event}`);return{from:state,to,event,at,reasonCodes:[...new Set(reasonCodes)].sort(),recommendationOnly:true};
}
export function deriveOpportunityProgress(input:{pool:PoolAssessment;economics:OpportunityEconomics;regime:RegimeAssessment;now:string;expiresAt:string;}):{state:Phase3OpportunityState;reasonCodes:string[]}{
 const reasons:string[]=[];if(input.pool.dataQuality==='BAD'){reasons.push('DATA_QUALITY_BAD');return{state:'DATA_BLOCKED',reasonCodes:reasons};}if(input.pool.eligibility==='BLOCK'){reasons.push(...input.pool.blockers);return{state:'REJECTED',reasonCodes:[...new Set(reasons)].sort()};}if(Date.parse(input.now)>=Date.parse(input.expiresAt)){reasons.push('OPPORTUNITY_EXPIRED');return{state:'EXPIRED',reasonCodes:reasons};}if(!input.economics.economicallyPositive){reasons.push(...input.economics.reasonCodes);return{state:'REJECTED',reasonCodes:[...new Set(reasons)].sort()};}if(input.regime.transitionRisk>.65){reasons.push('REGIME_TRANSITION_RISK_HIGH');return{state:'WATCHING',reasonCodes:reasons};}if(input.economics.uncertainty>.65){reasons.push('ECONOMIC_UNCERTAINTY_HIGH');return{state:'WATCHING',reasonCodes:reasons};}if(input.economics.expectedActiveTimeRatio<.5){reasons.push('ACTIVE_TIME_NOT_READY');return{state:'WATCHING',reasonCodes:reasons};}return{state:'QUALIFIED',reasonCodes:['POSITIVE_LP_OPPORTUNITY']};
}
