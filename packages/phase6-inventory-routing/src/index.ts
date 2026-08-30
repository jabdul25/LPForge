// LPFORGE_PHASE6_MAINNET_MODULE
import type {Phase3Orientation,Phase3StrategyFamily} from '../../contracts/src/index.js';
import { quoteMeteoraFundingFromSolCapital, quoteMeteoraPairedTokenForYDeposit } from '../../meteora-execution/src/index.js';
import type { SwapQuoteAssessment } from '../../phase6-swap-quote/src/index.js';

export interface Phase6EntryFundingPlan {strategy:Phase3StrategyFamily;orientation:Phase3Orientation;pairedTokenTargetBps:number;solForLpLamports:bigint;solToPairedTokenLamports:bigint;lowerBinId:number;upperBinId:number;reasonCodes:string[];}

/** Converts the autonomous strategy winner into its asset-funding sequence. SOL is token Y for the configured DLMM pools. */
function pairedTokenTargetBps(orientation:Phase3Orientation,activeBinId:number,weights:Array<{binId:number;weight:number}>|undefined):number{
  if(orientation==='ONE_SIDED_Y')return 0;if(orientation==='ONE_SIDED_X')return 10_000;if(orientation==='BALANCED')return 5_000;
  if(!weights?.length)throw new Error('LPFORGE_P6_SKEWED_ENTRY_WEIGHTS_REQUIRED');const total=weights.reduce((sum,row)=>sum+row.weight,0),xSide=weights.filter(row=>row.binId>=activeBinId).reduce((sum,row)=>sum+row.weight,0);if(!(total>0)||!Number.isFinite(total)||!Number.isFinite(xSide))throw new Error('LPFORGE_P6_SKEWED_ENTRY_WEIGHTS_INVALID');return Math.max(0,Math.min(10_000,Math.round(xSide/total*10_000)));
}
export function planPhase6SolEntryFunding(input:{strategy:Phase3StrategyFamily;orientation?:Phase3Orientation;capitalLamports:bigint;activeBinId:number;lowerBinId:number;upperBinId:number;perBinWeights?:Array<{binId:number;weight:number}>}):Phase6EntryFundingPlan{
  if(input.capitalLamports<2n)throw new Error('LPFORGE_P6_ENTRY_CAPITAL_TOO_SMALL');if(!Number.isInteger(input.activeBinId)||!Number.isInteger(input.lowerBinId)||!Number.isInteger(input.upperBinId)||input.lowerBinId>input.upperBinId)throw new Error('LPFORGE_P6_ENTRY_RANGE_INVALID');
  const orientation=input.orientation??'BALANCED';if(orientation==='ONE_SIDED_X'||orientation==='SKEWED_X')throw new Error('LPFORGE_P6_TOKEN_SIDED_ENTRY_NOT_ENABLED');const targetBps=pairedTokenTargetBps(orientation,input.activeBinId,input.perBinWeights);const solToPairedTokenLamports=input.capitalLamports*BigInt(targetBps)/10_000n;const reason=orientation==='ONE_SIDED_Y'?'P6_SOL_SIDED_ENTRY_NO_SWAP':orientation==='BALANCED'?'P6_BALANCED_ENTRY_PRELIMINARY_SPLIT':'P6_SOL_SKEWED_ENTRY_PRELIMINARY_SPLIT';return{strategy:input.strategy,orientation,pairedTokenTargetBps:targetBps,solForLpLamports:input.capitalLamports-solToPairedTokenLamports,solToPairedTokenLamports,lowerBinId:input.lowerBinId,upperBinId:input.upperBinId,reasonCodes:[reason,'P6_ENTRY_REQUIRES_SDK_FINAL_FUNDING_QUOTE']};
}
export interface Phase6ExactEntryFundingPlan extends Phase6EntryFundingPlan {totalPairedTokenRaw:bigint;sdkVersion:string;}
export async function quotePhase6ExactSolEntryFunding(input:{strategy:Phase3StrategyFamily;orientation:Phase3Orientation;capitalLamports:bigint;activeBinId:number;binStep:number;lowerBinId:number;upperBinId:number;activeBinXAmount:string|bigint;activeBinYAmount:string|bigint;perBinWeights?:Array<{binId:number;weight:number}>}):Promise<Phase6ExactEntryFundingPlan>{
  const preliminary=planPhase6SolEntryFunding(input);if(preliminary.orientation==='ONE_SIDED_X'||preliminary.orientation==='SKEWED_X')throw new Error('LPFORGE_P6_TOKEN_SIDED_ENTRY_NOT_ENABLED');const quote=await quoteMeteoraFundingFromSolCapital({strategy:input.strategy,orientation:preliminary.orientation,capitalYAmount:input.capitalLamports,activeBinId:input.activeBinId,binStep:input.binStep,lowerBinId:input.lowerBinId,upperBinId:input.upperBinId,activeBinXAmount:input.activeBinXAmount,activeBinYAmount:input.activeBinYAmount});const cost=BigInt(quote.pairedTokenCostInYRaw),used=BigInt(quote.capitalUsedYRaw);return{...preliminary,pairedTokenTargetBps:input.capitalLamports>0n?Number(cost*10_000n/input.capitalLamports):0,solForLpLamports:BigInt(quote.totalYAmount),solToPairedTokenLamports:cost,totalPairedTokenRaw:BigInt(quote.totalXAmount),sdkVersion:quote.sdkVersion,reasonCodes:[...preliminary.reasonCodes,'P6_METEORA_SDK_FINAL_FUNDING_QUOTE',...(used<input.capitalLamports?['P6_CAPITAL_ROUNDING_REMAINDER_RESERVED']:[])]};
}

