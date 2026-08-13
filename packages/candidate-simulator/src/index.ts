import type { SwapEventFact } from '../../domain/src/index.js';
import type { RangeStrategyCandidate } from '../../rangeforge/src/index.js';
import { simulateSyntheticPosition, type BinFrame, type SimulationCostModel, type SyntheticPosition } from '../../simulator/src/index.js';

export interface CandidateEconomicSimulation {
  candidateId:string;
  strategy:RangeStrategyCandidate['strategy'];
  orientation:RangeStrategyCandidate['orientation'];
  activeTimeRatio:number;
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
  unitScaleValid:boolean;
  evidenceActionable:boolean;
  warnings:string[];
}
function raw(v:string|undefined):bigint{try{return BigInt(v??'0');}catch{return 0n;}}
function distributeShares(candidate:RangeStrategyCandidate,totalShareRaw:bigint,frame:BinFrame):SyntheticPosition{
 const map=new Map(frame.bins.map((b)=>[b.binId,b] as const));let assigned=0n;const bins=candidate.perBinWeights.map((w,i)=>{const share=i===candidate.perBinWeights.length-1?totalShareRaw-assigned:BigInt(Math.max(0,Math.floor(Number(totalShareRaw)*w.weight)));assigned+=share;return{binId:w.binId,positionShareRaw:share,competingSupplyRaw:raw(map.get(w.binId)?.liquiditySupply)};});return{pool:'candidate-pool',lowerBinId:candidate.lowerBinId,upperBinId:candidate.upperBinId,openedAt:frame.observedAt,bins,strategyLabel:`${candidate.strategy}:${candidate.orientation}`};
}
const finitePositive=(n:number)=>Number.isFinite(n)&&n>0;
export function simulateCandidateEconomics(input:{candidate:RangeStrategyCandidate;pool:string;frames:BinFrame[];events:SwapEventFact[];totalPositionShareRaw:bigint;rawUnitValueX:number;rawUnitValueY:number;capitalValue:number;costs?:SimulationCostModel;maxCapitalRelativeMove?:number;}):CandidateEconomicSimulation{
 if(!input.frames.length)throw new Error('LPFORGE_CANDIDATE_SIM_NO_FRAMES');
 const first=input.frames[0]!,position=distributeShares(input.candidate,BigInt(Math.floor(Number(input.totalPositionShareRaw)*input.candidate.capitalFraction)),first);position.pool=input.pool;
 const sim=simulateSyntheticPosition({position,frames:input.frames,events:input.events,...(input.costs?{costs:input.costs}:{})});
 const start=sim.inventory[0]!,end=sim.inventory.at(-1)!;
 const valueRaw=(x:bigint,y:bigint)=>Number(x)*input.rawUnitValueX+Number(y)*input.rawUnitValueY;
 const startInventoryValueRaw=valueRaw(start.tokenXRaw,start.tokenYRaw);
 const targetCapital=input.capitalValue*input.candidate.capitalFraction;
 const calibrationValid=finitePositive(input.rawUnitValueX)&&finitePositive(input.rawUnitValueY)&&finitePositive(startInventoryValueRaw)&&finitePositive(targetCapital);
 const normalizationScale=calibrationValid?targetCapital/startInventoryValueRaw:0;
 const dx=end.tokenXRaw-start.tokenXRaw,dy=end.tokenYRaw-start.tokenYRaw;
 const inventoryChangeValueRaw=valueRaw(dx,dy);
 const feeValueRaw=Number(sim.totalAttributedFeeXRaw)*input.rawUnitValueX+Number(sim.totalAttributedFeeYRaw)*input.rawUnitValueY;
 const inventoryChangeValue=calibrationValid?inventoryChangeValueRaw*normalizationScale:0;
 const feeValue=calibrationValid?feeValueRaw*normalizationScale:0;
 const costs=Object.values(sim.costs).reduce((a,b)=>a+(Number(b)||0),0);
 const grossValueChange=feeValue+inventoryChangeValue,netValue=grossValueChange-costs;
 const maxMove=Math.max(1,input.maxCapitalRelativeMove??5)*Math.max(targetCapital,Number.EPSILON);
 const bounded=Number.isFinite(inventoryChangeValue)&&Number.isFinite(feeValue)&&Number.isFinite(netValue)&&Math.abs(grossValueChange)<=maxMove;
 const unitScaleValid=calibrationValid&&bounded;
 const evidenceActionable=unitScaleValid&&input.events.length>0;
 const adverse=Math.max(0,-inventoryChangeValue);
 const warnings=[...sim.warnings,'CANDIDATE_VALUE_USES_CAPITAL_NORMALIZED_TOKEN_X_UNITS'];
 if(input.events.length===0)warnings.push('CANDIDATE_EVENT_PATH_NO_SWAP_EVIDENCE');
 if(!calibrationValid)warnings.push('CANDIDATE_VALUE_CALIBRATION_INVALID');
 if(calibrationValid&&!bounded)warnings.push('CANDIDATE_UNIT_SCALE_INVALID');
 return{candidateId:input.candidate.id,strategy:input.candidate.strategy,orientation:input.candidate.orientation,activeTimeRatio:sim.activeTimeRatio,...(sim.firstOutOfRangeAt?{firstOutOfRangeAt:sim.firstOutOfRangeAt}:{}),lowerExitCount:sim.lowerExitCount,upperExitCount:sim.upperExitCount,feeValue,inventoryChangeValue,grossValueChange,totalCostValue:costs,netValue,feeToAdverseInventoryRatio:adverse>0?feeValue/adverse:null,fidelity:'EVENT_PATH_ESTIMATE',valueUnit:'TOKEN_X',capitalValue:targetCapital,startInventoryValue:calibrationValid?startInventoryValueRaw*normalizationScale:0,normalizationScale,unitScaleValid,evidenceActionable,warnings};
}
export function simulateCandidateSet(input:Omit<Parameters<typeof simulateCandidateEconomics>[0],'candidate'>&{candidates:RangeStrategyCandidate[]}):CandidateEconomicSimulation[]{return input.candidates.map((candidate)=>simulateCandidateEconomics({...input,candidate}));}
