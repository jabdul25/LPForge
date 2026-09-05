import type { MarketContextSnapshot } from '../../market-context/src/index.js';
import type { StructureFeatureVector } from '../../structure-features/src/index.js';
import type { RegimeAssessment } from '../../regime/src/index.js';
import type { Phase3Orientation, Phase3StrategyFamily } from '../../contracts/src/index.js';

export interface RangeGeometryCandidate {id:string;family:'NARROW'|'BASE'|'WIDE'|'DEFENSIVE';lowerBinId:number;upperBinId:number;centerBinId:number;widthBins:number;lowerOffsetBins:number;upperOffsetBins:number;lowerDistancePct:number;upperDistancePct:number;reasonCodes:string[];}
export interface RangeUniverse {activeBinId:number;binStep:number;horizonMinutes:number;candidates:RangeGeometryCandidate[];movementBasisBins:number;volatilityMultiplier:number;minimumIncludedBins:number;volatilityRequiredWidthBins:number;survivalHorizonRequiredWidthBins:number;finalMinimumWidthBins:number;}
const clamp=(x:number,min:number,max:number)=>Math.max(min,Math.min(max,x));
function pctForOffset(binStep:number,offset:number):number{return (Math.pow(1+binStep/10000,offset)-1)*100;}
/**
 * PositionV2 supports up to 1,400 bins.  The SDK's one-shot initializer only
 * handles 70; wider positions use createExtendedEmptyPosition followed by
 * addLiquidityByStrategyChunkable in the execution boundary.
 */
export const METEORA_PROTOCOL_MAX_POSITION_WIDTH_BINS=1400;
/** LPForge's policy default. Production supplies its explicit policy cap. */
export const DEFAULT_LPFORGE_MAX_POSITION_WIDTH_BINS=100;
/**
 * Phase-3 replays a fixed historical LP position, while bin snapshots are
 * centered on the then-current active bin.  This derives the collection
 * envelope from the same executable-width policy as RangeForge:
 *
 * - the effective executable width is odd (100 policy bins -> 99 bins);
 * - ONE_SIDED_Y may reach width - 1 bins from the active bin; and
 * - one balanced half-width is retained as the bounded historical movement
 *   allowance.  It is policy-derived, not a second collector constant.
 */
