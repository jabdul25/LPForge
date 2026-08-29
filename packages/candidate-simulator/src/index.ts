import type { SwapEventFact } from '../../domain/src/index.js';
import type { RangeStrategyCandidate } from '../../rangeforge/src/index.js';
import { simulateSyntheticPosition, type BinFrame, type SimulationCostModel, type SyntheticPosition } from '../../simulator/src/index.js';
import type { OccupancyState } from '../../elapsed-occupancy/src/index.js';

export interface CandidateEconomicSimulation {
  candidateId:string;
  strategy:RangeStrategyCandidate['strategy'];
  orientation:RangeStrategyCandidate['orientation'];
  activeTimeRatio?:number;
  /** Diagnostic-only, retained to quantify the corrected elapsed-time delta. */
  countWeightedActiveTimeRatio?:number;
  activeDurationMs:number;
  inactiveDurationMs:number;
  unobservedDurationMs:number;
  occupancyCoverageRatio:number;
  occupancyState:OccupancyState;
  firstOutOfRangeAt?:string;
  lowerExitCount:number;
  upperExitCount:number;
  feeValue:number;
  inventoryChangeValue:number;
  grossValueChange:number;
  totalCostValue:number;
  netValue:number;
  feeToAdverseInventoryRatio:number|null;
  fidelity:'EVENT_PATH_ESTIMATE';
  valueUnit:'TOKEN_X';
  capitalValue:number;
  startInventoryValue:number;
  normalizationScale:number;
  /** Raw simulator evidence remains immutable when production calibration applies. */
  rawReplayFeeValue?:number;
  rawReplayGrossValueChange?:number;
  rawReplayNetValue?:number;
  feeEvidenceCalibration?:{
    version:string;
    status:'CALIBRATED'|'EVIDENCE_INSUFFICIENT'|'NOT_APPLIED';
    rawReplayFeeValue:number;
    calibratedFeeValue:number;
    credibility:number|null;
    normalizationScale:number|null;
    reasonCodes:string[];
  };
  unitScaleValid:boolean;
  evidenceActionable:boolean;
  warnings:string[];
}
function raw(v:string|undefined):bigint{try{return BigInt(v??'0');}catch{return 0n;}}
/**
 * A synthetic replay position needs enough relative share units to survive integer
 * division against the observed pool supply.  Derive that scale from the opening
 * frame rather than an arbitrary fixed unit count.  It is not deployed liquidity;
 * later normalization maps the resulting inventory back to decision capital.
 */
