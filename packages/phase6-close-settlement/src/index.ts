import type { ConfirmedExecutionReceipt } from "../../transaction-receipt/src/index.js";
import type { NativeAssetEffect, TokenAssetEffect, TransactionAssetEffects } from "../../transaction-asset-effects/src/index.js";

export type CloseUnwindSettlementState = "SETTLED" | "MISSING_OUTPUT" | "INPUT_UNCORROBORATED" | "UNCLASSIFIED" | "FAILED_TRANSACTION";
export type CloseUnwindInputProof = "TOKEN_BALANCE" | "DECODED_JUPITER_INSTRUCTION";
export interface CloseUnwindSettlement {
  state: CloseUnwindSettlementState;
  reasonCodes: string[];
  swapProceedsLamports?: bigint;
  inputCorroborated: boolean;
  inputProof?: CloseUnwindInputProof;
  outputEffects: Array<NativeAssetEffect | TokenAssetEffect>;
}

function outputLamports(effect:NativeAssetEffect|TokenAssetEffect,outputMint:string):bigint|undefined{
  if("mint" in effect)return effect.mint===outputMint&&effect.decimals===9?effect.rawAmount:undefined;
  return effect.amountLamports;
}

const record=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const text=(value:unknown):string|undefined=>typeof value==="string"&&value.length>0?value:undefined;
const rawAmount=(value:unknown):bigint|undefined=>{
  if(typeof value==="bigint")return value>=0n?value:undefined;
  if(typeof value==="string"&&/^\d+$/.test(value))return BigInt(value);
  if(typeof value==="number"&&Number.isSafeInteger(value)&&value>=0)return BigInt(value);
  return undefined;
};

/**
 * The quote builder requires an exact input amount for a CLOSE unwind.  A
 * canonical Stage-2 SWAP_INPUT effect is therefore sufficient only when it
 * identifies the expected owner, mint and exactly that requested raw amount.
 */
function tokenBalanceInputProof(input:{effects:TransactionAssetEffects;ownerAddress:string;inputMint:string;inputAmountRaw:bigint}):CloseUnwindInputProof|undefined{
  return input.effects.swapInputEffects.some(effect=>
    "mint" in effect&&
    effect.mint===input.inputMint&&
    effect.owner===input.ownerAddress&&
    effect.accountAddress.length>0&&
    effect.deltaRaw<0n&&
    effect.rawAmount===input.inputAmountRaw,
  )?"TOKEN_BALANCE":undefined;
}

function instructionProgramId(instruction:Record<string,unknown>,receipt:ConfirmedExecutionReceipt):string|undefined{
  const direct=text(instruction.programId);
  if(direct)return direct;
  const index=instruction.programIdIndex;
  return typeof index==="number"&&Number.isInteger(index)&&index>=0?receipt.resolvedAccountKeys[index]:undefined;
}

function instructionAccountKeys(instruction:Record<string,unknown>,receipt:ConfirmedExecutionReceipt):string[]{
  const rows=Array.isArray(instruction.accountKeyIndexes)?instruction.accountKeyIndexes:Array.isArray(instruction.accounts)?instruction.accounts:[];
  return rows.flatMap(value=>{
    if(typeof value==="number"&&Number.isInteger(value)&&value>=0)return receipt.resolvedAccountKeys[value]?[receipt.resolvedAccountKeys[value]!]:[];
    return text(value)?[text(value)!]:[];
  });
}

function allReceiptInstructions(receipt:ConfirmedExecutionReceipt):Record<string,unknown>[] {
  const inner=receipt.innerInstructions.flatMap(row=>{
    const value=record(row);
    return Array.isArray(value?.instructions)?value.instructions:[];
  });
  return [...receipt.outerInstructions,...inner].flatMap(row=>{
    const value=record(row);
    return value?[value]:[];
  });
}

/**
 * This intentionally accepts only a fully decoded Jupiter input instruction.
 * Seeing the Jupiter program alone, or a transfer without the expected mint,
 * authority, source and raw amount, is not proof that this unwind consumed
 * the intended risky asset.
 */
