import type { BinLiquidityFact, SwapEventFact } from '../../domain/src/index.js';

export type SimulationFidelity =
  | 'ONCHAIN_POSITION'
  | 'BIN_SHARE_REPLAY'
  | 'EVENT_PATH_ESTIMATE'
  | 'AGGREGATE_ESTIMATE';

export interface SyntheticBinShare {
  binId: number;
  /** Synthetic LP liquidity-share units. These are relative share units, not token amounts. */
  positionShareRaw: bigint;
  /** Observed competing liquidity-supply units before the synthetic position. */
  competingSupplyRaw: bigint;
}

export interface SyntheticPosition {
  pool: string;
  lowerBinId: number;
  upperBinId: number;
  bins: SyntheticBinShare[];
  openedAt: string;
  contributedValue?: string;
  strategyLabel?: string;
}

export interface BinFrame {
  observedAt: string;
  activeBinId: number;
  bins: Array<Pick<BinLiquidityFact, 'binId'|'amountX'|'amountY'|'liquiditySupply'|'price'>>;
}

export interface InventorySnapshot {
  observedAt: string;
  activeBinId: number;
  inRange: boolean;
  tokenXRaw: bigint;
  tokenYRaw: bigint;
  activeBinDistance: number;
  coveredBins: number;
  missingBins: number[];
}

export interface FeeAttribution {
  eventKey: string;
  feeToken: 'X'|'Y'|'UNKNOWN';
  mmFeeRaw: bigint;
  attributedLpFeeRaw: bigint;
  pathBins: number[];
  inRangePathBins: number[];
  fidelity: SimulationFidelity;
}

export interface SimulationCostModel {
  compositionFeeValue?: string;
  transactionFeeValue?: string;
  slippageValue?: string;
  rebalanceCostValue?: string;
  otherCostValue?: string;
}

export interface SimulationResult {
  pool: string;
  openedAt: string;
  endedAt: string;
  lowerBinId: number;
  upperBinId: number;
  fidelity: SimulationFidelity;
  inventory: InventorySnapshot[];
  activeTimeRatio: number;
  firstOutOfRangeAt?: string;
  lowerExitCount: number;
  upperExitCount: number;
  totalAttributedFeeXRaw: bigint;
  totalAttributedFeeYRaw: bigint;
  feeAttribution: FeeAttribution[];
  costs: Required<SimulationCostModel>;
  warnings: string[];
}

function bigint(v: string|bigint|undefined): bigint {
  if (typeof v === 'bigint') return v;
  if (!v) return 0n;
  try { return BigInt(v); } catch { return 0n; }
}

function floorMulDiv(a: bigint, b: bigint, d: bigint): bigint {
  if (d <= 0n) return 0n;
  return (a * b) / d;
}

export function pathBins(startBinId: number|undefined, endBinId: number|undefined): number[] {
  if (startBinId === undefined || endBinId === undefined) return [];
  const step = endBinId >= startBinId ? 1 : -1;
  const out: number[] = [];
  for (let i = startBinId; ; i += step) {
    out.push(i);
    if (i === endBinId) break;
    if (out.length > 5000) throw new Error('LPFORGE_SIM_PATH_TOO_LONG');
  }
  return out;
}

export function syntheticShareFraction(share: SyntheticBinShare): { numerator: bigint; denominator: bigint } {
  if (share.positionShareRaw < 0n || share.competingSupplyRaw < 0n) throw new Error('LPFORGE_SIM_NEGATIVE_SHARE');
  return { numerator: share.positionShareRaw, denominator: share.positionShareRaw + share.competingSupplyRaw };
}

/**
 * Counterfactual inventory approximation. It assumes the synthetic position is small enough not to change the
 * observed market path and that the provided liquidity-share units remain proportionally representative.
 * The output is intentionally marked BIN_SHARE_REPLAY rather than exact on-chain position accounting.
 */