const MAX_SYNTHETIC_POSITION_SHARE_RAW=(1n<<128n)-1n;
/** Keep the simulated position in the linear, price-taking share regime. */
export const SYNTHETIC_SHARE_DIVISOR=1_000_000n;
export const SHARE_WEIGHT_SCALE=1_000_000_000_000n;
const ceilDiv=(n:bigint,d:bigint)=>d>0n?(n+d-1n)/d:0n;
export function deriveSyntheticPositionShareRaw(frame:BinFrame,divisor:bigint=SYNTHETIC_SHARE_DIVISOR):bigint{
 let usable=0n;
 for(const bin of frame.bins){
  const supply=raw(bin.liquiditySupply),x=raw(bin.amountX),y=raw(bin.amountY);
  if(supply>0n&&(x>0n||y>0n))usable+=supply;
 }
 if(usable<=0n||divisor<=0n)return 0n;
 const scaled=ceilDiv(usable,divisor);
 return scaled>MAX_SYNTHETIC_POSITION_SHARE_RAW?MAX_SYNTHETIC_POSITION_SHARE_RAW:scaled;
}
function boundedFraction(value:number):bigint{
 if(!Number.isFinite(value)||value<=0||value>1)throw new Error('LPFORGE_CANDIDATE_CAPITAL_FRACTION_INVALID');
 return BigInt(Math.max(1,Math.min(Number(SHARE_WEIGHT_SCALE),Math.round(value*Number(SHARE_WEIGHT_SCALE)))));
}
/** Exact integer allocation: no U128 principal is ever converted to Number. */
export function allocateSyntheticShares(totalShareRaw:bigint,weights:Array<{weight:number}>):bigint[]{
 if(totalShareRaw<0n||!weights.length)throw new Error('LPFORGE_CANDIDATE_SHARE_ALLOCATION_INVALID');
 const numerators=weights.map(({weight})=>{
  if(!Number.isFinite(weight)||weight<0)throw new Error('LPFORGE_CANDIDATE_WEIGHT_INVALID');
  return BigInt(Math.max(0,Math.round(weight*Number(SHARE_WEIGHT_SCALE))));
 });
 const denominator=numerators.reduce((a,b)=>a+b,0n);if(denominator<=0n)throw new Error('LPFORGE_CANDIDATE_WEIGHT_ZERO');
 let assigned=0n;const remainderIndex=numerators.reduce((last,n,i)=>n>0n?i:last,-1);if(remainderIndex<0)throw new Error('LPFORGE_CANDIDATE_WEIGHT_ZERO');
 return numerators.map((n,i)=>{const share=i===remainderIndex?totalShareRaw-assigned:(totalShareRaw*n)/denominator;assigned+=share;return share;});
}
/** Replay the current candidate's offset geometry at the historical anchor. */
export function rebaseCandidateForReplay(candidate:RangeStrategyCandidate,anchorActiveBinId:number):RangeStrategyCandidate{
 const rebase=(binId:number)=>anchorActiveBinId+(binId-candidate.centerBinId);
 return {...candidate,lowerBinId:anchorActiveBinId+candidate.lowerOffsetBins,upperBinId:anchorActiveBinId+candidate.upperOffsetBins,centerBinId:anchorActiveBinId,perBinWeights:candidate.perBinWeights.map(w=>({...w,binId:rebase(w.binId)}))};
}
function distributeShares(candidate:RangeStrategyCandidate,totalShareRaw:bigint,frame:BinFrame):SyntheticPosition{
 const map=new Map(frame.bins.map((b)=>[b.binId,b] as const));const shares=allocateSyntheticShares(totalShareRaw,candidate.perBinWeights);const bins=candidate.perBinWeights.map((w,i)=>({binId:w.binId,positionShareRaw:shares[i]!,competingSupplyRaw:raw(map.get(w.binId)?.liquiditySupply)}));return{pool:'candidate-pool',lowerBinId:candidate.lowerBinId,upperBinId:candidate.upperBinId,openedAt:frame.observedAt,bins,strategyLabel:`${candidate.strategy}:${candidate.orientation}`};
}
const finitePositive=(n:number)=>Number.isFinite(n)&&n>0;
export function simulateCandidateEconomics(input:{candidate:RangeStrategyCandidate;pool:string;frames:BinFrame[];events:SwapEventFact[];totalPositionShareRaw:bigint;rawUnitValueX:number;rawUnitValueY:number;capitalValue:number;costs?:SimulationCostModel;maxCapitalRelativeMove?:number;rebaseCandidateToFirstFrame?:boolean;horizonEnd?:string;}):CandidateEconomicSimulation{
 if(!input.frames.length)throw new Error('LPFORGE_CANDIDATE_SIM_NO_FRAMES');
 const first=input.frames[0]!,candidate=input.rebaseCandidateToFirstFrame===false?input.candidate:rebaseCandidateForReplay(input.candidate,first.activeBinId),candidateShareRaw=(input.totalPositionShareRaw*boundedFraction(input.candidate.capitalFraction))/SHARE_WEIGHT_SCALE,position=distributeShares(candidate,candidateShareRaw,first);position.pool=input.pool;
 const sim=simulateSyntheticPosition({position,frames:input.frames,events:input.events,...(input.costs?{costs:input.costs}:{}),...(input.horizonEnd?{horizonEnd:input.horizonEnd}:{})});
 const start=sim.inventory[0]!,end=sim.inventory.at(-1)!;
 const valueRaw=(x:bigint,y:bigint)=>Number(x)*input.rawUnitValueX+Number(y)*input.rawUnitValueY;
 const startInventoryValueRaw=valueRaw(start.tokenXRaw,start.tokenYRaw);
 const targetCapital=input.capitalValue*input.candidate.capitalFraction;
 const calibrationValid=finitePositive(input.rawUnitValueX)&&finitePositive(input.rawUnitValueY)&&finitePositive(startInventoryValueRaw)&&finitePositive(targetCapital);
 const normalizationScale=calibrationValid?targetCapital/startInventoryValueRaw:0;
 const replayContinuous=!sim.inventory.some(snapshot=>snapshot.missingBins.some(binId=>position.bins.some(bin=>bin.binId===binId&&bin.positionShareRaw>0n)));
 const dx=end.tokenXRaw-start.tokenXRaw,dy=end.tokenYRaw-start.tokenYRaw;
 const inventoryChangeValueRaw=valueRaw(dx,dy);
 const feeValueRaw=Number(sim.totalAttributedFeeXRaw)*input.rawUnitValueX+Number(sim.totalAttributedFeeYRaw)*input.rawUnitValueY;
 const inventoryChangeValue=calibrationValid&&replayContinuous?inventoryChangeValueRaw*normalizationScale:0;
 const feeValue=calibrationValid&&replayContinuous?feeValueRaw*normalizationScale:0;
 const costs=Object.values(sim.costs).reduce((a,b)=>a+(Number(b)||0),0);
 const grossValueChange=feeValue+inventoryChangeValue,netValue=replayContinuous?grossValueChange-costs:0;
 const maxMove=Math.max(1,input.maxCapitalRelativeMove??5)*Math.max(targetCapital,Number.EPSILON);
 const bounded=Number.isFinite(inventoryChangeValue)&&Number.isFinite(feeValue)&&Number.isFinite(netValue)&&Math.abs(grossValueChange)<=maxMove;
 const unitScaleValid=calibrationValid&&bounded;
 const occupancyComplete=sim.occupancyState==='COMPLETE';
 const evidenceActionable=unitScaleValid&&replayContinuous&&occupancyComplete&&input.events.length>0;
 const adverse=Math.max(0,-inventoryChangeValue);
 const warnings=[...sim.warnings,'CANDIDATE_VALUE_USES_CAPITAL_NORMALIZED_TOKEN_X_UNITS'];
 if(input.events.length===0)warnings.push('CANDIDATE_EVENT_PATH_NO_SWAP_EVIDENCE');
 if(!replayContinuous)warnings.push('CANDIDATE_REPLAY_CONTINUITY_INSUFFICIENT');
 if(!occupancyComplete)warnings.push('CANDIDATE_ACTIVE_TIME_EVIDENCE_INSUFFICIENT');
 if(!calibrationValid)warnings.push('CANDIDATE_VALUE_CALIBRATION_INVALID');
 if(calibrationValid&&!bounded)warnings.push('CANDIDATE_UNIT_SCALE_INVALID');
 return{candidateId:input.candidate.id,strategy:input.candidate.strategy,orientation:input.candidate.orientation,...(sim.activeTimeRatio===undefined?{}:{activeTimeRatio:sim.activeTimeRatio}),...(sim.countWeightedActiveTimeRatio===undefined?{}:{countWeightedActiveTimeRatio:sim.countWeightedActiveTimeRatio}),activeDurationMs:sim.activeDurationMs,inactiveDurationMs:sim.inactiveDurationMs,unobservedDurationMs:sim.unobservedDurationMs,occupancyCoverageRatio:sim.occupancyCoverageRatio,occupancyState:sim.occupancyState,...(sim.firstOutOfRangeAt?{firstOutOfRangeAt:sim.firstOutOfRangeAt}:{}),lowerExitCount:sim.lowerExitCount,upperExitCount:sim.upperExitCount,feeValue,inventoryChangeValue,grossValueChange,totalCostValue:costs,netValue,feeToAdverseInventoryRatio:adverse>0?feeValue/adverse:null,fidelity:'EVENT_PATH_ESTIMATE',valueUnit:'TOKEN_X',capitalValue:targetCapital,startInventoryValue:calibrationValid?startInventoryValueRaw*normalizationScale:0,normalizationScale,unitScaleValid,evidenceActionable,warnings};
}
export function simulateCandidateSet(input:Omit<Parameters<typeof simulateCandidateEconomics>[0],'candidate'>&{candidates:RangeStrategyCandidate[]}):CandidateEconomicSimulation[]{return input.candidates.map((candidate)=>simulateCandidateEconomics({...input,candidate}));}