export interface Phase3EvidenceWidthRequirement {maxExecutableRangeWidthBins:number;effectiveCandidateWidthBins:number;maximumCandidateReachBins:number;replayMovementMarginBins:number;requiredEvidenceRadius:number;requiredFrameWidthBins:number;}
export function derivePhase3EvidenceWidthRequirement(maxExecutableRangeWidthBins=DEFAULT_LPFORGE_MAX_POSITION_WIDTH_BINS):Phase3EvidenceWidthRequirement{
 if(!Number.isInteger(maxExecutableRangeWidthBins)||maxExecutableRangeWidthBins<3||maxExecutableRangeWidthBins>METEORA_PROTOCOL_MAX_POSITION_WIDTH_BINS)throw new Error('LPFORGE_PHASE3_RANGE_WIDTH_POLICY_INVALID');
 const effective=maxExecutableRangeWidthBins%2===0?maxExecutableRangeWidthBins-1:maxExecutableRangeWidthBins;
 const maximumCandidateReachBins=effective-1,replayMovementMarginBins=Math.floor((effective-1)/2),requiredEvidenceRadius=maximumCandidateReachBins+replayMovementMarginBins;
 return{maxExecutableRangeWidthBins,effectiveCandidateWidthBins:effective,maximumCandidateReachBins,replayMovementMarginBins,requiredEvidenceRadius,requiredFrameWidthBins:requiredEvidenceRadius*2+1};
}
export function assertPhase3EvidenceWidth(input:{binRadius:number;maxExecutableRangeWidthBins?:number}):Phase3EvidenceWidthRequirement{
 const requirement=derivePhase3EvidenceWidthRequirement(input.maxExecutableRangeWidthBins);
 if(!Number.isInteger(input.binRadius)||input.binRadius<requirement.requiredEvidenceRadius)throw new Error(`PHASE3_EVIDENCE_WIDTH_INSUFFICIENT_FOR_RANGE_POLICY:radius=${input.binRadius}:required=${requirement.requiredEvidenceRadius}:maxWidth=${requirement.maxExecutableRangeWidthBins}`);
 return requirement;
}
function boundedOddWidth(x:number,min:number,max:number){let n=clamp(Math.round(x),min,max);if(n%2===0)n=n===max?n-1:n+1;return Math.max(3,n);}
/** Resolves the inclusive executable width before family/asymmetric geometry. */
export function resolveFinalRangeWidthBins(input:{minimumIncludedBins:number;volatilityRequiredWidthBins:number;survivalHorizonRequiredWidthBins:number;maximumWidthBins:number;allowLegacyClamp?:boolean}):number{
 const fields=[input.minimumIncludedBins,input.volatilityRequiredWidthBins,input.survivalHorizonRequiredWidthBins,input.maximumWidthBins];if(fields.some(x=>!Number.isFinite(x)||!Number.isInteger(x)))throw new Error('LPFORGE_RANGE_WIDTH_REQUIREMENT_INVALID');
 const required=Math.max(3,input.minimumIncludedBins,input.volatilityRequiredWidthBins,input.survivalHorizonRequiredWidthBins);if(required>input.maximumWidthBins){if(input.allowLegacyClamp===true)return input.maximumWidthBins;throw new Error('RANGE_REQUIRED_WIDTH_EXCEEDS_MAXIMUM');}return required;
}
export function generateRangeUniverse(input:{activeBinId:number;binStep:number;horizonMinutes:number;context:MarketContextSnapshot;structure:StructureFeatureVector;regime:RegimeAssessment;maxWidthBins?:number;minWidthBins?:number;enforceRequiredWidth?:boolean;}):RangeUniverse{
 const requestedMax=input.maxWidthBins??DEFAULT_LPFORGE_MAX_POSITION_WIDTH_BINS;if(!Number.isInteger(requestedMax)||requestedMax<3)throw new Error('LPFORGE_RANGE_INVALID_MAX_WIDTH');const maxWidth=Math.min(METEORA_PROTOCOL_MAX_POSITION_WIDTH_BINS,requestedMax),requestedMin=input.minWidthBins??11;if(!Number.isInteger(requestedMin)||requestedMin<1)throw new Error('LPFORGE_RANGE_INVALID_MIN_WIDTH');const minWidth=Math.max(3,requestedMin);if(minWidth>maxWidth)throw new Error('RANGE_REQUIRED_WIDTH_EXCEEDS_MAXIMUM');if(input.binStep<=0)throw new Error('LPFORGE_RANGE_INVALID_BIN_STEP');
 const h15=input.context.horizons['15m'],h1=input.context.horizons['1h'];const horizonScale=Math.sqrt(Math.max(input.horizonMinutes,15)/60);
 const volMult=input.structure.volatilityState==='EXTREME'?1.8:input.structure.volatilityState==='HIGH'?1.4:input.structure.volatilityState==='MODERATE'?1.15:.9;const transitionMult=1+input.regime.transitionRisk*.45;
 const volatilityMove=Math.max(4,h15.absoluteBins*2,h1.absoluteBins*horizonScale*.75)*volMult*transitionMult;
 const survivalMove=Math.max(4,h1.binVelocityPerMinute*input.horizonMinutes*.55)*volMult*transitionMult;
 const rawVolatilityRequiredWidthBins=Math.max(3,Math.ceil(volatilityMove*2+1)),rawSurvivalHorizonRequiredWidthBins=Math.max(3,Math.ceil(survivalMove*2+1));
 /* Explicit policy floors use the fail-closed production contract.  The
  * omitted-minimum branch retains legacy research callers' bounded sampling
  * behaviour until they adopt an explicit range policy. */
 const explicitPolicyFloor=input.enforceRequiredWidth===true,volatilityRequiredWidthBins=explicitPolicyFloor?rawVolatilityRequiredWidthBins:Math.min(maxWidth,rawVolatilityRequiredWidthBins),survivalHorizonRequiredWidthBins=explicitPolicyFloor?rawSurvivalHorizonRequiredWidthBins:Math.min(maxWidth,rawSurvivalHorizonRequiredWidthBins);
 const finalMinimumWidthBins=resolveFinalRangeWidthBins({minimumIncludedBins:minWidth,volatilityRequiredWidthBins,survivalHorizonRequiredWidthBins,maximumWidthBins:maxWidth,allowLegacyClamp:!explicitPolicyFloor}),movementBasis=Math.max(volatilityMove,survivalMove);
 const families=[['NARROW',.75],['BASE',1],['WIDE',1.4],['DEFENSIVE',1.9]] as const;const candidates:RangeGeometryCandidate[]=[];
 for(const [family,m] of families){let width=Math.max(finalMinimumWidthBins,Math.ceil(movementBasis*m*2+1));if(width>maxWidth){if(explicitPolicyFloor)throw new Error('RANGE_REQUIRED_WIDTH_EXCEEDS_MAXIMUM');width=maxWidth;}const half=Math.floor((width-1)/2);const direction=input.structure.trendDirection;const skewStrength=clamp((input.structure.trendEfficiency*.4+Math.abs(input.context.horizons['15m'].returnPct)/10)*.6,0,.35);let lowerHalf=half,upperHalf=width-1-half;if(direction>0){upperHalf=Math.round((width-1-half)*(1+skewStrength));lowerHalf=Math.max(1,width-1-upperHalf);}else if(direction<0){lowerHalf=Math.round(half*(1+skewStrength));upperHalf=Math.max(1,width-1-lowerHalf);}width=lowerHalf+upperHalf+1;if(width>maxWidth){if(explicitPolicyFloor)throw new Error('RANGE_REQUIRED_WIDTH_EXCEEDS_MAXIMUM');const overflow=width-maxWidth;lowerHalf=Math.max(1,lowerHalf-Math.ceil(overflow/2));upperHalf=Math.max(1,upperHalf-Math.floor(overflow/2));width=lowerHalf+upperHalf+1;}if(width<finalMinimumWidthBins)throw new Error('RANGE_FINAL_GEOMETRY_BELOW_REQUIRED_WIDTH');
  const lowerOffset=-lowerHalf,upperOffset=upperHalf;const reasons=[`RANGE_FAMILY_${family}`,`VOLATILITY_${input.structure.volatilityState}`];if(input.regime.transitionRisk>.4)reasons.push('TRANSITION_RISK_WIDENING');if(direction!==0)reasons.push('DIRECTIONAL_ASYMMETRY');candidates.push({id:`${family.toLowerCase()}-${width}-${lowerHalf}-${upperHalf}`,family,lowerBinId:input.activeBinId+lowerOffset,upperBinId:input.activeBinId+upperOffset,centerBinId:input.activeBinId,widthBins:width,lowerOffsetBins:lowerOffset,upperOffsetBins:upperOffset,lowerDistancePct:pctForOffset(input.binStep,lowerOffset),upperDistancePct:pctForOffset(input.binStep,upperOffset),reasonCodes:reasons});}
 const unique=[...new Map(candidates.map((c)=>[`${c.lowerBinId}:${c.upperBinId}`,c])).values()].sort((a,b)=>a.widthBins-b.widthBins);return{activeBinId:input.activeBinId,binStep:input.binStep,horizonMinutes:input.horizonMinutes,candidates:unique,movementBasisBins:movementBasis,volatilityMultiplier:volMult,minimumIncludedBins:minWidth,volatilityRequiredWidthBins,survivalHorizonRequiredWidthBins,finalMinimumWidthBins};
}

