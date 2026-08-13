import type { Phase3RegimeAssessmentContract, Phase3RegimeLabel, ProbabilityEntry } from '../../contracts/src/index.js';
import type { MarketContextSnapshot } from '../../market-context/src/index.js';
import type { StructureFeatureVector } from '../../structure-features/src/index.js';

export interface RegimeInput { context:MarketContextSnapshot; structure:StructureFeatureVector; }
export interface RegimeAssessment extends Phase3RegimeAssessmentContract { rawScores:Record<Phase3RegimeLabel,number>; evidence:Record<string,number|string>; }
export interface RegimeHistorySample { primary:Phase3RegimeLabel; probabilities:ProbabilityEntry[]; confidence:number; stability:number; transitionRisk:number; observedAt:string; }
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const labels:Phase3RegimeLabel[]=['SIDEWAYS','CONSOLIDATION','CONTROLLED_PULLBACK','BREAKOUT','BREAKOUT_CONTROLLED_PULLBACK','TREND_UP','TREND_DOWN','DISTRIBUTION','EXHAUSTION','FREEFALL','RECOVERY','TRANSITION','UNKNOWN'];
function pos(x:number,scale:number){return clamp(x/scale);} function neg(x:number,scale:number){return clamp(-x/scale);} function closeness(x:number,target:number,width:number){return clamp(1-Math.abs(x-target)/width);}
function softmax(scores:Record<Phase3RegimeLabel,number>):ProbabilityEntry[]{const temp=.42;const ex=labels.map((label)=>({label,v:Math.exp(scores[label]/temp)}));const d=ex.reduce((a,b)=>a+b.v,0);return ex.map((x)=>({label:x.label,probability:x.v/d})).sort((a,b)=>b.probability-a.probability);}
export function classifyRegime(input:RegimeInput):RegimeAssessment{
 const {context:c,structure:s}=input,h5=c.horizons['5m'],h15=c.horizons['15m'],h30=c.horizons['30m'],h1=c.horizons['1h'];
 const completeness=Math.min(h15.completeness,h1.completeness);const up1=pos(h1.returnPct,8),dn1=neg(h1.returnPct,8),up15=pos(h15.returnPct,4),dn15=neg(h15.returnPct,4),up5=pos(h5.returnPct,2),dn5=neg(h5.returnPct,2);
 const scores={} as Record<Phase3RegimeLabel,number>;
 scores.SIDEWAYS=.30*closeness(h1.returnPct,0,3)+.25*(1-s.trendEfficiency)+.20*s.flowTwoWay+.15*(1-s.expansionScore)+.10*(1-s.liquidityGapRisk);
 scores.CONSOLIDATION=.38*s.compressionScore+.20*s.flowTwoWay+.15*(1-s.trendEfficiency)+.12*(1-s.downsideAcceleration)+.10*(1-s.upsideAcceleration)+.05*s.structureQuality;
 scores.CONTROLLED_PULLBACK=.25*up1+.15*dn15+.12*closeness(s.retracementDepth,.45,.5)+.15*(1-s.downsideAcceleration)+.12*s.supportIntegrity+.10*s.reclaimScore+.11*s.structureQuality;
 scores.BREAKOUT=.27*s.expansionScore+.22*up5+.14*up15+.15*s.upsideAcceleration+.12*s.trendEfficiency+.10*clamp(h5.netBins/15);
 scores.BREAKOUT_CONTROLLED_PULLBACK=.18*up1+.15*s.impulseStrength+.15*dn15+.12*closeness(s.retracementDepth,.35,.4)+.14*s.reclaimScore+.13*(1-s.downsideAcceleration)+.13*s.supportIntegrity;
 scores.TREND_UP=.30*up1+.20*up15+.20*s.trendEfficiency+.12*clamp(h1.netBins/30)+.10*(1-s.compressionScore)+.08*s.structureQuality;
 scores.TREND_DOWN=.30*dn1+.20*dn15+.20*s.trendEfficiency+.12*clamp(-h1.netBins/30)+.10*(1-s.compressionScore)+.08*(1-s.supportIntegrity);
 scores.DISTRIBUTION=.18*up1+.16*dn15+.16*dn5+.16*(1-s.flowTwoWay)+.12*clamp(-s.flowDirection)+.12*s.downsideAcceleration+.10*s.expansionScore;
 scores.EXHAUSTION=.16*Math.max(up1,dn1)+.18*s.trendEfficiency+.18*(h5.returnPct*h1.returnPct<0?1:0)+.14*s.expansionScore+.12*Math.max(s.downsideAcceleration,s.upsideAcceleration)+.12*(1-s.flowTwoWay)+.10*clamp(h15.realizedVolatility/1.5);
 scores.FREEFALL=.24*dn5+.22*dn15+.14*dn1+.16*s.downsideAcceleration+.10*clamp(-s.flowDirection)+.08*s.liquidityGapRisk+.06*s.trendEfficiency;
 scores.RECOVERY=.22*dn1+.22*up5+.16*up15+.14*s.reclaimScore+.10*s.supportIntegrity+.08*s.flowTwoWay+.08*(1-s.downsideAcceleration);
 const mixed=(Math.sign(h5.returnPct)!==Math.sign(h15.returnPct)||Math.sign(h15.returnPct)!==Math.sign(h1.returnPct))?1:0;
 scores.TRANSITION=.28*mixed+.18*s.expansionScore+.14*(1-s.trendEfficiency)+.12*Math.abs(s.binVelocityAcceleration)/(Math.abs(s.binVelocityAcceleration)+5)+.14*(1-s.structureQuality)+.14*(1-s.flowTwoWay);
 scores.UNKNOWN=clamp((1-completeness)*.8+(c.sourceObservationCount<5?.5:0));
 const probabilities=softmax(scores),primary=probabilities[0]?.label??'UNKNOWN',confidence=probabilities[0]?.probability??0,second=probabilities[1]?.probability??0;
 const transitionRisk=clamp((probabilities.find((x)=>x.label==='TRANSITION')?.probability??0)+(1-confidence)*.35+(confidence-second<.08?.15:0));
 const reasonCodes=[...s.reasonCodes];if(completeness<.6)reasonCodes.push('REGIME_DATA_INCOMPLETE');if(confidence<.22)reasonCodes.push('REGIME_LOW_CONFIDENCE');if(primary==='FREEFALL')reasonCodes.push('REGIME_FREEFALL');if(primary==='CONTROLLED_PULLBACK')reasonCodes.push('REGIME_CONTROLLED_PULLBACK');
 return{primary,probabilities,confidence,stability:clamp(confidence-second),transitionRisk,observedAt:c.decisionAt,reasonCodes:[...new Set(reasonCodes)].sort(),rawScores:scores,evidence:{return5m:h5.returnPct,return15m:h15.returnPct,return1h:h1.returnPct,trendEfficiency:s.trendEfficiency,retracementDepth:s.retracementDepth,compressionScore:s.compressionScore,expansionScore:s.expansionScore,downsideAcceleration:s.downsideAcceleration,reclaimScore:s.reclaimScore,flowTwoWay:s.flowTwoWay,completeness}};
}

