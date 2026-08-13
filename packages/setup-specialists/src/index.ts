import type { MarketContextSnapshot } from '../../market-context/src/index.js';
import type { StructureFeatureVector } from '../../structure-features/src/index.js';
import type { RegimeAssessment, RegimeHistoryAnalysis } from '../../regime/src/index.js';

export type PullbackSetup='CONTROLLED_PULLBACK'|'BREAKOUT_CONTROLLED_PULLBACK';
export interface PullbackSpecialistAssessment {
  setup:PullbackSetup;
  qualified:boolean;
  maturity:number;
  continuationRisk:number;
  recoveryProbability:number;
  supportIntegrity:number;
  precedingImpulse:number;
  stabilization:number;
  blockers:string[];
  warnings:string[];
  evidence:Record<string,number|string|boolean>;
}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
export function assessControlledPullback(input:{context:MarketContextSnapshot;structure:StructureFeatureVector;regime:RegimeAssessment;history?:RegimeHistoryAnalysis;}):PullbackSpecialistAssessment{
 const {context:c,structure:s,regime:r}=input,h5=c.horizons['5m'],h15=c.horizons['15m'],h1=c.horizons['1h'];const blockers:string[]=[],warnings:string[]=[];
 const precedingImpulse=clamp(.45*Math.max(0,h1.returnPct)/8+.35*s.impulseStrength+.20*s.trendEfficiency);
 const retracementFit=clamp(1-Math.abs(s.retracementDepth-.42)/.48);
 const stabilization=clamp(.30*(1-s.downsideAcceleration)+.22*s.reclaimScore+.18*s.supportIntegrity+.15*s.flowTwoWay+.15*(h5.returnPct>=h15.returnPct/3?1:0));
 const freefall=r.probabilities.find(x=>x.label==='FREEFALL')?.probability??0; const down=r.probabilities.find(x=>x.label==='TREND_DOWN')?.probability??0;
 const continuationRisk=clamp(.30*freefall+.20*down+.20*s.downsideAcceleration+.12*(1-s.supportIntegrity)+.10*(1-s.flowTwoWay)+.08*s.liquidityGapRisk);
 const recoveryProbability=clamp(.32*stabilization+.22*precedingImpulse+.18*retracementFit+.15*s.structureQuality+.13*(1-continuationRisk));
 const maturity=clamp(.30*retracementFit+.30*stabilization+.20*s.reclaimScore+.20*(1-s.downsideAcceleration));
 if(precedingImpulse<.28)blockers.push('PULLBACK_NO_VALID_PRECEDING_IMPULSE');if(s.retracementDepth<.08)blockers.push('PULLBACK_TOO_SHALLOW');if(s.retracementDepth>.92)blockers.push('PULLBACK_STRUCTURE_BROKEN');if(s.downsideAcceleration>.70)blockers.push('PULLBACK_DOWNSIDE_ACCELERATING');if(freefall>.22)blockers.push('PULLBACK_FREEFALL_RISK');if(s.supportIntegrity<.20)blockers.push('PULLBACK_SUPPORT_FAILED');if(s.flowTwoWay<.20)warnings.push('PULLBACK_FLOW_ONE_WAY');if(maturity<.5)warnings.push('PULLBACK_NOT_MATURE');
 return{setup:'CONTROLLED_PULLBACK',qualified:blockers.length===0&&maturity>=.5&&recoveryProbability>=.5,maturity,continuationRisk,recoveryProbability,supportIntegrity:s.supportIntegrity,precedingImpulse,stabilization,blockers,warnings,evidence:{return5m:h5.returnPct,return15m:h15.returnPct,return1h:h1.returnPct,retracementDepth:s.retracementDepth,downsideAcceleration:s.downsideAcceleration,reclaimScore:s.reclaimScore,freefallProbability:freefall}};
}
export function assessBreakoutControlledPullback(input:{context:MarketContextSnapshot;structure:StructureFeatureVector;regime:RegimeAssessment;history?:RegimeHistoryAnalysis;}):PullbackSpecialistAssessment{
 const base=assessControlledPullback(input),{context:c,structure:s}=input,h30=c.horizons['30m'];const blockers=[...base.blockers],warnings=[...base.warnings];
 const breakoutOrigin=clamp(.35*s.impulseStrength+.25*s.expansionScore+.20*Math.max(0,h30.returnPct)/6+.20*s.trendEfficiency);
 if(breakoutOrigin<.35)blockers.push('BREAKOUT_PULLBACK_NO_BREAKOUT_ORIGIN');
 if(s.reclaimScore<.28)warnings.push('BREAKOUT_PULLBACK_RECLAIM_WEAK');
 const maturity=clamp(.65*base.maturity+.20*breakoutOrigin+.15*s.reclaimScore),continuationRisk=clamp(base.continuationRisk+.15*(1-breakoutOrigin)),recoveryProbability=clamp(.70*base.recoveryProbability+.20*breakoutOrigin+.10*s.reclaimScore);
 return{...base,setup:'BREAKOUT_CONTROLLED_PULLBACK',qualified:blockers.length===0&&maturity>=.52&&recoveryProbability>=.52,maturity,continuationRisk,recoveryProbability,precedingImpulse:Math.max(base.precedingImpulse,breakoutOrigin),blockers:[...new Set(blockers)],warnings:[...new Set(warnings)],evidence:{...base.evidence,breakoutOrigin}};
}