/** The P6 quote provider remains ExactIn.  Eight bounded route quotes are
 * sufficient to refine the native/token split without turning a live P4
 * cadence into an unbounded quote loop. */
export const P6_PROTECTED_FUNDING_MAX_QUOTE_ATTEMPTS=8;
export type ProtectedFundingQuoteAssessment=SwapQuoteAssessment;
export type ProtectedFundingResult=
  | {status:'APPROVED';funding:Phase6ExactEntryFundingPlan;swapQuote:ProtectedFundingQuoteAssessment;quoteIterations:number}
  | {status:'INFEASIBLE'|'REJECTED'|'UNAVAILABLE';swapQuote?:ProtectedFundingQuoteAssessment;quoteIterations:number;reasonCodes:string[]};

/**
 * Finds the largest native-liquidity amount (and therefore the smallest
 * ExactIn swap) for which Jupiter's protected output funds the SDK's exact
 * X requirement.  Each trial rebuilds the requirement from its own Y amount;
 * no nominal pre-split requirement may be reused after the split moves.
 */
export async function solveProtectedExactSolFunding(input:{capitalLamports:bigint;initialFunding:Phase6ExactEntryFundingPlan;fundingForNativeLamports:(nativeLamports:bigint)=>Promise<{totalPairedTokenRaw:bigint;sdkVersion:string}>;quoteForFunding:(swapInputLamports:bigint,requiredPairedTokenRaw:bigint)=>Promise<ProtectedFundingQuoteAssessment>;maxQuoteAttempts?:number}):Promise<ProtectedFundingResult>{
  if(input.initialFunding.solToPairedTokenLamports===0n)return{status:'APPROVED',funding:input.initialFunding,swapQuote:{status:'APPROVED',reasonCodes:['P6_SWAP_NOT_REQUIRED']},quoteIterations:0};
  if(input.capitalLamports<2n||input.initialFunding.solForLpLamports<1n)return{status:'INFEASIBLE',quoteIterations:0,reasonCodes:['P6_PROTECTED_FUNDING_CAPITAL_INVALID']};
  const maxAttempts=input.maxQuoteAttempts??P6_PROTECTED_FUNDING_MAX_QUOTE_ATTEMPTS;
  if(!Number.isInteger(maxAttempts)||maxAttempts<2)throw new Error('LPFORGE_P6_PROTECTED_FUNDING_ATTEMPTS_INVALID');
  let attempts=0;
  const evaluate=async(nativeLamports:bigint)=>{
    const requirement=await input.fundingForNativeLamports(nativeLamports),swapInput=input.capitalLamports-nativeLamports,swapQuote=await input.quoteForFunding(swapInput,requirement.totalPairedTokenRaw);attempts++;
    const funding:Phase6ExactEntryFundingPlan={...input.initialFunding,pairedTokenTargetBps:Number(swapInput*10_000n/input.capitalLamports),solForLpLamports:nativeLamports,solToPairedTokenLamports:swapInput,totalPairedTokenRaw:requirement.totalPairedTokenRaw,sdkVersion:requirement.sdkVersion,reasonCodes:[...input.initialFunding.reasonCodes,'P6_PROTECTED_FUNDING_FINAL_METEORA_RECOMPUTED','P6_PROTECTED_FUNDING_EXACT_CAPITAL_SPLIT']};
    return{nativeLamports,swapQuote,funding};
  };
  const onlyFundingShortfall=(quote:ProtectedFundingQuoteAssessment)=>quote.status==='REJECTED'&&quote.reasonCodes.length>0&&quote.reasonCodes.every(reason=>reason==='P6_SWAP_QUOTE_MIN_OUTPUT_INSUFFICIENT');
  const initial=await evaluate(input.initialFunding.solForLpLamports);
  if(initial.swapQuote.status==='APPROVED')return{status:'APPROVED',funding:initial.funding,swapQuote:initial.swapQuote,quoteIterations:attempts};
  if(!onlyFundingShortfall(initial.swapQuote))return{status:initial.swapQuote.status,swapQuote:initial.swapQuote,quoteIterations:attempts,reasonCodes:initial.swapQuote.reasonCodes};
  const minimumNative=1n;
  if(attempts>=maxAttempts)return{status:'INFEASIBLE',swapQuote:initial.swapQuote,quoteIterations:attempts,reasonCodes:['P6_PROTECTED_FUNDING_SOLVER_ATTEMPT_LIMIT',...initial.swapQuote.reasonCodes]};
  const low=await evaluate(minimumNative);
  if(low.swapQuote.status!=='APPROVED')return{status:low.swapQuote.status==='UNAVAILABLE'?'UNAVAILABLE':'INFEASIBLE',swapQuote:low.swapQuote,quoteIterations:attempts,reasonCodes:['P6_PROTECTED_FUNDING_INFEASIBLE_WITHIN_EXACT_CAPITAL',...low.swapQuote.reasonCodes]};
  let best=low,lower=minimumNative,upper=input.initialFunding.solForLpLamports-1n;
  while(lower<=upper&&attempts<maxAttempts){
    const middle=(lower+upper+1n)/2n,next=await evaluate(middle);
    if(next.swapQuote.status==='APPROVED'){best=next;lower=middle;continue;}
    if(!onlyFundingShortfall(next.swapQuote))return{status:next.swapQuote.status,swapQuote:next.swapQuote,quoteIterations:attempts,reasonCodes:next.swapQuote.reasonCodes};
    upper=middle-1n;
  }
  return{status:'APPROVED',funding:{...best.funding,reasonCodes:[...best.funding.reasonCodes,'P6_PROTECTED_FUNDING_SOLVER_APPROVED']},swapQuote:best.swapQuote,quoteIterations:attempts};
}

