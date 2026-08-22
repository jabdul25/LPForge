import type { ConfirmedExecutionReceipt, ReceiptTokenBalance } from "../../transaction-receipt/src/index.js";

export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export type AssetEffectClassification =
  | "SWAP_INPUT" | "SWAP_OUTPUT" | "TRANSACTION_FEE"
  | "ATA_RENT_DEBIT" | "ATA_RENT_REFUND"
  | "TEMP_ACCOUNT_RENT_DEBIT" | "TEMP_ACCOUNT_RENT_REFUND"
  | "POSITION_RENT_RECOVERY" | "WSOL_WRAP" | "WSOL_UNWRAP"
  | "OTHER_KNOWN" | "UNCLASSIFIED";
export type AssetEffectDirection = "IN" | "OUT" | "NEUTRAL";
export type TransactionAssetEffectState = "FULLY_CLASSIFIED" | "PARTIALLY_CLASSIFIED" | "AMBIGUOUS";

export interface NativeAssetEffect {
  classification: AssetEffectClassification;
  accountAddress: string;
  accountIndex: number;
  amountLamports?: bigint;
  direction: AssetEffectDirection;
  evidence: string[];
}
export interface TokenAssetEffect {
  classification: AssetEffectClassification;
  accountAddress: string;
  accountIndex: number;
  mint: string;
  owner?: string;
  rawAmount: bigint;
  deltaRaw: bigint;
  decimals: number;
  direction: AssetEffectDirection;
  evidence: string[];
}
export interface TransactionAssetEffects {
  signature: string;
  ownerAddress: string;
  ownerAccountIndex?: number;
  nativeWalletDeltaLamports?: bigint;
  tokenEffects: TokenAssetEffect[];
  transactionFeeLamports?: bigint;
  transactionFeeEffect?: NativeAssetEffect;
  swapInputEffects: Array<NativeAssetEffect | TokenAssetEffect>;
  swapOutputEffects: Array<NativeAssetEffect | TokenAssetEffect>;
  rentDebits: NativeAssetEffect[];
  rentRefunds: NativeAssetEffect[];
  positionRentRecoveryLamports: bigint;
  positionRentRecoveryEffects: NativeAssetEffect[];
  wsolWrapEffects: TokenAssetEffect[];
  wsolUnwrapEffects: TokenAssetEffect[];
  knownOtherEffects: NativeAssetEffect[];
  unclassifiedNativeEffects: NativeAssetEffect[];
  unclassifiedTokenEffects: TokenAssetEffect[];
  classificationState: TransactionAssetEffectState;
  reasonCodes: string[];
}
export interface TransactionAssetEffectContext {
  ownerAddress: string;
  /** Fee attribution affects owner reconciliation only when this is supplied. */
  feePayerAddress?: string;
  positionAddress?: string;
  inputMint?: string;
  outputMint?: string;
  /** A route is a swap only when a configured Jupiter program is present. */
  jupiterProgramIds?: readonly string[];
  associatedTokenAccountAddresses?: readonly string[];
  temporaryAccountAddresses?: readonly string[];
}

