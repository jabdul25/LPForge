import type { ConfirmedExecutionReceipt } from "../../transaction-receipt/src/index.js";
import type { NativeAssetEffect, TokenAssetEffect, TransactionAssetEffects } from "../../transaction-asset-effects/src/index.js";

export type CloseUnwindSettlementState = "SETTLED" | "MISSING_OUTPUT" | "UNCLASSIFIED" | "FAILED_TRANSACTION";
export interface CloseUnwindSettlement {
  state: CloseUnwindSettlementState;
  reasonCodes: string[];
  swapProceedsLamports?: bigint;
  inputCorroborated: boolean;
  outputEffects: Array<NativeAssetEffect | TokenAssetEffect>;
}

function outputLamports(effect:NativeAssetEffect|TokenAssetEffect,outputMint:string):bigint|undefined{
  if("mint" in effect)return effect.mint===outputMint&&effect.decimals===9?effect.rawAmount:undefined;
  return effect.amountLamports;
}

/**
 * Converts only canonical SWAP_OUTPUT effects into the SOL-equivalent cashflow
 * used by CLOSE settlement. Representation effects, rent and fee effects are
 * intentionally absent from this projection.
 */
export function deriveCloseUnwindSettlement(input:{receipt:ConfirmedExecutionReceipt;effects:TransactionAssetEffects;inputMint:string;outputMint:string}):CloseUnwindSettlement{
  if(input.receipt.state!=="CONFIRMED_SUCCESS")return{state:"FAILED_TRANSACTION",reasonCodes:[`P6_CLOSE_SETTLEMENT_RECEIPT_${input.receipt.state}`],inputCorroborated:false,outputEffects:[]};
  if(input.effects.classificationState!=="FULLY_CLASSIFIED")return{state:"UNCLASSIFIED",reasonCodes:["P6_CLOSE_SETTLEMENT_EFFECT_UNCLASSIFIED",...input.effects.reasonCodes],inputCorroborated:false,outputEffects:[]};
  const outputEffects=input.effects.swapOutputEffects;
  let proceeds=0n;
  for(const effect of outputEffects){const amount=outputLamports(effect,input.outputMint);if(amount===undefined)return{state:"UNCLASSIFIED",reasonCodes:["P6_CLOSE_SETTLEMENT_OUTPUT_EFFECT_INVALID"],inputCorroborated:false,outputEffects};proceeds+=amount;}
  const inputCorroborated=input.effects.swapInputEffects.some(effect=>"mint" in effect&&effect.mint===input.inputMint&&effect.deltaRaw<0n);
  if(proceeds<=0n)return{state:"MISSING_OUTPUT",reasonCodes:["P6_CLOSE_UNWIND_OUTPUT_MISSING"],inputCorroborated,outputEffects};
  return{state:"SETTLED",reasonCodes:["P6_CLOSE_UNWIND_SETTLED"],swapProceedsLamports:proceeds,inputCorroborated,outputEffects};
}

export function closeUnwindSettlementIds(planId:string):{cashflowId:string;lotEventId:string}{return{cashflowId:`${planId}:close-swap-proceeds`,lotEventId:`${planId}:close-x:lot-settled`};}
