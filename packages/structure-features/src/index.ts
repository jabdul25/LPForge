import type { BinWindowFeatures, SwapFlowFeatures } from '../../features/src/index.js';
import type { MarketContextSnapshot, MarketObservation } from '../../market-context/src/index.js';

export interface StructureFeatureVector {
  trendDirection:-1|0|1;
  trendEfficiency:number;
  impulseStrength:number;
  retracementDepth:number;
  compressionScore:number;
  expansionScore:number;
  supportIntegrity:number;
  reclaimScore:number;
  downsideAcceleration:number;
  upsideAcceleration:number;
  binVelocityAcceleration:number;
  flowTwoWay:number;
  flowDirection:number;
  liquidityGapRisk:number;
  liquiditySkewAbs:number;
  volatilityState:'LOW'|'MODERATE'|'HIGH'|'EXTREME';
  structureQuality:number;
  reasonCodes:string[];
}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
function sign3(x:number,dead=.05):-1|0|1{return x>dead?1:x<-dead?-1:0;}
export function computeStructureFeatures(input:{context:MarketContextSnapshot;observations:MarketObservation[];bin?:BinWindowFeatures;flow?:SwapFlowFeatures;}):StructureFeatureVector{
  const h5=input.context.horizons['5m'],h15=input.context.horizons['15m'],h30=input.context.horizons['30m'],h1=input.context.horizons['1h'];
  const trendDirection=sign3(h1.returnPct);
  const trendEfficiency=clamp(.55*h1.directionalEfficiency+.45*h30.directionalEfficiency);
  const impulseStrength=clamp((Math.abs(h15.returnPct)/5)*.45+(h15.directionalEfficiency)*.30+(h15.binVelocityPerMinute/10)*.25);
  const rows=[...input.observations].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));const prices=rows.map((x)=>x.price).filter((x)=>Number.isFinite(x)&&x>0);const current=prices.at(-1)??0;const hi=prices.length?Math.max(...prices):current,lo=prices.length?Math.min(...prices):current;
  const span=Math.max(hi-lo,Number.EPSILON);
  const retracementDepth=trendDirection>=0?clamp((hi-current)/span):clamp((current-lo)/span);
  const rangeRatio=h15.priceRangePct>0?h5.priceRangePct/h15.priceRangePct:1;
  const volRatio=h15.realizedVolatility>0?h5.realizedVolatility/h15.realizedVolatility:1;
  const compressionScore=clamp(1-(.6*clamp(rangeRatio)+.4*clamp(volRatio)));
  const expansionScore=clamp(.55*clamp(rangeRatio/1.2)+.45*clamp(volRatio/1.2));
  const supportIntegrity=trendDirection>=0?clamp((current-lo)/span):clamp((hi-current)/span);
  const reclaimScore=trendDirection>=0?clamp((current-(lo+span*.35))/(span*.65)):clamp(((hi-span*.35)-current)/(span*.65));
  const binVelocityAcceleration=h5.binVelocityPerMinute-h15.binVelocityPerMinute;
  const downsideAcceleration=clamp((Math.max(0,-h5.returnPct)-Math.max(0,-h15.returnPct/3))/3 + Math.max(0,-h5.netBins)/20 + Math.max(0,binVelocityAcceleration)/20*(h5.netBins<0?1:0));
  const upsideAcceleration=clamp((Math.max(0,h5.returnPct)-Math.max(0,h15.returnPct/3))/3 + Math.max(0,h5.netBins)/20 + Math.max(0,binVelocityAcceleration)/20*(h5.netBins>0?1:0));
  const flowTwoWay=clamp(input.flow?.twoWayRatio??h15.twoWayRatioMean??.5),flowDirection=clamp((input.flow?.netDirection??0)*.5+.5)*2-1;
  const liquidityGapRisk=clamp(((input.bin?.maxConsecutiveEmpty??0)/8)*.7+(1-(input.bin?.nonEmptyRatio??.7))*.3);
  const liquiditySkewAbs=clamp(Math.abs(input.bin?.liquiditySkew??0));
  const rv=h15.realizedVolatility;const volatilityState=rv<.15?'LOW':rv<.5?'MODERATE':rv<1.5?'HIGH':'EXTREME';
  const structureQuality=clamp(.25*trendEfficiency+.20*supportIntegrity+.20*flowTwoWay+.15*(1-liquidityGapRisk)+.10*(1-clamp(Math.abs(binVelocityAcceleration)/20))+.10*(1-clamp(h15.maxDrawdownPct*-1/15)));
  const reasonCodes:string[]=[];if(compressionScore>.6)reasonCodes.push('STRUCTURE_COMPRESSION');if(expansionScore>.7)reasonCodes.push('STRUCTURE_EXPANSION');if(downsideAcceleration>.55)reasonCodes.push('DOWNSIDE_ACCELERATING');if(upsideAcceleration>.55)reasonCodes.push('UPSIDE_ACCELERATING');if(flowTwoWay<.3)reasonCodes.push('FLOW_ONE_WAY');if(liquidityGapRisk>.5)reasonCodes.push('LIQUIDITY_GAPS');if(reclaimScore>.65)reasonCodes.push('RECLAIM_EVIDENCE');
  return{trendDirection,trendEfficiency,impulseStrength,retracementDepth,compressionScore,expansionScore,supportIntegrity,reclaimScore,downsideAcceleration,upsideAcceleration,binVelocityAcceleration,flowTwoWay,flowDirection,liquidityGapRisk,liquiditySkewAbs,volatilityState,structureQuality,reasonCodes};
}
