import type { DeepScreenResult } from '../../pool-deep-screen/src/index.js';
export type DiscoveryStrategy='SPOT_CENTER'|'CURVE_CENTER'|'SOL_BID_ASK';
export interface StrategyDistribution {
  strategy:DiscoveryStrategy;
  expectedNetValue:number;
  medianNetValue:number;
  pProfit:number;
  pLargeLoss:number;
  p05:number;p10:number;p25:number;p50:number;p75:number;p90:number;p95:number;
  expectedShortfall:number;
  survival30m:number;survival1h:number;survival2h:number;survival4h:number;survival6h:number;
  uncertainty:number;
  reasonCodes:string[];
}
export interface StrategyEvaluation {poolAddress:string;observedAt:string;modelVersion:string;strategies:StrategyDistribution[];winner:DiscoveryStrategy|'NO_TRADE';reasonCodes:string[];authority:'RESEARCH_ONLY_NO_EXECUTION';}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const q=(mean:number,sd:number,z:number)=>mean+sd*z;
function strategyFactor(s:DiscoveryStrategy,d:DeepScreenResult){if(s==='SPOT_CENTER')return{fee:1,survival:1-toxicity(d,.65),inventory:1};if(s==='CURVE_CENTER')return{fee:.96,survival:clamp(.15+(1-d.toxicity.directionality)*.55+d.flow.twoWayRatio*.25),inventory:.88};return{fee:.82,survival:clamp(.25+(1-d.toxicity.toxicityProbability)*.50+d.feeSustainability.persistenceScore*.20),inventory:.62}}
function toxicity(d:DeepScreenResult,scale=1){return clamp(d.toxicity.toxicityProbability*scale)}
function survival(base:number,hours:number,halfLife:number|null){const decay=halfLife===null?.25:Math.log(2)/Math.max(1,halfLife/60);return clamp(base*Math.exp(-decay*Math.max(0,hours-.5)*.22))}
export function evaluateDiscoveryStrategies(input:{deep:DeepScreenResult;capitalSol:number;largeLossSol?:number;modelVersion?:string}):StrategyEvaluation{
 const d=input.deep,capital=Math.max(1e-9,input.capitalSol),largeLoss=input.largeLossSol??capital*.2;
 const out:StrategyDistribution[]=(['SPOT_CENTER','CURVE_CENTER','SOL_BID_ASK'] as DiscoveryStrategy[]).map(strategy=>{
   const f=strategyFactor(strategy,d);const feeRate=clamp(d.feeQualityScore/100)*.025*f.fee;const adverse=clamp(d.toxicity.adverseInventoryPressure)*.05*f.inventory;const liquidityPenalty=(1-d.executableLiquidityScore/100)*.012;const uncertainty=clamp((1-d.feeSustainability.persistenceScore)*.35+(d.flow.swaps<5?.25:0)+(d.movement.observations<4?.20:0)+(d.evidenceAvailability.historicalFees!=='AVAILABLE'?.20:0));const mean=capital*(feeRate-adverse-liquidityPenalty-uncertainty*.01);const sd=capital*(.01+.06*d.toxicity.toxicityProbability+.025*uncertainty);const median=mean-sd*.12;const pProfit=clamp(.5+mean/(sd*5));const pLargeLoss=clamp(.5-(largeLoss+mean)/(sd*5));const base=clamp(f.survival*(.55+.45*d.executableLiquidityScore/100));const s30=survival(base,.5,d.opportunityHalfLifeMinutes),s1=survival(base,1,d.opportunityHalfLifeMinutes),s2=survival(base,2,d.opportunityHalfLifeMinutes),s4=survival(base,4,d.opportunityHalfLifeMinutes),s6=survival(base,6,d.opportunityHalfLifeMinutes);
   return{strategy,expectedNetValue:mean,medianNetValue:median,pProfit,pLargeLoss,p05:q(mean,sd,-1.645),p10:q(mean,sd,-1.282),p25:q(mean,sd,-.674),p50:median,p75:q(mean,sd,.674),p90:q(mean,sd,1.282),p95:q(mean,sd,1.645),expectedShortfall:Math.max(0,-q(mean,sd,-2.06)),survival30m:s30,survival1h:s1,survival2h:s2,survival4h:s4,survival6h:s6,uncertainty,reasonCodes:[...(d.toxicity.toxicityProbability>.6?['STRATEGY_TOXICITY_HIGH']:[]),...(s2<.6?['STRATEGY_2H_SURVIVAL_WEAK']:[])]};
 }).sort((a,b)=>b.expectedNetValue-a.expectedNetValue);
 const eligible=out.filter(x=>x.expectedNetValue>0&&x.medianNetValue>0&&x.pProfit>=.58&&x.pLargeLoss<=.12&&x.survival1h>=.55&&x.uncertainty<=.7);
 const winner=eligible[0]?.strategy??'NO_TRADE';return{poolAddress:d.poolAddress,observedAt:d.observedAt,modelVersion:input.modelVersion??'discovery-distributional-ev-v1',strategies:out,winner,reasonCodes:winner==='NO_TRADE'?['DISCOVERY_NO_TRADE_DISTRIBUTION_UNFAVORABLE']:['DISCOVERY_STRATEGY_RESEARCH_WINNER'],authority:'RESEARCH_ONLY_NO_EXECUTION'};
}