function decodedJupiterInputProof(input:{receipt:ConfirmedExecutionReceipt;ownerAddress:string;inputMint:string;inputAmountRaw:bigint;jupiterProgramIds:readonly string[]}):CloseUnwindInputProof|undefined{
  for(const instruction of allReceiptInstructions(input.receipt)){
    if(!input.jupiterProgramIds.includes(instructionProgramId(instruction,input.receipt)??""))continue;
    const parsed=record(instruction.parsed),info=record(parsed?.info),type=text(parsed?.type);
    if(!info||type!=="swapInput")continue;
    const mint=text(info.inputMint)??text(info.mint),
      owner=text(info.owner)??text(info.authority),
      source=text(info.source)??text(info.sourceTokenAccount),
      amount=rawAmount(info.amount)??rawAmount(info.inputAmount);
    if(mint!==input.inputMint||owner!==input.ownerAddress||amount!==input.inputAmountRaw||!source)continue;
    // A decoded proof must refer to message accounts, rather than merely
    // carrying arbitrary strings in an RPC parser projection.
    if(!input.receipt.resolvedAccountKeys.includes(owner)||!input.receipt.resolvedAccountKeys.includes(source))continue;
    const accounts=instructionAccountKeys(instruction,input.receipt);
    if(!accounts.includes(owner)||!accounts.includes(source))continue;
    return "DECODED_JUPITER_INSTRUCTION";
  }
  return undefined;
}

/**
 * Converts only canonical SWAP_OUTPUT effects into the SOL-equivalent cashflow
 * used by CLOSE settlement. Representation effects, rent and fee effects are
 * intentionally absent from this projection.
 */
export function deriveCloseUnwindSettlement(input:{receipt:ConfirmedExecutionReceipt;effects:TransactionAssetEffects;ownerAddress:string;inputMint:string;inputAmountRaw:bigint;outputMint:string;jupiterProgramIds?:readonly string[]}):CloseUnwindSettlement{
  if(input.receipt.state!=="CONFIRMED_SUCCESS")return{state:"FAILED_TRANSACTION",reasonCodes:[`P6_CLOSE_SETTLEMENT_RECEIPT_${input.receipt.state}`],inputCorroborated:false,outputEffects:[]};
  if(input.effects.classificationState!=="FULLY_CLASSIFIED")return{state:"UNCLASSIFIED",reasonCodes:["P6_CLOSE_SETTLEMENT_EFFECT_UNCLASSIFIED",...input.effects.reasonCodes],inputCorroborated:false,outputEffects:[]};
  const outputEffects=input.effects.swapOutputEffects;
  let proceeds=0n;
  for(const effect of outputEffects){const amount=outputLamports(effect,input.outputMint);if(amount===undefined)return{state:"UNCLASSIFIED",reasonCodes:["P6_CLOSE_SETTLEMENT_OUTPUT_EFFECT_INVALID"],inputCorroborated:false,outputEffects};proceeds+=amount;}
  const inputProof=tokenBalanceInputProof(input)??decodedJupiterInputProof({
    receipt:input.receipt,
    ownerAddress:input.ownerAddress,
    inputMint:input.inputMint,
    inputAmountRaw:input.inputAmountRaw,
    jupiterProgramIds:input.jupiterProgramIds??[],
  }),inputCorroborated=inputProof!==undefined;
  if(proceeds<=0n)return{state:"MISSING_OUTPUT",reasonCodes:["P6_CLOSE_UNWIND_OUTPUT_MISSING"],inputCorroborated,outputEffects};
  if(!inputProof)return{state:"INPUT_UNCORROBORATED",reasonCodes:["P6_CLOSE_INPUT_CONSUMPTION_UNCORROBORATED"],inputCorroborated:false,outputEffects};
  return{state:"SETTLED",reasonCodes:["P6_CLOSE_UNWIND_SETTLED"],swapProceedsLamports:proceeds,inputCorroborated,inputProof,outputEffects};
}

export function closeUnwindSettlementIds(planId:string):{cashflowId:string;lotEventId:string}{return{cashflowId:`${planId}:close-swap-proceeds`,lotEventId:`${planId}:close-x:lot-settled`};}
