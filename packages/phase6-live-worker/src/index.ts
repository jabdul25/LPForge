// LPFORGE_PHASE6_MAINNET_MODULE
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadConfirmedExecutionReceipt, loadParsedConfirmedExecutionReceipt } from "../../transaction-receipt/src/index.js";
import { deriveTransactionAssetEffects } from "../../transaction-asset-effects/src/index.js";
import { deriveReceiptBackedEntryBasis, deriveReceiptBoundSolContribution, receiptBoundOwnerTokenDebits } from "../../entry-capital-basis/src/index.js";
import {
  closeUnwindSettlementIds,
  deriveCloseUnwindSettlement,
} from "../../phase6-close-settlement/src/index.js";
import {
  buildAddLiquidityTransaction,
  buildClaimTransactions,
  buildClosePositionTransaction,
  buildRemoveLiquidityTransactions,
  createLiveMeteoraOpenPool,
  loadMeteoraExecutionRuntime,
  type BuiltMeteoraTransaction,
  type MeteoraOpenAddPoolLike,
  type MeteoraRemoveClaimPoolLike,
} from "../../meteora-execution/src/index.js";
import {
  auxiliaryPositionSignersForOpenStep,
  prepareAutonomousMeteoraOpen,
  type AutonomousOpenPlan,
  type PreparedAutonomousOpen,
} from "../../phase6-autonomous-dispatch/src/index.js";
import {
  createWeb3SimulationTransport,
  simulateExecutionTransaction,
} from "../../simulation-gateway/src/index.js";
import {
  estimateExecutionFee,
  assessExecutionCost,
} from "../../execution-cost/src/index.js";
import { governExecutionRisk } from "../../execution-risk/src/index.js";
import {
  executeMainnetCanaryClose,
  executeMainnetCanaryManage,
  executeMainnetCanaryOpen,
} from "../../phase6-canary-runtime/src/index.js";
import {
  createWeb3SubmissionTransport,
  observeConfirmation,
  rebroadcastExactSignedTransaction,
  submitSignedTransaction,
  type SubmissionLedger,
} from "../../execution-submission/src/index.js";
import {
  signMainnetCanary,
  type MainnetSignerBackend,
} from "../../phase6-mainnet-signer/src/index.js";
import {
  createLegacyMainnetEnvelope,
  createVersionedMainnetEnvelope,
} from "../../phase6-live-envelope/src/index.js";
import {
  buildJupiterMetisSwapTransaction,
  assessSwapQuote,
  loadAutonomousEntryPolicy,
  readJupiterMetisQuote,
} from "../../phase6-swap-quote/src/index.js";
import { phase7ExecutionControlFromRow, validateFreshOpenPhase7Safety } from "../../phase6-claim-guard/src/index.js";
import { createGovernedConnection, createMeteoraReadAdapter, type MeteoraReadAdapter } from "../../meteora/src/index.js";
import { createMeteoraDataApi } from "../../data-api/src/index.js";
import type { ControlledCanaryDeploymentPolicy } from "../../deployment-policy/src/index.js";
import { assessLifecycleSettlement } from "../../db/src/index.js";
import type {
  AutonomousPlan,
  AutonomousPlanAction,
  LifecycleChildTransaction,
  LifecycleSettlementInput,
  CanonicalPostTradeReport,
  OpenChunkDisposition,
  OpenChunkDispositionRecord,
  Phase1Store,
  PositionInventoryLot,
  WalletPositionClassification,
} from "../../db/src/index.js";
import {
  assertExecutionJournalTransition,
  determineRecoveryAction,
  type ExecutionJournalState,
  type ExecutionJournal,
} from "../../execution-recovery/src/index.js";
import { computePlanProvenanceHmac } from "../../execution-contracts/src/index.js";
import { enqueueAndDispatchPhase7Alert, loadPhase7TelegramConfig, postTradeSettlementAlert } from "../../phase7-alerting/src/index.js";

const JUPITER_SWAP_V6_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const telegramOpenConfig=loadPhase7TelegramConfig();
function queueOpenedPositionAlert(input:{positionAddress:string;poolAddress:string;planId:string;strategy:string;orientation:string;capitalLamports:bigint;lowerBinId:number;upperBinId:number;activeBinId:number;observedAt:string}){
  void enqueueAndDispatchPhase7Alert({databaseUrl:process.env.DATABASE_URL,config:telegramOpenConfig,alert:{severity:'INFO',code:'POSITION_OPENED',title:'Position opened',message:'The LP position is confirmed on-chain and LPForge has matched it to this plan.\nAction needed: none.',observedAt:input.observedAt,entityType:'POSITION',entityId:input.positionAddress,transitionKey:'NOT_OPEN->OPEN',topic:'TRADES',positionAddress:input.positionAddress,poolAddress:input.poolAddress,planId:input.planId,details:{Strategy:input.strategy,Orientation:input.orientation,'Capital SOL':(Number(input.capitalLamports)/1_000_000_000).toFixed(6),'Active bin':input.activeBinId,Range:`${input.lowerBinId} → ${input.upperBinId}`,Bins:input.upperBinId-input.lowerBinId+1,Reconciliation:'MATCH'}}}).catch(()=>{});
}
function queuePositionSettledAlert(report:CanonicalPostTradeReport){
  // This runs only after immutable settlement persistence. The durable alert
  // outbox owns retry/deduplication; a reporting or Telegram failure is never
  // allowed to change settlement, P6 execution, or trading authority.
  void enqueueAndDispatchPhase7Alert({databaseUrl:process.env.DATABASE_URL,config:telegramOpenConfig,alert:postTradeSettlementAlert(report)}).catch(()=>{});
}

export interface LiveWorkerConfig {
  rpcUrl: string;
  programId: string;
  /** Explicit deployment-policy cap; the SDK must never receive undefined slippage. */
  liquiditySlippageBps: number;
  maxFeeLamports: bigint;
  maxFeeFraction: number;
  simulationFreshnessMs: number;
  riskPermitTtlMs: number;
  /** Final, fresh chain-state guard; values come from deployment config. */
  maxPresignActiveBinDriftBins: number;
  maxPresignReferenceDivergenceBps: number;
  confirmPollMs: number;
  confirmAttempts: number;
  /** Canonical live-policy value. Zero means dust retention is disabled. */
  residualDustThresholdUsd?: number;
  meteoraDataApiUrl?: string;
  dataApiMaxRps?: number;
  httpTimeoutMs?: number;
  policyHash?: string;
  /** Parsed from the sole runtime policy authority; never defaulted in code. */
  maxOpenPositions?: number;
  /** Present only while the explicitly approved controlled canary is armed. */
  controlledCanary?: ControlledCanaryDeploymentPolicy;
  /** Immutable-settlement reporting policy. Observability only. */
  postTradeReporting?:{enabled:boolean;policyVersion:string;runningStatsStartAt:string};
}
type SettlementFinalizationConfig=Pick<LiveWorkerConfig,"rpcUrl"|"residualDustThresholdUsd"|"meteoraDataApiUrl"|"dataApiMaxRps"|"httpTimeoutMs"|"policyHash"|"postTradeReporting">;
type SettlementFinalizationConfigInput=Omit<SettlementFinalizationConfig,"rpcUrl">&{rpcUrl?:string};

/**
 * The normal CLOSE path and reconciliation-only CLOSE recovery must reach the
 * same immutable-settlement boundary with the same observability policy. In
 * particular, a recovery is allowed to finalize accounting, but must not
 * silently bypass the durable post-trade-report outbox.
 */
export function settlementFinalizationConfig(input:SettlementFinalizationConfigInput):SettlementFinalizationConfig{
  return{
    rpcUrl:input.rpcUrl??'',
    ...(input.residualDustThresholdUsd===undefined?{}:{residualDustThresholdUsd:input.residualDustThresholdUsd}),
    ...(input.meteoraDataApiUrl===undefined?{}:{meteoraDataApiUrl:input.meteoraDataApiUrl}),
    ...(input.dataApiMaxRps===undefined?{}:{dataApiMaxRps:input.dataApiMaxRps}),
    ...(input.httpTimeoutMs===undefined?{}:{httpTimeoutMs:input.httpTimeoutMs}),
    ...(input.policyHash===undefined?{}:{policyHash:input.policyHash}),
    ...(input.postTradeReporting===undefined?{}:{postTradeReporting:input.postTradeReporting}),
  };
}
export interface LiveWorkerResult {
  status: "IDLE" | "AWAITING_FRESH_P7_CONTROL" | "BLOCKED" | "SUBMITTED" | "RECONCILED" | "UNKNOWN";
  planId?: string;
  reasonCodes: string[];
  transactionSubmitted: boolean;
  positionAddress?: string;
}
export interface LiveRecoveryResult {
  planId: string;
  action:
    | "WAIT_DO_NOT_RESUBMIT"
    | "RECONCILE_FIRST"
    | "MARK_RECONCILED"
    | "REBUILD_WITH_NEW_BLOCKHASH"
    | "RESUME_CLOSE_SETTLEMENT"
    | "HOLD_FOR_OPERATOR"
    | "RETURN_EXISTING_PLAN"
    | "NO_ACTION_COMPLETE";
  reasonCodes: string[];
}
const WSOL_MINT = "So11111111111111111111111111111111111111112";

export function assessResidualDustDisposition(input:{rawAmount:bigint;decimals:number;unitPriceUsd:number|undefined;valuationAt:string|undefined;now:string;thresholdUsd:number;maxValuationAgeMs?:number}){
  const maxAgeMs=input.maxValuationAgeMs??60_000;
  if(input.rawAmount<=0n||!Number.isInteger(input.decimals)||input.decimals<0||!Number.isFinite(input.thresholdUsd)||input.thresholdUsd<0)return{eligible:false as const,reasonCodes:['SETTLEMENT_DUST_POLICY_INVALID']};
  const valuationAtMs=input.valuationAt?Date.parse(input.valuationAt):NaN;
  if(!Number.isFinite(input.unitPriceUsd)||input.unitPriceUsd===undefined||input.unitPriceUsd<=0)return{eligible:false as const,reasonCodes:['SETTLEMENT_DUST_PRICE_UNAVAILABLE']};
  if(!Number.isFinite(valuationAtMs)||Date.parse(input.now)-valuationAtMs>maxAgeMs)return{eligible:false as const,reasonCodes:['SETTLEMENT_DUST_PRICE_STALE']};
  const usdValue=Number(input.rawAmount)/10**input.decimals*input.unitPriceUsd;
  if(!Number.isFinite(usdValue)||usdValue<0)return{eligible:false as const,reasonCodes:['SETTLEMENT_DUST_VALUE_INVALID']};
  return usdValue<=input.thresholdUsd?{eligible:true as const,usdValue,reasonCodes:[]}:{eligible:false as const,usdValue,reasonCodes:['SETTLEMENT_DUST_THRESHOLD_EXCEEDED']};
}

async function readMintDecimals(connection:Connection,mint:string):Promise<number|undefined>{
  const account=await connection.getAccountInfo(new PublicKey(mint),'confirmed'),data=account?.data;
  // SPL Token and Token-2022 Mint layouts share the decimals byte at offset 44.
  const decimals=data&&data.length>44?Number(data[44]):undefined;
  return decimals!==undefined&&Number.isInteger(decimals)&&decimals>=0&&decimals<=255?decimals:undefined;
}
function rawTokenUi(raw:bigint,decimals:number|undefined):string|undefined{
  if(decimals===undefined||!Number.isInteger(decimals)||decimals<0)return undefined;
  const d=10n**BigInt(decimals),whole=raw/d,fraction=(raw%d).toString().padStart(decimals,'0').replace(/0+$/,'');
  return fraction?`${whole}.${fraction}`:whole.toString();
}

/**
 * Wallet observations, not a Jupiter request amount, are the authority for
 * funded-entry economics.  Native SOL and WSOL are deliberately combined:
 * Jupiter may wrap or unwrap native SOL as part of an otherwise equivalent
 * funding route.
 */
export function deriveEntryFundingSettlement(input:{
  nativeLamportsBefore:bigint;
  nativeLamportsAfter:bigint;
  wsolRawBefore:bigint;
  wsolRawAfter:bigint;
  pairedTokenRawBefore:bigint;
  pairedTokenRawAfter:bigint;
  transactionFeeLamports:bigint;
}):{solAssetOutLamports:bigint;transactionFeeLamports:bigint;pairedTokenReceivedRaw:bigint}{
  const solAssetBefore=input.nativeLamportsBefore+input.wsolRawBefore,
    solAssetAfter=input.nativeLamportsAfter+input.wsolRawAfter,
    totalSolDelta=solAssetBefore>solAssetAfter?solAssetBefore-solAssetAfter:0n,
    tokenDelta=input.pairedTokenRawAfter>input.pairedTokenRawBefore?input.pairedTokenRawAfter-input.pairedTokenRawBefore:0n;
  return {
    solAssetOutLamports:totalSolDelta>input.transactionFeeLamports?totalSolDelta-input.transactionFeeLamports:0n,
    transactionFeeLamports:input.transactionFeeLamports,
    pairedTokenReceivedRaw:tokenDelta,
  };
}

/** Only newly funded token-X left after OPEN is attributable as entry residual. */
export function deriveOpenResidualInventory(input:{
  pairedTokenRawBeforeFunding:bigint;
  pairedTokenRawBeforeOpen:bigint;
  pairedTokenRawAfterOpen:bigint;
  pairedTokenReceivedRaw:bigint;
}):bigint{
  const walletIncrease=input.pairedTokenRawAfterOpen>input.pairedTokenRawBeforeFunding
    ?input.pairedTokenRawAfterOpen-input.pairedTokenRawBeforeFunding:0n;
  // The pre-open snapshot documents the maximum funded asset that could have
  // been used.  The final residual remains bounded by the measured funding
  // delta so pre-existing/manual wallet inventory is never attributed.
  const availableBeforeOpen=input.pairedTokenRawBeforeOpen>input.pairedTokenRawBeforeFunding
    ?input.pairedTokenRawBeforeOpen-input.pairedTokenRawBeforeFunding:0n;
  return [walletIncrease,availableBeforeOpen,input.pairedTokenReceivedRaw].reduce((least,value)=>value<least?value:least);
}

/**
 * A chunked OPEN may confirm only part of its planned liquidity instructions.
 * Recover wallet inventory only when the original pre-funding balance and the
 * pre-close snapshot prove that the remaining token-X is still the funded
 * canary asset.  Any unexpected wallet movement fails closed (undefined), so
 * this path can never sell an unrelated wallet balance.
 */
export function deriveRecoveredOpenResidualInventory(input:{
  pairedTokenRawBeforeFunding:bigint;
  pairedTokenRawBeforeClose:bigint;
  pairedTokenRawAfterPriorUnwind:bigint;
  pairedTokenReceivedRaw:bigint;
}):bigint|undefined{
  if(input.pairedTokenRawAfterPriorUnwind!==input.pairedTokenRawBeforeClose)return undefined;
  const residual=input.pairedTokenRawBeforeClose>input.pairedTokenRawBeforeFunding
    ? input.pairedTokenRawBeforeClose-input.pairedTokenRawBeforeFunding
    : 0n;
  return residual<=input.pairedTokenReceivedRaw?residual:undefined;
}
type EntryFundingMeasurement={
  tokenMint:string;
  pairedTokenReceivedRaw:bigint;
  pairedTokenRawBeforeFunding:bigint;
  pairedTokenRawBeforeOpen:bigint;
  fundingSignature:string;
};
/**
 * Persists one immutable entry-basis version after a confirmed OPEN.  Every
 * amount is reconstructed from the signatures already recorded by P6; a
 * missing receipt records INCOMPLETE rather than substituting a wallet delta.
 */
async function persistReceiptBackedEntryBasis(input:{store:Pick<Phase1Store,'insertPositionEntryBasis'>;connection:Connection;plan:AutonomousOpenPlan;positionAddress:string;requestedLiquidityCapitalLamports:bigint;funding?:EntryFundingMeasurement;confirmedSteps:ReadonlyArray<{transactionId:string;kind:string;signature:string}>;observedAt:string}):Promise<{basisState:'PROVEN'|'INCOMPLETE';managedEconomicContributionLamports?:bigint;lpPositionPrincipalLamports?:bigint;executionCostLamports:bigint;recoverableRentDebitsLamports:bigint;recoverableRentRefundsLamports:bigint;reasonCodes:string[]}> {
  const receiptRows:Array<{transactionId:string;kind:string;signature:string;receipt:Awaited<ReturnType<typeof loadParsedConfirmedExecutionReceipt>>}>=[];
  if(input.funding)receiptRows.push({transactionId:`${input.plan.planId}:funding`,kind:'JUPITER_SWAP',signature:input.funding.fundingSignature,receipt:await loadParsedConfirmedExecutionReceipt(input.connection,input.funding.fundingSignature)});
  for(const step of input.confirmedSteps)receiptRows.push({...step,receipt:await loadParsedConfirmedExecutionReceipt(input.connection,step.signature)});
  let executionCost=0n,rentDebits=0n,rentRefunds=0n,fundingPrincipal=0n,openPrincipal=0n,depositedPaired=0n;
  const reasons:string[]=[];
  for(const row of receiptRows){
    const contribution=deriveReceiptBoundSolContribution({receipt:row.receipt,ownerAddress:input.plan.ownerAddress,positionAddress:input.positionAddress,...(row.receipt.staticAccountKeys[0]?{feePayerAddress:row.receipt.staticAccountKeys[0]}:{})});
    if(row.receipt.state!=='CONFIRMED_SUCCESS'||!contribution){reasons.push(`ENTRY_BASIS_RECEIPT_UNAVAILABLE:${row.transactionId}`);continue;}
    executionCost+=contribution.transactionFeeLamports;
    if(row.kind==='JUPITER_SWAP'){
      fundingPrincipal+=contribution.principalLamports;
      rentDebits+=contribution.recoverableRentDebitsLamports;
      rentRefunds+=contribution.recoverableRentRefundsLamports;
    }else if(row.kind==='METEORA_OPEN'||row.kind==='METEORA_OPEN_CHUNK'){
      openPrincipal+=contribution.principalLamports;
      rentDebits+=contribution.recoverableRentDebitsLamports;
      rentRefunds+=contribution.recoverableRentRefundsLamports;
      if(input.funding)depositedPaired+=receiptBoundOwnerTokenDebits({receipt:row.receipt,ownerAddress:input.plan.ownerAddress,mint:input.funding.tokenMint}).reduce((total,effect)=>total+effect.rawAmount,0n);
    }else if(row.kind==='METEORA_POSITION_EXTEND'){
      rentDebits+=contribution.recoverableRentDebitsLamports;
      rentRefunds+=contribution.recoverableRentRefundsLamports;
    }
  }
  const fundingRaw=input.funding?.pairedTokenReceivedRaw??0n;
  if(reasons.length===0){
    const basis=deriveReceiptBackedEntryBasis({requestedLiquidityCapitalLamports:input.requestedLiquidityCapitalLamports,fundingPrincipalLamports:fundingPrincipal,fundedPairedTokenRaw:fundingRaw,openSolPrincipalLamports:openPrincipal,depositedPairedTokenRaw:depositedPaired,executionCostLamports:executionCost,recoverableRentDebitsLamports:rentDebits,recoverableRentRefundsLamports:rentRefunds});
    reasons.push(...basis.reasonCodes);
    if(basis.reasonCodes.some(code=>code.startsWith('ENTRY_BASIS_INPUT_INVALID')||code.startsWith('ENTRY_BASIS_PAIRED_TOKEN_DEBIT_EXCEEDS_FUNDED'))){reasons.push('ENTRY_BASIS_INCOMPLETE');}
    const proven=!reasons.includes('ENTRY_BASIS_INCOMPLETE');
    await input.store.insertPositionEntryBasis({basisId:`${input.plan.planId}:entry-basis:v1`,positionAddress:input.positionAddress,entryPlanId:input.plan.planId,classificationVersion:1,basisState:proven?'PROVEN':'INCOMPLETE',requestedLiquidityCapitalLamports:input.requestedLiquidityCapitalLamports,...(proven?{lpPositionPrincipalLamports:basis.lpPositionPrincipalLamports,managedEconomicContributionLamports:basis.managedEconomicContributionLamports}:{}),executionCostLamports:executionCost,recoverableRentDebitsLamports:rentDebits,recoverableRentRefundsLamports:rentRefunds,unclassifiedLamports:basis.unclassifiedLamports,receiptProvenance:{source:'CONFIRMED_ENTRY_RECEIPTS_V1',fundingPrincipalLamports:fundingPrincipal.toString(),openSolPrincipalLamports:openPrincipal.toString(),fundedPairedTokenRaw:fundingRaw.toString(),depositedPairedTokenRaw:depositedPaired.toString(),residualPairedTokenPrincipalLamports:basis.residualPairedTokenPrincipalLamports.toString(),receipts:receiptRows.map(row=>({transactionId:row.transactionId,kind:row.kind,signature:row.signature,state:row.receipt.state}))},observedAt:input.observedAt});
    return{basisState:proven?'PROVEN':'INCOMPLETE',...(proven?{managedEconomicContributionLamports:basis.managedEconomicContributionLamports,lpPositionPrincipalLamports:basis.lpPositionPrincipalLamports}:{}),executionCostLamports:executionCost,recoverableRentDebitsLamports:rentDebits,recoverableRentRefundsLamports:rentRefunds,reasonCodes:[...new Set(reasons)].sort()};
  }
  await input.store.insertPositionEntryBasis({basisId:`${input.plan.planId}:entry-basis:v1`,positionAddress:input.positionAddress,entryPlanId:input.plan.planId,classificationVersion:1,basisState:'INCOMPLETE',requestedLiquidityCapitalLamports:input.requestedLiquidityCapitalLamports,executionCostLamports:0n,recoverableRentDebitsLamports:0n,recoverableRentRefundsLamports:0n,unclassifiedLamports:0n,receiptProvenance:{source:'CONFIRMED_ENTRY_RECEIPTS_V1',receipts:receiptRows.map(row=>({transactionId:row.transactionId,kind:row.kind,signature:row.signature,state:row.receipt.state})),reasonCodes:reasons},observedAt:input.observedAt});
  return{basisState:'INCOMPLETE',executionCostLamports:0n,recoverableRentDebitsLamports:0n,recoverableRentRefundsLamports:0n,reasonCodes:[...new Set(reasons)].sort()};
}
/** A chunked OPEN becomes ordinary OPEN only after every planned economic add
 * has authoritative chain confirmation. Position-account existence alone is
 * deliberately insufficient because the extension and first chunk can land. */
export function assessOpenChunkConstruction(input:{planned:ReadonlyArray<{transactionId:string;sequence:number;kind:string}>;dispositions:ReadonlyArray<Pick<OpenChunkDispositionRecord,"transactionId"|"disposition">>}):{fullyConstructed:boolean;partial:boolean;reasonCodes:string[]}{
  const economic=input.planned.filter(step=>step.kind==='METEORA_OPEN'||step.kind==='METEORA_OPEN_CHUNK');
  const byId=new Map(input.dispositions.map(row=>[row.transactionId,row.disposition]));
  const missing=economic.filter(step=>byId.get(step.transactionId)!=='CONFIRMED');
  if(missing.length===0)return{fullyConstructed:true,partial:false,reasonCodes:['P6_OPEN_ALL_ECONOMIC_CHUNKS_CONFIRMED']};
  const terminal=missing.some(step=>['PROVEN_NOT_LANDED','CONFIRMED_FAILED','FAILED_PRE_SIGN','EXPIRED_PRE_SUBMISSION'].includes(String(byId.get(step.transactionId))));
  const unknown=missing.some(step=>['UNKNOWN_SUBMISSION','SUBMITTED','SIGNING','SIGNED','PENDING'].includes(String(byId.get(step.transactionId))));
  return{fullyConstructed:false,partial:terminal,reasonCodes:[terminal?'P6_OPEN_PARTIAL_CONSTRUCTION':'P6_OPEN_CHUNK_DISPOSITION_PENDING',...(unknown?['P6_OPEN_CHUNK_CHAIN_TRUTH_UNRESOLVED']:[]),...missing.map(step=>`P6_OPEN_CHUNK_NOT_CONFIRMED:${step.transactionId}`)]};
}

/**
 * A chunked entry may be adopted as an OPEN_RECOVERED position only after the
 * missing children have each reached an immutable no-effect terminal state.
 * This is deliberately stricter than `partial`: a mix of an expired child and
 * an UNKNOWN child remains reconciliation debt and may not release admission.
 */
export function assessTerminalPartialOpenRecovery(input:{
  planned:ReadonlyArray<{transactionId:string;sequence:number;kind:string}>;
  dispositions:ReadonlyArray<Pick<OpenChunkDispositionRecord,"transactionId"|"disposition">>;
}):{eligible:boolean;reasonCodes:string[]}{
  const economic=input.planned.filter(step=>step.kind==='METEORA_OPEN'||step.kind==='METEORA_OPEN_CHUNK');
  const byId=new Map(input.dispositions.map(row=>[row.transactionId,row.disposition]));
  const confirmed=economic.filter(step=>byId.get(step.transactionId)==='CONFIRMED');
  const missing=economic.filter(step=>byId.get(step.transactionId)!=='CONFIRMED');
  const terminal=new Set(['PROVEN_NOT_LANDED','CONFIRMED_FAILED','FAILED_PRE_SIGN','EXPIRED_PRE_SUBMISSION']);
  const reasons:string[]=[];
  if(economic.length<2)reasons.push('P6_OPEN_RECOVERED_NOT_CHUNKED');
  if(confirmed.length===0)reasons.push('P6_OPEN_RECOVERED_NO_CONFIRMED_ECONOMIC_CHUNK');
  if(missing.length===0)reasons.push('P6_OPEN_RECOVERED_CONSTRUCTION_ALREADY_COMPLETE');
  if(missing.some(step=>!terminal.has(String(byId.get(step.transactionId)))))reasons.push('P6_OPEN_RECOVERED_CHILD_CHAIN_TRUTH_UNRESOLVED');
  return{eligible:reasons.length===0,reasonCodes:reasons};
}

/**
 * Rebroadcasting is only permitted for the exact already-signed wire payload.
 * It is not a re-sign/rebuild path and therefore cannot create a second
 * economic chunk.  Terminal confirmation always wins over retransmission.
 */
export function shouldRebroadcastKnownOpenChunk(input:{
  confirmationStatus:'UNKNOWN'|'PROCESSED'|'CONFIRMED'|'FINALIZED'|'FAILED'|'EXPIRED';
  unknownObservationCount:number;
  rebroadcastCount:number;
}):boolean{
  return input.confirmationStatus==='UNKNOWN'
    && input.unknownObservationCount>=2
    && input.rebroadcastCount<2;
}

/** Classifies only an already-signed chunk from independently read chain truth. */
export function classifyKnownOpenChunkSignatureTruth(input:{
  disposition:OpenChunkDisposition;
  signaturePresent:boolean;
  lastValidBlockHeight?:bigint;
  currentBlockHeight?:number;
  statusReadSucceeded:boolean;
  status:null|{err?:unknown;confirmationStatus?:string|null};
}):'UNCHANGED'|'CONFIRMED'|'CONFIRMED_FAILED'|'PROVEN_NOT_LANDED'{
  if(!input.statusReadSucceeded||!input.signaturePresent||input.lastValidBlockHeight===undefined)return'UNCHANGED';
  if(!['PENDING','SIGNING','SIGNED','SUBMITTED','UNKNOWN_SUBMISSION'].includes(input.disposition))return'UNCHANGED';
  if(input.status?.err)return'CONFIRMED_FAILED';
  if(input.status?.confirmationStatus==='confirmed'||input.status?.confirmationStatus==='finalized')return'CONFIRMED';
  if(input.status===null&&input.currentBlockHeight!==undefined&&input.currentBlockHeight>Number(input.lastValidBlockHeight))return'PROVEN_NOT_LANDED';
  return'UNCHANGED';
}

/**
 * The partial-entry adoption path may already have created the one wallet
 * residual lot.  Promotion to OPEN_RECOVERED must reuse it or fail closed;
 * it must never record the same raw balance a second time.
 */
export function assessTerminalPartialOpenResidualLot(input:{
  lots:ReadonlyArray<Pick<PositionInventoryLot,'planId'|'sourceEvent'|'status'|'rawAmount'|'remainingRawAmount'>>;
  planId:string;
  residual:bigint;
}):'REUSE'|'CREATE'|'CONFLICT'{
  const existing=input.lots.filter(lot=>
    lot.planId===input.planId&&
    (lot.sourceEvent==='OPEN_RESIDUAL'||lot.sourceEvent==='RECOVERY_RESIDUAL')&&
    (lot.status==='OPEN'||lot.status==='PARTIALLY_SETTLED'),
  );
  const matches=existing.filter(lot=>lot.rawAmount===input.residual&&lot.remainingRawAmount===input.residual);
  if(existing.length!==matches.length||matches.length>1)return'CONFLICT';
  return matches.length===1?'REUSE':'CREATE';
}
function nestedGeneratedPositionAddress(value:unknown):string|undefined{
 if(!value||typeof value!=="object")return undefined;
 const row=value as Record<string,unknown>,direct=row.generatedPositionAddress??row.positionAddress;
 if(typeof direct==='string'&&direct.trim())return direct;
 for(const key of ["autonomous_dispatch","open","prepared","payload","metadata"]){const found=nestedGeneratedPositionAddress(row[key]);if(found)return found;}
 return undefined;
}
function planFields(plan: AutonomousOpenPlan) {
  const intent = plan.planPayload.intent as Record<string, unknown> | undefined;
  if (!intent) throw new Error("LPFORGE_P6_PLAN_INTENT_MISSING");
  const capital = BigInt(String(intent.capitalLamports ?? "")),
    lower = Number(intent.lowerBinId),
    upper = Number(intent.upperBinId),
    plannedActiveBinId=Number(intent.activeBinId),
    binStep=Number(intent.binStep);
  if (capital <= 0n || !Number.isInteger(lower) || !Number.isInteger(upper)||!Number.isInteger(plannedActiveBinId)||!Number.isInteger(binStep)||binStep<=0)
    throw new Error("LPFORGE_P6_PLAN_FIELDS_INVALID");
  return { capital, lower, upper, plannedActiveBinId, binStep };
}
export function assertControlledCanaryOpen(config:LiveWorkerConfig,capital:bigint):void{
  const canary=config.controlledCanary;
  if(!canary)return;
  if(capital!==canary.exactLiquidityCapitalLamports)throw new Error('LPFORGE_P6_CONTROLLED_CANARY_EXACT_CAPITAL_REQUIRED');
}
async function recordPositionTokenXLot(input:{store:Phase1Store;connection:Connection;plan:AutonomousPlan;positionAddress:string;tokenMint:string;sourceEvent:"FEE_CLAIM"|"REDUCE_WITHDRAWAL"|"CLOSE_WITHDRAWAL";sourceCashflowId:string;rawAmount:bigint;observedAt:string;signature:string}){
  if(input.rawAmount<=0n)return;
  const supply=await input.connection.getTokenSupply(new PublicKey(input.tokenMint),"confirmed"),decimals=Number(supply.value.decimals);
  if(!Number.isInteger(decimals)||decimals<0||decimals>255)throw new Error("LPFORGE_P6_INVENTORY_TOKEN_DECIMALS_INVALID");
  const suffix=input.sourceEvent==="FEE_CLAIM"?"claim-x":input.sourceEvent==="REDUCE_WITHDRAWAL"?"reduce-x":"close-x";
  await input.store.createPositionInventoryLot({lotId:`${input.plan.planId}:${suffix}:lot`,createdEventId:`${input.plan.planId}:${suffix}:lot-created`,positionAddress:input.positionAddress,planId:input.plan.planId,ownerAddress:input.plan.ownerAddress,poolAddress:input.plan.poolAddress,tokenMint:input.tokenMint,tokenSide:"X",sourceEvent:input.sourceEvent,sourceCashflowId:input.sourceCashflowId,rawAmount:input.rawAmount,decimals,acquiredAt:input.observedAt,payload:{source:"WALLET_DELTA",signature:input.signature}});
}

async function supersedeProvisionalPartialEntryRecovery(input:{store:Phase1Store;plan:Pick<AutonomousPlan,"planId"|"ownerAddress"|"poolAddress">;positionAddress:string;at:string}):Promise<boolean>{
  // This runs only after the normal OPEN reconciliation has persisted the
  // exact owned-position identity. It never creates a recovery row and never
  // changes a row without OPEN/MATCH proof in the same transaction boundary.
  return input.store.supersedePartialEntryRecoveryIfSuccessfulOpen({
    planId:input.plan.planId,positionAddress:input.positionAddress,
    ownerAddress:input.plan.ownerAddress,poolAddress:input.plan.poolAddress,at:input.at,
  });
}

/**
 * A wallet snapshot alone cannot distinguish manual inventory from fees that
 * were already claimed for this position.  Lots are the receipt-bound
 * provenance record. We may unwind only the just-withdrawn close delta plus
 * pre-existing receipt-backed inventory for this exact position and mint:
 * previously claimed fees and measured entry-funding residuals. Neither is
 * inferred from unrelated wallet inventory.
 */
export function derivePositionAttributedTerminalUnwind(input:{
  positionAddress:string;
  tokenMint:string;
  closePlanId:string;
  newlyWithdrawnRaw:bigint;
  walletRawAfterClose:bigint;
  lots:ReadonlyArray<Pick<PositionInventoryLot,"lotId"|"positionAddress"|"planId"|"tokenMint"|"sourceEvent"|"remainingRawAmount"|"status"|"acquiredAt">>;
}):{ok:true;amountRaw:bigint;feeLotAllocations:Array<{lotId:string;rawAmount:bigint}>;openResidualLotAllocations:Array<{lotId:string;rawAmount:bigint}>;lotAllocations:Array<{lotId:string;rawAmount:bigint}>}|{ok:false;reasonCodes:string[]}{
  if(input.newlyWithdrawnRaw<0n||input.walletRawAfterClose<0n)return{ok:false,reasonCodes:['P6_CLOSE_POSITION_ATTRIBUTED_INVENTORY_INVALID']};
  const feeLots=input.lots
    // A terminal claim belongs to the close plan itself.  It is nevertheless
    // receipt-bound inventory and must be included exactly once in the
    // subsequent unwind; excluding same-plan claims caused their amount to be
    // folded into a combined wallet delta and then left as phantom debt.
    .filter(lot=>lot.positionAddress===input.positionAddress&&lot.tokenMint===input.tokenMint&&lot.sourceEvent==='FEE_CLAIM'&&['OPEN','PARTIALLY_SETTLED'].includes(lot.status)&&lot.remainingRawAmount>0n)
    .sort((a,b)=>a.acquiredAt.localeCompare(b.acquiredAt)||a.lotId.localeCompare(b.lotId));
  const feeLotAllocations=feeLots.map(lot=>({lotId:lot.lotId,rawAmount:lot.remainingRawAmount}));
  const openResidualLotAllocations=input.lots
    .filter(lot=>lot.positionAddress===input.positionAddress&&lot.tokenMint===input.tokenMint&&lot.sourceEvent==='OPEN_RESIDUAL'&&lot.planId!==input.closePlanId&&['OPEN','PARTIALLY_SETTLED'].includes(lot.status)&&lot.remainingRawAmount>0n)
    .sort((a,b)=>a.acquiredAt.localeCompare(b.acquiredAt)||a.lotId.localeCompare(b.lotId))
    .map(lot=>({lotId:lot.lotId,rawAmount:lot.remainingRawAmount}));
  const lotAllocations=[...feeLotAllocations,...openResidualLotAllocations],priorRaw=lotAllocations.reduce((total,lot)=>total+lot.rawAmount,0n),amountRaw=input.newlyWithdrawnRaw+priorRaw;
  if(input.walletRawAfterClose<amountRaw)return{ok:false,reasonCodes:['P6_CLOSE_POSITION_ATTRIBUTED_FEE_LOTS_WALLET_SHORTFALL']};
  return{ok:true,amountRaw,feeLotAllocations,openResidualLotAllocations,lotAllocations};
}

/**
 * The close unwind is allowed to settle only the exact receipt-bound lots
 * selected before its signature was submitted.  The dispatch payload is the
 * restart boundary, so decode it once rather than recreating a synthetic
 * close-x lot during recovery.
 */
export function parseDurableCloseLotAllocations(value:unknown):{ok:true;allocations:Array<{lotId:string;rawAmount:bigint}>}|{ok:false}{
  if(value===undefined)return{ok:true,allocations:[]};
  if(!Array.isArray(value))return{ok:false};
  const allocations:Array<{lotId:string;rawAmount:bigint}>=[],seen=new Set<string>();
  for(const rowValue of value){
    if(!rowValue||typeof rowValue!=="object")return{ok:false};
    const row=rowValue as Record<string,unknown>;
    if(typeof row.lotId!=="string"||row.lotId.length===0||typeof row.rawAmount!=="string"||!/^([1-9][0-9]*)$/.test(row.rawAmount)||seen.has(row.lotId))return{ok:false};
    try{allocations.push({lotId:row.lotId,rawAmount:BigInt(row.rawAmount)});seen.add(row.lotId);}catch{return{ok:false};}
  }
  return{ok:true,allocations};
}

/**
 * A final account-close child may expire after the normal close unwind has
 * already settled, while a receipt-backed fee claim remains in the owner
 * wallet.  That inventory is still position-attributable, but it is not safe
 * to infer it from a wallet-wide balance.  Select only open fee-claim lots
 * bound to this exact position and mint; the caller separately proves the
 * current wallet can cover the exact durable lot total before constructing a
 * fresh unwind child.
 */
export function selectReceiptBoundFeeClaimResidual(input:{
  positionAddress:string;
  tokenMint:string;
  lots:ReadonlyArray<Pick<PositionInventoryLot,"lotId"|"positionAddress"|"tokenMint"|"sourceEvent"|"remainingRawAmount"|"status"|"acquiredAt">>;
}):Array<{lotId:string;rawAmount:bigint}>{
  return input.lots
    .filter(lot=>
      lot.positionAddress===input.positionAddress&&
      lot.tokenMint===input.tokenMint&&
      lot.sourceEvent==='FEE_CLAIM'&&
      ['OPEN','PARTIALLY_SETTLED'].includes(lot.status)&&
      lot.remainingRawAmount>0n,
    )
    .sort((a,b)=>a.acquiredAt.localeCompare(b.acquiredAt)||a.lotId.localeCompare(b.lotId))
    .map(lot=>({lotId:lot.lotId,rawAmount:lot.remainingRawAmount}));
}

/**
 * Historical close plans may have measured REMOVE and CLAIM together.  When
 * the exact confirmed unwind consumed that combined balance, the separately
 * receipt-recorded claim lot is already economically disposed of.  This is a
 * narrow append-only reconciliation predicate, never a wallet inference.
 */
export function isReceiptBoundCombinedCloseClaimDisposition(input:{
  primaryUnwindInputRaw:bigint;
  combinedCloseWithdrawalRaw:bigint;
  openResidualRaw:bigint;
  feeClaimRaw:bigint;
  walletTokenRaw:bigint;
}):boolean{
  return input.primaryUnwindInputRaw>0n&&
    input.combinedCloseWithdrawalRaw>=input.feeClaimRaw&&
    input.feeClaimRaw>0n&&
    input.walletTokenRaw===0n&&
    input.primaryUnwindInputRaw===input.combinedCloseWithdrawalRaw+input.openResidualRaw;
}
/** Read the chain immediately before signing.  The plan's market inputs are
 * immutable; a missing/mismatched value is a fail-closed condition, not a
 * reason to substitute the planned lower bin. */
export async function readOpenPresignMarketFacts(input:{rpcUrl:string;programId:string;poolAddress:string;plannedActiveBinId:number;plannedBinStep:number;lowerBinId:number;upperBinId:number;adapter?:Pick<MeteoraReadAdapter,'getPool'|'getActiveBin'>}):Promise<{activeBinId:number;referenceDivergenceBps:number;outsidePlannedRange:boolean}>{
  const adapter=input.adapter??createMeteoraReadAdapter({rpcUrl:input.rpcUrl,cluster:'mainnet-beta',programId:input.programId,priority:'P0_EXECUTION_CRITICAL'});
  const [pool,active]=await Promise.all([adapter.getPool(input.poolAddress),adapter.getActiveBin(input.poolAddress)]);
  if(pool.binStep!==input.plannedBinStep)throw new Error('LPFORGE_P6_PRESIGN_BIN_STEP_MISMATCH');
  const activeBinId=active.binId;
  if(!Number.isInteger(activeBinId))throw new Error('LPFORGE_P6_PRESIGN_ACTIVE_BIN_INVALID');
  return{activeBinId,referenceDivergenceBps:Math.abs(activeBinId-input.plannedActiveBinId)*input.plannedBinStep,outsidePlannedRange:activeBinId<input.lowerBinId||activeBinId>input.upperBinId};
}
export interface FreshExecutionSafetyFacts {
  walletTruthConsistent:boolean;
  protocolCompatible:boolean;
  rpcHealthy:boolean;
  reconciliationRequired:boolean;
  globalKillSwitch:boolean;
  reasonCodes:string[];
}
function planRecord(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function controlledCanaryAuthorization(plan:AutonomousOpenPlan):boolean{
  const provenance=planRecord(plan.planPayload.provenance);
  return Object.keys(planRecord(provenance.controlledCanaryAuthorization)).length>0;
}
/**
 * The worker evaluates an OPEN after it has claimed that exact plan from the
 * durable queue. Exactly one pending execution is therefore expected: the
 * plan now being signed. Any other pending plan remains fail-closed.
 */
/**
 * The fresh-open gate is capacity-aware.  `maxOpenPositions` is deliberately
 * supplied by the parsed runtime policy; it must never silently fall back to
 * a canary value or a source-code constant.
 */
export function assessFreshOpenPortfolioTruth(input:{openPositions:number;pendingExecutionCount:number;unresolvedReconciliationDebt:number;maxOpenPositions:number|undefined}):{clean:boolean;expectedPendingExecutionCount:1;reasonCodes:string[]}{
  const reasons:string[]=[];
  if(!Number.isSafeInteger(input.maxOpenPositions)||input.maxOpenPositions===undefined||input.maxOpenPositions<1)reasons.push("P6_FRESH_EXECUTION_POSITION_LIMIT_INVALID");
  else if(input.openPositions>=input.maxOpenPositions)reasons.push("P6_FRESH_EXECUTION_POSITION_LIMIT_REACHED");
  if(input.pendingExecutionCount!==1)reasons.push("P6_FRESH_EXECUTION_PENDING_PLAN_MISMATCH");
  if(input.unresolvedReconciliationDebt!==0)reasons.push("P6_FRESH_EXECUTION_RECONCILIATION_DEBT");
  return{clean:reasons.length===0,expectedPendingExecutionCount:1,reasonCodes:reasons};
}
/**
 * A submitted OPEN can release capacity only after durable, independent
 * evidence proves that every economic effect is absent. This deliberately
 * excludes swap-funded and chunked cases: those have their own partial-entry
 * recovery evidence and must never be collapsed into a no-effect terminal.
 */
export function assessExpiredNoEffectOpenRecovery(input:{
  confirmationStatus:string;
  economicEffect:"PRESENT"|"ABSENT"|"UNKNOWN";
  positionAbsenceProven:boolean;
  signatureStatusReadUnknown:boolean;
  hasFundingChild:boolean;
  /** The only submitted child is the first, serial funding child and its
   * exact signature has independently proven absent.  No position address is
   * created until later steps, which remain unsubmitted. */
  fundingChildProvenNotLanded?:boolean;
  partialEntryRecoveryPresent:boolean;
  planCashflowCount:number;
  chunkDispositions:string[];
}):{terminal:boolean;reasonCodes:string[]}{
  const reasons:string[]=[];
  if(input.confirmationStatus!=="EXPIRED")reasons.push("P6_NO_EFFECT_SIGNATURE_NOT_EXPIRED");
  if(input.economicEffect!=="ABSENT"&&!input.fundingChildProvenNotLanded)reasons.push("P6_NO_EFFECT_ECONOMIC_EFFECT_NOT_ABSENT");
  if(!input.positionAbsenceProven&&!input.fundingChildProvenNotLanded)reasons.push("P6_NO_EFFECT_POSITION_ABSENCE_UNPROVEN");
  if(input.signatureStatusReadUnknown)reasons.push("P6_NO_EFFECT_SIGNATURE_STATUS_UNKNOWN");
  if(input.hasFundingChild&&!input.fundingChildProvenNotLanded)reasons.push("P6_NO_EFFECT_FUNDING_CHILD_REQUIRES_PARTIAL_RECOVERY");
  if(input.partialEntryRecoveryPresent)reasons.push("P6_NO_EFFECT_PARTIAL_ENTRY_RECOVERY_PRESENT");
  if(input.planCashflowCount!==0)reasons.push("P6_NO_EFFECT_PLAN_CASHFLOW_PRESENT");
  if(input.chunkDispositions.some(disposition=>!["PROVEN_NOT_LANDED","FAILED_PRE_SIGN"].includes(disposition)))reasons.push("P6_NO_EFFECT_CHILD_DISPOSITION_NOT_PROVEN");
  return{terminal:reasons.length===0,reasonCodes:reasons};
}
/** A finalized program failure can retire an OPEN only when its exact receipt
 * fee is the sole durable economic effect and no funding/position effect is
 * possible. It is distinct from an expired attempt and is never resendable. */
export function assessConfirmedFailedOpenRecovery(input:{confirmationStatus:string;economicEffect:'PRESENT'|'ABSENT'|'UNKNOWN';positionAbsenceProven:boolean;signatureStatusReadUnknown:boolean;hasFundingChild:boolean;partialEntryRecoveryPresent:boolean;planCashflowTypes:string[];chunkDispositions:string[]}):{terminal:boolean;reasonCodes:string[]}{
  const reasons:string[]=[];
  if(input.confirmationStatus!=='FAILED')reasons.push('P6_FAILED_OPEN_SIGNATURE_NOT_FAILED');
  if(input.economicEffect!=='ABSENT')reasons.push('P6_FAILED_OPEN_PROTOCOL_EFFECT_NOT_ABSENT');
  if(!input.positionAbsenceProven)reasons.push('P6_FAILED_OPEN_POSITION_ABSENCE_UNPROVEN');
  if(input.signatureStatusReadUnknown)reasons.push('P6_FAILED_OPEN_SIGNATURE_STATUS_UNKNOWN');
  if(input.hasFundingChild)reasons.push('P6_FAILED_OPEN_FUNDING_REQUIRES_PARTIAL_RECOVERY');
  if(input.partialEntryRecoveryPresent)reasons.push('P6_FAILED_OPEN_PARTIAL_ENTRY_RECOVERY_PRESENT');
  if(input.planCashflowTypes.length!==1||input.planCashflowTypes[0]!=='EXECUTION_TX_COST')reasons.push('P6_FAILED_OPEN_RECEIPT_COST_NOT_EXACT');
  if(input.chunkDispositions.some(disposition=>!['CONFIRMED_FAILED','FAILED_PRE_SIGN'].includes(disposition)))reasons.push('P6_FAILED_OPEN_CHILD_EFFECT_NOT_TERMINAL');
  if(!input.chunkDispositions.includes('CONFIRMED_FAILED'))reasons.push('P6_FAILED_OPEN_CHILD_RECEIPT_MISSING');
  return{terminal:reasons.length===0,reasonCodes:reasons};
}
/** Loads the live authorities immediately before economic signing. Nothing in
 * this snapshot is a favorable default: an unavailable source fails closed. */
/**
 * P7 controls have a hard 60-second validity limit.  A control refresh can
 * legitimately commit just after P6 reads the preceding record, so a stale-
 * only result receives one short, pre-sign re-read.  This never extends the
 * control TTL or authorizes a stale/revoked control: the second read must
 * independently pass the same canonical validation.
 */
// P7 normally emits a fresh control record on its bounded daemon cadence.
// Waiting through this small pre-sign window does not extend the 60-second
// authority TTL: the re-read must still pass the same validation. It prevents
// an otherwise healthy plan from losing a slot only because P6 arrived a
// fraction of a cycle before P7 commits its next control record.
const P7_STALE_CONTROL_RELOAD_DELAY_MS=5_000;
/**
 * A stale P7 control maps to EXEC_GLOBAL_KILL_SWITCH in the execution-risk
 * layer. Treat that pair as one pre-sign freshness miss, but never collapse a
 * real health, drift, portfolio, or market veto into a retryable condition.
 */
export function isStaleOnlyPreSignP7ControlBlock(reason:string|readonly string[]):boolean{
  const raw:readonly string[]=typeof reason==='string'?(reason.split(':').at(-1)?.split(',')??[]):reason;
  const codes=raw.map(code=>code.trim()).filter(Boolean);
  return codes.includes('P6_CLAIM_P7_CONTROL_STALE')&&codes.every(code=>code==='P6_CLAIM_P7_CONTROL_STALE'||code==='EXEC_GLOBAL_KILL_SWITCH');
}
async function requeueUnsignedStaleControlOpen(input:{store:Phase1Store;plan:AutonomousOpenPlan;reason:string;stage:string}):Promise<LiveWorkerResult>{
  await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:'PLANNED',at:new Date().toISOString(),reasonCodes:['P6_CLAIM_P7_CONTROL_STALE_REQUEUED'],payload:{stage:input.stage,retryDisposition:'AWAIT_FRESH_P7_CONTROL',priorReason:input.reason,noChainEffect:true}});
  return{status:'AWAITING_FRESH_P7_CONTROL',planId:input.plan.planId,reasonCodes:['P6_CLAIM_P7_CONTROL_STALE'],transactionSubmitted:false};
}
export async function loadFreshExecutionSafetyFacts(input:{store:Pick<Phase1Store,'loadLatestPhase7ControlDecision'|'loadPhase7ControlDecision'|'loadPhase7PortfolioFacts'>;plan:AutonomousOpenPlan;config:Pick<LiveWorkerConfig,'rpcUrl'|'programId'|'maxOpenPositions'|'controlledCanary'>;connection?:Pick<Connection,'getLatestBlockhash'>;now?:string;phase7RuntimeId?:string;protocolCompatibility?:()=>Promise<boolean>;staleControlReloadDelayMs?:number}):Promise<FreshExecutionSafetyFacts>{
  const now=input.now??new Date().toISOString(),reasons:string[]=[],runtimeId=input.phase7RuntimeId??(process.env.LPFORGE_P7_RUNTIME_ID??'lpforge-production').trim(),provenance=planRecord(input.plan.planPayload.provenance),binding=planRecord(provenance.phase7Control),boundDecisionId=String(binding.decisionId??'');
  let portfolio:Awaited<ReturnType<Phase1Store['loadPhase7PortfolioFacts']>>|undefined,current;
  try{
    const readPhase7=async(at:string)=>{
      const [currentRow,boundRow,facts]=await Promise.all([input.store.loadLatestPhase7ControlDecision(runtimeId),boundDecisionId?input.store.loadPhase7ControlDecision(runtimeId,boundDecisionId):Promise.resolve(undefined),input.store.loadPhase7PortfolioFacts(input.plan.ownerAddress)]);
      const fresh=phase7ExecutionControlFromRow(currentRow),bound=phase7ExecutionControlFromRow(boundRow);
      return{current:fresh,portfolio:facts,reasonCodes:validateFreshOpenPhase7Safety({plan:input.plan as unknown as AutonomousPlan,current:fresh,bound,now:at,controlledCanary:controlledCanaryAuthorization(input.plan),maxConcurrentPositions:input.config.maxOpenPositions})};
    };
    let phase7=await readPhase7(now);
    if(phase7.reasonCodes.length===1&&phase7.reasonCodes[0]==='P6_CLAIM_P7_CONTROL_STALE'){
      const delay=Math.max(0,Math.min(5_000,Math.floor(input.staleControlReloadDelayMs??P7_STALE_CONTROL_RELOAD_DELAY_MS)));
      if(delay>0)await new Promise<void>(resolve=>setTimeout(resolve,delay));
      // Tests provide `now` for deterministic control-age assertions.  A live
      // worker must measure the re-read against real wall clock time.
      phase7=await readPhase7(input.now??new Date().toISOString());
    }
    current=phase7.current;portfolio=phase7.portfolio;reasons.push(...phase7.reasonCodes);
  }catch{reasons.push('P6_FRESH_EXECUTION_SAFETY_P7_OR_PORTFOLIO_UNAVAILABLE');}
  const portfolioTruth=portfolio===undefined?undefined:assessFreshOpenPortfolioTruth({...portfolio,maxOpenPositions:input.config.maxOpenPositions});
  const portfolioClean=portfolioTruth?.clean===true;
  if(!portfolioClean)reasons.push("P6_FRESH_EXECUTION_PORTFOLIO_NOT_CLEAN",...(portfolioTruth?.reasonCodes??[]));
  let rpcHealthy=false;
  try{const connection=input.connection??createGovernedConnection({rpcUrl:input.config.rpcUrl,priority:'P0_EXECUTION_CRITICAL'});await connection.getLatestBlockhash('confirmed');rpcHealthy=true;}catch{reasons.push('P6_FRESH_EXECUTION_RPC_UNHEALTHY');}
  let protocolCompatible=false;
  try{protocolCompatible=input.protocolCompatibility?await input.protocolCompatibility():(await createMeteoraReadAdapter({rpcUrl:input.config.rpcUrl,cluster:'mainnet-beta',programId:input.config.programId,priority:'P0_EXECUTION_CRITICAL'}).verifyCompatibility(input.plan.poolAddress)).state==='VERIFIED';if(!protocolCompatible)reasons.push('P6_FRESH_EXECUTION_PROTOCOL_INCOMPATIBLE');}catch{reasons.push('P6_FRESH_EXECUTION_PROTOCOL_UNAVAILABLE');}
  return{walletTruthConsistent:portfolioClean,protocolCompatible,rpcHealthy,reconciliationRequired:!portfolioClean,globalKillSwitch:reasons.some(code=>code.startsWith('P6_CANARY_')||code.startsWith('P6_CLAIM_P7_')),reasonCodes:[...new Set(reasons)].sort()};
}
/** Lightweight check after local signing and before transmission. It deliberately
 * avoids market re-simulation while still rejecting a new hard revocation. */
export async function checkFreshOpenSubmissionSafety(input:{store:Pick<Phase1Store,'loadLatestPhase7ControlDecision'|'loadPhase7ControlDecision'|'loadPhase7PortfolioFacts'>;plan:AutonomousOpenPlan;config:Pick<LiveWorkerConfig,'maxOpenPositions'|'controlledCanary'>;permitExpiresAt:string;now?:string;phase7RuntimeId?:string}):Promise<{approved:boolean;reasonCodes:string[]}>{
  const now=input.now??new Date().toISOString(),reasons:string[]=[],runtimeId=input.phase7RuntimeId??(process.env.LPFORGE_P7_RUNTIME_ID??'lpforge-production').trim(),provenance=planRecord(input.plan.planPayload.provenance),binding=planRecord(provenance.phase7Control),boundDecisionId=String(binding.decisionId??'');
  if(!Number.isFinite(Date.parse(input.permitExpiresAt))||Date.parse(input.permitExpiresAt)<=Date.parse(now))reasons.push('P6_PRESUBMISSION_RISK_PERMIT_EXPIRED');
  try{const [currentRow,boundRow,portfolio]=await Promise.all([input.store.loadLatestPhase7ControlDecision(runtimeId),boundDecisionId?input.store.loadPhase7ControlDecision(runtimeId,boundDecisionId):Promise.resolve(undefined),input.store.loadPhase7PortfolioFacts(input.plan.ownerAddress)]);reasons.push(...validateFreshOpenPhase7Safety({plan:input.plan as unknown as AutonomousPlan,current:phase7ExecutionControlFromRow(currentRow),bound:phase7ExecutionControlFromRow(boundRow),now,controlledCanary:controlledCanaryAuthorization(input.plan),maxConcurrentPositions:input.config.maxOpenPositions}));if(!assessFreshOpenPortfolioTruth({...portfolio,maxOpenPositions:input.config.maxOpenPositions}).clean)reasons.push("P6_PRESUBMISSION_RECONCILIATION_OR_PORTFOLIO_BLOCK");}catch{reasons.push("P6_PRESUBMISSION_SAFETY_UNAVAILABLE");}
  return{approved:reasons.length===0,reasonCodes:[...new Set(reasons)].sort()};
}
async function governFreshOpenRisk(input:{store:Pick<Phase1Store,'loadLatestPhase7ControlDecision'|'loadPhase7ControlDecision'|'loadPhase7PortfolioFacts'>;plan:AutonomousOpenPlan;config:LiveWorkerConfig;connection?:Pick<Connection,'getLatestBlockhash'>;simulation:{ok:boolean;simulationFreshUntil:string};costApproved:boolean;fields:ReturnType<typeof planFields>}):Promise<ReturnType<typeof governExecutionRisk>>{
  const [market,safety]=await Promise.all([readOpenPresignMarketFacts({rpcUrl:input.config.rpcUrl,programId:input.config.programId,poolAddress:input.plan.poolAddress,plannedActiveBinId:input.fields.plannedActiveBinId,plannedBinStep:input.fields.binStep,lowerBinId:input.fields.lower,upperBinId:input.fields.upper}),loadFreshExecutionSafetyFacts({store:input.store,plan:input.plan,config:input.config,...(input.connection?{connection:input.connection}:{})})]);
  const risk=governExecutionRisk({action:'OPEN',planId:input.plan.planId,now:new Date().toISOString(),thesisExpiresAt:input.plan.expiresAt,planExpiresAt:input.plan.expiresAt,simulationOk:input.simulation.ok,simulationFreshUntil:input.simulation.simulationFreshUntil,walletTruthConsistent:safety.walletTruthConsistent,protocolCompatible:safety.protocolCompatible,rpcHealthy:safety.rpcHealthy,referenceDivergenceBps:market.referenceDivergenceBps,activeBinId:market.activeBinId,intendedCenterBinId:input.fields.plannedActiveBinId,costApproved:input.costApproved,reconciliationRequired:safety.reconciliationRequired,globalKillSwitch:safety.globalKillSwitch,liquidityCollapse:market.outsidePlannedRange},{maxReferenceDivergenceBps:input.config.maxPresignReferenceDivergenceBps,maxActiveBinDriftBins:input.config.maxPresignActiveBinDriftBins,approvalTtlMs:input.config.riskPermitTtlMs,allowEmergencyCostOverride:false});
  return safety.reasonCodes.length?{...risk,reasonCodes:[...new Set([...risk.reasonCodes,...safety.reasonCodes])].sort()}:risk;
}
function openPlan(plan: AutonomousPlan): AutonomousOpenPlan {
  if (plan.action !== "OPEN")
    throw new Error(`LPFORGE_P6_PLAN_ACTION_UNSUPPORTED:${plan.action}`);
  const open = plan.steps.find((step) => step.kind === "METEORA_OPEN" || step.kind === "METEORA_POSITION_EXTEND"),
    swap = plan.steps.find((step) => step.kind === "JUPITER_SWAP");
  if (!open) throw new Error("LPFORGE_P6_AUTONOMOUS_PLAN_OPEN_STEP_MISSING");
  return {
    planId: plan.planId,
    intentId: plan.intentId,
    idempotencyKey: plan.idempotencyKey,
    poolAddress: plan.poolAddress,
    ownerAddress: plan.ownerAddress,
    thesisId: plan.thesisId,
    observedAt: plan.observedAt,
    expiresAt: plan.expiresAt,
    intentPayload: plan.intentPayload,
    planPayload: plan.planPayload,
    transactionId: open.transactionId,
    transactionMetadata: open.metadata,
    steps: plan.steps.filter((step) => step.kind === "METEORA_OPEN" || step.kind === "METEORA_POSITION_EXTEND" || step.kind === "METEORA_OPEN_CHUNK").map((step) => ({transactionId:step.transactionId,kind:step.kind,metadata:step.metadata})),
    ...(swap
      ? {
          swapTransactionId: swap.transactionId,
          swapTransactionMetadata: swap.metadata,
        }
      : {}),
  };
}
function ledger(store: Phase1Store): SubmissionLedger {
  return {
    prepare: (v) => store.prepareSubmissionAttempt(v),
    markSent: (attemptId, signature, submittedAt) =>
      store.markSubmissionSent(attemptId, signature, submittedAt),
    markUnknown: (attemptId, at, error, signature) =>
      store.markSubmissionUnknown(attemptId, at, error, signature),
    recordConfirmation: (v) =>
      store.insertExecutionConfirmation({
        attemptId: v.attemptId,
        ...(v.signature ? { signature: v.signature } : {}),
        status: v.status,
        observedAt: v.observedAt,
        ...(v.slot !== undefined ? { slot: v.slot } : {}),
        ...(v.error ? { error: v.error } : {}),
        payload: v.payload,
      }),
  };
}
/**
 * PostgreSQL store rows are deliberately returned as their durable column
 * names.  Journal ownership checks run on both the create-race and ordinary
 * update paths, so accepting only the in-memory camelCase representation
 * would turn a second update of the same child into a false identity
 * conflict.  Do not relax the check: normalize the one canonical field.
 */
export function executionJournalPlanId(row: {planId?:unknown;plan_id?:unknown}): string | undefined {
  const value = row.planId ?? row.plan_id;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** A nested child crossed the submission boundary but has no proven terminal
 * confirmation. Its identity must reach the parent state machine; it is never
 * permission to resend. */
export class P6PostSubmissionConfirmationPending extends Error {
  readonly planId:string; readonly transactionId:string; readonly attemptId:string; readonly signature:string;
  /** Diagnostic reason only; the persisted attempt remains authoritative. */
  readonly submissionReason:string;
  constructor(v:{planId:string;transactionId:string;attemptId:string;signature:string;reason?:string}) {
    super(v.reason??"LPFORGE_P6_SWAP_CONFIRMATION_PENDING"); this.name="P6PostSubmissionConfirmationPending";
    this.planId=v.planId;this.transactionId=v.transactionId;this.attemptId=v.attemptId;this.signature=v.signature;
    this.submissionReason=v.reason??"LPFORGE_P6_SWAP_CONFIRMATION_PENDING";
  }
}

async function recordJournal(
  store: Phase1Store,
  plan: AutonomousPlan,
  state: ExecutionJournalState,
  payload: Record<string, unknown>,
  signature?: string,
) {
  const existing = await store.getExecutionJournal(plan.idempotencyKey);
  if (!existing) {
    const created = await store.createExecutionJournal({
      // A terminal workflow can have several independently signed children.
      // Their journals must never share a state machine: child 1 may be
      // CONFIRMED while child 2 is only about to be signed.
        journalId: plan.idempotencyKey.includes(":close-child:")
        ? `journal-${plan.idempotencyKey}`
        : `journal-${plan.planId}`,
      idempotencyKey: plan.idempotencyKey,
      planId: plan.planId,
      ...(typeof payload.transactionId === "string"
        ? { transactionId: payload.transactionId }
        : plan.steps[0] ? { transactionId: plan.steps[0].transactionId } : {}),
      state,
      ...(signature ? { signature } : {}),
      version: 1,
      updatedAt: new Date().toISOString(),
      payload,
    });
    if (created) return;
    // Another worker may have won the insert between our read and create.
    // Never continue toward signing with an unrecorded child cursor: reload
    // the winner and perform the same optimistic transition below.
    const raced = await store.getExecutionJournal(plan.idempotencyKey);
    if (!raced)
      throw new Error("LPFORGE_EXECUTION_JOURNAL_CREATE_CONFLICT_UNRESOLVED");
    if(executionJournalPlanId(raced)!==plan.planId)
      throw new Error("LPFORGE_EXECUTION_JOURNAL_IDEMPOTENCY_IDENTITY_CONFLICT");
    assertExecutionJournalTransition(String(raced.state) as ExecutionJournalState, state);
    const updated = await store.updateExecutionJournal({
      idempotencyKey: plan.idempotencyKey,
      expectedVersion: Number(raced.version),
      ...(typeof payload.transactionId === "string"
        ? { transactionId: payload.transactionId }
        : {}),
      state,
      ...(signature ? { signature } : {}),
      updatedAt: new Date().toISOString(),
      payload,
    });
    if (!updated)
      throw new Error("LPFORGE_EXECUTION_JOURNAL_CONCURRENT_UPDATE");
    return;
  }
  if(executionJournalPlanId(existing)!==plan.planId)
    throw new Error("LPFORGE_EXECUTION_JOURNAL_IDEMPOTENCY_IDENTITY_CONFLICT");
  assertExecutionJournalTransition(String(existing.state) as ExecutionJournalState, state);
  const updated = await store.updateExecutionJournal({
    idempotencyKey: plan.idempotencyKey,
    expectedVersion: Number(existing.version),
    ...(typeof payload.transactionId === "string"
      ? { transactionId: payload.transactionId }
      : {}),
    state,
    ...(signature ? { signature } : {}),
    updatedAt: new Date().toISOString(),
    payload,
  });
  if (!updated)
    throw new Error("LPFORGE_EXECUTION_JOURNAL_CONCURRENT_UPDATE");
}

/**
 * A durable submission attempt is stronger evidence than an interrupted
 * parent-journal write.  Complete only the otherwise-missing normal journal
 * boundaries, then enter reconciliation.  This is deliberately narrow: it
 * is usable only with the exact attempt/signature that crossed submission.
 */
export async function recordPostSubmissionReconciliation(input:{store:Phase1Store;plan:AutonomousPlan;transactionId:string;signature:string;payload:Record<string,unknown>}) {
  const base={...input.payload,action:input.plan.action,transactionId:input.transactionId,postSubmission:true};
  let current=await input.store.getExecutionJournal(input.plan.idempotencyKey);
  if(!current){
    await recordJournal(input.store,input.plan,'SIGNING',base);
    current=await input.store.getExecutionJournal(input.plan.idempotencyKey);
  }
  if(!current)throw new Error('LPFORGE_EXECUTION_JOURNAL_POST_SUBMISSION_MISSING');
  const state=String(current.state) as ExecutionJournalState;
  if(['PLAN_CREATED','BUILT','SIMULATED','APPROVED'].includes(state))
    await recordJournal(input.store,input.plan,'SIGNING',base);
  const afterSigning=await input.store.getExecutionJournal(input.plan.idempotencyKey);
  if(!afterSigning)throw new Error('LPFORGE_EXECUTION_JOURNAL_POST_SUBMISSION_MISSING');
  if(String(afterSigning.state)==='SIGNING')
    await recordJournal(input.store,input.plan,'SIGNED',base);
  const afterSigned=await input.store.getExecutionJournal(input.plan.idempotencyKey);
  if(!afterSigned)throw new Error('LPFORGE_EXECUTION_JOURNAL_POST_SUBMISSION_MISSING');
  if(String(afterSigned.state)==='SIGNED')
    await recordJournal(input.store,input.plan,'UNKNOWN_SUBMISSION',base,input.signature);
  const submitted=await input.store.getExecutionJournal(input.plan.idempotencyKey);
  if(!submitted)throw new Error('LPFORGE_EXECUTION_JOURNAL_POST_SUBMISSION_MISSING');
  if(['SUBMITTED','UNKNOWN_SUBMISSION'].includes(String(submitted.state)))
    await recordJournal(input.store,input.plan,'RECONCILIATION_REQUIRED',base,input.signature);
  else if(String(submitted.state)!=='RECONCILIATION_REQUIRED')
    throw new Error(`LPFORGE_EXECUTION_JOURNAL_POST_SUBMISSION_STATE_INVALID:${String(submitted.state)}`);
}
function authority(
  level: "MAINNET_BUILD_SIMULATE" | "MAINNET_CANARY",
  now: string,
  ttlMs: number,
) {
  return {
    phase: "P5" as const,
    cluster: "mainnet-beta" as const,
    level,
    liveExecution: level === "MAINNET_CANARY",
    issuedAt: now,
    expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
    reasonCodes: ["P6_AUTONOMOUS_DISPATCH"],
  };
}
function ticket(
  plan: Pick<AutonomousPlan, "planId" | "poolAddress" | "ownerAddress">,
  capital: bigint,
  now: string,
  ttlMs: number,
  maxOpenPositions: number,
  action: AutonomousPlanAction = "OPEN",
) {
  if(!Number.isSafeInteger(maxOpenPositions)||maxOpenPositions<1)throw new Error("LPFORGE_P6_RUNTIME_POSITION_LIMIT_INVALID");
  return {
    ticketId: `${plan.planId}:${action.toLowerCase()}:${Date.parse(now)}`,
    poolAddress: plan.poolAddress,
    ownerAddress: plan.ownerAddress,
    action,
    maxLamports: capital,
    maxOpenPositions,
    issuedAt: now,
    expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
    policyHash: "autonomous-plan-bound",
    autonomousScaling: false as const,
  };
}
function executionMaxOpenPositions(config:Pick<LiveWorkerConfig,"maxOpenPositions">):number{
  if(!Number.isSafeInteger(config.maxOpenPositions)||config.maxOpenPositions===undefined||config.maxOpenPositions<1)throw new Error("LPFORGE_P6_RUNTIME_POSITION_LIMIT_INVALID");
  return config.maxOpenPositions;
}

/**
 * An entry-plan deadline never authorizes new risk after it expires.  It must
 * also not strand capital that was already deployed: a CLOSE/EMERGENCY_CLOSE
 * against a known PositionV2 receives only a fresh, short-lived protective
 * execution permit and remains subject to simulation, RPC, wallet and
 * protocol checks.  OPEN and every risk-increasing action retain the original
 * plan deadline exactly.
 */
export function mutationRiskPlanExpiry(input: {
  action: AutonomousPlanAction;
  positionAddress?: string;
  planExpiresAt: string;
  now: string;
  protectivePermitTtlMs: number;
}): string {
  if (
    (input.action === "CLOSE" || input.action === "EMERGENCY_CLOSE") &&
    input.positionAddress
  )
    return new Date(
      Date.parse(input.now) + input.protectivePermitTtlMs,
    ).toISOString();
  return input.planExpiresAt;
}
async function awaitConfirmation(input: {
  connection: Connection;
  store: Phase1Store;
  transactionId: string;
  idempotencyKey: string;
  signature: string;
  lease: { blockhash: string; lastValidBlockHeight: number };
  pollMs: number;
  attempts: number;
}) {
  const record = {
    transactionId: input.transactionId,
    signature: input.signature,
    submittedAt: new Date().toISOString(),
    blockhash: input.lease.blockhash,
    lastValidBlockHeight: input.lease.lastValidBlockHeight,
    attempt: 1,
  };
  for (let i = 0; i < input.attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, input.pollMs));
    const confirmation = await observeConfirmation({
      attemptId: `${input.transactionId}:attempt:1`,
      record,
      transport: createWeb3SubmissionTransport(input.connection),
      ledger: ledger(input.store),
      observedAt: new Date().toISOString(),
    });
    if (
      confirmation.status === "CONFIRMED" ||
      confirmation.status === "FINALIZED"
    )
      return confirmation;
    if (confirmation.status === "FAILED" || confirmation.status === "EXPIRED")
      throw new Error(`LPFORGE_P6_CONFIRM_${confirmation.status}`);
  }
  return undefined;
}
async function executeRequiredJupiterSwap(input: {
  store: Phase1Store;
  plan: AutonomousOpenPlan;
  signer: MainnetSignerBackend;
  connection: Connection;
  config: LiveWorkerConfig;
  openTicket: ReturnType<typeof ticket>;
  openAuthority: {
    phase: "P6";
    cluster: "mainnet-beta";
    level: "MAINNET_CANARY_OPEN";
    liveExecution: true;
    canaryOnly: true;
    issuedAt: string;
    expiresAt: string;
    ticketId: string;
    reasonCodes: string[];
  };
}): Promise<{
  signature: string;
  tokenMint: string;
  pairedTokenAmount: string;
  pairedTokenRawBeforeFunding: string;
  nativeLamportsBefore: string;
  wsolRawBefore: string;
  fundedAt: string;
}> {
  if (!input.plan.swapTransactionId)
    throw new Error("LPFORGE_P6_SWAP_TRANSACTION_REQUIRED");
  const funding = input.plan.intentPayload.entryFunding as
    | Record<string, unknown>
    | undefined;
  if (!funding) throw new Error("LPFORGE_P6_SWAP_FUNDING_MISSING");
  const sol = BigInt(String(funding.solToPairedTokenLamports ?? "0")),
    required = BigInt(String(funding.totalPairedTokenRaw ?? "0"));
  if (sol <= 0n || required <= 0n)
    throw new Error("LPFORGE_P6_SWAP_FUNDING_INVALID");
  const policy = loadAutonomousEntryPolicy();
  const adapter = createMeteoraReadAdapter({
    rpcUrl: input.config.rpcUrl,
    cluster: "mainnet-beta",
    programId: input.config.programId,
    priority:'P0_EXECUTION_CRITICAL',
  });
  const pool = await adapter.getPool(input.plan.poolAddress);
  const [nativeLamportsBefore,wsolRawBefore,pairedTokenRawBeforeFunding]=await Promise.all([
    input.connection.getBalance(new PublicKey(input.plan.ownerAddress),"confirmed").then(value=>BigInt(value)),
    readWalletTokenBalance({connection:input.connection,ownerAddress:input.plan.ownerAddress,mint:WSOL_MINT}),
    readWalletTokenBalance({connection:input.connection,ownerAddress:input.plan.ownerAddress,mint:pool.tokenXMint}),
  ]);
  const quote = await readJupiterMetisQuote({
    policy: policy.swapQuote,
    inputMint: pool.tokenYMint,
    outputMint: pool.tokenXMint,
    amount: sol,
    ...(process.env.LPFORGE_JUPITER_API_KEY
      ? { apiKey: process.env.LPFORGE_JUPITER_API_KEY }
      : {}),
  });
  const assessment = assessSwapQuote({
    quote,
    policy: policy.swapQuote,
    inputMint: pool.tokenYMint,
    outputMint: pool.tokenXMint,
    inputAmount: sol,
    requiredOutputAmount: required,
  });
  if (assessment.status !== "APPROVED")
    throw new Error(
      `LPFORGE_P6_SWAP_QUOTE_BLOCKED:${assessment.reasonCodes.join(",")}`,
    );
  const bytes = await buildJupiterMetisSwapTransaction({
      policy: policy.swapQuote,
      quote,
      userPublicKey: input.plan.ownerAddress,
      ...(process.env.LPFORGE_JUPITER_API_KEY
        ? { apiKey: process.env.LPFORGE_JUPITER_API_KEY }
        : {}),
    }),
    transaction = VersionedTransaction.deserialize(bytes),
    simAuthority = authority(
      "MAINNET_BUILD_SIMULATE",
      new Date().toISOString(),
      input.config.riskPermitTtlMs,
    ),
    simulation = await simulateExecutionTransaction({
      authority: simAuthority,
      transactionId: input.plan.swapTransactionId,
      transaction,
      transport: createWeb3SimulationTransport(input.connection),
      simulatedAt: new Date().toISOString(),
      freshnessMs: input.config.simulationFreshnessMs,
    });
  await input.store.insertExecutionSimulation({
    transactionId: input.plan.swapTransactionId,
    simulatedAt: simulation.simulatedAt,
    freshUntil: simulation.simulationFreshUntil,
    ok: simulation.ok,
    ...(simulation.unitsConsumed !== undefined
      ? { unitsConsumed: simulation.unitsConsumed }
      : {}),
    logs: simulation.logs,
    ...(simulation.error ? { error: simulation.error } : {}),
    payload: {
      planId: input.plan.planId,
      stage: "JUPITER_SWAP",
      quoteSlot: quote.contextSlot,
    },
  });
  const fee = estimateExecutionFee({
      signatureCount: 1,
      computeUnitLimit: simulation.recommendedComputeUnitLimit ?? 0,
      computeUnitPriceMicroLamports: 0n,
    }),
    cost = assessExecutionCost(fee, sol, {
      maxAbsoluteFeeLamports: input.config.maxFeeLamports,
      maxFeeFractionOfCapital: input.config.maxFeeFraction,
    }),
    fields=planFields(input.plan),
    risk=await governFreshOpenRisk({store:input.store,plan:input.plan,config:input.config,connection:input.connection,simulation,costApproved:cost.approved,fields});
  if (risk.decision !== "APPROVE" || !risk.permitId || !risk.expiresAt)
    throw new Error(
      `LPFORGE_P6_SWAP_RISK_BLOCKED:${risk.reasonCodes.join(",")}`,
    );
  await input.store.insertExecutionRiskPermit({
    permitId: risk.permitId,
    planId: input.plan.planId,
    decision: risk.decision,
    issuedAt: risk.issuedAt,
    expiresAt: risk.expiresAt,
    reasonCodes: risk.reasonCodes,
    payload: { stage: "JUPITER_SWAP", autonomous: true },
  });
  const envelope = createVersionedMainnetEnvelope(transaction),
    signedAt = new Date().toISOString();
  await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'SIGNING',{action:'OPEN',transactionId:input.plan.swapTransactionId,stage:'JUPITER_SWAP'});
  await signMainnetCanary({
    authority: input.openAuthority,
    ticket: input.openTicket,
    transactionId: input.plan.swapTransactionId,
    requiredSignerAddresses: [input.plan.ownerAddress],
    backend: input.signer,
    envelope,
    signedAt,
  });
  await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'SIGNED',{action:'OPEN',transactionId:input.plan.swapTransactionId,stage:'JUPITER_SWAP'});
  const finalSafety=await checkFreshOpenSubmissionSafety({store:input.store,plan:input.plan,config:input.config,permitExpiresAt:risk.expiresAt!});
  if(!finalSafety.approved)throw new Error(`LPFORGE_P6_PRESUBMISSION_SAFETY_BLOCKED:${finalSafety.reasonCodes.join(',')}`);
  const record = await submitSignedTransaction({
    authority: authority(
      "MAINNET_CANARY",
      signedAt,
      input.config.riskPermitTtlMs,
    ),
    riskDecision: risk,
    transactionId: input.plan.swapTransactionId,
    idempotencyKey: `${input.plan.idempotencyKey}:swap`,
    attempt: 1,
    raw: envelope.serializeSigned(),
    lease: {
      blockhash: transaction.message.recentBlockhash,
      lastValidBlockHeight: (await input.connection.getBlockHeight()) + 150,
    },
    ledger: ledger(input.store),
    transport: createWeb3SubmissionTransport(input.connection),
    submittedAt: signedAt,
  });
  // A successful submit has crossed the economic boundary. Preserve its
  // identity through every subsequent confirmation/receipt failure so the
  // parent cannot misclassify it as a pre-submission block.
  try {
  await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'SUBMITTED',{action:'OPEN',transactionId:input.plan.swapTransactionId,stage:'JUPITER_SWAP'},record.signature);
  if (
    !(await awaitConfirmation({
      connection: input.connection,
      store: input.store,
      transactionId: input.plan.swapTransactionId,
      idempotencyKey: `${input.plan.idempotencyKey}:swap`,
      signature: record.signature,
      lease: record,
      pollMs: input.config.confirmPollMs,
      attempts: input.config.confirmAttempts,
    }))
  )
    throw new P6PostSubmissionConfirmationPending({planId:input.plan.planId,transactionId:input.plan.swapTransactionId,attemptId:`${input.plan.swapTransactionId}:attempt:1`,signature:record.signature});
  const [nativeLamportsAfter,wsolRawAfter,pairedTokenRawAfter]=await Promise.all([
    input.connection.getBalance(new PublicKey(input.plan.ownerAddress),"confirmed").then(value=>BigInt(value)),
    readWalletTokenBalance({connection:input.connection,ownerAddress:input.plan.ownerAddress,mint:WSOL_MINT}),
    readWalletTokenBalance({connection:input.connection,ownerAddress:input.plan.ownerAddress,mint:pool.tokenXMint}),
  ]);
  const actualFee=await confirmedTransactionFeeLamports(input.connection,record.signature)??fee.totalFeeLamports,
    fundingReceipt=await loadParsedConfirmedExecutionReceipt(input.connection,record.signature),
    receiptContribution=deriveReceiptBoundSolContribution({receipt:fundingReceipt,ownerAddress:input.plan.ownerAddress,...(fundingReceipt.staticAccountKeys[0]?{feePayerAddress:fundingReceipt.staticAccountKeys[0]}:{})}),
    settlement=deriveEntryFundingSettlement({nativeLamportsBefore,nativeLamportsAfter,wsolRawBefore,wsolRawAfter,pairedTokenRawBefore:pairedTokenRawBeforeFunding,pairedTokenRawAfter,transactionFeeLamports:actualFee}),
    fundedAt=new Date().toISOString();
  await input.store.insertPlanCashflow({cashflowId:`${input.plan.planId}:entry-funding-sol-out`,planId:input.plan.planId,flowType:"ENTRY_FUNDING_SOL_OUT",observedAt:fundedAt,lamports:receiptContribution?.principalLamports??settlement.solAssetOutLamports,transactionSignature:record.signature,payload:{source:receiptContribution?'RECEIPT_NET_OF_RENT':'WALLET_DELTA_BASIS_UNPROVEN',nativeLamportsBefore:nativeLamportsBefore.toString(),nativeLamportsAfter:nativeLamportsAfter.toString(),wsolRawBefore:wsolRawBefore.toString(),wsolRawAfter:wsolRawAfter.toString(),quoteInputAmount:String(quote.inAmount??sol),quoteOutputAmount:String(quote.outAmount??""),...(receiptContribution?{receiptPrincipalLamports:receiptContribution.principalLamports.toString(),recoverableRentDebitsLamports:receiptContribution.recoverableRentDebitsLamports.toString(),recoverableRentRefundsLamports:receiptContribution.recoverableRentRefundsLamports.toString(),receiptReasonCodes:receiptContribution.reasonCodes}:{basisState:'INCOMPLETE'})}});
  await input.store.insertPlanCashflow({cashflowId:`${input.plan.planId}:entry-funding-x-in`,planId:input.plan.planId,flowType:"ENTRY_FUNDING_X_IN",observedAt:fundedAt,tokenMint:pool.tokenXMint,tokenAmountRaw:settlement.pairedTokenReceivedRaw.toString(),transactionSignature:record.signature,payload:{source:"WALLET_DELTA",before:pairedTokenRawBeforeFunding.toString(),after:pairedTokenRawAfter.toString(),requestedRaw:required.toString()}});
  await input.store.insertPlanCashflow({cashflowId:`${input.plan.planId}:entry-funding-tx-cost`,planId:input.plan.planId,flowType:"FUNDING_TX_COST",observedAt:fundedAt,lamports:actualFee,transactionSignature:record.signature,payload:{source:actualFee===fee.totalFeeLamports?"EXECUTION_FEE_ESTIMATE":"CHAIN_RECEIPT_META",transactionId:input.plan.swapTransactionId}});
  return {
    signature: record.signature,
    tokenMint: pool.tokenXMint,
    pairedTokenAmount: settlement.pairedTokenReceivedRaw.toString(),
    pairedTokenRawBeforeFunding: pairedTokenRawBeforeFunding.toString(),
    nativeLamportsBefore: nativeLamportsBefore.toString(),
    wsolRawBefore: wsolRawBefore.toString(),
    fundedAt,
  };
  } catch (error) {
    if (error instanceof P6PostSubmissionConfirmationPending) throw error;
    throw new P6PostSubmissionConfirmationPending({
      planId:input.plan.planId,
      transactionId:input.plan.swapTransactionId,
      attemptId:`${input.plan.swapTransactionId}:attempt:1`,
      signature:record.signature,
      reason:error instanceof Error?error.message:"LPFORGE_P6_SWAP_POST_SUBMISSION_UNKNOWN",
    });
  }
}
/**
 * Executes an extended PositionV2 open as an ordered durable plan. Every SDK
 * chunk is independently simulated and confirmed before the next one is sent.
 * A post-extension interruption is never retried blindly: the plan remains in
 * reconciliation-required state with its exact completed step/signature.
 */
async function executeChunkableAutonomousOpen(input:{store:Phase1Store;plan:AutonomousOpenPlan;signer:MainnetSignerBackend;config:LiveWorkerConfig;connection:Connection;pool:MeteoraOpenAddPoolLike;prepared:PreparedAutonomousOpen;fields:ReturnType<typeof planFields>;entryFundingMeasurement?:EntryFundingMeasurement}):Promise<LiveWorkerResult>{
  let submittedAny=false,submissionStatusUnknown=false,lastSignature='',confirmedEntrySlot:bigint|undefined,completedSteps:Array<{transactionId:string;kind:string;signature:string;estimatedFeeLamports:bigint}>=[],currentStep:{transactionId:string;sequence:number;kind:string;lastValidBlockHeight?:bigint;signature?:string;submitted:boolean}|undefined,confirmedLiquiditySolAssetOut=0n;
  try{
    for(const [stepIndex,step] of input.prepared.steps.entries()){
      currentStep={transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,submitted:false};
      await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:'PENDING',observedAt:new Date().toISOString(),payload:{chunked:true,metadata:step.metadata}});
      const simulatedAt=new Date().toISOString(),simulation=await simulateExecutionTransaction({authority:authority('MAINNET_BUILD_SIMULATE',simulatedAt,input.config.riskPermitTtlMs),transactionId:step.transactionId,transaction:step.transaction,transport:createWeb3SimulationTransport(input.connection),simulatedAt,freshnessMs:input.config.simulationFreshnessMs});
      await input.store.insertExecutionSimulation({transactionId:step.transactionId,simulatedAt:simulation.simulatedAt,freshUntil:simulation.simulationFreshUntil,ok:simulation.ok,...(simulation.unitsConsumed!==undefined?{unitsConsumed:simulation.unitsConsumed}:{}),logs:simulation.logs,...(simulation.error?{error:simulation.error}:{}),payload:{planId:input.plan.planId,positionAddress:input.prepared.positionSigner.publicKeyAddress,operation:step.kind,chunked:true}});
      const fee=estimateExecutionFee({signatureCount:step.requiredSignerAddresses.length,computeUnitLimit:simulation.recommendedComputeUnitLimit??0,computeUnitPriceMicroLamports:0n}),cost=assessExecutionCost(fee,input.fields.capital,{maxAbsoluteFeeLamports:input.config.maxFeeLamports,maxFeeFractionOfCapital:input.config.maxFeeFraction}),risk=await governFreshOpenRisk({store:input.store,plan:input.plan,config:input.config,connection:input.connection,simulation,costApproved:cost.approved,fields:input.fields});
      if(risk.decision!=='APPROVE'||!risk.permitId||!risk.expiresAt)throw new Error(`LPFORGE_P6_CHUNK_SIMULATE_RISK:${risk.reasonCodes.join(',')}`);
      await input.store.insertExecutionRiskPermit({permitId:`${risk.permitId}:${step.transactionId}`,planId:input.plan.planId,decision:risk.decision,issuedAt:risk.issuedAt,expiresAt:risk.expiresAt,reasonCodes:risk.reasonCodes,payload:{autonomous:true,transactionId:step.transactionId,chunked:true,feeLamports:fee.totalFeeLamports.toString()}});
      const latest=await input.connection.getLatestBlockhash('confirmed');currentStep!.lastValidBlockHeight=BigInt(latest.lastValidBlockHeight);step.transaction.recentBlockhash=latest.blockhash;step.transaction.lastValidBlockHeight=latest.lastValidBlockHeight;step.transaction.feePayer=new PublicKey(input.plan.ownerAddress);const submittedAt=new Date().toISOString(),openTicket=ticket(input.plan as unknown as AutonomousPlan,input.fields.capital,submittedAt,input.config.riskPermitTtlMs,executionMaxOpenPositions(input.config),"OPEN"),openAuthority={phase:'P6' as const,cluster:'mainnet-beta' as const,level:'MAINNET_CANARY_OPEN' as const,liveExecution:true,canaryOnly:true,issuedAt:submittedAt,expiresAt:openTicket.expiresAt,ticketId:openTicket.ticketId,reasonCodes:['P6_AUTONOMOUS_CHUNK_FINAL_REVALIDATION',step.kind]};
      await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'SIGNING',{action:'OPEN',transactionId:step.transactionId,positionAddress:input.prepared.positionSigner.publicKeyAddress,chunked:true,step:step.metadata});
      const economicChunk=step.kind==='METEORA_OPEN'||step.kind==='METEORA_OPEN_CHUNK';
      await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:'SIGNING',lastValidBlockHeight:BigInt(latest.lastValidBlockHeight),observedAt:submittedAt,payload:{chunked:true}});
      const submitted=await executeMainnetCanaryOpen({authority:openAuthority,ticket:openTicket,transactionId:step.transactionId,idempotencyKey:`${input.plan.idempotencyKey}:${step.transactionId}`,requiredSignerAddresses:step.requiredSignerAddresses,backend:input.signer,auxiliaryBackends:auxiliaryPositionSignersForOpenStep(step,input.prepared.positionSigner),envelope:step.envelope,phase5RiskDecision:risk,lease:latest,ledger:ledger(input.store),transport:createWeb3SubmissionTransport(input.connection),submittedAt,beforeSubmit:async()=>{const finalSafety=await checkFreshOpenSubmissionSafety({store:input.store,plan:input.plan,config:input.config,permitExpiresAt:risk.expiresAt!});if(!finalSafety.approved)throw new Error("LPFORGE_P6_PRESUBMISSION_SAFETY_BLOCKED:"+finalSafety.reasonCodes.join(","));},onSigned:async({signerBackendId})=>{await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'SIGNED',{action:'OPEN',transactionId:step.transactionId,positionAddress:input.prepared.positionSigner.publicKeyAddress,chunked:true,step:step.metadata,signerBackendId});await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:'SIGNED',lastValidBlockHeight:BigInt(latest.lastValidBlockHeight),observedAt:new Date().toISOString(),payload:{chunked:true,signerBackendId}});},onSubmissionUnknown:async({error,signature})=>{submissionStatusUnknown=true;if(signature){lastSignature=signature;currentStep!.signature=signature;}currentStep!.submitted=true;await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'UNKNOWN_SUBMISSION',{action:'OPEN',transactionId:step.transactionId,positionAddress:input.prepared.positionSigner.publicKeyAddress,chunked:true,step:step.metadata,error},signature);await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:'UNKNOWN_SUBMISSION',...(signature?{signature}:{}),lastValidBlockHeight:BigInt(latest.lastValidBlockHeight),observedAt:new Date().toISOString(),payload:{chunked:true,error}});}});submittedAny=true;currentStep!.signature=submitted.signature;currentStep!.submitted=true;lastSignature=submitted.signature;await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'SUBMITTED',{action:'OPEN',transactionId:step.transactionId,positionAddress:input.prepared.positionSigner.publicKeyAddress,chunked:true,step:step.metadata},submitted.signature);await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:'SUBMITTED',signature:submitted.signature,lastValidBlockHeight:BigInt(latest.lastValidBlockHeight),observedAt:new Date().toISOString(),payload:{chunked:true}});
      let confirmed=false,unknownObservationCount=0,rebroadcastCount=0;
      for(let attempt=0;attempt<input.config.confirmAttempts;attempt++){
        await new Promise(resolve=>setTimeout(resolve,input.config.confirmPollMs));
        const confirmation=await observeConfirmation({attemptId:`${step.transactionId}:attempt:1`,record:{transactionId:step.transactionId,signature:submitted.signature,submittedAt,blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight,attempt:1},transport:createWeb3SubmissionTransport(input.connection),ledger:ledger(input.store),observedAt:new Date().toISOString()});
        if(confirmation.status==='CONFIRMED'||confirmation.status==='FINALIZED'){
          confirmed=true;if(confirmation.slot!==undefined)confirmedEntrySlot=confirmation.slot;
          let economicSolAssetOut=0n;
          if(economicChunk){const receipt=await loadParsedConfirmedExecutionReceipt(input.connection,submitted.signature),receiptContribution=deriveReceiptBoundSolContribution({receipt,ownerAddress:input.plan.ownerAddress,...(receipt.staticAccountKeys[0]?{feePayerAddress:receipt.staticAccountKeys[0]}:{})});economicSolAssetOut=receiptContribution?.principalLamports??0n;confirmedLiquiditySolAssetOut+=economicSolAssetOut;}
          await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:'CONFIRMED',signature:submitted.signature,lastValidBlockHeight:BigInt(latest.lastValidBlockHeight),observedAt:new Date().toISOString(),payload:{chunked:true,confirmation:confirmation.status,economicSolAssetOutLamports:economicSolAssetOut.toString(),measurementSource:'CONFIRMED_RECEIPT_NET_OF_RENT'}});
          break;
        }
        if(confirmation.status==='FAILED'||confirmation.status==='EXPIRED'){
          if(confirmation.status==='FAILED'){
            const actualFee=await confirmedTransactionFeeLamports(input.connection,submitted.signature);
            if(actualFee===undefined)throw new Error('LPFORGE_P6_FAILED_OPEN_RECEIPT_UNAVAILABLE');
            await input.store.insertPlanCashflow({cashflowId:`${input.plan.planId}:execution-tx-cost:${step.transactionId}`,planId:input.plan.planId,flowType:'EXECUTION_TX_COST',observedAt:new Date().toISOString(),lamports:actualFee,transactionSignature:submitted.signature,payload:{source:'CONFIRMED_FAILED_CHAIN_RECEIPT',transactionId:step.transactionId}});
          }
          await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:confirmation.status==='FAILED'?'CONFIRMED_FAILED':'PROVEN_NOT_LANDED',signature:submitted.signature,lastValidBlockHeight:BigInt(latest.lastValidBlockHeight),observedAt:new Date().toISOString(),payload:{chunked:true,confirmation:confirmation.status,chainLanded:confirmation.status==='FAILED'}});
          throw new Error(`LPFORGE_P6_CHUNK_CONFIRM_${confirmation.status}`);
        }
        if(confirmation.status==='UNKNOWN'){
          unknownObservationCount++;
          if(shouldRebroadcastKnownOpenChunk({confirmationStatus:confirmation.status,unknownObservationCount,rebroadcastCount})){
            // This is intentionally the same already-signed wire payload and
            // signature.  It cannot create another liquidity instruction; it
            // only asks the RPC to propagate the original transaction again.
            try{
              await rebroadcastExactSignedTransaction({transport:createWeb3SubmissionTransport(input.connection),raw:step.envelope.serializeSigned(),signature:submitted.signature});
              rebroadcastCount++;
              await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:'SUBMITTED',signature:submitted.signature,lastValidBlockHeight:BigInt(latest.lastValidBlockHeight),observedAt:new Date().toISOString(),payload:{chunked:true,safeRebroadcast:true,rebroadcastCount}});
            }catch(error){
              // The original submission remains authoritative.  A failed
              // rebroadcast is not evidence of absence and never authorizes a
              // new signature or replacement liquidity transaction.
              await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:'SUBMITTED',signature:submitted.signature,lastValidBlockHeight:BigInt(latest.lastValidBlockHeight),observedAt:new Date().toISOString(),payload:{chunked:true,safeRebroadcastFailed:true,rebroadcastCount,error:error instanceof Error?error.message:String(error)}});
            }
          }
        }
      }
      if(!confirmed)throw new Error('LPFORGE_P6_CHUNK_CONFIRMATION_PENDING');
      completedSteps.push({transactionId:step.transactionId,kind:step.kind,signature:submitted.signature,estimatedFeeLamports:fee.totalFeeLamports});
    }
    const construction=assessOpenChunkConstruction({planned:input.prepared.steps.map((step,index)=>({transactionId:step.transactionId,sequence:index+1,kind:step.kind})),dispositions:await input.store.loadOpenChunkDispositions(input.plan.planId)});if(!construction.fullyConstructed)throw new Error(`LPFORGE_P6_OPEN_CONSTRUCTION_INCOMPLETE:${construction.reasonCodes.join(',')}`);
    await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'CONFIRMED',{action:'OPEN',positionAddress:input.prepared.positionSigner.publicKeyAddress,chunked:true,lastSignature},lastSignature);
    const position=await input.pool.getPosition?.(new PublicKey(input.prepared.positionSigner.publicKeyAddress));
    if(!position)throw new Error('LPFORGE_P6_POSITION_RECONCILIATION_MISSING');
    const intent=input.plan.planPayload.intent as Record<string,unknown>;
    const funding=input.plan.intentPayload.entryFunding as Record<string,unknown>;
    await input.store.insertExecutionReconciliation({reconciliationId:`${input.plan.planId}:open`,planId:input.plan.planId,observedAt:new Date().toISOString(),status:'MATCH',expected:{owner:input.plan.ownerAddress,pool:input.plan.poolAddress,lowerBinId:input.fields.lower,upperBinId:input.fields.upper},actual:{positionAddress:input.prepared.positionSigner.publicKeyAddress},discrepancies:[],payload:{signature:lastSignature,autonomous:true,chunked:true}});
    await input.store.upsertOwnedPosition({lpforgePositionId:`position-${input.prepared.positionSigner.publicKeyAddress}`,poolAddress:input.plan.poolAddress,positionAddress:input.prepared.positionSigner.publicKeyAddress,ownerAddress:input.plan.ownerAddress,strategy:String(intent.strategy??'SPOT'),orientation:String(funding.orientation??'ONE_SIDED_Y'),lowerBinId:input.fields.lower,upperBinId:input.fields.upper,activeBinAtEntry:input.fields.plannedActiveBinId,initialCapitalLamports:input.fields.capital,entryPlanId:input.plan.planId,entrySignature:lastSignature,...(confirmedEntrySlot!==undefined?{entrySlot:confirmedEntrySlot}:{}),enteredAt:new Date().toISOString(),lifecycleState:'OPEN',lastPlanId:input.plan.planId,reconciliationStatus:'MATCH',payload:{thesisId:input.plan.thesisId,entryFunding:funding,chunked:true}});
    const positionAccount=await input.connection.getAccountInfo(new PublicKey(input.prepared.positionSigner.publicKeyAddress),'confirmed');
    const entryBasis=await persistReceiptBackedEntryBasis({store:input.store,connection:input.connection,plan:input.plan,positionAddress:input.prepared.positionSigner.publicKeyAddress,requestedLiquidityCapitalLamports:input.fields.capital,...(input.entryFundingMeasurement?{funding:input.entryFundingMeasurement}:{}),confirmedSteps:completedSteps,observedAt:new Date().toISOString()});
    const contributionLamports=entryBasis.managedEconomicContributionLamports??input.fields.capital;
    queueOpenedPositionAlert({positionAddress:input.prepared.positionSigner.publicKeyAddress,poolAddress:input.plan.poolAddress,planId:input.plan.planId,strategy:String(intent.strategy??'SPOT'),orientation:String(funding.orientation??'ONE_SIDED_Y'),capitalLamports:contributionLamports,lowerBinId:input.fields.lower,upperBinId:input.fields.upper,activeBinId:input.fields.plannedActiveBinId,observedAt:new Date().toISOString()});
    await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:open-contribution`,positionAddress:input.prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'OPEN_CONTRIBUTION',observedAt:new Date().toISOString(),lamports:contributionLamports,payload:{signature:lastSignature,source:entryBasis.basisState==='PROVEN'?'RECEIPT_BACKED_ENTRY_BASIS_V1':'ENTRY_BASIS_INCOMPLETE_FALLBACK',requestedLiquidityCapitalLamports:input.fields.capital.toString(),entryBasisId:`${input.plan.planId}:entry-basis:v1`}});
    if(positionAccount?.lamports)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:rent-lock`,positionAddress:input.prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'RENT_LOCK',observedAt:new Date().toISOString(),lamports:BigInt(positionAccount.lamports),payload:{signature:lastSignature,recoverable:true,source:'POSITION_ACCOUNT_INFO'}});
    for(const child of completedSteps){const actualFee=await confirmedTransactionFeeLamports(input.connection,child.signature);await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:tx-cost:${child.transactionId}`,positionAddress:input.prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'TX_COST',observedAt:new Date().toISOString(),lamports:actualFee??child.estimatedFeeLamports,payload:{signature:child.signature,transactionId:child.transactionId,source:actualFee===undefined?'EXECUTION_FEE_ESTIMATE':'CHAIN_RECEIPT_META',...(actualFee===undefined?{estimatedLamports:child.estimatedFeeLamports.toString()}:{})}});}
    const fundingCost=(await input.store.loadPlanCashflows(input.plan.planId)).find(flow=>flow.flowType==='FUNDING_TX_COST');
    if(fundingCost?.lamports!==undefined)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:tx-cost:funding`,positionAddress:input.prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'TX_COST',observedAt:new Date().toISOString(),lamports:fundingCost.lamports,payload:{source:'ENTRY_FUNDING_RECEIPT',...(fundingCost.transactionSignature?{signature:fundingCost.transactionSignature}:{})}});
    await persistOpenResidualInventory({store:input.store,connection:input.connection,plan:input.plan,positionAddress:input.prepared.positionSigner.publicKeyAddress,funding:input.entryFundingMeasurement,signature:lastSignature});
    await supersedeProvisionalPartialEntryRecovery({store:input.store,plan:input.plan,positionAddress:input.prepared.positionSigner.publicKeyAddress,at:new Date().toISOString()});
    await input.store.completeAutonomousPlan({planId:input.plan.planId,state:'RECONCILED',at:new Date().toISOString(),payload:{signature:lastSignature,positionAddress:input.prepared.positionSigner.publicKeyAddress,chunked:true,entryBasisState:entryBasis.basisState,entryBasisId:`${input.plan.planId}:entry-basis:v1`}});
    return{status:'RECONCILED',planId:input.plan.planId,reasonCodes:[],transactionSubmitted:true,positionAddress:input.prepared.positionSigner.publicKeyAddress};
  }catch(error){const reason=error instanceof Error?error.message:'LPFORGE_P6_CHUNKABLE_OPEN_UNKNOWN',fundingSubmitted=input.entryFundingMeasurement!==undefined,effectiveLastSignature=lastSignature||input.entryFundingMeasurement?.fundingSignature||'';if(currentStep&&!currentStep.submitted&&!reason.startsWith('LPFORGE_P6_PRESUBMISSION_SAFETY_BLOCKED:'))await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:currentStep.transactionId,sequence:currentStep.sequence,kind:currentStep.kind,disposition:'FAILED_PRE_SIGN',...(currentStep.lastValidBlockHeight!==undefined?{lastValidBlockHeight:currentStep.lastValidBlockHeight}:{}),observedAt:new Date().toISOString(),payload:{chunked:true,error:reason}});if(currentStep?.submitted&&currentStep.signature&&reason==='LPFORGE_P6_CHUNK_CONFIRMATION_PENDING')await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:currentStep.transactionId,sequence:currentStep.sequence,kind:currentStep.kind,disposition:'UNKNOWN_SUBMISSION',signature:currentStep.signature,...(currentStep.lastValidBlockHeight!==undefined?{lastValidBlockHeight:currentStep.lastValidBlockHeight}:{}),observedAt:new Date().toISOString(),payload:{chunked:true,error:reason}});if(submittedAny||submissionStatusUnknown||fundingSubmitted){if(input.entryFundingMeasurement){await input.store.upsertPartialEntryRecovery({planId:input.plan.planId,poolAddress:input.plan.poolAddress,ownerAddress:input.plan.ownerAddress,tokenMint:input.entryFundingMeasurement.tokenMint,fundingTransactionId:input.plan.swapTransactionId??'P6_CHUNKABLE_OPEN',fundingSignature:input.entryFundingMeasurement.fundingSignature,fundedAt:new Date().toISOString(),pairedTokenAmount:input.entryFundingMeasurement.pairedTokenReceivedRaw.toString(),intendedCapitalLamports:input.fields.capital,intendedRange:{lowerBinId:input.fields.lower,upperBinId:input.fields.upper},state:'RECONCILIATION_REQUIRED',walletTruth:{refreshRequired:true,confirmedLiquiditySolAssetOutLamports:confirmedLiquiditySolAssetOut.toString(),entryFundingMeasurement:{tokenMint:input.entryFundingMeasurement.tokenMint,pairedTokenReceivedRaw:input.entryFundingMeasurement.pairedTokenReceivedRaw.toString(),pairedTokenRawBeforeFunding:input.entryFundingMeasurement.pairedTokenRawBeforeFunding.toString(),pairedTokenRawBeforeOpen:input.entryFundingMeasurement.pairedTokenRawBeforeOpen.toString(),fundingSignature:input.entryFundingMeasurement.fundingSignature}},payload:{partialEntry:true,reasonCodes:['P6_PARTIAL_OPEN_CHUNK_DISPOSITION_REQUIRED',...(fundingSubmitted?['P6_CONFIRMED_FUNDING_PARTIAL_ENTRY']:[]),reason],positionAddress:input.prepared.positionSigner.publicKeyAddress},updatedAt:new Date().toISOString()});}await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'RECONCILIATION_REQUIRED',{action:'OPEN',chunked:true,error:reason,positionAddress:input.prepared.positionSigner.publicKeyAddress,lastSignature:effectiveLastSignature,postSubmission:true},effectiveLastSignature||undefined);await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:'RECONCILIATION_REQUIRED',at:new Date().toISOString(),reasonCodes:['P6_CHUNKABLE_OPEN_RECONCILIATION_REQUIRED',...(fundingSubmitted?['P6_CONFIRMED_FUNDING_PARTIAL_ENTRY']:[]),reason],payload:{stage:'CHUNKABLE_OPEN',error:reason,positionAddress:input.prepared.positionSigner.publicKeyAddress,lastSignature:effectiveLastSignature,partialEntry:true}});return{status:'UNKNOWN',planId:input.plan.planId,reasonCodes:['P6_CHUNKABLE_OPEN_RECONCILIATION_REQUIRED',...(fundingSubmitted?['P6_CONFIRMED_FUNDING_PARTIAL_ENTRY']:[]),reason],transactionSubmitted:true};}if(reason.startsWith('LPFORGE_P6_PRESUBMISSION_SAFETY_BLOCKED:'))await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'FAILED',{action:'OPEN',stage:'PRESUBMISSION_SAFETY',error:reason,chunked:true,positionAddress:input.prepared.positionSigner.publicKeyAddress});await input.store.completeAutonomousPlan({planId:input.plan.planId,state:'BLOCKED',at:new Date().toISOString(),payload:{stage:'CHUNKABLE_OPEN',error:reason}});return{status:'BLOCKED',planId:input.plan.planId,reasonCodes:[reason],transactionSubmitted:false};}
}
/** Executes one already-claimed plan. A caller must claim from storage before calling this function. */
export async function executeAutonomousOpen(input: {
  store: Phase1Store;
  plan: AutonomousOpenPlan;
  signer: MainnetSignerBackend;
  config: LiveWorkerConfig;
}): Promise<LiveWorkerResult> {
  const now = new Date().toISOString(),
    fields = planFields(input.plan);
  // Check before route construction and again at the signing boundary. A
  // rebuilt transaction may never change the canary liquidity amount.
  assertControlledCanaryOpen(input.config,fields.capital);
  // A signature that has left the wallet means the position may exist on-chain
  // even if post-submit bookkeeping fails; recovery must adopt, never resend.
  let submittedAny = false,
    submissionStatusUnknown = false,
    lastSignature = "",
    openPositionAddress = "",
    entryFundingMeasurement:EntryFundingMeasurement|undefined;
  try {
    if (input.signer.publicKeyAddress !== input.plan.ownerAddress)
      throw new Error("LPFORGE_P6_OWNER_SIGNER_PLAN_MISMATCH");
    const connection = createGovernedConnection({rpcUrl:input.config.rpcUrl,priority:'P0_EXECUTION_CRITICAL'});
    // Build the entire Meteora route before swapping into the paired asset.
    // This construction-only preflight never signs or submits a transaction.
    const pool = await createLiveMeteoraOpenPool({
      rpcUrl: input.config.rpcUrl,
      poolAddress: input.plan.poolAddress,
      programId: input.config.programId,
    });
    await prepareAutonomousMeteoraOpen({
      plan: input.plan,
      pool,
      liquiditySlippageBps: input.config.liquiditySlippageBps,
    });
    if (input.plan.swapTransactionId) {
      const swapSignedAt = new Date().toISOString(),
        swapTicket = ticket(
          input.plan,
          fields.capital,
          swapSignedAt,
          input.config.riskPermitTtlMs,
          executionMaxOpenPositions(input.config),
          "OPEN",
        ),
        swapAuthority = {
          phase: "P6" as const,
          cluster: "mainnet-beta" as const,
          level: "MAINNET_CANARY_OPEN" as const,
          liveExecution: true as const,
          canaryOnly: true as const,
          issuedAt: swapSignedAt,
          expiresAt: swapTicket.expiresAt,
          ticketId: swapTicket.ticketId,
          reasonCodes: ["P6_AUTONOMOUS_SWAP_FINAL_REVALIDATION"],
        },
        funded = await executeRequiredJupiterSwap({
          store: input.store,
          plan: input.plan,
          signer: input.signer,
          connection,
          config: input.config,
          openTicket: swapTicket,
          openAuthority: swapAuthority,
        }),
        intent = input.plan.planPayload.intent as Record<string, unknown>;
      // A confirmed funding signature is already an economic effect.  Keep
      // the outer failure path fail-closed even if position creation later
      // fails before its own submission.
      submittedAny = true;
      lastSignature = funded.signature;
      entryFundingMeasurement={
        tokenMint:funded.tokenMint,
        pairedTokenReceivedRaw:BigInt(funded.pairedTokenAmount),
        pairedTokenRawBeforeFunding:BigInt(funded.pairedTokenRawBeforeFunding),
        pairedTokenRawBeforeOpen:await readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:funded.tokenMint}),
        fundingSignature:funded.signature,
      };
      await input.store.upsertPartialEntryRecovery({
        planId: input.plan.planId,
        poolAddress: input.plan.poolAddress,
        ownerAddress: input.plan.ownerAddress,
        tokenMint: funded.tokenMint,
        fundingTransactionId: input.plan.swapTransactionId,
        fundingSignature: funded.signature,
        fundedAt: funded.fundedAt,
        pairedTokenAmount: funded.pairedTokenAmount,
        intendedCapitalLamports: fields.capital,
        intendedRange: {
          lowerBinId: fields.lower,
          upperBinId: fields.upper,
          strategy: intent.strategy,
        },
        state: "ENTRY_FUNDED_NOT_OPEN",
        walletTruth: { refreshRequired: true,entryFundingMeasurement:{pairedTokenRawBeforeFunding:funded.pairedTokenRawBeforeFunding,pairedTokenRawBeforeOpen:entryFundingMeasurement.pairedTokenRawBeforeOpen.toString(),nativeLamportsBefore:funded.nativeLamportsBefore,wsolRawBefore:funded.wsolRawBefore} },
        payload: {
          thesisId: input.plan.thesisId,
          reasonCodes: ["P6_ENTRY_FUNDED_NOT_OPEN"],
        },
        updatedAt: funded.fundedAt,
      });
    }
    const prepared = await prepareAutonomousMeteoraOpen({
      plan: input.plan,
      pool,
      liquiditySlippageBps: input.config.liquiditySlippageBps,
    });
    if (prepared.steps.length > 1)
      return executeChunkableAutonomousOpen({
        store: input.store,
        plan: input.plan,
        signer: input.signer,
        config: input.config,
        connection,
        pool,
        prepared,
        fields,
        ...(entryFundingMeasurement?{entryFundingMeasurement}:{}),
      });
    // `now` is captured before the route/funding preflight. A confirmed
    // funding swap can consume most of a short permit TTL, so the
    // post-funding simulation must use its own fresh authority timestamp.
    const simulatedAt = new Date().toISOString(),
      simAuthority = authority(
        "MAINNET_BUILD_SIMULATE",
        simulatedAt,
        input.config.riskPermitTtlMs,
      );
    const simulation = await simulateExecutionTransaction({
      authority: simAuthority,
      transactionId: input.plan.transactionId,
      transaction: prepared.transaction,
      transport: createWeb3SimulationTransport(connection),
      simulatedAt,
      freshnessMs: input.config.simulationFreshnessMs,
    });
    await input.store.insertExecutionSimulation({
      transactionId: input.plan.transactionId,
      simulatedAt: simulation.simulatedAt,
      freshUntil: simulation.simulationFreshUntil,
      ok: simulation.ok,
      ...(simulation.unitsConsumed !== undefined
        ? { unitsConsumed: simulation.unitsConsumed }
        : {}),
      logs: simulation.logs,
      ...(simulation.error ? { error: simulation.error } : {}),
      payload: {
        planId: input.plan.planId,
        positionAddress: prepared.positionSigner.publicKeyAddress,
        autonomous: true,
      },
    });
    const fee = estimateExecutionFee({
        signatureCount: 2,
        computeUnitLimit: simulation.recommendedComputeUnitLimit ?? 0,
        computeUnitPriceMicroLamports: 0n,
      }),
      cost = assessExecutionCost(fee, fields.capital, {
        maxAbsoluteFeeLamports: input.config.maxFeeLamports,
        maxFeeFractionOfCapital: input.config.maxFeeFraction,
      });
    const risk = await governFreshOpenRisk({store:input.store,plan:input.plan,config:input.config,connection,simulation,costApproved:cost.approved,fields});
    if (risk.decision !== "APPROVE" || !risk.permitId || !risk.expiresAt) {
      if(isStaleOnlyPreSignP7ControlBlock(risk.reasonCodes))return requeueUnsignedStaleControlOpen({store:input.store,plan:input.plan,reason:risk.reasonCodes.join(','),stage:'SIMULATE_RISK'});
      await input.store.completeAutonomousPlan({
        planId: input.plan.planId,
        state: "BLOCKED",
        at: new Date().toISOString(),
        payload: {
          stage: "SIMULATE_RISK",
          reasonCodes: risk.reasonCodes,
          simulationOk: simulation.ok,
        },
      });
      return {
        status: "BLOCKED",
        planId: input.plan.planId,
        reasonCodes: risk.reasonCodes,
        transactionSubmitted: false,
      };
    }
    await input.store.insertExecutionRiskPermit({
      permitId: risk.permitId,
      planId: input.plan.planId,
      decision: risk.decision,
      issuedAt: risk.issuedAt,
      expiresAt: risk.expiresAt,
      reasonCodes: risk.reasonCodes,
      payload: {
        autonomous: true,
        simulationFreshUntil: simulation.simulationFreshUntil,
        feeLamports: fee.totalFeeLamports.toString(),
      },
    });
    const latest = await connection.getLatestBlockhash("confirmed");
    assertControlledCanaryOpen(input.config,fields.capital);
    prepared.transaction.recentBlockhash = latest.blockhash;
    prepared.transaction.lastValidBlockHeight = latest.lastValidBlockHeight;
    prepared.transaction.feePayer = new PublicKey(input.plan.ownerAddress);
    const signedAt = new Date().toISOString(),
      openTicket = ticket(
        input.plan,
        fields.capital,
        signedAt,
        input.config.riskPermitTtlMs,
        executionMaxOpenPositions(input.config),
        "OPEN",
      ),
      openAuthority = {
        phase: "P6" as const,
        cluster: "mainnet-beta" as const,
        level: "MAINNET_CANARY_OPEN" as const,
        liveExecution: true,
        canaryOnly: true,
        issuedAt: signedAt,
        expiresAt: openTicket.expiresAt,
        ticketId: openTicket.ticketId,
        reasonCodes: ["P6_AUTONOMOUS_FINAL_REVALIDATION"],
      };
    // Persist the ephemeral PositionV2 public key before the first possible
    // network send.  Recovery can then adopt this exact account even when
    // the plan originally had no positionAddress (as every fresh OPEN does).
    openPositionAddress=prepared.positionSigner.publicKeyAddress;
    await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:"SIGNING",at:signedAt,payload:{stage:"OPEN_POSITION_GENERATED",generatedPositionAddress:openPositionAddress}});
    await recordJournal(input.store,input.plan as unknown as AutonomousPlan,"SIGNING",{action:"OPEN",transactionId:input.plan.transactionId,generatedPositionAddress:openPositionAddress});
    const submitted = await executeMainnetCanaryOpen({
      authority: openAuthority,
      ticket: openTicket,
      transactionId: input.plan.transactionId,
      idempotencyKey: input.plan.idempotencyKey,
      requiredSignerAddresses: prepared.requiredSignerAddresses,
      backend: input.signer,
      auxiliaryBackends: [prepared.positionSigner],
      envelope: prepared.envelope,
      phase5RiskDecision: risk,
      lease: latest,
      ledger: ledger(input.store),
      transport: createWeb3SubmissionTransport(connection),
      submittedAt: signedAt,
      beforeSubmit: async () => {
        const finalSafety=await checkFreshOpenSubmissionSafety({store:input.store,plan:input.plan,config:input.config,permitExpiresAt:risk.expiresAt!});
        if(!finalSafety.approved)throw new Error(`LPFORGE_P6_PRESUBMISSION_SAFETY_BLOCKED:${finalSafety.reasonCodes.join(',')}`);
      },
      onSigned: async ({ signerBackendId }) =>
        recordJournal(
          input.store,
          input.plan as unknown as AutonomousPlan,
          "SIGNED",
          {
            action: "OPEN",
            transactionId: input.plan.transactionId,
            generatedPositionAddress: openPositionAddress,
            signerBackendId,
          },
        ),
      onSubmissionUnknown: async ({ error,signature }) => {
        submissionStatusUnknown=true;
        if(signature)lastSignature=signature;
        await recordJournal(
          input.store,
          input.plan as unknown as AutonomousPlan,
          "UNKNOWN_SUBMISSION",
          {
            action: "OPEN",
            transactionId: input.plan.transactionId,
            generatedPositionAddress: openPositionAddress,
            error,
          },
          signature,
        );
      },
    });
    submittedAny = true;
    lastSignature = submitted.signature;
    await recordJournal(
      input.store,
      input.plan as unknown as AutonomousPlan,
      "SUBMITTED",
      {
        action: "OPEN",
        transactionId: input.plan.transactionId,
        positionAddress: prepared.positionSigner.publicKeyAddress,
      },
      submitted.signature,
    );
    await input.store.completeAutonomousPlan({
      planId: input.plan.planId,
      state: "SUBMITTED",
      at: signedAt,
      payload: {
        signature: submitted.signature,
        positionAddress: prepared.positionSigner.publicKeyAddress,
      },
    });
    for (let i = 0; i < input.config.confirmAttempts; i++) {
      await new Promise((resolve) =>
        setTimeout(resolve, input.config.confirmPollMs),
      );
      const confirmation = await observeConfirmation({
        attemptId: `${input.plan.transactionId}:attempt:1`,
        record: {
          transactionId: input.plan.transactionId,
          signature: submitted.signature,
          submittedAt: signedAt,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
          attempt: 1,
        },
        transport: createWeb3SubmissionTransport(connection),
        ledger: ledger(input.store),
        observedAt: new Date().toISOString(),
      });
      if (
        confirmation.status === "CONFIRMED" ||
        confirmation.status === "FINALIZED"
      ) {
        await recordJournal(
          input.store,
          input.plan as unknown as AutonomousPlan,
          "CONFIRMED",
          {
            action: "OPEN",
            transactionId: input.plan.transactionId,
            positionAddress: prepared.positionSigner.publicKeyAddress,
            confirmation: confirmation.status,
          },
          submitted.signature,
        );
        const position = await pool.getPosition?.(
          new PublicKey(prepared.positionSigner.publicKeyAddress),
        );
        if (!position)
          throw new Error("LPFORGE_P6_POSITION_RECONCILIATION_MISSING");
        const intent = input.plan.planPayload.intent as Record<string, unknown>,
          funding = input.plan.intentPayload.entryFunding as Record<
            string,
            unknown
          >;
        await input.store.insertExecutionReconciliation({
          reconciliationId: `${input.plan.planId}:open`,
          planId: input.plan.planId,
          observedAt: new Date().toISOString(),
          status: "MATCH",
          expected: {
            owner: input.plan.ownerAddress,
            pool: input.plan.poolAddress,
            lowerBinId: fields.lower,
            upperBinId: fields.upper,
          },
          actual: { positionAddress: prepared.positionSigner.publicKeyAddress },
          discrepancies: [],
          payload: { signature: submitted.signature, autonomous: true },
        });
        await input.store.upsertOwnedPosition({
          lpforgePositionId: `position-${prepared.positionSigner.publicKeyAddress}`,
          poolAddress: input.plan.poolAddress,
          positionAddress: prepared.positionSigner.publicKeyAddress,
          ownerAddress: input.plan.ownerAddress,
          strategy: String(intent.strategy ?? "SPOT"),
          orientation: String(funding.orientation ?? "ONE_SIDED_Y"),
          lowerBinId: fields.lower,
          upperBinId: fields.upper,
          activeBinAtEntry: Number(intent.activeBinId ?? fields.lower),
          initialCapitalLamports: fields.capital,
          entryPlanId: input.plan.planId,
          entrySignature: submitted.signature,
          ...(confirmation.slot !== undefined ? { entrySlot: confirmation.slot } : {}),
          enteredAt: new Date().toISOString(),
          lifecycleState: "OPEN",
          lastPlanId: input.plan.planId,
          reconciliationStatus: "MATCH",
          payload: { thesisId: input.plan.thesisId, entryFunding: funding },
        });
        const positionAccount=await connection.getAccountInfo(new PublicKey(prepared.positionSigner.publicKeyAddress),'confirmed');
        const entryBasis=await persistReceiptBackedEntryBasis({store:input.store,connection,plan:input.plan,positionAddress:prepared.positionSigner.publicKeyAddress,requestedLiquidityCapitalLamports:fields.capital,...(entryFundingMeasurement?{funding:entryFundingMeasurement}:{}),confirmedSteps:[{transactionId:input.plan.transactionId,kind:'METEORA_OPEN',signature:submitted.signature}],observedAt:new Date().toISOString()});
        const contributionLamports=entryBasis.managedEconomicContributionLamports??fields.capital;
        queueOpenedPositionAlert({positionAddress:prepared.positionSigner.publicKeyAddress,poolAddress:input.plan.poolAddress,planId:input.plan.planId,strategy:String(intent.strategy??'SPOT'),orientation:String(funding.orientation??'ONE_SIDED_Y'),capitalLamports:contributionLamports,lowerBinId:fields.lower,upperBinId:fields.upper,activeBinId:Number(intent.activeBinId??fields.lower),observedAt:new Date().toISOString()});
        await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:open-contribution`,positionAddress:prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'OPEN_CONTRIBUTION',observedAt:new Date().toISOString(),lamports:contributionLamports,payload:{signature:submitted.signature,source:entryBasis.basisState==='PROVEN'?'RECEIPT_BACKED_ENTRY_BASIS_V1':'ENTRY_BASIS_INCOMPLETE_FALLBACK',entryBasisId:`${input.plan.planId}:entry-basis:v1`}});
        if(positionAccount?.lamports)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:rent-lock`,positionAddress:prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'RENT_LOCK',observedAt:new Date().toISOString(),lamports:BigInt(positionAccount.lamports),payload:{signature:submitted.signature,recoverable:true,source:'POSITION_ACCOUNT_INFO'}});
        const actualOpenFee=await confirmedTransactionFeeLamports(connection,submitted.signature);
        await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:tx-cost:${input.plan.transactionId}`,positionAddress:prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'TX_COST',observedAt:new Date().toISOString(),lamports:actualOpenFee??fee.totalFeeLamports,payload:{signature:submitted.signature,transactionId:input.plan.transactionId,source:actualOpenFee===undefined?'EXECUTION_FEE_ESTIMATE':'CHAIN_RECEIPT_META',...(actualOpenFee===undefined?{estimatedLamports:fee.totalFeeLamports.toString()}:{})}});
        const fundingCost=(await input.store.loadPlanCashflows(input.plan.planId)).find(flow=>flow.flowType==='FUNDING_TX_COST');
        if(fundingCost?.lamports!==undefined)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:tx-cost:funding`,positionAddress:prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'TX_COST',observedAt:new Date().toISOString(),lamports:fundingCost.lamports,payload:{source:'ENTRY_FUNDING_RECEIPT',...(fundingCost.transactionSignature?{signature:fundingCost.transactionSignature}:{})}});
        await persistOpenResidualInventory({store:input.store,connection,plan:input.plan,positionAddress:prepared.positionSigner.publicKeyAddress,funding:entryFundingMeasurement,signature:submitted.signature});
        await supersedeProvisionalPartialEntryRecovery({store:input.store,plan:input.plan,positionAddress:prepared.positionSigner.publicKeyAddress,at:new Date().toISOString()});
        // A fully reconciled OPEN with a funding swap is not a partial-entry
        // recovery. Normal residuals are recorded by persistOpenResidualInventory
        // above. Only an interrupted/partially reconciled OPEN may create an
        // OPEN_RECOVERED record, because close settlement treats that record as
        // proof that a separately attributable wallet residual must be unwound.
        await input.store.completeAutonomousPlan({
          planId: input.plan.planId,
          state: "RECONCILED",
          at: new Date().toISOString(),
          payload: {
            signature: submitted.signature,
            positionAddress: prepared.positionSigner.publicKeyAddress,
          },
        });
        return {
          status: "RECONCILED",
          planId: input.plan.planId,
          reasonCodes: [],
          transactionSubmitted: true,
          positionAddress: prepared.positionSigner.publicKeyAddress,
        };
      }
      if (
        confirmation.status === "FAILED" ||
        confirmation.status === "EXPIRED"
      ) {
        if(confirmation.status==="FAILED"){
          const actualFee=await confirmedTransactionFeeLamports(connection,submitted.signature);
          if(actualFee===undefined)throw new Error("LPFORGE_P6_FAILED_OPEN_RECEIPT_UNAVAILABLE");
          await input.store.insertPlanCashflow({cashflowId:`${input.plan.planId}:execution-tx-cost:${input.plan.transactionId}`,planId:input.plan.planId,flowType:"EXECUTION_TX_COST",observedAt:new Date().toISOString(),lamports:actualFee,transactionSignature:submitted.signature,payload:{source:"CONFIRMED_FAILED_CHAIN_RECEIPT",transactionId:input.plan.transactionId}});
        }
        await recordJournal(
          input.store,
          input.plan as unknown as AutonomousPlan,
          "FAILED",
          {
            action: "OPEN",
            transactionId: input.plan.transactionId,
            confirmation: confirmation.status,
          },
          submitted.signature,
        );
        await input.store.completeAutonomousPlan({
          planId: input.plan.planId,
          state: "FAILED",
          at: new Date().toISOString(),
          payload: {
            signature: submitted.signature,
            confirmation: confirmation.status,
          },
        });
        return {
          status: "BLOCKED",
          planId: input.plan.planId,
          reasonCodes: [`P6_CONFIRM_${confirmation.status}`],
          transactionSubmitted: true,
        };
      }
    }
    return {
      status: "SUBMITTED",
      planId: input.plan.planId,
      reasonCodes: ["P6_CONFIRMATION_PENDING"],
      transactionSubmitted: true,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "LPFORGE_P6_AUTONOMOUS_UNKNOWN";
    if(error instanceof P6PostSubmissionConfirmationPending){
      // The submission ledger is authoritative; a nested return value cannot
      // turn a submitted swap into a pre-submission block.
      submittedAny=true;submissionStatusUnknown=true;lastSignature=error.signature;
    }
    if (submittedAny||submissionStatusUnknown) {
      const confirmedFundingPartial = entryFundingMeasurement !== undefined;
      // One-shot opens get the same post-submit parity as the chunkable path:
      // never FAILED after a signature left the wallet, never resent blindly.
      if(lastSignature)await recordPostSubmissionReconciliation({
        store:input.store,plan:input.plan as unknown as AutonomousPlan,
        transactionId:error instanceof P6PostSubmissionConfirmationPending?error.transactionId:input.plan.transactionId,
        signature:lastSignature,
        payload:{error:reason,positionAddress:openPositionAddress,lastSignature},
      });
      else await recordJournal(
        input.store,input.plan as unknown as AutonomousPlan,"RECONCILIATION_REQUIRED",
        {action:"OPEN",error:reason,positionAddress:openPositionAddress,postSubmission:true},
      );
      await input.store.transitionAutonomousPlan({
        planId: input.plan.planId,
        state: "RECONCILIATION_REQUIRED",
        at: new Date().toISOString(),
        reasonCodes: ["P6_AUTONOMOUS_OPEN_RECONCILIATION_REQUIRED", ...(confirmedFundingPartial ? ["P6_CONFIRMED_FUNDING_PARTIAL_ENTRY"] : []), reason],
        payload: {
          stage: "AUTONOMOUS_OPEN",
          error: reason,
          positionAddress: openPositionAddress,
          lastSignature,
        },
      });
      return {
        status: "UNKNOWN",
        planId: input.plan.planId,
        reasonCodes: ["P6_AUTONOMOUS_OPEN_RECONCILIATION_REQUIRED", ...(confirmedFundingPartial ? ["P6_CONFIRMED_FUNDING_PARTIAL_ENTRY"] : []), reason],
        transactionSubmitted: true,
      };
    }
    if(!submittedAny&&!submissionStatusUnknown&&isStaleOnlyPreSignP7ControlBlock(reason))return requeueUnsignedStaleControlOpen({store:input.store,plan:input.plan,reason,stage:'PRE_SIGN_P7_REFRESH'});
    if (reason.startsWith("LPFORGE_P6_PRESUBMISSION_SAFETY_BLOCKED:"))
      await recordJournal(input.store,input.plan as unknown as AutonomousPlan,"FAILED",{action:"OPEN",stage:"PRESUBMISSION_SAFETY",error:reason,generatedPositionAddress:openPositionAddress});
    if (!reason.includes("LPFORGE_SUBMISSION_STATUS_UNKNOWN"))
      await input.store.completeAutonomousPlan({
        planId: input.plan.planId,
        state: "FAILED",
        at: new Date().toISOString(),
        payload: { error: reason },
      });
    return {
      status: reason.includes("LPFORGE_SUBMISSION_STATUS_UNKNOWN")
        ? "UNKNOWN"
        : "BLOCKED",
      planId: input.plan.planId,
      reasonCodes: [reason],
      transactionSubmitted: false,
    };
  }
}

/** Reads the owner's raw token balance for a mint across all accounts. */
async function readWalletTokenBalance(input: {
  connection: Connection;
  ownerAddress: string;
  mint: string;
}): Promise<bigint> {
  const accounts = await input.connection.getParsedTokenAccountsByOwner(
    new PublicKey(input.ownerAddress),
    { mint: new PublicKey(input.mint) },
    "confirmed",
  );
  let total = 0n;
  for (const account of accounts.value) {
    const parsed = account.account.data.parsed as {
      info?: { tokenAmount?: { amount?: string } };
    };
    const amount = parsed.info?.tokenAmount?.amount;
    try {
      if (amount) total += BigInt(amount);
    } catch {
      // Ignore unparsable account data; the swap simply covers what is known.
    }
  }
  return total;
}

async function persistOpenResidualInventory(input:{
  store:Phase1Store;
  connection:Connection;
  plan:AutonomousOpenPlan;
  positionAddress:string;
  funding:EntryFundingMeasurement|undefined;
  signature:string;
}):Promise<void>{
  if(!input.funding||input.funding.pairedTokenReceivedRaw<=0n)return;
  const pairedTokenRawAfterOpen=await readWalletTokenBalance({connection:input.connection,ownerAddress:input.plan.ownerAddress,mint:input.funding.tokenMint}),
    residual=deriveOpenResidualInventory({...input.funding,pairedTokenRawAfterOpen});
  if(residual<=0n)return;
  const supply=await input.connection.getTokenSupply(new PublicKey(input.funding.tokenMint),"confirmed");
  await input.store.createPositionInventoryLot({
    lotId:`${input.plan.planId}:open-residual:${input.funding.tokenMint}`,
    createdEventId:`${input.plan.planId}:open-residual-created`,
    positionAddress:input.positionAddress,
    planId:input.plan.planId,
    ownerAddress:input.plan.ownerAddress,
    poolAddress:input.plan.poolAddress,
    tokenMint:input.funding.tokenMint,
    tokenSide:"X",
    sourceEvent:"OPEN_RESIDUAL",
    rawAmount:residual,
    decimals:supply.value.decimals,
    acquiredAt:new Date().toISOString(),
    transactionSignature:input.signature,
    payload:{source:"MEASURED_ENTRY_FUNDING_RESIDUAL",fundingSignature:input.funding.fundingSignature,pairedTokenRawBeforeFunding:input.funding.pairedTokenRawBeforeFunding.toString(),pairedTokenRawBeforeOpen:input.funding.pairedTokenRawBeforeOpen.toString(),pairedTokenRawAfterOpen:pairedTokenRawAfterOpen.toString(),pairedTokenReceivedRaw:input.funding.pairedTokenReceivedRaw.toString()},
  });
}

type RecoveredOpenResidual={
  entryPlanId:string;
  lotId:string;
  tokenMint:string;
  rawAmount:bigint;
  recoveryRow:Record<string,unknown>;
};

type ResidualLotView={
  lotId:string;
  planId:string;
  tokenMint:string;
  sourceEvent:string;
  remainingRawAmount:bigint;
  status:string;
};

/** Select the one wallet-backed residual lot and identify any duplicate recovery representation. */
export function selectCanonicalRecoveredResidualLot(input:{
  lots:ResidualLotView[];
  entryPlanId:string;
  tokenMint:string;
  rawAmount:bigint;
}):{canonicalLotId?:string;duplicateLotIds:string[]}{
  const eligible=input.lots.filter(lot=>
    lot.planId===input.entryPlanId&&
    lot.tokenMint===input.tokenMint&&
    lot.remainingRawAmount===input.rawAmount&&
    (lot.status==="OPEN"||lot.status==="PARTIALLY_SETTLED")
  );
  const original=eligible.find(lot=>lot.sourceEvent==="OPEN_RESIDUAL");
  const recovered=eligible.find(lot=>lot.sourceEvent==="RECOVERY_RESIDUAL");
  const canonical=original??recovered;
  return {
    ...(canonical?{canonicalLotId:canonical.lotId}:{}),
    duplicateLotIds:canonical&&original
      ? eligible.filter(lot=>lot.sourceEvent==="RECOVERY_RESIDUAL"&&lot.lotId!==canonical.lotId).map(lot=>lot.lotId)
      : [],
  };
}

/**
 * Backfill the normal inventory ledger for an OPEN that was reconciled after
 * only a subset of its chunked add-liquidity children confirmed.  The lot is
 * deliberately created before account close, so SOL settlement cannot become
 * terminal until this separately wallet-held, canary-attributable asset has
 * an exact disposition receipt.
 */
async function ensureRecoveredOpenResidualInventory(input:{
  store:Phase1Store;
  connection:Connection;
  plan:AutonomousPlan;
  positionAddress:string;
  tokenMint:string;
  pairedTokenRawBeforeClose:bigint;
}):Promise<RecoveredOpenResidual|undefined>{
  const settlementInput=await input.store.loadLifecycleSettlementInput(input.positionAddress);
  const entryPlanId=settlementInput?.lifecycle.entryPlanId;
  if(!entryPlanId)return undefined;
  // OPEN_RECOVERED is terminal for the recurring entry-recovery queue, but
  // not for lifecycle settlement: an already-open position can still carry a
  // canary-attributable wallet residual.  Query this exact entry plan rather
  // than widening the recurring queue and accidentally reprocessing it.
  const recoveryRow=await input.store.loadPartialEntryRecovery(entryPlanId);
  if(
    !recoveryRow||
    String(recoveryRow.state)!=="OPEN_RECOVERED"||
    ((recoveryRow.payload ?? {}) as Record<string,unknown>).partialEntry!==true||
    String(recoveryRow.owner_address)!==input.plan.ownerAddress||
    String(recoveryRow.pool_address)!==input.plan.poolAddress||
    String(recoveryRow.token_mint)!==input.tokenMint
  )return undefined;
  const truth=(recoveryRow.wallet_truth??{}) as Record<string,unknown>,
    funding=(truth.entryFundingMeasurement??{}) as Record<string,unknown>;
  let pairedTokenRawBeforeFunding:bigint,pairedTokenReceivedRaw:bigint;
  try{
    pairedTokenRawBeforeFunding=BigInt(String(funding.pairedTokenRawBeforeFunding??""));
    pairedTokenReceivedRaw=BigInt(String(recoveryRow.paired_token_amount??""));
  }catch{
    throw new Error("LPFORGE_P6_RECOVERED_OPEN_RESIDUAL_PROVENANCE_MISSING");
  }
  const pairedTokenRawAfterPriorUnwind=await readWalletTokenBalance({connection:input.connection,ownerAddress:input.plan.ownerAddress,mint:input.tokenMint});
  // Keep the proof calculation explicit: a current balance other than the
  // pre-close snapshot could include an operator transfer and must never be
  // attributed automatically.
  const attributable=deriveRecoveredOpenResidualInventory({
    pairedTokenRawBeforeFunding,
    pairedTokenRawBeforeClose:input.pairedTokenRawBeforeClose,
    pairedTokenRawAfterPriorUnwind,
    pairedTokenReceivedRaw,
  });
  if(attributable===undefined)throw new Error("LPFORGE_P6_RECOVERED_OPEN_RESIDUAL_WALLET_MISMATCH");
  if(attributable<=0n)return undefined;
  const inventoryLots=await input.store.loadPositionInventoryLots(input.positionAddress,input.tokenMint),
    selected=selectCanonicalRecoveredResidualLot({lots:inventoryLots,entryPlanId,tokenMint:input.tokenMint,rawAmount:attributable}),
    at=new Date().toISOString();
  let lotId=selected.canonicalLotId;
  // The former recovery path could represent the same measured wallet balance
  // twice. Keep both immutable event histories, but transfer the redundant
  // accounting representation into the original lot before a single unwind.
  if(lotId&&selected.duplicateLotIds.length>0)for(const duplicateLotId of selected.duplicateLotIds){
    await input.store.settlePositionInventoryLot({
      eventId:input.plan.planId+":deduplicate-recovered-open-residual:"+duplicateLotId,
      lotId:duplicateLotId,
      planId:input.plan.planId,
      eventType:"TRANSFERRED",
      settledRawAmount:attributable,
      observedAt:at,
      payload:{source:"P6_RECOVERED_OPEN_RESIDUAL_DEDUPLICATION",canonicalLotId:lotId,rawAmount:attributable.toString()},
    });
  }
  if(!lotId){
    lotId=entryPlanId+":recovered-open-residual:"+input.tokenMint;
    const supply=await input.connection.getTokenSupply(new PublicKey(input.tokenMint),"confirmed");
    await input.store.createPositionInventoryLot({
      lotId,
      createdEventId:entryPlanId+":recovered-open-residual-created",
      positionAddress:input.positionAddress,
      planId:entryPlanId,
      ownerAddress:input.plan.ownerAddress,
      poolAddress:input.plan.poolAddress,
      tokenMint:input.tokenMint,
      tokenSide:"X",
      sourceEvent:"RECOVERY_RESIDUAL",
      rawAmount:attributable,
      decimals:supply.value.decimals,
      acquiredAt:at,
      transactionSignature:String(recoveryRow.funding_signature),
      payload:{
        source:"PARTIAL_CHUNKED_OPEN_CHAIN_RECONSTRUCTION",
        fundingSignature:String(recoveryRow.funding_signature),
        pairedTokenRawBeforeFunding:pairedTokenRawBeforeFunding.toString(),
        pairedTokenRawBeforeClose:input.pairedTokenRawBeforeClose.toString(),
        pairedTokenRawAfterPriorUnwind:pairedTokenRawAfterPriorUnwind.toString(),
        pairedTokenReceivedRaw:pairedTokenReceivedRaw.toString(),
      },
    });
  }
  return{entryPlanId,lotId,tokenMint:input.tokenMint,rawAmount:attributable,recoveryRow};
}

/**
 * Executes one Jupiter token-X→token-Y swap with the full simulation, cost,
 * risk, signing and confirmation chain. Shared by partial-entry recovery and
 * the close sequence so both record the identical durable audit trail.
 */
async function executeJupiterUnwindStep(input: {
  store: Phase1Store;
  plan: AutonomousPlan;
  signer: MainnetSignerBackend;
  config: LiveWorkerConfig;
  amount: bigint;
  /** SOL-denominated current position basis; never raw token-X units. */
  economicReferenceLamports: bigint;
  action: "CLOSE" | "EMERGENCY_CLOSE";
  transactionId: string;
  idempotencyKey: string;
  stage: "PARTIAL_ENTRY_UNWIND" | "CLOSE_TOKEN_X_UNWIND" | "CLOSE_RECOVERED_OPEN_RESIDUAL_UNWIND";
  reasonPrefix: "P6_PARTIAL_UNWIND" | "P6_CLOSE_UNWIND" | "P6_CLOSE_RECOVERED_OPEN_RESIDUAL_UNWIND";
  fundingTransactionId?: string;
  afterSubmit?: (submitted: { signature: string }) => Promise<void>;
}): Promise<{ ok: boolean; submitted: boolean; reasonCodes: string[]; signature?:string }> {
  const connection = createGovernedConnection({rpcUrl:input.config.rpcUrl,priority:'P0_EXECUTION_CRITICAL'}),
    adapter = createMeteoraReadAdapter({
      rpcUrl: input.config.rpcUrl,
      cluster: "mainnet-beta",
      programId: input.config.programId,
      priority:'P0_EXECUTION_CRITICAL',
    }),
    pool = await adapter.getPool(input.plan.poolAddress),
    [nativeLamportsBefore,wsolRawBefore,tokenXRawBefore]=await Promise.all([
      connection.getBalance(new PublicKey(input.plan.ownerAddress),"confirmed").then(value=>BigInt(value)),
      readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:WSOL_MINT}),
      readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:pool.tokenXMint}),
    ]),
    policy = loadAutonomousEntryPolicy(),
    quote = await readJupiterMetisQuote({
      policy: policy.swapQuote,
      inputMint: pool.tokenXMint,
      outputMint: pool.tokenYMint,
      amount: input.amount,
      ...(process.env.LPFORGE_JUPITER_API_KEY
        ? { apiKey: process.env.LPFORGE_JUPITER_API_KEY }
        : {}),
    }),
    assessment = assessSwapQuote({
      quote,
      policy: policy.swapQuote,
      inputMint: pool.tokenXMint,
      outputMint: pool.tokenYMint,
      inputAmount: input.amount,
      requiredOutputAmount: 1n,
    });
  if (assessment.status !== "APPROVED")
    return { ok: false, submitted: false, reasonCodes: assessment.reasonCodes };
  const bytes = await buildJupiterMetisSwapTransaction({
      policy: policy.swapQuote,
      quote,
      userPublicKey: input.plan.ownerAddress,
      ...(process.env.LPFORGE_JUPITER_API_KEY
        ? { apiKey: process.env.LPFORGE_JUPITER_API_KEY }
        : {}),
    }),
    transaction = VersionedTransaction.deserialize(bytes),
    simulatedAt = new Date().toISOString();
  // Simulations and submission attempts are foreign-keyed to a durable plan
  // step. A recovery unwind is a new transaction, not one of the original
  // entry steps, so journal it before any simulation/signing work begins.
  await input.store.ensureExecutionTransactionStep({
    planId: input.plan.planId,
    transactionId: input.transactionId,
    kind: "JUPITER_UNWIND",
    state: "PLANNED",
    requiredSignerAddresses: [input.plan.ownerAddress],
    metadata: {
      stage: input.stage,
      ...(input.fundingTransactionId
        ? { fundingTransactionId: input.fundingTransactionId }
        : {}),
    },
  });
  const simulation = await simulateExecutionTransaction({
      authority: authority(
        "MAINNET_BUILD_SIMULATE",
        simulatedAt,
        input.config.riskPermitTtlMs,
      ),
      transactionId: input.transactionId,
      transaction,
      transport: createWeb3SimulationTransport(connection),
      simulatedAt,
      freshnessMs: input.config.simulationFreshnessMs,
    });
  await input.store.insertExecutionSimulation({
    transactionId: input.transactionId,
    simulatedAt: simulation.simulatedAt,
    freshUntil: simulation.simulationFreshUntil,
    ok: simulation.ok,
    ...(simulation.unitsConsumed !== undefined
      ? { unitsConsumed: simulation.unitsConsumed }
      : {}),
    logs: simulation.logs,
    ...(simulation.error ? { error: simulation.error } : {}),
    payload: { planId: input.plan.planId, stage: input.stage },
  });
  const fee = estimateExecutionFee({
      signatureCount: 1,
      computeUnitLimit: simulation.recommendedComputeUnitLimit ?? 0,
      computeUnitPriceMicroLamports: 0n,
    }),
    cost = assessExecutionCost(fee, input.economicReferenceLamports, {
      maxAbsoluteFeeLamports: input.config.maxFeeLamports,
      maxFeeFractionOfCapital: input.config.maxFeeFraction,
    }),
    risk = governExecutionRisk(
      {
        action: input.action,
        planId: input.transactionId,
        now: simulatedAt,
        thesisExpiresAt: input.plan.expiresAt,
        planExpiresAt: new Date(
          Date.now() + input.config.riskPermitTtlMs,
        ).toISOString(),
        simulationOk: simulation.ok,
        simulationFreshUntil: simulation.simulationFreshUntil,
        walletTruthConsistent: true,
        protocolCompatible: true,
        rpcHealthy: true,
        referenceDivergenceBps: 0,
        activeBinId: 0,
        intendedCenterBinId: 0,
        costApproved: cost.approved,
        reconciliationRequired: false,
        globalKillSwitch: false,
        liquidityCollapse: false,
      },
      {
        maxReferenceDivergenceBps: 100,
        maxActiveBinDriftBins: 100000,
        approvalTtlMs: input.config.riskPermitTtlMs,
        allowEmergencyCostOverride: input.action === "EMERGENCY_CLOSE",
      },
    );
  if (risk.decision !== "APPROVE" || !risk.permitId || !risk.expiresAt)
    return { ok: false, submitted: false, reasonCodes: risk.reasonCodes };
  await input.store.insertExecutionRiskPermit({
    permitId: risk.permitId,
    planId: input.plan.planId,
    decision: risk.decision,
    issuedAt: risk.issuedAt,
    expiresAt: risk.expiresAt,
    reasonCodes: risk.reasonCodes,
    payload: { stage: input.stage },
  });
  const signedAt = new Date().toISOString(),
    closeTicket = ticket(
      input.plan,
      input.economicReferenceLamports,
      signedAt,
      input.config.riskPermitTtlMs,
      executionMaxOpenPositions(input.config),
      input.action,
    ),
    closeAuthority = {
      phase: "P6" as const,
      cluster: "mainnet-beta" as const,
      level: "MAINNET_CANARY_CLOSE" as const,
      liveExecution: true as const,
      canaryOnly: true as const,
      issuedAt: signedAt,
      expiresAt: closeTicket.expiresAt,
      ticketId: closeTicket.ticketId,
      reasonCodes: [input.stage],
    },
    envelope = createVersionedMainnetEnvelope(transaction);
  await signMainnetCanary({
    authority: closeAuthority,
    ticket: closeTicket,
    transactionId: input.transactionId,
    requiredSignerAddresses: [input.plan.ownerAddress],
    backend: input.signer,
    envelope,
    signedAt,
  });
  const record = await submitSignedTransaction({
    authority: authority(
      "MAINNET_CANARY",
      signedAt,
      input.config.riskPermitTtlMs,
    ),
    riskDecision: risk,
    transactionId: input.transactionId,
    idempotencyKey: input.idempotencyKey,
    attempt: 1,
    raw: envelope.serializeSigned(),
    lease: {
      blockhash: transaction.message.recentBlockhash,
      lastValidBlockHeight: (await connection.getBlockHeight()) + 150,
    },
    ledger: ledger(input.store),
    transport: createWeb3SubmissionTransport(connection),
    submittedAt: signedAt,
  });
  // Persist submission identity before waiting for confirmation. If this
  // process dies after send, recovery can check this exact signature and will
  // never construct or send a duplicate unwind.
  if (input.afterSubmit)
    await input.afterSubmit({ signature: record.signature });
  if (
    !(await awaitConfirmation({
      connection,
      store: input.store,
      transactionId: input.transactionId,
      idempotencyKey: input.idempotencyKey,
      signature: record.signature,
      lease: record,
      pollMs: input.config.confirmPollMs,
      attempts: input.config.confirmAttempts,
    }))
  )
    return {
      ok: false,
      submitted: true,
      reasonCodes: [`${input.reasonPrefix}_CONFIRMATION_PENDING`],
    };
  const actualFee=await confirmedTransactionFeeLamports(connection,record.signature)??fee.totalFeeLamports;
  if(input.stage==="PARTIAL_ENTRY_UNWIND"){
    const [nativeLamportsAfter,wsolRawAfter,tokenXRawAfter]=await Promise.all([
      connection.getBalance(new PublicKey(input.plan.ownerAddress),"confirmed").then(value=>BigInt(value)),
      readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:WSOL_MINT}),
      readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:pool.tokenXMint}),
    ]),solBefore=nativeLamportsBefore+wsolRawBefore,solAfter=nativeLamportsAfter+wsolRawAfter,
      solIn=solAfter>solBefore?solAfter-solBefore:0n,
      tokenXOut=tokenXRawBefore>tokenXRawAfter?tokenXRawBefore-tokenXRawAfter:0n,
      at=new Date().toISOString();
    await input.store.insertPlanCashflow({cashflowId:`${input.plan.planId}:recovery-unwind-x-out`,planId:input.plan.planId,flowType:"RECOVERY_UNWIND_X_OUT",observedAt:at,tokenMint:pool.tokenXMint,tokenAmountRaw:tokenXOut.toString(),transactionSignature:record.signature,payload:{source:"WALLET_DELTA",before:tokenXRawBefore.toString(),after:tokenXRawAfter.toString(),requested:input.amount.toString()}});
    await input.store.insertPlanCashflow({cashflowId:`${input.plan.planId}:recovery-sol-in`,planId:input.plan.planId,flowType:"RECOVERY_SOL_IN",observedAt:at,lamports:solIn,transactionSignature:record.signature,payload:{source:"WALLET_DELTA",nativeLamportsBefore:nativeLamportsBefore.toString(),nativeLamportsAfter:nativeLamportsAfter.toString(),wsolRawBefore:wsolRawBefore.toString(),wsolRawAfter:wsolRawAfter.toString()}});
    await input.store.insertPlanCashflow({cashflowId:`${input.plan.planId}:recovery-unwind-tx-cost`,planId:input.plan.planId,flowType:"RECOVERY_TX_COST",observedAt:at,lamports:actualFee,transactionSignature:record.signature,payload:{source:actualFee===fee.totalFeeLamports?"EXECUTION_FEE_ESTIMATE":"CHAIN_RECEIPT_META",transactionId:input.transactionId}});
  }
  if(input.plan.positionAddress){
    await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:tx-cost:${input.transactionId}`,positionAddress:input.plan.positionAddress,planId:input.plan.planId,flowType:'TX_COST',observedAt:new Date().toISOString(),lamports:actualFee??fee.totalFeeLamports,payload:{signature:record.signature,transactionId:input.transactionId,source:actualFee===undefined?'EXECUTION_FEE_ESTIMATE':'CHAIN_RECEIPT_META',...(actualFee===undefined?{estimatedLamports:fee.totalFeeLamports.toString()}:{})}});
  }
  return {
    ok: true,
    submitted: true,
    reasonCodes: [`${input.reasonPrefix}_RECONCILED`],
    signature:record.signature,
  };
}

const MAX_AUTOMATIC_PARTIAL_ENTRY_UNWIND_RETRIES = 1;

export type PartialEntryUnwindRetryDecision =
  | { action: "SUBMIT"; retryCount: number; transactionId: string; idempotencyKey: string; reasonCodes: string[] }
  | { action: "HOLD"; reasonCodes: string[] };

/**
 * A partial-entry unwind is allowed to acquire a fresh child identity only
 * when the earlier child is proven finalized-failed.  Pending, unknown, or
 * successful signatures are never retried.  The bounded retry keeps a
 * deterministic protocol failure from creating an endless transaction loop.
 */
export function decidePartialEntryUnwindRetry(input:{planId:string;planIdempotencyKey:string;payload:Record<string,unknown>;priorStatus?:{err?:unknown;confirmationStatus?:string|null}|null;statusReadSucceeded:boolean}):PartialEntryUnwindRetryDecision{
  const retryRaw=Number(input.payload.partialEntryUnwindRetryCount??0),retryCount=Number.isSafeInteger(retryRaw)&&retryRaw>=0?retryRaw:undefined,
    priorSignature=typeof input.payload.unwindSignature==='string'&&input.payload.unwindSignature.length>0?input.payload.unwindSignature:undefined;
  if(retryCount===undefined)return{action:'HOLD',reasonCodes:['P6_PARTIAL_UNWIND_RETRY_COUNT_INVALID']};
  if(!priorSignature){
    if(retryCount!==0)return{action:'HOLD',reasonCodes:['P6_PARTIAL_UNWIND_RETRY_PROVENANCE_MISSING']};
    const transactionId=`${input.planId}:unwind`;
    return{action:'SUBMIT',retryCount,transactionId,idempotencyKey:`${input.planIdempotencyKey}:${transactionId}`,reasonCodes:['P6_PARTIAL_UNWIND_INITIAL_SUBMISSION']};
  }
  if(!input.statusReadSucceeded)return{action:'HOLD',reasonCodes:['P6_PARTIAL_UNWIND_RETRY_STATUS_READ_UNKNOWN']};
  if(!input.priorStatus?.confirmationStatus)return{action:'HOLD',reasonCodes:['P6_PARTIAL_UNWIND_RETRY_CONFIRMATION_PENDING']};
  if(input.priorStatus.err===undefined||input.priorStatus.err===null)return{action:'HOLD',reasonCodes:['P6_PARTIAL_UNWIND_RETRY_PRIOR_RESULT_NOT_FAILED']};
  if(input.priorStatus.confirmationStatus!=='finalized')return{action:'HOLD',reasonCodes:['P6_PARTIAL_UNWIND_RETRY_FAILURE_NOT_FINAL']};
  if(retryCount>=MAX_AUTOMATIC_PARTIAL_ENTRY_UNWIND_RETRIES)return{action:'HOLD',reasonCodes:['P6_PARTIAL_UNWIND_RETRY_LIMIT_REACHED']};
  const nextRetry=retryCount+1,transactionId=`${input.planId}:unwind:retry-${nextRetry}`;
  return{action:'SUBMIT',retryCount:nextRetry,transactionId,idempotencyKey:`${input.planIdempotencyKey}:${transactionId}`,reasonCodes:['P6_PARTIAL_UNWIND_PRIOR_FINALIZED_FAILED','P6_PARTIAL_UNWIND_RETRY_AUTHORIZED']};
}

async function unwindPartialEntry(input: {
  store: Phase1Store;
  plan: AutonomousPlan;
  row: Record<string, unknown>;
  signer: MainnetSignerBackend;
  config: LiveWorkerConfig;
  identity:{retryCount:number;transactionId:string;idempotencyKey:string};
}): Promise<{ ok: boolean; submitted: boolean; reasonCodes: string[] }> {
  const amount = BigInt(String(input.row.paired_token_amount)),
    transactionId = input.identity.transactionId;
  return executeJupiterUnwindStep({
    store: input.store,
    plan: input.plan,
    signer: input.signer,
    config: input.config,
    amount,
    economicReferenceLamports: BigInt(String(input.row.intended_capital_lamports)),
    action: "CLOSE",
    transactionId,
    idempotencyKey: input.identity.idempotencyKey,
    stage: "PARTIAL_ENTRY_UNWIND",
    reasonPrefix: "P6_PARTIAL_UNWIND",
    fundingTransactionId: String(input.row.funding_transaction_id),
    afterSubmit: async (submitted) => {
      await input.store.upsertPartialEntryRecovery({
        planId: input.plan.planId,
        poolAddress: input.plan.poolAddress,
        ownerAddress: input.plan.ownerAddress,
        tokenMint: String(input.row.token_mint),
        fundingTransactionId: String(input.row.funding_transaction_id),
        fundingSignature: String(input.row.funding_signature),
        fundedAt: new Date(String(input.row.funded_at)).toISOString(),
        pairedTokenAmount: String(input.row.paired_token_amount),
        intendedCapitalLamports: BigInt(
          String(input.row.intended_capital_lamports),
        ),
        intendedRange: (input.row.intended_range ?? {}) as Record<
          string,
          unknown
        >,
        state: "UNWIND_SUBMITTED",
        walletTruth: { refreshRequired: true },
        payload: {
          reasonCodes: ["P6_PARTIAL_UNWIND_SUBMITTED"],
          unwindTransactionId: transactionId,
          unwindSignature: submitted.signature,
          partialEntryUnwindRetryCount: input.identity.retryCount,
        },
        updatedAt: new Date().toISOString(),
      });
    },
  });
}

/**
 * Reconciles a recovered chunked position from its original signed children.
 * A fully confirmed construction becomes a normal OPEN; a provably missing
 * final child becomes OPEN_RECOVERED.  Neither case rebuilds or replays a
 * stale liquidity instruction.
 */
async function reconcileRecoveredChunkedOpen(input:{
  store:Phase1Store;
  config:LiveWorkerConfig;
  row:Record<string,unknown>;
  plan:AutonomousPlan;
  dispositions:OpenChunkDispositionRecord[];
  partial:boolean;
}):Promise<{recovered:boolean;reasonCodes:string[]}>{
  const positionAddress=input.plan.positionAddress;
  if(!positionAddress)return{recovered:false,reasonCodes:['P6_OPEN_RECOVERED_POSITION_IDENTITY_MISSING']};
  const intended=(input.row.intended_range??{}) as Record<string,unknown>;
  const lower=Number(intended.lowerBinId),upper=Number(intended.upperBinId);
  if(!Number.isInteger(lower)||!Number.isInteger(upper)||lower>upper)return{recovered:false,reasonCodes:['P6_OPEN_RECOVERED_RANGE_INVALID']};
  const truth=await createMeteoraReadAdapter({rpcUrl:input.config.rpcUrl,cluster:'mainnet-beta',programId:input.config.programId,priority:'P1_RECOVERY_CRITICAL'}).getPositionV2(input.plan.poolAddress,positionAddress).catch(()=>undefined);
  if(!truth)return{recovered:false,reasonCodes:['P6_OPEN_RECOVERED_POSITION_TRUTH_UNAVAILABLE']};
  if(truth.owner!==input.plan.ownerAddress||truth.pool!==input.plan.poolAddress)return{recovered:false,reasonCodes:['P6_OPEN_RECOVERED_POSITION_IDENTITY_MISMATCH']};
  if(truth.lowerBinId!==lower||truth.upperBinId!==upper)return{recovered:false,reasonCodes:['P6_OPEN_RECOVERED_RANGE_MISMATCH']};
  const walletTruth=(input.row.wallet_truth??{}) as Record<string,unknown>,measurement=(walletTruth.entryFundingMeasurement??{}) as Record<string,unknown>;
  let pairedTokenRawBeforeFunding:bigint,pairedTokenReceivedRaw:bigint,capital:bigint;
  try{
    pairedTokenRawBeforeFunding=BigInt(String(measurement.pairedTokenRawBeforeFunding??''));
    pairedTokenReceivedRaw=BigInt(String(input.row.paired_token_amount??''));
    capital=BigInt(String(input.row.intended_capital_lamports??''));
  }catch{return{recovered:false,reasonCodes:['P6_OPEN_RECOVERED_FUNDING_PROVENANCE_INVALID']};}
  const tokenMint=String(input.row.token_mint??'');
  if(!tokenMint||pairedTokenReceivedRaw<=0n||capital<=0n)return{recovered:false,reasonCodes:['P6_OPEN_RECOVERED_FUNDING_PROVENANCE_INVALID']};
  const connection=createGovernedConnection({rpcUrl:input.config.rpcUrl,priority:'P1_RECOVERY_CRITICAL'}),currentTokenBalance=await readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:tokenMint}),residual=deriveRecoveredOpenResidualInventory({pairedTokenRawBeforeFunding,pairedTokenRawBeforeClose:currentTokenBalance,pairedTokenRawAfterPriorUnwind:currentTokenBalance,pairedTokenReceivedRaw});
  if(residual===undefined)return{recovered:false,reasonCodes:['P6_OPEN_RECOVERED_WALLET_ATTRIBUTION_UNPROVEN']};
  const fundingSignature=String(input.row.funding_signature??'');
  if(!fundingSignature)return{recovered:false,reasonCodes:['P6_OPEN_RECOVERED_FUNDING_SIGNATURE_MISSING']};
  const confirmed=input.dispositions.filter(row=>row.disposition==='CONFIRMED'&&row.signature);
  if(confirmed.length===0)return{recovered:false,reasonCodes:['P6_OPEN_RECOVERED_CONFIRMED_CHUNK_PROOF_MISSING']};
  // `recoverUnfinishedAutonomousPlans` may already have recorded the exact
  // wallet residual while the position was marked PARTIAL_ENTRY.  Never add a
  // second lot for the same funded balance when we promote that position to
  // OPEN_RECOVERED: two lots would double-count the same wallet inventory at
  // its eventual settlement.
  const residualLotAction=assessTerminalPartialOpenResidualLot({
    lots:await input.store.loadPositionInventoryLots(positionAddress,tokenMint),
    planId:input.plan.planId,
    residual,
  });
  if(residualLotAction==='CONFLICT')
    return{recovered:false,reasonCodes:['P6_RECOVERED_CHUNKED_OPEN_RESIDUAL_LOT_CONFLICT']};
  if(residualLotAction==='CREATE'&&residual>0n){
    const supply=await connection.getTokenSupply(new PublicKey(tokenMint),'confirmed');
    await input.store.createPositionInventoryLot({
      lotId:`${input.plan.planId}:recovered-open-residual:${tokenMint}`,
      createdEventId:`${input.plan.planId}:recovered-open-residual-created`,
      positionAddress,
      planId:input.plan.planId,
      ownerAddress:input.plan.ownerAddress,
      poolAddress:input.plan.poolAddress,
      tokenMint,
      tokenSide:'X',
      sourceEvent:input.partial?'RECOVERY_RESIDUAL':'OPEN_RESIDUAL',
      rawAmount:residual,
      decimals:supply.value.decimals,
      acquiredAt:new Date().toISOString(),
      transactionSignature:fundingSignature,
      payload:{source:input.partial?'P6_OPEN_RECOVERED_TERMINAL_MISSING_CHUNK':'P6_RECOVERED_CHUNKED_OPEN_CONFIRMED',fundingSignature,pairedTokenRawBeforeFunding:pairedTokenRawBeforeFunding.toString(),pairedTokenReceivedRaw:pairedTokenReceivedRaw.toString()},
    });
  }
  const funding:EntryFundingMeasurement={tokenMint,pairedTokenReceivedRaw,pairedTokenRawBeforeFunding,pairedTokenRawBeforeOpen:BigInt(String(measurement.pairedTokenRawBeforeOpen??pairedTokenRawBeforeFunding)),fundingSignature};
  const open=openPlan(input.plan);
  const observedAt=new Date().toISOString(),intent=(input.plan.planPayload.intent??{}) as Record<string,unknown>,entryFunding=(input.plan.intentPayload.entryFunding??{}) as Record<string,unknown>;
  const entryBasis=await persistReceiptBackedEntryBasis({store:input.store,connection,plan:open,positionAddress,requestedLiquidityCapitalLamports:capital,funding,confirmedSteps:confirmed.map(step=>({transactionId:step.transactionId,kind:step.kind,signature:step.signature!})),observedAt});
  const contribution=entryBasis.managedEconomicContributionLamports??capital;
  const recovery=input.partial?'P6_OPEN_RECOVERED_TERMINAL_MISSING_CHUNK':'P6_RECOVERED_CHUNKED_OPEN_CONFIRMED';
  await input.store.upsertOwnedPosition({lpforgePositionId:`position-${positionAddress}`,poolAddress:input.plan.poolAddress,positionAddress,ownerAddress:input.plan.ownerAddress,strategy:String(intent.strategy??'SPOT'),orientation:String(entryFunding.orientation??'ONE_SIDED_Y'),lowerBinId:truth.lowerBinId,upperBinId:truth.upperBinId,activeBinAtEntry:Number(intent.activeBinId??truth.lowerBinId),initialCapitalLamports:capital,entryPlanId:input.plan.planId,entrySignature:confirmed.at(-1)!.signature!,enteredAt:new Date(String(input.row.funded_at)).toISOString(),lifecycleState:'OPEN',lastPlanId:input.plan.planId,reconciliationStatus:'MATCH',payload:{thesisId:input.plan.thesisId,entryFunding,recovery, ...(input.partial?{partialEntryRecovered:true}:{}),actualEconomicCapitalLamports:contribution.toString(),residualTokenMint:tokenMint,residualTokenRaw:residual.toString()}});
  await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:open-contribution`,positionAddress,planId:input.plan.planId,flowType:'OPEN_CONTRIBUTION',observedAt,lamports:contribution,payload:{source:entryBasis.basisState==='PROVEN'?'RECEIPT_BACKED_ENTRY_BASIS_V1':'ENTRY_BASIS_INCOMPLETE_FALLBACK',entryBasisId:`${input.plan.planId}:entry-basis:v1`,recovery}});
  const account=await connection.getAccountInfo(new PublicKey(positionAddress),'confirmed');
  if(account?.lamports)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:rent-lock`,positionAddress,planId:input.plan.planId,flowType:'RENT_LOCK',observedAt,lamports:BigInt(account.lamports),payload:{source:'POSITION_ACCOUNT_INFO',recovery:'P6_OPEN_RECOVERED_TERMINAL_MISSING_CHUNK'}});
  for(const step of confirmed){
    const fee=await confirmedTransactionFeeLamports(connection,step.signature!);
    if(fee!==undefined)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:tx-cost:${step.transactionId}`,positionAddress,planId:input.plan.planId,flowType:'TX_COST',observedAt,lamports:fee,payload:{signature:step.signature,transactionId:step.transactionId,source:'CHAIN_RECEIPT_META',recovery:'P6_OPEN_RECOVERED_TERMINAL_MISSING_CHUNK'}});
  }
  const fundingCost=(await input.store.loadPlanCashflows(input.plan.planId)).find(flow=>flow.flowType==='FUNDING_TX_COST');
  if(fundingCost?.lamports!==undefined)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:tx-cost:funding`,positionAddress,planId:input.plan.planId,flowType:'TX_COST',observedAt,lamports:fundingCost.lamports,payload:{source:'ENTRY_FUNDING_RECEIPT',...(fundingCost.transactionSignature?{signature:fundingCost.transactionSignature}:{}),recovery:'P6_OPEN_RECOVERED_TERMINAL_MISSING_CHUNK'}});
  await input.store.insertExecutionReconciliation({reconciliationId:`${input.plan.planId}:recovered-chunked-open`,planId:input.plan.planId,observedAt,status:'MATCH',expected:{owner:input.plan.ownerAddress,pool:input.plan.poolAddress,lowerBinId:lower,upperBinId:upper,allEconomicChunksConfirmed:!input.partial},actual:{positionAddress,residualTokenMint:tokenMint,residualTokenRaw:residual.toString(),confirmedEconomicChunks:confirmed.map(step=>step.transactionId)},discrepancies:[],payload:{recovery}});
  await input.store.reconcileRecoveredChunkedOpenPlan({planId:input.plan.planId,at:observedAt,payload:{recovery,positionAddress,residualTokenMint:tokenMint,residualTokenRaw:residual.toString()}});
  if(input.partial)await input.store.upsertPartialEntryRecovery({planId:input.plan.planId,poolAddress:input.plan.poolAddress,ownerAddress:input.plan.ownerAddress,tokenMint,fundingTransactionId:String(input.row.funding_transaction_id),fundingSignature,fundedAt:new Date(String(input.row.funded_at)).toISOString(),pairedTokenAmount:String(input.row.paired_token_amount),intendedCapitalLamports:capital,intendedRange:intended,state:'OPEN_RECOVERED',walletTruth:{...walletTruth,refreshRequired:false,recoveredPositionAddress:positionAddress,recoveredResidualRaw:residual.toString(),recoveredAt:observedAt},payload:{partialEntryRecovered:true,reasonCodes:[recovery]},updatedAt:observedAt});
  else await input.store.supersedePartialEntryRecoveryIfSuccessfulOpen({planId:input.plan.planId,positionAddress,ownerAddress:input.plan.ownerAddress,poolAddress:input.plan.poolAddress,at:observedAt});
  return{recovered:true,reasonCodes:[recovery]};
}

/**
 * Parent OPEN plans may already be terminal before the recurring
 * partial-entry queue gets a chance to reconcile their final child.  Query
 * only the original signed child and turn it into no-effect evidence only
 * after the RPC reports no status beyond its durable blockhash lifetime.
 * This path never creates, signs, or submits a liquidity transaction.
 */
async function refreshTerminalOpenChunkTruth(input:{
  store:Phase1Store;
  config:LiveWorkerConfig;
  planId:string;
  dispositions:OpenChunkDispositionRecord[];
}):Promise<OpenChunkDispositionRecord[]>{
  const candidates=input.dispositions.filter(row=>
    ['PENDING','SIGNING','SIGNED','SUBMITTED','UNKNOWN_SUBMISSION'].includes(row.disposition)&&
    Boolean(row.signature)&&
    row.lastValidBlockHeight!==undefined,
  );
  if(candidates.length===0)return input.dispositions;
  const connection=createGovernedConnection({rpcUrl:input.config.rpcUrl,priority:'P1_RECOVERY_CRITICAL'});
  let currentBlockHeight:number;
  try{currentBlockHeight=await connection.getBlockHeight('confirmed');}catch{return input.dispositions;}
  for(const candidate of candidates){
    let status:Awaited<ReturnType<typeof connection.getSignatureStatus>>['value'];
    try{status=(await connection.getSignatureStatus(candidate.signature!,{searchTransactionHistory:true})).value;}catch{continue;}
    const observedAt=new Date().toISOString();
    const classification=classifyKnownOpenChunkSignatureTruth({disposition:candidate.disposition,signaturePresent:true,...(candidate.lastValidBlockHeight===undefined?{}:{lastValidBlockHeight:candidate.lastValidBlockHeight}),currentBlockHeight,statusReadSucceeded:true,status});
    if(classification==='CONFIRMED_FAILED'){
      await input.store.upsertOpenChunkDisposition({...candidate,disposition:'CONFIRMED_FAILED',observedAt,payload:{...candidate.payload,recovery:'P6_OPEN_CHUNK_CONFIRMED_FAILED',chainError:status?.err}});
      continue;
    }
    if(classification==='CONFIRMED'){
      await input.store.upsertOpenChunkDisposition({...candidate,disposition:'CONFIRMED',observedAt,payload:{...candidate.payload,recovery:'P6_OPEN_CHUNK_CONFIRMED',confirmationStatus:status?.confirmationStatus}});
      continue;
    }
    if(classification==='PROVEN_NOT_LANDED'){
      await input.store.markSubmissionExpired(candidate.signature!,observedAt,'P6_OPEN_CHUNK_EXPIRED_NO_CHAIN_EFFECT');
      await input.store.upsertOpenChunkDisposition({...candidate,disposition:'PROVEN_NOT_LANDED',observedAt,payload:{...candidate.payload,recovery:'P6_OPEN_CHUNK_EXPIRED_NO_CHAIN_EFFECT',currentBlockHeight}});
    }
  }
  return input.store.loadOpenChunkDispositions(input.planId);
}

/** Resumes a funded entry without ever repeating the already-confirmed Jupiter swap. */
export async function recoverPartialEntryFunding(input: {
  store: Phase1Store;
  signer: MainnetSignerBackend;
  config: LiveWorkerConfig;
}): Promise<
  Array<{
    planId: string;
    action: "RESUME_OPEN" | "UNWIND_REQUIRED" | "HOLD";
    reasonCodes: string[];
  }>
> {
  const rows = await input.store.loadPartialEntryRecoveries();
  const results: Array<{
    planId: string;
    action: "RESUME_OPEN" | "UNWIND_REQUIRED" | "HOLD";
    reasonCodes: string[];
  }> = [];
  for (const row of rows) {
    const planId = String(row.plan_id),
      state = String(row.state);
    if (state === "ABORTED_SOL_SETTLED") {
      const outcome = await input.store.createLiveEntryAbortedLearningOutcome({
        planId,
        at: new Date().toISOString(),
      });
      results.push({
        planId,
        action: "HOLD",
        reasonCodes: outcome.outcome
          ? ["P6_PARTIAL_ABORTED_SOL_SETTLED_LEARNING_RECORDED"]
          : ["P6_PARTIAL_ABORTED_SOL_SETTLED_LEARNING_PENDING", ...outcome.reasonCodes],
      });
      continue;
    }
    if (state === "RESOLVED") {
      results.push({planId,action:"HOLD",reasonCodes:["P6_PARTIAL_OPEN_RESIDUAL_SETTLED"]});
      continue;
    }
    // A reconciled plan is not by itself proof of a full entry: an extended
    // PositionV2 can exist after only its first liquidity child.  Every
    // economic child must be chain-confirmed before this recovery row may be
    // retired as an ordinary open.
    const plan = await input.store.loadAutonomousPlan(planId);
    const plannedChunks=plan?.action==='OPEN'?plan.steps.filter(step=>step.kind==='METEORA_OPEN'||step.kind==='METEORA_OPEN_CHUNK').map((step,index)=>({transactionId:step.transactionId,sequence:index+1,kind:step.kind})):[];
    const construction=plan?.action==='OPEN'&&plannedChunks.length>1?assessOpenChunkConstruction({planned:plannedChunks,dispositions:await input.store.loadOpenChunkDispositions(planId)}):undefined;
    // A single METEORA_OPEN has no child-disposition ledger. It is safe to
    // retire recovery only when the plan is reconciled *and* exactly one
    // currently OPEN/MATCHed owned position is durably bound to this entry
    // plan, owner, and pool. A payload address alone is never sufficient.
    const constructionComplete=construction?construction.fullyConstructed:plannedChunks.length===1;
    if (plan?.action === "OPEN" && plan.state === "RECONCILED" && constructionComplete && plan.positionOpenReconciled) {
      await input.store.upsertPartialEntryRecovery({
        planId,
        poolAddress: String(row.pool_address),
        ownerAddress: String(row.owner_address),
        tokenMint: String(row.token_mint),
        fundingTransactionId: String(row.funding_transaction_id),
        fundingSignature: String(row.funding_signature),
        fundedAt: new Date(String(row.funded_at)).toISOString(),
        pairedTokenAmount: String(row.paired_token_amount),
        intendedCapitalLamports: BigInt(String(row.intended_capital_lamports)),
        intendedRange: (row.intended_range ?? {}) as Record<string, unknown>,
        state: "SUPERSEDED_BY_SUCCESSFUL_ENTRY",
        walletTruth: {
          ...(row.wallet_truth ?? {}),
          reconciledPlanId: plan.planId,
          reconciledPositionAddress: plan.positionAddress ?? null,
          positionIdentitySource: plan.positionIdentitySource ?? null,
          refreshedAt: new Date().toISOString(),
        },
        payload: { reasonCodes: ["P6_PARTIAL_RECOVERY_SUPERSEDED_BY_SUCCESSFUL_ENTRY"] },
        updatedAt: new Date().toISOString(),
      });
      results.push({ planId, action: "HOLD", reasonCodes: ["P6_PARTIAL_RECOVERY_SUPERSEDED_BY_SUCCESSFUL_ENTRY"] });
      continue;
    }
    if(plan?.action==='OPEN'&&construction&&!construction.fullyConstructed){
      const refreshedDispositions=await refreshTerminalOpenChunkTruth({store:input.store,config:input.config,planId,dispositions:await input.store.loadOpenChunkDispositions(planId)}),refreshedConstruction=assessOpenChunkConstruction({planned:plannedChunks,dispositions:refreshedDispositions}),terminal=assessTerminalPartialOpenRecovery({planned:plannedChunks,dispositions:refreshedDispositions});
      if(refreshedConstruction.fullyConstructed){
        const recovered=await reconcileRecoveredChunkedOpen({store:input.store,config:input.config,row,plan,dispositions:refreshedDispositions,partial:false});
        results.push({planId,action:'HOLD',reasonCodes:recovered.reasonCodes});
        if(recovered.recovered)continue;
      }
      if(terminal.eligible){
        const recovered=await reconcileRecoveredChunkedOpen({store:input.store,config:input.config,row,plan,dispositions:refreshedDispositions,partial:true});
        results.push({planId,action:'HOLD',reasonCodes:recovered.reasonCodes});
        if(recovered.recovered)continue;
      }
      await input.store.upsertPartialEntryRecovery({planId,poolAddress:String(row.pool_address),ownerAddress:String(row.owner_address),tokenMint:String(row.token_mint),fundingTransactionId:String(row.funding_transaction_id),fundingSignature:String(row.funding_signature),fundedAt:new Date(String(row.funded_at)).toISOString(),pairedTokenAmount:String(row.paired_token_amount),intendedCapitalLamports:BigInt(String(row.intended_capital_lamports)),intendedRange:(row.intended_range??{}) as Record<string,unknown>,state:'RECONCILIATION_REQUIRED',walletTruth:{...(row.wallet_truth??{}),refreshRequired:true},payload:{partialEntry:true,reasonCodes:refreshedConstruction.reasonCodes},updatedAt:new Date().toISOString()});
      results.push({planId,action:'HOLD',reasonCodes:['P6_PARTIAL_ENTRY_REQUIRES_POSITION_RECOVERY',...terminal.reasonCodes,...refreshedConstruction.reasonCodes]});
      continue;
    }
    if (state === "UNWIND_SUBMITTED") {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const signature = typeof payload.unwindSignature === "string" ? payload.unwindSignature : "";
      if (!signature) {
        // Legacy interrupted rows can carry UNWIND_SUBMITTED before a send was
        // actually journaled. Reset only this unproven state; the next cycle
        // will rebuild the unwind through the durable step path.
        await input.store.upsertPartialEntryRecovery({
          planId,
          poolAddress: String(row.pool_address),
          ownerAddress: String(row.owner_address),
          tokenMint: String(row.token_mint),
          fundingTransactionId: String(row.funding_transaction_id),
          fundingSignature: String(row.funding_signature),
          fundedAt: new Date(String(row.funded_at)).toISOString(),
          pairedTokenAmount: String(row.paired_token_amount),
          intendedCapitalLamports: BigInt(String(row.intended_capital_lamports)),
          intendedRange: (row.intended_range ?? {}) as Record<string, unknown>,
          state: "ENTRY_FUNDED_NOT_OPEN",
          walletTruth: { refreshRequired: true },
          payload: { reasonCodes: ["P6_PARTIAL_UNWIND_SUBMISSION_UNPROVEN"] },
          updatedAt: new Date().toISOString(),
        });
        results.push({ planId, action: "HOLD", reasonCodes: ["P6_PARTIAL_UNWIND_SUBMISSION_UNPROVEN"] });
        continue;
      }
      let status:
        | { err: unknown; confirmationStatus?: string | null }
        | null
        | undefined;
      try {
        status = (
          await createGovernedConnection({rpcUrl:input.config.rpcUrl,priority:'P1_RECOVERY_CRITICAL'}).getSignatureStatuses(
            [signature],
            { searchTransactionHistory: true },
          )
        ).value[0];
      } catch {
        // A status-read outage is unknown chain truth. Keep the durable
        // UNWIND_SUBMITTED record; never reset it or retry the unwind.
        results.push({
          planId,
          action: "HOLD",
          reasonCodes: ["P6_PARTIAL_UNWIND_STATUS_READ_UNKNOWN"],
        });
        continue;
      }
      if (!status || !status.confirmationStatus) {
        results.push({ planId, action: "HOLD", reasonCodes: ["P6_PARTIAL_UNWIND_CONFIRMATION_PENDING"] });
        continue;
      }
      if (status.err) {
        await input.store.upsertPartialEntryRecovery({
          planId,
          poolAddress: String(row.pool_address),
          ownerAddress: String(row.owner_address),
          tokenMint: String(row.token_mint),
          fundingTransactionId: String(row.funding_transaction_id),
          fundingSignature: String(row.funding_signature),
          fundedAt: new Date(String(row.funded_at)).toISOString(),
          pairedTokenAmount: String(row.paired_token_amount),
          intendedCapitalLamports: BigInt(String(row.intended_capital_lamports)),
          intendedRange: (row.intended_range ?? {}) as Record<string, unknown>,
          state: "ENTRY_FUNDED_NOT_OPEN",
          walletTruth: { refreshRequired: true },
          payload: { reasonCodes: ["P6_PARTIAL_UNWIND_CHAIN_FAILED"] },
          updatedAt: new Date().toISOString(),
        });
        results.push({ planId, action: "HOLD", reasonCodes: ["P6_PARTIAL_UNWIND_CHAIN_FAILED"] });
        continue;
      }
      await input.store.upsertPartialEntryRecovery({
        planId,
        poolAddress: String(row.pool_address),
        ownerAddress: String(row.owner_address),
        tokenMint: String(row.token_mint),
        fundingTransactionId: String(row.funding_transaction_id),
        fundingSignature: String(row.funding_signature),
        fundedAt: new Date(String(row.funded_at)).toISOString(),
        pairedTokenAmount: String(row.paired_token_amount),
        intendedCapitalLamports: BigInt(String(row.intended_capital_lamports)),
        intendedRange: (row.intended_range ?? {}) as Record<string, unknown>,
        state: "ABORTED_SOL_SETTLED",
        walletTruth: { unwindSignature: signature, confirmationStatus: status.confirmationStatus, refreshedAt: new Date().toISOString() },
        payload: { reasonCodes: ["P6_PARTIAL_UNWIND_RECONCILED"] },
        updatedAt: new Date().toISOString(),
      });
      results.push({ planId, action: "HOLD", reasonCodes: ["P6_PARTIAL_UNWIND_RECONCILED"] });
      continue;
    }
    // UNWIND_REQUIRED means no unwind was submitted.  It is recoverable
    // pre-submission work, so rebuild a fresh quote/transaction on later
    // cycles instead of turning one transient simulation rejection into a
    // permanent hold. UNWIND_SUBMITTED remains above and is never resent.
    if (state !== "ENTRY_FUNDED_NOT_OPEN" && state !== "RESUME_OPEN" && state !== "UNWIND_REQUIRED") {
      results.push({
        planId,
        action: "HOLD",
        reasonCodes: [`P6_PARTIAL_${state}`],
      });
      continue;
    }
    if (!plan || plan.action !== "OPEN") {
      await input.store.upsertPartialEntryRecovery({
        planId,
        poolAddress: String(row.pool_address),
        ownerAddress: String(row.owner_address),
        tokenMint: String(row.token_mint),
        fundingTransactionId: String(row.funding_transaction_id),
        fundingSignature: String(row.funding_signature),
        fundedAt: new Date(String(row.funded_at)).toISOString(),
        pairedTokenAmount: String(row.paired_token_amount),
        intendedCapitalLamports: BigInt(String(row.intended_capital_lamports)),
        intendedRange: (row.intended_range ?? {}) as Record<string, unknown>,
        state: "UNWIND_REQUIRED",
        walletTruth: { refreshRequired: true },
        payload: { reasonCodes: ["P6_PARTIAL_PLAN_MISSING_OR_INVALID"] },
        updatedAt: new Date().toISOString(),
      });
      results.push({
        planId,
        action: "UNWIND_REQUIRED",
        reasonCodes: ["P6_PARTIAL_PLAN_MISSING_OR_INVALID"],
      });
      continue;
    }
    if (Date.parse(plan.expiresAt) <= Date.now()) {
      const priorUnwindPayload=(row.payload??{}) as Record<string,unknown>;
      let priorStatus:{err?:unknown;confirmationStatus?:string|null}|null|undefined,statusReadSucceeded=true;
      if(typeof priorUnwindPayload.unwindSignature==='string'&&priorUnwindPayload.unwindSignature.length>0){
        try{priorStatus=(await createGovernedConnection({rpcUrl:input.config.rpcUrl,priority:'P1_RECOVERY_CRITICAL'}).getSignatureStatuses([priorUnwindPayload.unwindSignature],{searchTransactionHistory:true})).value[0];}
        catch{statusReadSucceeded=false;}
      }
      const unwindIdentity=decidePartialEntryUnwindRetry({planId,planIdempotencyKey:plan.idempotencyKey,payload:priorUnwindPayload,statusReadSucceeded,...(priorStatus===undefined?{}:{priorStatus})});
      if(unwindIdentity.action==='HOLD'){
        await input.store.upsertPartialEntryRecovery({
          planId,
          poolAddress: plan.poolAddress,
          ownerAddress: plan.ownerAddress,
          tokenMint: String(row.token_mint),
          fundingTransactionId: String(row.funding_transaction_id),
          fundingSignature: String(row.funding_signature),
          fundedAt: new Date(String(row.funded_at)).toISOString(),
          pairedTokenAmount: String(row.paired_token_amount),
          intendedCapitalLamports: BigInt(String(row.intended_capital_lamports)),
          intendedRange: (row.intended_range ?? {}) as Record<string, unknown>,
          state: "UNWIND_REQUIRED",
          walletTruth: { refreshRequired: true },
          payload: { reasonCodes: unwindIdentity.reasonCodes },
          updatedAt: new Date().toISOString(),
        });
        results.push({planId,action:'HOLD',reasonCodes:unwindIdentity.reasonCodes});
        continue;
      }
      await input.store.upsertPartialEntryRecovery({
        planId,
        poolAddress: plan.poolAddress,
        ownerAddress: plan.ownerAddress,
        tokenMint: String(row.token_mint),
        fundingTransactionId: String(row.funding_transaction_id),
        fundingSignature: String(row.funding_signature),
        fundedAt: new Date(String(row.funded_at)).toISOString(),
        pairedTokenAmount: String(row.paired_token_amount),
        intendedCapitalLamports: BigInt(String(row.intended_capital_lamports)),
        intendedRange: (row.intended_range ?? {}) as Record<string, unknown>,
        // This is still only an unwind requirement.  It becomes submitted
        // only after the durable unwind transaction step is simulated, signed,
        // and handed to the submission ledger.
        state: "UNWIND_REQUIRED",
        walletTruth: { refreshRequired: true },
        payload: { reasonCodes: ["P6_PARTIAL_THESIS_OR_PLAN_EXPIRED"] },
        updatedAt: new Date().toISOString(),
      });
      const unwind = await unwindPartialEntry({
        store: input.store,
        plan,
        row,
        signer: input.signer,
        config: input.config,
        identity: unwindIdentity,
      });
      await input.store.upsertPartialEntryRecovery({
        planId,
        poolAddress: plan.poolAddress,
        ownerAddress: plan.ownerAddress,
        tokenMint: String(row.token_mint),
        fundingTransactionId: String(row.funding_transaction_id),
        fundingSignature: String(row.funding_signature),
        fundedAt: new Date(String(row.funded_at)).toISOString(),
        pairedTokenAmount: String(row.paired_token_amount),
        intendedCapitalLamports: BigInt(String(row.intended_capital_lamports)),
        intendedRange: (row.intended_range ?? {}) as Record<string, unknown>,
        state: unwind.ok ? "ABORTED_SOL_SETTLED" : unwind.submitted ? "UNWIND_SUBMITTED" : "UNWIND_REQUIRED",
        walletTruth: { refreshedAt: new Date().toISOString() },
        payload: { reasonCodes: [...unwindIdentity.reasonCodes,...unwind.reasonCodes], unwindTransactionId: unwindIdentity.transactionId, partialEntryUnwindRetryCount: unwindIdentity.retryCount },
        updatedAt: new Date().toISOString(),
      });
      results.push({
        planId,
        action: "UNWIND_REQUIRED",
        reasonCodes: unwind.reasonCodes,
      });
      continue;
    }
    const funding = plan.intentPayload.entryFunding as
      | Record<string, unknown>
      | undefined;
    if (!funding) {
      results.push({
        planId,
        action: "HOLD",
        reasonCodes: ["P6_PARTIAL_FUNDING_MISSING"],
      });
      continue;
    }
    const connection = createGovernedConnection({rpcUrl:input.config.rpcUrl,priority:'P1_RECOVERY_CRITICAL'}),
      adapter = createMeteoraReadAdapter({
        rpcUrl: input.config.rpcUrl,
        cluster: "mainnet-beta",
        programId: input.config.programId,
        priority:'P1_RECOVERY_CRITICAL',
      }),
      pool = await adapter.getPool(plan.poolAddress),
      accounts = await connection.getParsedTokenAccountsByOwner(
        new PublicKey(plan.ownerAddress),
        { mint: new PublicKey(pool.tokenXMint) },
        "confirmed",
      ),
      tokenBalance = accounts.value.reduce(
        (sum, account) =>
          sum +
          BigInt(
            String(
              (
                account.account.data as {
                  parsed?: { info?: { tokenAmount?: { amount?: string } } };
                }
              ).parsed?.info?.tokenAmount?.amount ?? "0",
            ),
          ),
        0n,
      ),
      required = BigInt(String(funding.totalPairedTokenRaw ?? "0"));
    if (tokenBalance < required) {
      results.push({
        planId,
        action: "HOLD",
        reasonCodes: ["P6_PARTIAL_WALLET_TOKEN_TRUTH_INSUFFICIENT"],
      });
      continue;
    }
    const open = openPlan(plan);
    delete open.swapTransactionId;
    delete open.swapTransactionMetadata;
    await input.store.upsertPartialEntryRecovery({
      planId,
      poolAddress: plan.poolAddress,
      ownerAddress: plan.ownerAddress,
      tokenMint: String(row.token_mint),
      fundingTransactionId: String(row.funding_transaction_id),
      fundingSignature: String(row.funding_signature),
      fundedAt: new Date(String(row.funded_at)).toISOString(),
      pairedTokenAmount: String(row.paired_token_amount),
      intendedCapitalLamports: BigInt(String(row.intended_capital_lamports)),
      intendedRange: (row.intended_range ?? {}) as Record<string, unknown>,
      state: "RESUME_OPEN",
      walletTruth: {
        tokenBalance: tokenBalance.toString(),
        refreshedAt: new Date().toISOString(),
      },
      payload: { reasonCodes: ["P6_PARTIAL_RESUME_WITHOUT_SECOND_SWAP"] },
      updatedAt: new Date().toISOString(),
    });
    const result = await executeAutonomousOpen({
      store: input.store,
      plan: open,
      signer: input.signer,
      config: input.config,
    });
    if (result.status === "RECONCILED")
      await input.store.upsertPartialEntryRecovery({
        planId,
        poolAddress: plan.poolAddress,
        ownerAddress: plan.ownerAddress,
        tokenMint: String(row.token_mint),
        fundingTransactionId: String(row.funding_transaction_id),
        fundingSignature: String(row.funding_signature),
        fundedAt: new Date(String(row.funded_at)).toISOString(),
        pairedTokenAmount: String(row.paired_token_amount),
        intendedCapitalLamports: BigInt(String(row.intended_capital_lamports)),
        intendedRange: (row.intended_range ?? {}) as Record<string, unknown>,
        state: "OPEN_RECOVERED",
        walletTruth: {
          tokenBalance: tokenBalance.toString(),
          refreshedAt: new Date().toISOString(),
        },
        payload: { reasonCodes: ["P6_PARTIAL_RESUME_RECONCILED"] },
        updatedAt: new Date().toISOString(),
      });
    results.push({
      planId,
      action: result.status === "RECONCILED" ? "RESUME_OPEN" : "HOLD",
      reasonCodes: result.reasonCodes,
    });
  }
  return results;
}
function mutationCapital(plan: AutonomousPlan) {
  const intent = plan.planPayload.intent as Record<string, unknown> | undefined;
  const value = intent?.capitalLamports;
  try {
    return value === undefined ? 0n : BigInt(String(value));
  } catch {
    throw new Error("LPFORGE_P6_MUTATION_CAPITAL_INVALID");
  }
}
/** Receipt metadata is the accounting authority when available.  A temporary
 * RPC read failure never changes chain truth; the durable estimate is retained
 * and can be refreshed idempotently on a later reconciliation pass. */
async function confirmedTransactionFeeLamports(connection:Connection,signature:string):Promise<bigint|undefined>{
  const receipt=await loadConfirmedExecutionReceipt(connection,signature);
  return receipt.state==='CONFIRMED_SUCCESS'||receipt.state==='CONFIRMED_FAILURE'?receipt.feeLamports:undefined;
}
/** A finalized failed Solana transaction has no successful protocol effect,
 * but it did land and consume a fee. Recovery must persist that exact receipt
 * before it retires or replaces the child; it must never call it expired. */
async function persistConfirmedFailedTransactionCost(input:{store:Pick<Phase1Store,'insertPositionCashflow'>;connection:Connection;plan:AutonomousPlan;positionAddress:string;signature:string;transactionId:string;observedAt:string}):Promise<boolean>{
  const receipt=await loadConfirmedExecutionReceipt(input.connection,input.signature);
  if(receipt.state!=='CONFIRMED_FAILURE'||receipt.feeLamports===undefined)return false;
  await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:tx-cost:${input.transactionId}`,positionAddress:input.positionAddress,planId:input.plan.planId,flowType:'TX_COST',observedAt:input.observedAt,lamports:receipt.feeLamports,payload:{source:'CONFIRMED_FAILED_CHAIN_RECEIPT',signature:input.signature,transactionId:input.transactionId,chainLanded:true,protocolEffect:'FAILED'}});
  return true;
}
/** Claim recovery is deliberately action-scoped.  An expired signature whose
 * status was read successfully and whose blockhash is past validity has no
 * chain effect; it must retire that CLAIM without authorizing a replacement.
 * UNKNOWN remains blocking. */
export function assessExpiredClaimRecovery(input:{signaturePresent:boolean;signatureStatusReadUnknown:boolean;confirmationStatus:"PROCESSED"|"CONFIRMED"|"FINALIZED"|"EXPIRED"|"FAILED"|"UNKNOWN"}){
  if(!input.signaturePresent)return{terminal:false,reasonCodes:['P6_CLAIM_RECOVERY_SIGNATURE_MISSING']};
  if(input.signatureStatusReadUnknown)return{terminal:false,reasonCodes:['P6_CLAIM_RECOVERY_SIGNATURE_STATUS_UNKNOWN']};
  if(input.confirmationStatus==='EXPIRED')return{terminal:true,terminalKind:'EXPIRED_NO_EFFECT' as const,reasonCodes:['P6_CLAIM_EXPIRED_NO_CHAIN_EFFECT']};
  if(input.confirmationStatus==='FAILED')return{terminal:true,terminalKind:'CONFIRMED_FAILED' as const,reasonCodes:['P6_CLAIM_FAILED_CONFIRMED_NO_PROTOCOL_EFFECT']};
  return{terminal:false,reasonCodes:['P6_CLAIM_RECOVERY_CHAIN_EFFECT_UNRESOLVED']};
}
/**
 * A claim's receipt is the only authority for its cashflow.  This helper is
 * shared by normal terminal-close execution and recovery so both paths use
 * the same signature-bound idempotency key.
 */
async function persistConfirmedClaimReceipt(input:{store:Phase1Store;connection:Connection;plan:AutonomousPlan;positionAddress:string;signature:string;transactionId:string;observedAt:string;source:"CONFIRMED_CLAIM_RECEIPT_RECOVERY"|"CONFIRMED_TERMINAL_CLAIM_RECEIPT"}):Promise<{ok:boolean;reasonCodes:string[]}>{
  const receipt=await loadConfirmedExecutionReceipt(input.connection,input.signature);
  if(receipt.state!=='CONFIRMED_SUCCESS')return{ok:false,reasonCodes:[`P6_CLAIM_RECEIPT_${receipt.state}`]};
  const effects=deriveTransactionAssetEffects(receipt,{ownerAddress:input.plan.ownerAddress,...(receipt.staticAccountKeys[0]?{feePayerAddress:receipt.staticAccountKeys[0]}:{})});
  for(const effect of effects.tokenEffects.filter(effect=>effect.direction==='IN'&&effect.deltaRaw>0n)){
    const cashflowId=`${input.plan.planId}:claim-token:${input.transactionId}:${effect.mint}:${effect.accountAddress}`;
    await input.store.insertPositionCashflow({cashflowId,positionAddress:input.positionAddress,planId:input.plan.planId,flowType:'FEE_CLAIM',observedAt:input.observedAt,tokenMint:effect.mint,tokenAmountRaw:effect.deltaRaw.toString(),payload:{source:input.source,signature:input.signature,transactionId:input.transactionId,effectClassification:effect.classification}});
    if(effect.mint!==WSOL_MINT)await recordPositionTokenXLot({store:input.store,connection:input.connection,plan:input.plan,positionAddress:input.positionAddress,tokenMint:effect.mint,sourceEvent:'FEE_CLAIM',sourceCashflowId:cashflowId,rawAmount:effect.deltaRaw,observedAt:input.observedAt,signature:input.signature});
  }
  const native=(effects.nativeWalletDeltaLamports??0n)+(receipt.feeLamports??0n);
  if(native>0n)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:claim-native-sol:${input.transactionId}`,positionAddress:input.positionAddress,planId:input.plan.planId,flowType:'FEE_CLAIM',observedAt:input.observedAt,lamports:native,tokenMint:WSOL_MINT,tokenAmountRaw:native.toString(),payload:{source:input.source,signature:input.signature,transactionId:input.transactionId,receiptFeeLamports:(receipt.feeLamports??0n).toString(),classificationState:effects.classificationState,reasonCodes:effects.reasonCodes}});
  return{ok:true,reasonCodes:effects.reasonCodes};
}
/**
 * PositionV2 rent is an attributable lifecycle asset, not an inferred owner
 * wallet delta. The closing receipt must prove that the exact position
 * account fell from a positive lamport balance to zero.
 */
/** Persist the native SOL component of a confirmed REMOVE receipt. */
async function persistConfirmedCloseNativeWithdrawal(input:{
  store:Pick<Phase1Store,"insertPositionCashflow">;
  connection:Connection;
  plan:AutonomousPlan;
  positionAddress:string;
  signature:string;
  transactionId:string;
  observedAt?:string;
}):Promise<{ok:true;lamports:bigint}|{ok:false;reasonCodes:string[]}>{
  const receipt=await loadConfirmedExecutionReceipt(input.connection,input.signature);
  if(receipt.state!=="CONFIRMED_SUCCESS")return{ok:false,reasonCodes:[`P6_CLOSE_NATIVE_WITHDRAWAL_RECEIPT_${receipt.state}`]};
  const ownerIndex=receipt.resolvedAccountKeys.indexOf(input.plan.ownerAddress),before=ownerIndex>=0?receipt.preBalancesLamports[ownerIndex]:undefined,after=ownerIndex>=0?receipt.postBalancesLamports[ownerIndex]:undefined;
  if(ownerIndex<0||before===undefined||after===undefined)return{ok:false,reasonCodes:["P6_CLOSE_NATIVE_WITHDRAWAL_OWNER_UNPROVEN"]};
  const gross=after-before+(receipt.feeLamports??0n);
  if(gross<0n)return{ok:false,reasonCodes:["P6_CLOSE_NATIVE_WITHDRAWAL_NEGATIVE"]};
  if(gross>0n)await input.store.insertPositionCashflow({
    cashflowId:`${input.plan.planId}:close-native-withdrawal:${input.transactionId}`,
    positionAddress:input.positionAddress,
    planId:input.plan.planId,
    flowType:"CLOSE_WITHDRAWAL",
    observedAt:input.observedAt??new Date().toISOString(),
    lamports:gross,
    payload:{source:"CONFIRMED_REMOVE_RECEIPT_OWNER_NATIVE_DELTA",transactionSignature:input.signature,transactionId:input.transactionId,ownerAddress:input.plan.ownerAddress,preBalanceLamports:before.toString(),postBalanceLamports:after.toString(),transactionFeeLamports:(receipt.feeLamports??0n).toString()},
  });
  return{ok:true,lamports:gross};
}
async function persistConfirmedPositionRentRecovery(input:{
  store:Pick<Phase1Store,"insertPositionCashflow">;
  connection:Connection;
  plan:AutonomousPlan;
  positionAddress:string;
  signature:string;
  transactionId:string;
  observedAt?:string;
}):Promise<{ok:true;lamports:bigint}|{ok:false;reasonCodes:string[]}>{
  const receipt=await loadConfirmedExecutionReceipt(input.connection,input.signature);
  if(receipt.state!=="CONFIRMED_SUCCESS")return{ok:false,reasonCodes:[`P6_CLOSE_POSITION_RENT_RECEIPT_${receipt.state}`]};
  const index=receipt.resolvedAccountKeys.indexOf(input.positionAddress),before=index>=0?receipt.preBalancesLamports[index]:undefined,after=index>=0?receipt.postBalancesLamports[index]:undefined;
  if(index<0||before===undefined||after===undefined||before<=0n||after!==0n)return{ok:false,reasonCodes:["P6_CLOSE_POSITION_RENT_RECOVERY_UNPROVEN"]};
  const observedAt=input.observedAt??new Date().toISOString();
  await input.store.insertPositionCashflow({
    cashflowId:`${input.plan.planId}:position-rent-recovery:${input.transactionId}`,
    positionAddress:input.positionAddress,
    planId:input.plan.planId,
    flowType:"RENT_RECOVERY",
    observedAt,
    lamports:before,
    payload:{
      source:"CONFIRMED_POSITION_ACCOUNT_CLOSE_RECEIPT",
      transactionSignature:input.signature,
      transactionId:input.transactionId,
      positionAddress:input.positionAddress,
      preBalanceLamports:before.toString(),
      postBalanceLamports:after.toString(),
      transactionFeeLamports:(receipt.feeLamports??0n).toString(),
    },
  });
  return{ok:true,lamports:before};
}

const settlementSolInFlowTypes=new Set(["FEE_CLAIM","REWARD_CLAIM","REDUCE_WITHDRAWAL","CLOSE_WITHDRAWAL","SWAP_PROCEEDS","RENT_RECOVERY"]);
const settlementSolOutFlowTypes=new Set(["OPEN_CONTRIBUTION","ENTRY_BASIS_CORRECTION","ADD_CONTRIBUTION","SWAP_COST","TX_COST","RENT_LOCK"]);
function settlementFlowAmount(flow:LifecycleSettlementInput["cashflows"][number]):bigint|undefined{
  return flow.lamports??(flow.tokenMint===WSOL_MINT&&flow.tokenAmountRaw!==undefined?BigInt(flow.tokenAmountRaw):undefined);
}
function settlementFlowSignature(flow:LifecycleSettlementInput["cashflows"][number]):string|undefined{
  const payload=flow.payload;
  const signature=payload?.transactionSignature??payload?.signature;
  return typeof signature==='string'?signature:undefined;
}
/**
 * A terminal account-close successor may finalize a receipt first recorded by
 * its root close plan. Preserve both immutable raw cashflow records, but use
 * a single receipt/type/mint/amount fact for terminal economic accounting.
 * This is deliberately narrow: ordinary repeated claims have distinct
 * signatures and remain distinct income.
 */
export function canonicalizeTerminalSettlementCashflows<T extends Pick<LifecycleSettlementInput["cashflows"][number],"flowType"|"lamports"|"tokenMint"|"tokenAmountRaw"|"payload">>(cashflows:readonly T[]):T[]{
  const seen=new Set<string>();
  return cashflows.filter(flow=>{
    if(!["FEE_CLAIM","REWARD_CLAIM","CLOSE_WITHDRAWAL"].includes(flow.flowType))return true;
    const candidateSignature=flow.payload?.transactionSignature??flow.payload?.signature,
      signature=typeof candidateSignature==='string'?candidateSignature:undefined;
    if(!signature)return true;
    const amount=flow.lamports?.toString()??`${flow.tokenMint??""}:${flow.tokenAmountRaw??""}`,
      key=`${flow.flowType}:${signature}:${flow.tokenMint??""}:${amount}`;
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}
/**
 * Independently recomputes terminal CLOSE-plan SOL effects from confirmed RPC
 * receipts.  It intentionally does not trust the lifecycle cashflow total as
 * proof: every receipt-derived effect must have a signature-bound cashflow.
 */
export async function reconcileTerminalSettlementChainEffects(input:{connection:Connection;plan:AutonomousPlan;positionAddress:string;settlementInput:Omit<LifecycleSettlementInput,"positionAbsent"|"positionCheckedAt"|"positionCheckedSlot">}):Promise<{ok:boolean;reasonCodes:string[];chainSolInLamports:bigint;chainSolOutLamports:bigint;dbSolInLamports:bigint;dbSolOutLamports:bigint;payload:Record<string,unknown>}>{
  const reasons:string[]=[];
  // A terminalization successor contributes only the final account-close
  // receipt.  Reconciliation must therefore cover every CLOSE-plan child in
  // the same lifecycle, not only the plan that happened to finalize it.
  const allTerminalTransactions=input.settlementInput.transactions.filter(tx=>tx.planRole==='CLOSE');
  // `FAILED_FINAL`/`PROVEN_NOT_LANDED` are durable terminal protocol-action
  // dispositions. A finalized FAILED transaction can still consume its
  // transaction fee, while PROVEN_NOT_LANDED has no chain effect. Neither is
  // a confirmed successful protocol receipt.
  const terminalTransactions=allTerminalTransactions.filter(tx=>tx.state==='CONFIRMED'||tx.state==='FAILED_FINAL');
  for(const transaction of allTerminalTransactions)
    if(transaction.state!=='CONFIRMED'&&transaction.state!=='FAILED_FINAL'&&transaction.state!=='PROVEN_NOT_LANDED')
      reasons.push(`SETTLEMENT_CHAIN_RECEIPT_UNAVAILABLE:${transaction.transactionId}`);
  let chainSolInLamports=0n,chainSolOutLamports=0n,dbSolInLamports=0n,dbSolOutLamports=0n;
  const closePlanIds=new Set(allTerminalTransactions.map(transaction=>transaction.planId));
  const closeFlows=input.settlementInput.cashflows.filter(flow=>closePlanIds.has(flow.planId));
  for(const flow of closeFlows){
    const amount=settlementFlowAmount(flow);if(amount===undefined)continue;
    if(settlementSolInFlowTypes.has(flow.flowType))dbSolInLamports+=amount;
    if(settlementSolOutFlowTypes.has(flow.flowType))dbSolOutLamports+=amount;
  }
  const steps:Array<Record<string,unknown>>=[];
  const exact=(flowType:string,signature:string,amount:bigint)=>closeFlows.some(flow=>flow.flowType===flowType&&settlementFlowSignature(flow)===signature&&settlementFlowAmount(flow)===amount);
  for(const transaction of terminalTransactions){
    if(!transaction.signature){reasons.push(`SETTLEMENT_CHAIN_RECEIPT_UNAVAILABLE:${transaction.transactionId}`);continue;}
    const receipt=await loadConfirmedExecutionReceipt(input.connection,transaction.signature);
    if(transaction.state==='FAILED_FINAL'){
      if(receipt.state!=="CONFIRMED_FAILURE"){reasons.push(`SETTLEMENT_CHAIN_FAILED_RECEIPT_${receipt.state}:${transaction.transactionId}`);continue;}
      const txFee=receipt.feeLamports??0n;
      chainSolOutLamports+=txFee;
      if(!exact("TX_COST",transaction.signature,txFee))reasons.push(`SETTLEMENT_CHAIN_FAILED_TX_COST_MISSING:${transaction.transactionId}`);
      steps.push({transactionId:transaction.transactionId,kind:transaction.kind??"UNKNOWN",signature:transaction.signature,feeLamports:txFee.toString(),protocolEffect:'FAILED'});
      continue;
    }
    if(receipt.state!=="CONFIRMED_SUCCESS"){reasons.push(`SETTLEMENT_CHAIN_RECEIPT_${receipt.state}:${transaction.transactionId}`);continue;}
    const txFee=receipt.feeLamports??0n;
    chainSolOutLamports+=txFee;
    if(!exact("TX_COST",transaction.signature,txFee))reasons.push(`SETTLEMENT_CHAIN_TX_COST_MISSING:${transaction.transactionId}`);
    const kind=transaction.kind??"UNKNOWN";
    if(kind==='METEORA_CLAIM'){
      const ownerIndex=receipt.resolvedAccountKeys.indexOf(input.plan.ownerAddress),pre=ownerIndex>=0?receipt.preBalancesLamports[ownerIndex]:undefined,post=ownerIndex>=0?receipt.postBalancesLamports[ownerIndex]:undefined;
      if(pre===undefined||post===undefined){reasons.push(`SETTLEMENT_CHAIN_CLAIM_OWNER_UNPROVEN:${transaction.transactionId}`);continue;}
      const gross=post-pre+txFee;
      if(gross<0n){reasons.push(`SETTLEMENT_CHAIN_CLAIM_NEGATIVE:${transaction.transactionId}`);continue;}
      chainSolInLamports+=gross;
      if(gross>0n&&!exact("FEE_CLAIM",transaction.signature,gross))reasons.push(`SETTLEMENT_CHAIN_TERMINAL_CLAIM_MISSING:${transaction.transactionId}`);
      const effects=deriveTransactionAssetEffects(receipt,{ownerAddress:input.plan.ownerAddress,...(receipt.staticAccountKeys[0]?{feePayerAddress:receipt.staticAccountKeys[0]}:{})}),wsolClaim=effects.tokenEffects.filter(effect=>effect.direction==='IN'&&effect.mint===WSOL_MINT&&effect.deltaRaw>0n).reduce((total,effect)=>total+effect.deltaRaw,0n);
      chainSolInLamports+=wsolClaim;
      if(wsolClaim>0n&&!closeFlows.some(flow=>flow.flowType==='FEE_CLAIM'&&settlementFlowSignature(flow)===transaction.signature&&flow.tokenMint===WSOL_MINT&&flow.tokenAmountRaw===wsolClaim.toString()))reasons.push(`SETTLEMENT_CHAIN_TERMINAL_WSOL_CLAIM_MISSING:${transaction.transactionId}`);
      steps.push({transactionId:transaction.transactionId,kind,signature:transaction.signature,feeLamports:txFee.toString(),grossClaimLamports:gross.toString(),wsolClaimLamports:wsolClaim.toString()});
      continue;
    }
    if(kind==='METEORA_REMOVE'){
      const ownerIndex=receipt.resolvedAccountKeys.indexOf(input.plan.ownerAddress),pre=ownerIndex>=0?receipt.preBalancesLamports[ownerIndex]:undefined,post=ownerIndex>=0?receipt.postBalancesLamports[ownerIndex]:undefined;
      if(pre===undefined||post===undefined){reasons.push(`SETTLEMENT_CHAIN_REMOVE_OWNER_UNPROVEN:${transaction.transactionId}`);continue;}
      const gross=post-pre+txFee;
      if(gross<0n){reasons.push(`SETTLEMENT_CHAIN_REMOVE_NEGATIVE:${transaction.transactionId}`);continue;}
      chainSolInLamports+=gross;
      if(gross>0n&&!exact("CLOSE_WITHDRAWAL",transaction.signature,gross))reasons.push(`SETTLEMENT_CHAIN_REMOVE_WITHDRAWAL_MISSING:${transaction.transactionId}`);
      steps.push({transactionId:transaction.transactionId,kind,signature:transaction.signature,feeLamports:txFee.toString(),grossNativeWithdrawalLamports:gross.toString()});
      continue;
    }
    if(kind==='JUPITER_UNWIND'){
      const flow=closeFlows.find(candidate=>candidate.flowType==='SWAP_PROCEEDS'&&settlementFlowSignature(candidate)===transaction.signature);
      const payload=flow?.payload??{},inputMint=typeof payload.inputMint==='string'?payload.inputMint:undefined,inputAmountRaw=typeof payload.inputAmountRaw==='string'?BigInt(payload.inputAmountRaw):undefined;
      if(!flow||!inputMint||inputAmountRaw===undefined){reasons.push(`SETTLEMENT_CHAIN_UNWIND_CASHFLOW_MISSING:${transaction.transactionId}`);continue;}
      const effects=deriveTransactionAssetEffects(receipt,{ownerAddress:input.plan.ownerAddress,...(receipt.staticAccountKeys[0]?{feePayerAddress:receipt.staticAccountKeys[0]}:{}),inputMint,outputMint:WSOL_MINT,jupiterProgramIds:[JUPITER_SWAP_V6_PROGRAM_ID],positionAddress:input.positionAddress});
      const result=deriveCloseUnwindSettlement({receipt,effects,ownerAddress:input.plan.ownerAddress,inputMint,inputAmountRaw,outputMint:WSOL_MINT,jupiterProgramIds:[JUPITER_SWAP_V6_PROGRAM_ID]});
      if(result.state!=="SETTLED"||result.swapProceedsLamports===undefined){reasons.push(...result.reasonCodes.map(code=>`${code}:${transaction.transactionId}`));continue;}
      chainSolInLamports+=result.swapProceedsLamports;
      if(settlementFlowAmount(flow)!==result.swapProceedsLamports)reasons.push(`SETTLEMENT_CHAIN_UNWIND_PROCEEDS_MISMATCH:${transaction.transactionId}`);
      steps.push({transactionId:transaction.transactionId,kind,signature:transaction.signature,feeLamports:txFee.toString(),swapProceedsLamports:result.swapProceedsLamports.toString()});
      continue;
    }
    if(kind==='METEORA_CLOSE'){
      const index=receipt.resolvedAccountKeys.indexOf(input.positionAddress),before=index>=0?receipt.preBalancesLamports[index]:undefined,after=index>=0?receipt.postBalancesLamports[index]:undefined;
      if(before===undefined||after!==0n||before<=0n){reasons.push(`SETTLEMENT_CHAIN_RENT_UNPROVEN:${transaction.transactionId}`);continue;}
      chainSolInLamports+=before;
      if(!exact("RENT_RECOVERY",transaction.signature,before))reasons.push(`SETTLEMENT_CHAIN_RENT_RECOVERY_MISSING:${transaction.transactionId}`);
      steps.push({transactionId:transaction.transactionId,kind,signature:transaction.signature,feeLamports:txFee.toString(),rentRecoveryLamports:before.toString()});
      continue;
    }
    reasons.push(`SETTLEMENT_CHAIN_EFFECT_KIND_UNSUPPORTED:${kind}:${transaction.transactionId}`);
  }
  if(!terminalTransactions.length)reasons.push("SETTLEMENT_CHAIN_CLOSE_TRANSACTIONS_MISSING");
  const chainNet=chainSolInLamports-chainSolOutLamports,dbNet=dbSolInLamports-dbSolOutLamports;
  if(chainNet!==dbNet)reasons.push("SETTLEMENT_CHAIN_CASHFLOW_TOTAL_MISMATCH");
  return{ok:reasons.length===0,reasonCodes:[...new Set(reasons)].sort(),chainSolInLamports,chainSolOutLamports,dbSolInLamports,dbSolOutLamports,payload:{implementation:'external-settlement-reconciliation-v1',steps,chainNetSolLamports:chainNet.toString(),dbNetSolLamports:dbNet.toString(),differenceLamports:(chainNet-dbNet).toString()}};
}
function mutationRange(
  plan: AutonomousPlan,
  fallback?: Record<string, unknown>,
) {
  const intent = plan.planPayload.intent as Record<string, unknown> | undefined,
    lower = Number(intent?.lowerBinId ?? fallback?.fromBinId),
    upper = Number(intent?.upperBinId ?? fallback?.toBinId);
  if (!Number.isInteger(lower) || !Number.isInteger(upper) || lower > upper)
    throw new Error("LPFORGE_P6_MUTATION_RANGE_REQUIRED");
  return { lower, upper };
}
/**
 * Close and reduce intents carry no range: the operator dispatches them with
 * a position address only. When the intent/step carries a valid range it
 * wins; otherwise the position's own chain range is the single source of
 * truth for a drain.
 */
async function chainMutationRange(input: {
  plan: AutonomousPlan;
  stepMetadata?: Record<string, unknown>;
  rpcUrl: string;
  programId: string;
  positionAddress: string;
}): Promise<{ lower: number; upper: number }> {
  const intent = input.plan.planPayload.intent as
      | Record<string, unknown>
      | undefined,
    lower = Number(intent?.lowerBinId ?? input.stepMetadata?.fromBinId),
    upper = Number(intent?.upperBinId ?? input.stepMetadata?.toBinId);
  if (Number.isInteger(lower) && Number.isInteger(upper) && lower <= upper)
    return { lower, upper };
  const truth = await createMeteoraReadAdapter({
    rpcUrl: input.rpcUrl,
    cluster: "mainnet-beta",
    programId: input.programId,
    priority:'P0_EXECUTION_CRITICAL',
  }).getPositionV2(input.plan.poolAddress, input.positionAddress);
  const chainLower = Number(truth.lowerBinId),
    chainUpper = Number(truth.upperBinId);
  if (
    !Number.isInteger(chainLower) ||
    !Number.isInteger(chainUpper) ||
    chainLower > chainUpper
  )
    throw new Error("LPFORGE_P6_MUTATION_RANGE_REQUIRED");
  return { lower: chainLower, upper: chainUpper };
}
function legacyBuilt(value: BuiltMeteoraTransaction) {
  if (!(value.transaction instanceof Transaction))
    throw new Error("LPFORGE_P6_MUTATION_TRANSACTION_UNSUPPORTED");
  return value.transaction;
}
async function executeMeteoraMutation(input: {
  store: Phase1Store;
  plan: AutonomousPlan;
  signer: MainnetSignerBackend;
  config: LiveWorkerConfig;
  built: BuiltMeteoraTransaction;
  action: Exclude<AutonomousPlanAction, "OPEN" | "RESHAPE" | "REBALANCE">;
  deferCompletion?: boolean;
  /** Persist the parent settlement's sent state before waiting for chain truth. */
  afterSubmit?: (submitted: { signature: string }) => Promise<void>;
  /** Runs after confirmation but before the plan can be marked complete. */
  afterConfirmed?: (submitted: { signature: string; estimatedFeeLamports: bigint }) => Promise<void>;
}): Promise<LiveWorkerResult> {
  const transaction = legacyBuilt(input.built),
    connection = createGovernedConnection({rpcUrl:input.config.rpcUrl,priority:'P0_EXECUTION_CRITICAL'}),
    capital = mutationCapital(input.plan),
    now = new Date().toISOString();
  // From this point onward a submission may have reached the cluster.  A
  // later local/database/reconciliation error must never rewrite that fact as
  // FAILED/transactionSubmitted=false.
  let submissionAttempted=false,submissionStatusUnknown=false;
  try {
    if (input.signer.publicKeyAddress !== input.plan.ownerAddress)
      throw new Error("LPFORGE_P6_OWNER_SIGNER_PLAN_MISMATCH");
    await input.store.transitionAutonomousPlan({
      planId: input.plan.planId,
      state: "BUILDING",
      at: now,
      payload: { action: input.action, builder: input.built.builder },
    });
    const lease = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = lease.blockhash;
    transaction.lastValidBlockHeight = lease.lastValidBlockHeight;
    transaction.feePayer = new PublicKey(input.plan.ownerAddress);
    await input.store.transitionAutonomousPlan({
      planId: input.plan.planId,
      state: "BUILT",
      at: new Date().toISOString(),
      payload: { transactionId: input.built.metadata.transactionId ?? null },
    });
    const simulatedAt = new Date().toISOString(),
      simulation = await simulateExecutionTransaction({
        authority: authority(
          "MAINNET_BUILD_SIMULATE",
          simulatedAt,
          input.config.riskPermitTtlMs,
        ),
        transactionId: input.built.metadata.transactionId as string,
        transaction,
        transport: createWeb3SimulationTransport(connection),
        simulatedAt,
        freshnessMs: input.config.simulationFreshnessMs,
      });
    await input.store.insertExecutionSimulation({
      transactionId: input.built.metadata.transactionId as string,
      simulatedAt: simulation.simulatedAt,
      freshUntil: simulation.simulationFreshUntil,
      ok: simulation.ok,
      ...(simulation.unitsConsumed !== undefined
        ? { unitsConsumed: simulation.unitsConsumed }
        : {}),
      logs: simulation.logs,
      ...(simulation.error ? { error: simulation.error } : {}),
      payload: { planId: input.plan.planId, action: input.action },
    });
    await input.store.transitionAutonomousPlan({
      planId: input.plan.planId,
      state: "SIMULATED",
      at: new Date().toISOString(),
      payload: { ok: simulation.ok },
    });
    const riskPlanExpiresAt=mutationRiskPlanExpiry({
      action:input.action,
      ...(input.plan.positionAddress?{positionAddress:input.plan.positionAddress}:{}),
      planExpiresAt:input.plan.expiresAt,
      now,
      protectivePermitTtlMs:input.config.riskPermitTtlMs,
    }),fee = estimateExecutionFee({
        signatureCount: 1,
        computeUnitLimit: simulation.recommendedComputeUnitLimit ?? 0,
        computeUnitPriceMicroLamports: 0n,
      }),
      // A one-lamport fallback makes ordinary CLOSE/CLAIM mathematically
      // impossible. Every mutation plan carries the remaining position basis;
      // legacy rows without one fail closed before signing rather than using a
      // fabricated denominator.
      cost = assessExecutionCost(fee, capital, {
        maxAbsoluteFeeLamports: input.config.maxFeeLamports,
        maxFeeFractionOfCapital: input.config.maxFeeFraction,
      }),
      risk = governExecutionRisk(
        {
          action: input.action,
          planId: input.plan.planId,
          now: new Date().toISOString(),
          thesisExpiresAt: input.plan.expiresAt,
          planExpiresAt: riskPlanExpiresAt,
          simulationOk: simulation.ok,
          simulationFreshUntil: simulation.simulationFreshUntil,
          walletTruthConsistent: true,
          protocolCompatible: true,
          rpcHealthy: true,
          referenceDivergenceBps: 0,
          activeBinId: 0,
          intendedCenterBinId: 0,
          costApproved: cost.approved,
          reconciliationRequired: false,
          globalKillSwitch: false,
          liquidityCollapse: false,
        },
        {
          maxReferenceDivergenceBps: 100,
          maxActiveBinDriftBins: 100000,
          approvalTtlMs: input.config.riskPermitTtlMs,
          allowEmergencyCostOverride: input.action === "EMERGENCY_CLOSE",
        },
      );
    if (risk.decision !== "APPROVE" || !risk.permitId || !risk.expiresAt) {
      const sequencedProtectiveClose =
        (input.action === "CLOSE" || input.action === "EMERGENCY_CLOSE") &&
        input.plan.positionAddress !== undefined &&
        closeSettlementStage(input.plan) !== undefined;
      // Earlier confirmed close children are parent-level chain truth.  A
      // temporary pre-sign block for the *next* protective child must remain
      // reconciliation debt, not terminalize the shared journal and erase the
      // ability to retry after fresh simulation/RPC facts arrive.
      if (sequencedProtectiveClose) {
        await input.store.transitionAutonomousPlan({
          planId: input.plan.planId,
          state: "RECONCILIATION_REQUIRED",
          at: new Date().toISOString(),
          reasonCodes: ["P6_PROTECTIVE_CLOSE_CHILD_RISK_RETRY", ...risk.reasonCodes],
          payload: {
            action: input.action,
            stage: closeSettlementDispatch(input.plan).stage ?? "CLOSE_UNKNOWN_STAGE",
            protectiveChildRiskRetry: true,
          },
        });
        return {
          status: "UNKNOWN",
          planId: input.plan.planId,
          reasonCodes: ["P6_PROTECTIVE_CLOSE_CHILD_RISK_RETRY", ...risk.reasonCodes],
          // An earlier child is already confirmed.  This reports parent-level
          // economic truth and prevents upper layers from treating the close
          // workflow as an unsent, safely disposable plan.
          transactionSubmitted: true,
        };
      }
      await input.store.transitionAutonomousPlan({
        planId: input.plan.planId,
        state: "BLOCKED",
        at: new Date().toISOString(),
        reasonCodes: risk.reasonCodes,
        payload: { action: input.action },
      });
      return {
        status: "BLOCKED",
        planId: input.plan.planId,
        reasonCodes: risk.reasonCodes,
        transactionSubmitted: false,
      };
    }
    await input.store.insertExecutionRiskPermit({
      permitId: risk.permitId,
      planId: input.plan.planId,
      decision: risk.decision,
      issuedAt: risk.issuedAt,
      expiresAt: risk.expiresAt,
      reasonCodes: risk.reasonCodes,
      payload: { action: input.action, autonomous: true },
    });
    await input.store.transitionAutonomousPlan({
      planId: input.plan.planId,
      state: "RISK_APPROVED",
      at: new Date().toISOString(),
      payload: { permitId: risk.permitId },
    });
    const transactionId = String(input.built.metadata.transactionId),
      signedAt = new Date().toISOString(),
      open = input.action === "CLOSE" || input.action === "EMERGENCY_CLOSE",
      mutationTicket = ticket(
        input.plan,
        capital,
        signedAt,
        input.config.riskPermitTtlMs,
        executionMaxOpenPositions(input.config),
        input.action,
      ),
      mutationAuthority = {
        phase: "P6" as const,
        cluster: "mainnet-beta" as const,
        level: (open ? "MAINNET_CANARY_CLOSE" : "MAINNET_CANARY_MANAGE") as
          | "MAINNET_CANARY_CLOSE"
          | "MAINNET_CANARY_MANAGE",
        liveExecution: true as const,
        canaryOnly: true as const,
        issuedAt: signedAt,
        expiresAt: mutationTicket.expiresAt,
        ticketId: mutationTicket.ticketId,
        reasonCodes: [`P6_AUTONOMOUS_${input.action}`],
      },
      envelope = createLegacyMainnetEnvelope(transaction);
    await input.store.transitionAutonomousPlan({
      planId: input.plan.planId,
      state: "SIGNING",
      at: signedAt,
      payload: { transactionId },
    });
    await recordJournal(input.store,input.plan,"SIGNING",{action:input.action,transactionId});
    const submitInput = {
      authority: mutationAuthority,
      ticket: mutationTicket,
      transactionId,
      idempotencyKey: `${input.plan.idempotencyKey}:${transactionId}`,
      requiredSignerAddresses: input.built.requiredSignerAddresses,
      backend: input.signer,
      envelope,
      phase5RiskDecision: risk,
      lease,
      ledger: ledger(input.store),
      transport: createWeb3SubmissionTransport(connection),
      submittedAt: signedAt,
      onSigned: async ({ signerBackendId }: { signerBackendId: string }) =>
        recordJournal(input.store,input.plan,"SIGNED",{action:input.action,transactionId,signerBackendId}),
      onSubmissionUnknown: async ({ error,signature }: { error: string;signature?:string }) => {
        submissionStatusUnknown=true;
        await recordJournal(input.store,input.plan,"UNKNOWN_SUBMISSION",{action:input.action,transactionId,error},signature);
      },
    };
    const submitted = open
      ? await executeMainnetCanaryClose(submitInput)
      : await executeMainnetCanaryManage(submitInput);
    submissionAttempted=true;
    await recordJournal(
      input.store,
      input.plan,
      "SUBMITTED",
      { action: input.action, transactionId },
      submitted.signature,
    );
    await input.store.transitionAutonomousPlan({
      planId: input.plan.planId,
      state: "SUBMITTED",
      at: new Date().toISOString(),
      payload: { signature: submitted.signature, transactionId },
    });
    if (input.afterSubmit) await input.afterSubmit({ signature: submitted.signature });
    const confirmation = await awaitConfirmation({
        connection,
        store: input.store,
        transactionId,
        idempotencyKey: input.plan.idempotencyKey,
        signature: submitted.signature,
        lease,
        pollMs: input.config.confirmPollMs,
        attempts: input.config.confirmAttempts,
      });
    if (!confirmation)
      return {
        status: "SUBMITTED",
        planId: input.plan.planId,
        reasonCodes: ["P6_CONFIRMATION_PENDING"],
        transactionSubmitted: true,
      };
    await recordJournal(
      input.store,
      input.plan,
      "CONFIRMED",
      { action: input.action, transactionId, confirmation: confirmation.status },
      submitted.signature,
    );
    await input.store.insertExecutionReconciliation({
      reconciliationId: `${input.plan.planId}:${transactionId}`,
      planId: input.plan.planId,
      observedAt: new Date().toISOString(),
      status: input.deferCompletion ? "UNKNOWN" : "MATCH",
      expected: {
        action: input.action,
        pool: input.plan.poolAddress,
        position: input.plan.positionAddress ?? null,
      },
      actual: { signature: submitted.signature },
      discrepancies: input.deferCompletion
        ? ["P6_SEQUENCE_CHAIN_TRUTH_PENDING"]
        : [],
      payload: {
        autonomous: true,
        deferredCompletion: Boolean(input.deferCompletion),
      },
    });
    // Persist the approved fee estimate for every confirmed child action,
    // including deferred CLOSE-settlement children. It is durable economic
    // evidence, not an excuse to send a transaction; a write failure here is
    // post-submit reconciliation debt.
    if (input.plan.positionAddress){
      const actualFee=await confirmedTransactionFeeLamports(connection,submitted.signature);
      await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:tx-cost:${transactionId}`,positionAddress:input.plan.positionAddress,planId:input.plan.planId,flowType:'TX_COST',observedAt:new Date().toISOString(),lamports:actualFee??fee.totalFeeLamports,payload:{signature:submitted.signature,transactionId,source:actualFee===undefined?'EXECUTION_FEE_ESTIMATE':'CHAIN_RECEIPT_META',...(actualFee===undefined?{estimatedLamports:fee.totalFeeLamports.toString()}:{})}});
    }
    if(input.afterConfirmed)await input.afterConfirmed({signature:submitted.signature,estimatedFeeLamports:fee.totalFeeLamports});
    if (input.deferCompletion)
      return {
        status: "RECONCILED",
        planId: input.plan.planId,
        reasonCodes: ["P6_SEQUENCE_CHAIN_TRUTH_PENDING"],
        transactionSubmitted: true,
      };
    // A confirmed close verifies the position actually vanished before the
    // plan completes. A still-present position is reconciliation debt the
    // operator must see, never a silent COMPLETED.
    if (
      (input.action === "CLOSE" || input.action === "EMERGENCY_CLOSE") &&
      input.plan.positionAddress
    ) {
      // RPC failure/timeout/decode failure is unknown chain truth, not proof
      // that the account was closed.  getAccountInfo=null is the only
      // positive absence result accepted for lifecycle closure.
      let positionGone=false,positionReadUnknown=false;
      try{positionGone=(await connection.getAccountInfo(new PublicKey(input.plan.positionAddress),"confirmed"))===null;}catch{positionReadUnknown=true;}
      await input.store.markOwnedPositionLifecycle({
        positionAddress: input.plan.positionAddress,
        lifecycleState: positionGone ? "CLOSED" : "RECONCILIATION_REQUIRED",
        reconciliationStatus: positionGone ? "MATCH" : positionReadUnknown?"UNKNOWN":"MISMATCH",
        lastPlanId: input.plan.planId,
        at: new Date().toISOString(),
        payload: {
          stage: "CLOSE_CHAIN_VERIFIED",
          signature: submitted.signature,
          positionGone,positionReadUnknown,
        },
      });
      if (!positionGone) {
        await input.store.transitionAutonomousPlan({
          planId: input.plan.planId,
          state: "RECONCILIATION_REQUIRED",
          at: new Date().toISOString(),
          reasonCodes: [positionReadUnknown?"P6_CLOSE_POSITION_READ_UNKNOWN":"P6_CLOSE_POSITION_STILL_PRESENT"],
          payload: { signature: submitted.signature },
        });
        return {
          status: "UNKNOWN",
          planId: input.plan.planId,
          reasonCodes: [positionReadUnknown?"P6_CLOSE_POSITION_READ_UNKNOWN":"P6_CLOSE_POSITION_STILL_PRESENT"],
          transactionSubmitted: true,
        };
      }
    }
    // A confirmed REDUCE rebases the owned cost basis so NAV and exit
    // economics track the position's real remaining capital.
    if (
      input.action === "REDUCE" &&
      input.plan.positionAddress &&
      capital > 0n
    ) {
      const reductionBps = Number(
        input.plan.intentPayload.reductionBps ??
          input.plan.steps[0]?.metadata?.bps ??
          0,
      );
      if (
        Number.isInteger(reductionBps) &&
        reductionBps >= 1 &&
        reductionBps <= 9999
      ) {
        const remainingCapitalLamports =
          (capital * BigInt(10_000 - reductionBps)) / 10_000n;
        await input.store.adjustOwnedPositionCapital({
          positionAddress: input.plan.positionAddress,
          capitalLamports: remainingCapitalLamports,
          at: new Date().toISOString(),
          payload: {
            planId: input.plan.planId,
            reductionBps,
            priorCapitalLamports: capital.toString(),
            remainingCapitalLamports: remainingCapitalLamports.toString(),
            signature: submitted.signature,
          },
        });
        // Principal realization is written by the REDUCE caller from actual
        // post-confirmation wallet deltas.  A capital-basis estimate is not a
        // cashflow and must never be used as economic PnL.
      }
    }
    await input.store.completeAutonomousPlan({
      planId: input.plan.planId,
      state: "COMPLETED",
      at: new Date().toISOString(),
      payload: { action: input.action, signature: submitted.signature },
    });
    return {
      status: "RECONCILED",
      planId: input.plan.planId,
      reasonCodes: [],
      transactionSubmitted: true,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "LPFORGE_P6_MUTATION_UNKNOWN";
    if(submissionAttempted||submissionStatusUnknown){
      await recordJournal(input.store,input.plan,"RECONCILIATION_REQUIRED",{action:input.action,error:reason,postSubmission:true});
      await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:"RECONCILIATION_REQUIRED",at:new Date().toISOString(),reasonCodes:["P6_MUTATION_POST_SUBMISSION_RECONCILIATION_REQUIRED"],payload:{action:input.action,error:reason,submissionAttempted:true}});
      return{status:"UNKNOWN",planId:input.plan.planId,reasonCodes:["P6_MUTATION_POST_SUBMISSION_RECONCILIATION_REQUIRED",reason],transactionSubmitted:true};
    }
    await input.store.completeAutonomousPlan({
      planId: input.plan.planId,
      state: "FAILED",
      at: new Date().toISOString(),
      payload: { action: input.action, error: reason },
    });
    return {
      status: "BLOCKED",
      planId: input.plan.planId,
      reasonCodes: [reason],
      transactionSubmitted: false,
    };
  }
}
/**
 * Reshape/rebalance is deliberately a two-stage economic lifecycle. The old
 * PositionV2 must disappear and the owner wallet must be freshly read before
 * a memory-only replacement signer is created. A crash between stages leaves
 * a durable reconciliation state; it never proceeds to a blind replacement.
 */
async function executeManagementReplacement(input: {
  store: Phase1Store;
  plan: AutonomousPlan;
  signer: MainnetSignerBackend;
  config: LiveWorkerConfig;
  pool: MeteoraOpenAddPoolLike & MeteoraRemoveClaimPoolLike;
  positionAddress: string;
}): Promise<LiveWorkerResult> {
  if(input.config.controlledCanary&&!input.config.controlledCanary.replacementOpenAllowed)
    throw new Error('LPFORGE_P6_CONTROLLED_CANARY_REPLACEMENT_OPEN_BLOCKED');
  const remove = input.plan.steps.find((step) => step.kind === "METEORA_CLOSE");
  const open = input.plan.steps.find((step) => step.kind === "METEORA_OPEN");
  if (!remove || !open)
    throw new Error("LPFORGE_P6_MANAGEMENT_SEQUENCE_MISSING");
  const adapter = createMeteoraReadAdapter({
    rpcUrl: input.config.rpcUrl,
    cluster: "mainnet-beta",
    programId: input.config.programId,
    priority:'P0_EXECUTION_CRITICAL',
  });
  const old = await adapter.getPositionV2(
    input.plan.poolAddress,
    input.positionAddress,
  );
  if (
    old.owner !== input.plan.ownerAddress ||
    old.pool !== input.plan.poolAddress
  )
    throw new Error("LPFORGE_P6_MANAGEMENT_OLD_POSITION_IDENTITY_MISMATCH");
  const range = {
    lower: Number(remove.metadata.fromBinId ?? old.lowerBinId),
    upper: Number(remove.metadata.toBinId ?? old.upperBinId),
  };
  if (
    !Number.isInteger(range.lower) ||
    !Number.isInteger(range.upper) ||
    range.lower > range.upper
  )
    throw new Error("LPFORGE_P6_MANAGEMENT_REMOVE_RANGE_REQUIRED");
  const removalConnection = createGovernedConnection({rpcUrl:input.config.rpcUrl,priority:'P0_EXECUTION_CRITICAL'}),
    poolFactBefore = await adapter.getPool(input.plan.poolAddress),
    [tokenXBeforeRemove,tokenYBeforeRemove]=await Promise.all([
      readWalletTokenBalance({connection:removalConnection,ownerAddress:input.plan.ownerAddress,mint:poolFactBefore.tokenXMint}),
      readWalletTokenBalance({connection:removalConnection,ownerAddress:input.plan.ownerAddress,mint:poolFactBefore.tokenYMint}),
    ]);
  await input.store.transitionAutonomousPlan({
    planId: input.plan.planId,
    state: "BUILDING",
    at: new Date().toISOString(),
    payload: { stage: "REMOVE_OLD", oldPositionAddress: input.positionAddress },
  });
  const built = await buildRemoveLiquidityTransactions(input.pool, {
    userAddress: input.plan.ownerAddress,
    positionAddress: input.positionAddress,
    fromBinId: range.lower,
    toBinId: range.upper,
    bps: 10_000,
    claimAndClose: true,
  });
  if (built.length !== 1)
    throw new Error(
      "LPFORGE_P6_MANAGEMENT_MULTI_TRANSACTION_REMOVE_UNSUPPORTED",
    );
  built[0]!.metadata.transactionId = remove.transactionId;
  const closePlan: AutonomousPlan = {
    ...input.plan,
    action: "CLOSE",
    planPayload: { ...input.plan.planPayload, intent: {} },
  };
  const closed = await executeMeteoraMutation({
    store: input.store,
    plan: closePlan,
    signer: input.signer,
    config: input.config,
    built: built[0]!,
    action: "CLOSE",
    deferCompletion: true,
  });
  if (closed.status !== "RECONCILED") return closed;
  // Only an explicit AccountInfo null proves removal.  A decoder/RPC error
  // is unknown truth and may not unlock a replacement position.
  let removed = false,
    removalReadUnknown = false;
  try {
    removed =
      (await removalConnection.getAccountInfo(
        new PublicKey(input.positionAddress),
        "confirmed",
      )) === null;
  } catch {
    removalReadUnknown = true;
  }
  if (!removed) {
    await input.store.markOwnedPositionLifecycle({
      positionAddress: input.positionAddress,
      lifecycleState: "RECONCILIATION_REQUIRED",
      reconciliationStatus: removalReadUnknown ? "UNKNOWN" : "MISMATCH",
      lastPlanId: input.plan.planId,
      at: new Date().toISOString(),
      payload: {
        stage: "AWAIT_REMOVE_RECONCILIATION",
        oldPositionStillExists: !removalReadUnknown,
        oldPositionReadUnknown: removalReadUnknown,
      },
    });
    await input.store.transitionAutonomousPlan({
      planId: input.plan.planId,
      state: "RECONCILIATION_REQUIRED",
      at: new Date().toISOString(),
      reasonCodes: [removalReadUnknown?"P6_MANAGEMENT_OLD_POSITION_READ_UNKNOWN":"P6_MANAGEMENT_OLD_POSITION_STILL_EXISTS"],
      payload: { stage: "AWAIT_REMOVE_RECONCILIATION" },
    });
    return {
      status: "BLOCKED",
      planId: input.plan.planId,
      reasonCodes: [removalReadUnknown?"P6_MANAGEMENT_OLD_POSITION_READ_UNKNOWN":"P6_MANAGEMENT_OLD_POSITION_STILL_EXISTS"],
      transactionSubmitted: true,
    };
  }
  const connection = removalConnection;
  const poolFact = await adapter.getPool(input.plan.poolAddress);
  const [tokenXAfterRemove,tokenYAfterRemove]=await Promise.all([
    readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:poolFact.tokenXMint}),
    readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:poolFact.tokenYMint}),
  ]),actualX=tokenXAfterRemove>tokenXBeforeRemove?tokenXAfterRemove-tokenXBeforeRemove:0n,
    actualY=tokenYAfterRemove>tokenYBeforeRemove?tokenYAfterRemove-tokenYBeforeRemove:0n;
  const walletTruth = {
    nativeLamports: await connection.getBalance(
      new PublicKey(input.plan.ownerAddress),
      "confirmed",
    ),
    tokenXAccounts: (
      await connection.getParsedTokenAccountsByOwner(
        new PublicKey(input.plan.ownerAddress),
        { mint: new PublicKey(poolFact.tokenXMint) },
        "confirmed",
      )
    ).value.length,
    tokenYAccounts: (
      await connection.getParsedTokenAccountsByOwner(
        new PublicKey(input.plan.ownerAddress),
        { mint: new PublicKey(poolFact.tokenYMint) },
        "confirmed",
      )
    ).value.length,
  };
  await input.store.markOwnedPositionLifecycle({
    positionAddress: input.positionAddress,
    lifecycleState: "CLOSED",
    reconciliationStatus: "MATCH",
    lastPlanId: input.plan.planId,
    at: new Date().toISOString(),
    payload: { stage: "REFRESH_WALLET_TRUTH", walletTruth,actualSettlement:{tokenXRaw:actualX.toString(),tokenYRaw:actualY.toString(),tokenXBeforeRemove:tokenXBeforeRemove.toString(),tokenYBeforeRemove:tokenYBeforeRemove.toString()} },
  });
  await input.store.transitionAutonomousPlan({
    planId: input.plan.planId,
    state: "RECONCILING",
    at: new Date().toISOString(),
    payload: {
      stage: "BUILD_REPLACEMENT",
      walletTruth,
      actualSettlement:{tokenXRaw:actualX.toString(),tokenYRaw:actualY.toString()},
      oldPositionAddress: input.positionAddress,
    },
  });
  const intent = input.plan.planPayload.intent as Record<string, unknown>;
  const replacement: AutonomousOpenPlan = {
    planId: input.plan.planId,
    intentId: input.plan.intentId,
    idempotencyKey: input.plan.idempotencyKey,
    poolAddress: input.plan.poolAddress,
    ownerAddress: input.plan.ownerAddress,
    thesisId: input.plan.thesisId,
    observedAt: input.plan.observedAt,
    expiresAt: input.plan.expiresAt,
    intentPayload: {
      ...input.plan.intentPayload,
      entryFunding: {
        totalPairedTokenRaw: actualX.toString(),
        solForLpLamports: actualY.toString(),
        orientation: String(
          input.plan.intentPayload.orientation ?? "REDEPLOYED",
        ),
        rebuildFromRemovedPosition: true,
        source:"WALLET_DELTA_AFTER_REMOVAL",
      },
    },
    planPayload: { ...input.plan.planPayload, intent },
    transactionId: open.transactionId,
    transactionMetadata: open.metadata,
  };
  const oldSettlementCashflowId=`${input.plan.planId}:reshape-old-x`,at=new Date().toISOString();
  if(actualX>0n){
    await input.store.insertPositionCashflow({cashflowId:oldSettlementCashflowId,positionAddress:input.positionAddress,planId:input.plan.planId,flowType:'CLOSE_WITHDRAWAL',observedAt:at,tokenMint:poolFact.tokenXMint,tokenAmountRaw:actualX.toString(),payload:{source:'WALLET_DELTA_RESHAPE',successorPlanId:input.plan.planId}});
    const supply=await connection.getTokenSupply(new PublicKey(poolFact.tokenXMint),'confirmed');
    await input.store.createPositionInventoryLot({lotId:`${input.plan.planId}:reshape-old-x`,createdEventId:`${input.plan.planId}:reshape-old-x-created`,positionAddress:input.positionAddress,planId:input.plan.planId,ownerAddress:input.plan.ownerAddress,poolAddress:input.plan.poolAddress,tokenMint:poolFact.tokenXMint,tokenSide:'X',sourceEvent:'RESHAPE_SETTLEMENT',sourceCashflowId:oldSettlementCashflowId,rawAmount:actualX,decimals:supply.value.decimals,acquiredAt:at,payload:{successorPlanId:input.plan.planId,source:'WALLET_DELTA_AFTER_REMOVAL'}});
  }
  if(actualY>0n)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:reshape-old-y`,positionAddress:input.positionAddress,planId:input.plan.planId,flowType:'CLOSE_WITHDRAWAL',observedAt:at,lamports:actualY,payload:{source:'WALLET_DELTA_RESHAPE',successorPlanId:input.plan.planId}});
  const opened=await executeAutonomousOpen({
    store: input.store,
    plan: replacement,
    signer: input.signer,
    config: input.config,
  });
  if(opened.status==='RECONCILED'&&opened.positionAddress){
    await input.store.ensurePositionLifecycle({positionAddress:opened.positionAddress,entryPlanId:input.plan.planId,ownerAddress:input.plan.ownerAddress,poolAddress:input.plan.poolAddress,predecessorLifecycleId:`lifecycle:${input.positionAddress}`,at:new Date().toISOString()});
    if(actualX>0n){
    const tokenXAfterReplacement=await readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:poolFact.tokenXMint}),usedX=tokenXAfterRemove>tokenXAfterReplacement?tokenXAfterRemove-tokenXAfterReplacement:0n,transferredX=usedX<actualX?usedX:actualX;
    if(transferredX>0n)await input.store.settlePositionInventoryLot({eventId:`${input.plan.planId}:reshape-old-x-transferred`,lotId:`${input.plan.planId}:reshape-old-x`,planId:input.plan.planId,eventType:'TRANSFERRED',settledRawAmount:transferredX,observedAt:new Date().toISOString(),payload:{successorPositionAddress:opened.positionAddress,transferredRawAmount:transferredX.toString(),source:'MEASURED_REPLACEMENT_DEPOSIT'}});
    }
  }
  return opened;
}

type CloseSettlementStage =
  | "CLOSE_INVENTORY_SNAPSHOTTED"
  | "CLOSE_LIQUIDITY_REMOVED"
  | "CLOSE_CLAIMS_SETTLED"
  | "CLOSE_INVENTORY_MEASURED"
  | "CLOSE_INVENTORY_UNWOUND"
  | "CLOSE_RECOVERED_OPEN_RESIDUAL_UNWOUND";

type CloseSettlementPendingStage =
  | "CLOSE_REMOVE_SUBMITTED"
  | "CLOSE_CLAIM_SUBMITTED"
  | "CLOSE_UNWIND_SUBMITTED"
  | "CLOSE_OPEN_RESIDUAL_UNWIND_SUBMITTED"
  | "CLOSE_POSITION_SUBMITTED";

/**
 * A terminal CLOSE is a sequence of independently observable chain effects.
 * Parent-plan terminal state is never sufficient authority to replay a child.
 */
export type TerminalActionEffectState =
  | "PLANNED"
  | "SUBMITTED"
  | "CONFIRMED_EFFECT"
  | "EXPIRED_NO_EFFECT"
  | "UNKNOWN_EFFECT"
  | "NOT_REQUIRED";

export function assessAccountCloseOnlyRecovery(input:{
  priorAccountClose:TerminalActionEffectState;
  remove:TerminalActionEffectState;
  claim:TerminalActionEffectState;
  primaryUnwind:TerminalActionEffectState;
  residualUnwind:TerminalActionEffectState;
  positionExists:boolean|"UNKNOWN";
  totalXAmount:bigint;
  totalYAmount:bigint;
  feeX:bigint;
  feeY:bigint;
  rewardOne:bigint;
  rewardTwo:bigint;
  unresolvedInventoryLots:number;
}):{eligible:boolean;reasonCodes:string[]}{
  const reasons:string[]=[];
  if(input.priorAccountClose!=="EXPIRED_NO_EFFECT")reasons.push("P6_ACCOUNT_CLOSE_ONLY_PRIOR_EFFECT_NOT_EXPIRED_NO_EFFECT");
  for(const [name,state] of [["REMOVE",input.remove],["CLAIM",input.claim],["PRIMARY_UNWIND",input.primaryUnwind],["RESIDUAL_UNWIND",input.residualUnwind]] as const)
    if(state!=="CONFIRMED_EFFECT"&&state!=="NOT_REQUIRED")reasons.push(`P6_ACCOUNT_CLOSE_ONLY_${name}_UNRESOLVED`);
  if(input.positionExists!==true)reasons.push(input.positionExists===false?"P6_ACCOUNT_CLOSE_ONLY_ACCOUNT_ABSENT":"P6_ACCOUNT_CLOSE_ONLY_ACCOUNT_UNKNOWN");
  if(input.totalXAmount!==0n||input.totalYAmount!==0n)reasons.push("P6_ACCOUNT_CLOSE_ONLY_LIQUIDITY_REMAINS");
  if(input.feeX!==0n||input.feeY!==0n)reasons.push("P6_ACCOUNT_CLOSE_ONLY_FEES_REMAIN");
  if(input.rewardOne!==0n||input.rewardTwo!==0n)reasons.push("P6_ACCOUNT_CLOSE_ONLY_REWARDS_REMAIN");
  if(input.unresolvedInventoryLots!==0)reasons.push("P6_ACCOUNT_CLOSE_ONLY_INVENTORY_REMAINS");
  return{eligible:reasons.length===0,reasonCodes:reasons};
}

export function accountCloseOnlySuccessorIdentity(input:{planId:string;generation:number}):{planId:string;intentId:string;transactionId:string;idempotencyKey:string}{
  if(!Number.isInteger(input.generation)||input.generation<1)throw new Error("LPFORGE_ACCOUNT_CLOSE_ONLY_GENERATION_INVALID");
  const suffix=`account-close-only:${input.generation}`;
  return{planId:`${input.planId}:${suffix}`,intentId:`${input.planId}:intent:${suffix}`,transactionId:`${input.planId}:tx:${suffix}`,idempotencyKey:`${input.planId}:${suffix}`};
}

/** Deterministically choose one recovery action if repeated ticks raced. */
export function selectCanonicalAccountCloseOnlySuccessor<T extends {planId:string;createdAt:string}>(plans:readonly T[]):{canonical?:T;duplicates:T[]}{
  const ordered=[...plans].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.planId.localeCompare(b.planId));
  return ordered[0]?{canonical:ordered[0],duplicates:ordered.slice(1)}:{duplicates:[]};
}

/** An account-close recovery descendant is authoritative only when every
 * independently persisted binding names the same predecessor and economic
 * subject.  Plan-id spelling is deliberately irrelevant. */
export function isExactAccountCloseOnlySuccessor(input:{parent:AutonomousPlan;successor:AutonomousPlan}):boolean{
  const parent=input.parent,successor=input.successor,
    provenance=(successor.planPayload.provenance??{}) as Record<string,unknown>,
    dispatch=closeSettlementDispatch(successor),
    recoverySteps=successor.steps.filter(step=>step.metadata.accountCloseOnly===true),
    generations=[dispatch.accountCloseOnlyRecoveryGeneration,...recoverySteps.map(step=>step.metadata.recoveryGeneration)].map(Number);
  return successor.action==='CLOSE'&&
    successor.positionAddress===parent.positionAddress&&
    successor.poolAddress===parent.poolAddress&&
    successor.ownerAddress===parent.ownerAddress&&
    successor.intentPayload.accountCloseOnly===true&&
    successor.intentPayload.predecessorPlanId===parent.planId&&
    provenance.predecessorPlanId===parent.planId&&
    provenance.terminalRecovery===true&&
    dispatch.accountCloseOnly===true&&
    dispatch.terminalRootClosePlanId===parent.planId&&
    recoverySteps.length===1&&
    recoverySteps[0]!.metadata.predecessorPlanId===parent.planId&&
    generations.length===2&&generations.every(value=>Number.isSafeInteger(value)&&value>=1)&&
    generations[0]===generations[1];
}

/** Resolve one terminal child effect from the exact transaction identities
 * persisted by the parent dispatch.  Expired/no-effect predecessors outside
 * that identity set cannot poison a confirmed retry, and unrelated lifecycle
 * children cannot satisfy it. */
export function canonicalTerminalActionEffect(input:{
  transactions:readonly LifecycleChildTransaction[];
  planId:string;
  transactionIds:readonly string[];
  required?:boolean;
}):TerminalActionEffectState{
  const ids=[...new Set(input.transactionIds.filter(Boolean))];
  if(ids.length===0)return input.required===true?'UNKNOWN_EFFECT':'NOT_REQUIRED';
  for(const transactionId of ids){
    const rows=input.transactions.filter(row=>row.planId===input.planId&&row.transactionId===transactionId);
    if(rows.length!==1||rows[0]!.state!=='CONFIRMED'||typeof rows[0]!.signature!=='string')return 'UNKNOWN_EFFECT';
  }
  return 'CONFIRMED_EFFECT';
}

function isAccountCloseOnlyPlan(plan:AutonomousPlan):boolean{
  return closeSettlementDispatch(plan).accountCloseOnly===true;
}

function closeSettlementDispatch(plan: AutonomousPlan): Record<string, unknown> {
  const value = plan.planPayload && plan.planPayload.autonomous_dispatch;
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function closeSettlementStage(
  plan: AutonomousPlan,
): CloseSettlementStage | undefined {
  const value = closeSettlementDispatch(plan).stage;
  return typeof value === "string" &&
    [
      "CLOSE_INVENTORY_SNAPSHOTTED",
      "CLOSE_LIQUIDITY_REMOVED",
      "CLOSE_CLAIMS_SETTLED",
      "CLOSE_INVENTORY_MEASURED",
      "CLOSE_INVENTORY_UNWOUND",
      "CLOSE_RECOVERED_OPEN_RESIDUAL_UNWOUND",
    ].includes(value)
    ? (value as CloseSettlementStage)
    : undefined;
}

function closeSettlementAmount(value: unknown): bigint | undefined {
  try {
    const amount = BigInt(String(value ?? ""));
    return amount >= 0n ? amount : undefined;
  } catch {
    return undefined;
  }
}

/** Immutable-release provenance, never a hand-maintained migration literal. */
function runtimeMigrationHead(): string | undefined {
  try {
    const value=JSON.parse(readFileSync("RELEASE_MANIFEST.json","utf8")) as {migrationHead?:unknown};
    return typeof value.migrationHead==='string'&&/^M\d{4}_.+\.sql$/.test(value.migrationHead)?value.migrationHead:undefined;
  } catch { return undefined; }
}

function closeSettlementPending(plan: AutonomousPlan): {
  stage: CloseSettlementPendingStage;
  signature: string;
} | undefined {
  const dispatch = closeSettlementDispatch(plan), stage = dispatch.pendingStage,
    signature = dispatch.pendingSignature;
  return typeof stage === "string" && typeof signature === "string" &&
    ["CLOSE_REMOVE_SUBMITTED", "CLOSE_CLAIM_SUBMITTED", "CLOSE_UNWIND_SUBMITTED", "CLOSE_OPEN_RESIDUAL_UNWIND_SUBMITTED", "CLOSE_POSITION_SUBMITTED"].includes(stage)
    ? { stage: stage as CloseSettlementPendingStage, signature }
    : undefined;
}

function closePendingTransactionId(plan:AutonomousPlan,pending:NonNullable<ReturnType<typeof closeSettlementPending>>):string|undefined{
  const dispatch=closeSettlementDispatch(plan),strings=(value:unknown):string[]=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];
  if(pending.stage==='CLOSE_REMOVE_SUBMITTED'){
    const ids=strings(dispatch.removeChildTransactionIds).length?strings(dispatch.removeChildTransactionIds):strings(dispatch.removeTransactionIds),index=Number(dispatch.removeChildIndex);
    return Number.isInteger(index)&&index>=0?ids[index]:typeof dispatch.removeTransactionId==='string'?dispatch.removeTransactionId:undefined;
  }
  if(pending.stage==='CLOSE_CLAIM_SUBMITTED'){
    const ids=strings(dispatch.claimTransactionIds),index=Number(dispatch.claimChildIndex);
    return Number.isInteger(index)&&index>=0?ids[index]:typeof dispatch.claimTransactionId==='string'?dispatch.claimTransactionId:undefined;
  }
  if(pending.stage==='CLOSE_UNWIND_SUBMITTED')return typeof dispatch.unwindTransactionId==='string'?dispatch.unwindTransactionId:undefined;
  if(pending.stage==='CLOSE_OPEN_RESIDUAL_UNWIND_SUBMITTED')return typeof dispatch.recoveredOpenResidualUnwindTransactionId==='string'?dispatch.recoveredOpenResidualUnwindTransactionId:undefined;
  // The pending stage must name the exact durable child. Falling back to the
  // first close-shaped step can bind recovery to the wrong child after a
  // retry/restart and is therefore intentionally fail-closed.
  return typeof dispatch.transactionId==='string'?dispatch.transactionId:undefined;
}

type DurableCloseRemoveChild = {
  transactionId:string;
  index:number;
  count:number;
  built:BuiltMeteoraTransaction;
};

function closeRemoveChildTransactionId(parentTransactionId:string,index:number,retryCount=0):string{
  const base=index===0?parentTransactionId:`${parentTransactionId}:close-remove:${index}`;
  // A blockhash-expired child is never resent under its original durable
  // identity.  A proven no-effect retry owns a new ledger/journal identity.
  return retryCount===0?base:`${base}:retry-${retryCount}`;
}

function closeClaimChildTransactionId(parentTransactionId:string,index:number,retryCount=0):string{
  const claimBase=`${parentTransactionId}:claim`,base=index===0?claimBase:`${claimBase}:child-${index}`;
  return retryCount===0?base:`${base}:retry-${retryCount}`;
}

export function advanceConfirmedCloseChild(input:{
  kind:'REMOVE'|'CLAIM';
  transactionIds:readonly string[];
  confirmedTransactionIds:readonly string[];
  pendingChildIndex:number;
}):{valid:boolean;stage:CloseSettlementStage;confirmedTransactionIds:string[];reasonCode?:string}{
  const ids=[...input.transactionIds],index=input.pendingChildIndex;
  if(ids.length===0||!Number.isInteger(index)||index<0||index>=ids.length)
    return{valid:false,stage:input.kind==='REMOVE'?'CLOSE_INVENTORY_SNAPSHOTTED':'CLOSE_LIQUIDITY_REMOVED',confirmedTransactionIds:[...input.confirmedTransactionIds],reasonCode:`P6_CLOSE_${input.kind}_RECOVERY_CHILD_IDENTITY_INVALID`};
  const confirmed=new Set(input.confirmedTransactionIds.filter(id=>ids.includes(id)));
  // Sequential execution is an invariant: a recovered child cannot leap over
  // an unconfirmed predecessor merely because its own signature landed.
  if(ids.slice(0,index).some(id=>!confirmed.has(id)))
    return{valid:false,stage:input.kind==='REMOVE'?'CLOSE_INVENTORY_SNAPSHOTTED':'CLOSE_LIQUIDITY_REMOVED',confirmedTransactionIds:[...confirmed],reasonCode:`P6_CLOSE_${input.kind}_RECOVERY_ORDER_INVALID`};
  confirmed.add(ids[index]!);
  const complete=ids.every(id=>confirmed.has(id));
  return{valid:true,stage:complete?(input.kind==='REMOVE'?'CLOSE_LIQUIDITY_REMOVED':'CLOSE_CLAIMS_SETTLED'):(input.kind==='REMOVE'?'CLOSE_INVENTORY_SNAPSHOTTED':'CLOSE_LIQUIDITY_REMOVED'),confirmedTransactionIds:ids.filter(id=>confirmed.has(id))};
}

function closeChildPlan(plan:AutonomousPlan,transactionId:string):AutonomousPlan{
  // Each child owns an independent journal and submission idempotency key.
  // The parent plan id remains the economic lifecycle and settlement owner.
  return {...plan,idempotencyKey:`${plan.idempotencyKey}:close-child:${transactionId}`};
}

/**
 * Durable construction proof for a removal child.  The raw Transaction is
 * deliberately not retained in process memory across restart; rebuilding is
 * safe only when the SDK reproduces the exact instruction program/key/data
 * sequence recorded before the first child was signed.
 */
function closeRemoveConstructionFingerprint(built:BuiltMeteoraTransaction):string{
  const transaction=built.transaction as Transaction|VersionedTransaction;
  const instructions=transaction instanceof Transaction
    ? transaction.instructions.map(instruction=>({
        programId:instruction.programId.toBase58(),
        keys:instruction.keys.map(key=>({pubkey:key.pubkey.toBase58(),isSigner:key.isSigner,isWritable:key.isWritable})),
        data:Buffer.from(instruction.data).toString("hex"),
      }))
    : [{versioned:true,serialized:Buffer.from(transaction.serialize()).toString("base64")}];
  return createHash("sha256").update(JSON.stringify({
    builder:built.builder,
    requiredSignerAddresses:built.requiredSignerAddresses,
    metadata:built.metadata,
    instructions,
  })).digest("hex");
}

/**
 * Compatibility recovery for the one historical failure mode where a
 * multi-child protective close had already confirmed its unwind, but a
 * pre-M0059 worker incorrectly terminalized the plan when it tried to sign
 * the next child from a CONFIRMED plan journal.  This is deliberately much
 * narrower than reopening failed plans: it is only a close-family plan, only
 * the documented transition error, only an empty-position settlement stage,
 * and still requires a separately recorded, chain-confirmed unwind below.
 */
export function isLegacySequentialCloseJournalRecovery(value: {
  plan: AutonomousPlan;
  journal: ExecutionJournal;
  positionExists: boolean;
}): boolean {
  const dispatch = closeSettlementDispatch(value.plan);
  return (
    (value.plan.action === "CLOSE" || value.plan.action === "EMERGENCY_CLOSE") &&
    value.plan.state === "RECONCILIATION_REQUIRED" &&
    value.journal.state === "FAILED" &&
    value.positionExists &&
    dispatch.error === "LPFORGE_EXECUTION_JOURNAL_INVALID_TRANSITION:CONFIRMED->SIGNING" &&
    dispatch.stage === "CLOSE_POSITION_PENDING" &&
    dispatch.closeSettlementIncomplete === true &&
    typeof dispatch.tokenXMint === "string" &&
    closeSettlementAmount(dispatch.attributableTokenX) !== undefined &&
    closeSettlementAmount(dispatch.tokenXBefore) !== undefined
  );
}

/**
 * A release before retry children were materialized tried to simulate a fresh
 * account-close identity without first inserting its transaction step.  The
 * database FK correctly rejected that attempt before signing.  This narrow
 * compatibility predicate reopens only that proven no-effect boundary so the
 * current worker can create the missing step and resume the final close.
 */
export function isPreSubmissionAccountCloseRetryStepRecovery(value:{
  plan:AutonomousPlan;
  journal:ExecutionJournal;
  positionExists:boolean;
}):boolean{
  const dispatch=closeSettlementDispatch(value.plan),retryRaw=Number(dispatch.closeAccountRetryCount??0),retry=Number.isSafeInteger(retryRaw)&&retryRaw>0?retryRaw:undefined,
    closeStep=(value.plan.steps??[]).find(step=>step.kind==='METEORA_CLOSE'),expectedTransactionId=retry!==undefined&&closeStep?`${closeStep.transactionId}:retry-${retry}`:undefined;
  return (value.plan.action==='CLOSE'||value.plan.action==='EMERGENCY_CLOSE')&&
    value.plan.state==='RECONCILIATION_REQUIRED'&&
    value.journal.state==='FAILED'&&
    value.positionExists&&
    dispatch.stage==='CLOSE_POSITION_PENDING'&&
    dispatch.error==='insert or update on table "simulations" violates foreign key constraint "simulations_transaction_id_fkey"'&&
    dispatch.transactionId===expectedTransactionId;
}

/** Only a proven expired residual child may receive a fresh recovery attempt. */
export function shouldRebuildExpiredResidualUnwind(input:{
  signatureStatusReadUnknown:boolean;
  confirmationStatus:"PROCESSED"|"CONFIRMED"|"FINALIZED"|"EXPIRED"|"FAILED"|"UNKNOWN";
  positionExists:boolean;
  pendingStage:CloseSettlementPendingStage;
}):boolean{
  return !input.signatureStatusReadUnknown&&
    input.confirmationStatus==="EXPIRED"&&
    input.positionExists&&
    input.pendingStage==="CLOSE_OPEN_RESIDUAL_UNWIND_SUBMITTED";
}

/**
 * The primary close unwind has the same no-blind-resend rule as the
 * recovered-open-residual unwind.  Once REMOVE/CLAIM are confirmed, an
 * expired primary Jupiter signature proves only that *that child* did not
 * land; it does not erase the already-confirmed liquidity withdrawal.  The
 * parent must resume from its measured inventory with a new child identity.
 */
export function shouldRebuildExpiredCloseUnwind(input:{
  signatureStatusReadUnknown:boolean;
  confirmationStatus:"PROCESSED"|"CONFIRMED"|"FINALIZED"|"EXPIRED"|"FAILED"|"UNKNOWN";
  positionExists:boolean;
  pendingStage:CloseSettlementPendingStage;
}):boolean{
  return !input.signatureStatusReadUnknown&&
    input.confirmationStatus==="EXPIRED"&&
    input.positionExists&&
    input.pendingStage==="CLOSE_UNWIND_SUBMITTED";
}

/**
 * A finalized program failure is not an expired transaction.  It may be
 * retried once only when the exact failed primary-unwind child has a durable
 * fee-only receipt, the parent was terminalized by the known legacy branch,
 * the measured inventory remains durably attributed, and the confirmed
 * REMOVE/CLAIM boundary is still available.  This authorizes a *new* child
 * identity; it never resends the failed signature.
 */
export function shouldRebuildFinalizedFailedCloseUnwind(input:{
  signatureStatusReadUnknown:boolean;
  confirmationStatus:"PROCESSED"|"CONFIRMED"|"FINALIZED"|"EXPIRED"|"FAILED"|"UNKNOWN";
  failureFinalized:boolean;
  planState:string;
  journalState:string;
  terminalRecovery:unknown;
  positionExists:boolean;
  positionOwner:unknown;
  positionPool:unknown;
  expectedOwner:string;
  expectedPool:string;
  pendingStage:CloseSettlementPendingStage;
  failedReceiptProven:boolean;
  durableInventoryProven:boolean;
  confirmedPredecessor:boolean;
  exactPendingAttempt:boolean;
  retryCount:unknown;
}):boolean{
  const retry=Number(input.retryCount);
  return !input.signatureStatusReadUnknown&&
    input.confirmationStatus==='FAILED'&&
    input.failureFinalized&&
    input.planState==='FAILED'&&
    input.journalState==='FAILED'&&
    input.terminalRecovery==='P6_CLOSE_PENDING_STAGE_FAILED_CONFIRMED_NO_PROTOCOL_EFFECT'&&
    input.positionExists&&
    input.positionOwner===input.expectedOwner&&
    input.positionPool===input.expectedPool&&
    input.pendingStage==='CLOSE_UNWIND_SUBMITTED'&&
    input.failedReceiptProven&&
    input.durableInventoryProven&&
    input.confirmedPredecessor&&
    input.exactPendingAttempt&&
    Number.isSafeInteger(retry)&&retry===0;
}

/**
 * The first REMOVE child is safe to rebuild only after its exact signature
 * has expired, PositionV2 is still present, and no earlier remove child could
 * have changed liquidity.  Callers additionally prove the pending signature
 * belongs to child zero and that no remove child has a confirmed receipt.
 */
export function shouldRebuildExpiredCloseRemove(input:{
  signatureStatusReadUnknown:boolean;
  confirmationStatus:"PROCESSED"|"CONFIRMED"|"FINALIZED"|"EXPIRED"|"FAILED"|"UNKNOWN";
  positionExists:boolean;
  pendingStage:CloseSettlementPendingStage;
  pendingChildIndex:number | undefined;
  confirmedRemoveChildCount:number;
  confirmedRemoveChildIndexes:readonly number[];
}):boolean{
  return !input.signatureStatusReadUnknown&&
    input.confirmationStatus==="EXPIRED"&&
    input.positionExists&&
    input.pendingStage==="CLOSE_REMOVE_SUBMITTED"&&
    input.pendingChildIndex!==undefined&&input.pendingChildIndex>=0&&
    input.confirmedRemoveChildCount===input.pendingChildIndex&&
    input.confirmedRemoveChildIndexes.length===input.pendingChildIndex&&
    input.confirmedRemoveChildIndexes.every((value,index)=>value===index);
}

/**
 * A terminal claim may be rebuilt only after its exact signature expires
 * without a receipt and every preceding REMOVE child is independently
 * confirmed.  It cannot authorize a rewind of removal or a blind resend.
 */
export function shouldRebuildExpiredCloseClaim(input:{
  signatureStatusReadUnknown:boolean;
  confirmationStatus:"PROCESSED"|"CONFIRMED"|"FINALIZED"|"EXPIRED"|"FAILED"|"UNKNOWN";
  positionExists:boolean;
  pendingStage:CloseSettlementPendingStage;
  confirmedRemoveChildCount:number;
  requiredRemoveChildCount:number;
}):boolean{
  return !input.signatureStatusReadUnknown&&
    input.confirmationStatus==="EXPIRED"&&
    input.positionExists&&
    input.pendingStage==="CLOSE_CLAIM_SUBMITTED"&&
    input.requiredRemoveChildCount>0&&
    input.confirmedRemoveChildCount===input.requiredRemoveChildCount;
}

/** Bounded recovery delay prevents a proven-safe retry from becoming a tight loop. */
function recoveredResidualRetryNotBefore(now:string,retryCount:number):string{
  const delayMs=Math.min(300_000,60_000*Math.max(1,retryCount));
  return new Date(Date.parse(now)+delayMs).toISOString();
}

function closeSettlementOutputPayload(
  effects: ReturnType<typeof deriveTransactionAssetEffects>["swapOutputEffects"],
): Array<Record<string, unknown>> {
  return effects.map((effect) =>
    "mint" in effect
      ? {
          classification: effect.classification,
          accountAddress: effect.accountAddress,
          accountIndex: effect.accountIndex,
          mint: effect.mint,
          rawAmount: effect.rawAmount.toString(),
          deltaRaw: effect.deltaRaw.toString(),
          decimals: effect.decimals,
          evidence: effect.evidence,
        }
      : {
          classification: effect.classification,
          accountAddress: effect.accountAddress,
          accountIndex: effect.accountIndex,
          amountLamports: effect.amountLamports?.toString(),
          evidence: effect.evidence,
        },
  );
}

function closeSettlementNativeTotal(
  effects: ReturnType<typeof deriveTransactionAssetEffects>["rentDebits"],
): bigint {
  return effects.reduce((total, effect) => total + (effect.amountLamports ?? 0n), 0n);
}

/**
 * Reconciles one confirmed Jupiter unwind from its receipt, rather than from a
 * persistent WSOL-account delta.  Both durable writes use stable settlement
 * identifiers, so re-running this after a process crash is safe.
 */
export async function reconcileConfirmedCloseUnwind(input: {
  store: Pick<Phase1Store, "insertPositionCashflow" | "settlePositionInventoryLot">;
  connection: Connection;
  plan: AutonomousPlan;
  positionAddress: string;
  signature: string;
  transactionId: string;
  inputMint: string;
  inputAmountRaw: bigint;
  observedAt?: string;
  /** A recovered OPEN residual has its own lot and durable receipt ids. */
  lotId?: string;
  /** Deterministic receipt-backed lot consumption for a combined close unwind. */
  lotAllocations?: Array<{lotId:string;rawAmount:bigint}>;
  settlementIdSuffix?: string;
}): Promise<{ ok: true; swapProceedsLamports: bigint; inputCorroborated: boolean } | { ok: false; reasonCodes: string[] }> {
  const receipt = await loadConfirmedExecutionReceipt(input.connection, input.signature);
  const effects = deriveTransactionAssetEffects(receipt, {
    ownerAddress: input.plan.ownerAddress,
    // Solana message ordering defines the fee payer as the first static key;
    // the position owner itself is still resolved independently by Stage 2.
    ...(receipt.staticAccountKeys[0] === undefined
      ? {}
      : { feePayerAddress: receipt.staticAccountKeys[0] }),
    inputMint: input.inputMint,
    outputMint: WSOL_MINT,
    jupiterProgramIds: [JUPITER_SWAP_V6_PROGRAM_ID],
    positionAddress: input.positionAddress,
  });
  const settlement = deriveCloseUnwindSettlement({
    receipt,
    effects,
    ownerAddress: input.plan.ownerAddress,
    inputMint: input.inputMint,
    inputAmountRaw: input.inputAmountRaw,
    outputMint: WSOL_MINT,
    jupiterProgramIds: [JUPITER_SWAP_V6_PROGRAM_ID],
  });
  if (settlement.state !== "SETTLED" || settlement.swapProceedsLamports === undefined)
    return { ok: false, reasonCodes: settlement.reasonCodes };

  const observedAt = input.observedAt ?? new Date().toISOString(),
    ids = input.settlementIdSuffix
      ? {
          cashflowId:`${input.plan.planId}:${input.settlementIdSuffix}:swap-proceeds`,
          lotEventId:`${input.plan.planId}:${input.settlementIdSuffix}:lot-settled`,
        }
      : closeUnwindSettlementIds(input.plan.planId),
    lotId=input.lotId??`${input.plan.planId}:close-x:lot`,
    lotAllocations=input.lotAllocations??[{lotId,rawAmount:input.inputAmountRaw}];
  if(lotAllocations.length===0||lotAllocations.some(allocation=>allocation.rawAmount<=0n)||lotAllocations.reduce((total,allocation)=>total+allocation.rawAmount,0n)!==input.inputAmountRaw)
    return{ok:false,reasonCodes:['P6_CLOSE_POSITION_ATTRIBUTED_LOT_ALLOCATION_INVALID']};
  await input.store.insertPositionCashflow({
    cashflowId: ids.cashflowId,
    positionAddress: input.positionAddress,
    planId: input.plan.planId,
    flowType: "SWAP_PROCEEDS",
    observedAt,
    lamports: settlement.swapProceedsLamports,
    payload: {
      source: "CONFIRMED_TRANSACTION_ASSET_EFFECTS",
      transactionSignature: input.signature,
      transactionId: input.transactionId,
      settlementKind: "JUPITER_UNWIND_SOL_EQUIVALENT",
      inputMint: input.inputMint,
      inputAmountRaw: input.inputAmountRaw.toString(),
      inputCorroborated: settlement.inputCorroborated,
      inputProof: settlement.inputProof,
      receiptState: receipt.state,
      classificationState: effects.classificationState,
      transactionFeeLamports: effects.transactionFeeLamports?.toString(),
      rentDebitLamports: closeSettlementNativeTotal(effects.rentDebits).toString(),
      rentRefundLamports: closeSettlementNativeTotal(effects.rentRefunds).toString(),
      positionRentRecoveryLamports: effects.positionRentRecoveryLamports.toString(),
      outputEffects: closeSettlementOutputPayload(settlement.outputEffects),
    },
  });
  for(const [index,allocation] of lotAllocations.entries())await input.store.settlePositionInventoryLot({
    eventId: `${ids.lotEventId}:${index}`,
    lotId: allocation.lotId,
    planId: input.plan.planId,
    eventType: "SETTLED",
    settledRawAmount: allocation.rawAmount,
    observedAt,
    transactionSignature: input.signature,
    payload: {
      disposition: "JUPITER_UNWIND",
      transactionId: input.transactionId,
      settlementSignature: input.signature,
      proceedsCashflowId: ids.cashflowId,
      source: "CONFIRMED_TRANSACTION_ASSET_EFFECTS",
      allocationIndex:index,
    },
  });
  return {
    ok: true,
    swapProceedsLamports: settlement.swapProceedsLamports,
    inputCorroborated: settlement.inputCorroborated,
  };
}

export function shouldResumeCloseSettlement(value: {
  action: string;
  stage?: string | undefined;
  positionExists: boolean;
  confirmationStatus: string;
}): boolean {
  return (
    (value.action === "CLOSE" || value.action === "EMERGENCY_CLOSE") &&
    value.stage !== undefined &&
    value.stage !== "CLOSE_INVENTORY_SNAPSHOTTED" &&
    value.positionExists &&
    (value.confirmationStatus === "CONFIRMED" ||
      value.confirmationStatus === "FINALIZED")
  );
}

/**
 * A deterministic pre-submission CLOSE failure has no economic effect only
 * when every boundary below is independently true. This predicate is shared
 * by recovery and tests so a generic reconciliation-required plan cannot be
 * accidentally revived as a multi-remove continuation.
 */
export function canResumePreSubmissionClose(value:{
  action:string;
  planState:string;
  /** A plan may be BLOCKED only after this exact no-signature recovery path
   * previously marked it resumable.  It is never a generic BLOCKED retry. */
  blockedPreSubmissionResume?:boolean;
  stage:string|undefined;
  hasPendingChild:boolean;
  journalState:string;
  hasJournalSignature:boolean;
  positionExists:boolean;
  positionOwner:string|undefined;
  positionPool:string|undefined;
  planOwner:string;
  planPool:string;
  /** The original close workflow was persisted completely, but no child has
   * crossed a network boundary.  This permits an unsnapshotted pre-build
   * failure to restart its *same* parent close plan. */
  hasCanonicalCloseWorkflow:boolean;
  removeChildrenHaveSignatures:boolean;
}):boolean{
  return (value.action==="CLOSE"||value.action==="EMERGENCY_CLOSE")&&
    (value.planState==="RECONCILIATION_REQUIRED"||
      (value.planState==="BLOCKED"&&value.blockedPreSubmissionResume===true))&&
    // CLAIM_GUARD is retained only when the prior release attempted this
    // exact resume and the immutable plan HMAC rejected its altered expiry.
    // The preSubmissionResume marker was written before that claim, so this
    // remains an exact, durable no-signature continuation—not a BLOCKED retry.
    (value.stage==="CLOSE_INVENTORY_SNAPSHOTTED"||
      // A transport/read failure can occur after the parent journal is
      // created but before the first inventory snapshot is durable.  It is
      // recoverable only for the standard, fully persisted close workflow;
      // an arbitrary no-stage reconciliation-required plan never qualifies.
      (value.stage===undefined&&value.hasCanonicalCloseWorkflow)||
      (value.blockedPreSubmissionResume===true&&value.stage==="CLAIM_GUARD"&&
        (value.planState==="BLOCKED"||value.planState==="RECONCILIATION_REQUIRED")&&
        value.journalState==="FAILED"))&&
    !value.hasPendingChild&&
    (value.journalState==="PLAN_CREATED"||
      (value.blockedPreSubmissionResume===true&&value.stage==="CLAIM_GUARD"&&value.journalState==="FAILED"))&&
    !value.hasJournalSignature&&
    value.positionExists&&
    value.positionOwner===value.planOwner&&
    value.positionPool===value.planPool&&
    !value.removeChildrenHaveSignatures;
}

/**
 * A CLOSE is a durable settlement workflow, not one opaque mutation.  A stage
 * is recorded only after the preceding chain action is confirmed.  Therefore
 * a restarted worker can continue from a completed stage without resending a
 * prior transaction or touching inventory that predates this position.
 */
async function executeCloseSettlement(input: {
  store: Phase1Store;
  plan: AutonomousPlan;
  signer: MainnetSignerBackend;
  config: LiveWorkerConfig;
  pool: MeteoraOpenAddPoolLike & MeteoraRemoveClaimPoolLike;
  positionAddress: string;
}): Promise<LiveWorkerResult> {
  const closeAction: "CLOSE" | "EMERGENCY_CLOSE" =
    input.plan.action === "EMERGENCY_CLOSE" ? "EMERGENCY_CLOSE" : "CLOSE";
  const removeStep =
      input.plan.steps.find((candidate) => candidate.kind === "METEORA_REMOVE") ??
      input.plan.steps[0],
    unwindStep = input.plan.steps.find(
      (candidate) => candidate.kind === "JUPITER_UNWIND",
    ),
    closeStep = input.plan.steps.find(
      (candidate) => candidate.kind === "METEORA_CLOSE",
    );
  if (!removeStep || !unwindStep || !closeStep)
    throw new Error("LPFORGE_P6_CLOSE_SEQUENCE_MISSING");

  const connection = createGovernedConnection({rpcUrl:input.config.rpcUrl,priority:'P0_EXECUTION_CRITICAL'}),
    poolFact = await createMeteoraReadAdapter({
      rpcUrl: input.config.rpcUrl,
      cluster: "mainnet-beta",
      programId: input.config.programId,
      priority:'P0_EXECUTION_CRITICAL',
    }).getPool(input.plan.poolAddress),
    persist = async (
      stage: CloseSettlementStage,
      payload: Record<string, unknown>,
      state: "BUILDING" | "RECONCILING" = "RECONCILING",
    ) =>
      input.store.transitionAutonomousPlan({
        planId: input.plan.planId,
        state,
        at: new Date().toISOString(),
        // Completed stage transitions clear any previous child submission
        // marker. A callback that records a new pending child overrides these
        // nulls in the same durable document.
        payload: { stage, tokenXMint: poolFact.tokenXMint, pendingStage: null, pendingSignature: null, ...payload },
      });

  // A CLOSE has parent-level chain truth. Once a child stage has been sent,
  // a later child preflight error is reconciliation debt, never a clean
  // BLOCKED/FAILED result for the parent.
  const incomplete = async (reasonCodes: string[], stage: string) => {
    await input.store.transitionAutonomousPlan({
      planId: input.plan.planId,
      state: "RECONCILIATION_REQUIRED",
      at: new Date().toISOString(),
      reasonCodes: ["P6_CLOSE_SETTLEMENT_RECONCILIATION_REQUIRED", ...reasonCodes],
      payload: { stage, closeSettlementIncomplete: true },
    });
    return {
      status: "UNKNOWN" as const,
      planId: input.plan.planId,
      reasonCodes: ["P6_CLOSE_SETTLEMENT_RECONCILIATION_REQUIRED", ...reasonCodes],
      transactionSubmitted: true,
    };
  };

  let dispatch = closeSettlementDispatch(input.plan),
    stage = closeSettlementStage(input.plan),
    tokenXBefore = closeSettlementAmount(dispatch.tokenXBefore),
    tokenYBefore = closeSettlementAmount(dispatch.tokenYBefore),
    tokenXAfterRemove = closeSettlementAmount(dispatch.tokenXAfterRemove);
  if (!stage) {
    [tokenXBefore,tokenYBefore]=await Promise.all([readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:poolFact.tokenXMint}),readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:poolFact.tokenYMint})]);
    // Final immutable PositionV2 read before the first economic close instruction.
    const feePosition=await createMeteoraReadAdapter({rpcUrl:input.config.rpcUrl,cluster:"mainnet-beta",programId:input.config.programId,priority:'P0_EXECUTION_CRITICAL'}).getPositionV2(input.plan.poolAddress,input.positionAddress);
    const [tokenXDecimals,tokenYDecimals,blockTimeUnix]=await Promise.all([readMintDecimals(connection,poolFact.tokenXMint),readMintDecimals(connection,poolFact.tokenYMint),feePosition.stamp.chainSlot===undefined?Promise.resolve(null):connection.getBlockTime(Number(feePosition.stamp.chainSlot)).catch(()=>null)]);
    const observedBlockTime=blockTimeUnix===null?undefined:new Date(blockTimeUnix*1000).toISOString();
    await input.store.upsertCloseFeeAttributionSnapshot({closePlanId:input.plan.planId,positionAddress:input.positionAddress,poolAddress:input.plan.poolAddress,ownerAddress:input.plan.ownerAddress,...(feePosition.stamp.chainSlot===undefined?{}:{observedSlot:feePosition.stamp.chainSlot}),observedAt:feePosition.stamp.observedAt,...(observedBlockTime===undefined?{}:{observedBlockTime}),commitment:"confirmed",tokenXMint:poolFact.tokenXMint,tokenYMint:poolFact.tokenYMint,...(tokenXDecimals===undefined?{}:{tokenXDecimals}),...(tokenYDecimals===undefined?{}:{tokenYDecimals}),preCloseFeeXRaw:BigInt(feePosition.feeX??"0"),preCloseFeeYRaw:BigInt(feePosition.feeY??"0"),preCloseRewardOneRaw:BigInt(feePosition.rewardOne??"0"),preCloseRewardTwoRaw:BigInt(feePosition.rewardTwo??"0")});
    await persist(
      "CLOSE_INVENTORY_SNAPSHOTTED",
      { tokenXBefore: tokenXBefore.toString(),tokenYBefore: tokenYBefore.toString(),feeSnapshotSlot:feePosition.stamp.chainSlot?.toString()??null,feeSnapshotObservedAt:feePosition.stamp.observedAt,feeXRaw:(feePosition.feeX??"0"),feeYRaw:(feePosition.feeY??"0"),feeXUi:rawTokenUi(BigInt(feePosition.feeX??"0"),tokenXDecimals)??null,feeYUi:rawTokenUi(BigInt(feePosition.feeY??"0"),tokenYDecimals)??null },
      "BUILDING",
    );
    stage = "CLOSE_INVENTORY_SNAPSHOTTED";
    dispatch = { ...dispatch, tokenXBefore: tokenXBefore.toString(),tokenYBefore: tokenYBefore.toString() };
  }
  if (tokenXBefore === undefined||tokenYBefore===undefined) {
    await input.store.transitionAutonomousPlan({
      planId: input.plan.planId,
      state: "RECONCILIATION_REQUIRED",
      at: new Date().toISOString(),
      reasonCodes: ["P6_CLOSE_RECOVERY_SNAPSHOT_MISSING"],
      payload: { stage: stage ?? "CLOSE_UNKNOWN_STAGE" },
    });
    return {
      status: "UNKNOWN",
      planId: input.plan.planId,
      reasonCodes: ["P6_CLOSE_RECOVERY_SNAPSHOT_MISSING"],
      transactionSubmitted: true,
    };
  }

  if (stage === "CLOSE_INVENTORY_SNAPSHOTTED") {
    const range = await chainMutationRange({
        plan: input.plan,
        stepMetadata: removeStep.metadata,
        rpcUrl: input.config.rpcUrl,
        programId: input.config.programId,
        positionAddress: input.positionAddress,
      }),
      built = await buildRemoveLiquidityTransactions(input.pool, {
        userAddress: input.plan.ownerAddress,
        positionAddress: input.positionAddress,
        fromBinId: range.lower,
        toBinId: range.upper,
        bps: 10_000,
        claimAndClose: false,
      });
    if(built.length===0)throw new Error("LPFORGE_P6_CLOSE_REMOVE_CONSTRUCTION_EMPTY");
    // Construct and journal the complete SDK sequence before signing child 0.
    // This turns SDK transaction splitting into durable parent-plan facts.
    const removeRetryRaw=Number(dispatch.closeRemoveRetryCount??0),
      removeRetryCount=Number.isSafeInteger(removeRetryRaw)&&removeRetryRaw>=0?removeRetryRaw:0;
    const persistedIds=Array.isArray(dispatch.removeChildTransactionIds)
      ? dispatch.removeChildTransactionIds.filter((value):value is string=>typeof value==='string')
      : [],
      retryFromRaw=Number(dispatch.closeRemoveRetryFromChildIndex??0),
      retryFromChildIndex=Number.isInteger(retryFromRaw)&&retryFromRaw>=0?retryFromRaw:0,
      persistedConfirmed=Array.isArray(dispatch.removeChildrenConfirmed)
        ? dispatch.removeChildrenConfirmed.filter((value):value is string=>typeof value==='string')
        : [];
    const children:DurableCloseRemoveChild[]=built.map((item,index)=>{
      // A retry after child N expiry preserves the exact confirmed prefix
      // (0..N-1); only N and its unsubmitted suffix receive fresh identities.
      const transactionId=index<retryFromChildIndex&&persistedIds[index]
        ? persistedIds[index]!
        : closeRemoveChildTransactionId(removeStep.transactionId,index,removeRetryCount);
      const constructionFingerprint=closeRemoveConstructionFingerprint(item);
      const previous=input.plan.steps.find(step=>step.transactionId===transactionId);
      const previousFingerprint=previous?.metadata.closeRemoveConstructionFingerprint;
      if(index>=retryFromChildIndex&&typeof previousFingerprint==='string'&&previousFingerprint!==constructionFingerprint)
        throw new Error("LPFORGE_P6_CLOSE_REMOVE_CHILD_CONSTRUCTION_MISMATCH");
      item.metadata={...item.metadata,transactionId,closeRemoveChildIndex:index,closeRemoveChildCount:built.length,closeRemoveConstructionFingerprint:constructionFingerprint,parentPlanId:input.plan.planId,positionAddress:input.positionAddress,poolAddress:input.plan.poolAddress,ownerAddress:input.plan.ownerAddress};
      return{transactionId,index,count:built.length,built:item};
    });
    for(const child of children)await input.store.ensureExecutionTransactionStep({
      planId:input.plan.planId,transactionId:child.transactionId,kind:"METEORA_REMOVE",state:"PLANNED",requiredSignerAddresses:child.built.requiredSignerAddresses,
      metadata:child.built.metadata,
    });
    const persistedCount=Number(dispatch.removeChildCount??children.length);
    if(!Number.isInteger(persistedCount)||persistedCount!==children.length)
      throw new Error("LPFORGE_P6_CLOSE_REMOVE_CHILD_CONSTRUCTION_MISMATCH");
    const priorConfirmed=new Set(persistedConfirmed);
    const allIds=children.map(child=>child.transactionId);
    if(retryFromChildIndex>0&&(!persistedIds.length||persistedIds.length!==children.length||persistedConfirmed.length!==retryFromChildIndex||persistedConfirmed.some((id,index)=>id!==persistedIds[index])))
      throw new Error("LPFORGE_P6_CLOSE_REMOVE_RETRY_PREFIX_INVALID");
    // A child is only skipped when its own durable submission ledger proves it
    // confirmed.  Parent stage text is never sufficient authority to skip it.
    for(const child of children){
      if(priorConfirmed.has(child.transactionId)){
        const confirmed=await input.store.loadConfirmedSubmissionByTransactionId(child.transactionId);
        if(!confirmed)throw new Error("LPFORGE_P6_CLOSE_REMOVE_CHILD_CONFIRMATION_MISSING");
        continue;
      }
      const childPlan=closeChildPlan(input.plan,child.transactionId);
      const removed=await executeMeteoraMutation({
        ...input,
        plan:childPlan,
        built:child.built,
        action:closeAction,
        deferCompletion:true,
        afterSubmit:async({signature})=>persist("CLOSE_INVENTORY_SNAPSHOTTED",{
        tokenXBefore:tokenXBefore!.toString(),tokenYBefore:tokenYBefore!.toString(),
        removeChildCount:children.length,removeChildTransactionIds:allIds,
        removeChildIndex:child.index,closeRemoveRetryCount:removeRetryCount,
        pendingStage:"CLOSE_REMOVE_SUBMITTED",pendingSignature:signature,
        }),
        afterConfirmed:async({signature})=>{
          const native=await persistConfirmedCloseNativeWithdrawal({store:input.store,connection,plan:input.plan,positionAddress:input.positionAddress,signature,transactionId:child.transactionId});
          if(!native.ok)throw new Error(native.reasonCodes.join(","));
        },
      });
      if(removed.status!=="RECONCILED")return removed;
      priorConfirmed.add(child.transactionId);
      await persist("CLOSE_INVENTORY_SNAPSHOTTED",{
        tokenXBefore:tokenXBefore!.toString(),tokenYBefore:tokenYBefore!.toString(),
        removeChildCount:children.length,removeChildTransactionIds:allIds,
        removeChildrenConfirmed:[...priorConfirmed],lastConfirmedRemoveChild:child.index,
        closeRemoveRetryCount:removeRetryCount,
      });
    }
    // Capture REMOVE before CLAIM.  The later claim can credit the same mint;
    // measuring only after both actions would fold fee inventory into the
    // liquidity-withdrawal lot and double-count it when claim receipt
    // attribution independently creates its own lot.
    tokenXAfterRemove=await readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:poolFact.tokenXMint});
    await persist("CLOSE_LIQUIDITY_REMOVED", {
      tokenXBefore: tokenXBefore.toString(),
      tokenYBefore: tokenYBefore.toString(),
      tokenXAfterRemove:tokenXAfterRemove.toString(),
      removeTransactionId: children[0]!.transactionId,
      removeTransactionIds: allIds,
      removeChildCount:children.length,
      removeChildrenConfirmed:[...priorConfirmed],
      closeRemoveRetryCount:removeRetryCount,
    });
    dispatch={...dispatch,tokenXAfterRemove:tokenXAfterRemove.toString()};
    stage = "CLOSE_LIQUIDITY_REMOVED";
  }

  if (stage === "CLOSE_LIQUIDITY_REMOVED") {
    const claimRetryRaw=Number(dispatch.closeClaimRetryCount??0),
      claimRetryCount=Number.isSafeInteger(claimRetryRaw)&&claimRetryRaw>=0?claimRetryRaw:0;
    let claimBuilt: BuiltMeteoraTransaction[] | undefined;
    try {
      claimBuilt = await buildClaimTransactions(input.pool, {
        userAddress: input.plan.ownerAddress,
        positionAddress: input.positionAddress,
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "LPFORGE_METEORA_CLAIM_NOTHING_TO_CLAIM"
      )
        throw error;
    }
    if (claimBuilt) {
      if(claimBuilt.length===0)throw new Error("LPFORGE_P6_CLOSE_CLAIM_CONSTRUCTION_EMPTY");
      const claimIds=claimBuilt.map((_,index)=>closeClaimChildTransactionId(closeStep.transactionId,index,claimRetryCount)),
        priorConfirmed=new Set(Array.isArray(dispatch.claimChildrenConfirmed)?dispatch.claimChildrenConfirmed.filter((value):value is string=>typeof value==='string'&&claimIds.includes(value)):[]);
      for(const [index,built] of claimBuilt.entries()){
        const transactionId=claimIds[index]!,constructionFingerprint=closeRemoveConstructionFingerprint(built),previous=input.plan.steps.find(step=>step.transactionId===transactionId),previousFingerprint=previous?.metadata.closeClaimConstructionFingerprint;
        if(typeof previousFingerprint==='string'&&previousFingerprint!==constructionFingerprint)throw new Error("LPFORGE_P6_CLOSE_CLAIM_CHILD_CONSTRUCTION_MISMATCH");
        built.metadata={...built.metadata,transactionId,stage:"CLOSE_CLAIM_RESIDUAL",parentTransactionId:closeStep.transactionId,closeClaimChildIndex:index,closeClaimChildCount:claimBuilt.length,closeClaimRetryCount:claimRetryCount,closeClaimConstructionFingerprint:constructionFingerprint,parentPlanId:input.plan.planId,positionAddress:input.positionAddress,poolAddress:input.plan.poolAddress,ownerAddress:input.plan.ownerAddress};
        await input.store.ensureExecutionTransactionStep({planId:input.plan.planId,transactionId,kind:"METEORA_CLAIM",state:"PLANNED",requiredSignerAddresses:built.requiredSignerAddresses,metadata:built.metadata});
      }
      const persistedClaimCount=Number(dispatch.claimChildCount??claimBuilt.length);
      if(!Number.isInteger(persistedClaimCount)||persistedClaimCount!==claimBuilt.length)throw new Error("LPFORGE_P6_CLOSE_CLAIM_CHILD_CONSTRUCTION_MISMATCH");
      for(const [index,built] of claimBuilt.entries()){
        const transactionId=claimIds[index]!;
        if(priorConfirmed.has(transactionId)){
          if(!await input.store.loadConfirmedSubmissionByTransactionId(transactionId))throw new Error("LPFORGE_P6_CLOSE_CLAIM_CHILD_CONFIRMATION_MISSING");
          continue;
        }
        const claimed=await executeMeteoraMutation({
          ...input,plan:closeChildPlan(input.plan,transactionId),built,action:closeAction,deferCompletion:true,
          afterSubmit:async({signature})=>persist("CLOSE_LIQUIDITY_REMOVED",{tokenXBefore:tokenXBefore!.toString(),tokenYBefore:tokenYBefore!.toString(),claimTransactionId:transactionId,claimTransactionIds:claimIds,claimChildCount:claimBuilt!.length,claimChildrenConfirmed:[...priorConfirmed],claimChildIndex:index,closeClaimRetryCount:claimRetryCount,pendingStage:"CLOSE_CLAIM_SUBMITTED",pendingSignature:signature}),
          afterConfirmed:async({signature})=>{const receipt=await persistConfirmedClaimReceipt({store:input.store,connection,plan:input.plan,positionAddress:input.positionAddress,signature,transactionId,observedAt:new Date().toISOString(),source:"CONFIRMED_TERMINAL_CLAIM_RECEIPT"});if(!receipt.ok)throw new Error(receipt.reasonCodes.join(","));},
        });
        if(claimed.status!=="RECONCILED")return incomplete(claimed.reasonCodes,"CLOSE_CLAIM_PENDING");
        priorConfirmed.add(transactionId);
        await persist("CLOSE_LIQUIDITY_REMOVED",{tokenXBefore:tokenXBefore!.toString(),tokenYBefore:tokenYBefore!.toString(),claimTransactionId:transactionId,claimTransactionIds:claimIds,claimChildCount:claimBuilt.length,claimChildrenConfirmed:[...priorConfirmed],lastConfirmedClaimChild:index,closeClaimRetryCount:claimRetryCount});
      }
    }
    await persist("CLOSE_CLAIMS_SETTLED", {
      tokenXBefore: tokenXBefore.toString(),
      tokenYBefore: tokenYBefore.toString(),
      claimTransactionId:claimBuilt?closeClaimChildTransactionId(closeStep.transactionId,claimBuilt.length-1,claimRetryCount):undefined,
      claimTransactionIds:claimBuilt?claimBuilt.map((_,index)=>closeClaimChildTransactionId(closeStep.transactionId,index,claimRetryCount)):undefined,
      claimChildCount:claimBuilt?.length,
      claimChildrenConfirmed:claimBuilt?claimBuilt.map((_,index)=>closeClaimChildTransactionId(closeStep.transactionId,index,claimRetryCount)):undefined,
      closeClaimRetryCount:claimBuilt?claimRetryCount:undefined,
      claimTransactionSkipped: !claimBuilt,
    });
    stage = "CLOSE_CLAIMS_SETTLED";
  }

  const persistedLotAllocations=parseDurableCloseLotAllocations(dispatch.attributableFeeLotAllocations);
  if(!persistedLotAllocations.ok){
    await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:"RECONCILIATION_REQUIRED",at:new Date().toISOString(),reasonCodes:["P6_CLOSE_POSITION_ATTRIBUTED_LOT_ALLOCATION_INVALID"],payload:{stage:"CLOSE_POSITION_ATTRIBUTED_FEE_INVENTORY"}});
    return{status:"UNKNOWN",planId:input.plan.planId,reasonCodes:["P6_CLOSE_POSITION_ATTRIBUTED_LOT_ALLOCATION_INVALID"],transactionSubmitted:true};
  }
  let attributableTokenX = closeSettlementAmount(dispatch.attributableTokenX),attributableTokenY=closeSettlementAmount(dispatch.attributableTokenY),attributableFeeLotAllocations=persistedLotAllocations.allocations;
  if (stage === "CLOSE_CLAIMS_SETTLED") {
    const [tokenXAfter,tokenYAfter]=await Promise.all([readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:poolFact.tokenXMint}),readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:poolFact.tokenYMint})]);
    if(tokenXAfterRemove===undefined){
      await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:"RECONCILIATION_REQUIRED",at:new Date().toISOString(),reasonCodes:["P6_CLOSE_REMOVE_TOKEN_SNAPSHOT_MISSING"],payload:{stage:"CLOSE_POSITION_ATTRIBUTED_FEE_INVENTORY"}});
      return{status:"UNKNOWN",planId:input.plan.planId,reasonCodes:["P6_CLOSE_REMOVE_TOKEN_SNAPSHOT_MISSING"],transactionSubmitted:true};
    }
    const newlyWithdrawnTokenX =
      tokenXAfterRemove > tokenXBefore ? tokenXAfterRemove - tokenXBefore : 0n;
    attributableTokenY=tokenYAfter>tokenYBefore?tokenYAfter-tokenYBefore:0n;
    // Token X is non-SOL inventory, not PnL.  Record an attributable lot
    // before the unwind so terminal settlement can require an exact
    // disposition transaction instead of inferring ownership from wallet
    // balance. Jupiter's later WSOL output is the only realized SOL receipt.
    if(newlyWithdrawnTokenX>0n){
      const cashflowId=`${input.plan.planId}:close-token-x`,at=new Date().toISOString();
      await input.store.insertPositionCashflow({cashflowId,positionAddress:input.positionAddress,planId:input.plan.planId,flowType:"CLOSE_WITHDRAWAL",observedAt:at,tokenMint:poolFact.tokenXMint,tokenAmountRaw:newlyWithdrawnTokenX.toString(),payload:{source:"REMOVE_PLUS_CLAIM_DELTA",nonSolInventory:true}});
      await recordPositionTokenXLot({store:input.store,connection,plan:input.plan,positionAddress:input.positionAddress,tokenMint:poolFact.tokenXMint,sourceEvent:"CLOSE_WITHDRAWAL",sourceCashflowId:cashflowId,rawAmount:newlyWithdrawnTokenX,observedAt:at,signature:"CLOSE_REMOVE_CONFIRMED"});
    }
    const attributed=derivePositionAttributedTerminalUnwind({positionAddress:input.positionAddress,tokenMint:poolFact.tokenXMint,closePlanId:input.plan.planId,newlyWithdrawnRaw:newlyWithdrawnTokenX,walletRawAfterClose:tokenXAfter,lots:await input.store.loadPositionInventoryLots(input.positionAddress,poolFact.tokenXMint)});
    if(!attributed.ok){
      await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:"RECONCILIATION_REQUIRED",at:new Date().toISOString(),reasonCodes:attributed.reasonCodes,payload:{stage:"CLOSE_POSITION_ATTRIBUTED_FEE_INVENTORY",tokenXBefore:tokenXBefore.toString(),tokenXAfter:tokenXAfter.toString(),newlyWithdrawnTokenX:newlyWithdrawnTokenX.toString()}});
      return{status:"UNKNOWN",planId:input.plan.planId,reasonCodes:attributed.reasonCodes,transactionSubmitted:true};
    }
    attributableTokenX=attributed.amountRaw;
    attributableFeeLotAllocations=[...(newlyWithdrawnTokenX>0n?[{lotId:`${input.plan.planId}:close-x:lot`,rawAmount:newlyWithdrawnTokenX}]:[]),...attributed.lotAllocations];
    if(attributableTokenY>0n)
      await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:close-token-y`,positionAddress:input.positionAddress,planId:input.plan.planId,flowType:"CLOSE_WITHDRAWAL",observedAt:new Date().toISOString(),tokenMint:poolFact.tokenYMint,tokenAmountRaw:attributableTokenY.toString(),payload:{source:"REMOVE_PLUS_CLAIM_DELTA",tokenYBefore:tokenYBefore.toString(),tokenYAfter:tokenYAfter.toString()}});
    await persist("CLOSE_INVENTORY_MEASURED", {
      tokenXBefore: tokenXBefore.toString(),
      tokenYBefore: tokenYBefore.toString(),
      tokenXAfter: tokenXAfter.toString(),
      tokenYAfter:tokenYAfter.toString(),
      attributableTokenX: attributableTokenX.toString(),
      newlyWithdrawnTokenX:newlyWithdrawnTokenX.toString(),
      attributableFeeLotAllocations:attributableFeeLotAllocations.map(allocation=>({lotId:allocation.lotId,rawAmount:allocation.rawAmount.toString()})),
      attributableOpenResidualLotAllocations:attributed.openResidualLotAllocations.map(allocation=>({lotId:allocation.lotId,rawAmount:allocation.rawAmount.toString()})),
      attributableTokenY:attributableTokenY.toString(),
    });
    stage = "CLOSE_INVENTORY_MEASURED";
  }

  if (stage === "CLOSE_INVENTORY_MEASURED") {
    if (attributableTokenX === undefined) {
      await input.store.transitionAutonomousPlan({
        planId: input.plan.planId,
        state: "RECONCILIATION_REQUIRED",
        at: new Date().toISOString(),
        reasonCodes: ["P6_CLOSE_RECOVERY_INVENTORY_MISSING"],
        payload: { stage },
      });
      return {
        status: "UNKNOWN",
        planId: input.plan.planId,
        reasonCodes: ["P6_CLOSE_RECOVERY_INVENTORY_MISSING"],
        transactionSubmitted: true,
      };
    }
    const retryRaw=Number(closeSettlementDispatch(input.plan).closeUnwindRetryCount??0),
      retryCount=Number.isSafeInteger(retryRaw)&&retryRaw>=0?retryRaw:0,
      unwindTransactionId=retryCount===0
        ? unwindStep.transactionId
        : `${unwindStep.transactionId}:retry-${retryCount}`;
    let swapProceedsLamports=0n;
    if (attributableTokenX > 0n) {
      // An expired primary unwind is conclusively no-effect, but it must
      // never reuse its signed child identity.  Recovery increments this
      // durable counter before returning here, so the retry has an
      // independent journal/submission record and cannot replay the expired
      // signature.
      const unwind = await executeJupiterUnwindStep({
        store: input.store,
        plan: closeChildPlan(input.plan, unwindTransactionId),
        signer: input.signer,
        config: input.config,
        amount: attributableTokenX,
        economicReferenceLamports: mutationCapital(input.plan),
        action: closeAction,
        transactionId: unwindTransactionId,
        idempotencyKey: `${input.plan.idempotencyKey}:${unwindTransactionId}`,
        stage: "CLOSE_TOKEN_X_UNWIND",
        reasonPrefix: "P6_CLOSE_UNWIND",
        afterSubmit: async ({ signature }) => persist("CLOSE_INVENTORY_MEASURED", {
          tokenXBefore: tokenXBefore!.toString(),
          tokenYBefore: tokenYBefore!.toString(),
          attributableTokenX: attributableTokenX!.toString(),
          attributableTokenY:attributableTokenY?.toString()??"0",
          closeUnwindRetryCount: retryCount,
          unwindTransactionId,
          pendingStage: "CLOSE_UNWIND_SUBMITTED",
          pendingSignature: signature,
        }),
      });
      if (!unwind.ok) return incomplete(unwind.reasonCodes, "CLOSE_UNWIND_PENDING");
      if (!unwind.signature)
        return incomplete(["P6_CLOSE_UNWIND_SIGNATURE_MISSING"], "CLOSE_UNWIND_SETTLEMENT_UNKNOWN");
      const settlement = await reconcileConfirmedCloseUnwind({
        store: input.store,
        connection,
        plan: input.plan,
        positionAddress: input.positionAddress,
        signature: unwind.signature,
        transactionId: unwindTransactionId,
        inputMint: poolFact.tokenXMint,
        inputAmountRaw: attributableTokenX,
        ...(attributableFeeLotAllocations.length?{lotAllocations:attributableFeeLotAllocations}:{}),
      });
      if (!settlement.ok)
        return incomplete(settlement.reasonCodes, "CLOSE_UNWIND_SETTLEMENT_UNKNOWN");
      swapProceedsLamports = settlement.swapProceedsLamports;
    }
    await persist("CLOSE_INVENTORY_UNWOUND", {
      tokenXBefore: tokenXBefore.toString(),
      tokenYBefore: tokenYBefore.toString(),
      attributableTokenX: attributableTokenX.toString(),
      attributableTokenY:attributableTokenY?.toString()??"0",
      closeUnwindRetryCount: retryCount,
      unwindTransactionId,
      swapProceedsLamports:swapProceedsLamports.toString(),
    });
    stage = "CLOSE_INVENTORY_UNWOUND";
  }

  if (stage !== "CLOSE_INVENTORY_UNWOUND" && stage !== "CLOSE_RECOVERED_OPEN_RESIDUAL_UNWOUND")
    throw new Error("LPFORGE_P6_CLOSE_SETTLEMENT_STAGE_INVALID");
  const tokenXPostUnwind = await readWalletTokenBalance({
    connection,
    ownerAddress: input.plan.ownerAddress,
    mint: poolFact.tokenXMint,
  });
  if (tokenXPostUnwind > tokenXBefore) {
    await input.store.transitionAutonomousPlan({
      planId: input.plan.planId,
      state: "RECONCILIATION_REQUIRED",
      at: new Date().toISOString(),
      reasonCodes: ["P6_CLOSE_TOKEN_X_RESIDUAL"],
      payload: {
        stage: "CLOSE_UNWIND_VERIFY",
        tokenXBefore: tokenXBefore.toString(),
        tokenXPostUnwind: tokenXPostUnwind.toString(),
      },
    });
    return {
      status: "UNKNOWN",
      planId: input.plan.planId,
      reasonCodes: ["P6_CLOSE_TOKEN_X_RESIDUAL"],
      transactionSubmitted: true,
    };
  }
  // A partial chunked OPEN can have a funded token-X residual that predates
  // the close snapshot.  It is not part of the REMOVE/CLAIM delta above and
  // must be independently proven, journaled, swapped and settled before the
  // PositionV2 account is closed.  This is deliberately distinct from the
  // normal close-unwind child so neither confirmed child can be replayed.
  if (stage === "CLOSE_INVENTORY_UNWOUND") {
    const recoveredOpenResidual=await ensureRecoveredOpenResidualInventory({
      store:input.store,
      connection,
      plan:input.plan,
      positionAddress:input.positionAddress,
      tokenMint:poolFact.tokenXMint,
      pairedTokenRawBeforeClose:tokenXBefore,
    });
    if(recoveredOpenResidual){
      // An expired residual-unwind has no chain effect, but it must never
      // reuse its old transaction/idempotency identity. Each proven-safe
      // recovery attempt receives a new child identity while remaining bound
      // to this same protective close plan.
      const retryRaw=Number(closeSettlementDispatch(input.plan).recoveredOpenResidualRetryCount??0),
        retryCount=Number.isSafeInteger(retryRaw)&&retryRaw>=0?retryRaw:0,
        transactionId=retryCount===0
          ? `${input.plan.planId}:recovered-open-residual-unwind`
          : `${input.plan.planId}:recovered-open-residual-unwind:retry-${retryCount}`,
        unwind=await executeJupiterUnwindStep({
          store:input.store,
          plan:closeChildPlan(input.plan,transactionId),
          signer:input.signer,
          config:input.config,
          amount:recoveredOpenResidual.rawAmount,
          economicReferenceLamports:mutationCapital(input.plan),
          action:closeAction,
          transactionId,
          idempotencyKey:`${input.plan.idempotencyKey}:${transactionId}`,
          stage:"CLOSE_RECOVERED_OPEN_RESIDUAL_UNWIND",
          reasonPrefix:"P6_CLOSE_RECOVERED_OPEN_RESIDUAL_UNWIND",
          afterSubmit:async({signature})=>persist("CLOSE_INVENTORY_UNWOUND",{
            tokenXBefore:tokenXBefore.toString(),
            tokenYBefore:tokenYBefore.toString(),
            attributableTokenX:attributableTokenX?.toString()??"0",
            attributableTokenY:attributableTokenY?.toString()??"0",
            recoveredOpenResidualLotId:recoveredOpenResidual.lotId,
            recoveredOpenResidualTokenMint:recoveredOpenResidual.tokenMint,
            recoveredOpenResidualRawAmount:recoveredOpenResidual.rawAmount.toString(),
            recoveredOpenResidualEntryPlanId:recoveredOpenResidual.entryPlanId,
            recoveredOpenResidualUnwindTransactionId:transactionId,
            recoveredOpenResidualRetryCount:retryCount,
            pendingStage:"CLOSE_OPEN_RESIDUAL_UNWIND_SUBMITTED",
            pendingSignature:signature,
          }),
        });
      if(!unwind.ok)return incomplete(unwind.reasonCodes,"CLOSE_OPEN_RESIDUAL_UNWIND_PENDING");
      if(!unwind.signature)return incomplete(["P6_CLOSE_RECOVERED_OPEN_RESIDUAL_UNWIND_SIGNATURE_MISSING"],"CLOSE_OPEN_RESIDUAL_UNWIND_SETTLEMENT_UNKNOWN");
      const settlement=await reconcileConfirmedCloseUnwind({
        store:input.store,
        connection,
        plan:input.plan,
        positionAddress:input.positionAddress,
        signature:unwind.signature,
        transactionId,
        inputMint:recoveredOpenResidual.tokenMint,
        inputAmountRaw:recoveredOpenResidual.rawAmount,
        lotId:recoveredOpenResidual.lotId,
        settlementIdSuffix:"recovered-open-residual",
      });
      if(!settlement.ok)return incomplete(settlement.reasonCodes,"CLOSE_OPEN_RESIDUAL_UNWIND_SETTLEMENT_UNKNOWN");
      await input.store.upsertPartialEntryRecovery({
        planId:recoveredOpenResidual.entryPlanId,
        poolAddress:String(recoveredOpenResidual.recoveryRow.pool_address),
        ownerAddress:String(recoveredOpenResidual.recoveryRow.owner_address),
        tokenMint:String(recoveredOpenResidual.recoveryRow.token_mint),
        fundingTransactionId:String(recoveredOpenResidual.recoveryRow.funding_transaction_id),
        fundingSignature:String(recoveredOpenResidual.recoveryRow.funding_signature),
        fundedAt:new Date(String(recoveredOpenResidual.recoveryRow.funded_at)).toISOString(),
        pairedTokenAmount:String(recoveredOpenResidual.recoveryRow.paired_token_amount),
        intendedCapitalLamports:BigInt(String(recoveredOpenResidual.recoveryRow.intended_capital_lamports)),
        intendedRange:(recoveredOpenResidual.recoveryRow.intended_range??{}) as Record<string,unknown>,
        state:"RESOLVED",
        walletTruth:{...(recoveredOpenResidual.recoveryRow.wallet_truth??{}),residualUnwindSignature:unwind.signature,residualUnwindRawAmount:recoveredOpenResidual.rawAmount.toString(),refreshedAt:new Date().toISOString()},
        payload:{reasonCodes:["P6_PARTIAL_OPEN_RESIDUAL_SETTLED"],closePlanId:input.plan.planId,recoveredOpenResidualLotId:recoveredOpenResidual.lotId},
        updatedAt:new Date().toISOString(),
      });
      await persist("CLOSE_RECOVERED_OPEN_RESIDUAL_UNWOUND",{
        tokenXBefore:tokenXBefore.toString(),
        tokenYBefore:tokenYBefore.toString(),
        attributableTokenX:attributableTokenX?.toString()??"0",
        attributableTokenY:attributableTokenY?.toString()??"0",
        recoveredOpenResidualLotId:recoveredOpenResidual.lotId,
        recoveredOpenResidualRawAmount:recoveredOpenResidual.rawAmount.toString(),
        recoveredOpenResidualUnwindTransactionId:transactionId,
        recoveredOpenResidualUnwindSignature:unwind.signature,
        recoveredOpenResidualRetryCount:retryCount,
        pendingStage:null,
        pendingSignature:null,
      });
      stage="CLOSE_RECOVERED_OPEN_RESIDUAL_UNWOUND";
    }
  }
  // A conclusively expired account-close child is no-effect evidence, not a
  // reusable transaction identity.  Retrying after all prerequisite inventory
  // is settled therefore receives a distinct durable child id.
  const closeAccountRetryRaw=Number(closeSettlementDispatch(input.plan).closeAccountRetryCount??0),
    closeAccountRetryCount=Number.isSafeInteger(closeAccountRetryRaw)&&closeAccountRetryRaw>=0?closeAccountRetryRaw:0,
    closeAccountTransactionId=closeAccountRetryCount===0
      ? closeStep.transactionId
      : `${closeStep.transactionId}:retry-${closeAccountRetryCount}`;
  const closedBuilt = await buildClosePositionTransaction(input.pool, {
    userAddress: input.plan.ownerAddress,
    positionAddress: input.positionAddress,
  });
  closedBuilt.metadata.transactionId = closeAccountTransactionId;
  // A no-effect expired close receives a fresh transaction identity.  That
  // identity must be materialized as a child step before its simulation (the
  // simulation/submission ledgers intentionally have a transaction-step FK).
  // Do not rely on the original close step: it is immutable expiry evidence.
  await input.store.ensureExecutionTransactionStep({
    planId:input.plan.planId,
    transactionId:closeAccountTransactionId,
    kind:"METEORA_CLOSE",
    state:"PLANNED",
    requiredSignerAddresses:closedBuilt.requiredSignerAddresses,
    metadata:{...closedBuilt.metadata,closeAccountRetryCount},
  });
  const closed = await executeMeteoraMutation({
    ...input,
    plan: closeChildPlan(input.plan, closeAccountTransactionId),
    built: closedBuilt,
    action: closeAction,
    afterSubmit: async ({ signature }) => persist("CLOSE_INVENTORY_UNWOUND", {
      tokenXBefore: tokenXBefore!.toString(),
      tokenYBefore: tokenYBefore!.toString(),
      attributableTokenX: attributableTokenX?.toString() ?? "0",
      attributableTokenY:attributableTokenY?.toString()??"0",
      closeAccountRetryCount,
      transactionId:closeAccountTransactionId,
      pendingStage: "CLOSE_POSITION_SUBMITTED",
      pendingSignature: signature,
    }),
    afterConfirmed: async ({ signature }) => {
      const rent=await persistConfirmedPositionRentRecovery({
        store:input.store,
        connection,
        plan:input.plan,
        positionAddress:input.positionAddress,
        signature,
        transactionId:closeAccountTransactionId,
      });
      if(!rent.ok)throw new Error(rent.reasonCodes.join(","));
    },
  });
  if(closed.status!=="RECONCILED")return incomplete(closed.reasonCodes,"CLOSE_POSITION_PENDING");
  // CLOSED is chain-account absence only.  Make the lifecycle terminal only
  // after the shared DB boundary proves every child transaction, lot and
  // cashflow can be reconciled into a deterministic SOL result.
  const settlement=await finalizeClosedPositionSettlement({...input,connection});
  if(!settlement.ready)return {status:"UNKNOWN",planId:input.plan.planId,reasonCodes:settlement.reasonCodes,transactionSubmitted:true};
  return closed;
}

/**
 * Only a claim with a durable confirmed/reconciled child outcome can require
 * receipt-backed fee attribution.  Earlier claim attempts may be retained as
 * immutable EXPIRED/FAILED evidence; selecting one of those attempts merely
 * because it sorts first would make a completed close permanently retry a
 * receipt that cannot exist.
 */
export function confirmedTerminalClaimTransactions(
  transactions: readonly LifecycleChildTransaction[],
): LifecycleChildTransaction[] {
  return transactions.filter(
    (transaction) =>
      transaction.planRole === "CLOSE" &&
      transaction.kind === "METEORA_CLAIM" &&
      transaction.state === "CONFIRMED" &&
      typeof transaction.signature === "string",
  );
}

/** A recovered close reaches the same durable settlement boundary as a normal close. */
async function finalizeClosedPositionSettlement(input:{store:Phase1Store;plan:AutonomousPlan;positionAddress:string;connection:Connection;config:SettlementFinalizationConfig}):Promise<{ready:boolean;reasonCodes:string[]}>{
  const positionCheck=await input.connection.getAccountInfoAndContext(new PublicKey(input.positionAddress),"confirmed");
  if(positionCheck.value!==null)return{ready:false,reasonCodes:["SETTLEMENT_POSITION_STILL_EXISTS"]};
  const dispatch=closeSettlementDispatch(input.plan),closeSignature=typeof dispatch.signature==="string"?dispatch.signature:typeof dispatch.pendingSignature==="string"?dispatch.pendingSignature:undefined,closeTransactionId=typeof dispatch.transactionId==="string"?dispatch.transactionId:undefined;
  if(!closeSignature||!closeTransactionId)return{ready:false,reasonCodes:["SETTLEMENT_CLOSE_RECEIPT_MISSING"]};
  const rent=await persistConfirmedPositionRentRecovery({store:input.store,connection:input.connection,plan:input.plan,positionAddress:input.positionAddress,signature:closeSignature,transactionId:closeTransactionId,observedAt:new Date().toISOString()});
  if(!rent.ok)return{ready:false,reasonCodes:rent.reasonCodes};
  let settlementInput=await input.store.loadLifecycleSettlementInput(input.positionAddress);
  if(!settlementInput)return{ready:false,reasonCodes:["SETTLEMENT_LIFECYCLE_MISSING"]};
  settlementInput={...settlementInput,cashflows:canonicalizeTerminalSettlementCashflows(settlementInput.cashflows)};
  // A retry is a distinct child.  Reconcile every confirmed claim child that
  // lacks its own cashflow; never ask RPC for a proven no-effect predecessor.
  for(const terminalClaim of confirmedTerminalClaimTransactions(settlementInput.transactions)){
    if(!terminalClaim.signature||settlementInput.cashflows.some(flow=>flow.flowType==='FEE_CLAIM'&&settlementFlowSignature(flow)===terminalClaim.signature))continue;
    const claim=await persistConfirmedClaimReceipt({store:input.store,connection:input.connection,plan:input.plan,positionAddress:input.positionAddress,signature:terminalClaim.signature,transactionId:terminalClaim.transactionId,observedAt:new Date().toISOString(),source:"CONFIRMED_TERMINAL_CLAIM_RECEIPT"});
    if(!claim.ok)return{ready:false,reasonCodes:claim.reasonCodes};
    settlementInput=await input.store.loadLifecycleSettlementInput(input.positionAddress);
    if(!settlementInput)return{ready:false,reasonCodes:["SETTLEMENT_LIFECYCLE_MISSING"]};
    settlementInput={...settlementInput,cashflows:canonicalizeTerminalSettlementCashflows(settlementInput.cashflows)};
  }
  const removeTransactionIds=Array.isArray(dispatch.removeTransactionIds)
    ? dispatch.removeTransactionIds.filter((value):value is string=>typeof value==="string")
    : typeof dispatch.removeTransactionId==="string"?[dispatch.removeTransactionId]:[];
  if(removeTransactionIds.length===0)return{ready:false,reasonCodes:["SETTLEMENT_REMOVE_RECEIPT_MISSING"]};
  let primaryRemoveSignature:string|undefined;
  for(const removeTransactionId of removeTransactionIds){
    const removeSignature=settlementInput.transactions.find(transaction=>transaction.transactionId===removeTransactionId)?.signature;
    if(!removeSignature)return{ready:false,reasonCodes:["SETTLEMENT_REMOVE_RECEIPT_MISSING"]};
    primaryRemoveSignature??=removeSignature;
    if(!settlementInput.cashflows.some(flow=>flow.flowType==='CLOSE_WITHDRAWAL'&&settlementFlowSignature(flow)===removeSignature)){
      const native=await persistConfirmedCloseNativeWithdrawal({store:input.store,connection:input.connection,plan:input.plan,positionAddress:input.positionAddress,signature:removeSignature,transactionId:removeTransactionId,observedAt:new Date().toISOString()});
      if(!native.ok)return{ready:false,reasonCodes:native.reasonCodes};
      settlementInput=await input.store.loadLifecycleSettlementInput(input.positionAddress);
      if(!settlementInput)return{ready:false,reasonCodes:["SETTLEMENT_LIFECYCLE_MISSING"]};
      settlementInput={...settlementInput,cashflows:canonicalizeTerminalSettlementCashflows(settlementInput.cashflows)};
    }
  }
  const at=new Date().toISOString(),positionCheckedAt=at,positionCheckedSlot=BigInt(positionCheck.context.slot),settlementEvidence={positionCheckedAt,positionCheckedSlot:positionCheckedSlot.toString(),rpcUrl:input.config.rpcUrl,commitment:"confirmed"};
  const chainReconciliation=await reconcileTerminalSettlementChainEffects({connection:input.connection,plan:input.plan,positionAddress:input.positionAddress,settlementInput});
  await input.store.upsertLifecycleSettlementChainReconciliation({positionAddress:input.positionAddress,closePlanId:input.plan.planId,status:chainReconciliation.ok?'RECONCILED_CHAIN':'RECONCILIATION_REQUIRED',chainSolInLamports:chainReconciliation.chainSolInLamports,chainSolOutLamports:chainReconciliation.chainSolOutLamports,dbSolInLamports:chainReconciliation.dbSolInLamports,dbSolOutLamports:chainReconciliation.dbSolOutLamports,reasonCodes:chainReconciliation.reasonCodes,payload:chainReconciliation.payload,observedAt:at});
  if(!chainReconciliation.ok){
    const reasonCodes=["SETTLEMENT_CASHFLOW_RECONCILIATION_REQUIRED",...chainReconciliation.reasonCodes];
    await input.store.markOwnedPositionLifecycle({positionAddress:input.positionAddress,lifecycleState:"RECONCILIATION_REQUIRED",reconciliationStatus:"SETTLEMENT_CHAIN_RECONCILIATION_REQUIRED",lastPlanId:input.plan.planId,at,payload:{stage:"SOL_SETTLEMENT_CHAIN_RECONCILIATION_BLOCKED",reasonCodes,lifecycleId:settlementInput.lifecycle.lifecycleId,settlementEvidence,chainReconciliation:chainReconciliation.payload}});
    await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:"RECONCILIATION_REQUIRED",at,reasonCodes,payload:{stage:"SOL_SETTLEMENT_CHAIN_RECONCILIATION_BLOCKED",lifecycleId:settlementInput.lifecycle.lifecycleId,chainReconciliation:chainReconciliation.payload}});
    return{ready:false,reasonCodes};
  }
  // A close is intentionally marked RECONCILIATION_REQUIRED until this
  // terminal boundary proves it can become SOL_SETTLED. Once the PositionV2
  // account is authoritatively absent, that marker is self-referential: its
  // own transaction ledger, inventory, cashflows, and reservations are still
  // assessed below and remain hard blockers, but the transitional marker must
  // not prevent the operation that clears it.
  // Older close plans recorded the wallet delta after REMOVE *and* CLAIM as
  // one CLOSE_WITHDRAWAL lot, while the claim receipt also created its own
  // FEE_CLAIM lot.  The receipt-bound claim is real; the overlap is not.  A
  // correction is permitted only when the already-confirmed aggregate unwind
  // is the exact terminal receipt for the aggregate lot.
  const aggregateCloseLot=settlementInput.inventoryLots.find(lot=>lot.planId===input.plan.planId&&lot.sourceEvent==='CLOSE_WITHDRAWAL'&&lot.status==='SETTLED');
  const openClaimLots=settlementInput.inventoryLots.filter(lot=>lot.planId===input.plan.planId&&lot.sourceEvent==='FEE_CLAIM'&&lot.status==='OPEN'&&lot.remainingRawAmount===lot.rawAmount&&lot.tokenMint===aggregateCloseLot?.tokenMint);
  const aggregateTerminal=(aggregateCloseLot?.payload.terminalSettlement??{}) as Record<string,unknown>,aggregateSignature=typeof aggregateTerminal.transactionSignature==='string'?aggregateTerminal.transactionSignature:undefined;
  if(aggregateCloseLot&&aggregateSignature)for(const claimLot of openClaimLots){
    const claimReceipt=(claimLot.payload.signature??'') as string;
    if(!claimReceipt||!claimLot.sourceCashflowId)continue;
    await input.store.correctAggregateCloseClaimAttribution({eventId:`${input.plan.planId}:aggregate-claim-attribution:${claimLot.lotId}`,closeLotId:aggregateCloseLot.lotId,claimLotId:claimLot.lotId,planId:input.plan.planId,claimRawAmount:claimLot.rawAmount,transactionSignature:aggregateSignature,observedAt:at,payload:{source:'RECEIPT_BOUND_REMOVE_PLUS_CLAIM_OVERLAP_CORRECTION_V1',claimReceipt,aggregateUnwindSignature:aggregateSignature}});
  }
  settlementInput=await input.store.loadLifecycleSettlementInput(input.positionAddress);
  if(!settlementInput)return{ready:false,reasonCodes:["SETTLEMENT_LIFECYCLE_MISSING"]};
  // Dust is a retained, valued inventory disposition, never an inferred zero
  // balance.  Only a fresh Meteora pool USD price and an exact current wallet
  // balance match can authorize it.  This deliberately fails closed for an
  // unknown/stale price, a missing claim receipt, or mixed owner inventory.
  const threshold=input.config.residualDustThresholdUsd??0;
  if(threshold>0){
    const unresolved=settlementInput.inventoryLots.filter(lot=>(lot.status==='OPEN'||lot.status==='PARTIALLY_SETTLED')&&lot.remainingRawAmount>0n);
    if(unresolved.length){
      let priced:Awaited<ReturnType<ReturnType<typeof createMeteoraDataApi>['getPool']>>|undefined;
      try{priced=await createMeteoraDataApi({...(input.config.meteoraDataApiUrl?{baseUrl:input.config.meteoraDataApiUrl}:{}),...(input.config.dataApiMaxRps===undefined?{}:{maxRps:input.config.dataApiMaxRps}),...(input.config.httpTimeoutMs===undefined?{}:{timeoutMs:input.config.httpTimeoutMs})}).getPool(input.plan.poolAddress);}catch{/* unavailable valuations remain a terminal blocker */}
      for(const lot of unresolved){
        const sameMint=unresolved.filter(other=>other.tokenMint===lot.tokenMint),attributed=sameMint.reduce((total,other)=>total+other.remainingRawAmount,0n),wallet=await readWalletTokenBalance({connection:input.connection,ownerAddress:input.plan.ownerAddress,mint:lot.tokenMint}),token=[priced?.token_x,priced?.token_y].find(token=>token?.address===lot.tokenMint),price=token?.price,valuationAt=new Date().toISOString();
        if(wallet!==attributed||lot.sourceEvent==='FEE_CLAIM'&&(!lot.sourceCashflowId||typeof lot.payload.signature!=='string'))continue;
        const dust=assessResidualDustDisposition({rawAmount:lot.remainingRawAmount,decimals:lot.decimals,unitPriceUsd:price,valuationAt,now:at,thresholdUsd:threshold});
        if(!dust.eligible)continue;
        await input.store.retainPositionInventoryLotDust({eventId:`${input.plan.planId}:dust-retained:${lot.lotId}`,lotId:lot.lotId,planId:input.plan.planId,observedAt:at,payload:{state:'DUST_RETAINED',rawAmount:lot.remainingRawAmount.toString(),decimals:lot.decimals,usdValue:dust.usdValue,unitPriceUsd:price,valuationAt,valuationSource:'METEORA_DATA_API_POOL_TOKEN_PRICE',thresholdUsd:threshold,policyHash:input.config.policyHash??null,positionAddress:input.positionAddress,inventoryProvenance:{sourceEvent:lot.sourceEvent,sourceCashflowId:lot.sourceCashflowId??null}}});
      }
      settlementInput=await input.store.loadLifecycleSettlementInput(input.positionAddress);
      if(!settlementInput)return{ready:false,reasonCodes:["SETTLEMENT_LIFECYCLE_MISSING"]};
    }
  }
  const assessment=assessLifecycleSettlement({...settlementInput,reconciliationClean:true,positionAbsent:true,positionCheckedAt,positionCheckedSlot});
  if(!assessment.ready){
    await input.store.markOwnedPositionLifecycle({positionAddress:input.positionAddress,lifecycleState:"RECONCILIATION_REQUIRED",reconciliationStatus:"SETTLEMENT_BLOCKED",lastPlanId:input.plan.planId,at,payload:{stage:"SOL_SETTLEMENT_BLOCKED",reasonCodes:assessment.reasonCodes,lifecycleId:settlementInput.lifecycle.lifecycleId,settlementEvidence}});
    await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:"RECONCILIATION_REQUIRED",at,reasonCodes:assessment.reasonCodes,payload:{stage:"SOL_SETTLEMENT_BLOCKED",lifecycleId:settlementInput.lifecycle.lifecycleId}});
    return{ready:false,reasonCodes:assessment.reasonCodes};
  }
  const migrationHead=runtimeMigrationHead();
  const persisted=await input.store.persistLifecycleSolSettlement({assessment,input:{...settlementInput,positionAbsent:true,positionCheckedAt,positionCheckedSlot},...(process.env.LPFORGE_SOURCE_COMMIT?{sourceCommit:process.env.LPFORGE_SOURCE_COMMIT}:{}),...(process.env.LPFORGE_P7_POLICY_HASH?{policyHash:process.env.LPFORGE_P7_POLICY_HASH}:{}),...(migrationHead?{migrationHead}:{}),...(process.env.LPFORGE_BUILD_ID?{buildId:process.env.LPFORGE_BUILD_ID}:{}),at});
  const rootClosePlanId=typeof dispatch.terminalRootClosePlanId==='string'?dispatch.terminalRootClosePlanId:input.plan.planId,
    claimSignatures=confirmedTerminalClaimTransactions(settlementInput.transactions)
      .filter(transaction=>transaction.planId===rootClosePlanId)
      .flatMap(transaction=>transaction.signature?[transaction.signature]:[]);
  if(!primaryRemoveSignature)return{ready:false,reasonCodes:["SETTLEMENT_REMOVE_RECEIPT_MISSING"]};
  await input.store.finalizeCloseFeeAttribution({closePlanId:rootClosePlanId,positionAddress:input.positionAddress,removeSignature:primaryRemoveSignature,...(claimSignatures.length===0?{}:{claimSignatures}),terminalSettlementId:persisted.settlementId,at});
  // The report is built from the just-committed immutable settlement and its
  // finalized close attribution before audit compaction.  It is only a
  // snapshot for the durable alert outbox; no report field can affect this
  // canonical close or its accounting.
  const postTradeReport=input.config.postTradeReporting?.enabled
    ?await input.store.loadCanonicalPostTradeReport({settlementId:persisted.settlementId,runningStatsStartAt:input.config.postTradeReporting.runningStatsStartAt,reportPolicyVersion:input.config.postTradeReporting.policyVersion})
    :undefined;
  await input.store.compactPositionManagementDecisionAudit({positionAddress:input.positionAddress,at});
  // Existing research outcomes are immutable. A settlement supersession fixes
  // the accounting authority without mutating or duplicating V3 evidence.
  if(persisted.created&&!persisted.superseded){
    const outcome=await input.store.createLiveSolSettledLearningOutcome({positionAddress:input.positionAddress,at});
    if(!outcome.outcome)throw new Error(`LPFORGE_LIVE_OUTCOME_MATERIALIZATION_FAILED:${outcome.reasonCodes.join(',')}`);
  }
  if(postTradeReport)queuePositionSettledAlert(postTradeReport);
  return{ready:true,reasonCodes:[]};
}

/**
 * A successor produced after an expired account-close child is intentionally
 * incapable of removing liquidity, claiming fees, or invoking Jupiter.  It
 * re-reads PositionV2 immediately before the one remaining action.
 */
async function executeAccountCloseOnlyRecovery(input:{
  store:Phase1Store; plan:AutonomousPlan; signer:MainnetSignerBackend; config:LiveWorkerConfig;
  pool:MeteoraOpenAddPoolLike & MeteoraRemoveClaimPoolLike; positionAddress:string;
}):Promise<LiveWorkerResult>{
  const closeSteps=input.plan.steps.filter(step=>step.kind==='METEORA_CLOSE'),closeStep=closeSteps[0];
  if(!closeStep||closeSteps.length!==1||input.plan.steps.length!==1)throw new Error('LPFORGE_ACCOUNT_CLOSE_ONLY_STEP_INVALID');
  const connection=createGovernedConnection({rpcUrl:input.config.rpcUrl,priority:'P0_EXECUTION_CRITICAL'}),at=new Date().toISOString();
  let account;
  try{account=await connection.getAccountInfo(new PublicKey(input.positionAddress),'confirmed');}catch{
    await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:'RECONCILIATION_REQUIRED',at,reasonCodes:['P6_ACCOUNT_CLOSE_ONLY_ACCOUNT_READ_UNKNOWN'],payload:{stage:'ACCOUNT_CLOSE_ONLY_CHAIN_READ_UNKNOWN'}});
    return{status:'UNKNOWN',planId:input.plan.planId,reasonCodes:['P6_ACCOUNT_CLOSE_ONLY_ACCOUNT_READ_UNKNOWN'],transactionSubmitted:false};
  }
  if(account===null){
    await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:'RECONCILIATION_REQUIRED',at,reasonCodes:['P6_ACCOUNT_CLOSE_ONLY_ACCOUNT_ALREADY_ABSENT_RECONCILE'],payload:{stage:'ACCOUNT_CLOSE_ONLY_ACCOUNT_ABSENT'}});
    return{status:'UNKNOWN',planId:input.plan.planId,reasonCodes:['P6_ACCOUNT_CLOSE_ONLY_ACCOUNT_ALREADY_ABSENT_RECONCILE'],transactionSubmitted:false};
  }
  let fact:Awaited<ReturnType<ReturnType<typeof createMeteoraReadAdapter>['getPositionV2']>>;
  try{fact=await createMeteoraReadAdapter({rpcUrl:input.config.rpcUrl,cluster:'mainnet-beta',programId:input.config.programId,priority:'P0_EXECUTION_CRITICAL'}).getPositionV2(input.plan.poolAddress,input.positionAddress);}catch{
    await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:'RECONCILIATION_REQUIRED',at,reasonCodes:['P6_ACCOUNT_CLOSE_ONLY_POSITION_READ_UNKNOWN'],payload:{stage:'ACCOUNT_CLOSE_ONLY_POSITION_READ_UNKNOWN'}});
    return{status:'UNKNOWN',planId:input.plan.planId,reasonCodes:['P6_ACCOUNT_CLOSE_ONLY_POSITION_READ_UNKNOWN'],transactionSubmitted:false};
  }
  if(fact.owner!==input.plan.ownerAddress||fact.pool!==input.plan.poolAddress){
    await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:'RECONCILIATION_REQUIRED',at,reasonCodes:['P6_ACCOUNT_CLOSE_ONLY_POSITION_IDENTITY_MISMATCH'],payload:{stage:'ACCOUNT_CLOSE_ONLY_IDENTITY_MISMATCH'}});
    return{status:'BLOCKED',planId:input.plan.planId,reasonCodes:['P6_ACCOUNT_CLOSE_ONLY_POSITION_IDENTITY_MISMATCH'],transactionSubmitted:false};
  }
  const lots=await input.store.loadPositionInventoryLots(input.positionAddress),unresolvedLots=lots.filter(lot=>lot.remainingRawAmount>0n).length;
  const check=assessAccountCloseOnlyRecovery({priorAccountClose:'EXPIRED_NO_EFFECT',remove:'CONFIRMED_EFFECT',claim:'NOT_REQUIRED',primaryUnwind:'CONFIRMED_EFFECT',residualUnwind:'CONFIRMED_EFFECT',positionExists:true,totalXAmount:BigInt(fact.totalXAmount??'0'),totalYAmount:BigInt(fact.totalYAmount??'0'),feeX:BigInt(fact.feeX??'0'),feeY:BigInt(fact.feeY??'0'),rewardOne:BigInt(fact.rewardOne??'0'),rewardTwo:BigInt(fact.rewardTwo??'0'),unresolvedInventoryLots:unresolvedLots});
  if(!check.eligible){
    await input.store.markOwnedPositionLifecycle({positionAddress:input.positionAddress,lifecycleState:'RECONCILIATION_REQUIRED',reconciliationStatus:'TERMINALIZATION_DEBT',lastPlanId:input.plan.planId,at,payload:{stage:'ACCOUNT_CLOSE_ONLY_PRECONDITION_FAILED',reasonCodes:check.reasonCodes,accountCloseOnly:true}});
    await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:'RECONCILIATION_REQUIRED',at,reasonCodes:check.reasonCodes,payload:{stage:'ACCOUNT_CLOSE_ONLY_PRECONDITION_FAILED'}});
    return{status:'BLOCKED',planId:input.plan.planId,reasonCodes:check.reasonCodes,transactionSubmitted:false};
  }
  const built=await buildClosePositionTransaction(input.pool,{userAddress:input.plan.ownerAddress,positionAddress:input.positionAddress});
  built.metadata.transactionId=closeStep.transactionId;
  const closed=await executeMeteoraMutation({...input,built,action:'CLOSE',deferCompletion:true,afterSubmit:async({signature})=>input.store.transitionAutonomousPlan({planId:input.plan.planId,state:'RECONCILING',at:new Date().toISOString(),payload:{stage:'ACCOUNT_CLOSE_ONLY_SUBMITTED',accountCloseOnly:true,pendingStage:'ACCOUNT_CLOSE_ONLY_SUBMITTED',pendingSignature:signature,signature,transactionId:closeStep.transactionId}}),afterConfirmed:async({signature})=>{const rent=await persistConfirmedPositionRentRecovery({store:input.store,connection,plan:input.plan,positionAddress:input.positionAddress,signature,transactionId:closeStep.transactionId});if(!rent.ok)throw new Error(rent.reasonCodes.join(','));}});
  if(closed.status!=='RECONCILED')return closed;
  const settlement=await finalizeClosedPositionSettlement({store:input.store,plan:input.plan,positionAddress:input.positionAddress,connection,config:input.config});
  if(!settlement.ready)return{status:'UNKNOWN',planId:input.plan.planId,reasonCodes:settlement.reasonCodes,transactionSubmitted:true};
  await input.store.completeAutonomousPlan({planId:input.plan.planId,state:'COMPLETED',at:new Date().toISOString(),payload:{action:'CLOSE',recovery:'ACCOUNT_CLOSE_ONLY_SETTLED',accountCloseOnly:true}});
  return closed;
}

/** Generic plan entrypoint. Every mutation is claimed through the same durable queue. */
export async function executeAutonomousPlan(input: {
  store: Phase1Store;
  plan: AutonomousPlan;
  signer: MainnetSignerBackend;
  config: LiveWorkerConfig;
}): Promise<LiveWorkerResult> {
  // Recovery resumes an already-journaled close at its next durable stage.
  // Never overwrite its last confirmed submission with PLAN_CREATED.
  if (!(await input.store.getExecutionJournal(input.plan.idempotencyKey)))
    await recordJournal(input.store, input.plan, "PLAN_CREATED", {
      action: input.plan.action,
    });
  if (input.plan.action === "OPEN")
    return executeAutonomousOpen({
      store: input.store,
      plan: openPlan(input.plan),
      signer: input.signer,
      config: input.config,
    });
  const pool = (await createLiveMeteoraOpenPool({
      rpcUrl: input.config.rpcUrl,
      poolAddress: input.plan.poolAddress,
      programId: input.config.programId,
    })) as MeteoraOpenAddPoolLike & MeteoraRemoveClaimPoolLike,
    positionAddress = input.plan.positionAddress;
  if (!positionAddress)
    throw new Error(`LPFORGE_P6_POSITION_REQUIRED:${input.plan.action}`);
  await input.store.linkPositionLifecyclePlan({positionAddress,planId:input.plan.planId,role:input.plan.action==="CLOSE"||input.plan.action==="EMERGENCY_CLOSE"?"CLOSE":"MANAGEMENT",at:new Date().toISOString()});
  const step = input.plan.steps[0];
  if (!step) throw new Error("LPFORGE_P6_MUTATION_STEP_REQUIRED");
  if (input.plan.action === "CLAIM") {
    const claimConnection=createGovernedConnection({rpcUrl:input.config.rpcUrl,priority:'P0_EXECUTION_CRITICAL'}),claimPoolFact=await createMeteoraReadAdapter({rpcUrl:input.config.rpcUrl,cluster:"mainnet-beta",programId:input.config.programId,priority:'P0_EXECUTION_CRITICAL'}).getPool(input.plan.poolAddress),claimBeforeX=await readWalletTokenBalance({connection:claimConnection,ownerAddress:input.plan.ownerAddress,mint:claimPoolFact.tokenXMint}),claimBeforeY=await readWalletTokenBalance({connection:claimConnection,ownerAddress:input.plan.ownerAddress,mint:claimPoolFact.tokenYMint});
    let built;
    try {
      built = await buildClaimTransactions(pool, {
        userAddress: input.plan.ownerAddress,
        positionAddress,
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "LPFORGE_METEORA_CLAIM_NOTHING_TO_CLAIM") throw error;
      await input.store.completeAutonomousPlan({
        planId: input.plan.planId,
        state: "RECONCILED",
        at: new Date().toISOString(),
        payload: { action: "CLAIM", positionAddress, noAccruedFees: true },
      });
      return {
        status: "RECONCILED",
        planId: input.plan.planId,
        reasonCodes: ["P6_CLAIM_NOTHING_TO_CLAIM"],
        transactionSubmitted: false,
      };
    }
    if (built.length !== 1)
      throw new Error("LPFORGE_P6_MULTI_TRANSACTION_CLAIM_UNSUPPORTED");
    built[0]!.metadata.transactionId = step.transactionId;
    return executeMeteoraMutation({
      ...input,
      built: built[0]!,
      action: "CLAIM",
      // This is deliberately inside the submitted mutation lifecycle. A
      // balance read/write failure after the claim is sent is reconciliation
      // debt, never a completed plan with missing realized-fee evidence.
      afterConfirmed: async({signature})=>{
      const afterX=await readWalletTokenBalance({connection:claimConnection,ownerAddress:input.plan.ownerAddress,mint:claimPoolFact.tokenXMint}),afterY=await readWalletTokenBalance({connection:claimConnection,ownerAddress:input.plan.ownerAddress,mint:claimPoolFact.tokenYMint}),observedAt=new Date().toISOString();
      if(afterX>claimBeforeX){const rawAmount=afterX-claimBeforeX,cashflowId=`${input.plan.planId}:claim-x`;await input.store.insertPositionCashflow({cashflowId,positionAddress,planId:input.plan.planId,flowType:'FEE_CLAIM',observedAt,tokenMint:claimPoolFact.tokenXMint,tokenAmountRaw:rawAmount.toString(),payload:{source:'WALLET_DELTA'}});await recordPositionTokenXLot({store:input.store,connection:claimConnection,plan:input.plan,positionAddress,tokenMint:claimPoolFact.tokenXMint,sourceEvent:"FEE_CLAIM",sourceCashflowId:cashflowId,rawAmount,observedAt,signature});}
      if(afterY>claimBeforeY)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:claim-y`,positionAddress,planId:input.plan.planId,flowType:'FEE_CLAIM',observedAt,tokenMint:claimPoolFact.tokenYMint,tokenAmountRaw:(afterY-claimBeforeY).toString(),payload:{source:'WALLET_DELTA'}});
      const receipt=await loadConfirmedExecutionReceipt(claimConnection,signature);if(receipt.state==="CONFIRMED_SUCCESS"){const ownerIndex=receipt.resolvedAccountKeys.indexOf(input.plan.ownerAddress),pre=ownerIndex>=0?receipt.preBalancesLamports[ownerIndex]:undefined,post=ownerIndex>=0?receipt.postBalancesLamports[ownerIndex]:undefined,gross=pre!==undefined&&post!==undefined?post-pre+(receipt.feeLamports??0n):0n;if(gross>0n)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:claim-native-sol`,positionAddress,planId:input.plan.planId,flowType:"FEE_CLAIM",observedAt,lamports:gross,tokenMint:WSOL_MINT,tokenAmountRaw:gross.toString(),payload:{source:"CONFIRMED_RECEIPT_OWNER_NATIVE_DELTA",signature,feeLamports:(receipt.feeLamports??0n).toString()}});}
      },
    });
  }
  if (input.plan.action === "REDUCE") {
    const reductionConnection=createGovernedConnection({rpcUrl:input.config.rpcUrl,priority:'P0_EXECUTION_CRITICAL'}),reductionPoolFact=await createMeteoraReadAdapter({rpcUrl:input.config.rpcUrl,cluster:"mainnet-beta",programId:input.config.programId,priority:'P0_EXECUTION_CRITICAL'}).getPool(input.plan.poolAddress),reductionBeforeX=await readWalletTokenBalance({connection:reductionConnection,ownerAddress:input.plan.ownerAddress,mint:reductionPoolFact.tokenXMint}),reductionBeforeY=await readWalletTokenBalance({connection:reductionConnection,ownerAddress:input.plan.ownerAddress,mint:reductionPoolFact.tokenYMint}),range = await chainMutationRange({
        plan: input.plan,
        stepMetadata: step.metadata,
        rpcUrl: input.config.rpcUrl,
        programId: input.config.programId,
        positionAddress,
      }),
      bps = Number(
        input.plan.intentPayload.reductionBps ?? step.metadata.bps ?? 0,
      ),
      built = await buildRemoveLiquidityTransactions(pool, {
        userAddress: input.plan.ownerAddress,
        positionAddress,
        fromBinId: range.lower,
        toBinId: range.upper,
        bps,
        claimAndClose: false,
      });
    if (built.length !== 1)
      throw new Error("LPFORGE_P6_MULTI_TRANSACTION_REMOVE_UNSUPPORTED");
    built[0]!.metadata.transactionId = step.transactionId;
    return executeMeteoraMutation({
      ...input,
      built: built[0]!,
      action: "REDUCE",
      // Record what actually reached the owner's wallet.  The former
      // percentage-of-basis record was a sizing estimate, not a withdrawal.
      afterConfirmed: async({signature})=>{
        const afterX=await readWalletTokenBalance({connection:reductionConnection,ownerAddress:input.plan.ownerAddress,mint:reductionPoolFact.tokenXMint}),afterY=await readWalletTokenBalance({connection:reductionConnection,ownerAddress:input.plan.ownerAddress,mint:reductionPoolFact.tokenYMint}),observedAt=new Date().toISOString();
        if(afterX>reductionBeforeX){const rawAmount=afterX-reductionBeforeX,cashflowId=`${input.plan.planId}:reduce-x`;await input.store.insertPositionCashflow({cashflowId,positionAddress,planId:input.plan.planId,flowType:'REDUCE_WITHDRAWAL',observedAt,tokenMint:reductionPoolFact.tokenXMint,tokenAmountRaw:rawAmount.toString(),payload:{source:'WALLET_DELTA'}});await recordPositionTokenXLot({store:input.store,connection:reductionConnection,plan:input.plan,positionAddress,tokenMint:reductionPoolFact.tokenXMint,sourceEvent:"REDUCE_WITHDRAWAL",sourceCashflowId:cashflowId,rawAmount,observedAt,signature});}
        if(afterY>reductionBeforeY)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:reduce-y`,positionAddress,planId:input.plan.planId,flowType:'REDUCE_WITHDRAWAL',observedAt,tokenMint:reductionPoolFact.tokenYMint,tokenAmountRaw:(afterY-reductionBeforeY).toString(),payload:{source:'WALLET_DELTA'}});
      },
    });
  }
  if (
    input.plan.action === "CLOSE" ||
    input.plan.action === "EMERGENCY_CLOSE"
  ) {
    if (isAccountCloseOnlyPlan(input.plan))
      return executeAccountCloseOnlyRecovery({ ...input, pool, positionAddress });
    return executeCloseSettlement({ ...input, pool, positionAddress });
  }
  if (input.plan.action === "ADD") {
    const range = mutationRange(input.plan),
      funding = input.plan.intentPayload.entryFunding as
        | Record<string, unknown>
        | undefined,
      strategy = (
        input.plan.planPayload.intent as Record<string, unknown> | undefined
      )?.strategy;
    if (!funding || typeof strategy !== "string")
      throw new Error("LPFORGE_P6_ADD_FUNDING_REQUIRED");
    const built = await buildAddLiquidityTransaction(pool, {
      userAddress: input.plan.ownerAddress,
      positionAddress,
      totalXAmount: String(funding.totalPairedTokenRaw ?? ""),
      totalYAmount: String(funding.solForLpLamports ?? ""),
      lowerBinId: range.lower,
      upperBinId: range.upper,
      strategy: strategy as "SPOT" | "CURVE" | "BID_ASK",
    });
    const additionalCapital=mutationCapital(input.plan);
    if(additionalCapital<=0n)throw new Error("LPFORGE_P6_ADD_CAPITAL_REQUIRED");
    const owned=(await input.store.loadOwnedPositions(input.plan.ownerAddress)).find(row=>String(row.position_address??'')===positionAddress);
    if(!owned)throw new Error("LPFORGE_P6_ADD_OWNED_POSITION_REQUIRED");
    let priorCapital:bigint;try{priorCapital=BigInt(String(owned.initial_capital_lamports));}catch{throw new Error("LPFORGE_P6_ADD_POSITION_CAPITAL_INVALID");}
    built.metadata.transactionId = step.transactionId;
    return executeMeteoraMutation({ ...input, built, action: "ADD", afterConfirmed:async({signature})=>{
      await input.store.adjustOwnedPositionCapital({positionAddress,capitalLamports:priorCapital+additionalCapital,at:new Date().toISOString(),payload:{planId:input.plan.planId,priorCapitalLamports:priorCapital.toString(),additionalCapitalLamports:additionalCapital.toString(),signature}});
      await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:add-contribution`,positionAddress,planId:input.plan.planId,flowType:'ADD_CONTRIBUTION',observedAt:new Date().toISOString(),lamports:additionalCapital,payload:{signature,source:'CONFIRMED_PLAN_CAPITAL'}});
    }});
  }
  if (input.plan.action === "RESHAPE" || input.plan.action === "REBALANCE")
    return executeManagementReplacement({ ...input, pool, positionAddress });
  throw new Error(`LPFORGE_P6_ACTION_UNSUPPORTED:${input.plan.action}`);
}
async function createAccountCloseOnlySuccessor(input:{store:Phase1Store;plan:AutonomousPlan;positionAddress:string;positionTruth:Record<string,unknown>;now:string}):Promise<{created:boolean;planId?:string;reasonCodes:string[]}>{
  // The failed parent remains recoverable only until one successor exists.
  // Repeated ticks and restarts must converge on that successor, never fan
  // out into several account-close transactions.
  const activePlans=await input.store.loadActiveAutonomousPlansForPosition(input.positionAddress),activeSuccessors=[] as typeof activePlans;
  for(const candidate of activePlans){
    if(candidate.action!=='CLOSE')continue;
    const successor=await input.store.loadAutonomousPlan(candidate.planId);
    if(successor&&isExactAccountCloseOnlySuccessor({parent:input.plan,successor}))activeSuccessors.push(candidate);
  }
  const selected=selectCanonicalAccountCloseOnlySuccessor(activeSuccessors);
  if(selected.canonical){
    const canonical=selected.canonical;
    for(const duplicate of selected.duplicates){
      await input.store.completeAutonomousPlan({planId:duplicate.planId,state:'FAILED',at:input.now,payload:{action:'CLOSE',recovery:'ACCOUNT_CLOSE_ONLY_DUPLICATE_SUPERSEDED',accountCloseOnly:true,canonicalSuccessorPlanId:canonical.planId,reasonCodes:['P6_ACCOUNT_CLOSE_ONLY_DUPLICATE_SUPPRESSED']}});
    }
    return{created:false,planId:canonical.planId,reasonCodes:[...(selected.duplicates.length>0?['P6_ACCOUNT_CLOSE_ONLY_DUPLICATE_SUPPRESSED']:[]),'P6_ACCOUNT_CLOSE_ONLY_SUCCESSOR_ALREADY_ACTIVE']};
  }
  const dispatch=closeSettlementDispatch(input.plan),settlement=await input.store.loadLifecycleSettlementInput(input.positionAddress);
  if(!settlement)return{created:false,reasonCodes:['P6_ACCOUNT_CLOSE_ONLY_LIFECYCLE_MISSING']};
  const stringList=(value:unknown):string[]=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[],
    removeIds=stringList(dispatch.removeTransactionIds).length>0?stringList(dispatch.removeTransactionIds):stringList(dispatch.removeChildTransactionIds),
    claimIds=stringList(dispatch.claimTransactionIds).length>0?stringList(dispatch.claimTransactionIds):typeof dispatch.claimTransactionId==='string'?[dispatch.claimTransactionId]:[],
    primaryUnwindIds=typeof dispatch.unwindTransactionId==='string'?[dispatch.unwindTransactionId]:[],
    residualUnwindIds=typeof dispatch.recoveredOpenResidualUnwindTransactionId==='string'?[dispatch.recoveredOpenResidualUnwindTransactionId]:[],
    effect=(transactionIds:string[],required=false)=>canonicalTerminalActionEffect({transactions:settlement.transactions,planId:input.plan.planId,transactionIds,required}),
    lots=await input.store.loadPositionInventoryLots(input.positionAddress),check=assessAccountCloseOnlyRecovery({
    priorAccountClose:'EXPIRED_NO_EFFECT',remove:effect(removeIds,true),claim:dispatch.claimTransactionSkipped===true?'NOT_REQUIRED':effect(claimIds,true),primaryUnwind:effect(primaryUnwindIds),residualUnwind:effect(residualUnwindIds),positionExists:input.positionTruth.exists===true?true:input.positionTruth.exists===false?false:'UNKNOWN',totalXAmount:BigInt(String(input.positionTruth.totalXAmount??'0')),totalYAmount:BigInt(String(input.positionTruth.totalYAmount??'0')),feeX:BigInt(String(input.positionTruth.feeX??'0')),feeY:BigInt(String(input.positionTruth.feeY??'0')),rewardOne:BigInt(String(input.positionTruth.rewardOne??'0')),rewardTwo:BigInt(String(input.positionTruth.rewardTwo??'0')),unresolvedInventoryLots:lots.filter(lot=>lot.remainingRawAmount>0n).length,
  });
  if(!check.eligible)return{created:false,reasonCodes:check.reasonCodes};
  const priorGeneration=Number(dispatch.accountCloseOnlyRecoveryGeneration??0),generation=Number.isInteger(priorGeneration)&&priorGeneration>=0?priorGeneration+1:1,id=accountCloseOnlySuccessorIdentity({planId:input.plan.planId,generation}),capitalLamports=String((input.plan.planPayload.intent as Record<string,unknown>|undefined)?.capitalLamports??'');
  if(!/^\d+$/.test(capitalLamports)||BigInt(capitalLamports)<=0n)return{created:false,reasonCodes:['P6_ACCOUNT_CLOSE_ONLY_CAPITAL_MISSING']};
  const expiresAt=new Date(Date.parse(input.now)+300_000).toISOString(),intentPayload={terminalRecovery:true,accountCloseOnly:true,predecessorPlanId:input.plan.planId,capitalLamports,reasonCodes:['P6_ACCOUNT_CLOSE_ONLY_SUCCESSOR']},planIntent={capitalLamports,candidateId:null},steps=[{transactionId:id.transactionId,sequence:1,kind:'METEORA_CLOSE',state:'PLANNED',requiredSignerAddresses:[input.plan.ownerAddress],metadata:{accountCloseOnly:true,recoveryGeneration:generation,predecessorPlanId:input.plan.planId}}],rootProvenance=((input.plan.planPayload.provenance??{}) as Record<string,unknown>),provenance:Record<string,unknown>={producer:'LPFORGE_PRODUCTION',schemaVersion:1,intentId:id.intentId,poolAddress:input.plan.poolAddress,observedAt:input.now,terminalRecovery:true,predecessorPlanId:input.plan.planId,phase7Control:rootProvenance.phase7Control??null};
  const secret=process.env.LPFORGE_PLAN_PROVENANCE_SECRET;
  if(secret){provenance.hmac=computePlanProvenanceHmac({producer:'LPFORGE_PRODUCTION',schemaVersion:1,intentId:id.intentId,poolAddress:input.plan.poolAddress,observedAt:input.now,action:'CLOSE',ownerAddress:input.plan.ownerAddress,positionAddress:input.positionAddress,expiresAt,immutablePlan:{intentPayload,planIntent,steps:steps.map(step=>({transactionId:step.transactionId,sequence:step.sequence,kind:step.kind,requiredSignerAddresses:[...step.requiredSignerAddresses],metadata:step.metadata}))},phase7Control:(provenance.phase7Control??null) as Record<string,unknown>|null},secret);}
  await input.store.insertExecutionIntent({intentId:id.intentId,idempotencyKey:id.idempotencyKey,action:'CLOSE',poolAddress:input.plan.poolAddress,ownerAddress:input.plan.ownerAddress,positionAddress:input.positionAddress,thesisId:input.plan.thesisId,observedAt:input.now,expiresAt,payload:intentPayload});
  await input.store.insertTransactionPlan({planId:id.planId,intentId:id.intentId,cluster:'mainnet-beta',state:'PLANNED',createdAt:input.now,expiresAt,payload:{reasonCodes:['P6_ACCOUNT_CLOSE_ONLY_SUCCESSOR'],authority:'AUTONOMOUS_TERMINAL_RECOVERY',provenance,immutablePlanVersion:1,intent:planIntent,autonomous_dispatch:{accountCloseOnly:true,terminalRootClosePlanId:input.plan.planId,accountCloseOnlyRecoveryGeneration:generation,stage:'ACCOUNT_CLOSE_ONLY_READY',removeTransactionId:dispatch.removeTransactionId,removeTransactionIds:removeIds,removeChildTransactionIds:removeIds,removeChildCount:removeIds.length,removeChildrenConfirmed:removeIds,claimTransactionId:claimIds.at(-1),claimTransactionIds:claimIds,unwindTransactionId:dispatch.unwindTransactionId,recoveredOpenResidualUnwindTransactionId:dispatch.recoveredOpenResidualUnwindTransactionId,claimTransactionSkipped:dispatch.claimTransactionSkipped===true,closeSettlementIncomplete:true}},steps});
  await input.store.markOwnedPositionLifecycle({positionAddress:input.positionAddress,lifecycleState:'RECONCILIATION_REQUIRED',reconciliationStatus:'TERMINALIZATION_DEBT',lastPlanId:id.planId,at:input.now,payload:{stage:'ACCOUNT_CLOSE_ONLY_SUCCESSOR_PLANNED',terminalizationDebt:true,predecessorPlanId:input.plan.planId,successorPlanId:id.planId,reasonCodes:['P6_TERMINALIZATION_DEBT_ACCOUNT_CLOSE_ONLY']}});
  await input.store.completeAutonomousPlan({planId:input.plan.planId,state:'FAILED',at:input.now,payload:{action:input.plan.action,recovery:'ACCOUNT_CLOSE_ONLY_SUCCESSOR_CREATED',accountCloseOnlySuccessorPlanId:id.planId,accountCloseOnlyRecoveryGeneration:generation,pendingStage:'CLOSE_POSITION_SUBMITTED'}});
  return{created:true,planId:id.planId,reasonCodes:['P6_ACCOUNT_CLOSE_ONLY_SUCCESSOR_CREATED','P6_TERMINALIZATION_DEBT_ACCOUNT_CLOSE_ONLY']};
}

/** Startup/periodic recovery is deliberately non-resubmitting until chain truth is reconciled. */
export async function recoverUnfinishedAutonomousPlans(input: {
  store: Phase1Store;
  currentBlockHeight: number;
  now: string;
  rpcUrl?: string;
  programId?: string;
  residualDustThresholdUsd?: number;
  meteoraDataApiUrl?: string;
  dataApiMaxRps?: number;
  httpTimeoutMs?: number;
  policyHash?: string;
  /** The canonical post-settlement observability policy. */
  postTradeReporting?: NonNullable<LiveWorkerConfig["postTradeReporting"]>;
  /** Test seam; production creates its governed recovery connection below. */
  connection?: Connection;
  /** Test seam; production uses the RPC connection below. */
  signatureStatusProvider?: (
    signature: string,
  ) => Promise<{ err: unknown; confirmationStatus?: string | null } | null>;
}): Promise<LiveRecoveryResult[]> {
  const plans = await input.store.loadUnresolvedAutonomousPlans(),
    results: LiveRecoveryResult[] = [];
  const connection = input.connection ?? (input.rpcUrl
    ? createGovernedConnection({rpcUrl:input.rpcUrl,priority:'P1_RECOVERY_CRITICAL'})
    : undefined);
  const adapter =
    input.rpcUrl && input.programId
      ? createMeteoraReadAdapter({
          rpcUrl: input.rpcUrl,
          cluster: "mainnet-beta",
          programId: input.programId,
          priority:'P1_RECOVERY_CRITICAL',
        })
      : undefined;
  for (const plan of plans) {
    const raw = await input.store.getExecutionJournal(plan.idempotencyKey);
    if (!raw) {
      // The journal is written before any build/sign/send path. A claimed
      // plan without one therefore has not crossed a network boundary and
      // must not hold the queue or be resumed after its thesis has aged.
      const expired = Date.parse(plan.expiresAt) <= Date.parse(input.now);
      if (expired)
        await input.store.transitionAutonomousPlan({
          planId: plan.planId,
          state: "EXPIRED",
          at: input.now,
          reasonCodes: ["P6_RECOVERY_JOURNAL_MISSING_PRE_SUBMISSION_EXPIRED"],
          payload: { action: plan.action, recovery: "PRE_SUBMISSION_ABORTED" },
        });
      else
        await input.store.completeAutonomousPlan({
          planId: plan.planId,
          state: "FAILED",
          at: input.now,
          payload: { action: plan.action, recovery: "PRE_SUBMISSION_ABORTED" },
        });
      await input.store.releaseExecutionCapital(plan.planId, input.now, [
        expired
          ? "P6_RECOVERY_JOURNAL_MISSING_PRE_SUBMISSION_EXPIRED"
          : "P6_RECOVERY_JOURNAL_MISSING_PRE_SUBMISSION_ABORTED",
      ]);
      results.push({
        planId: plan.planId,
        action: "RETURN_EXISTING_PLAN",
        reasonCodes: [
          expired
            ? "P6_RECOVERY_JOURNAL_MISSING_PRE_SUBMISSION_EXPIRED"
            : "P6_RECOVERY_JOURNAL_MISSING_PRE_SUBMISSION_ABORTED",
        ],
      });
      continue;
    }
    const journal:ExecutionJournal={...raw,state:raw.state as ExecutionJournal["state"]};
    // Jupiter unwind is a separate durable transaction step. Its parent-close
    // marker is written before confirmation, so recovery must query that exact
    // child signature rather than whichever earlier mutation last updated the
    // plan journal.
    const pendingSignature = closeSettlementPending(plan)?.signature;
    let recoverySignature = pendingSignature ?? journal.signature;
    // The send ledger is written independently of the journal.  A crash while
    // recording the journal signature must not turn a known submitted child
    // into permanently unknowable work.
    let transactionSubmission:
      | { signature: string; lastValidBlockHeight?: number }
      | undefined;
    if (!recoverySignature && journal.transactionId &&
      typeof (input.store as unknown as { loadSubmissionAttemptByTransactionId?: unknown }).loadSubmissionAttemptByTransactionId === "function")
      transactionSubmission = await input.store.loadSubmissionAttemptByTransactionId(journal.transactionId);
    if (!recoverySignature && transactionSubmission)
      recoverySignature = transactionSubmission.signature;
    const effectiveRecoverySignature = recoverySignature;
    // A journal records the signature boundary; the durable submission row is
    // the authoritative fallback for its blockhash lifetime.  This lets a
    // crash between send and journal metadata persistence recover the exact
    // child without ever retransmitting it.
    let recoveryLastValidBlockHeight = journal.lastValidBlockHeight ?? transactionSubmission?.lastValidBlockHeight;
    if (
      recoveryLastValidBlockHeight === undefined &&
      effectiveRecoverySignature &&
      typeof (input.store as unknown as { loadSubmissionAttemptBySignature?: unknown }).loadSubmissionAttemptBySignature === "function"
    ) {
      const attempt = recoverySignature
        ? await input.store.loadSubmissionAttemptBySignature(recoverySignature)
        : await input.store.loadSubmissionAttemptBySignature(effectiveRecoverySignature);
      if (attempt?.lastValidBlockHeight !== undefined)
        recoveryLastValidBlockHeight = attempt.lastValidBlockHeight;
    }
    let confirmationStatus:
      | "PROCESSED"
      | "CONFIRMED"
      | "FINALIZED"
      | "EXPIRED"
      | "FAILED"
      | "UNKNOWN" = "UNKNOWN";
    let signatureStatusReadUnknown = false,
      failureFinalized=false;
    if (effectiveRecoverySignature && (connection || input.signatureStatusProvider)) {
      let status:
        | { err: unknown; confirmationStatus?: string | null }
        | null
        | undefined;
      try {
        status = input.signatureStatusProvider
          ? await input.signatureStatusProvider(effectiveRecoverySignature)
          : (
              await connection!.getSignatureStatus(recoverySignature ?? effectiveRecoverySignature, {
                searchTransactionHistory: true,
              })
            ).value;
      } catch {
        signatureStatusReadUnknown = true;
      }
      if (status?.err) {
        confirmationStatus = "FAILED";
        failureFinalized=status.confirmationStatus==='finalized';
      }
      else if (status?.confirmationStatus === "processed")
        confirmationStatus = "PROCESSED";
      else if (status?.confirmationStatus === "confirmed")
        confirmationStatus = "CONFIRMED";
      else if (status?.confirmationStatus === "finalized")
        confirmationStatus = "FINALIZED";
      else if (
        recoveryLastValidBlockHeight !== undefined &&
        input.currentBlockHeight > recoveryLastValidBlockHeight
      )
        confirmationStatus = "EXPIRED";
    }
    const recoveryPositionAddress=plan.positionAddress??nestedGeneratedPositionAddress(plan.planPayload)??nestedGeneratedPositionAddress(raw.payload);
    let economicEffect: "PRESENT" | "ABSENT" | "UNKNOWN" = "UNKNOWN";
    let positionTruth: Record<string, unknown> = { available: false };
    if (connection && adapter && recoveryPositionAddress) {
      // Only AccountInfo null proves absence. Do not convert an RPC/decode
      // failure into a successful close/open absence signal.
      let accountPresent: boolean | undefined;
      try {
        accountPresent = (await connection.getAccountInfo(new PublicKey(recoveryPositionAddress), "confirmed")) !== null;
      } catch {
        positionTruth = { exists: "UNKNOWN", accountReadUnknown: true };
      }
      if (accountPresent === false) {
        positionTruth = { exists: false, absenceProven: true };
        if (["CLOSE", "EMERGENCY_CLOSE", "RESHAPE", "REBALANCE"].includes(plan.action)) economicEffect = "PRESENT";
        else if (plan.action === "OPEN") economicEffect = "ABSENT";
      } else if (accountPresent === true) try {
        const position = await adapter.getPositionV2(
          plan.poolAddress,
          recoveryPositionAddress,
        );
        positionTruth = {
          exists: true,
          owner: position.owner,
          pool: position.pool,
          lowerBinId: position.lowerBinId,
          upperBinId: position.upperBinId,
          totalXAmount: position.totalXAmount,
          totalYAmount: position.totalYAmount,
          feeX: position.feeX,
          feeY: position.feeY,
          rewardOne: position.rewardOne,
          rewardTwo: position.rewardTwo,
        };
        if (plan.action === "OPEN") economicEffect = "PRESENT";
        else if (
          ["CLOSE", "EMERGENCY_CLOSE", "RESHAPE", "REBALANCE"].includes(
            plan.action,
          )
        )
          economicEffect = "ABSENT";
      } catch { positionTruth = { exists: "UNKNOWN", accountPresent: true }; }
    }
    // A persisted settlement stage is written only after its preceding
    // transaction confirmed.  If the PositionV2 is still present, the next
    // close stage is safe to resume; no already-submitted stage is resent.
    const closeStage = closeSettlementStage(plan), closePending = closeSettlementPending(plan);
    // A pre-M0060 worker stopped before signing whenever Meteora returned more
    // than one REMOVE transaction.  This is the one safe migration path for
    // that historical capability gap: the parent journal is still at its
    // pre-network state, every REMOVE child has no durable signature, and the
    // exact PositionV2 is still present with the bound owner/pool.  It is not
    // a generic retry of reconciliation-required CLOSE plans.
    const closeDispatch=closeSettlementDispatch(plan);
    // CLAIM_GUARD is intentionally not a normal settlement stage. Preserve it
    // here solely so the exact unsigned legacy recovery can prove why the
    // parent journal was terminalized before any network boundary.
    const recoveryCloseStage=closeStage??(typeof closeDispatch.stage==="string"?closeDispatch.stage:undefined);
    // Store rows always carry steps; tolerate lean recovery-test/read-model
    // fixtures without them so absence remains non-resumable rather than
    // becoming a recovery exception.
    const closeSteps=plan.steps??[];
    const hasCanonicalCloseWorkflow=closeSteps.length>0&&
      closeSteps.every(step=>step.state==="PLANNED")&&
      closeSteps.some(step=>step.kind==="METEORA_REMOVE")&&
      closeSteps.some(step=>step.kind==="JUPITER_UNWIND")&&
      closeSteps.some(step=>step.kind==="METEORA_CLOSE");
    const preSubmissionCloseCandidate=canResumePreSubmissionClose({
      action:plan.action,planState:plan.state,stage:recoveryCloseStage,
      blockedPreSubmissionResume:closeDispatch.preSubmissionResume===true,
      hasPendingChild:Boolean(closePending),journalState:journal.state,
      hasJournalSignature:Boolean(journal.signature),positionExists:positionTruth.exists===true,
      positionOwner:typeof positionTruth.owner==="string"?positionTruth.owner:undefined,
      positionPool:typeof positionTruth.pool==="string"?positionTruth.pool:undefined,
      planOwner:plan.ownerAddress,planPool:plan.poolAddress,
      hasCanonicalCloseWorkflow,
      // Submission ledgers are read below before mutation; this first pass
      // simply prevents any broad class of unresolved plans from entering it.
      removeChildrenHaveSignatures:false,
    });
    if(preSubmissionCloseCandidate){
      const removeSteps=plan.steps.filter(step=>step.kind==="METEORA_REMOVE");
      const submissions=await Promise.all(removeSteps.map(step=>input.store.loadSubmissionAttemptByTransactionId(step.transactionId)));
      if(!canResumePreSubmissionClose({
        action:plan.action,planState:plan.state,stage:recoveryCloseStage,
        blockedPreSubmissionResume:closeDispatch.preSubmissionResume===true,
        hasPendingChild:Boolean(closePending),journalState:journal.state,
        hasJournalSignature:Boolean(journal.signature),positionExists:positionTruth.exists===true,
        positionOwner:typeof positionTruth.owner==="string"?positionTruth.owner:undefined,
        positionPool:typeof positionTruth.pool==="string"?positionTruth.pool:undefined,
        planOwner:plan.ownerAddress,planPool:plan.poolAddress,
        hasCanonicalCloseWorkflow,
        removeChildrenHaveSignatures:submissions.some(Boolean),
      })){
        await input.store.transitionAutonomousPlan({
          planId:plan.planId,state:"RECONCILIATION_REQUIRED",at:input.now,
          reasonCodes:["P6_CLOSE_MULTI_REMOVE_PRE_SUBMISSION_SIGNATURE_CONFLICT"],
          payload:{stage:closeStage,preSubmissionResume:"SIGNATURE_CONFLICT"},
        });
        results.push({planId:plan.planId,action:"HOLD_FOR_OPERATOR",reasonCodes:["P6_CLOSE_MULTI_REMOVE_PRE_SUBMISSION_SIGNATURE_CONFLICT"]});
        continue;
      }
      // A failure before the snapshot has no snapshot values to resume from.
      // Preserve that distinction so executeAutonomousPlan takes a fresh
      // position-local snapshot after the same parent plan is re-claimed.
      const resumePayload:Record<string,unknown>={
        priorError:typeof closeDispatch.error==="string"?closeDispatch.error:null,
        preSubmissionResume:true,
        positionAddress:recoveryPositionAddress,
        pendingStage:null,
        pendingSignature:null,
      };
      if(recoveryCloseStage!==undefined)resumePayload.stage="CLOSE_INVENTORY_SNAPSHOTTED";
      const resumed=await input.store.resumePreSubmissionClosePlan({
        planId:plan.planId,
        at:input.now,
        reasonCodes:["P6_CLOSE_MULTI_REMOVE_PRE_SUBMISSION_RESUME_READY"],
        payload:resumePayload,
      });
      results.push({
        planId:plan.planId,
        action:"RETURN_EXISTING_PLAN",
        reasonCodes:[resumed?"P6_CLOSE_MULTI_REMOVE_PRE_SUBMISSION_RESUME_READY":"P6_CLOSE_MULTI_REMOVE_PRE_SUBMISSION_RESUME_NOT_APPLIED"],
      });
      continue;
    }
    // Historical compatibility: before the sequential-child journal contract
    // was deployed, a confirmed CLAIM/UNWIND could leave the shared close
    // journal FAILED when the next child attempted CONFIRMED -> SIGNING.  Do
    // not generally reopen failed plans.  Rehydrate only this exact close
    // failure from the independently durable JUPITER_UNWIND receipt, then let
    // the normal stage machine resume the *next* action.
    if (
      isLegacySequentialCloseJournalRecovery({
        plan,
        journal,
        positionExists: positionTruth.exists === true,
      })
    ) {
      const dispatch = closeSettlementDispatch(plan),
        unwindTransactionId = typeof dispatch.unwindTransactionId === "string"
          ? dispatch.unwindTransactionId
          : undefined,
        unwindStep = unwindTransactionId
          ? plan.steps.find((step) => step.transactionId === unwindTransactionId && step.kind === "JUPITER_UNWIND")
          : undefined,
        inputMint = typeof dispatch.tokenXMint === "string" ? dispatch.tokenXMint : undefined,
        inputAmountRaw = closeSettlementAmount(dispatch.attributableTokenX);
      const confirmedUnwind = unwindStep
        ? await input.store.loadConfirmedSubmissionByTransactionId(unwindStep.transactionId)
        : undefined;
      let chainConfirmed = false;
      if (confirmedUnwind && connection) {
        try {
          const status = (
            await connection.getSignatureStatus(confirmedUnwind.signature, {
              searchTransactionHistory: true,
            })
          ).value;
          chainConfirmed =
            !status?.err &&
            (status?.confirmationStatus === "confirmed" ||
              status?.confirmationStatus === "finalized");
        } catch {
          chainConfirmed = false;
        }
      }
      if (
        !connection ||
        !recoveryPositionAddress ||
        !unwindStep ||
        !confirmedUnwind ||
        !chainConfirmed ||
        !inputMint ||
        inputAmountRaw === undefined
      ) {
        await input.store.transitionAutonomousPlan({
          planId: plan.planId,
          state: "RECONCILIATION_REQUIRED",
          at: input.now,
          reasonCodes: ["P6_LEGACY_CLOSE_JOURNAL_RECOVERY_CHAIN_PROOF_MISSING"],
          payload: {
            stage: "CLOSE_POSITION_PENDING",
            legacyJournalRecovery: "CHAIN_PROOF_MISSING",
          },
        });
        results.push({
          planId: plan.planId,
          action: "HOLD_FOR_OPERATOR",
          reasonCodes: ["P6_LEGACY_CLOSE_JOURNAL_RECOVERY_CHAIN_PROOF_MISSING"],
        });
        continue;
      }
      const settlement = await reconcileConfirmedCloseUnwind({
        store: input.store,
        connection,
        plan,
        positionAddress: recoveryPositionAddress,
        signature: confirmedUnwind.signature,
        transactionId: unwindStep.transactionId,
        inputMint,
        inputAmountRaw,
        observedAt: input.now,
      });
      if (!settlement.ok) {
        await input.store.transitionAutonomousPlan({
          planId: plan.planId,
          state: "RECONCILIATION_REQUIRED",
          at: input.now,
          reasonCodes: [
            "P6_LEGACY_CLOSE_JOURNAL_RECOVERY_RECEIPT_REJECTED",
            ...settlement.reasonCodes,
          ],
          payload: {
            stage: "CLOSE_POSITION_PENDING",
            legacyJournalRecovery: "RECEIPT_REJECTED",
            unwindTransactionId: unwindStep.transactionId,
            unwindSignature: confirmedUnwind.signature,
          },
        });
        results.push({
          planId: plan.planId,
          action: "HOLD_FOR_OPERATOR",
          reasonCodes: [
            "P6_LEGACY_CLOSE_JOURNAL_RECOVERY_RECEIPT_REJECTED",
            ...settlement.reasonCodes,
          ],
        });
        continue;
      }
      // This does not erase the failed evidence: the original state,
      // signature and terminal payload are retained inside the recovery
      // record.  It changes only the current journal state to the exact
      // confirmed child proven above, enabling the already-safe
      // CONFIRMED -> SIGNING transition for the next child.
      await input.store.updateExecutionJournal({
        idempotencyKey: plan.idempotencyKey,
        expectedVersion: journal.version,
        state: "CONFIRMED",
        signature: confirmedUnwind.signature,
        updatedAt: input.now,
        payload: {
          ...journal.payload,
          action: plan.action,
          transactionId: unwindStep.transactionId,
          confirmation: confirmedUnwind.status,
          legacySequentialCloseJournalRecovery: {
            priorJournalState: journal.state,
            priorJournalSignature: journal.signature ?? null,
            priorJournalPayload: journal.payload,
            recoveredAt: input.now,
            unwindTransactionId: unwindStep.transactionId,
            unwindSignature: confirmedUnwind.signature,
            unwindConfirmation: confirmedUnwind.status,
            ...(confirmedUnwind.slot === undefined
              ? {}
              : { unwindSlot: confirmedUnwind.slot.toString() }),
          },
        },
      });
      await input.store.transitionAutonomousPlan({
        planId: plan.planId,
        state: "RECONCILING",
        at: input.now,
        reasonCodes: ["P6_LEGACY_CLOSE_JOURNAL_RECOVERED_FROM_CONFIRMED_UNWIND"],
        payload: {
          stage: "CLOSE_INVENTORY_UNWOUND",
          pendingStage: null,
          pendingSignature: null,
          tokenXMint: inputMint,
          tokenXBefore: String(dispatch.tokenXBefore),
          tokenYBefore: String(dispatch.tokenYBefore ?? "0"),
          attributableTokenX: inputAmountRaw.toString(),
          attributableTokenY: String(dispatch.attributableTokenY ?? "0"),
          unwindTransactionId: unwindStep.transactionId,
          unwindSignature: confirmedUnwind.signature,
          swapProceedsLamports: settlement.swapProceedsLamports.toString(),
          legacySequentialCloseJournalRecovery: true,
        },
      });
      results.push({
        planId: plan.planId,
        action: "RESUME_CLOSE_SETTLEMENT",
        reasonCodes: ["P6_LEGACY_CLOSE_JOURNAL_RECOVERED_FROM_CONFIRMED_UNWIND"],
      });
      continue;
    }
    // A prior version marked the parent journal EXPIRED when a residual child
    // had proven no chain effect. If its fresh replacement settled before the
    // following account-close sign, rehydrate only this exact parent back to
    // its last confirmed stage. The child submission ledger remains immutable.
    const expiredResidualJournalRehydrate=
      (plan.action==="CLOSE"||plan.action==="EMERGENCY_CLOSE")&&
      plan.state==="RECONCILIATION_REQUIRED"&&
      journal.state==="EXPIRED"&&
      closeSettlementDispatch(plan).stage==="CLOSE_POSITION_PENDING"&&
      closeSettlementDispatch(plan).error==="LPFORGE_EXECUTION_JOURNAL_INVALID_TRANSITION:EXPIRED->SIGNING"&&
      typeof closeSettlementDispatch(plan).recoveredOpenResidualUnwindSignature==="string"&&
      positionTruth.exists===true;
    if(expiredResidualJournalRehydrate){
      const dispatch=closeSettlementDispatch(plan),recoveredId=typeof dispatch.recoveredOpenResidualUnwindTransactionId==='string'?dispatch.recoveredOpenResidualUnwindTransactionId:undefined,recoveredSignature=typeof dispatch.recoveredOpenResidualUnwindSignature==='string'?dispatch.recoveredOpenResidualUnwindSignature:undefined;
      if(!recoveredId||!recoveredSignature){
        results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:['P6_CLOSE_RESIDUAL_JOURNAL_REHYDRATE_IDENTITY_MISSING']});
        continue;
      }
      await input.store.updateExecutionJournal({
        idempotencyKey:plan.idempotencyKey,
        expectedVersion:journal.version,
        transactionId:recoveredId,
        state:"CONFIRMED",
        signature:recoveredSignature,
        updatedAt:input.now,
        payload:{...journal.payload,recovery:"CLOSE_RECOVERED_OPEN_RESIDUAL_PARENT_JOURNAL_REHYDRATED"},
      });
      await input.store.transitionAutonomousPlan({
        planId:plan.planId,state:"RECONCILING",at:input.now,
        reasonCodes:["P6_CLOSE_RECOVERED_OPEN_RESIDUAL_PARENT_JOURNAL_REHYDRATED"],
        payload:{stage:"CLOSE_RECOVERED_OPEN_RESIDUAL_UNWOUND",pendingStage:null,pendingSignature:null},
      });
      results.push({planId:plan.planId,action:"RESUME_CLOSE_SETTLEMENT",reasonCodes:["P6_CLOSE_RECOVERED_OPEN_RESIDUAL_PARENT_JOURNAL_REHYDRATED"]});
      continue;
    }
    // A child submission is persisted before confirmation.  Its parent stage
    // is deliberately not advanced until chain truth confirms it.  This is
    // what makes a crash between REMOVE/CLAIM/UNWIND stages restartable
    // without resending any already-issued child transaction.
    if (closePending) {
      const settled = confirmationStatus === "CONFIRMED" || confirmationStatus === "FINALIZED";
      if (!settled) {
        // FAILED means the signed transaction landed and the program rejected
        // it.  Before any successor/retry decision, bind the exact pending
        // child to its submission row and persist the paid network fee.
        let failedTransactionId:string|undefined,
          failedReceiptProven=false;
        if(confirmationStatus==='FAILED'){
          failedTransactionId=closePendingTransactionId(plan,closePending);
          const failedAttempt=failedTransactionId?await input.store.loadSubmissionAttemptByTransactionId(failedTransactionId):undefined;
          failedReceiptProven=Boolean(connection&&recoveryPositionAddress&&failedTransactionId&&failedAttempt?.signature===closePending.signature&&await persistConfirmedFailedTransactionCost({store:input.store,connection:connection!,plan,positionAddress:recoveryPositionAddress!,signature:closePending.signature,transactionId:failedTransactionId!,observedAt:input.now}));
          if(!failedReceiptProven){
            await input.store.transitionAutonomousPlan({planId:plan.planId,state:'RECONCILIATION_REQUIRED',at:input.now,reasonCodes:['P6_CLOSE_FAILED_RECEIPT_PROOF_REQUIRED'],payload:{pendingStage:closePending.stage,pendingSignature:closePending.signature,expectedTransactionId:failedTransactionId??null}});
            results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:['P6_CLOSE_FAILED_RECEIPT_PROOF_REQUIRED']});
            continue;
          }
        }
        // Legacy versions terminalized a close parent after a finalized
        // no-protocol-effect primary unwind.  Rehydrate exactly that parent
        // only after independently re-proving the failure receipt, its bound
        // position/owner/pool, durable token attribution, and a confirmed
        // predecessor.  The fresh child below has a new `:retry-1` identity.
        if(confirmationStatus==='FAILED'&&closePending.stage==='CLOSE_UNWIND_SUBMITTED'){
          const dispatch=closeSettlementDispatch(plan),
            originalUnwindTransactionId=typeof dispatch.unwindTransactionId==='string'?dispatch.unwindTransactionId:undefined,
            persistedLotAllocations=parseDurableCloseLotAllocations(dispatch.attributableFeeLotAllocations),
            attributableTokenX=closeSettlementAmount(dispatch.attributableTokenX),
            predecessorIds=[
              ...(Array.isArray(dispatch.claimTransactionIds)?dispatch.claimTransactionIds.filter((value):value is string=>typeof value==='string').reverse():[]),
              ...(Array.isArray(dispatch.removeChildTransactionIds)?dispatch.removeChildTransactionIds.filter((value):value is string=>typeof value==='string').reverse():[]),
            ];
          const [unwindAttempt,...predecessors]=await Promise.all([
            originalUnwindTransactionId?input.store.loadSubmissionAttemptByTransactionId(originalUnwindTransactionId):Promise.resolve(undefined),
            ...predecessorIds.map(transactionId=>input.store.loadConfirmedSubmissionByTransactionId(transactionId)),
          ]);
          const allPredecessorsConfirmed=predecessorIds.length>0&&predecessors.length===predecessorIds.length&&predecessors.every(Boolean),
            confirmedPredecessor=allPredecessorsConfirmed&&predecessorIds[0]&&predecessors[0]
              ? {transactionId:predecessorIds[0],signature:predecessors[0].signature}
              : undefined;
          if(shouldRebuildFinalizedFailedCloseUnwind({
            signatureStatusReadUnknown,
            confirmationStatus,
            failureFinalized,
            planState:plan.state,
            journalState:journal.state,
            terminalRecovery:dispatch.recovery,
            positionExists:positionTruth.exists===true,
            positionOwner:positionTruth.owner,
            positionPool:positionTruth.pool,
            expectedOwner:plan.ownerAddress,
            expectedPool:plan.poolAddress,
            pendingStage:closePending.stage,
            failedReceiptProven,
            durableInventoryProven:attributableTokenX!==undefined&&attributableTokenX>0n&&persistedLotAllocations.ok&&persistedLotAllocations.allocations.length>0,
            confirmedPredecessor:Boolean(confirmedPredecessor),
            exactPendingAttempt:Boolean(originalUnwindTransactionId&&failedTransactionId===originalUnwindTransactionId&&unwindAttempt?.signature===closePending.signature),
            retryCount:dispatch.closeUnwindRetryCount,
          })){
            await input.store.updateExecutionJournal({
              idempotencyKey:plan.idempotencyKey,
              expectedVersion:journal.version,
              transactionId:confirmedPredecessor!.transactionId,
              state:'CONFIRMED',
              signature:confirmedPredecessor!.signature,
              updatedAt:input.now,
              payload:{
                ...journal.payload,
                recovery:'P6_CLOSE_UNWIND_FAILED_NO_PROTOCOL_EFFECT_REHYDRATED',
                failedPrimaryUnwindSignature:closePending.signature,
                failedPrimaryUnwindTransactionId:originalUnwindTransactionId,
                failedReceiptProven:true,
                priorJournalState:journal.state,
                confirmationStatus,
                positionTruth,
              },
            });
            await input.store.transitionAutonomousPlan({
              planId:plan.planId,
              state:'RECONCILING',
              at:input.now,
              reasonCodes:[
                'P6_CLOSE_UNWIND_FAILED_NO_PROTOCOL_EFFECT_REHYDRATED',
                'P6_CLOSE_UNWIND_REBUILD_READY',
              ],
              payload:{
                stage:'CLOSE_INVENTORY_MEASURED',
                pendingStage:null,
                pendingSignature:null,
                closeUnwindRetryCount:1,
                failedPrimaryUnwindSignature:closePending.signature,
                failedPrimaryUnwindTransactionId:originalUnwindTransactionId,
              },
            });
            results.push({
              planId:plan.planId,
              action:'RESUME_CLOSE_SETTLEMENT',
              reasonCodes:[
                'P6_CLOSE_UNWIND_FAILED_NO_PROTOCOL_EFFECT_REHYDRATED',
                'P6_CLOSE_UNWIND_REBUILD_READY',
              ],
            });
            continue;
          }
        }
        // The first REMOVE child has no predecessor effect to preserve.  Once
        // its exact signature is proven expired and PositionV2 is still the
        // exact bound open position, rebuild the complete removal sequence
        // under retry identities.  This is deliberately narrower than a
        // generic close retry: child zero only, no confirmed remove child,
        // and every durable binding must agree before the parent is resumed.
        const pendingRemoveDispatch=closeSettlementDispatch(plan),
          pendingRemoveChildIndex=typeof pendingRemoveDispatch.removeChildIndex==='number'
            ? pendingRemoveDispatch.removeChildIndex
            : undefined,
          pendingRemoveConfirmedChildCount=Array.isArray(pendingRemoveDispatch.removeChildrenConfirmed)
            ? pendingRemoveDispatch.removeChildrenConfirmed.filter((value):value is string=>typeof value==='string').length
            : 0,
          pendingRemoveConfirmedChildIndexes=Array.isArray(pendingRemoveDispatch.removeChildTransactionIds)&&Array.isArray(pendingRemoveDispatch.removeChildrenConfirmed)
            ? pendingRemoveDispatch.removeChildrenConfirmed.map(value=>(pendingRemoveDispatch.removeChildTransactionIds as unknown[]).indexOf(value)).filter(index=>index>=0)
            : [];
        if (shouldRebuildExpiredCloseRemove({
          signatureStatusReadUnknown,
          confirmationStatus,
          positionExists:positionTruth.exists===true,
          pendingStage:closePending.stage,
          pendingChildIndex:pendingRemoveChildIndex,
          confirmedRemoveChildCount:pendingRemoveConfirmedChildCount,
          confirmedRemoveChildIndexes:pendingRemoveConfirmedChildIndexes,
        })) {
          const dispatch=closeSettlementDispatch(plan),
            persistedIds=Array.isArray(dispatch.removeChildTransactionIds)
              ? dispatch.removeChildTransactionIds.filter((value):value is string=>typeof value==='string')
              : [],
            removeChildIds=persistedIds.length>0
              ? persistedIds
              : plan.steps.filter(step=>step.kind==='METEORA_REMOVE').map(step=>step.transactionId),
            pendingChildIndex=Number(dispatch.removeChildIndex),
            pendingChildId=Number.isInteger(pendingChildIndex)&&pendingChildIndex>=0
              ? removeChildIds[pendingChildIndex]
              : undefined,
            priorRetryRaw=Number(dispatch.closeRemoveRetryCount??0),
            priorRetry=Number.isSafeInteger(priorRetryRaw)&&priorRetryRaw>=0?priorRetryRaw:0,
            nextRetry=priorRetry+1;
          const [pendingAttempt,confirmedChildren]=await Promise.all([
            pendingChildId?input.store.loadSubmissionAttemptByTransactionId(pendingChildId):Promise.resolve(undefined),
            Promise.all(removeChildIds.map(transactionId=>input.store.loadConfirmedSubmissionByTransactionId(transactionId))),
          ]);
          const confirmedPrefixIds=removeChildIds.slice(0,pendingChildIndex),
            confirmedIds=Array.isArray(dispatch.removeChildrenConfirmed)?dispatch.removeChildrenConfirmed.filter((value):value is string=>typeof value==='string'):[],
            exactConfirmedPrefix=confirmedIds.length===confirmedPrefixIds.length&&confirmedIds.every((value,index)=>value===confirmedPrefixIds[index])&&confirmedChildren.slice(0,pendingChildIndex).every(Boolean)&&confirmedChildren.slice(pendingChildIndex).every(value=>!value);
          if(!pendingChildId||pendingAttempt?.signature!==closePending.signature||!exactConfirmedPrefix){
            await input.store.transitionAutonomousPlan({
              planId:plan.planId,state:'RECONCILIATION_REQUIRED',at:input.now,
              reasonCodes:['P6_CLOSE_REMOVE_REBUILD_PROVENANCE_MISMATCH'],
              payload:{stage:'CLOSE_INVENTORY_SNAPSHOTTED',pendingStage:closePending.stage,pendingSignature:closePending.signature,removeChildTransactionIds:removeChildIds,removeChildIndex:dispatch.removeChildIndex??null},
            });
            results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:['P6_CLOSE_REMOVE_REBUILD_PROVENANCE_MISMATCH']});
            continue;
          }
          await input.store.markSubmissionExpired(
            closePending.signature,
            input.now,
            'P6_CLOSE_REMOVE_EXPIRED_NO_CHAIN_EFFECT',
          );
          const lastConfirmedIndex=pendingChildIndex-1,lastConfirmed=lastConfirmedIndex>=0?confirmedChildren[lastConfirmedIndex]:undefined;
          await input.store.updateExecutionJournal({
            idempotencyKey:plan.idempotencyKey,
            expectedVersion:journal.version,
            // Preserve the durable confirmed prefix.  The expired child stays
            // immutable in its submission ledger; the parent resumes exactly
            // at that child, never from child zero.
            ...(lastConfirmed&&confirmedPrefixIds[lastConfirmedIndex]?{transactionId:confirmedPrefixIds[lastConfirmedIndex],state:'CONFIRMED' as const,signature:lastConfirmed.signature}:{state:'PLAN_CREATED' as const,clearTransactionIdentity:true}),
            updatedAt:input.now,
            payload:{
              ...journal.payload,
              recovery:'P6_CLOSE_REMOVE_EXPIRED_NO_CHAIN_EFFECT',
              expiredRemoveSignature:closePending.signature,
              expiredRemoveTransactionId:pendingChildId,
              priorJournalState:journal.state,
              confirmationStatus,
              positionTruth,
            },
          });
          await input.store.transitionAutonomousPlan({
            planId:plan.planId,state:'RECONCILING',at:input.now,
            reasonCodes:[
              'P6_CLOSE_REMOVE_EXPIRED_NO_CHAIN_EFFECT',
              'P6_CLOSE_REMOVE_REBUILD_READY',
            ],
            payload:{
              stage:'CLOSE_INVENTORY_SNAPSHOTTED',
              pendingStage:null,
              pendingSignature:null,
              closeRemoveRetryCount:nextRetry,
              expiredRemoveSignature:closePending.signature,
              expiredRemoveTransactionId:pendingChildId,
              removeChildTransactionIds:removeChildIds,
              removeChildrenConfirmed:confirmedPrefixIds,
              closeRemoveRetryFromChildIndex:pendingChildIndex,
            },
          });
          results.push({
            planId:plan.planId,
            action:'RESUME_CLOSE_SETTLEMENT',
            reasonCodes:[
              'P6_CLOSE_REMOVE_EXPIRED_NO_CHAIN_EFFECT',
              'P6_CLOSE_REMOVE_REBUILD_READY',
            ],
          });
          continue;
        }
        // A claim follows confirmed liquidity removal.  If the claim's exact
        // signature expires with no receipt, retain the confirmed remove
        // boundary and build a fresh claim child.  This never repeats REMOVE
        // and never treats an unknown claim as no-effect.
        const pendingClaimDispatch=closeSettlementDispatch(plan),
          pendingClaimRemoveIds=Array.isArray(pendingClaimDispatch.removeChildTransactionIds)
            ? pendingClaimDispatch.removeChildTransactionIds.filter((value):value is string=>typeof value==='string')
            : [],
          pendingClaimRequiredRemoveCount=Number(pendingClaimDispatch.removeChildCount??pendingClaimRemoveIds.length),
          pendingClaimConfirmedRemoveCount=Array.isArray(pendingClaimDispatch.removeChildrenConfirmed)
            ? pendingClaimDispatch.removeChildrenConfirmed.filter((value):value is string=>typeof value==='string').length
            : 0;
        if(shouldRebuildExpiredCloseClaim({
          signatureStatusReadUnknown,
          confirmationStatus,
          positionExists:positionTruth.exists===true,
          pendingStage:closePending.stage,
          confirmedRemoveChildCount:pendingClaimConfirmedRemoveCount,
          requiredRemoveChildCount:pendingClaimRequiredRemoveCount,
          })){
          const dispatch=closeSettlementDispatch(plan),
            claimTransactionIds=Array.isArray(dispatch.claimTransactionIds)?dispatch.claimTransactionIds.filter((value):value is string=>typeof value==='string'):[],
            pendingClaimIndex=Number(dispatch.claimChildIndex),
            pendingClaimTransactionId=Number.isInteger(pendingClaimIndex)&&pendingClaimIndex>=0
              ? claimTransactionIds[pendingClaimIndex]
              : typeof dispatch.claimTransactionId==='string'?dispatch.claimTransactionId:undefined,
            removeChildIds=pendingClaimRemoveIds.length>0
              ? pendingClaimRemoveIds
              : plan.steps.filter(step=>step.kind==='METEORA_REMOVE').map(step=>step.transactionId),
            priorRetryRaw=Number(dispatch.closeClaimRetryCount??0),
            priorRetry=Number.isSafeInteger(priorRetryRaw)&&priorRetryRaw>=0?priorRetryRaw:0,
            nextRetry=priorRetry+1;
          const [pendingAttempt,confirmedRemoves]=await Promise.all([
            pendingClaimTransactionId?input.store.loadSubmissionAttemptByTransactionId(pendingClaimTransactionId):Promise.resolve(undefined),
            Promise.all(removeChildIds.map(transactionId=>input.store.loadConfirmedSubmissionByTransactionId(transactionId))),
          ]);
          if(!pendingClaimTransactionId||pendingAttempt?.signature!==closePending.signature||confirmedRemoves.length!==pendingClaimRequiredRemoveCount||confirmedRemoves.some(value=>!value)){
            await input.store.transitionAutonomousPlan({
              planId:plan.planId,state:'RECONCILIATION_REQUIRED',at:input.now,
              reasonCodes:['P6_CLOSE_CLAIM_REBUILD_PROVENANCE_MISMATCH'],
              payload:{stage:'CLOSE_LIQUIDITY_REMOVED',pendingStage:closePending.stage,pendingSignature:closePending.signature,claimTransactionId:pendingClaimTransactionId??null,removeChildTransactionIds:removeChildIds},
            });
            results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:['P6_CLOSE_CLAIM_REBUILD_PROVENANCE_MISMATCH']});
            continue;
          }
          await input.store.markSubmissionExpired(closePending.signature,input.now,'P6_CLOSE_CLAIM_EXPIRED_NO_CHAIN_EFFECT');
          const lastConfirmedRemoveId=removeChildIds.at(-1),lastConfirmedRemove=confirmedRemoves.at(-1);
          if(!lastConfirmedRemoveId||!lastConfirmedRemove){
            results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:['P6_CLOSE_CLAIM_REBUILD_CONFIRMED_PREDECESSOR_MISSING']});
            continue;
          }
          await input.store.updateExecutionJournal({
            idempotencyKey:plan.idempotencyKey,
            expectedVersion:journal.version,
            transactionId:lastConfirmedRemoveId,
            state:'CONFIRMED',
            signature:lastConfirmedRemove.signature,
            updatedAt:input.now,
            payload:{
              ...journal.payload,
              recovery:'P6_CLOSE_CLAIM_EXPIRED_NO_CHAIN_EFFECT',
              expiredClaimSignature:closePending.signature,
              expiredClaimTransactionId:pendingClaimTransactionId,
              priorJournalState:journal.state,
              confirmationStatus,
              positionTruth,
            },
          });
          await input.store.transitionAutonomousPlan({
            planId:plan.planId,state:'RECONCILING',at:input.now,
            reasonCodes:['P6_CLOSE_CLAIM_EXPIRED_NO_CHAIN_EFFECT','P6_CLOSE_CLAIM_REBUILD_READY'],
            payload:{
              stage:'CLOSE_LIQUIDITY_REMOVED',
              pendingStage:null,
              pendingSignature:null,
              closeClaimRetryCount:nextRetry,
              claimTransactionId:null,
              claimTransactionIds:[],
              claimChildCount:null,
              claimChildrenConfirmed:[],
              claimChildIndex:null,
              expiredClaimSignature:closePending.signature,
              expiredClaimTransactionId:pendingClaimTransactionId,
            },
          });
          results.push({planId:plan.planId,action:'RESUME_CLOSE_SETTLEMENT',reasonCodes:['P6_CLOSE_CLAIM_EXPIRED_NO_CHAIN_EFFECT','P6_CLOSE_CLAIM_REBUILD_READY']});
          continue;
        }
        // A primary CLOSE unwind is a separately journaled token swap.  When
        // its exact signature has expired and PositionV2 is still present,
        // the receipt proves no swap effect but REMOVE/CLAIM remain confirmed
        // economic facts.  Resume the same parent at its measured-inventory
        // boundary with a fresh child identity; never resend this signature
        // and never rebuild either confirmed liquidity child.
        if (shouldRebuildExpiredCloseUnwind({
          signatureStatusReadUnknown,
          confirmationStatus,
          positionExists:positionTruth.exists===true,
          pendingStage:closePending.stage,
        })) {
          const dispatch=closeSettlementDispatch(plan),
            priorRetryRaw=Number(dispatch.closeUnwindRetryCount??0),
            priorRetry=Number.isSafeInteger(priorRetryRaw)&&priorRetryRaw>=0?priorRetryRaw:0,
            nextRetry=priorRetry+1,
            originalUnwindTransactionId=typeof dispatch.unwindTransactionId==='string'
              ? dispatch.unwindTransactionId
              : undefined;
          if(!originalUnwindTransactionId){
            await input.store.transitionAutonomousPlan({
              planId:plan.planId,state:'RECONCILIATION_REQUIRED',at:input.now,
              reasonCodes:['P6_CLOSE_UNWIND_RETRY_TRANSACTION_ID_MISSING'],
              payload:{stage:'CLOSE_INVENTORY_MEASURED',pendingStage:closePending.stage,pendingSignature:closePending.signature},
            });
            results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:['P6_CLOSE_UNWIND_RETRY_TRANSACTION_ID_MISSING']});
            continue;
          }
          const unwindAttempt=await input.store.loadSubmissionAttemptByTransactionId(originalUnwindTransactionId);
          if(unwindAttempt?.signature!==closePending.signature){
            await input.store.transitionAutonomousPlan({planId:plan.planId,state:'RECONCILIATION_REQUIRED',at:input.now,reasonCodes:['P6_CLOSE_UNWIND_RETRY_PROVENANCE_MISMATCH'],payload:{stage:'CLOSE_INVENTORY_MEASURED',pendingStage:closePending.stage,pendingSignature:closePending.signature,expectedTransactionId:originalUnwindTransactionId}});
            results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:['P6_CLOSE_UNWIND_RETRY_PROVENANCE_MISMATCH']});
            continue;
          }
          await input.store.markSubmissionExpired(
            closePending.signature,
            input.now,
            'P6_CLOSE_UNWIND_EXPIRED_NO_CHAIN_EFFECT',
          );
          const predecessorIds=[
            ...(Array.isArray(dispatch.claimTransactionIds)?dispatch.claimTransactionIds.filter((value):value is string=>typeof value==='string').reverse():[]),
            ...(Array.isArray(dispatch.removeChildTransactionIds)?dispatch.removeChildTransactionIds.filter((value):value is string=>typeof value==='string').reverse():[]),
          ];
          let confirmedPredecessor:{transactionId:string;signature:string}|undefined;
          for(const transactionId of predecessorIds){const confirmed=await input.store.loadConfirmedSubmissionByTransactionId(transactionId);if(confirmed){confirmedPredecessor={transactionId,signature:confirmed.signature};break;}}
          if(!confirmedPredecessor){results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:['P6_CLOSE_UNWIND_REBUILD_CONFIRMED_PREDECESSOR_MISSING']});continue;}
          await input.store.updateExecutionJournal({
            idempotencyKey:plan.idempotencyKey,
            expectedVersion:journal.version,
            // A previous release may already have set the parent to FAILED.
            // Preserve that evidence in payload while restoring only the
            // parent’s last-confirmed boundary for this exact no-effect child.
            transactionId:confirmedPredecessor.transactionId,
            state:'CONFIRMED',
            signature:confirmedPredecessor.signature,
            updatedAt:input.now,
            payload:{
              ...journal.payload,
              recovery:'P6_CLOSE_UNWIND_EXPIRED_NO_CHAIN_EFFECT',
              expiredPrimaryUnwindSignature:closePending.signature,
              expiredPrimaryUnwindTransactionId:originalUnwindTransactionId,
              priorJournalState:journal.state,
              confirmationStatus,
              positionTruth,
            },
          });
          await input.store.transitionAutonomousPlan({
            planId:plan.planId,state:'RECONCILING',at:input.now,
            reasonCodes:[
              'P6_CLOSE_UNWIND_EXPIRED_NO_CHAIN_EFFECT',
              'P6_CLOSE_UNWIND_REBUILD_READY',
            ],
            payload:{
              stage:'CLOSE_INVENTORY_MEASURED',
              pendingStage:null,
              pendingSignature:null,
              closeUnwindRetryCount:nextRetry,
              expiredPrimaryUnwindSignature:closePending.signature,
              expiredPrimaryUnwindTransactionId:originalUnwindTransactionId,
            },
          });
          results.push({
            planId:plan.planId,
            action:'RESUME_CLOSE_SETTLEMENT',
            reasonCodes:[
              'P6_CLOSE_UNWIND_EXPIRED_NO_CHAIN_EFFECT',
              'P6_CLOSE_UNWIND_REBUILD_READY',
            ],
          });
          continue;
        }
        // A protected residual unwind is safe to rebuild only after the
        // previous child has authoritatively expired without a chain receipt.
        // Preserve every completed close child and resume the parent at the
        // residual stage; never resend the old signed transaction.
        if (shouldRebuildExpiredResidualUnwind({
          signatureStatusReadUnknown,
          confirmationStatus,
          positionExists:positionTruth.exists===true,
          pendingStage:closePending.stage,
        })) {
          const dispatch=closeSettlementDispatch(plan),
            priorRetryRaw=Number(dispatch.recoveredOpenResidualRetryCount??0),
            priorRetry=Number.isSafeInteger(priorRetryRaw)&&priorRetryRaw>=0?priorRetryRaw:0,
            nextRetry=priorRetry+1,
            rebuildNotBefore=recoveredResidualRetryNotBefore(input.now,nextRetry);
          const residualTransactionId=typeof dispatch.recoveredOpenResidualUnwindTransactionId==='string'?dispatch.recoveredOpenResidualUnwindTransactionId:undefined,
            residualAttempt=residualTransactionId?await input.store.loadSubmissionAttemptByTransactionId(residualTransactionId):undefined;
          if(!residualTransactionId||residualAttempt?.signature!==closePending.signature){
            await input.store.transitionAutonomousPlan({planId:plan.planId,state:'RECONCILIATION_REQUIRED',at:input.now,reasonCodes:['P6_CLOSE_RESIDUAL_UNWIND_RETRY_PROVENANCE_MISMATCH'],payload:{stage:'CLOSE_CLAIMS_SETTLED',pendingStage:closePending.stage,pendingSignature:closePending.signature,expectedTransactionId:residualTransactionId??null}});
            results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:['P6_CLOSE_RESIDUAL_UNWIND_RETRY_PROVENANCE_MISMATCH']});
            continue;
          }
          await input.store.markSubmissionExpired(
            closePending.signature,
            input.now,
            "P6_CLOSE_RECOVERED_OPEN_RESIDUAL_EXPIRED_NO_CHAIN_EFFECT",
          );
          const predecessorIds=[
            ...(typeof dispatch.unwindTransactionId==='string'?[dispatch.unwindTransactionId]:[]),
            ...(Array.isArray(dispatch.claimTransactionIds)?dispatch.claimTransactionIds.filter((value):value is string=>typeof value==='string').reverse():[]),
            ...(Array.isArray(dispatch.removeChildTransactionIds)?dispatch.removeChildTransactionIds.filter((value):value is string=>typeof value==='string').reverse():[]),
          ];
          let confirmedPredecessor:{transactionId:string;signature:string}|undefined;
          for(const transactionId of predecessorIds){const confirmed=await input.store.loadConfirmedSubmissionByTransactionId(transactionId);if(confirmed){confirmedPredecessor={transactionId,signature:confirmed.signature};break;}}
          if(!confirmedPredecessor){results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:['P6_CLOSE_RESIDUAL_REBUILD_CONFIRMED_PREDECESSOR_MISSING']});continue;}
          await input.store.updateExecutionJournal({
            idempotencyKey: plan.idempotencyKey,
            expectedVersion: journal.version,
            // The parent journal tracks the last confirmed close child. The
            // expired residual attempt is terminal only in its own submission
            // ledger; preserving CONFIRMED permits a fresh follow-up child.
            transactionId:confirmedPredecessor.transactionId,
            state: "CONFIRMED",
            signature:confirmedPredecessor.signature,
            updatedAt: input.now,
            payload: {
              ...journal.payload,
              recovery: "CLOSE_RECOVERED_OPEN_RESIDUAL_EXPIRED_NO_CHAIN_EFFECT",
              expiredResidualSignature: closePending.signature,
              expiredResidualStage: closePending.stage,
              confirmationStatus,
              positionTruth,
            },
          });
          await input.store.transitionAutonomousPlan({
            planId: plan.planId,
            state: "RECONCILING",
            at: input.now,
            reasonCodes: [
              "P6_CLOSE_RECOVERED_OPEN_RESIDUAL_EXPIRED_NO_CHAIN_EFFECT",
              "P6_CLOSE_RECOVERED_OPEN_RESIDUAL_REBUILD_READY",
            ],
            payload: {
              stage: "CLOSE_INVENTORY_UNWOUND",
              pendingStage: null,
              pendingSignature: null,
              expiredResidualSignature: closePending.signature,
              recoveredOpenResidualRetryCount: nextRetry,
              recoveredOpenResidualRebuildNotBefore: rebuildNotBefore,
            },
          });
          results.push({
            planId: plan.planId,
            action: "RETURN_EXISTING_PLAN",
            reasonCodes: [
              "P6_CLOSE_RECOVERED_OPEN_RESIDUAL_EXPIRED_NO_CHAIN_EFFECT",
              "P6_CLOSE_RECOVERED_OPEN_RESIDUAL_REBUILD_BACKOFF",
            ],
          });
          continue;
        }
        // A durable lifecycle SOL_SETTLED link plus absence proves later settlement of
        // this exact PositionV2; retire the expired no-effect child only.
        if (!signatureStatusReadUnknown && (confirmationStatus === "EXPIRED" || confirmationStatus === "FAILED") && (plan.positionIdentitySource === "LIFECYCLE_SOL_SETTLED" || plan.positionLifecycleSettled === true) && positionTruth.exists === false && recoveryPositionAddress) {
          const reason = confirmationStatus==='FAILED'
            ? "P6_CLOSE_PENDING_STAGE_FAILED_CONFIRMED_POSITION_ALREADY_SETTLED"
            : "P6_CLOSE_PENDING_STAGE_EXPIRED_NO_CHAIN_EFFECT_POSITION_ABSENT";
          if(confirmationStatus==='EXPIRED')await input.store.markSubmissionExpired(closePending.signature, input.now, reason);
          await input.store.updateExecutionJournal({ idempotencyKey: plan.idempotencyKey, expectedVersion: journal.version, state: "FAILED", updatedAt: input.now, payload: { ...journal.payload, recovery: reason, confirmationStatus, pendingStage: closePending.stage, pendingSignature: closePending.signature, positionTruth } });
          await input.store.completeAutonomousPlan({ planId: plan.planId, state: "COMPLETED", at: input.now, payload: { action: plan.action, recovery: reason, pendingStage: closePending.stage, pendingSignature: closePending.signature, positionAddress: recoveryPositionAddress } });
          results.push({ planId: plan.planId, action: "MARK_RECONCILED", reasonCodes: [reason, closePending.stage] });
          continue;
        }

        // expired is a terminal no-effect close child only when the
        // PositionV2 is independently still present.  Retire that exact
        // signature and plan; a later management cycle may build a *new*
        // protective plan, but this path never resends the expired child.
        if (
          !signatureStatusReadUnknown &&
          (confirmationStatus === "EXPIRED" || confirmationStatus === "FAILED") &&
          positionTruth.exists === true
        ) {
          if(closePending.stage==='CLOSE_POSITION_SUBMITTED'&&recoveryPositionAddress){
            if(confirmationStatus==='EXPIRED')await input.store.markSubmissionExpired(closePending.signature,input.now,'P6_CLOSE_PENDING_STAGE_EXPIRED_NO_CHAIN_EFFECT');
            // A close-account child can expire after REMOVE and CLAIM have
            // finalized but before a normal OPEN_RESIDUAL lot was included in
            // the unwind. Re-enter the durable close stage in that exact case:
            // it re-measures the receipt-backed lot and produces one normal
            // unwind, rather than creating an account-close-only successor
            // whose preconditions can never be met.
            const dispatch=closeSettlementDispatch(plan),asIds=(value:unknown):string[]=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[],
              removeIds=asIds(dispatch.removeTransactionIds).length>0?asIds(dispatch.removeTransactionIds):asIds(dispatch.removeChildTransactionIds),
              claimIds=asIds(dispatch.claimTransactionIds).length>0?asIds(dispatch.claimTransactionIds):typeof dispatch.claimTransactionId==='string'?[dispatch.claimTransactionId]:[],
              unwindId=typeof dispatch.unwindTransactionId==='string'?dispatch.unwindTransactionId:undefined,
              [removeConfirmations,claimConfirmations,unwindConfirmed]=await Promise.all([
                Promise.all(removeIds.map(transactionId=>input.store.loadConfirmedSubmissionByTransactionId(transactionId))),
                Promise.all(claimIds.map(transactionId=>input.store.loadConfirmedSubmissionByTransactionId(transactionId))),
                unwindId?input.store.loadConfirmedSubmissionByTransactionId(unwindId):Promise.resolve(undefined),
              ]),claimSkipped=dispatch.claimTransactionSkipped===true,
              removesConfirmed=removeIds.length>0&&removeConfirmations.every(Boolean),
              claimsConfirmed=claimIds.length>0&&claimConfirmations.every(Boolean),
              lastConfirmedId=claimIds.at(-1)??removeIds.at(-1),
              lastConfirmed=claimConfirmations.at(-1)??removeConfirmations.at(-1);
            if(removesConfirmed&&(claimSkipped||claimsConfirmed)&&!unwindConfirmed&&lastConfirmedId&&lastConfirmed&&closeSettlementAmount(dispatch.attributableTokenX)===0n){
              await input.store.updateExecutionJournal({idempotencyKey:plan.idempotencyKey,expectedVersion:journal.version,transactionId:lastConfirmedId,state:'CONFIRMED',signature:lastConfirmed.signature,updatedAt:input.now,payload:{...journal.payload,recovery:'P6_CLOSE_REHYDRATED_FOR_RECEIPT_BOUND_OPEN_RESIDUAL_UNWIND',transactionId:lastConfirmedId,expiredAccountCloseSignature:closePending.signature}});
              await input.store.transitionAutonomousPlan({planId:plan.planId,state:'RECONCILING',at:input.now,reasonCodes:['P6_CLOSE_REHYDRATED_FOR_RECEIPT_BOUND_OPEN_RESIDUAL_UNWIND'],payload:{stage:'CLOSE_CLAIMS_SETTLED',pendingStage:null,pendingSignature:null,closeSettlementIncomplete:true}});
              results.push({planId:plan.planId,action:'RESUME_CLOSE_SETTLEMENT',reasonCodes:['P6_CLOSE_REHYDRATED_FOR_RECEIPT_BOUND_OPEN_RESIDUAL_UNWIND']});
              continue;
            }
            // The normal unwind may have confirmed before a fee-claim lot was
            // recorded or allocated.  If the account-close child then expires
            // without effect, an account-only successor would be impossible:
            // it must not close an account while receipt-bound inventory is
            // still attributable.  Resume the same parent from a fresh,
            // separately identified unwind using only exact FEE_CLAIM lots.
            // No wallet-wide balance is attributed; the balance is merely a
            // sufficiency proof for the immutable lots selected below.
            const tokenMint=typeof dispatch.tokenXMint==='string'?dispatch.tokenXMint:undefined;
            if(removesConfirmed&&(claimSkipped||claimsConfirmed)&&unwindConfirmed&&unwindId&&lastConfirmedId&&lastConfirmed&&tokenMint&&connection){
              const feeLots=selectReceiptBoundFeeClaimResidual({
                positionAddress:recoveryPositionAddress,
                tokenMint,
                lots:await input.store.loadPositionInventoryLots(recoveryPositionAddress,tokenMint),
              });
              const feeResidual=feeLots.reduce((total,lot)=>total+lot.rawAmount,0n);
              let walletTokenX:bigint|undefined;
              try{walletTokenX=await readWalletTokenBalance({connection,ownerAddress:plan.ownerAddress,mint:tokenMint});}catch{}
              // Historical releases measured REMOVE and CLAIM together.  The
              // exact primary-unwind receipt can prove that its input already
              // consumed the separately recorded claim lot.  Reconcile only
              // that demonstrated duplicate representation; do not turn an
              // unexplained wallet shortfall into a settlement.
              const openResidualRaw=Array.isArray(dispatch.attributableOpenResidualLotAllocations)
                ? dispatch.attributableOpenResidualLotAllocations.reduce((total,value)=>{
                    if(!value||typeof value!=="object")return total;
                    const row=value as Record<string,unknown>;
                    const amount=closeSettlementAmount(row.rawAmount);
                    return amount===undefined?total:total+amount;
                  },0n)
                : 0n,
                primaryUnwindInputRaw=closeSettlementAmount(dispatch.attributableTokenX),
                combinedCloseWithdrawalRaw=closeSettlementAmount(dispatch.newlyWithdrawnTokenX);
              if(
                feeResidual>0n&&walletTokenX===0n&&
                primaryUnwindInputRaw!==undefined&&combinedCloseWithdrawalRaw!==undefined&&
                isReceiptBoundCombinedCloseClaimDisposition({
                  primaryUnwindInputRaw,
                  combinedCloseWithdrawalRaw,
                  openResidualRaw,
                  feeClaimRaw:feeResidual,
                  walletTokenRaw:walletTokenX,
                })
              ){
                let receiptProven=false;
                try{
                  const receipt=await loadConfirmedExecutionReceipt(connection,unwindConfirmed.signature),
                    effects=deriveTransactionAssetEffects(receipt,{ownerAddress:plan.ownerAddress,...(receipt.staticAccountKeys[0]===undefined?{}:{feePayerAddress:receipt.staticAccountKeys[0]}),inputMint:tokenMint,outputMint:WSOL_MINT,jupiterProgramIds:[JUPITER_SWAP_V6_PROGRAM_ID],positionAddress:recoveryPositionAddress}),
                    settlement=deriveCloseUnwindSettlement({receipt,effects,ownerAddress:plan.ownerAddress,inputMint:tokenMint,inputAmountRaw:primaryUnwindInputRaw,outputMint:WSOL_MINT,jupiterProgramIds:[JUPITER_SWAP_V6_PROGRAM_ID]});
                  receiptProven=settlement.state==='SETTLED'&&settlement.inputCorroborated===true;
                }catch{}
                if(receiptProven){
                  for(const [index,lot] of feeLots.entries())await input.store.settlePositionInventoryLot({
                    eventId:`${plan.planId}:fee-claim-combined-close-delta-reconciled:${index}`,
                    lotId:lot.lotId,
                    planId:plan.planId,
                    eventType:'SETTLED',
                    settledRawAmount:lot.rawAmount,
                    observedAt:input.now,
                    transactionSignature:unwindConfirmed.signature,
                    payload:{
                      source:'P6_RECEIPT_BOUND_COMBINED_REMOVE_CLAIM_DELTA_RECONCILIATION',
                      primaryUnwindTransactionId:unwindId,
                      primaryUnwindSignature:unwindConfirmed.signature,
                      primaryUnwindInputRaw:primaryUnwindInputRaw.toString(),
                      combinedCloseWithdrawalRaw:combinedCloseWithdrawalRaw.toString(),
                      openResidualRaw:openResidualRaw.toString(),
                      feeClaimRaw:lot.rawAmount.toString(),
                    },
                  });
                  const accountRetryRaw=Number(dispatch.closeAccountRetryCount??0),
                    priorAccountRetry=Number.isSafeInteger(accountRetryRaw)&&accountRetryRaw>=0?accountRetryRaw:0;
                  await input.store.updateExecutionJournal({idempotencyKey:plan.idempotencyKey,expectedVersion:journal.version,transactionId:unwindId,state:'CONFIRMED',signature:unwindConfirmed.signature,updatedAt:input.now,payload:{...journal.payload,recovery:'P6_CLOSE_FEE_CLAIM_COMBINED_DELTA_RECONCILED',expiredAccountCloseSignature:closePending.signature}});
                  await input.store.transitionAutonomousPlan({planId:plan.planId,state:'RECONCILING',at:input.now,reasonCodes:['P6_CLOSE_FEE_CLAIM_COMBINED_DELTA_RECONCILED','P6_CLOSE_ACCOUNT_RETRY_READY'],payload:{stage:'CLOSE_INVENTORY_UNWOUND',pendingStage:null,pendingSignature:null,closeAccountRetryCount:priorAccountRetry+1,expiredAccountCloseSignature:closePending.signature}});
                  results.push({planId:plan.planId,action:'RESUME_CLOSE_SETTLEMENT',reasonCodes:['P6_CLOSE_FEE_CLAIM_COMBINED_DELTA_RECONCILED','P6_CLOSE_ACCOUNT_RETRY_READY']});
                  continue;
                }
              }
              if(feeResidual>0n&&walletTokenX!==undefined&&walletTokenX>=feeResidual){
                const retryRaw=Number(dispatch.closeUnwindRetryCount??0),
                  priorRetry=Number.isSafeInteger(retryRaw)&&retryRaw>=0?retryRaw:0,
                  accountRetryRaw=Number(dispatch.closeAccountRetryCount??0),
                  priorAccountRetry=Number.isSafeInteger(accountRetryRaw)&&accountRetryRaw>=0?accountRetryRaw:0;
                await input.store.updateExecutionJournal({
                  idempotencyKey:plan.idempotencyKey,
                  expectedVersion:journal.version,
                  transactionId:unwindId,
                  state:'CONFIRMED',
                  signature:unwindConfirmed.signature,
                  updatedAt:input.now,
                  payload:{...journal.payload,recovery:'P6_CLOSE_REHYDRATED_FOR_RECEIPT_BOUND_FEE_CLAIM_RESIDUAL_UNWIND',expiredAccountCloseSignature:closePending.signature,feeClaimResidualLotIds:feeLots.map(lot=>lot.lotId)},
                });
                await input.store.transitionAutonomousPlan({
                  planId:plan.planId,state:'RECONCILING',at:input.now,
                  reasonCodes:['P6_CLOSE_REHYDRATED_FOR_RECEIPT_BOUND_FEE_CLAIM_RESIDUAL_UNWIND'],
                  payload:{
                    stage:'CLOSE_INVENTORY_MEASURED',
                    pendingStage:null,pendingSignature:null,
                    attributableTokenX:feeResidual.toString(),
                    attributableFeeLotAllocations:feeLots.map(lot=>({lotId:lot.lotId,rawAmount:lot.rawAmount.toString()})),
                    closeUnwindRetryCount:priorRetry+1,
                    closeAccountRetryCount:priorAccountRetry+1,
                    expiredAccountCloseSignature:closePending.signature,
                    expiredAccountCloseTransactionId:typeof dispatch.transactionId==='string'?dispatch.transactionId:null,
                  },
                });
                results.push({planId:plan.planId,action:'RESUME_CLOSE_SETTLEMENT',reasonCodes:['P6_CLOSE_REHYDRATED_FOR_RECEIPT_BOUND_FEE_CLAIM_RESIDUAL_UNWIND']});
                continue;
              }
            }
            const successor=await createAccountCloseOnlySuccessor({store:input.store,plan,positionAddress:recoveryPositionAddress,positionTruth,now:input.now});
            if(successor.created){
              results.push({planId:plan.planId,action:'RETURN_EXISTING_PLAN',reasonCodes:successor.reasonCodes});
              continue;
            }
            // An already-created successor is dispatchable through the normal
            // plan queue. It must not keep recovery in RECOVERY_PENDING.
            if(successor.planId)continue;
            await input.store.markOwnedPositionLifecycle({positionAddress:recoveryPositionAddress,lifecycleState:'RECONCILIATION_REQUIRED',reconciliationStatus:'TERMINALIZATION_DEBT',lastPlanId:plan.planId,at:input.now,payload:{stage:'ACCOUNT_CLOSE_ONLY_SUCCESSOR_BLOCKED',terminalizationDebt:true,reasonCodes:successor.reasonCodes}});
            await input.store.transitionAutonomousPlan({planId:plan.planId,state:'RECONCILIATION_REQUIRED',at:input.now,reasonCodes:['P6_TERMINALIZATION_DEBT_ACCOUNT_CLOSE_ONLY_BLOCKED',...successor.reasonCodes],payload:{stage:'ACCOUNT_CLOSE_ONLY_SUCCESSOR_BLOCKED',pendingStage:closePending.stage,pendingSignature:closePending.signature}});
            results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:['P6_TERMINALIZATION_DEBT_ACCOUNT_CLOSE_ONLY_BLOCKED',...successor.reasonCodes]});
            continue;
          }
          const reason = confirmationStatus==='FAILED'
            ? "P6_CLOSE_PENDING_STAGE_FAILED_CONFIRMED_NO_PROTOCOL_EFFECT"
            : "P6_CLOSE_PENDING_STAGE_EXPIRED_NO_CHAIN_EFFECT";
          if(confirmationStatus==='EXPIRED')await input.store.markSubmissionExpired(closePending.signature, input.now, reason);
          await input.store.updateExecutionJournal({
            idempotencyKey: plan.idempotencyKey,
            expectedVersion: journal.version,
            state: "FAILED",
            updatedAt: input.now,
            payload: {
              ...journal.payload,
              recovery: confirmationStatus==='FAILED'?"CLOSE_PENDING_STAGE_FAILED_CONFIRMED":"CLOSE_PENDING_STAGE_EXPIRED",
              confirmationStatus,
              pendingStage: closePending.stage,
              pendingSignature: closePending.signature,
              positionTruth,
            },
          });
          await input.store.completeAutonomousPlan({
            planId: plan.planId,
            state: "FAILED",
            at: input.now,
            payload: {
              action: plan.action,
              recovery: reason,
              pendingStage: closePending.stage,
              pendingSignature: closePending.signature,
            },
          });
          results.push({ planId: plan.planId, action: "RETURN_EXISTING_PLAN", reasonCodes: [reason, closePending.stage] });
          continue;
        }
        await input.store.transitionAutonomousPlan({
          planId: plan.planId,
          state: "RECONCILIATION_REQUIRED",
          at: input.now,
          reasonCodes: ["P6_CLOSE_PENDING_STAGE_RECONCILIATION_REQUIRED", closePending.stage],
          payload: { pendingStage: closePending.stage, pendingSignature: closePending.signature },
        });
        results.push({ planId: plan.planId, action: "HOLD_FOR_OPERATOR", reasonCodes: ["P6_CLOSE_PENDING_STAGE_RECONCILIATION_REQUIRED", closePending.stage] });
        continue;
      }
      if (closePending.stage === "CLOSE_UNWIND_SUBMITTED" || closePending.stage === "CLOSE_OPEN_RESIDUAL_UNWIND_SUBMITTED") {
        const dispatch = closeSettlementDispatch(plan),
          recovered=closePending.stage === "CLOSE_OPEN_RESIDUAL_UNWIND_SUBMITTED",
          inputMint = recovered
            ? typeof dispatch.recoveredOpenResidualTokenMint === "string" ? dispatch.recoveredOpenResidualTokenMint : undefined
            : typeof dispatch.tokenXMint === "string" ? dispatch.tokenXMint : undefined,
          inputAmountRaw = recovered
            ? closeSettlementAmount(dispatch.recoveredOpenResidualRawAmount)
            : closeSettlementAmount(dispatch.attributableTokenX),
          unwindTransactionId = recovered
            ? typeof dispatch.recoveredOpenResidualUnwindTransactionId === "string" ? dispatch.recoveredOpenResidualUnwindTransactionId : `${plan.planId}:recovered-open-residual-unwind`
            : typeof dispatch.unwindTransactionId === "string" ? dispatch.unwindTransactionId : `${plan.planId}:unwind`,
          lotId = recovered && typeof dispatch.recoveredOpenResidualLotId === "string" ? dispatch.recoveredOpenResidualLotId : undefined,
          persistedLotAllocations=recovered?{ok:true as const,allocations:[] as Array<{lotId:string;rawAmount:bigint}>}:parseDurableCloseLotAllocations(dispatch.attributableFeeLotAllocations);
        if(!persistedLotAllocations.ok){
          await input.store.transitionAutonomousPlan({planId:plan.planId,state:"RECONCILIATION_REQUIRED",at:input.now,reasonCodes:["P6_CLOSE_POSITION_ATTRIBUTED_LOT_ALLOCATION_INVALID"],payload:{pendingStage:closePending.stage,pendingSignature:closePending.signature}});
          results.push({planId:plan.planId,action:"HOLD_FOR_OPERATOR",reasonCodes:["P6_CLOSE_POSITION_ATTRIBUTED_LOT_ALLOCATION_INVALID"]});
          continue;
        }
        if (!connection || !recoveryPositionAddress || !inputMint || inputAmountRaw === undefined) {
          await input.store.transitionAutonomousPlan({
            planId: plan.planId,
            state: "RECONCILIATION_REQUIRED",
            at: input.now,
            reasonCodes: [recovered?"P6_CLOSE_RECOVERED_OPEN_RESIDUAL_RECEIPT_RECONCILIATION_REQUIRED":"P6_CLOSE_UNWIND_RECEIPT_RECONCILIATION_REQUIRED"],
            payload: { pendingStage: closePending.stage, pendingSignature: closePending.signature },
          });
          results.push({ planId: plan.planId, action: "HOLD_FOR_OPERATOR", reasonCodes: [recovered?"P6_CLOSE_RECOVERED_OPEN_RESIDUAL_RECEIPT_RECONCILIATION_REQUIRED":"P6_CLOSE_UNWIND_RECEIPT_RECONCILIATION_REQUIRED"] });
          continue;
        }
        const settlement = await reconcileConfirmedCloseUnwind({
          store: input.store,
          connection,
          plan,
          positionAddress: recoveryPositionAddress,
          signature: closePending.signature,
          transactionId: unwindTransactionId,
          inputMint,
          inputAmountRaw,
          observedAt: input.now,
          ...(lotId?{lotId,settlementIdSuffix:"recovered-open-residual"}:persistedLotAllocations.allocations.length?{lotAllocations:persistedLotAllocations.allocations}:{}),
        });
        if (!settlement.ok) {
          await input.store.transitionAutonomousPlan({
            planId: plan.planId,
            state: "RECONCILIATION_REQUIRED",
            at: input.now,
            reasonCodes: [recovered?"P6_CLOSE_RECOVERED_OPEN_RESIDUAL_SETTLEMENT_RECONCILIATION_REQUIRED":"P6_CLOSE_UNWIND_SETTLEMENT_RECONCILIATION_REQUIRED", ...settlement.reasonCodes],
            payload: { pendingStage: closePending.stage, pendingSignature: closePending.signature },
          });
          results.push({ planId: plan.planId, action: "HOLD_FOR_OPERATOR", reasonCodes: [recovered?"P6_CLOSE_RECOVERED_OPEN_RESIDUAL_SETTLEMENT_RECONCILIATION_REQUIRED":"P6_CLOSE_UNWIND_SETTLEMENT_RECONCILIATION_REQUIRED", ...settlement.reasonCodes] });
          continue;
        }
        await input.store.transitionAutonomousPlan({
          planId: plan.planId,
          state: "RECONCILING",
          at: input.now,
            reasonCodes: [recovered?"P6_CLOSE_RECOVERED_OPEN_RESIDUAL_SETTLEMENT_RECOVERED":"P6_CLOSE_UNWIND_SETTLEMENT_RECOVERED"],
            payload: {
            stage: recovered?"CLOSE_RECOVERED_OPEN_RESIDUAL_UNWOUND":"CLOSE_INVENTORY_UNWOUND",
            pendingStage: null,
            pendingSignature: null,
            swapProceedsLamports: settlement.swapProceedsLamports.toString(),
          },
        });
        results.push({ planId: plan.planId, action: "RESUME_CLOSE_SETTLEMENT", reasonCodes: [recovered?"P6_CLOSE_RECOVERED_OPEN_RESIDUAL_SETTLEMENT_RECOVERED":"P6_CLOSE_UNWIND_SETTLEMENT_RECOVERED"] });
        continue;
      }
      if(closePending.stage==='CLOSE_REMOVE_SUBMITTED'||closePending.stage==='CLOSE_CLAIM_SUBMITTED'){
        const dispatch=closeSettlementDispatch(plan),remove=closePending.stage==='CLOSE_REMOVE_SUBMITTED',
          idsRaw=remove?dispatch.removeChildTransactionIds:dispatch.claimTransactionIds,
          idsFromArray=Array.isArray(idsRaw)?idsRaw.filter((value):value is string=>typeof value==='string'):[],
          legacyId=remove?dispatch.removeTransactionId:dispatch.claimTransactionId,
          ids=idsFromArray.length>0?idsFromArray:typeof legacyId==='string'?[legacyId]:[],
          confirmedRaw=remove?dispatch.removeChildrenConfirmed:dispatch.claimChildrenConfirmed,
          confirmed=Array.isArray(confirmedRaw)?confirmedRaw.filter((value):value is string=>typeof value==='string'):[],
          indexRaw=Number(remove?dispatch.removeChildIndex:dispatch.claimChildIndex),index=Number.isInteger(indexRaw)?indexRaw:ids.length===1?0:Number.NaN,expectedId=Number.isInteger(index)?ids[index]:undefined,
          exact=expectedId?await input.store.loadConfirmedSubmissionByTransactionId(expectedId):undefined,
          advanced=advanceConfirmedCloseChild({kind:remove?'REMOVE':'CLAIM',transactionIds:ids,confirmedTransactionIds:confirmed,pendingChildIndex:index});
        if(!expectedId||!exact||exact.signature!==closePending.signature||!advanced.valid){
          const reason=advanced.reasonCode??`P6_CLOSE_${remove?'REMOVE':'CLAIM'}_RECOVERY_CONFIRMATION_IDENTITY_MISMATCH`;
          await input.store.transitionAutonomousPlan({planId:plan.planId,state:'RECONCILIATION_REQUIRED',at:input.now,reasonCodes:[reason],payload:{pendingStage:closePending.stage,pendingSignature:closePending.signature,expectedTransactionId:expectedId??null}});
          results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:[reason]});
          continue;
        }
        await input.store.transitionAutonomousPlan({
          planId: plan.planId,
          state: "RECONCILING",
          at: input.now,
          reasonCodes: ["P6_CLOSE_PENDING_STAGE_CONFIRMED", closePending.stage],
          payload: {stage:advanced.stage,pendingStage:null,pendingSignature:null,...(remove?{removeChildrenConfirmed:advanced.confirmedTransactionIds,lastConfirmedRemoveChild:index}:{claimChildrenConfirmed:advanced.confirmedTransactionIds,lastConfirmedClaimChild:index})},
        });
        results.push({ planId: plan.planId, action: "RESUME_CLOSE_SETTLEMENT", reasonCodes: ["P6_CLOSE_PENDING_STAGE_CONFIRMED", advanced.stage] });
        continue;
      }
      // The final account-close transaction is only economically complete
      // when account absence is proven; confirmed signature alone is not
      // enough to turn an RPC/decode failure into a closed position.
      if (positionTruth.exists === false && recoveryPositionAddress) {
        if(!connection || !input.rpcUrl){
          results.push({ planId: plan.planId, action: "HOLD_FOR_OPERATOR", reasonCodes: ["P6_CLOSE_SETTLEMENT_RPC_UNAVAILABLE"] });
          continue;
        }
        const settlement=await finalizeClosedPositionSettlement({store:input.store,plan,positionAddress:recoveryPositionAddress,connection,config:settlementFinalizationConfig(input)});
        if(!settlement.ready){
          results.push({ planId: plan.planId, action: "HOLD_FOR_OPERATOR", reasonCodes: settlement.reasonCodes });
          continue;
        }
        await input.store.completeAutonomousPlan({ planId: plan.planId, state: "COMPLETED", at: input.now, payload: { action: plan.action, signature: closePending.signature, recovery: "CLOSE_POSITION_CONFIRMED" } });
        results.push({ planId: plan.planId, action: "MARK_RECONCILED", reasonCodes: ["P6_CLOSE_POSITION_RECOVERED"] });
      } else {
        await input.store.transitionAutonomousPlan({ planId: plan.planId, state: "RECONCILIATION_REQUIRED", at: input.now, reasonCodes: ["P6_CLOSE_POSITION_ABSENCE_UNPROVEN"], payload: { pendingStage: closePending.stage, pendingSignature: closePending.signature } });
        results.push({ planId: plan.planId, action: "HOLD_FOR_OPERATOR", reasonCodes: ["P6_CLOSE_POSITION_ABSENCE_UNPROVEN"] });
      }
      continue;
    }
    const recoveryDispatch=closeSettlementDispatch(plan),
      rebuildNotBefore=typeof recoveryDispatch.recoveredOpenResidualRebuildNotBefore==="string"?Date.parse(recoveryDispatch.recoveredOpenResidualRebuildNotBefore):NaN;
    if(
      closeStage==="CLOSE_INVENTORY_UNWOUND"&&
      Number.isFinite(rebuildNotBefore)&&
      Date.parse(input.now)<rebuildNotBefore
    ){
      results.push({planId:plan.planId,action:"RETURN_EXISTING_PLAN",reasonCodes:["P6_CLOSE_RECOVERED_OPEN_RESIDUAL_REBUILD_BACKOFF"]});
      continue;
    }
    if (shouldResumeCloseSettlement({
      action: plan.action,
      stage: closeStage,
      positionExists: positionTruth.exists === true,
      confirmationStatus,
    })) {
      results.push({
        planId: plan.planId,
        action: "RESUME_CLOSE_SETTLEMENT",
        reasonCodes: ["P6_RECOVERY_CLOSE_STAGE_RESUME_READY", closeStage ?? "UNKNOWN"],
      });
      continue;
    }
    // CLAIM has no position-existence side effect, so generic recovery cannot
    // infer it from PositionV2 truth.  Resolve its exact submitted signature
    // independently: a proven expired claim becomes terminal no-effect while
    // UNKNOWN remains recovery-blocking.  This never rebuilds/replays a claim.
    if(plan.action==='CLAIM'&&(Boolean(recoverySignature)||journal.state==='SUBMITTED'||journal.state==='UNKNOWN_SUBMISSION'||journal.state==='SIGNED')){
      const claimRecovery=assessExpiredClaimRecovery({signaturePresent:Boolean(recoverySignature),signatureStatusReadUnknown,confirmationStatus});
      if(claimRecovery.terminal&&recoverySignature){
        const failed=claimRecovery.terminalKind==='CONFIRMED_FAILED';
        if(failed){
          if(!connection||!recoveryPositionAddress||!journal.transactionId||!(await persistConfirmedFailedTransactionCost({store:input.store,connection,plan,positionAddress:recoveryPositionAddress,signature:recoverySignature,transactionId:journal.transactionId,observedAt:input.now}))) {
            await input.store.transitionAutonomousPlan({planId:plan.planId,state:'RECONCILIATION_REQUIRED',at:input.now,reasonCodes:['P6_CLAIM_FAILED_RECEIPT_PROOF_REQUIRED'],payload:{confirmationStatus,signature:recoverySignature,transactionId:journal.transactionId??null}});
            results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:['P6_CLAIM_FAILED_RECEIPT_PROOF_REQUIRED']});
            continue;
          }
        }else await input.store.markSubmissionExpired(recoverySignature,input.now,'P6_CLAIM_EXPIRED_NO_CHAIN_EFFECT');
        const terminalState=failed?'FAILED':'EXPIRED',recovery=failed?'CLAIM_FAILED_CONFIRMED':'CLAIM_NOT_EXECUTED';
        await input.store.updateExecutionJournal({idempotencyKey:plan.idempotencyKey,expectedVersion:journal.version,state:failed?'FAILED':'HOLD',updatedAt:input.now,payload:{...journal.payload,recovery,confirmationStatus,signature:recoverySignature,positionTruth}});
        await input.store.insertExecutionReconciliation({reconciliationId:`${plan.planId}:claim-no-effect`,planId:plan.planId,observedAt:input.now,status:'MATCH',expected:{action:'CLAIM',signature:recoverySignature},actual:{confirmationStatus,claimEffect:'ABSENT',transactionFeeEffect:failed?'PRESENT':'ABSENT',positionTruth},discrepancies:[],payload:{recovery,chainEffect:failed?'FAILED_RECEIPT_ONLY':'NONE'}});
        await input.store.transitionAutonomousPlan({planId:plan.planId,state:terminalState,at:input.now,reasonCodes:claimRecovery.reasonCodes,payload:{recovery,confirmationStatus,signature:recoverySignature,chainEffect:failed?'FAILED_RECEIPT_ONLY':'NONE'}});
        await input.store.releaseExecutionCapital(plan.planId,input.now,claimRecovery.reasonCodes);
        results.push({planId:plan.planId,action:'RETURN_EXISTING_PLAN',reasonCodes:claimRecovery.reasonCodes});
        continue;
      }
      if((confirmationStatus==='CONFIRMED'||confirmationStatus==='FINALIZED')&&recoverySignature&&connection&&recoveryPositionAddress){
        if(!journal.transactionId)throw new Error("LPFORGE_CLAIM_RECOVERY_TRANSACTION_ID_MISSING");
        const accounted=await persistConfirmedClaimReceipt({store:input.store,connection,plan,positionAddress:recoveryPositionAddress,signature:recoverySignature,transactionId:journal.transactionId,observedAt:input.now,source:"CONFIRMED_CLAIM_RECEIPT_RECOVERY"});
        if(accounted.ok){
          await input.store.insertExecutionReconciliation({reconciliationId:`${plan.planId}:claim-confirmed`,planId:plan.planId,observedAt:input.now,status:'MATCH',expected:{action:'CLAIM',signature:recoverySignature},actual:{confirmationStatus,claimEffect:'PRESENT',positionTruth},discrepancies:[],payload:{recovery:'CLAIM_CONFIRMED',receiptReasonCodes:accounted.reasonCodes}});
          await input.store.completeAutonomousPlan({planId:plan.planId,state:'RECONCILED',at:input.now,payload:{recovery:'CLAIM_CONFIRMED',confirmationStatus,signature:recoverySignature,receiptReasonCodes:accounted.reasonCodes}});
          results.push({planId:plan.planId,action:'MARK_RECONCILED',reasonCodes:['P6_CLAIM_CONFIRMED']});
          continue;
        }
      }
      await input.store.transitionAutonomousPlan({planId:plan.planId,state:'RECOVERING',at:input.now,reasonCodes:claimRecovery.reasonCodes,payload:{journalId:journal.journalId,recovery:'CLAIM_RECONCILIATION_REQUIRED',confirmationStatus,signature:recoverySignature??null,positionTruth}});
      results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:claimRecovery.reasonCodes});
      continue;
    }
    // A process may restart after the final account-close receipt but before
    // its chain-cashflow reconciliation is persisted. Re-run only that
    // receipt-bound accounting boundary; it cannot build, sign, or submit a
    // transaction and is idempotent against the immutable raw cashflows.
    const pendingTerminalDispatch=closeSettlementDispatch(plan);
    if(isAccountCloseOnlyPlan(plan)&&positionTruth.exists===false&&(pendingTerminalDispatch.stage==='SOL_SETTLEMENT_CHAIN_RECONCILIATION_BLOCKED'||pendingTerminalDispatch.stage==='SOL_SETTLEMENT_BLOCKED')&&connection&&recoveryPositionAddress){
      const settlement=await finalizeClosedPositionSettlement({store:input.store,plan,positionAddress:recoveryPositionAddress,connection,config:settlementFinalizationConfig(input)});
      if(settlement.ready){
        await input.store.completeAutonomousPlan({planId:plan.planId,state:'COMPLETED',at:input.now,payload:{action:'CLOSE',recovery:'ACCOUNT_CLOSE_ONLY_SETTLEMENT_RECONCILED'}});
        results.push({planId:plan.planId,action:'MARK_RECONCILED',reasonCodes:['P6_ACCOUNT_CLOSE_ONLY_SETTLEMENT_RECONCILED']});
      }else results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:settlement.reasonCodes});
      continue;
    }
    // A receipt-bound OPEN_RESIDUAL unwind may itself succeed while the
    // previously expired account-close transaction identity remains unusable.
    // Once the exact unwind receipt and all lot consumption are durable, hand
    // off to the bounded account-close-only successor. This is deliberately
    // after receipt reconciliation: it can never repeat REMOVE, CLAIM, or
    // JUPITER, and it gives the final account-close a fresh submission id.
    const terminalDispatch=closeSettlementDispatch(plan);
    if(
      (plan.action==='CLOSE'||plan.action==='EMERGENCY_CLOSE')&&
      positionTruth.exists===true&&
      terminalDispatch.stage==='CLOSE_POSITION_PENDING'&&
      terminalDispatch.error==='LPFORGE_DUPLICATE_SUBMISSION_ATTEMPT'&&
      recoveryPositionAddress
    ){
      const unwindTransactionId=typeof terminalDispatch.unwindTransactionId==='string'?terminalDispatch.unwindTransactionId:undefined,
        unwindStep=unwindTransactionId?plan.steps.find(step=>step.transactionId===unwindTransactionId&&step.kind==='JUPITER_UNWIND'):undefined,
        unwindConfirmed=unwindStep?await input.store.loadConfirmedSubmissionByTransactionId(unwindStep.transactionId):undefined;
      if(unwindConfirmed){
        const successor=await createAccountCloseOnlySuccessor({store:input.store,plan,positionAddress:recoveryPositionAddress,positionTruth,now:input.now});
        if(successor.created){
          results.push({planId:plan.planId,action:'RETURN_EXISTING_PLAN',reasonCodes:["P6_CLOSE_ACCOUNT_RETRY_SUCCESSOR_CREATED",...successor.reasonCodes]});
          continue;
        }
        if(successor.planId)continue;
        await input.store.transitionAutonomousPlan({planId:plan.planId,state:'RECONCILIATION_REQUIRED',at:input.now,reasonCodes:["P6_CLOSE_ACCOUNT_RETRY_SUCCESSOR_BLOCKED",...successor.reasonCodes],payload:{stage:'CLOSE_POSITION_PENDING',accountCloseRetryAfterConfirmedUnwind:true}});
        results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:["P6_CLOSE_ACCOUNT_RETRY_SUCCESSOR_BLOCKED",...successor.reasonCodes]});
        continue;
      }
    }
    // Compatibility for the one deterministic no-effect failure where an
    // expired account-close successor reached simulation before its child
    // transaction-step row existed. Require the exact retry identity, the
    // exact FK error, no submission row for that retry, and an independently
    // confirmed primary unwind before permitting a fresh final-close build.
    if(isPreSubmissionAccountCloseRetryStepRecovery({plan,journal,positionExists:positionTruth.exists===true})&&recoveryPositionAddress){
      const dispatch=closeSettlementDispatch(plan),retryTransactionId=typeof dispatch.transactionId==='string'?dispatch.transactionId:undefined,
        unwindTransactionId=typeof dispatch.unwindTransactionId==='string'?dispatch.unwindTransactionId:undefined,
        unwindConfirmed=unwindTransactionId?await input.store.loadConfirmedSubmissionByTransactionId(unwindTransactionId):undefined,
        retrySubmission=retryTransactionId?await input.store.loadSubmissionAttemptByTransactionId(retryTransactionId):undefined;
      if(unwindConfirmed&&!retrySubmission){
        await input.store.updateExecutionJournal({
          idempotencyKey:plan.idempotencyKey,
          expectedVersion:journal.version,
          transactionId:unwindTransactionId!,
          state:'CONFIRMED',
          signature:unwindConfirmed.signature,
          updatedAt:input.now,
          payload:{...journal.payload,recovery:'P6_CLOSE_ACCOUNT_RETRY_STEP_PRE_SUBMISSION_REHYDRATED',priorJournalState:journal.state,failedRetryTransactionId:retryTransactionId},
        });
        await input.store.transitionAutonomousPlan({
          planId:plan.planId,state:'RECONCILING',at:input.now,
          reasonCodes:['P6_CLOSE_ACCOUNT_RETRY_STEP_PRE_SUBMISSION_REHYDRATED'],
          payload:{stage:'CLOSE_INVENTORY_UNWOUND',pendingStage:null,pendingSignature:null,error:null,failedRetryTransactionId:retryTransactionId},
        });
        results.push({planId:plan.planId,action:'RESUME_CLOSE_SETTLEMENT',reasonCodes:['P6_CLOSE_ACCOUNT_RETRY_STEP_PRE_SUBMISSION_REHYDRATED']});
        continue;
      }
      await input.store.transitionAutonomousPlan({
        planId:plan.planId,state:'RECONCILIATION_REQUIRED',at:input.now,
        reasonCodes:['P6_CLOSE_ACCOUNT_RETRY_STEP_RECOVERY_PROOF_MISSING'],
        payload:{stage:'CLOSE_POSITION_PENDING',retryTransactionId:retryTransactionId??null,unwindTransactionId:unwindTransactionId??null,retrySubmissionPresent:Boolean(retrySubmission)},
      });
      results.push({planId:plan.planId,action:'HOLD_FOR_OPERATOR',reasonCodes:['P6_CLOSE_ACCOUNT_RETRY_STEP_RECOVERY_PROOF_MISSING']});
      continue;
    }
    const action = determineRecoveryAction({
      journal,
      currentBlockHeight: input.currentBlockHeight,
      confirmationStatus,
      economicEffect,
    });
    // Status-read failure must never turn an unknown post-send transaction
    // into a rebuild candidate, even after its blockhash has expired.
    if (
      signatureStatusReadUnknown &&
      (action === "REBUILD_WITH_NEW_BLOCKHASH" || action === "HOLD_FOR_OPERATOR")
    ) {
      await input.store.transitionAutonomousPlan({
        planId: plan.planId,
        state: "RECOVERING",
        at: input.now,
        reasonCodes: ["P6_RECOVERY_SIGNATURE_STATUS_READ_UNKNOWN"],
        payload: { journalId: journal.journalId, recovery: "STATUS_READ_UNKNOWN" },
      });
      results.push({
        planId: plan.planId,
        action: "HOLD_FOR_OPERATOR",
        reasonCodes: ["P6_RECOVERY_SIGNATURE_STATUS_READ_UNKNOWN"],
      });
      continue;
    }
    // A parent OPEN can have a real PositionV2 from an earlier confirmed
    // chunk while its *last* liquidity child has expired without landing.
    // Reconcile that child independently of parent position existence.  The
    // position is not evidence that this exact signature had an effect.
    if(
      plan.action==='OPEN'&&
      confirmationStatus==='EXPIRED'&&
      !signatureStatusReadUnknown&&
      effectiveRecoverySignature&&
      journal.transactionId
    ){
      const step=plan.steps.find(candidate=>candidate.transactionId===journal.transactionId);
      if(step&&(step.kind==='METEORA_OPEN'||step.kind==='METEORA_OPEN_CHUNK')){
        await input.store.markSubmissionExpired(effectiveRecoverySignature,input.now,'P6_OPEN_CHUNK_EXPIRED_NO_CHAIN_EFFECT');
        await input.store.upsertOpenChunkDisposition({planId:plan.planId,transactionId:step.transactionId,sequence:step.sequence,kind:step.kind,disposition:'PROVEN_NOT_LANDED',signature:effectiveRecoverySignature,...(journal.lastValidBlockHeight===undefined?{}:{lastValidBlockHeight:BigInt(journal.lastValidBlockHeight)}),observedAt:input.now,payload:{recovery:'P6_OPEN_CHUNK_EXPIRED_NO_CHAIN_EFFECT',confirmationStatus:'EXPIRED'}});
      }
    }
    // A verified on-chain OPEN position must be adopted into the owned
    // registry even when its plan's post-submit bookkeeping died. Adoption
    // never fabricates data: identity and capital come from chain truth and
    // the intent itself, and any missing input fails closed to HOLD.
    const adoptOpenPosition = async (): Promise<boolean> => {
      if (plan.action !== "OPEN" || economicEffect !== "PRESENT") return false;
      const address=recoveryPositionAddress??"";
      const intent = (plan.planPayload.intent ?? {}) as Record<
        string,
        unknown
      >;
      let capital = 0n;
      try {
        capital = BigInt(String(intent.capitalLamports ?? "0"));
      } catch {
        capital = 0n;
      }
      if (
        address === "" ||
        capital <= 0n ||
        positionTruth.exists !== true ||
        String(positionTruth.owner) !== plan.ownerAddress ||
        String(positionTruth.pool) !== plan.poolAddress
      )
        return false;
      const plannedChunks=plan.steps.filter(step=>step.kind==='METEORA_OPEN'||step.kind==='METEORA_OPEN_CHUNK').map((step,index)=>({transactionId:step.transactionId,sequence:index+1,kind:step.kind}));
      const construction=plannedChunks.length>1?assessOpenChunkConstruction({planned:plannedChunks,dispositions:await input.store.loadOpenChunkDispositions(plan.planId)}):{fullyConstructed:true,partial:false,reasonCodes:['P6_SINGLE_OPEN_CHUNK_CONFIRMED_BY_POSITION_TRUTH']};
      const funding = (plan.intentPayload.entryFunding ?? {}) as Record<
        string,
        unknown
      >;
      if(!construction.fullyConstructed){
        const partial=await input.store.loadPartialEntryRecovery(plan.planId);
        const planFlows=await input.store.loadPlanCashflows(plan.planId);
        const fundingLamports=planFlows.filter(flow=>flow.flowType==='ENTRY_FUNDING_SOL_OUT').reduce((total,flow)=>total+(flow.lamports??0n),0n);
        let confirmedLiquidityLamports=0n;
        try{const truth=(partial?.wallet_truth??{}) as Record<string,unknown>;confirmedLiquidityLamports=BigInt(String(truth.confirmedLiquiditySolAssetOutLamports??'0'));}catch{}
        const actualEconomicCapitalLamports=fundingLamports+confirmedLiquidityLamports;
        await input.store.upsertOwnedPosition({
          lpforgePositionId:`position-${address}`,poolAddress:plan.poolAddress,positionAddress:address,ownerAddress:plan.ownerAddress,strategy:String(intent.strategy??'SPOT'),orientation:String(funding.orientation??'ONE_SIDED_Y'),lowerBinId:Number(positionTruth.lowerBinId),upperBinId:Number(positionTruth.upperBinId),activeBinAtEntry:Number(intent.activeBinId??positionTruth.lowerBinId),initialCapitalLamports:capital,entryPlanId:plan.planId,...(journal.signature?{entrySignature:journal.signature}:{}),enteredAt:input.now,lifecycleState:'RECONCILIATION_REQUIRED',lastPlanId:plan.planId,reconciliationStatus:'PARTIAL_ENTRY',payload:{thesisId:plan.thesisId,entryFunding:funding,recovery:true,journalId:journal.journalId,partialEntry:true,actualEconomicCapitalLamports:actualEconomicCapitalLamports.toString(),openChunkDisposition:construction.reasonCodes,...(partial?.wallet_truth&&typeof partial.wallet_truth==='object'?{partialEntryWalletTruth:partial.wallet_truth as Record<string,unknown>}:{})},
        });
        if(connection&&partial){
          const mint=String(partial.token_mint??''),truth=(partial.wallet_truth??{}) as Record<string,unknown>,measurement=(truth.entryFundingMeasurement??{}) as Record<string,unknown>;
          try{const before=BigInt(String(measurement.pairedTokenRawBeforeFunding??'0')),received=BigInt(String(partial.paired_token_amount??'0')),current=await readWalletTokenBalance({connection,ownerAddress:plan.ownerAddress,mint}),residual=deriveRecoveredOpenResidualInventory({pairedTokenRawBeforeFunding:before,pairedTokenRawBeforeClose:current,pairedTokenRawAfterPriorUnwind:current,pairedTokenReceivedRaw:received}),fundingSignature=String(partial.funding_signature??'');if(mint&&fundingSignature&&residual!==undefined&&residual>0n){const supply=await connection.getTokenSupply(new PublicKey(mint),'confirmed');await input.store.createPositionInventoryLot({lotId:`${plan.planId}:partial-entry-residual:${mint}`,createdEventId:`${plan.planId}:partial-entry-residual-created`,positionAddress:address,planId:plan.planId,ownerAddress:plan.ownerAddress,poolAddress:plan.poolAddress,tokenMint:mint,tokenSide:'X',sourceEvent:'OPEN_RESIDUAL',rawAmount:residual,decimals:supply.value.decimals,acquiredAt:input.now,transactionSignature:fundingSignature,payload:{source:'P6_PARTIAL_ENTRY_CHAIN_RECONCILIATION',fundingSignature,attributionConfidence:'MEASURED_WALLET_DELTA',actualEconomicCapitalLamports:actualEconomicCapitalLamports.toString()}});}}catch{}
        }
        await input.store.upsertPartialEntryRecovery({planId:plan.planId,poolAddress:plan.poolAddress,ownerAddress:plan.ownerAddress,tokenMint:String(partial?.token_mint??funding.tokenMint??''),fundingTransactionId:String(partial?.funding_transaction_id??plan.steps[0]?.transactionId??'P6_PARTIAL_ENTRY'),fundingSignature:String(partial?.funding_signature??journal.signature??''),fundedAt:String(partial?.funded_at??input.now),pairedTokenAmount:String(partial?.paired_token_amount??funding.totalPairedTokenRaw??'0'),intendedCapitalLamports:capital,intendedRange:{lowerBinId:Number(positionTruth.lowerBinId),upperBinId:Number(positionTruth.upperBinId)},state:'RECONCILIATION_REQUIRED',walletTruth:{...(partial?.wallet_truth&&typeof partial.wallet_truth==='object'?partial.wallet_truth as Record<string,unknown>:{}),refreshRequired:true},payload:{partialEntry:true,positionAddress:address,reasonCodes:construction.reasonCodes},updatedAt:input.now});
        return false;
      }
      await input.store.upsertOwnedPosition({
        lpforgePositionId: `position-${address}`,
        poolAddress: plan.poolAddress,
        positionAddress: address,
        ownerAddress: plan.ownerAddress,
        strategy: String(intent.strategy ?? "SPOT"),
        orientation: String(funding.orientation ?? "ONE_SIDED_Y"),
        lowerBinId: Number(positionTruth.lowerBinId),
        upperBinId: Number(positionTruth.upperBinId),
        activeBinAtEntry: Number(
          intent.activeBinId ?? positionTruth.lowerBinId,
        ),
        initialCapitalLamports: capital,
        entryPlanId: plan.planId,
        ...(journal.signature ? { entrySignature: journal.signature } : {}),
        enteredAt: input.now,
        lifecycleState: "OPEN",
        lastPlanId: plan.planId,
        reconciliationStatus: "MATCH",
        payload: {
          thesisId: plan.thesisId,
          entryFunding: funding,
          recovery: true,
          journalId: journal.journalId,
        },
      });
      return true;
    };
    const holdOpenAdoption = async (): Promise<void> => {
      await input.store.transitionAutonomousPlan({
        planId: plan.planId,
        state: "RECONCILIATION_REQUIRED",
        at: input.now,
        reasonCodes: ["P6_RECOVERY_OPEN_POSITION_ADOPTION_BLOCKED"],
        payload: {
          journalId: journal.journalId,
          confirmationStatus,
          economicEffect,
          positionTruth,
        },
      });
      results.push({
        planId: plan.planId,
        action: "HOLD_FOR_OPERATOR",
        reasonCodes: ["P6_RECOVERY_OPEN_POSITION_ADOPTION_BLOCKED"],
      });
    };
    // This is intentionally narrower than generic expiry recovery. A fresh
    // OPEN may only replace this stale thesis after the original submitted
    // plan is terminalized and its reservation released; it is never replayed.
    if(plan.action==="OPEN"){
      const noEffectStore=input.store as Partial<Pick<Phase1Store,"loadPartialEntryRecovery"|"loadPlanCashflows"|"loadOpenChunkDispositions">>;
      const [partialEntryRecovery,initialPlanCashflows,initialChunkDispositions]=await Promise.all([
        noEffectStore.loadPartialEntryRecovery?.(plan.planId),
        noEffectStore.loadPlanCashflows?.(plan.planId)??[],
        noEffectStore.loadOpenChunkDispositions?.(plan.planId)??[],
      ]);
      let planCashflows=initialPlanCashflows,chunkDispositions=initialChunkDispositions;
      if(confirmationStatus==='FAILED'&&effectiveRecoverySignature&&journal.transactionId&&connection){
        const step=plan.steps.find(candidate=>candidate.transactionId===journal.transactionId),receipt=await loadConfirmedExecutionReceipt(connection,effectiveRecoverySignature);
        if(step&&receipt.state==='CONFIRMED_FAILURE'&&receipt.feeLamports!==undefined){
          await input.store.insertPlanCashflow({cashflowId:`${plan.planId}:execution-tx-cost:${journal.transactionId}`,planId:plan.planId,flowType:'EXECUTION_TX_COST',observedAt:input.now,lamports:receipt.feeLamports,transactionSignature:effectiveRecoverySignature,payload:{source:'CONFIRMED_FAILED_CHAIN_RECEIPT_RECOVERY',transactionId:journal.transactionId}});
          if(step.kind==='METEORA_OPEN'||step.kind==='METEORA_OPEN_CHUNK')await input.store.upsertOpenChunkDisposition({planId:plan.planId,transactionId:step.transactionId,sequence:step.sequence,kind:step.kind,disposition:'CONFIRMED_FAILED',signature:effectiveRecoverySignature,observedAt:input.now,payload:{confirmation:'FAILED',chainLanded:true,recovered:true}});
          planCashflows=await input.store.loadPlanCashflows(plan.planId);chunkDispositions=await input.store.loadOpenChunkDispositions(plan.planId);
        }
      }
      const failedNoProtocolEffect=assessConfirmedFailedOpenRecovery({confirmationStatus,economicEffect,positionAbsenceProven:positionTruth.absenceProven===true,signatureStatusReadUnknown,hasFundingChild:plan.steps.some(step=>step.kind==='JUPITER_SWAP'),partialEntryRecoveryPresent:partialEntryRecovery!==undefined,planCashflowTypes:planCashflows.map(flow=>flow.flowType),chunkDispositions:chunkDispositions.map(child=>child.disposition)});
      if(failedNoProtocolEffect.terminal){
        await input.store.insertExecutionReconciliation({reconciliationId:`${plan.planId}:open-failed-receipt-only`,planId:plan.planId,observedAt:input.now,status:'MATCH',expected:{action:'OPEN',owner:plan.ownerAddress,pool:plan.poolAddress,signature:effectiveRecoverySignature},actual:{confirmationStatus:'FAILED',protocolEffect:'ABSENT',transactionFeeEffect:'PRESENT',positionTruth},discrepancies:[],payload:{recovery:'OPEN_FAILED_CONFIRMED_NO_PROTOCOL_EFFECT',chainEffect:'FAILED_RECEIPT_ONLY'}});
        await input.store.updateExecutionJournal({idempotencyKey:plan.idempotencyKey,expectedVersion:journal.version,state:'RECONCILED',updatedAt:input.now,payload:{...journal.payload,recovery:'OPEN_FAILED_CONFIRMED_NO_PROTOCOL_EFFECT',signature:effectiveRecoverySignature,positionTruth}});
        await input.store.transitionAutonomousPlan({planId:plan.planId,state:'FAILED',at:input.now,reasonCodes:['P6_OPEN_FAILED_CONFIRMED_NO_PROTOCOL_EFFECT'],payload:{recovery:'OPEN_FAILED_CONFIRMED_NO_PROTOCOL_EFFECT',signature:effectiveRecoverySignature,chainEffect:'FAILED_RECEIPT_ONLY'}});
        await input.store.releaseExecutionCapital(plan.planId,input.now,['P6_OPEN_FAILED_CONFIRMED_NO_PROTOCOL_EFFECT']);
        results.push({planId:plan.planId,action:'RETURN_EXISTING_PLAN',reasonCodes:['P6_OPEN_FAILED_CONFIRMED_NO_PROTOCOL_EFFECT']});
        continue;
      }
      const noEffect=assessExpiredNoEffectOpenRecovery({
        confirmationStatus,
        economicEffect,
        positionAbsenceProven:positionTruth.absenceProven===true,
        signatureStatusReadUnknown,
        hasFundingChild:plan.steps.some(step=>step.kind==="JUPITER_SWAP"),
        fundingChildProvenNotLanded:
          confirmationStatus === "EXPIRED" &&
          Boolean(recoverySignature) &&
          journal.transactionId === plan.steps[0]?.transactionId &&
          plan.steps[0]?.kind === "JUPITER_SWAP" &&
          plan.steps.slice(1).every(step => step.state === "PLANNED"),
        partialEntryRecoveryPresent:partialEntryRecovery!==undefined,
        planCashflowCount:planCashflows.length,
        chunkDispositions:chunkDispositions.map(child=>child.disposition),
      });
      if(noEffect.terminal){
        await input.store.insertExecutionReconciliation({
          reconciliationId:`${plan.planId}:open-no-effect`,
          planId:plan.planId,
          observedAt:input.now,
          status:"MATCH",
          expected:{action:"OPEN",owner:plan.ownerAddress,pool:plan.poolAddress,signature:effectiveRecoverySignature??null},
          actual:{confirmationStatus,economicEffect:"ABSENT",positionTruth,signature:effectiveRecoverySignature??null,fundingChildProvenNotLanded:true},
          discrepancies:[],
          payload:{recovery:"OPEN_EXPIRED_NO_CHAIN_EFFECT",chainEffect:"NONE",planCashflowCount:planCashflows.length,chunkDispositionCount:chunkDispositions.length},
        });
        await input.store.transitionAutonomousPlan({
          planId:plan.planId,
          state:"EXPIRED",
          at:input.now,
          reasonCodes:["P6_OPEN_EXPIRED_NO_CHAIN_EFFECT"],
          payload:{
            recovery:"OPEN_EXPIRED_NO_CHAIN_EFFECT",
            journalId:journal.journalId,
            confirmationStatus,
            economicEffect,
            positionTruth,
            signature:effectiveRecoverySignature??null,
            noEffectProof:{planCashflowCount:planCashflows.length,chunkDispositionCount:chunkDispositions.length},
          },
        });
        await input.store.releaseExecutionCapital(plan.planId,input.now,["P6_OPEN_EXPIRED_NO_CHAIN_EFFECT"]);
        results.push({planId:plan.planId,action:"RETURN_EXISTING_PLAN",reasonCodes:["P6_OPEN_EXPIRED_NO_CHAIN_EFFECT"]});
        continue;
      }
    }
    // RETURN_EXISTING_PLAN means no transaction was submitted. Leaving a
    // claimed pre-submission plan unresolved would indefinitely block the
    // worker and invite a stale trade to be resumed later. Finalize it
    // instead; a fresh production decision must create any replacement.
    if (action === "RETURN_EXISTING_PLAN") {
      const expired = Date.parse(plan.expiresAt) <= Date.parse(input.now);
      await input.store.updateExecutionJournal({
        idempotencyKey: plan.idempotencyKey,
        expectedVersion: journal.version,
        state: expired ? "EXPIRED" : "FAILED",
        updatedAt: input.now,
        payload: {
          ...journal.payload,
          recovery: "PRE_SUBMISSION_ABORTED",
          confirmationStatus,
          economicEffect,
          positionTruth,
        },
      });
      if (expired)
        await input.store.transitionAutonomousPlan({
          planId: plan.planId,
          state: "EXPIRED",
          at: input.now,
          reasonCodes: ["P6_RECOVERY_PRE_SUBMISSION_PLAN_EXPIRED"],
          payload: { journalId: journal.journalId, recovery: true },
        });
      else
        await input.store.completeAutonomousPlan({
          planId: plan.planId,
          state: "FAILED",
          at: input.now,
          payload: { journalId: journal.journalId, recovery: true },
        });
      await input.store.releaseExecutionCapital(plan.planId, input.now, [
        expired
          ? "P6_RECOVERY_PRE_SUBMISSION_PLAN_EXPIRED"
          : "P6_RECOVERY_PRE_SUBMISSION_ABORTED",
      ]);
      results.push({
        planId: plan.planId,
        action,
        reasonCodes: [
          expired
            ? "P6_RECOVERY_PRE_SUBMISSION_PLAN_EXPIRED"
            : "P6_RECOVERY_PRE_SUBMISSION_ABORTED",
        ],
      });
      continue;
    }
    if (
      action === "MARK_RECONCILED" &&
      plan.action !== "RESHAPE" &&
      plan.action !== "REBALANCE"
    ) {
      if (plan.action === "OPEN") {
        if (!(await adoptOpenPosition())) {
          await holdOpenAdoption();
          continue;
        }
      } else if (plan.action === "CLOSE" || plan.action === "EMERGENCY_CLOSE") {
        // The position is verifiably gone and the close confirmed: retire
        // the owned row so capital accounting and capacity reflect reality.
        await input.store.markOwnedPositionLifecycle({
          positionAddress: plan.positionAddress ?? "",
          lifecycleState: "CLOSED",
          reconciliationStatus: "MATCH",
          lastPlanId: plan.planId,
          at: input.now,
          payload: {
            stage: "RECOVERY_CLOSE_VERIFIED",
            journalId: journal.journalId,
            confirmationStatus,
            economicEffect,
          },
        });
      }
      await input.store.insertExecutionReconciliation({
        reconciliationId: `${plan.planId}:recovery`,
        planId: plan.planId,
        observedAt: input.now,
        status: "MATCH",
        expected: {
          action: plan.action,
          owner: plan.ownerAddress,
          pool: plan.poolAddress,
        },
        actual: { confirmationStatus, economicEffect, positionTruth },
        discrepancies: [],
        payload: { recovered: true, journalId: journal.journalId },
      });
      await input.store.completeAutonomousPlan({
        planId: plan.planId,
        state: "RECONCILED",
        at: input.now,
        payload: {
          recovery: true,
          confirmationStatus,
          economicEffect,
          positionTruth,
        },
      });
      results.push({
        planId: plan.planId,
        action,
        reasonCodes: ["P6_RECOVERY_CHAIN_TRUTH_RECONCILED"],
      });
      continue;
    }
    if (action === "RECONCILE_FIRST" && plan.action === "OPEN") {
      // A confirmed OPEN whose bookkeeping never recorded the position:
      // adopt it and complete the plan instead of looping in RECOVERING.
      if (await adoptOpenPosition()) {
        await input.store.insertExecutionReconciliation({
          reconciliationId: `${plan.planId}:recovery`,
          planId: plan.planId,
          observedAt: input.now,
          status: "MATCH",
          expected: {
            action: plan.action,
            owner: plan.ownerAddress,
            pool: plan.poolAddress,
          },
          actual: { confirmationStatus, economicEffect, positionTruth },
          discrepancies: [],
          payload: { recovered: true, journalId: journal.journalId },
        });
        await input.store.completeAutonomousPlan({
          planId: plan.planId,
          state: "RECONCILED",
          at: input.now,
          payload: {
            recovery: true,
            confirmationStatus,
            economicEffect,
            positionTruth,
          },
        });
        results.push({
          planId: plan.planId,
          action,
          reasonCodes: ["P6_RECOVERY_OPEN_POSITION_ADOPTED"],
        });
        continue;
      }
      await holdOpenAdoption();
      continue;
    }
    if (
      action === "WAIT_DO_NOT_RESUBMIT" ||
      action === "RECONCILE_FIRST" ||
      action === "MARK_RECONCILED" ||
      action === "HOLD_FOR_OPERATOR"
    )
      await input.store.transitionAutonomousPlan({
        planId: plan.planId,
        state:
          action === "HOLD_FOR_OPERATOR"
            ? "RECONCILIATION_REQUIRED"
            : "RECOVERING",
        at: input.now,
        reasonCodes: [`P6_RECOVERY_${action}`],
        payload: {
          journalId: journal.journalId,
          confirmationStatus,
          economicEffect,
          positionTruth,
        },
      });
    results.push({
      planId: plan.planId,
      action,
      reasonCodes: [`P6_RECOVERY_${action}`],
    });
  }
  // A close receipt can arrive before a process has persisted its exact
  // PositionV2 rent refund. Reconcile only terminal close plans that have no
  // such cashflow; this is receipt-backed accounting repair, never an
  // economic action or transaction resend.
  if(connection&&input.rpcUrl){
    for(const candidate of await input.store.loadTerminalCloseRentRecoveryCandidates(16)){
      const plan=await input.store.loadAutonomousPlan(candidate.planId);
      if(!plan||!plan.positionAddress||plan.positionAddress!==candidate.positionAddress)continue;
      const settlement=await finalizeClosedPositionSettlement({store:input.store,plan,positionAddress:candidate.positionAddress,connection,config:settlementFinalizationConfig(input)});
      results.push({planId:plan.planId,action:settlement.ready?"MARK_RECONCILED":"HOLD_FOR_OPERATOR",reasonCodes:settlement.ready?["P6_CLOSE_POSITION_RENT_RECOVERY_RECONCILED"]:settlement.reasonCodes});
    }
  }
  return results;
}
export interface WalletPositionFact {
  positionAddress: string;
  owner: string;
  pool: string;
  lowerBinId: number;
  upperBinId: number;
  activeBinId?: number;
  tokenXAmount?: string;
  tokenYAmount?: string;
  feeX?: string;
  feeY?: string;
  chainSlot?: bigint;
}
export interface WalletWidePositionReconciliation {
  scanned: number;
  known: number;
  adopted: number;
  unknown: number;
  ambiguous: number;
  dbOnly: number;
  reasonCodes: string[];
}
const recordValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const positiveBigInt = (value: unknown): bigint | undefined => {
  try {
    const parsed = BigInt(String(value ?? ""));
    return parsed > 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
};
const exactInteger = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
};
const openPlanStates = new Set([
  "SUBMITTED",
  "UNKNOWN_SUBMISSION",
  "CONFIRMED",
  "RECONCILING",
  "RECOVERING",
  "RECONCILIATION_REQUIRED",
  "RECONCILED",
]);

/**
 * Authoritative, bounded wallet sweep. It never signs or submits. A position
 * is added to owned_positions only when a single immutable LPForge OPEN plan
 * and durable journal signature bind the same owner, pool, range, and capital.
 * Every other signer-owned position is durable forensic evidence, not trading
 * authority.
 */
export async function reconcileWalletWidePositions(input: {
  store: Phase1Store;
  rpcUrl: string;
  programId: string;
  ownerAddress?: string;
  now?: string;
  /** Test seam for one authoritative signer-wallet scan. */
  walletPositionsProvider?: () => Promise<WalletPositionFact[]>;
}): Promise<WalletWidePositionReconciliation> {
  const at = input.now ?? new Date().toISOString();
  if (!input.ownerAddress?.trim())
    return { scanned: 0, known: 0, adopted: 0, unknown: 0, ambiguous: 0, dbOnly: 0, reasonCodes: [] };
  const ownerAddress = input.ownerAddress.trim();
  const defaultProvider = async (): Promise<WalletPositionFact[]> => {
    const runtime = await loadMeteoraExecutionRuntime();
    if (typeof runtime.DLMM.getAllLbPairPositionsByUser !== "function")
      throw new Error("LPFORGE_WALLET_SWEEP_RUNTIME_UNAVAILABLE");
    const adapter = createMeteoraReadAdapter({
      rpcUrl: input.rpcUrl,
      cluster: "mainnet-beta",
      programId: input.programId,
      priority:'P1_RECOVERY_CRITICAL',
    });
    const result = await runtime.DLMM.getAllLbPairPositionsByUser(
      createGovernedConnection({rpcUrl:input.rpcUrl,priority:'P1_RECOVERY_CRITICAL'}),
      new runtime.PublicKey(ownerAddress),
      {
        cluster: "mainnet-beta",
        programId: new runtime.PublicKey(input.programId),
      },
      // Recovery is deliberately low-pressure: a wallet scan is a fallback
      // adoption path, never an execution-critical RPC fan-out.
      { chunkSize: 20, isParallelExecution: false },
    );
    const facts: WalletPositionFact[] = [];
    for (const [poolAddress, entry] of result.entries()) {
      for (const position of entry.lbPairPositionsData ?? []) {
        const fact = await adapter.getPositionV2(
          poolAddress,
          position.publicKey.toBase58(),
        );
        facts.push({
          positionAddress: position.publicKey.toBase58(),
          owner: fact.owner,
          pool: fact.pool,
          lowerBinId: fact.lowerBinId,
          upperBinId: fact.upperBinId,
          tokenXAmount: fact.totalXAmount,
          tokenYAmount: fact.totalYAmount,
          ...(fact.feeX === undefined ? {} : { feeX: fact.feeX }),
          ...(fact.feeY === undefined ? {} : { feeY: fact.feeY }),
          ...(fact.stamp.chainSlot === undefined ? {} : { chainSlot: fact.stamp.chainSlot }),
        });
      }
    }
    return facts;
  };
  let facts: WalletPositionFact[];
  try {
    facts = await (input.walletPositionsProvider ?? defaultProvider)();
  } catch (error) {
    return {
      scanned: 0, known: 0, adopted: 0, unknown: 0, ambiguous: 0, dbOnly: 0,
      reasonCodes: [error instanceof Error && error.message === "LPFORGE_WALLET_SWEEP_RUNTIME_UNAVAILABLE" ? "P6_WALLET_SWEEP_RUNTIME_UNAVAILABLE" : "P6_WALLET_SWEEP_READ_FAILED"],
    };
  }
  const owned = await input.store.loadOwnedPositions(ownerAddress);
  const knownByAddress = new Map(owned.map(row => [String(row.position_address), row]));
  const scannedByAddress = new Map<string, WalletPositionFact>();
  const duplicateAddresses = new Set<string>();
  for (const fact of facts) {
    if (scannedByAddress.has(fact.positionAddress)) duplicateAddresses.add(fact.positionAddress);
    else scannedByAddress.set(fact.positionAddress, fact);
  }
  const result: WalletWidePositionReconciliation = { scanned: 0, known: 0, adopted: 0, unknown: 0, ambiguous: 0, dbOnly: 0, reasonCodes: [] };
  for (const fact of scannedByAddress.values()) {
    if (fact.owner !== ownerAddress) continue;
    result.scanned++;
    const basePayload = {
      source: "P6_WALLET_WIDE_RECONCILIATION",
      lowerBinId: fact.lowerBinId,
      upperBinId: fact.upperBinId,
      ...(fact.activeBinId === undefined ? {} : { activeBinId: fact.activeBinId }),
      ...(fact.tokenXAmount === undefined ? {} : { tokenXAmount: fact.tokenXAmount }),
      ...(fact.tokenYAmount === undefined ? {} : { tokenYAmount: fact.tokenYAmount }),
      ...(fact.feeX === undefined ? {} : { feeX: fact.feeX }),
      ...(fact.feeY === undefined ? {} : { feeY: fact.feeY }),
      ...(fact.chainSlot === undefined ? {} : { chainSlot: fact.chainSlot.toString() }),
    };
    const known = knownByAddress.get(fact.positionAddress);
    if (known) {
      result.known++;
      await input.store.upsertWalletPositionDiscovery({
        ownerAddress, positionAddress: fact.positionAddress, poolAddress: fact.pool,
        classification: "KNOWN_LPFORGE_POSITION", lpforgePositionId: String(known.lpforge_position_id),
        ...(known.entry_plan_id ? { executionPlanId: String(known.entry_plan_id) } : {}),
        firstSeenAt: at, lastSeenAt: at, lastReconciledAt: at, payload: basePayload,
      });
      continue;
    }
    const plans = duplicateAddresses.has(fact.positionAddress)
      ? []
      : await input.store.findAutonomousOpenPlansByPosition({ ownerAddress, poolAddress: fact.pool, positionAddress: fact.positionAddress });
    if (plans.length !== 1) {
      const classification: WalletPositionClassification = plans.length > 1 || duplicateAddresses.has(fact.positionAddress) ? "AMBIGUOUS_POSITION" : "UNKNOWN_WALLET_POSITION";
      if (classification === "AMBIGUOUS_POSITION") result.ambiguous++; else result.unknown++;
      await input.store.upsertWalletPositionDiscovery({ ownerAddress, positionAddress: fact.positionAddress, poolAddress: fact.pool, classification, firstSeenAt: at, lastSeenAt: at, lastReconciledAt: at, payload: { ...basePayload, reasonCodes: [classification === "AMBIGUOUS_POSITION" ? "P6_WALLET_POSITION_LINKAGE_AMBIGUOUS" : "P6_WALLET_POSITION_LINKAGE_MISSING"] } });
      continue;
    }
    const plan = plans[0]!;
    const journal = await input.store.getExecutionJournal(plan.idempotencyKey);
    const intent = recordValue(plan.planPayload.intent);
    const capital = positiveBigInt(intent.capitalLamports);
    const lower = exactInteger(intent.lowerBinId);
    const upper = exactInteger(intent.upperBinId);
    const active = exactInteger(intent.activeBinId) ?? fact.lowerBinId;
    const strategy = String(intent.strategy ?? "");
    const funding = recordValue(plan.intentPayload.entryFunding);
    const signature = typeof journal?.signature === "string" ? journal.signature.trim() : "";
    const linkageValid = Boolean(
      signature && openPlanStates.has(plan.state) && capital !== undefined &&
      lower === fact.lowerBinId && upper === fact.upperBinId &&
      ["SPOT", "CURVE", "BID_ASK"].includes(strategy),
    );
    if (!linkageValid) {
      result.ambiguous++;
      await input.store.upsertWalletPositionDiscovery({ ownerAddress, positionAddress: fact.positionAddress, poolAddress: fact.pool, classification: "AMBIGUOUS_POSITION", executionPlanId: plan.planId, firstSeenAt: at, lastSeenAt: at, lastReconciledAt: at, payload: { ...basePayload, reasonCodes: ["P6_WALLET_POSITION_LINKAGE_INCOMPLETE"], planState: plan.state, journalState: journal?.state ?? null } });
      continue;
    }
    await input.store.upsertOwnedPosition({
      lpforgePositionId: `position-${fact.positionAddress}`,
      poolAddress: fact.pool,
      positionAddress: fact.positionAddress,
      ownerAddress,
      strategy,
      orientation: String(funding.orientation ?? "UNKNOWN"),
      lowerBinId: fact.lowerBinId,
      upperBinId: fact.upperBinId,
      activeBinAtEntry: active,
      initialCapitalLamports: capital!,
      entryPlanId: plan.planId,
      entrySignature: signature,
      ...(fact.chainSlot === undefined ? {} : { entrySlot: fact.chainSlot }),
      enteredAt: journal?.updatedAt ?? at,
      lifecycleState: "OPEN",
      lastPlanId: plan.planId,
      reconciliationStatus: "MATCH",
      payload: { thesisId: plan.thesisId, entryFunding: funding, recoveredBy: "P6_WALLET_WIDE_RECONCILIATION", journalId: journal?.journalId },
    });
    await input.store.insertExecutionReconciliation({
      reconciliationId: `${plan.planId}:wallet-wide-recovery`, planId: plan.planId, observedAt: at, status: "MATCH",
      expected: { owner: ownerAddress, pool: plan.poolAddress, lowerBinId: lower, upperBinId: upper },
      actual: { positionAddress: fact.positionAddress, owner: fact.owner, pool: fact.pool, lowerBinId: fact.lowerBinId, upperBinId: fact.upperBinId },
      discrepancies: [], payload: { recoveredBy: "P6_WALLET_WIDE_RECONCILIATION", journalId: journal?.journalId, signature },
    });
    await input.store.upsertWalletPositionDiscovery({ ownerAddress, positionAddress: fact.positionAddress, poolAddress: fact.pool, classification: "KNOWN_LPFORGE_POSITION", lpforgePositionId: `position-${fact.positionAddress}`, executionPlanId: plan.planId, firstSeenAt: at, lastSeenAt: at, lastReconciledAt: at, payload: { ...basePayload, recovered: true, journalId: journal?.journalId, signature } });
    result.adopted++;
  }
  for (const [positionAddress, row] of knownByAddress) {
    if (scannedByAddress.has(positionAddress)) continue;
    result.dbOnly++;
    await input.store.upsertWalletPositionDiscovery({ ownerAddress, positionAddress, poolAddress: String(row.pool_address), classification: "DB_ONLY", lpforgePositionId: String(row.lpforge_position_id), ...(row.entry_plan_id ? { executionPlanId: String(row.entry_plan_id) } : {}), firstSeenAt: at, lastSeenAt: at, lastReconciledAt: at, payload: { source: "P6_WALLET_WIDE_RECONCILIATION", reasonCodes: ["P6_WALLET_SWEEP_DB_ONLY"] } });
    await input.store.markOwnedPositionLifecycle({ positionAddress, lifecycleState: "RECONCILIATION_REQUIRED", reconciliationStatus: "MISMATCH", ...(row.last_plan_id ? { lastPlanId: String(row.last_plan_id) } : {}), at, payload: { stage: "WALLET_WIDE_RECONCILIATION", reasonCodes: ["P6_WALLET_SWEEP_DB_ONLY"] } });
  }
  return result;
}

/** Backward-compatible name for callers that previously supplied pool hints.
 * Pool hints are intentionally ignored: authoritative recovery is wallet-wide.
 */
export async function reconcileOrphanedPositions(input: {
  store: Phase1Store;
  rpcUrl: string;
  programId: string;
  ownerAddress?: string;
  poolAddresses: string[];
  now?: string;
}): Promise<{ adopted: number; reasonCodes: string[] }> {
  const result = await reconcileWalletWidePositions(input);
  return { adopted: result.adopted, reasonCodes: result.reasonCodes };
}