export interface RegimeHistoryAnalysis {
  samples:number;
  labelChanges:number;
  flappingRate:number;
  meanProbabilityDrift:number;
  stableDurationMinutes:number;
  continuityBreaks:number;
  continuityFingerprint:string;
  downsideTransitionRisk:number;
  recoveryLikelihood:number;
  transitionRisk:number;
}
function probabilityMap(a:RegimeHistorySample):Map<Phase3RegimeLabel,number>{return new Map(a.probabilities.map((p)=>[p.label,p.probability]));}
function probabilityDrift(a:RegimeHistorySample,b:RegimeHistorySample):number{const am=probabilityMap(a),bm=probabilityMap(b);return labels.reduce((s,l)=>s+Math.abs((am.get(l)??0)-(bm.get(l)??0)),0)/2;}
function quantizedFingerprint(a:RegimeHistorySample):string{return a.probabilities.slice(0,4).map((p)=>`${p.label}:${Math.round(p.probability*10)}`).sort().join('|');}
export function analyzeRegimeHistory(history:RegimeHistorySample[]):RegimeHistoryAnalysis{
  const s=[...history].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
  if(!s.length)return{samples:0,labelChanges:0,flappingRate:0,meanProbabilityDrift:0,stableDurationMinutes:0,continuityBreaks:0,continuityFingerprint:'EMPTY',downsideTransitionRisk:1,recoveryLikelihood:0,transitionRisk:1};
  let labelChanges=0,driftSum=0,continuityBreaks=0,lastBreakAt=Date.parse(s[0]!.observedAt);
  for(let i=1;i<s.length;i++){const prev=s[i-1]!,cur=s[i]!;if(prev.primary!==cur.primary)labelChanges++;const d=probabilityDrift(prev,cur);driftSum+=d;if(d>.35){continuityBreaks++;lastBreakAt=Date.parse(cur.observedAt);}}
  const current=s.at(-1)!,pm=probabilityMap(current),meanDrift=s.length>1?driftSum/(s.length-1):0;
  const spanMinutes=Math.max((Date.parse(current.observedAt)-Date.parse(s[0]!.observedAt))/60000,0);const stableDurationMinutes=Math.max((Date.parse(current.observedAt)-lastBreakAt)/60000,0);
  const flappingRate=s.length>1?labelChanges/(s.length-1):0;
  const downsideBase=(pm.get('FREEFALL')??0)+(pm.get('TREND_DOWN')??0)*.7+(pm.get('DISTRIBUTION')??0)*.45;
  const recoveryBase=(pm.get('RECOVERY')??0)+(pm.get('CONTROLLED_PULLBACK')??0)*.45+(pm.get('BREAKOUT_CONTROLLED_PULLBACK')??0)*.4;
  return{samples:s.length,labelChanges,flappingRate,meanProbabilityDrift:meanDrift,stableDurationMinutes:Math.min(stableDurationMinutes,spanMinutes),continuityBreaks,continuityFingerprint:quantizedFingerprint(current),downsideTransitionRisk:clamp(downsideBase+meanDrift*.25+flappingRate*.12),recoveryLikelihood:clamp(recoveryBase*(1-meanDrift*.35)),transitionRisk:clamp(current.transitionRisk+meanDrift*.35+flappingRate*.15)};
}