// P3-11+ types live here so range construction stays in one domain package.
export interface RangeStrategyCandidate extends RangeGeometryCandidate {strategy:Phase3StrategyFamily;orientation:Phase3Orientation;capitalFraction:number;perBinWeights:Array<{binId:number;weight:number}>;}

function normalizeWeights(rows:Array<{binId:number;weight:number}>):Array<{binId:number;weight:number}>{const total=rows.reduce((a,b)=>a+b.weight,0);if(total<=0)throw new Error('LPFORGE_RANGE_WEIGHTS_ZERO');return rows.map((x)=>({binId:x.binId,weight:x.weight/total}));}
export function buildStrategyWeights(candidate:RangeGeometryCandidate,strategy:Phase3StrategyFamily,orientation:Phase3Orientation='BALANCED'):Array<{binId:number;weight:number}>{
 const bins=Array.from({length:candidate.widthBins},(_,i)=>candidate.lowerBinId+i);const maxDistance=Math.max(1,Math.max(candidate.centerBinId-candidate.lowerBinId,candidate.upperBinId-candidate.centerBinId));
 const rows=bins.map((binId)=>{const d=Math.abs(binId-candidate.centerBinId)/maxDistance;const shape=strategy==='SPOT'?1:strategy==='CURVE'?Math.max(.08,1-d*.92):Math.max(.08,.12+d*.88);const ySide=binId<candidate.centerBinId;const xSide=!ySide;const orientationMultiplier=orientation==='ONE_SIDED_Y'?(ySide?1:0):orientation==='ONE_SIDED_X'?(xSide?1:0):orientation==='SKEWED_Y'?(ySide?1.7:.6):orientation==='SKEWED_X'?(xSide?1.7:.6):1;return{binId,weight:shape*orientationMultiplier};});return normalizeWeights(rows);
}
function geometryForOrientation(g:RangeGeometryCandidate,orientation:Phase3Orientation):RangeGeometryCandidate{
  const width=g.widthBins;if(orientation==='ONE_SIDED_Y'){const lowerBinId=g.centerBinId-width+1,upperBinId=g.centerBinId;return{...g,lowerBinId,upperBinId,lowerOffsetBins:lowerBinId-g.centerBinId,upperOffsetBins:0,lowerDistancePct:0,upperDistancePct:0,reasonCodes:[...g.reasonCodes,'RANGE_ORIENTATION_ONE_SIDED_Y']};}
  if(orientation==='SKEWED_Y'){const lowerSpan=Math.max(1,Math.ceil((width-1)*.7)),upperSpan=Math.max(0,width-1-lowerSpan),lowerBinId=g.centerBinId-lowerSpan,upperBinId=g.centerBinId+upperSpan;return{...g,lowerBinId,upperBinId,lowerOffsetBins:-lowerSpan,upperOffsetBins:upperSpan,lowerDistancePct:0,upperDistancePct:0,reasonCodes:[...g.reasonCodes,'RANGE_ORIENTATION_SKEWED_Y']};}
  return g;
}
export function generateStrategyCandidates(input:{universe:RangeUniverse;strategies?:Phase3StrategyFamily[];orientations?:Phase3Orientation[];strategyOrientations?:Partial<Record<Phase3StrategyFamily,Phase3Orientation[]>>;capitalFractions?:number[]}):RangeStrategyCandidate[]{
 const strategies=input.strategies??['SPOT','CURVE','BID_ASK'],orientations=input.orientations??['BALANCED'],fractions=input.capitalFractions??[1];const out:RangeStrategyCandidate[]=[];
 for(const g of input.universe.candidates)for(const strategy of strategies)for(const orientation of input.strategyOrientations?.[strategy]??orientations)for(const capitalFraction of fractions){if(!(capitalFraction>0&&capitalFraction<=1))throw new Error('LPFORGE_RANGE_CAPITAL_FRACTION');const geometry=geometryForOrientation(g,orientation);const perBinWeights=buildStrategyWeights(geometry,strategy,orientation);out.push({...geometry,id:`${g.id}-${strategy.toLowerCase()}-${orientation.toLowerCase()}-${Math.round(capitalFraction*1000)}`,strategy,orientation,capitalFraction,perBinWeights});}
 return out;
}
