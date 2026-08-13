// LPFORGE_PHASE6_MAINNET_MODULE
import type {Phase3Orientation,Phase3StrategyFamily} from '../../contracts/src/index.js';

export interface Phase6EntryFundingPlan {strategy:Phase3StrategyFamily;orientation:Phase3Orientation;pairedTokenTargetBps:number;solForLpLamports:bigint;solToPairedTokenLamports:bigint;lowerBinId:number;upperBinId:number;reasonCodes:string[];}

/** Converts the autonomous strategy winner into its asset-funding sequence. SOL is token Y for the configured DLMM pools. */
function pairedTokenTargetBps(orientation:Phase3Orientation,activeBinId:number,weights:Array<{binId:number;weight:number}>|undefined):number{
  if(orientation==='ONE_SIDED_Y')return 0;if(orientation==='ONE_SIDED_X')return 10_000;if(orientation==='BALANCED')return 5_000;
  if(!weights?.length)throw new Error('LPFORGE_P6_SKEWED_ENTRY_WEIGHTS_REQUIRED');const total=weights.reduce((sum,row)=>sum+row.weight,0),xSide=weights.filter(row=>row.binId>=activeBinId).reduce((sum,row)=>sum+row.weight,0);if(!(total>0)||!Number.isFinite(total)||!Number.isFinite(xSide))throw new Error('LPFORGE_P6_SKEWED_ENTRY_WEIGHTS_INVALID');return Math.max(0,Math.min(10_000,Math.round(xSide/total*10_000)));
}
export function planPhase6SolEntryFunding(input:{strategy:Phase3StrategyFamily;orientation?:Phase3Orientation;capitalLamports:bigint;activeBinId:number;lowerBinId:number;upperBinId:number;perBinWeights?:Array<{binId:number;weight:number}>}):Phase6EntryFundingPlan{
  if(input.capitalLamports<2n)throw new Error('LPFORGE_P6_ENTRY_CAPITAL_TOO_SMALL');if(!Number.isInteger(input.activeBinId)||!Number.isInteger(input.lowerBinId)||!Number.isInteger(input.upperBinId)||input.lowerBinId>input.upperBinId)throw new Error('LPFORGE_P6_ENTRY_RANGE_INVALID');
  if(input.strategy==='BID_ASK'){const width=Math.max(1,input.upperBinId-input.lowerBinId+1);return{strategy:'BID_ASK',orientation:'ONE_SIDED_Y',pairedTokenTargetBps:0,solForLpLamports:input.capitalLamports,solToPairedTokenLamports:0n,lowerBinId:input.activeBinId-width,upperBinId:input.activeBinId,reasonCodes:['P6_SOL_SIDED_BID_ASK_NO_SWAP']};}
  const orientation=input.orientation??'BALANCED';if(input.strategy==='SPOT'&&orientation!=='BALANCED')throw new Error('LPFORGE_P6_SPOT_REQUIRES_BALANCED_ENTRY');const targetBps=pairedTokenTargetBps(orientation,input.activeBinId,input.perBinWeights);const solToPairedTokenLamports=input.capitalLamports*BigInt(targetBps)/10_000n;const skewReason=orientation==='BALANCED'?'P6_BALANCED_ENTRY_HALF_SOL_SWAP':'P6_CURVE_SKEWED_ENTRY_TARGET_FROM_BIN_WEIGHTS';return{strategy:input.strategy,orientation,pairedTokenTargetBps:targetBps,solForLpLamports:input.capitalLamports-solToPairedTokenLamports,solToPairedTokenLamports,lowerBinId:input.lowerBinId,upperBinId:input.upperBinId,reasonCodes:[skewReason,'P6_ENTRY_SOL_REMAINDER_FOR_LP']};
}
