import type { MarketContextSnapshot } from '../../market-context/src/index.js';
import type { StructureFeatureVector } from '../../structure-features/src/index.js';
import type { RegimeAssessment } from '../../regime/src/index.js';
import type { Phase3Orientation, Phase3StrategyFamily } from '../../contracts/src/index.js';

export interface RangeGeometryCandidate {id:string;family:'NARROW'|'BASE'|'WIDE'|'DEFENSIVE';lowerBinId:number;upperBinId:number;centerBinId:number;widthBins:number;lowerOffsetBins:number;upperOffsetBins:number;lowerDistancePct:number;upperDistancePct:number;reasonCodes:string[];}
export interface RangeUniverse {activeBinId:number;binStep:number;horizonMinutes:number;candidates:RangeGeometryCandidate[];movementBasisBins:number;volatilityMultiplier:number;}
const clamp=(x:number,min:number,max:number)=>Math.max(min,Math.min(max,x));
function pctForOffset(binStep:number,offset:number):number{return (Math.pow(1+binStep/10000,offset)-1)*100;}
function oddWidth(x:number){const n=Math.max(3,Math.round(x));return n%2===0?n+1:n;}
export function generateRangeUniverse(input:{activeBinId:number;binStep:number;horizonMinutes:number;context:MarketContextSnapshot;structure:StructureFeatureVector;regime:RegimeAssessment;maxWidthBins?:number;minWidthBins?:number;}):RangeUniverse{
 const maxWidth=Math.min(1400,input.maxWidthBins??1400),minWidth=Math.max(3,input.minWidthBins??11);if(input.binStep<=0)throw new Error('LPFORGE_RANGE_INVALID_BIN_STEP');
 const h15=input.context.horizons['15m'],h1=input.context.horizons['1h'];const horizonScale=Math.sqrt(Math.max(input.horizonMinutes,15)/60);const rawMove=Math.max(4,h15.absoluteBins*2,h1.absoluteBins*horizonScale*.75,h1.binVelocityPerMinute*input.horizonMinutes*.55);
 const volMult=input.structure.volatilityState==='EXTREME'?1.8:input.structure.volatilityState==='HIGH'?1.4:input.structure.volatilityState==='MODERATE'?1.15:.9;const transitionMult=1+input.regime.transitionRisk*.45;const movementBasis=Math.max(4,rawMove*volMult*transitionMult);
 const families=[['NARROW',.75],['BASE',1],['WIDE',1.4],['DEFENSIVE',1.9]] as const;const candidates:RangeGeometryCandidate[]=[];
 for(const [family,m] of families){let width=oddWidth(clamp(movementBasis*m*2+1,minWidth,maxWidth));const half=Math.floor(width/2);const direction=input.structure.trendDirection;const skewStrength=clamp((input.structure.trendEfficiency*.4+Math.abs(input.context.horizons['15m'].returnPct)/10)*.6,0,.35);let lowerHalf=half,upperHalf=half;if(direction>0){upperHalf=Math.round(half*(1+skewStrength));lowerHalf=Math.max(1,width-1-upperHalf);}else if(direction<0){lowerHalf=Math.round(half*(1+skewStrength));upperHalf=Math.max(1,width-1-lowerHalf);}width=lowerHalf+upperHalf+1;if(width>maxWidth){const overflow=width-maxWidth;lowerHalf=Math.max(1,lowerHalf-Math.ceil(overflow/2));upperHalf=Math.max(1,upperHalf-Math.floor(overflow/2));width=lowerHalf+upperHalf+1;}
  const lowerOffset=-lowerHalf,upperOffset=upperHalf;const reasons=[`RANGE_FAMILY_${family}`,`VOLATILITY_${input.structure.volatilityState}`];if(input.regime.transitionRisk>.4)reasons.push('TRANSITION_RISK_WIDENING');if(direction!==0)reasons.push('DIRECTIONAL_ASYMMETRY');candidates.push({id:`${family.toLowerCase()}-${width}-${lowerHalf}-${upperHalf}`,family,lowerBinId:input.activeBinId+lowerOffset,upperBinId:input.activeBinId+upperOffset,centerBinId:input.activeBinId,widthBins:width,lowerOffsetBins:lowerOffset,upperOffsetBins:upperOffset,lowerDistancePct:pctForOffset(input.binStep,lowerOffset),upperDistancePct:pctForOffset(input.binStep,upperOffset),reasonCodes:reasons});}
 const unique=[...new Map(candidates.map((c)=>[`${c.lowerBinId}:${c.upperBinId}`,c])).values()].sort((a,b)=>a.widthBins-b.widthBins);return{activeBinId:input.activeBinId,binStep:input.binStep,horizonMinutes:input.horizonMinutes,candidates:unique,movementBasisBins:movementBasis,volatilityMultiplier:volMult};
}

// P3-11+ types live here so range construction stays in one domain package.
export interface RangeStrategyCandidate extends RangeGeometryCandidate {strategy:Phase3StrategyFamily;orientation:Phase3Orientation;capitalFraction:number;perBinWeights:Array<{binId:number;weight:number}>;}

function normalizeWeights(rows:Array<{binId:number;weight:number}>):Array<{binId:number;weight:number}>{const total=rows.reduce((a,b)=>a+b.weight,0);if(total<=0)throw new Error('LPFORGE_RANGE_WEIGHTS_ZERO');return rows.map((x)=>({binId:x.binId,weight:x.weight/total}));}
export function buildStrategyWeights(candidate:RangeGeometryCandidate,strategy:Phase3StrategyFamily):Array<{binId:number;weight:number}>{
 const bins=Array.from({length:candidate.widthBins},(_,i)=>candidate.lowerBinId+i);const maxDistance=Math.max(1,Math.max(candidate.centerBinId-candidate.lowerBinId,candidate.upperBinId-candidate.centerBinId));
 const rows=bins.map((binId)=>{const d=Math.abs(binId-candidate.centerBinId)/maxDistance;const weight=strategy==='SPOT'?1:strategy==='CURVE'?Math.max(.08,1-d*.92):Math.max(.08,.12+d*.88);return{binId,weight};});return normalizeWeights(rows);
}
export function generateStrategyCandidates(input:{universe:RangeUniverse;strategies?:Phase3StrategyFamily[];orientations?:Phase3Orientation[];capitalFractions?:number[]}):RangeStrategyCandidate[]{
 const strategies=input.strategies??['SPOT','CURVE','BID_ASK'],orientations=input.orientations??['BALANCED'],fractions=input.capitalFractions??[1];const out:RangeStrategyCandidate[]=[];
 for(const g of input.universe.candidates)for(const strategy of strategies)for(const orientation of orientations)for(const capitalFraction of fractions){if(!(capitalFraction>0&&capitalFraction<=1))throw new Error('LPFORGE_RANGE_CAPITAL_FRACTION');const perBinWeights=buildStrategyWeights(g,strategy);out.push({...g,id:`${g.id}-${strategy.toLowerCase()}-${orientation.toLowerCase()}-${Math.round(capitalFraction*1000)}`,strategy,orientation,capitalFraction,perBinWeights});}
 return out;
}
