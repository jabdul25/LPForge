import { assertNoLookahead } from '../../research/src/index.js';
export type EntryDelayOption='ENTER_NOW'|'WAIT_5M'|'WAIT_15M'|'WAIT_30M'|'WAIT_FOR_RECLAIM'|'WAIT_FOR_VOLATILITY_DECAY'|'NO_TRADE';
export interface EntryDelayForecast {option:Exclude<EntryDelayOption,'NO_TRADE'>;observedAt:string;delayMinutes:number;conditionalProbability:number;expectedNetLpValue:number;expectedSurvival:number;expectedActiveTime:number;readiness:number;missedFeeCost:number;expiryRisk:number;uncertainty:number;}
export interface EntryDelayRanking {winner:EntryDelayOption;rankings:Array<EntryDelayForecast&{utility:number}>;reasonCodes:string[];}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
export function evaluateEntryDelay(decisionAt:string,forecasts:EntryDelayForecast[]):EntryDelayRanking{
 assertNoLookahead(decisionAt,forecasts);
 const rankings=forecasts.map((f)=>{const opportunity=clamp(f.conditionalProbability)*(1-clamp(f.expiryRisk));const quality=.45*clamp(f.expectedSurvival)+.30*clamp(f.expectedActiveTime)+.25*clamp(f.readiness);const riskDiscount=1-.45*clamp(f.uncertainty);const utility=(f.expectedNetLpValue-f.missedFeeCost)*opportunity*quality*riskDiscount;return{...f,utility};}).sort((a,b)=>b.utility-a.utility||a.delayMinutes-b.delayMinutes);
 const best=rankings[0];if(!best||best.utility<=0)return{winner:'NO_TRADE',rankings,reasonCodes:['ENTRY_DELAY_NO_TRADE_DOMINATES']};
 const reasonCodes=[best.option==='ENTER_NOW'?'ENTRY_NOW_DOMINATES':'ENTRY_DELAY_DOMINATES'];
 return{winner:best.option,rankings,reasonCodes};
}
