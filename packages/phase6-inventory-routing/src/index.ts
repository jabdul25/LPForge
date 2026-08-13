// LPFORGE_PHASE6_MAINNET_MODULE
import type {Phase3Orientation,Phase3StrategyFamily} from '../../contracts/src/index.js';

export interface Phase6EntryFundingPlan {strategy:Phase3StrategyFamily;orientation:Phase3Orientation;solForLpLamports:bigint;solToPairedTokenLamports:bigint;lowerBinId:number;upperBinId:number;reasonCodes:string[];}

/** Converts the autonomous strategy winner into its asset-funding sequence. SOL is token Y for the configured DLMM pools. */
export function planPhase6SolEntryFunding(input:{strategy:Phase3StrategyFamily;capitalLamports:bigint;activeBinId:number;lowerBinId:number;upperBinId:number}):Phase6EntryFundingPlan{
  if(input.capitalLamports<2n)throw new Error('LPFORGE_P6_ENTRY_CAPITAL_TOO_SMALL');if(!Number.isInteger(input.activeBinId)||!Number.isInteger(input.lowerBinId)||!Number.isInteger(input.upperBinId)||input.lowerBinId>input.upperBinId)throw new Error('LPFORGE_P6_ENTRY_RANGE_INVALID');
  if(input.strategy==='BID_ASK'){const width=Math.max(1,input.upperBinId-input.lowerBinId+1);return{strategy:'BID_ASK',orientation:'ONE_SIDED_Y',solForLpLamports:input.capitalLamports,solToPairedTokenLamports:0n,lowerBinId:input.activeBinId-width,upperBinId:input.activeBinId,reasonCodes:['P6_SOL_SIDED_BID_ASK_NO_SWAP']};}
  const solToPairedTokenLamports=input.capitalLamports/2n;return{strategy:input.strategy,orientation:'BALANCED',solForLpLamports:input.capitalLamports-solToPairedTokenLamports,solToPairedTokenLamports,lowerBinId:input.lowerBinId,upperBinId:input.upperBinId,reasonCodes:['P6_BALANCED_ENTRY_HALF_SOL_SWAP','P6_BALANCED_ENTRY_HALF_SOL_LP']};
}
