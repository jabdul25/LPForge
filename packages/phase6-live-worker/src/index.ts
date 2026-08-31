// LPFORGE_PHASE6_MAINNET_MODULE
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { loadConfirmedExecutionReceipt } from "../../transaction-receipt/src/index.js";
import { deriveTransactionAssetEffects } from "../../transaction-asset-effects/src/index.js";
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
import type { ControlledCanaryDeploymentPolicy } from "../../deployment-policy/src/index.js";
import { assessLifecycleSettlement } from "../../db/src/index.js";
import type {
  AutonomousPlan,
  AutonomousPlanAction,
  OpenChunkDispositionRecord,
  Phase1Store,
  WalletPositionClassification,
} from "../../db/src/index.js";
import {
  assertExecutionJournalTransition,
  determineRecoveryAction,
  type ExecutionJournalState,
  type ExecutionJournal,
} from "../../execution-recovery/src/index.js";

const JUPITER_SWAP_V6_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

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
  /** Present only while the explicitly approved controlled canary is armed. */
  controlledCanary?: ControlledCanaryDeploymentPolicy;
}
export interface LiveWorkerResult {
  status: "IDLE" | "BLOCKED" | "SUBMITTED" | "RECONCILED" | "UNKNOWN";
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
/** A chunked OPEN becomes ordinary OPEN only after every planned economic add
 * has authoritative chain confirmation. Position-account existence alone is
 * deliberately insufficient because the extension and first chunk can land. */
export function assessOpenChunkConstruction(input:{planned:ReadonlyArray<{transactionId:string;sequence:number;kind:string}>;dispositions:ReadonlyArray<Pick<OpenChunkDispositionRecord,"transactionId"|"disposition">>}):{fullyConstructed:boolean;partial:boolean;reasonCodes:string[]}{
  const economic=input.planned.filter(step=>step.kind==='METEORA_OPEN'||step.kind==='METEORA_OPEN_CHUNK');
  const byId=new Map(input.dispositions.map(row=>[row.transactionId,row.disposition]));
  const missing=economic.filter(step=>byId.get(step.transactionId)!=='CONFIRMED');
  if(missing.length===0)return{fullyConstructed:true,partial:false,reasonCodes:['P6_OPEN_ALL_ECONOMIC_CHUNKS_CONFIRMED']};
  const terminal=missing.some(step=>['PROVEN_NOT_LANDED','FAILED_PRE_SIGN','EXPIRED_PRE_SUBMISSION'].includes(String(byId.get(step.transactionId))));
  const unknown=missing.some(step=>['UNKNOWN_SUBMISSION','SUBMITTED','SIGNING','SIGNED','PENDING'].includes(String(byId.get(step.transactionId))));
  return{fullyConstructed:false,partial:terminal,reasonCodes:[terminal?'P6_OPEN_PARTIAL_CONSTRUCTION':'P6_OPEN_CHUNK_DISPOSITION_PENDING',...(unknown?['P6_OPEN_CHUNK_CHAIN_TRUTH_UNRESOLVED']:[]),...missing.map(step=>`P6_OPEN_CHUNK_NOT_CONFIRMED:${step.transactionId}`)]};
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
export function assessFreshOpenPortfolioTruth(input:{openPositions:number;pendingExecutionCount:number;unresolvedReconciliationDebt:number}):{clean:boolean;expectedPendingExecutionCount:1;reasonCodes:string[]}{
  const reasons:string[]=[];
  if(input.openPositions!==0)reasons.push("P6_FRESH_EXECUTION_OPEN_POSITION_EXISTS");
  if(input.pendingExecutionCount!==1)reasons.push("P6_FRESH_EXECUTION_PENDING_PLAN_MISMATCH");
  if(input.unresolvedReconciliationDebt!==0)reasons.push("P6_FRESH_EXECUTION_RECONCILIATION_DEBT");
  return{clean:reasons.length===0,expectedPendingExecutionCount:1,reasonCodes:reasons};
}
/** Loads the live authorities immediately before economic signing. Nothing in
 * this snapshot is a favorable default: an unavailable source fails closed. */
export async function loadFreshExecutionSafetyFacts(input:{store:Pick<Phase1Store,'loadLatestPhase7ControlDecision'|'loadPhase7ControlDecision'|'loadPhase7PortfolioFacts'>;plan:AutonomousOpenPlan;config:Pick<LiveWorkerConfig,'rpcUrl'|'programId'>;connection?:Pick<Connection,'getLatestBlockhash'>;now?:string;phase7RuntimeId?:string;protocolCompatibility?:()=>Promise<boolean>}):Promise<FreshExecutionSafetyFacts>{
  const now=input.now??new Date().toISOString(),reasons:string[]=[],runtimeId=input.phase7RuntimeId??(process.env.LPFORGE_P7_RUNTIME_ID??'lpforge-production').trim(),provenance=planRecord(input.plan.planPayload.provenance),binding=planRecord(provenance.phase7Control),boundDecisionId=String(binding.decisionId??'');
  let portfolio:Awaited<ReturnType<Phase1Store['loadPhase7PortfolioFacts']>>|undefined,current;
  try{
    const [currentRow,boundRow,facts]=await Promise.all([input.store.loadLatestPhase7ControlDecision(runtimeId),boundDecisionId?input.store.loadPhase7ControlDecision(runtimeId,boundDecisionId):Promise.resolve(undefined),input.store.loadPhase7PortfolioFacts(input.plan.ownerAddress)]);
    current=phase7ExecutionControlFromRow(currentRow);
    const phase7Reasons=validateFreshOpenPhase7Safety({plan:input.plan as unknown as AutonomousPlan,current,bound:phase7ExecutionControlFromRow(boundRow),now,controlledCanary:controlledCanaryAuthorization(input.plan)});
    reasons.push(...phase7Reasons);portfolio=facts;
  }catch{reasons.push('P6_FRESH_EXECUTION_SAFETY_P7_OR_PORTFOLIO_UNAVAILABLE');}
  const portfolioTruth=portfolio===undefined?undefined:assessFreshOpenPortfolioTruth(portfolio);
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
export async function checkFreshOpenSubmissionSafety(input:{store:Pick<Phase1Store,'loadLatestPhase7ControlDecision'|'loadPhase7ControlDecision'|'loadPhase7PortfolioFacts'>;plan:AutonomousOpenPlan;permitExpiresAt:string;now?:string;phase7RuntimeId?:string}):Promise<{approved:boolean;reasonCodes:string[]}>{
  const now=input.now??new Date().toISOString(),reasons:string[]=[],runtimeId=input.phase7RuntimeId??(process.env.LPFORGE_P7_RUNTIME_ID??'lpforge-production').trim(),provenance=planRecord(input.plan.planPayload.provenance),binding=planRecord(provenance.phase7Control),boundDecisionId=String(binding.decisionId??'');
  if(!Number.isFinite(Date.parse(input.permitExpiresAt))||Date.parse(input.permitExpiresAt)<=Date.parse(now))reasons.push('P6_PRESUBMISSION_RISK_PERMIT_EXPIRED');
  try{const [currentRow,boundRow,portfolio]=await Promise.all([input.store.loadLatestPhase7ControlDecision(runtimeId),boundDecisionId?input.store.loadPhase7ControlDecision(runtimeId,boundDecisionId):Promise.resolve(undefined),input.store.loadPhase7PortfolioFacts(input.plan.ownerAddress)]);reasons.push(...validateFreshOpenPhase7Safety({plan:input.plan as unknown as AutonomousPlan,current:phase7ExecutionControlFromRow(currentRow),bound:phase7ExecutionControlFromRow(boundRow),now,controlledCanary:controlledCanaryAuthorization(input.plan)}));if(!assessFreshOpenPortfolioTruth(portfolio).clean)reasons.push("P6_PRESUBMISSION_RECONCILIATION_OR_PORTFOLIO_BLOCK");}catch{reasons.push("P6_PRESUBMISSION_SAFETY_UNAVAILABLE");}
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
    markUnknown: (attemptId, at, error) =>
      store.markSubmissionUnknown(attemptId, at, error),
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
async function recordJournal(
  store: Phase1Store,
  plan: AutonomousPlan,
  state: ExecutionJournalState,
  payload: Record<string, unknown>,
  signature?: string,
) {
  const existing = await store.getExecutionJournal(plan.idempotencyKey);
  if (!existing) {
    await store.createExecutionJournal({
      journalId: `journal-${plan.planId}`,
      idempotencyKey: plan.idempotencyKey,
      planId: plan.planId,
      ...(plan.steps[0] ? { transactionId: plan.steps[0].transactionId } : {}),
      state,
      ...(signature ? { signature } : {}),
      version: 1,
      updatedAt: new Date().toISOString(),
      payload,
    });
    return;
  }
  assertExecutionJournalTransition(String(existing.state) as ExecutionJournalState, state);
  await store.updateExecutionJournal({
    idempotencyKey: plan.idempotencyKey,
    expectedVersion: Number(existing.version),
    state,
    ...(signature ? { signature } : {}),
    updatedAt: new Date().toISOString(),
    payload,
  });
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
  action: AutonomousPlanAction = "OPEN",
) {
  return {
    ticketId: `${plan.planId}:${action.toLowerCase()}:${Date.parse(now)}`,
    poolAddress: plan.poolAddress,
    ownerAddress: plan.ownerAddress,
    action,
    maxLamports: capital,
    maxOpenPositions: 1,
    issuedAt: now,
    expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
    policyHash: "autonomous-plan-bound",
    autonomousScaling: false as const,
  };
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
  await signMainnetCanary({
    authority: input.openAuthority,
    ticket: input.openTicket,
    transactionId: input.plan.swapTransactionId,
    requiredSignerAddresses: [input.plan.ownerAddress],
    backend: input.signer,
    envelope,
    signedAt,
  });
  const finalSafety=await checkFreshOpenSubmissionSafety({store:input.store,plan:input.plan,permitExpiresAt:risk.expiresAt!});
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
    throw new Error("LPFORGE_P6_SWAP_CONFIRMATION_PENDING");
  const [nativeLamportsAfter,wsolRawAfter,pairedTokenRawAfter]=await Promise.all([
    input.connection.getBalance(new PublicKey(input.plan.ownerAddress),"confirmed").then(value=>BigInt(value)),
    readWalletTokenBalance({connection:input.connection,ownerAddress:input.plan.ownerAddress,mint:WSOL_MINT}),
    readWalletTokenBalance({connection:input.connection,ownerAddress:input.plan.ownerAddress,mint:pool.tokenXMint}),
  ]);
  const actualFee=await confirmedTransactionFeeLamports(input.connection,record.signature)??fee.totalFeeLamports,
    settlement=deriveEntryFundingSettlement({nativeLamportsBefore,nativeLamportsAfter,wsolRawBefore,wsolRawAfter,pairedTokenRawBefore:pairedTokenRawBeforeFunding,pairedTokenRawAfter,transactionFeeLamports:actualFee}),
    fundedAt=new Date().toISOString();
  await input.store.insertPlanCashflow({cashflowId:`${input.plan.planId}:entry-funding-sol-out`,planId:input.plan.planId,flowType:"ENTRY_FUNDING_SOL_OUT",observedAt:fundedAt,lamports:settlement.solAssetOutLamports,transactionSignature:record.signature,payload:{source:"WALLET_DELTA",nativeLamportsBefore:nativeLamportsBefore.toString(),nativeLamportsAfter:nativeLamportsAfter.toString(),wsolRawBefore:wsolRawBefore.toString(),wsolRawAfter:wsolRawAfter.toString(),quoteInputAmount:String(quote.inAmount??sol),quoteOutputAmount:String(quote.outAmount??"")}});
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
}
/**
 * Executes an extended PositionV2 open as an ordered durable plan. Every SDK
 * chunk is independently simulated and confirmed before the next one is sent.
 * A post-extension interruption is never retried blindly: the plan remains in
 * reconciliation-required state with its exact completed step/signature.
 */
async function executeChunkableAutonomousOpen(input:{store:Phase1Store;plan:AutonomousOpenPlan;signer:MainnetSignerBackend;config:LiveWorkerConfig;connection:Connection;pool:MeteoraOpenAddPoolLike;prepared:PreparedAutonomousOpen;fields:ReturnType<typeof planFields>;entryFundingMeasurement?:EntryFundingMeasurement}):Promise<LiveWorkerResult>{
  let submittedAny=false,lastSignature='',confirmedEntrySlot:bigint|undefined,completedSteps:Array<{transactionId:string;signature:string;estimatedFeeLamports:bigint}>=[],currentStep:{transactionId:string;sequence:number;kind:string;lastValidBlockHeight?:bigint;signature?:string;submitted:boolean}|undefined,confirmedLiquiditySolAssetOut=0n;
  try{
    for(const [stepIndex,step] of input.prepared.steps.entries()){
      currentStep={transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,submitted:false};
      await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:'PENDING',observedAt:new Date().toISOString(),payload:{chunked:true,metadata:step.metadata}});
      const simulatedAt=new Date().toISOString(),simulation=await simulateExecutionTransaction({authority:authority('MAINNET_BUILD_SIMULATE',simulatedAt,input.config.riskPermitTtlMs),transactionId:step.transactionId,transaction:step.transaction,transport:createWeb3SimulationTransport(input.connection),simulatedAt,freshnessMs:input.config.simulationFreshnessMs});
      await input.store.insertExecutionSimulation({transactionId:step.transactionId,simulatedAt:simulation.simulatedAt,freshUntil:simulation.simulationFreshUntil,ok:simulation.ok,...(simulation.unitsConsumed!==undefined?{unitsConsumed:simulation.unitsConsumed}:{}),logs:simulation.logs,...(simulation.error?{error:simulation.error}:{}),payload:{planId:input.plan.planId,positionAddress:input.prepared.positionSigner.publicKeyAddress,operation:step.kind,chunked:true}});
      const fee=estimateExecutionFee({signatureCount:step.requiredSignerAddresses.length,computeUnitLimit:simulation.recommendedComputeUnitLimit??0,computeUnitPriceMicroLamports:0n}),cost=assessExecutionCost(fee,input.fields.capital,{maxAbsoluteFeeLamports:input.config.maxFeeLamports,maxFeeFractionOfCapital:input.config.maxFeeFraction}),risk=await governFreshOpenRisk({store:input.store,plan:input.plan,config:input.config,connection:input.connection,simulation,costApproved:cost.approved,fields:input.fields});
      if(risk.decision!=='APPROVE'||!risk.permitId||!risk.expiresAt)throw new Error(`LPFORGE_P6_CHUNK_SIMULATE_RISK:${risk.reasonCodes.join(',')}`);
      await input.store.insertExecutionRiskPermit({permitId:`${risk.permitId}:${step.transactionId}`,planId:input.plan.planId,decision:risk.decision,issuedAt:risk.issuedAt,expiresAt:risk.expiresAt,reasonCodes:risk.reasonCodes,payload:{autonomous:true,transactionId:step.transactionId,chunked:true,feeLamports:fee.totalFeeLamports.toString()}});
      const latest=await input.connection.getLatestBlockhash('confirmed');currentStep!.lastValidBlockHeight=BigInt(latest.lastValidBlockHeight);step.transaction.recentBlockhash=latest.blockhash;step.transaction.lastValidBlockHeight=latest.lastValidBlockHeight;step.transaction.feePayer=new PublicKey(input.plan.ownerAddress);const submittedAt=new Date().toISOString(),openTicket=ticket(input.plan as unknown as AutonomousPlan,input.fields.capital,submittedAt,input.config.riskPermitTtlMs),openAuthority={phase:'P6' as const,cluster:'mainnet-beta' as const,level:'MAINNET_CANARY_OPEN' as const,liveExecution:true,canaryOnly:true,issuedAt:submittedAt,expiresAt:openTicket.expiresAt,ticketId:openTicket.ticketId,reasonCodes:['P6_AUTONOMOUS_CHUNK_FINAL_REVALIDATION',step.kind]};
      await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'SIGNING',{action:'OPEN',transactionId:step.transactionId,positionAddress:input.prepared.positionSigner.publicKeyAddress,chunked:true,step:step.metadata});
      const economicChunk=step.kind==='METEORA_OPEN'||step.kind==='METEORA_OPEN_CHUNK';
      const [chunkNativeBefore,chunkWsolBefore]=economicChunk?await Promise.all([input.connection.getBalance(new PublicKey(input.plan.ownerAddress),'confirmed').then(value=>BigInt(value)),readWalletTokenBalance({connection:input.connection,ownerAddress:input.plan.ownerAddress,mint:WSOL_MINT})]):[0n,0n];
      await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:'SIGNING',lastValidBlockHeight:BigInt(latest.lastValidBlockHeight),observedAt:submittedAt,payload:{chunked:true}});
      const submitted=await executeMainnetCanaryOpen({authority:openAuthority,ticket:openTicket,transactionId:step.transactionId,idempotencyKey:`${input.plan.idempotencyKey}:${step.transactionId}`,requiredSignerAddresses:step.requiredSignerAddresses,backend:input.signer,auxiliaryBackends:auxiliaryPositionSignersForOpenStep(step,input.prepared.positionSigner),envelope:step.envelope,phase5RiskDecision:risk,lease:latest,ledger:ledger(input.store),transport:createWeb3SubmissionTransport(input.connection),submittedAt,beforeSubmit:async()=>{const finalSafety=await checkFreshOpenSubmissionSafety({store:input.store,plan:input.plan,permitExpiresAt:risk.expiresAt!});if(!finalSafety.approved)throw new Error("LPFORGE_P6_PRESUBMISSION_SAFETY_BLOCKED:"+finalSafety.reasonCodes.join(","));},onSigned:async({signerBackendId})=>{await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'SIGNED',{action:'OPEN',transactionId:step.transactionId,positionAddress:input.prepared.positionSigner.publicKeyAddress,chunked:true,step:step.metadata,signerBackendId});await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:'SIGNED',lastValidBlockHeight:BigInt(latest.lastValidBlockHeight),observedAt:new Date().toISOString(),payload:{chunked:true,signerBackendId}});},onSubmissionUnknown:async({error})=>{await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'UNKNOWN_SUBMISSION',{action:'OPEN',transactionId:step.transactionId,positionAddress:input.prepared.positionSigner.publicKeyAddress,chunked:true,step:step.metadata,error});await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:'UNKNOWN_SUBMISSION',lastValidBlockHeight:BigInt(latest.lastValidBlockHeight),observedAt:new Date().toISOString(),payload:{chunked:true,error}});}});submittedAny=true;currentStep!.signature=submitted.signature;currentStep!.submitted=true;lastSignature=submitted.signature;await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'SUBMITTED',{action:'OPEN',transactionId:step.transactionId,positionAddress:input.prepared.positionSigner.publicKeyAddress,chunked:true,step:step.metadata},submitted.signature);await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:'SUBMITTED',signature:submitted.signature,lastValidBlockHeight:BigInt(latest.lastValidBlockHeight),observedAt:new Date().toISOString(),payload:{chunked:true}});
      let confirmed=false;for(let attempt=0;attempt<input.config.confirmAttempts;attempt++){await new Promise(resolve=>setTimeout(resolve,input.config.confirmPollMs));const confirmation=await observeConfirmation({attemptId:`${step.transactionId}:attempt:1`,record:{transactionId:step.transactionId,signature:submitted.signature,submittedAt,blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight,attempt:1},transport:createWeb3SubmissionTransport(input.connection),ledger:ledger(input.store),observedAt:new Date().toISOString()});if(confirmation.status==='CONFIRMED'||confirmation.status==='FINALIZED'){confirmed=true;if(confirmation.slot!==undefined)confirmedEntrySlot=confirmation.slot;let economicSolAssetOut=0n;if(economicChunk){const [chunkNativeAfter,chunkWsolAfter]=await Promise.all([input.connection.getBalance(new PublicKey(input.plan.ownerAddress),'confirmed').then(value=>BigInt(value)),readWalletTokenBalance({connection:input.connection,ownerAddress:input.plan.ownerAddress,mint:WSOL_MINT})]);const totalBefore=chunkNativeBefore+chunkWsolBefore,totalAfter=chunkNativeAfter+chunkWsolAfter,actualFee=await confirmedTransactionFeeLamports(input.connection,submitted.signature)??fee.totalFeeLamports;economicSolAssetOut=totalBefore>totalAfter+actualFee?totalBefore-totalAfter-actualFee:0n;confirmedLiquiditySolAssetOut+=economicSolAssetOut;}await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:'CONFIRMED',signature:submitted.signature,lastValidBlockHeight:BigInt(latest.lastValidBlockHeight),observedAt:new Date().toISOString(),payload:{chunked:true,confirmation:confirmation.status,economicSolAssetOutLamports:economicSolAssetOut.toString()}});break;}if(confirmation.status==='FAILED'||confirmation.status==='EXPIRED'){await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:step.transactionId,sequence:stepIndex+1,kind:step.kind,disposition:'PROVEN_NOT_LANDED',signature:submitted.signature,lastValidBlockHeight:BigInt(latest.lastValidBlockHeight),observedAt:new Date().toISOString(),payload:{chunked:true,confirmation:confirmation.status}});throw new Error(`LPFORGE_P6_CHUNK_CONFIRM_${confirmation.status}`);}}if(!confirmed)throw new Error('LPFORGE_P6_CHUNK_CONFIRMATION_PENDING');completedSteps.push({transactionId:step.transactionId,signature:submitted.signature,estimatedFeeLamports:fee.totalFeeLamports});
    }
    const construction=assessOpenChunkConstruction({planned:input.prepared.steps.map((step,index)=>({transactionId:step.transactionId,sequence:index+1,kind:step.kind})),dispositions:await input.store.loadOpenChunkDispositions(input.plan.planId)});if(!construction.fullyConstructed)throw new Error(`LPFORGE_P6_OPEN_CONSTRUCTION_INCOMPLETE:${construction.reasonCodes.join(',')}`);
    await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'CONFIRMED',{action:'OPEN',positionAddress:input.prepared.positionSigner.publicKeyAddress,chunked:true,lastSignature},lastSignature);
    const position=await input.pool.getPosition?.(new PublicKey(input.prepared.positionSigner.publicKeyAddress));
    if(!position)throw new Error('LPFORGE_P6_POSITION_RECONCILIATION_MISSING');
    const intent=input.plan.planPayload.intent as Record<string,unknown>;
    const funding=input.plan.intentPayload.entryFunding as Record<string,unknown>;
    const planFundingLamports=(await input.store.loadPlanCashflows(input.plan.planId)).filter(flow=>flow.flowType==='ENTRY_FUNDING_SOL_OUT').reduce((total,flow)=>total+(flow.lamports??0n),0n);
    const actualEconomicCapitalLamports=planFundingLamports+confirmedLiquiditySolAssetOut;
    await input.store.insertExecutionReconciliation({reconciliationId:`${input.plan.planId}:open`,planId:input.plan.planId,observedAt:new Date().toISOString(),status:'MATCH',expected:{owner:input.plan.ownerAddress,pool:input.plan.poolAddress,lowerBinId:input.fields.lower,upperBinId:input.fields.upper},actual:{positionAddress:input.prepared.positionSigner.publicKeyAddress},discrepancies:[],payload:{signature:lastSignature,autonomous:true,chunked:true}});
    await input.store.upsertOwnedPosition({lpforgePositionId:`position-${input.prepared.positionSigner.publicKeyAddress}`,poolAddress:input.plan.poolAddress,positionAddress:input.prepared.positionSigner.publicKeyAddress,ownerAddress:input.plan.ownerAddress,strategy:String(intent.strategy??'SPOT'),orientation:String(funding.orientation??'ONE_SIDED_Y'),lowerBinId:input.fields.lower,upperBinId:input.fields.upper,activeBinAtEntry:input.fields.plannedActiveBinId,initialCapitalLamports:input.fields.capital,entryPlanId:input.plan.planId,entrySignature:lastSignature,...(confirmedEntrySlot!==undefined?{entrySlot:confirmedEntrySlot}:{}),enteredAt:new Date().toISOString(),lifecycleState:'OPEN',lastPlanId:input.plan.planId,reconciliationStatus:'MATCH',payload:{thesisId:input.plan.thesisId,entryFunding:funding,chunked:true,actualEconomicCapitalLamports:actualEconomicCapitalLamports.toString()}});
    const positionAccount=await input.connection.getAccountInfo(new PublicKey(input.prepared.positionSigner.publicKeyAddress),'confirmed');
    await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:open-contribution`,positionAddress:input.prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'OPEN_CONTRIBUTION',observedAt:new Date().toISOString(),lamports:actualEconomicCapitalLamports,payload:{signature:lastSignature,source:'RECONCILED_CHUNKABLE_OPEN',requestedLiquidityCapitalLamports:input.fields.capital.toString()}});
    if(positionAccount?.lamports)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:rent-lock`,positionAddress:input.prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'RENT_LOCK',observedAt:new Date().toISOString(),lamports:BigInt(positionAccount.lamports),payload:{signature:lastSignature,recoverable:true,source:'POSITION_ACCOUNT_INFO'}});
    for(const child of completedSteps){const actualFee=await confirmedTransactionFeeLamports(input.connection,child.signature);await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:tx-cost:${child.transactionId}`,positionAddress:input.prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'TX_COST',observedAt:new Date().toISOString(),lamports:actualFee??child.estimatedFeeLamports,payload:{signature:child.signature,transactionId:child.transactionId,source:actualFee===undefined?'EXECUTION_FEE_ESTIMATE':'CHAIN_RECEIPT_META',...(actualFee===undefined?{estimatedLamports:child.estimatedFeeLamports.toString()}:{})}});}
    await persistOpenResidualInventory({store:input.store,connection:input.connection,plan:input.plan,positionAddress:input.prepared.positionSigner.publicKeyAddress,funding:input.entryFundingMeasurement,signature:lastSignature});
    await input.store.completeAutonomousPlan({planId:input.plan.planId,state:'RECONCILED',at:new Date().toISOString(),payload:{signature:lastSignature,positionAddress:input.prepared.positionSigner.publicKeyAddress,chunked:true,actualEconomicCapitalLamports:actualEconomicCapitalLamports.toString()}});
    return{status:'RECONCILED',planId:input.plan.planId,reasonCodes:[],transactionSubmitted:true,positionAddress:input.prepared.positionSigner.publicKeyAddress};
  }catch(error){const reason=error instanceof Error?error.message:'LPFORGE_P6_CHUNKABLE_OPEN_UNKNOWN';if(currentStep&&!currentStep.submitted&&!reason.startsWith('LPFORGE_P6_PRESUBMISSION_SAFETY_BLOCKED:'))await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:currentStep.transactionId,sequence:currentStep.sequence,kind:currentStep.kind,disposition:'FAILED_PRE_SIGN',...(currentStep.lastValidBlockHeight!==undefined?{lastValidBlockHeight:currentStep.lastValidBlockHeight}:{}),observedAt:new Date().toISOString(),payload:{chunked:true,error:reason}});if(currentStep?.submitted&&currentStep.signature&&reason==='LPFORGE_P6_CHUNK_CONFIRMATION_PENDING')await input.store.upsertOpenChunkDisposition({planId:input.plan.planId,transactionId:currentStep.transactionId,sequence:currentStep.sequence,kind:currentStep.kind,disposition:'UNKNOWN_SUBMISSION',signature:currentStep.signature,...(currentStep.lastValidBlockHeight!==undefined?{lastValidBlockHeight:currentStep.lastValidBlockHeight}:{}),observedAt:new Date().toISOString(),payload:{chunked:true,error:reason}});if(submittedAny){if(input.entryFundingMeasurement){await input.store.upsertPartialEntryRecovery({planId:input.plan.planId,poolAddress:input.plan.poolAddress,ownerAddress:input.plan.ownerAddress,tokenMint:input.entryFundingMeasurement.tokenMint,fundingTransactionId:input.plan.swapTransactionId??'P6_CHUNKABLE_OPEN',fundingSignature:input.entryFundingMeasurement.fundingSignature,fundedAt:new Date().toISOString(),pairedTokenAmount:input.entryFundingMeasurement.pairedTokenReceivedRaw.toString(),intendedCapitalLamports:input.fields.capital,intendedRange:{lowerBinId:input.fields.lower,upperBinId:input.fields.upper},state:'RECONCILIATION_REQUIRED',walletTruth:{refreshRequired:true,confirmedLiquiditySolAssetOutLamports:confirmedLiquiditySolAssetOut.toString(),entryFundingMeasurement:{tokenMint:input.entryFundingMeasurement.tokenMint,pairedTokenReceivedRaw:input.entryFundingMeasurement.pairedTokenReceivedRaw.toString(),pairedTokenRawBeforeFunding:input.entryFundingMeasurement.pairedTokenRawBeforeFunding.toString(),pairedTokenRawBeforeOpen:input.entryFundingMeasurement.pairedTokenRawBeforeOpen.toString(),fundingSignature:input.entryFundingMeasurement.fundingSignature}},payload:{partialEntry:true,reasonCodes:['P6_PARTIAL_OPEN_CHUNK_DISPOSITION_REQUIRED',reason],positionAddress:input.prepared.positionSigner.publicKeyAddress},updatedAt:new Date().toISOString()});}await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'RECONCILIATION_REQUIRED',{action:'OPEN',chunked:true,error:reason,positionAddress:input.prepared.positionSigner.publicKeyAddress,lastSignature,postSubmission:true},lastSignature||undefined);await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:'RECONCILIATION_REQUIRED',at:new Date().toISOString(),reasonCodes:['P6_CHUNKABLE_OPEN_RECONCILIATION_REQUIRED',reason],payload:{stage:'CHUNKABLE_OPEN',error:reason,positionAddress:input.prepared.positionSigner.publicKeyAddress,lastSignature,partialEntry:true}});return{status:'UNKNOWN',planId:input.plan.planId,reasonCodes:['P6_CHUNKABLE_OPEN_RECONCILIATION_REQUIRED',reason],transactionSubmitted:true};}if(reason.startsWith('LPFORGE_P6_PRESUBMISSION_SAFETY_BLOCKED:'))await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'FAILED',{action:'OPEN',stage:'PRESUBMISSION_SAFETY',error:reason,chunked:true,positionAddress:input.prepared.positionSigner.publicKeyAddress});await input.store.completeAutonomousPlan({planId:input.plan.planId,state:'BLOCKED',at:new Date().toISOString(),payload:{stage:'CHUNKABLE_OPEN',error:reason}});return{status:'BLOCKED',planId:input.plan.planId,reasonCodes:[reason],transactionSubmitted:false};}
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
    const simAuthority = authority(
      "MAINNET_BUILD_SIMULATE",
      now,
      input.config.riskPermitTtlMs,
    );
    const simulation = await simulateExecutionTransaction({
      authority: simAuthority,
      transactionId: input.plan.transactionId,
      transaction: prepared.transaction,
      transport: createWeb3SimulationTransport(connection),
      simulatedAt: new Date().toISOString(),
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
        const finalSafety=await checkFreshOpenSubmissionSafety({store:input.store,plan:input.plan,permitExpiresAt:risk.expiresAt!});
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
      onSubmissionUnknown: async ({ error }) =>
        recordJournal(
          input.store,
          input.plan as unknown as AutonomousPlan,
          "UNKNOWN_SUBMISSION",
          {
            action: "OPEN",
            transactionId: input.plan.transactionId,
            generatedPositionAddress: openPositionAddress,
            error,
          },
        ),
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
        await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:open-contribution`,positionAddress:prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'OPEN_CONTRIBUTION',observedAt:new Date().toISOString(),lamports:fields.capital,payload:{signature:submitted.signature,source:'RECONCILED_OPEN'}});
        if(positionAccount?.lamports)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:rent-lock`,positionAddress:prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'RENT_LOCK',observedAt:new Date().toISOString(),lamports:BigInt(positionAccount.lamports),payload:{signature:submitted.signature,recoverable:true,source:'POSITION_ACCOUNT_INFO'}});
        const actualOpenFee=await confirmedTransactionFeeLamports(connection,submitted.signature);
        await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:tx-cost:${input.plan.transactionId}`,positionAddress:prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'TX_COST',observedAt:new Date().toISOString(),lamports:actualOpenFee??fee.totalFeeLamports,payload:{signature:submitted.signature,transactionId:input.plan.transactionId,source:actualOpenFee===undefined?'EXECUTION_FEE_ESTIMATE':'CHAIN_RECEIPT_META',...(actualOpenFee===undefined?{estimatedLamports:fee.totalFeeLamports.toString()}:{})}});
        await persistOpenResidualInventory({store:input.store,connection,plan:input.plan,positionAddress:prepared.positionSigner.publicKeyAddress,funding:entryFundingMeasurement,signature:submitted.signature});
        if (input.plan.swapTransactionId)
          await input.store.upsertPartialEntryRecovery({
            planId: input.plan.planId,
            poolAddress: input.plan.poolAddress,
            ownerAddress: input.plan.ownerAddress,
            tokenMint: entryFundingMeasurement?.tokenMint ?? String(funding.tokenMint ?? ""),
            fundingTransactionId: input.plan.swapTransactionId,
            fundingSignature: entryFundingMeasurement?.fundingSignature ?? "confirmed",
            fundedAt: new Date().toISOString(),
            pairedTokenAmount: entryFundingMeasurement?.pairedTokenReceivedRaw.toString() ?? String(funding.totalPairedTokenRaw ?? "0"),
            intendedCapitalLamports: fields.capital,
            intendedRange: {
              lowerBinId: fields.lower,
              upperBinId: fields.upper,
              strategy: intent.strategy,
            },
            state: "OPEN_RECOVERED",
            walletTruth: { refreshRequired: false },
            payload: {
              positionAddress: prepared.positionSigner.publicKeyAddress,
            },
            updatedAt: new Date().toISOString(),
          });
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
    if (submittedAny) {
      // One-shot opens get the same post-submit parity as the chunkable path:
      // never FAILED after a signature left the wallet, never resent blindly.
      await recordJournal(
        input.store,
        input.plan as unknown as AutonomousPlan,
        "RECONCILIATION_REQUIRED",
        {
          action: "OPEN",
          error: reason,
          positionAddress: openPositionAddress,
          lastSignature,
          postSubmission: true,
        },
        lastSignature || undefined,
      );
      await input.store.transitionAutonomousPlan({
        planId: input.plan.planId,
        state: "RECONCILIATION_REQUIRED",
        at: new Date().toISOString(),
        reasonCodes: ["P6_AUTONOMOUS_OPEN_RECONCILIATION_REQUIRED", reason],
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
        reasonCodes: ["P6_AUTONOMOUS_OPEN_RECONCILIATION_REQUIRED", reason],
        transactionSubmitted: true,
      };
    }
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

async function unwindPartialEntry(input: {
  store: Phase1Store;
  plan: AutonomousPlan;
  row: Record<string, unknown>;
  signer: MainnetSignerBackend;
  config: LiveWorkerConfig;
}): Promise<{ ok: boolean; submitted: boolean; reasonCodes: string[] }> {
  const amount = BigInt(String(input.row.paired_token_amount)),
    transactionId = `${input.plan.planId}:unwind`;
  return executeJupiterUnwindStep({
    store: input.store,
    plan: input.plan,
    signer: input.signer,
    config: input.config,
    amount,
    economicReferenceLamports: BigInt(String(input.row.intended_capital_lamports)),
    action: "CLOSE",
    transactionId,
    idempotencyKey: `${input.plan.idempotencyKey}:unwind`,
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
        },
        updatedAt: new Date().toISOString(),
      });
    },
  });
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
    if (plan?.action === "OPEN" && plan.state === "RECONCILED" && construction?.fullyConstructed) {
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
        state: "OPEN_RECOVERED",
        walletTruth: {
          ...(row.wallet_truth ?? {}),
          reconciledPlanId: plan.planId,
          reconciledPositionAddress: plan.positionAddress ?? null,
          refreshedAt: new Date().toISOString(),
        },
        payload: { reasonCodes: ["P6_PARTIAL_OPEN_RECONCILED_AFTER_RECOVERY"] },
        updatedAt: new Date().toISOString(),
      });
      results.push({ planId, action: "HOLD", reasonCodes: ["P6_PARTIAL_OPEN_RECONCILED_AFTER_RECOVERY"] });
      continue;
    }
    if(plan?.action==='OPEN'&&construction&&!construction.fullyConstructed){
      await input.store.upsertPartialEntryRecovery({planId,poolAddress:String(row.pool_address),ownerAddress:String(row.owner_address),tokenMint:String(row.token_mint),fundingTransactionId:String(row.funding_transaction_id),fundingSignature:String(row.funding_signature),fundedAt:new Date(String(row.funded_at)).toISOString(),pairedTokenAmount:String(row.paired_token_amount),intendedCapitalLamports:BigInt(String(row.intended_capital_lamports)),intendedRange:(row.intended_range??{}) as Record<string,unknown>,state:'RECONCILIATION_REQUIRED',walletTruth:{...(row.wallet_truth??{}),refreshRequired:true},payload:{partialEntry:true,reasonCodes:construction.reasonCodes},updatedAt:new Date().toISOString()});
      results.push({planId,action:'HOLD',reasonCodes:['P6_PARTIAL_ENTRY_REQUIRES_POSITION_RECOVERY',...construction.reasonCodes]});
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
    if (state !== "ENTRY_FUNDED_NOT_OPEN" && state !== "RESUME_OPEN") {
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
        payload: { reasonCodes: unwind.reasonCodes },
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
  let submissionAttempted=false;
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
      onSubmissionUnknown: async ({ error }: { error: string }) =>
        recordJournal(input.store,input.plan,"UNKNOWN_SUBMISSION",{action:input.action,transactionId,error}),
    };
    submissionAttempted=true;
    const submitted = open
      ? await executeMainnetCanaryClose(submitInput)
      : await executeMainnetCanaryManage(submitInput);
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
    if(submissionAttempted){
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
    lotId=input.lotId??`${input.plan.planId}:close-x:lot`;
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
  await input.store.settlePositionInventoryLot({
    eventId: ids.lotEventId,
    lotId,
    planId: input.plan.planId,
    eventType: "SETTLED",
    settledRawAmount: input.inputAmountRaw,
    observedAt,
    transactionSignature: input.signature,
    payload: {
      disposition: "JUPITER_UNWIND",
      transactionId: input.transactionId,
      settlementSignature: input.signature,
      proceedsCashflowId: ids.cashflowId,
      source: "CONFIRMED_TRANSACTION_ASSET_EFFECTS",
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
    tokenYBefore = closeSettlementAmount(dispatch.tokenYBefore);
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
    if (built.length !== 1)
      throw new Error("LPFORGE_P6_MULTI_TRANSACTION_REMOVE_UNSUPPORTED");
    built[0]!.metadata.transactionId = removeStep.transactionId;
    const removed = await executeMeteoraMutation({
      ...input,
      built: built[0]!,
      action: closeAction,
      deferCompletion: true,
      afterSubmit: async ({ signature }) => persist("CLOSE_INVENTORY_SNAPSHOTTED", {
        tokenXBefore: tokenXBefore!.toString(),
        tokenYBefore: tokenYBefore!.toString(),
        pendingStage: "CLOSE_REMOVE_SUBMITTED",
        pendingSignature: signature,
      }),
      afterConfirmed: async ({signature}) => {
        const native=await persistConfirmedCloseNativeWithdrawal({store:input.store,connection,plan:input.plan,positionAddress:input.positionAddress,signature,transactionId:removeStep.transactionId});
        if(!native.ok)throw new Error(native.reasonCodes.join(","));
      },
    });
    // No preceding child exists yet. A pre-send REMOVE rejection is a normal
    // block; only later phases must carry parent-level submitted truth.
    if (removed.status !== "RECONCILED") return removed;
    await persist("CLOSE_LIQUIDITY_REMOVED", {
      tokenXBefore: tokenXBefore.toString(),
      tokenYBefore: tokenYBefore.toString(),
      removeTransactionId: removeStep.transactionId,
    });
    stage = "CLOSE_LIQUIDITY_REMOVED";
  }

  if (stage === "CLOSE_LIQUIDITY_REMOVED") {
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
      if (claimBuilt.length !== 1)
        throw new Error("LPFORGE_P6_MULTI_TRANSACTION_CLAIM_UNSUPPORTED");
      const transactionId = `${closeStep.transactionId}:claim`;
      await input.store.ensureExecutionTransactionStep({
        planId: input.plan.planId,
        transactionId,
        kind: "METEORA_CLAIM",
        state: "PLANNED",
        requiredSignerAddresses: [input.plan.ownerAddress],
        metadata: {
          stage: "CLOSE_CLAIM_RESIDUAL",
          parentTransactionId: closeStep.transactionId,
        },
      });
      claimBuilt[0]!.metadata.transactionId = transactionId;
      const claimed = await executeMeteoraMutation({
        ...input,
        built: claimBuilt[0]!,
        action: closeAction,
        deferCompletion: true,
        afterSubmit: async ({ signature }) => persist("CLOSE_LIQUIDITY_REMOVED", {
          tokenXBefore: tokenXBefore!.toString(),
          tokenYBefore: tokenYBefore!.toString(),
          pendingStage: "CLOSE_CLAIM_SUBMITTED",
          pendingSignature: signature,
        }),
      });
      if (claimed.status !== "RECONCILED") return incomplete(claimed.reasonCodes, "CLOSE_CLAIM_PENDING");
    }
    await persist("CLOSE_CLAIMS_SETTLED", {
      tokenXBefore: tokenXBefore.toString(),
      tokenYBefore: tokenYBefore.toString(),
      claimTransactionSkipped: !claimBuilt,
    });
    stage = "CLOSE_CLAIMS_SETTLED";
  }

  let attributableTokenX = closeSettlementAmount(dispatch.attributableTokenX),attributableTokenY=closeSettlementAmount(dispatch.attributableTokenY);
  if (stage === "CLOSE_CLAIMS_SETTLED") {
    const [tokenXAfter,tokenYAfter]=await Promise.all([readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:poolFact.tokenXMint}),readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:poolFact.tokenYMint})]);
    attributableTokenX =
      tokenXAfter > tokenXBefore ? tokenXAfter - tokenXBefore : 0n;
    attributableTokenY=tokenYAfter>tokenYBefore?tokenYAfter-tokenYBefore:0n;
    // Token X is non-SOL inventory, not PnL.  Record an attributable lot
    // before the unwind so terminal settlement can require an exact
    // disposition transaction instead of inferring ownership from wallet
    // balance. Jupiter's later WSOL output is the only realized SOL receipt.
    if(attributableTokenX>0n){
      const cashflowId=`${input.plan.planId}:close-token-x`,at=new Date().toISOString();
      await input.store.insertPositionCashflow({cashflowId,positionAddress:input.positionAddress,planId:input.plan.planId,flowType:"CLOSE_WITHDRAWAL",observedAt:at,tokenMint:poolFact.tokenXMint,tokenAmountRaw:attributableTokenX.toString(),payload:{source:"REMOVE_PLUS_CLAIM_DELTA",nonSolInventory:true}});
      await recordPositionTokenXLot({store:input.store,connection,plan:input.plan,positionAddress:input.positionAddress,tokenMint:poolFact.tokenXMint,sourceEvent:"CLOSE_WITHDRAWAL",sourceCashflowId:cashflowId,rawAmount:attributableTokenX,observedAt:at,signature:"CLOSE_REMOVE_CONFIRMED"});
    }
    if(attributableTokenY>0n)
      await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:close-token-y`,positionAddress:input.positionAddress,planId:input.plan.planId,flowType:"CLOSE_WITHDRAWAL",observedAt:new Date().toISOString(),tokenMint:poolFact.tokenYMint,tokenAmountRaw:attributableTokenY.toString(),payload:{source:"REMOVE_PLUS_CLAIM_DELTA",tokenYBefore:tokenYBefore.toString(),tokenYAfter:tokenYAfter.toString()}});
    await persist("CLOSE_INVENTORY_MEASURED", {
      tokenXBefore: tokenXBefore.toString(),
      tokenYBefore: tokenYBefore.toString(),
      tokenXAfter: tokenXAfter.toString(),
      tokenYAfter:tokenYAfter.toString(),
      attributableTokenX: attributableTokenX.toString(),
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
    let swapProceedsLamports=0n;
    if (attributableTokenX > 0n) {
      const unwind = await executeJupiterUnwindStep({
        store: input.store,
        plan: input.plan,
        signer: input.signer,
        config: input.config,
        amount: attributableTokenX,
        economicReferenceLamports: mutationCapital(input.plan),
        action: closeAction,
        transactionId: unwindStep.transactionId,
        idempotencyKey: `${input.plan.idempotencyKey}:${unwindStep.transactionId}`,
        stage: "CLOSE_TOKEN_X_UNWIND",
        reasonPrefix: "P6_CLOSE_UNWIND",
        afterSubmit: async ({ signature }) => persist("CLOSE_INVENTORY_MEASURED", {
          tokenXBefore: tokenXBefore!.toString(),
          tokenYBefore: tokenYBefore!.toString(),
          attributableTokenX: attributableTokenX!.toString(),
          attributableTokenY:attributableTokenY?.toString()??"0",
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
        transactionId: unwindStep.transactionId,
        inputMint: poolFact.tokenXMint,
        inputAmountRaw: attributableTokenX,
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
      unwindTransactionId: unwindStep.transactionId,
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
          plan:input.plan,
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
  const closedBuilt = await buildClosePositionTransaction(input.pool, {
    userAddress: input.plan.ownerAddress,
    positionAddress: input.positionAddress,
  });
  closedBuilt.metadata.transactionId = closeStep.transactionId;
  const closed = await executeMeteoraMutation({
    ...input,
    built: closedBuilt,
    action: closeAction,
    afterSubmit: async ({ signature }) => persist("CLOSE_INVENTORY_UNWOUND", {
      tokenXBefore: tokenXBefore!.toString(),
      tokenYBefore: tokenYBefore!.toString(),
      attributableTokenX: attributableTokenX?.toString() ?? "0",
      attributableTokenY:attributableTokenY?.toString()??"0",
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
        transactionId:closeStep.transactionId,
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

/** A recovered close reaches the same durable settlement boundary as a normal close. */
async function finalizeClosedPositionSettlement(input:{store:Phase1Store;plan:AutonomousPlan;positionAddress:string;connection:Connection;config:Pick<LiveWorkerConfig,"rpcUrl">}):Promise<{ready:boolean;reasonCodes:string[]}>{
  const positionCheck=await input.connection.getAccountInfoAndContext(new PublicKey(input.positionAddress),"confirmed");
  if(positionCheck.value!==null)return{ready:false,reasonCodes:["SETTLEMENT_POSITION_STILL_EXISTS"]};
  const dispatch=closeSettlementDispatch(input.plan),closeSignature=typeof dispatch.signature==="string"?dispatch.signature:typeof dispatch.pendingSignature==="string"?dispatch.pendingSignature:undefined,closeTransactionId=typeof dispatch.transactionId==="string"?dispatch.transactionId:undefined;
  if(!closeSignature||!closeTransactionId)return{ready:false,reasonCodes:["SETTLEMENT_CLOSE_RECEIPT_MISSING"]};
  const rent=await persistConfirmedPositionRentRecovery({store:input.store,connection:input.connection,plan:input.plan,positionAddress:input.positionAddress,signature:closeSignature,transactionId:closeTransactionId,observedAt:new Date().toISOString()});
  if(!rent.ok)return{ready:false,reasonCodes:rent.reasonCodes};
  let settlementInput=await input.store.loadLifecycleSettlementInput(input.positionAddress);
  if(!settlementInput)return{ready:false,reasonCodes:["SETTLEMENT_LIFECYCLE_MISSING"]};
  const removeTransactionId=typeof dispatch.removeTransactionId==="string"?dispatch.removeTransactionId:undefined,removeSignature=removeTransactionId?settlementInput.transactions.find(transaction=>transaction.transactionId===removeTransactionId)?.signature:undefined;
  if(!removeTransactionId||!removeSignature)return{ready:false,reasonCodes:["SETTLEMENT_REMOVE_RECEIPT_MISSING"]};
  const native=await persistConfirmedCloseNativeWithdrawal({store:input.store,connection:input.connection,plan:input.plan,positionAddress:input.positionAddress,signature:removeSignature,transactionId:removeTransactionId,observedAt:new Date().toISOString()});
  if(!native.ok)return{ready:false,reasonCodes:native.reasonCodes};
  settlementInput=await input.store.loadLifecycleSettlementInput(input.positionAddress);
  if(!settlementInput)return{ready:false,reasonCodes:["SETTLEMENT_LIFECYCLE_MISSING"]};
  const at=new Date().toISOString(),positionCheckedAt=at,positionCheckedSlot=BigInt(positionCheck.context.slot),settlementEvidence={positionCheckedAt,positionCheckedSlot:positionCheckedSlot.toString(),rpcUrl:input.config.rpcUrl,commitment:"confirmed"};
  // A close is intentionally marked RECONCILIATION_REQUIRED until this
  // terminal boundary proves it can become SOL_SETTLED. Once the PositionV2
  // account is authoritatively absent, that marker is self-referential: its
  // own transaction ledger, inventory, cashflows, and reservations are still
  // assessed below and remain hard blockers, but the transitional marker must
  // not prevent the operation that clears it.
  const assessment=assessLifecycleSettlement({...settlementInput,reconciliationClean:true,positionAbsent:true,positionCheckedAt,positionCheckedSlot});
  if(!assessment.ready){
    await input.store.markOwnedPositionLifecycle({positionAddress:input.positionAddress,lifecycleState:"RECONCILIATION_REQUIRED",reconciliationStatus:"SETTLEMENT_BLOCKED",lastPlanId:input.plan.planId,at,payload:{stage:"SOL_SETTLEMENT_BLOCKED",reasonCodes:assessment.reasonCodes,lifecycleId:settlementInput.lifecycle.lifecycleId,settlementEvidence}});
    await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:"RECONCILIATION_REQUIRED",at,reasonCodes:assessment.reasonCodes,payload:{stage:"SOL_SETTLEMENT_BLOCKED",lifecycleId:settlementInput.lifecycle.lifecycleId}});
    return{ready:false,reasonCodes:assessment.reasonCodes};
  }
  const persisted=await input.store.persistLifecycleSolSettlement({assessment,input:{...settlementInput,positionAbsent:true,positionCheckedAt,positionCheckedSlot},...(process.env.LPFORGE_SOURCE_COMMIT?{sourceCommit:process.env.LPFORGE_SOURCE_COMMIT}:{}),...(process.env.LPFORGE_P7_POLICY_HASH?{policyHash:process.env.LPFORGE_P7_POLICY_HASH}:{}),migrationHead:"M0063_close_fee_attribution.sql",...(process.env.LPFORGE_BUILD_ID?{buildId:process.env.LPFORGE_BUILD_ID}:{}),at});
  const claimSignature=settlementInput.transactions.find(transaction=>transaction.transactionId.endsWith(':claim'))?.signature;
  await input.store.finalizeCloseFeeAttribution({closePlanId:input.plan.planId,positionAddress:input.positionAddress,removeSignature,...(claimSignature===undefined?{}:{claimSignature}),terminalSettlementId:persisted.settlementId,at});
  await input.store.compactPositionManagementDecisionAudit({positionAddress:input.positionAddress,at});
  // Existing research outcomes are immutable. A settlement supersession fixes
  // the accounting authority without mutating or duplicating V3 evidence.
  if(!persisted.superseded){
    const outcome=await input.store.createLiveSolSettledLearningOutcome({positionAddress:input.positionAddress,at});
    if(!outcome.outcome)throw new Error(`LPFORGE_LIVE_OUTCOME_MATERIALIZATION_FAILED:${outcome.reasonCodes.join(',')}`);
  }
  return{ready:true,reasonCodes:[]};
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
  )
    return executeCloseSettlement({ ...input, pool, positionAddress });
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
/** Startup/periodic recovery is deliberately non-resubmitting until chain truth is reconciled. */
export async function recoverUnfinishedAutonomousPlans(input: {
  store: Phase1Store;
  currentBlockHeight: number;
  now: string;
  rpcUrl?: string;
  programId?: string;
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
    const journal = {
      journalId: String(raw.journal_id),
      idempotencyKey: String(raw.idempotency_key),
      planId: String(raw.plan_id),
      ...(raw.transaction_id
        ? { transactionId: String(raw.transaction_id) }
        : {}),
      state: String(raw.state) as ExecutionJournal["state"],
      ...(raw.signature ? { signature: String(raw.signature) } : {}),
      ...(raw.blockhash ? { blockhash: String(raw.blockhash) } : {}),
      ...(raw.last_valid_block_height !== null &&
      raw.last_valid_block_height !== undefined
        ? { lastValidBlockHeight: Number(raw.last_valid_block_height) }
        : {}),
      version: Number(raw.version),
      updatedAt: new Date(String(raw.updated_at)).toISOString(),
      payload: (raw.payload ?? {}) as Record<string, unknown>,
    };
    // Jupiter unwind is a separate durable transaction step. Its parent-close
    // marker is written before confirmation, so recovery must query that exact
    // child signature rather than whichever earlier mutation last updated the
    // plan journal.
    const pendingSignature = closeSettlementPending(plan)?.signature;
    const recoverySignature = pendingSignature ?? journal.signature;
    // A journal records the signature boundary; the durable submission row is
    // the authoritative fallback for its blockhash lifetime.  This lets a
    // crash between send and journal metadata persistence recover the exact
    // child without ever retransmitting it.
    let recoveryLastValidBlockHeight = journal.lastValidBlockHeight;
    if (
      recoveryLastValidBlockHeight === undefined &&
      recoverySignature &&
      typeof (input.store as unknown as { loadSubmissionAttemptBySignature?: unknown }).loadSubmissionAttemptBySignature === "function"
    ) {
      const attempt = await input.store.loadSubmissionAttemptBySignature(recoverySignature);
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
    let signatureStatusReadUnknown = false;
    if (recoverySignature && (connection || input.signatureStatusProvider)) {
      let status:
        | { err: unknown; confirmationStatus?: string | null }
        | null
        | undefined;
      try {
        status = input.signatureStatusProvider
          ? await input.signatureStatusProvider(recoverySignature)
          : (
              await connection!.getSignatureStatus(recoverySignature, {
                searchTransactionHistory: true,
              })
            ).value;
      } catch {
        signatureStatusReadUnknown = true;
      }
      if (status?.err) confirmationStatus = "FAILED";
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
      const unwindStep = plan.steps.find((step) => step.kind === "JUPITER_UNWIND"),
        dispatch = closeSettlementDispatch(plan),
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
      await input.store.updateExecutionJournal({
        idempotencyKey:plan.idempotencyKey,
        expectedVersion:journal.version,
        state:"CONFIRMED",
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
          await input.store.markSubmissionExpired(
            closePending.signature,
            input.now,
            "P6_CLOSE_RECOVERED_OPEN_RESIDUAL_EXPIRED_NO_CHAIN_EFFECT",
          );
          await input.store.updateExecutionJournal({
            idempotencyKey: plan.idempotencyKey,
            expectedVersion: journal.version,
            // The parent journal tracks the last confirmed close child. The
            // expired residual attempt is terminal only in its own submission
            // ledger; preserving CONFIRMED permits a fresh follow-up child.
            state: "CONFIRMED",
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
          const reason = "P6_CLOSE_PENDING_STAGE_EXPIRED_NO_CHAIN_EFFECT_POSITION_ABSENT";
          await input.store.markSubmissionExpired(closePending.signature, input.now, reason);
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
          const reason = "P6_CLOSE_PENDING_STAGE_EXPIRED_NO_CHAIN_EFFECT";
          await input.store.markSubmissionExpired(closePending.signature, input.now, reason);
          await input.store.updateExecutionJournal({
            idempotencyKey: plan.idempotencyKey,
            expectedVersion: journal.version,
            state: "FAILED",
            updatedAt: input.now,
            payload: {
              ...journal.payload,
              recovery: "CLOSE_PENDING_STAGE_EXPIRED",
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
              recovery: "CLOSE_PENDING_STAGE_EXPIRED_NO_CHAIN_EFFECT",
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
          lotId = recovered && typeof dispatch.recoveredOpenResidualLotId === "string" ? dispatch.recoveredOpenResidualLotId : undefined;
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
          ...(lotId?{lotId,settlementIdSuffix:"recovered-open-residual"}:{}),
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
      const completedStage: Record<Exclude<CloseSettlementPendingStage, "CLOSE_UNWIND_SUBMITTED"|"CLOSE_OPEN_RESIDUAL_UNWIND_SUBMITTED">, CloseSettlementStage | undefined> = {
        CLOSE_REMOVE_SUBMITTED: "CLOSE_LIQUIDITY_REMOVED",
        CLOSE_CLAIM_SUBMITTED: "CLOSE_CLAIMS_SETTLED",
        CLOSE_POSITION_SUBMITTED: undefined,
      };
      const next = completedStage[closePending.stage];
      if (next) {
        await input.store.transitionAutonomousPlan({
          planId: plan.planId,
          state: "RECONCILING",
          at: input.now,
          reasonCodes: ["P6_CLOSE_PENDING_STAGE_CONFIRMED", closePending.stage],
          payload: { stage: next, pendingStage: null, pendingSignature: null },
        });
        results.push({ planId: plan.planId, action: "RESUME_CLOSE_SETTLEMENT", reasonCodes: ["P6_CLOSE_PENDING_STAGE_CONFIRMED", next] });
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
        const settlement=await finalizeClosedPositionSettlement({store:input.store,plan,positionAddress:recoveryPositionAddress,connection,config:{rpcUrl:input.rpcUrl}});
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
      const settlement=await finalizeClosedPositionSettlement({store:input.store,plan,positionAddress:candidate.positionAddress,connection,config:{rpcUrl:input.rpcUrl}});
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
      enteredAt: typeof journal?.updated_at === "string" ? journal.updated_at : at,
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