type UnknownRecord = Record<string, unknown>;
interface InstructionEvidence { programId?: string; accountIndices: number[]; type?: string; ownerDestination?: string; }
const record=(value:unknown):UnknownRecord|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as UnknownRecord:undefined;
const publicKey=(value:unknown):string|undefined=>{if(typeof value==='string')return value;const candidate=value as {toBase58?:unknown};return typeof candidate?.toBase58==='function'?candidate.toBase58() as string:undefined;};
const direction=(delta:bigint):AssetEffectDirection=>delta>0n?"IN":delta<0n?"OUT":"NEUTRAL";
const lower=(value:unknown):string|undefined=>typeof value==='string'?value.toLowerCase():undefined;
function instructionEvidence(receipt:ConfirmedExecutionReceipt):InstructionEvidence[]{
  const rows:unknown[]=[...receipt.outerInstructions];
  for(const entry of receipt.innerInstructions){const nested=record(entry)?.instructions;if(Array.isArray(nested))rows.push(...nested);}
  return rows.map(row=>{
    const value=record(row),parsed=record(value?.parsed),info=record(parsed?.info),programFromIndex=typeof value?.programIdIndex==='number'?receipt.resolvedAccountKeys[value.programIdIndex]:undefined;
    const accounts=Array.isArray(value?.accountKeyIndexes)?value.accountKeyIndexes.filter((x):x is number=>typeof x==='number'&&Number.isInteger(x)):Array.isArray(value?.accounts)?value.accounts.flatMap(account=>typeof account==='number'&&Number.isInteger(account)?[account]:publicKey(account)?[receipt.resolvedAccountKeys.indexOf(publicKey(account)!)].filter(index=>index>=0):[]):[];
    const type=typeof parsed?.type==='string'?parsed.type:typeof value?.type==='string'?value.type:undefined;
    const destination=publicKey(info?.destination)??publicKey(info?.account)??publicKey(info?.wallet);
    const programId=publicKey(value?.programId)??programFromIndex;
    return {accountIndices:accounts,...(programId===undefined?{}:{programId}),...(type===undefined?{}:{type}),...(destination===undefined?{}:{ownerDestination:destination})};
  });
}
function instructionTouches(instructions:readonly InstructionEvidence[],accountIndex:number,ownerIndex:number,ownerAddress:string,kind:"CREATE"|"CLOSE"|"WRAP"|"UNWRAP",programIds?:readonly string[]):boolean{
  return instructions.some(instruction=>{
    const type=lower(instruction.type)??"",programOk=!programIds||programIds.includes(instruction.programId??"");
    const accountOk=instruction.accountIndices.includes(accountIndex),ownerOk=instruction.accountIndices.includes(ownerIndex)||instruction.ownerDestination===ownerAddress;
    const kindOk=kind==="CREATE"?(type.includes("create")||type.includes("initialize")):kind==="CLOSE"?type.includes("close"):kind==="WRAP"?(type.includes("syncnative")||type.includes("wrap")):(type.includes("close")||type.includes("unwrap"));
    return accountOk&&ownerOk&&programOk&&kindOk;
  });
}
const receiptSucceeded=(receipt:ConfirmedExecutionReceipt)=>receipt.state==="CONFIRMED_SUCCESS";
const native=(classification:AssetEffectClassification,receipt:ConfirmedExecutionReceipt,index:number,amountLamports:bigint|undefined,evidence:string[]):NativeAssetEffect=>({classification,accountAddress:receipt.resolvedAccountKeys[index]??"UNRESOLVED",accountIndex:index,...(amountLamports===undefined?{}:{amountLamports}),direction:direction(amountLamports===undefined?0n:classification.endsWith("DEBIT")||classification==="TRANSACTION_FEE"?-amountLamports:amountLamports),evidence});
function tokenMap(rows:readonly ReceiptTokenBalance[]):Map<string,ReceiptTokenBalance>{return new Map(rows.map(row=>[`${row.resolvedAccountAddress}|${row.mint}|${row.owner??""}`,row]));}

