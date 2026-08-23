import type { Phase3OpportunityEconomicsContract, Phase3OpportunityState } from '../../contracts/src/index.js';
import type { PoolAssessment } from '../../pool-intelligence/src/index.js';
import type { RegimeAssessment } from '../../regime/src/index.js';
import type { RegimeHistoryAnalysis } from '../../regime/src/index.js';
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
  evidenceUncertainty:number;
  forecastUncertainty:number;
  forecastUncertaintyComponents:{evidence:number;regimeAmbiguity:number;outcomeDispersion:number;};
  economicallyPositive:boolean;
  reasonCodes:string[];
}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
function prob(r:RegimeAssessment,label:string){return r.probabilities.find((x)=>x.label===label)?.probability??0;}
export interface RegimeAmbiguity {normalizedEntropy:number;topTwoMargin:number;transitionRisk:number;historyTransitionRisk:number;flappingRate:number;shortStability:number;penalty:number;}
/**
 * Regime confidence is a top-label probability across thirteen mutually
 * exclusive labels.  It is not a probability that an LP forecast is correct.
 * This derives an independent ambiguity measure from the distribution shape
 * and observed regime stability, without reusing evidence sample counts.
 */
export function deriveRegimeAmbiguity(regime:RegimeAssessment,history?:Pick<RegimeHistoryAnalysis,'transitionRisk'|'flappingRate'|'stableDurationMinutes'>):RegimeAmbiguity{
 const raw=regime.probabilities.map(x=>Math.max(0,Number(x.probability)||0)),total=raw.reduce((a,b)=>a+b,0),probabilities=total>0?raw.map(x=>x/total):[1],count=Math.max(2,probabilities.length),entropy=-probabilities.reduce((sum,p)=>p>0?sum+p*Math.log(p):sum,0)/Math.log(count),sorted=[...probabilities].sort((a,b)=>b-a),margin=clamp((sorted[0]??0)-(sorted[1]??0)),transitionProbability=clamp(prob(regime,'TRANSITION')),historyTransition=clamp(history?.transitionRisk??regime.transitionRisk),flapping=clamp(history?.flappingRate??0),shortStability=history?clamp(1-history.stableDurationMinutes/60):clamp(1-regime.stability/.20);
 // Entropy and top-two margin capture label ambiguity.  Use the explicit
 // TRANSITION label rather than regime.transitionRisk here: transitionRisk
 // already embeds top-label confidence and margin, which would double count
 // the same uncertainty.  Evidence sample/fidelity penalties remain solely
 // in evidenceUncertainty.
 const penalty=clamp(.18*entropy+.12*(1-margin)+.28*transitionProbability+.25*flapping+.17*shortStability);
 return{normalizedEntropy:entropy,topTwoMargin:margin,transitionRisk:clamp(regime.transitionRisk),historyTransitionRisk:historyTransition,flappingRate:flapping,shortStability,penalty};
}
export interface OutcomeDispersionInput {netValue:number;evidenceActionable?:boolean;}
/**
 * Candidate outcome disagreement is independent of observation provenance:
 * it measures how much admissible range/strategy simulations disagree.  It is
 * deliberately not based on raw capital scale.
 */
