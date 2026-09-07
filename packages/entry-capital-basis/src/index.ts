import type { ConfirmedExecutionReceipt } from '../../transaction-receipt/src/index.js';
import { deriveTransactionAssetEffects, WSOL_MINT } from '../../transaction-asset-effects/src/index.js';

export interface ReceiptBoundSolContribution {
  signature: string;
  principalLamports: bigint;
  transactionFeeLamports: bigint;
  recoverableRentDebitsLamports: bigint;
  recoverableRentRefundsLamports: bigint;
  reasonCodes: string[];
}

/**
 * Classifies a P6-owned receipt without using a live wallet snapshot.  Native
 * SOL and WSOL are one asset; account rent is explicitly removed from the
 * economic principal and any rent refund is added back before the principal
 * is determined.  This is intentionally receipt-bound so a later ATA create
 * or close cannot change the original entry basis.
 */
export function deriveReceiptBoundSolContribution(input:{receipt:ConfirmedExecutionReceipt;ownerAddress:string;feePayerAddress?:string;positionAddress?:string}):ReceiptBoundSolContribution|undefined {
  const effects=deriveTransactionAssetEffects(input.receipt,{ownerAddress:input.ownerAddress,...(input.feePayerAddress?{feePayerAddress:input.feePayerAddress}:{}),...(input.positionAddress?{positionAddress:input.positionAddress}:{})});
  if(input.receipt.state!=='CONFIRMED_SUCCESS'||effects.nativeWalletDeltaLamports===undefined)return undefined;
  const wsolDelta=effects.tokenEffects.filter(effect=>effect.mint===WSOL_MINT).reduce((total,effect)=>total+effect.deltaRaw,0n);
  const netAssetDelta=effects.nativeWalletDeltaLamports+wsolDelta;
  const fee=effects.transactionFeeLamports??0n;
  const rentDebits=effects.rentDebits.reduce((total,effect)=>total+(effect.amountLamports??0n),0n);
  const rentRefunds=effects.rentRefunds.reduce((total,effect)=>total+(effect.amountLamports??0n),0n);
  const grossOut=netAssetDelta<0n?-netAssetDelta-fee:0n;
  const principal=grossOut-rentDebits+rentRefunds;
  if(principal<0n)return undefined;
  return {signature:input.receipt.signature,principalLamports:principal,transactionFeeLamports:fee,recoverableRentDebitsLamports:rentDebits,recoverableRentRefundsLamports:rentRefunds,reasonCodes:[...new Set(effects.reasonCodes)].sort()};
}

export interface ReceiptBoundOpenTokenDebit { mint:string; rawAmount:bigint; }

/** Only owner-token debits are eligible for the position's deposited X leg. */
export function receiptBoundOwnerTokenDebits(input:{receipt:ConfirmedExecutionReceipt;ownerAddress:string;mint:string}):ReceiptBoundOpenTokenDebit[] {
  const effects=deriveTransactionAssetEffects(input.receipt,{ownerAddress:input.ownerAddress});
  if(input.receipt.state!=='CONFIRMED_SUCCESS')return [];
  return effects.tokenEffects.filter(effect=>effect.mint===input.mint&&effect.deltaRaw<0n).map(effect=>({mint:effect.mint,rawAmount:-effect.deltaRaw}));
}

export function deriveReceiptBackedEntryBasis(input:{requestedLiquidityCapitalLamports:bigint;fundingPrincipalLamports:bigint;fundedPairedTokenRaw:bigint;openSolPrincipalLamports:bigint;depositedPairedTokenRaw:bigint;executionCostLamports:bigint;recoverableRentDebitsLamports:bigint;recoverableRentRefundsLamports:bigint}):{lpPositionPrincipalLamports:bigint;managedEconomicContributionLamports:bigint;residualPairedTokenPrincipalLamports:bigint;unclassifiedLamports:bigint;reasonCodes:string[]} {
  const reasons:string[]=[];
  if(input.requestedLiquidityCapitalLamports<=0n||input.fundingPrincipalLamports<0n||input.openSolPrincipalLamports<0n||input.executionCostLamports<0n||input.recoverableRentDebitsLamports<0n||input.recoverableRentRefundsLamports<0n){return{lpPositionPrincipalLamports:0n,managedEconomicContributionLamports:0n,residualPairedTokenPrincipalLamports:0n,unclassifiedLamports:0n,reasonCodes:['ENTRY_BASIS_INPUT_INVALID']};}
  if(input.depositedPairedTokenRaw>input.fundedPairedTokenRaw){return{lpPositionPrincipalLamports:0n,managedEconomicContributionLamports:0n,residualPairedTokenPrincipalLamports:0n,unclassifiedLamports:0n,reasonCodes:['ENTRY_BASIS_PAIRED_TOKEN_DEBIT_EXCEEDS_FUNDED']};}
  const pairedInPosition=input.fundedPairedTokenRaw===0n?0n:(input.fundingPrincipalLamports*input.depositedPairedTokenRaw)/input.fundedPairedTokenRaw;
  const residual=input.fundingPrincipalLamports-pairedInPosition;
  const lp=pairedInPosition+input.openSolPrincipalLamports;
  const managed=input.fundingPrincipalLamports+input.openSolPrincipalLamports;
  if(managed>input.requestedLiquidityCapitalLamports)reasons.push('ENTRY_BASIS_ACTUAL_DEPLOYMENT_EXCEEDS_REQUESTED');
  return{lpPositionPrincipalLamports:lp,managedEconomicContributionLamports:managed,residualPairedTokenPrincipalLamports:residual,unclassifiedLamports:0n,reasonCodes:reasons};
}