export function deriveTransactionAssetEffects(receipt:ConfirmedExecutionReceipt,context:TransactionAssetEffectContext):TransactionAssetEffects{
  const base:TransactionAssetEffects={signature:receipt.signature,ownerAddress:context.ownerAddress,tokenEffects:[],swapInputEffects:[],swapOutputEffects:[],rentDebits:[],rentRefunds:[],positionRentRecoveryLamports:0n,positionRentRecoveryEffects:[],wsolWrapEffects:[],wsolUnwrapEffects:[],knownOtherEffects:[],unclassifiedNativeEffects:[],unclassifiedTokenEffects:[],classificationState:"AMBIGUOUS",reasonCodes:[]};
  if(!receiptSucceeded(receipt)){base.reasonCodes.push(`P6_EFFECT_RECEIPT_${receipt.state}`);return base;}
  const ownerIndex=receipt.resolvedAccountKeys.indexOf(context.ownerAddress);
  if(ownerIndex<0){base.reasonCodes.push("P6_EFFECT_OWNER_ACCOUNT_UNRESOLVED");return base;}
  base.ownerAccountIndex=ownerIndex;
  const ownerDelta=receipt.postBalancesLamports[ownerIndex]! - receipt.preBalancesLamports[ownerIndex]!;
  base.nativeWalletDeltaLamports=ownerDelta;
  if(receipt.feeLamports!==undefined)base.transactionFeeLamports=receipt.feeLamports;
  const instructions=instructionEvidence(receipt),jupiterPrograms=new Set(context.jupiterProgramIds??[]),hasJupiter=instructions.some(instruction=>instruction.programId!==undefined&&jupiterPrograms.has(instruction.programId))||receipt.logMessages.some(log=>[...jupiterPrograms].some(program=>log.includes(program)));
  const associatedAddresses=new Set(context.associatedTokenAccountAddresses??[]),temporaryAddresses=new Set(context.temporaryAccountAddresses??[]);
  let accountedNative=0n,partialLifecycle=false;
  if(receipt.feeLamports!==undefined){base.transactionFeeEffect={classification:"TRANSACTION_FEE",accountAddress:context.feePayerAddress??"UNATTRIBUTED_FEE_PAYER",accountIndex:context.feePayerAddress?receipt.resolvedAccountKeys.indexOf(context.feePayerAddress):-1,amountLamports:receipt.feeLamports,direction:"OUT",evidence:["receipt.meta.fee"]};if(context.feePayerAddress===context.ownerAddress)accountedNative-=receipt.feeLamports;}
  for(let index=0;index<receipt.resolvedAccountKeys.length;index++){
    const before=receipt.preBalancesLamports[index]!,after=receipt.postBalancesLamports[index]!,address=receipt.resolvedAccountKeys[index]!;
    const created=before===0n&&after>0n,closed=before>0n&&after===0n;
    if(!created&&!closed)continue;
    const ata=associatedAddresses.has(address)||instructionTouches(instructions,index,ownerIndex,context.ownerAddress,"CREATE",[ASSOCIATED_TOKEN_PROGRAM_ID]);
    const temporary=temporaryAddresses.has(address)||(!ata&&hasJupiter&&(instructionTouches(instructions,index,ownerIndex,context.ownerAddress,"CREATE")||instructionTouches(instructions,index,ownerIndex,context.ownerAddress,"CLOSE")));
    const position=context.positionAddress===address;
    const lifecycleInstruction=instructionTouches(instructions,index,ownerIndex,context.ownerAddress,created?"CREATE":"CLOSE");
    if(!lifecycleInstruction){partialLifecycle=true;continue;}
    if(created){const classification=ata?"ATA_RENT_DEBIT":temporary?"TEMP_ACCOUNT_RENT_DEBIT":"UNCLASSIFIED",effect=native(classification,receipt,index,after,["account-created","instruction-lifecycle"]);if(classification==="UNCLASSIFIED")base.unclassifiedNativeEffects.push(effect);else{base.rentDebits.push(effect);accountedNative-=after;}}
    if(closed){const classification=position?"POSITION_RENT_RECOVERY":ata?"ATA_RENT_REFUND":temporary?"TEMP_ACCOUNT_RENT_REFUND":"UNCLASSIFIED",effect=native(classification,receipt,index,before,["account-closed","instruction-lifecycle"]);if(classification==="UNCLASSIFIED")base.unclassifiedNativeEffects.push(effect);else if(classification==="POSITION_RENT_RECOVERY"){base.positionRentRecoveryEffects.push(effect);base.positionRentRecoveryLamports+=before;accountedNative+=before;}else{base.rentRefunds.push(effect);accountedNative+=before;}}
  }
  const before=tokenMap(receipt.preTokenBalances),after=tokenMap(receipt.postTokenBalances),keys=new Set([...before.keys(),...after.keys()]);
  for(const key of keys){const pre=before.get(key),post=after.get(key),row=post??pre!;if(row.owner!==context.ownerAddress)continue;const delta=(post?.rawAmount??0n)-(pre?.rawAmount??0n);if(delta===0n)continue;const isWsol=row.mint===WSOL_MINT,wrap=isWsol&&delta>0n&&instructionTouches(instructions,row.accountIndex,ownerIndex,context.ownerAddress,"WRAP",[TOKEN_PROGRAM_ID]),unwrap=isWsol&&delta<0n&&instructionTouches(instructions,row.accountIndex,ownerIndex,context.ownerAddress,"UNWRAP",[TOKEN_PROGRAM_ID]);let classification:AssetEffectClassification="UNCLASSIFIED",evidence=["receipt.token-balances"];
    if(wrap){classification="WSOL_WRAP";evidence.push("spl-token-sync-native");}
    else if(unwrap){classification="WSOL_UNWRAP";evidence.push("spl-token-close-account");}
    else if(hasJupiter&&context.inputMint===row.mint&&delta<0n){classification="SWAP_INPUT";evidence.push("jupiter-program-and-input-mint");}
    else if(hasJupiter&&context.outputMint===row.mint&&delta>0n){classification="SWAP_OUTPUT";evidence.push("jupiter-program-and-output-mint");}
    const effect:TokenAssetEffect={classification,accountAddress:row.resolvedAccountAddress,accountIndex:row.accountIndex,mint:row.mint,...(row.owner?{owner:row.owner}:{}),rawAmount:delta<0n?-delta:delta,deltaRaw:delta,decimals:row.decimals,direction:direction(delta),evidence};base.tokenEffects.push(effect);
    if(classification==="SWAP_INPUT")base.swapInputEffects.push(effect);else if(classification==="SWAP_OUTPUT")base.swapOutputEffects.push(effect);else if(classification==="WSOL_WRAP"){base.wsolWrapEffects.push(effect);if(row.decimals===9)accountedNative-=effect.rawAmount;else base.unclassifiedTokenEffects.push(effect);}else if(classification==="WSOL_UNWRAP"){base.wsolUnwrapEffects.push(effect);if(row.decimals===9)accountedNative+=effect.rawAmount;else base.unclassifiedTokenEffects.push(effect);}else base.unclassifiedTokenEffects.push(effect);
  }
  let residual=ownerDelta-accountedNative;
  const supportedNativeOutput=residual>0n&&hasJupiter&&context.outputMint===WSOL_MINT&&base.swapInputEffects.length>0&&base.unclassifiedNativeEffects.length===0&&base.unclassifiedTokenEffects.length===0;
  if(supportedNativeOutput){const effect:NativeAssetEffect={classification:"SWAP_OUTPUT",accountAddress:context.ownerAddress,accountIndex:ownerIndex,amountLamports:residual,direction:"IN",evidence:["owner-native-residual","jupiter-program","supported-input-mint","wsol-output-context"]};base.swapOutputEffects.push(effect);accountedNative+=residual;residual=0n;}
  if(residual!==0n)base.unclassifiedNativeEffects.push({classification:"UNCLASSIFIED",accountAddress:context.ownerAddress,accountIndex:ownerIndex,amountLamports:residual<0n?-residual:residual,direction:direction(residual),evidence:["owner-native-balance-residual"]});
  const materialUnknown=base.unclassifiedNativeEffects.some(effect=>(effect.amountLamports??0n)!==0n)||base.unclassifiedTokenEffects.some(effect=>effect.deltaRaw!==0n);
  base.classificationState=materialUnknown?"AMBIGUOUS":partialLifecycle?"PARTIALLY_CLASSIFIED":"FULLY_CLASSIFIED";
  if(materialUnknown)base.reasonCodes.push("P6_EFFECT_UNCLASSIFIED_MATERIAL");if(partialLifecycle)base.reasonCodes.push("P6_EFFECT_LIFECYCLE_AMOUNT_UNAVAILABLE");return base;
}