export function deriveOutcomeDispersion(outcomes:OutcomeDispersionInput[]):number{
 const values=outcomes.filter(x=>x.evidenceActionable!==false&&Number.isFinite(x.netValue)).map(x=>x.netValue);if(values.length<2)return 0;
 const mean=values.reduce((sum,value)=>sum+value,0)/values.length,variance=values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length,spread=Math.sqrt(variance),relativeSpread=spread/(spread+Math.abs(mean)+1e-12),negativeShare=values.filter(value=>value<0).length/values.length;
 return clamp(.65*relativeSpread+.35*negativeShare);
}
export function estimateOpportunityEconomics(input:{capitalValue:number;horizonMinutes:number;rates:OpportunityRateEvidence;pool:PoolAssessment;regime:RegimeAssessment;structure:StructureFeatureVector;regimeHistory?:Pick<RegimeHistoryAnalysis,'transitionRisk'|'flappingRate'|'stableDurationMinutes'>;outcomeDispersion?:number;}):OpportunityEconomics{
 const {capitalValue, horizonMinutes, rates, pool, regime:r, structure:s}=input;if(!(capitalValue>0)||!(horizonMinutes>0))throw new Error('LPFORGE_OPPORTUNITY_INVALID_CAPITAL_OR_HORIZON');
 const hours=horizonMinutes/60;
 const favorable=clamp(prob(r,'SIDEWAYS')+prob(r,'CONSOLIDATION')+prob(r,'CONTROLLED_PULLBACK')*.8+prob(r,'BREAKOUT_CONTROLLED_PULLBACK')*.65+prob(r,'RECOVERY')*.55);
 const dangerous=clamp(prob(r,'FREEFALL')+prob(r,'TREND_DOWN')*.75+prob(r,'DISTRIBUTION')*.5+prob(r,'EXHAUSTION')*.25);
 const poolEconomic=pool.economicQualityScore/100,flow=pool.flowQualityScore/100,liquidity=pool.liquidityQualityScore/100;
 // This is the forward regime/structure forecast used by the global
 // economics model. It is intentionally distinct from the replay and
 // survival occupancy measurements, which are elapsed-time weighted in
 // elapsed-occupancy. No replay count is substituted into this forecast.
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
 const regimeAmbiguity=deriveRegimeAmbiguity(r,input.regimeHistory),outcomeDispersion=clamp(input.outcomeDispersion??0),uncertainty=clamp(1-(1-clamp(rates.uncertainty))*(1-regimeAmbiguity.penalty)*(1-outcomeDispersion));
 const reasonCodes:string[]=[];if(expectedNetLpValue<=0)reasonCodes.push('EXPECTED_NET_VALUE_NON_POSITIVE');if(dangerous>.35)reasonCodes.push('DANGEROUS_REGIME_MASS_HIGH');if(pool.toxicityProbability>.55)reasonCodes.push('FLOW_TOXICITY_HIGH');if(active<.5)reasonCodes.push('EXPECTED_ACTIVE_TIME_LOW');if(uncertainty>.65)reasonCodes.push('ECONOMIC_FORECAST_UNCERTAIN');
 return{capitalValue,horizonMinutes,expectedFeeValue,expectedRewardValue,expectedInventoryPnl,expectedHodlRelativePnl,expectedExecutionCost,expectedRepositionCost,expectedTailRiskCharge,expectedNetLpValue,uncertainty,evidenceUncertainty:rates.uncertainty,forecastUncertainty:uncertainty,forecastUncertaintyComponents:{evidence:rates.uncertainty,regimeAmbiguity:regimeAmbiguity.penalty,outcomeDispersion},expectedActiveTimeRatio:active,favorableRegimeMass:favorable,dangerousRegimeMass:dangerous,evidenceFidelity:rates.fidelity,evidenceSampleCount:rates.sampleCount,economicallyPositive:expectedNetLpValue>0,reasonCodes};
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
 const reasons:string[]=[];if(input.pool.dataQuality==='BAD'){reasons.push('DATA_QUALITY_BAD');return{state:'DATA_BLOCKED',reasonCodes:reasons};}if(input.pool.eligibility==='BLOCK'){reasons.push(...input.pool.blockers);return{state:'REJECTED',reasonCodes:[...new Set(reasons)].sort()};}if(Date.parse(input.now)>=Date.parse(input.expiresAt)){reasons.push('OPPORTUNITY_EXPIRED');return{state:'EXPIRED',reasonCodes:reasons};}if(!input.economics.economicallyPositive){reasons.push(...input.economics.reasonCodes);return{state:'REJECTED',reasonCodes:[...new Set(reasons)].sort()};}if(input.regime.transitionRisk>.65){reasons.push('REGIME_TRANSITION_RISK_HIGH');return{state:'WATCHING',reasonCodes:reasons};}if(input.economics.forecastUncertainty>.65){reasons.push('ECONOMIC_UNCERTAINTY_HIGH','ECONOMIC_FORECAST_UNCERTAINTY_HIGH');return{state:'WATCHING',reasonCodes:reasons};}if(input.economics.expectedActiveTimeRatio<.5){reasons.push('ACTIVE_TIME_NOT_READY');return{state:'WATCHING',reasonCodes:reasons};}return{state:'QUALIFIED',reasonCodes:['POSITIVE_LP_OPPORTUNITY']};
}