export async function resolveProtectedPhase6ExactSolEntryFunding(input:{strategy:Phase3StrategyFamily;orientation:Phase3Orientation;capitalLamports:bigint;activeBinId:number;binStep:number;lowerBinId:number;upperBinId:number;activeBinXAmount:string|bigint;activeBinYAmount:string|bigint;perBinWeights?:Array<{binId:number;weight:number}>;quoteForFunding:(swapInputLamports:bigint,requiredPairedTokenRaw:bigint)=>Promise<ProtectedFundingQuoteAssessment>;maxQuoteAttempts?:number}):Promise<ProtectedFundingResult>{
  const initialFunding=await quotePhase6ExactSolEntryFunding(input);
  return solveProtectedExactSolFunding({capitalLamports:input.capitalLamports,initialFunding,...(input.maxQuoteAttempts===undefined?{}:{maxQuoteAttempts:input.maxQuoteAttempts}),quoteForFunding:input.quoteForFunding,fundingForNativeLamports:async nativeLamports=>{const quote=await quoteMeteoraPairedTokenForYDeposit({strategy:input.strategy,activeBinId:input.activeBinId,binStep:input.binStep,lowerBinId:input.lowerBinId,upperBinId:input.upperBinId,targetYAmount:nativeLamports,activeBinXAmount:input.activeBinXAmount,activeBinYAmount:input.activeBinYAmount});return{totalPairedTokenRaw:BigInt(quote.totalXAmount),sdkVersion:quote.sdkVersion};}});
}