export function replaySyntheticInventory(position: SyntheticPosition, frames: BinFrame[]): InventorySnapshot[] {
  const shareByBin = new Map(position.bins.map((b) => [b.binId, b] as const));
  return [...frames]
    .sort((a,b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
    .map((frame) => {
      let tokenXRaw = 0n;
      let tokenYRaw = 0n;
      const missingBins: number[] = [];
      const frameMap = new Map(frame.bins.map((b) => [b.binId,b] as const));
      for (const [binId, share] of shareByBin) {
        const bin = frameMap.get(binId);
        if (!bin) { missingBins.push(binId); continue; }
        const observedSupply = bigint(bin.liquiditySupply);
        const denom = observedSupply > 0n ? observedSupply + share.positionShareRaw : share.positionShareRaw;
        if (denom <= 0n) continue;
        tokenXRaw += floorMulDiv(bigint(bin.amountX), share.positionShareRaw, denom);
        tokenYRaw += floorMulDiv(bigint(bin.amountY), share.positionShareRaw, denom);
      }
      const inRange = frame.activeBinId >= position.lowerBinId && frame.activeBinId <= position.upperBinId;
      const distance = inRange ? 0 : frame.activeBinId < position.lowerBinId ? position.lowerBinId-frame.activeBinId : frame.activeBinId-position.upperBinId;
      return {
        observedAt: frame.observedAt,
        activeBinId: frame.activeBinId,
        inRange,
        tokenXRaw,
        tokenYRaw,
        activeBinDistance: distance,
        coveredBins: position.bins.length - missingBins.length,
        missingBins,
      };
    });
}

function feeToken(event: SwapEventFact): 'X'|'Y'|'UNKNOWN' {
  if (event.feesOnTokenX === true) return 'X';
  if (event.feesOnTokenX === false) return 'Y';
  return 'UNKNOWN';
}

/**
 * Attribute Swap2Evt aggregate MM fee to a synthetic position. Swap2Evt exposes aggregate MM fee plus start/end
 * bins, but not per-bin MM-fee amounts. Therefore this method allocates the aggregate MM fee equally across the
 * traversed path and then applies the synthetic LP's share of competing liquidity in each traversed bin.
 * This is an EVENT_PATH_ESTIMATE and must never be reported as exact fee accounting.
 */
export function attributeEventPathFees(position: SyntheticPosition, events: SwapEventFact[]): FeeAttribution[] {
  const shareByBin = new Map(position.bins.map((b) => [b.binId,b] as const));
  return events.map((event) => {
    const path = pathBins(event.startBinId,event.endBinId);
    const mmFeeRaw = bigint(event.mmFee);
    const inRangePathBins = path.filter((id) => shareByBin.has(id));
    if (mmFeeRaw <= 0n || path.length === 0 || inRangePathBins.length === 0) {
      return {eventKey:`${event.signature}:${event.eventIndex}`,feeToken:feeToken(event),mmFeeRaw,attributedLpFeeRaw:0n,pathBins:path,inRangePathBins,fidelity:'EVENT_PATH_ESTIMATE'};
    }
    const perPathBase = mmFeeRaw / BigInt(path.length);
    const remainder = mmFeeRaw % BigInt(path.length);
    let attributed = 0n;
    path.forEach((binId,index) => {
      const share = shareByBin.get(binId);
      if (!share) return;
      const eventBinFee = perPathBase + (BigInt(index) < remainder ? 1n : 0n);
      const fraction = syntheticShareFraction(share);
      attributed += floorMulDiv(eventBinFee,fraction.numerator,fraction.denominator);
    });
    return {eventKey:`${event.signature}:${event.eventIndex}`,feeToken:feeToken(event),mmFeeRaw,attributedLpFeeRaw:attributed,pathBins:path,inRangePathBins,fidelity:'EVENT_PATH_ESTIMATE'};
  });
}

function normalizeCost(v: string|undefined): string { return v && /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v) ? v : '0'; }

export function simulateSyntheticPosition(input: {
  position: SyntheticPosition;
  frames: BinFrame[];
  events: SwapEventFact[];
  costs?: SimulationCostModel;
}): SimulationResult {
  if (input.position.lowerBinId > input.position.upperBinId) throw new Error('LPFORGE_SIM_INVALID_RANGE');
  const inventory = replaySyntheticInventory(input.position,input.frames);
  if (!inventory.length) throw new Error('LPFORGE_SIM_NO_FRAMES');
  const feeAttribution = attributeEventPathFees(input.position,input.events);
  let feeX = 0n, feeY = 0n;
  for (const f of feeAttribution) {
    if (f.feeToken === 'X') feeX += f.attributedLpFeeRaw;
    else if (f.feeToken === 'Y') feeY += f.attributedLpFeeRaw;
  }
  let lowerExitCount=0, upperExitCount=0, wasInRange=true;
  let firstOutOfRangeAt: string|undefined;
  for (const s of inventory) {
    if (!s.inRange && wasInRange) {
      if (!firstOutOfRangeAt) firstOutOfRangeAt=s.observedAt;
      if (s.activeBinId < input.position.lowerBinId) lowerExitCount++; else upperExitCount++;
    }
    wasInRange=s.inRange;
  }
  const activeTimeRatio=inventory.filter((x)=>x.inRange).length/inventory.length;
  const warnings = [
    'SYNTHETIC_POSITION_DOES_NOT_CHANGE_OBSERVED_MARKET_PATH',
    'SWAP2EVT_MM_FEE_IS_PATH_ALLOCATED_NOT_PER_BIN_EXACT',
  ];
  if (inventory.some((x)=>x.missingBins.length)) warnings.push('BIN_FRAME_GAPS_PRESENT');
  if (feeAttribution.some((x)=>x.feeToken==='UNKNOWN'&&x.mmFeeRaw>0n)) warnings.push('FEE_TOKEN_SIDE_UNKNOWN_FOR_SOME_EVENTS');
  const last=inventory[inventory.length-1]!;
  return {
    pool:input.position.pool,openedAt:input.position.openedAt,endedAt:last.observedAt,
    lowerBinId:input.position.lowerBinId,upperBinId:input.position.upperBinId,
    fidelity:'EVENT_PATH_ESTIMATE',inventory,activeTimeRatio,
    ...(firstOutOfRangeAt?{firstOutOfRangeAt}:{}),lowerExitCount,upperExitCount,
    totalAttributedFeeXRaw:feeX,totalAttributedFeeYRaw:feeY,feeAttribution,
    costs:{compositionFeeValue:normalizeCost(input.costs?.compositionFeeValue),transactionFeeValue:normalizeCost(input.costs?.transactionFeeValue),slippageValue:normalizeCost(input.costs?.slippageValue),rebalanceCostValue:normalizeCost(input.costs?.rebalanceCostValue),otherCostValue:normalizeCost(input.costs?.otherCostValue)},
    warnings,
  };
}

export interface RangeOutcomeSummary {
  samples:number;
  inRangeSamples:number;
  activeTimeRatio:number;
  firstPassageSamples:number|null;
  lowerExitCount:number;
  upperExitCount:number;
  maxDistanceBins:number;
  revisitCount:number;
}

export function summarizeRangeOutcome(position:SyntheticPosition, frames:BinFrame[]):RangeOutcomeSummary {
  const inv=replaySyntheticInventory(position,frames);
  let firstPassageSamples:number|null=null,maxDistanceBins=0,revisitCount=0,lowerExitCount=0,upperExitCount=0,wasIn=true,everOut=false;
  inv.forEach((s,i)=>{maxDistanceBins=Math.max(maxDistanceBins,s.activeBinDistance); if(!s.inRange&&wasIn){firstPassageSamples??=i;everOut=true;if(s.activeBinId<position.lowerBinId)lowerExitCount++;else upperExitCount++;} if(s.inRange&&!wasIn&&everOut)revisitCount++;wasIn=s.inRange;});
  return {samples:inv.length,inRangeSamples:inv.filter((x)=>x.inRange).length,activeTimeRatio:inv.length?inv.filter((x)=>x.inRange).length/inv.length:0,firstPassageSamples,lowerExitCount,upperExitCount,maxDistanceBins,revisitCount};
}

export interface ActualPositionObservation {
  observedAt:string;
  activeBinId:number;
  lowerBinId:number;
  upperBinId:number;
  totalXRaw:bigint;
  totalYRaw:bigint;
  feeXRaw:bigint;
  feeYRaw:bigint;
  value?:number;
  hodlBenchmarkValue?:number;
}
export interface ActualPositionForensics {
  fidelity:'ONCHAIN_POSITION';
  samples:number;
  activeTimeRatio:number;
  firstOutOfRangeAt?:string;
  lowerExitCount:number;
  upperExitCount:number;
  feeXDeltaRaw:bigint;
  feeYDeltaRaw:bigint;
  tokenXDeltaRaw:bigint;
  tokenYDeltaRaw:bigint;
  absolutePnl?:number;
  hodlRelativePnl?:number;
}
export function analyzeActualPosition(observations:ActualPositionObservation[]):ActualPositionForensics{
  const s=[...observations].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
  if(!s.length)throw new Error('LPFORGE_FORENSICS_NO_POSITION_OBSERVATIONS');
  let lowerExitCount=0,upperExitCount=0,wasIn=true,firstOutOfRangeAt:string|undefined;
  for(const o of s){const inRange=o.activeBinId>=o.lowerBinId&&o.activeBinId<=o.upperBinId;if(!inRange&&wasIn){firstOutOfRangeAt??=o.observedAt;if(o.activeBinId<o.lowerBinId)lowerExitCount++;else upperExitCount++;}wasIn=inRange;}
  const first=s[0]!,last=s[s.length-1]!;
  const active=s.filter((o)=>o.activeBinId>=o.lowerBinId&&o.activeBinId<=o.upperBinId).length/s.length;
  return{fidelity:'ONCHAIN_POSITION',samples:s.length,activeTimeRatio:active,...(firstOutOfRangeAt?{firstOutOfRangeAt}:{}),lowerExitCount,upperExitCount,feeXDeltaRaw:last.feeXRaw-first.feeXRaw,feeYDeltaRaw:last.feeYRaw-first.feeYRaw,tokenXDeltaRaw:last.totalXRaw-first.totalXRaw,tokenYDeltaRaw:last.totalYRaw-first.totalYRaw,...(first.value!==undefined&&last.value!==undefined?{absolutePnl:last.value-first.value}:{}),...(last.value!==undefined&&last.hodlBenchmarkValue!==undefined?{hodlRelativePnl:last.value-last.hodlBenchmarkValue}:{}),};
}
