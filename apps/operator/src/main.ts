import { loadPhase1Config } from "../../../packages/config/src/index.js";
import { createMeteoraDataApi, type DataApiPool } from "../../../packages/data-api/src/index.js";
import {
  createPostgresStore,
  type Phase1Store,
} from "../../../packages/db/src/index.js";
import {
  createMeteoraReadAdapter,
  createGovernedConnection,
  createSolanaRpcClient,
  scanAddressTransactions,
} from "../../../packages/meteora/src/index.js";
import { Logger } from "../../../packages/observability/src/index.js";
import {
  evaluateOperationalCycle,
  decisionTimeEconomicEvidenceAgeSeconds,
  PHASE3_RECENT_LIVE_OBSERVATION_WINDOW_MS,
  summarizePhase3RecentLiveObservations,
  type OperationalCycleResult,
} from "../../../packages/operational-runtime/src/index.js";
import {
  createJupiterSwapQuoteProvider,
  loadAutonomousEntryPolicy,
} from "../../../packages/phase6-swap-quote/src/index.js";
import { buildTransactionPlan } from "../../../packages/transaction-planner/src/index.js";
import { computePlanProvenanceHmac } from "../../../packages/execution-contracts/src/index.js";
import type { TransactionPlan } from "../../../packages/execution-contracts/src/index.js";
import {
  assessLiveManagementContext,
  decideLivePositionManagement,
  loadLivePositionManagementPolicy,
  type OwnedLivePosition,
} from "../../../packages/live-position-management/src/index.js";
import {
  assessLiveExit,
  derivePositionEconomics,
  loadLiveExitGovernorPolicy,
  type ExitHighWaterState,
} from "../../../packages/live-exit-governor/src/index.js";
import {
  fixtureBins,
  fixtureDataApiPool,
  fixturePool,
  fixtureSwaps,
} from "../../../packages/test-fixtures/src/index.js";
import { CONTROLLED_CANARY_LIQUIDITY_CAPITAL_LAMPORTS, loadDeploymentPolicyFile } from "../../../packages/deployment-policy/src/index.js";
import { assessProductionOpenPlanCapacity } from "../../../packages/production-entry-capacity/src/index.js";
import { assessPostEntryAuthority } from "../../../packages/phase7-post-entry-authority/src/index.js";
import { refreshCanonicalHistoricalBackfill, refreshCurrentPhase3Evidence } from "../../../packages/active-candidate-evidence/src/index.js";
import { derivePhase3EvidenceWidthRequirement } from "../../../packages/rangeforge/src/index.js";
import { PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { freezePhase3ForwardDecision, phase3ForwardDecisionStoreValue, evaluateUserSelectedCapitalOpportunity, buildCapitalContract, buildPositionContract, buildCapitalEvaluationIdentity, buildReset3cValidationSharedEvidenceReference, compactReset3cDecisionRelevantRawContract, selectReset3cDecisionRelevantCandidates, RESET3C_STORAGE_CONTRACT_V3, RESET3C_VALIDATION_SAMPLING_CONTRACT_V1, type RuntimeArtifactProvenance } from "../../../packages/phase3-forward-validation/src/index.js";
import { canonicalJson, sha256Hex } from "../../../packages/domain/src/index.js";
import type { Phase3QualificationPolicyId } from "../../../packages/opportunity/src/index.js";

function json(v: unknown) {
  return JSON.stringify(
    v,
    (_, x) => (typeof x === "bigint" ? x.toString() : x),
    2,
  );
}
const lamportsToSol = (value: bigint) => Number(value) / 1_000_000_000;
function candidateUniverseRetentionHours():number{
 const value=Number(process.env.LPFORGE_CANDIDATE_UNIVERSE_RETENTION_HOURS??168);
 return Number.isFinite(value)?Math.max(24,Math.min(336,Math.floor(value))):168;
}
function phase3QualificationPolicyFromEnvironment():Phase3QualificationPolicyId{
  const value=process.env.LPFORGE_PHASE3_QUALIFICATION_POLICY??'candidate-primary-risk-adjusted-v1';
  if(value==='global-primary-v1'||value==='candidate-primary-risk-adjusted-v1')return value;
  throw new Error(`LPFORGE_PHASE3_QUALIFICATION_POLICY_INVALID:${value}`);
}
function verifiedForwardArtifactProvenance():RuntimeArtifactProvenance{
  const manifest=JSON.parse(readFileSync('RELEASE_MANIFEST.json','utf8')) as {sourceCommit?:unknown;buildIdentity?:unknown;policyHash?:unknown;migrationHead?:unknown};
  const sourceRevision=readFileSync('SOURCE_REVISION.txt','utf8').trim().replace(/^source_git_commit=/,'');
  const sourceSha=typeof manifest.sourceCommit==='string'?manifest.sourceCommit.trim():'';
  const buildId=typeof manifest.buildIdentity==='string'?manifest.buildIdentity.trim():'';
  const policyHash=typeof manifest.policyHash==='string'?manifest.policyHash.trim():'';
  const migrationHead=typeof manifest.migrationHead==='string'?manifest.migrationHead.trim():'';
  if(sourceRevision!==sourceSha||!/^[0-9a-f]{40}$/i.test(sourceSha)||!/^[0-9a-f]{64}$/i.test(buildId)||!/^[0-9a-f]{64}$/i.test(policyHash)||!/^M\d{4}_.+\.sql$/.test(migrationHead))throw new Error('LPFORGE_FORWARD_ARTIFACT_IDENTITY_INVALID');
  if(process.env.LPFORGE_SOURCE_COMMIT&&process.env.LPFORGE_SOURCE_COMMIT!==sourceSha)throw new Error('LPFORGE_FORWARD_ARTIFACT_SOURCE_ASSERTION_MISMATCH');
  if(process.env.LPFORGE_BUILD_ID&&process.env.LPFORGE_BUILD_ID!==buildId)throw new Error('LPFORGE_FORWARD_ARTIFACT_BUILD_ASSERTION_MISMATCH');
  return{sourceSha,buildId,policyHash,migrationHead};
}
const WSOL_MINT="So11111111111111111111111111111111111111112";
function claimValueLamports(input:{feeX?:string|undefined;feeY?:string|undefined;pool:DataApiPool}):bigint|undefined{
  const tokens=[input.pool.token_x,input.pool.token_y],sol=tokens.find(token=>token?.address===WSOL_MINT);
  if(!sol||typeof sol.price!=="number"||!Number.isFinite(sol.price)||sol.price<=0)return undefined;
  const value=(raw:string|undefined,token:typeof input.pool.token_x)=>{
    let amount:bigint;try{amount=BigInt(raw??"0");}catch{return undefined;}
    if(amount===0n)return 0n;
    if(token?.address===WSOL_MINT)return amount;
    const decimals=token?.decimals,price=token?.price,solPrice=sol.price;
    if(!token||!Number.isInteger(decimals)||decimals===undefined||decimals<0||typeof price!=="number"||!Number.isFinite(price)||price<=0||solPrice===undefined)return undefined;
    const solLamports=Number(amount)/10**decimals*price/solPrice*1e9;
    return Number.isFinite(solLamports)&&solLamports>=0&&solLamports<=Number.MAX_SAFE_INTEGER?BigInt(Math.floor(solLamports)):undefined;
  };
  const x=value(input.feeX,input.pool.token_x),y=value(input.feeY,input.pool.token_y);
  return x===undefined||y===undefined?undefined:x+y;
}
async function loadPositionContinuationEconomics(position:OwnedLivePosition,fact:NonNullable<Awaited<ReturnType<ReturnType<typeof createMeteoraReadAdapter>["getPositionV2"]>>>,current:OperationalCycleResult|undefined,economics:{evidenceState:string;currentEconomicValueUsd?:number;contributedCapitalUsd?:number}){const universe=current?.shadow?.candidateUniverseEvidence;if(!universe||position.lowerBinId!==fact.lowerBinId||position.upperBinId!==fact.upperBinId)return undefined;const candidate=universe.candidates.find(candidate=>candidate.strategy===position.strategy&&candidate.orientation===position.orientation&&candidate.lowerBinId===position.lowerBinId&&candidate.upperBinId===position.upperBinId),simulation=candidate?universe.simulations.find(row=>row.candidateId===candidate.id):undefined;if(!candidate||!simulation||!simulation.evidenceActionable||economics.evidenceState!=="AVAILABLE"||!(typeof economics.currentEconomicValueUsd==="number")||!(typeof economics.contributedCapitalUsd==="number")||!(economics.contributedCapitalUsd>0))return undefined;const ev=(simulation.feeValue+simulation.inventoryChangeValue)*(economics.currentEconomicValueUsd/economics.contributedCapitalUsd);if(!Number.isFinite(ev))return undefined;return{candidateId:candidate.id,geometryIdentity:`${position.positionAddress}:${position.strategy}:${position.orientation}:${position.lowerBinId}:${position.upperBinId}`,continuationEvLamports:BigInt(Math.trunc(ev*1_000_000_000)),forecastHorizonMinutes:current.shadow?.forwardValidation.horizonMinutes??60,uncertainty:current.shadow?.qualification.uncertainty};}
async function estimateExpectedCloseCostLamports(fact:NonNullable<Awaited<ReturnType<ReturnType<typeof createMeteoraReadAdapter>["getPositionV2"]>>>,pool:DataApiPool,quoteProvider:{quote(request:{inputMint:string;outputMint:string;inputAmount:bigint;requiredOutputAmount:bigint}):Promise<{status:string;quote?:{outAmount:bigint}}> }|undefined):Promise<bigint|undefined>{const sol=pool.token_x?.address===WSOL_MINT?pool.token_x:pool.token_y?.address===WSOL_MINT?pool.token_y:undefined;if(!sol||typeof sol.price!=="number"||!Number.isFinite(sol.price)||sol.price<=0)return undefined;let result=20_000n;for(const [token,raw] of [[pool.token_x,BigInt(fact.totalXAmount??"0")+BigInt(fact.feeX??"0")],[pool.token_y,BigInt(fact.totalYAmount??"0")+BigInt(fact.feeY??"0")]] as const){if(!token||token.address===WSOL_MINT||raw<=0n)continue;if(!quoteProvider||!Number.isInteger(token.decimals)||typeof token.price!=="number"||!Number.isFinite(token.price)||token.price<0)return undefined;const quote=await quoteProvider.quote({inputMint:token.address,outputMint:WSOL_MINT,inputAmount:raw,requiredOutputAmount:1n});if(quote.status!=="APPROVED"||!quote.quote)return undefined;const marked=BigInt(Math.max(0,Math.floor(Number(raw)/10**token.decimals!*token.price/sol.price*1_000_000_000)));result+=marked>quote.quote.outAmount?marked-quote.quote.outAmount:0n;}return result;}
function loadProductionCapitalEnvelope(poolAddress: string) {
  const deployment = loadDeploymentPolicyFile(
    process.env.LPFORGE_EXECUTION_POLICY_PATH ?? "policies/live-execution-policy.json",
  );
  if (deployment.status !== "ENABLED" || !deployment.productionCapital)
    throw new Error("LPFORGE_PRODUCTION_CAPITAL_POLICY_REQUIRED");
  const pool = deployment.pools.find((x) => x.address === poolAddress);
  const admission = deployment.productionAdmission?.enabled
    ? deployment.productionAdmission
    : undefined;
  const maxPoolLamports = pool?.maxCapitalLamports ?? admission?.maxCapitalLamports;
  if (!maxPoolLamports)
    throw new Error("LPFORGE_PRODUCTION_CAPITAL_POOL_LIMIT_REQUIRED");
  const capital = deployment.productionCapital;
  const construction = deployment.positionConstruction;
  return {
    productionCapitalPolicy: {
      id: `${deployment.policyId}:production-capital-v1`,
      reserveCapital: lamportsToSol(capital.reserveLamports),
      maxPortfolioCapital: lamportsToSol(capital.maxPortfolioLamports),
      maxTokenCapital: lamportsToSol(capital.maxTokenLamports),
      targetInitialPosition: lamportsToSol(capital.targetInitialPositionLamports),
      maxInitialPosition: lamportsToSol(capital.maxInitialPositionLamports),
      minInitialPosition: lamportsToSol(capital.minInitialPositionLamports),
    },
    productionPoolCapital: lamportsToSol(maxPoolLamports),
    ...(construction ? { maxRangeWidthBins: construction.maxInitialPositionWidthBins } : {}),
  };
}
async function loadLiveOpenPlanCapacity(input: {
  store: Phase1Store;
  rpcUrl: string;
  ownerAddress?: string | undefined;
}) {
  if (!input.ownerAddress)
    return {
      approved: false,
      walletLamports: 0n,
      availableWalletLamports: 0n,
      reasonCodes: ["P7_PLAN_OWNER_ADDRESS_MISSING"],
    };
  const deployment = loadDeploymentPolicyFile(
    process.env.LPFORGE_EXECUTION_POLICY_PATH ??
      "policies/live-execution-policy.json",
  );
  const capital = deployment.productionCapital;
  if (!capital)
    return {
      approved: false,
      walletLamports: 0n,
      availableWalletLamports: 0n,
      reasonCodes: ["P7_PLAN_CAPITAL_POLICY_MISSING"],
    };
  const [facts, priorRisk] = await Promise.all([
    input.store.loadPhase7PortfolioFacts(input.ownerAddress),
    input.store.loadPhase7PortfolioRiskState(input.ownerAddress),
  ]);
  const priorObservedAt = priorRisk
    ? Date.parse(String(priorRisk.observed_at))
    : Number.NaN;
  const priorWallet = (priorRisk?.payload as Record<string, unknown> | undefined)
    ?.walletLamports;
  const currentEnough =
    Number.isFinite(priorObservedAt) &&
    Date.now() - priorObservedAt <= 60_000 &&
    typeof priorWallet === "string" &&
    /^\d+$/.test(priorWallet);
  const walletLamports = currentEnough
    ? BigInt(priorWallet)
    : BigInt(
        await createGovernedConnection({rpcUrl:input.rpcUrl,priority:'P2_POSITION_MANAGEMENT'}).getBalance(
          new PublicKey(input.ownerAddress),
          "confirmed",
        ),
      );
  const capacity = assessProductionOpenPlanCapacity({
    walletLamports,
    reserveLamports: capital.reserveLamports,
    minInitialPositionLamports: capital.minInitialPositionLamports,
    maxPortfolioLamports: capital.maxPortfolioLamports,
    // Discovery admission is an additional production constraint, not merely
    // a screening hint.  A discovered candidate therefore uses the stricter
    // of the global and discovery-admission position limits.
    maxOpenPositions: Math.min(
      deployment.maxOpenPositions,
      deployment.productionAdmission?.enabled
        ? deployment.productionAdmission.maxOpenPositions
        : deployment.maxOpenPositions,
    ),
    openPositions: facts.openPositions,
    deployedLamports: facts.deployedLamports,
    pendingReservedLamports: facts.pendingReservedLamports,
  });
  return { ...capacity, walletLamports };
}
async function persistTransactionPlan(
  store: Phase1Store,
  plan: TransactionPlan,
) {
  const deployment=loadDeploymentPolicyFile(process.env.LPFORGE_EXECUTION_POLICY_PATH??"policies/live-execution-policy.json");
  // The controlled-canary probe remains read-only; its plan-only marker still
  // enforces the exact capital and no-replacement envelope before signing.
  if((process.env.LPFORGE_MAINNET_CANARY==='true'||process.env.LPFORGE_CONTROLLED_CANARY_PLAN==='true')&&deployment.controlledCanary){
    if(plan.intent.action==='OPEN'&&plan.intent.capitalLamports!==CONTROLLED_CANARY_LIQUIDITY_CAPITAL_LAMPORTS)
      throw new Error('LPFORGE_P6_CONTROLLED_CANARY_EXACT_CAPITAL_REQUIRED');
    if(['ADD','RESHAPE','REBALANCE'].includes(plan.intent.action))
      throw new Error('LPFORGE_P6_CONTROLLED_CANARY_REPLACEMENT_OPEN_BLOCKED');
  }
  const provenanceSecret=(process.env.LPFORGE_PLAN_PROVENANCE_SECRET??'').trim();
  const phase7RuntimeId=(process.env.LPFORGE_P7_RUNTIME_ID??'lpforge-production').trim(),control=await store.loadLatestPhase7ControlDecision(phase7RuntimeId),phase7Control=control?{decisionId:String(control.decision_id),cycleKey:String(control.cycle_key),observedAt:new Date(String(control.observed_at)).toISOString()}:undefined;
  const controlledCanaryPlan=(process.env.LPFORGE_MAINNET_CANARY==='true'||process.env.LPFORGE_CONTROLLED_CANARY_PLAN==='true')&&plan.intent.action==='OPEN'&&Boolean(deployment.controlledCanary);
  const controlledCanaryAuthorization=controlledCanaryPlan&&phase7Control?{
    schemaVersion:1,
    approvalId:(process.env.LPFORGE_P7_APPROVAL_ID??'').trim(),
    action:(process.env.LPFORGE_P7_APPROVAL_ACTION??'').trim(),
    operatorId:(process.env.LPFORGE_P7_APPROVED_BY??'').trim(),
    issuedAt:(process.env.LPFORGE_P7_APPROVAL_ISSUED_AT??'').trim(),
    expiresAt:(process.env.LPFORGE_P7_APPROVAL_EXPIRES_AT??'').trim(),
    boundControlDecisionId:phase7Control.decisionId,
    planId:plan.planId,
    wallet:plan.intent.ownerAddress,
    pool:plan.intent.poolAddress,
    candidateId:plan.intent.candidateId??null,
    thesisId:plan.intent.thesisId,
    intentId:plan.intent.intentId,
    capitalLamports:plan.intent.capitalLamports?.toString()??'',
    maxConcurrentPositions:1,
  }:undefined;
  // `candidateId` is intentionally persisted as JSON null for a protective
  // lifecycle plan that has no entry candidate.  Bind the exact persisted
  // representation here; otherwise a source `undefined` is omitted from the
  // HMAC material and fails closed when the plan is read back from JSONB.
  const immutablePlan={intentPayload:plan.intent.payload,planIntent:Object.fromEntries(Object.entries({capitalLamports:plan.intent.capitalLamports?.toString(),candidateId:plan.intent.candidateId??null,lowerBinId:plan.intent.lowerBinId,upperBinId:plan.intent.upperBinId,activeBinId:plan.intent.activeBinId,binStep:plan.intent.binStep,strategy:plan.intent.strategy,maxPositionWidthBins:plan.transactions.find((step)=>step.kind==='METEORA_OPEN'||step.kind==='METEORA_POSITION_EXTEND')?.metadata.maxPositionWidthBins}).filter(([,value])=>value!==undefined)),steps:plan.transactions.map(step=>({transactionId:step.transactionId,sequence:step.sequence,kind:step.kind,requiredSignerAddresses:[...step.requiredSignerAddresses],metadata:step.metadata}))};
  await store.insertExecutionIntent({
    intentId: plan.intent.intentId,
    idempotencyKey: plan.intent.idempotencyKey,
    action: plan.intent.action,
    poolAddress: plan.intent.poolAddress,
    ownerAddress: plan.intent.ownerAddress,
    ...(plan.intent.positionAddress
      ? { positionAddress: plan.intent.positionAddress }
      : {}),
    thesisId: plan.intent.thesisId,
    observedAt: plan.intent.observedAt,
    expiresAt: plan.intent.expiresAt,
    payload: plan.intent.payload,
  });
  await store.insertTransactionPlan({
    planId: plan.planId,
    intentId: plan.intent.intentId,
    cluster: plan.cluster,
    state: plan.state,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    payload: {
      reasonCodes: plan.reasonCodes,
      authority: "AUTONOMOUS_DISPATCH",
      provenance: {
        producer: "LPFORGE_PRODUCTION",
        schemaVersion: 1,
        intentId: plan.intent.intentId,
        poolAddress: plan.intent.poolAddress,
        observedAt: plan.intent.observedAt,
        ...(phase7Control?{phase7Control}:{}),
        ...(controlledCanaryAuthorization?{controlledCanaryAuthorization}:{}),
        // Stamped only when the provenance secret is configured; the claim
        // guard verifies it fail-closed from that moment on.
        ...(provenanceSecret
          ? {
              hmac: computePlanProvenanceHmac(
                {
                  producer: "LPFORGE_PRODUCTION",
                  schemaVersion: 1,
                  intentId: plan.intent.intentId,
                  poolAddress: plan.intent.poolAddress,
                  observedAt: plan.intent.observedAt,
                  action: plan.intent.action,
                  ownerAddress: plan.intent.ownerAddress,
                  positionAddress: plan.intent.positionAddress ?? null,
                  expiresAt: plan.expiresAt,
                  immutablePlan,
                  // The claim guard normalizes an omitted binding to an empty
                  // record.  Use that same persisted representation so a
                  // non-entry protective plan remains verifiable after JSONB
                  // read-back.
                  phase7Control: phase7Control ?? {},
                  ...(controlledCanaryAuthorization?{controlledCanaryAuthorization}:{}),
                },
                provenanceSecret,
              ),
            }
          : {}),
      },
      intent: {
        capitalLamports: plan.intent.capitalLamports?.toString(),
        candidateId: plan.intent.candidateId ?? null,
        lowerBinId: plan.intent.lowerBinId,
        upperBinId: plan.intent.upperBinId,
        activeBinId: plan.intent.activeBinId,
        binStep: plan.intent.binStep,
        strategy: plan.intent.strategy,
        maxPositionWidthBins: plan.transactions.find((step) => step.kind === "METEORA_OPEN" || step.kind === "METEORA_POSITION_EXTEND")?.metadata.maxPositionWidthBins,
      },
      immutablePlanVersion:1,
    },
    steps: plan.transactions.map((t) => ({
      transactionId: t.transactionId,
      sequence: t.sequence,
      kind: t.kind,
      state: t.state,
      requiredSignerAddresses: t.requiredSignerAddresses,
      metadata: t.metadata,
    })),
  });
}
function owned(row: Record<string, unknown>): OwnedLivePosition {
  const payload=(row.payload as Record<string, unknown>) ?? {};
  let actualEconomicCapitalLamports:bigint|undefined;
  try { if (payload.actualEconomicCapitalLamports!==undefined) actualEconomicCapitalLamports=BigInt(String(payload.actualEconomicCapitalLamports)); } catch {}
  return {
    lpforgePositionId: String(row.lpforge_position_id),
    poolAddress: String(row.pool_address),
    positionAddress: String(row.position_address),
    ownerAddress: String(row.owner_address),
    strategy: String(row.strategy) as OwnedLivePosition["strategy"],
    orientation: String(row.orientation),
    lowerBinId: Number(row.lower_bin_id),
    upperBinId: Number(row.upper_bin_id),
    initialCapitalLamports: BigInt(String(row.initial_capital_lamports)),
    ...(actualEconomicCapitalLamports!==undefined?{actualEconomicCapitalLamports}:{}),
    partialEntry: payload.partialEntry === true,
    thesisId: String(
      payload.thesisId ??
        `owned-${row.position_address}`,
    ),
    enteredAt: String(row.entered_at ?? ''),
  };
}
async function observeAndPlanOwnedPositions(input: {
  store: Phase1Store;
  adapter: ReturnType<typeof createMeteoraReadAdapter>;
  api: ReturnType<typeof createMeteoraDataApi>;
  ownerAddress?: string | undefined;
  observedAt: string;
  currentResult?: OperationalCycleResult;
  allowRiskIncreasingPlans: boolean;
  allowProtectiveManagementPlans: boolean;
  swapQuoteProvider?: { quote(request:{inputMint:string;outputMint:string;inputAmount:bigint;requiredOutputAmount:bigint}):Promise<{status:string;quote?:{outAmount:bigint}}> };
}) {
  if (!input.ownerAddress) return { observed: 0, planned: 0 };
  const policy = loadLivePositionManagementPolicy(
      process.env.LPFORGE_LIVE_MANAGEMENT_POLICY_PATH ??
        "policies/live-position-management-policy.json",
    ),
    exitPolicy = loadLiveExitGovernorPolicy(
      process.env.LPFORGE_LIVE_EXIT_POLICY_PATH ??
        "policies/live-exit-governor-policy.json",
    ),
    positions = await input.store.loadOwnedPositions(input.ownerAddress);
  let planned = 0,
    skippedNoMatchingContext = 0;
  for (const row of positions) {
    const position = owned(row);
    let fact;
    try {
      fact = await input.adapter.getPositionV2(
        position.poolAddress,
        position.positionAddress,
      );
    } catch {
      fact = undefined;
    }
    let activeBinId = position.lowerBinId;
    try {
      activeBinId = (await input.adapter.getPool(position.poolAddress))
        .activeBinId;
    } catch {}
    let economics = { evidenceState: "UNAVAILABLE" as const, observedAt: input.observedAt, reasonCodes: ["EXIT_VALUATION_POOL_DATA_UNAVAILABLE"] },apiPool:DataApiPool|undefined;
    const attributedWalletInventory=await input.store.loadPositionInventoryLots(position.positionAddress);
    if (fact) {
      try {
        const [loadedPool,cashflows] = await Promise.all([input.api.getPool(position.poolAddress),input.store.loadPositionCashflows(position.positionAddress)]);
        apiPool=loadedPool;
        economics = derivePositionEconomics({position: fact, pool: apiPool, initialCapitalLamports: position.initialCapitalLamports, observedAt: input.observedAt,realizedFeeCashflows:cashflows,attributedWalletInventory:attributedWalletInventory.map(lot=>({tokenMint:lot.tokenMint,tokenAmountRaw:lot.remainingRawAmount.toString()})),...(position.actualEconomicCapitalLamports!==undefined?{actualContributedLamports:position.actualEconomicCapitalLamports}:{})}) as typeof economics;
      } catch {}
    }
    const priorExitRow=await input.store.loadPositionExitState(position.lpforgePositionId);
    const priorHighWater:ExitHighWaterState|undefined=priorExitRow?{
      peakNetReturnFraction:Number(priorExitRow.peak_net_return_fraction??0),
      ...(priorExitRow.peak_economic_value_usd!==null&&priorExitRow.peak_economic_value_usd!==undefined?{peakEconomicValueUsd:Number(priorExitRow.peak_economic_value_usd)}:{}),
      peakObservedAt:String(priorExitRow.peak_observed_at??input.observedAt),
    }:undefined;
    const current=input.currentResult?.poolAddress===position.poolAddress?input.currentResult:undefined;
    const regime=current?.shadow?.regime.primary;
    const thesisStatus=regime==='FREEFALL'?'EMERGENCY':regime==='DISTRIBUTION'||regime==='TREND_DOWN'?'DETERIORATING':'VALID';
    const continuation=fact?await loadPositionContinuationEconomics(position,fact,current,economics):undefined;
    const closeCostLamports=fact&&apiPool?await estimateExpectedCloseCostLamports(fact,apiPool,input.swapQuoteProvider):undefined;
    const currentForwardEv=continuation?Number(continuation.continuationEvLamports)/1_000_000_000:undefined;
    const priorPayload=(priorExitRow?.payload&&typeof priorExitRow.payload==="object"?priorExitRow.payload:{}) as Record<string,unknown>;
    const priorConfirmation=Number(priorPayload.continuationConfirmationCount??0);
    const inferior=continuation!==undefined&&closeCostLamports!==undefined&&continuation.continuationEvLamports<=-closeCostLamports;
    const confirmationCount=inferior?Math.max(0,Math.floor(priorConfirmation))+1:0;
    const toxicity=current?.poolAssessment.toxicityProbability;
    const liquidityChange=Number(current?.poolAssessment.evidence.recentLiquidityChangePct??0);
    const exitDecision=assessLiveExit({
      policy:exitPolicy,economics,...(priorHighWater?{highWater:priorHighWater}:{}),thesisStatus,
      ...(typeof currentForwardEv==="number"?{currentForwardEv,forwardEvEvidenceAvailable:true,forwardEvConfirmationCount:confirmationCount}:{}),
      ...(closeCostLamports!==undefined?{closeCost:Number(closeCostLamports)/1_000_000_000}:{}),
      ...(current?.risk?{riskDecision:current.risk.decision,riskReasonCodes:current.risk.reasonCodes}:{}),
      ...(typeof toxicity==="number"?{toxicityProbability:toxicity}:{}),liquidityCollapse:Number.isFinite(liquidityChange)&&liquidityChange<=-50,
      ...(position.enteredAt&&Number.isFinite(Date.parse(position.enteredAt))?{positionAgeMinutes:Math.max(0,(Date.parse(input.observedAt)-Date.parse(position.enteredAt))/60000)}:{}),
    });
    const claimExpectedValueLamports=fact&&apiPool?claimValueLamports({feeX:fact.feeX,feeY:fact.feeY,pool:apiPool}):undefined;
    const decision = decideLivePositionManagement({
      policy,
      owned: position,
      ...(fact ? { position: fact } : {}),
      activeBinId,
      exitDecision,
      ...(claimExpectedValueLamports!==undefined?{claimExpectedValueLamports}:{}),
      ...(typeof currentForwardEv==='number'?{currentForwardEv}:{}),
    });
    const managementContext = assessLiveManagementContext({
      positionPoolAddress: position.poolAddress,
      ...(current ? { managementPoolAddress: current.poolAddress } : {}),
      action: decision.action,
    });
    await input.store.upsertPositionExitState({
      lpforgePositionId:position.lpforgePositionId,observedAt:input.observedAt,evidenceState:exitDecision.economics.evidenceState,
      ...(exitDecision.economics.initialCapitalUsd!==undefined?{initialCapitalUsd:exitDecision.economics.initialCapitalUsd}:{}),
      ...(exitDecision.economics.currentEconomicValueUsd!==undefined?{currentEconomicValueUsd:exitDecision.economics.currentEconomicValueUsd}:{}),
      ...(exitDecision.economics.netPnlUsd!==undefined?{netPnlUsd:exitDecision.economics.netPnlUsd}:{}),
      ...(exitDecision.economics.netReturnFraction!==undefined?{netReturnFraction:exitDecision.economics.netReturnFraction}:{}),
      peakNetReturnFraction:exitDecision.highWater.peakNetReturnFraction,
      ...(exitDecision.highWater.peakEconomicValueUsd!==undefined?{peakEconomicValueUsd:exitDecision.highWater.peakEconomicValueUsd}:{}),
      peakObservedAt:exitDecision.highWater.peakObservedAt,lastAction:exitDecision.action,reasonCodes:exitDecision.reasonCodes,
      payload:{peakGivebackFraction:exitDecision.peakGivebackFraction,reasonFamily:exitDecision.reasonFamily,urgency:exitDecision.urgency,continuationEvLamports:continuation?.continuationEvLamports.toString()??null,expectedCloseCostLamports:closeCostLamports?.toString()??null,continuationCandidateId:continuation?.candidateId??null,geometryIdentity:continuation?.geometryIdentity??null,continuationConfirmationCount:confirmationCount,regime:regime??null,toxicity:toxicity??null}
    });
    await input.store.insertPositionManagementDecisionAudit({lpforgePositionId:position.lpforgePositionId,positionAddress:position.positionAddress,observedAt:input.observedAt,activeBinId,lowerBinId:position.lowerBinId,upperBinId:position.upperBinId,...(continuation?{positionContinuationEvLamports:continuation.continuationEvLamports,forecastHorizonMinutes:continuation.forecastHorizonMinutes}:{}),...(current?.shadow?.recommendationId?{sourceDecisionId:current.shadow.recommendationId}:{}),...(continuation?{sourceEconomicsId:continuation.candidateId}:{}),...(continuation?.uncertainty!==undefined?{uncertainty:continuation.uncertainty}:{}),...(closeCostLamports!==undefined?{expectedCloseCostLamports:closeCostLamports}:{}),geometryIdentity:continuation?.geometryIdentity??`${position.positionAddress}:${position.strategy}:${position.orientation}:${position.lowerBinId}:${position.upperBinId}`,managementAction:decision.action,exitReasonFamily:exitDecision.reasonFamily,reasonCodes:exitDecision.reasonCodes,confirmationSequenceCount:confirmationCount,validContinuationEvidence:continuation!==undefined&&closeCostLamports!==undefined});
    await input.store.insertPositionObservation({
      lpforgePositionId: position.lpforgePositionId,
      observedAt: input.observedAt,
      activeBinId,
      rangeState: fact
        ? activeBinId < fact.lowerBinId || activeBinId > fact.upperBinId
          ? "OUT_OF_RANGE"
          : "IN_RANGE"
        : "UNKNOWN",
      ...(fact
        ? {
            tokenXAmount: fact.totalXAmount,
            tokenYAmount: fact.totalYAmount,
            unclaimedFeeX: fact.feeX,
            unclaimedFeeY: fact.feeY,
          }
        : {}),
      walletTruth: attributedWalletInventory.length===0
        ? { source: "NO_ATTRIBUTED_WALLET_INVENTORY" }
        : { source: "POSITION_INVENTORY_LOTS", required: true, lots: attributedWalletInventory.map(lot=>({lotId:lot.lotId,tokenMint:lot.tokenMint,tokenSide:lot.tokenSide,rawAmount:lot.remainingRawAmount.toString(),decimals:lot.decimals,status:lot.status})), valueUsd: exitDecision.economics.walletInventoryValueUsd ?? null },
      positionTruth: fact ?? { missing: true },
      managementContext: {
        decision,
        policy,
        exitDecision,
        exitPolicy,
        positionPoolAddress: position.poolAddress,
        managementPoolAddress: current?.poolAddress ?? null,
        ...managementContext,
      },
      reconciliationDebt: !fact,
      staleData: false,
      payload: { source: "LPFORGE_PRODUCTION_OWNED_POSITION_MONITOR" },
    });
    const riskIncreasing = ["ADD", "RESHAPE", "REBALANCE"].includes(decision.action);
    // A reshape/rebalance includes a replacement OPEN. Under containment, do
    // not leave the old risk in place waiting for new-entry authority: issue
    // the already-supported terminal CLOSE workflow instead. It removes the
    // old liquidity, settles wallet truth, and never builds a replacement.
    const containmentTerminalClose =
      riskIncreasing &&
      !input.allowRiskIncreasingPlans &&
      input.allowProtectiveManagementPlans &&
      ["RESHAPE", "REBALANCE"].includes(decision.action);
    const planAction = containmentTerminalClose ? "CLOSE" : decision.action;
    const planRiskIncreasing = ["ADD", "RESHAPE", "REBALANCE"].includes(planAction);
    if (
      decision.action === "HOLD" ||
      !managementContext.planAllowed ||
      (planRiskIncreasing
        ? !input.allowRiskIncreasingPlans
        : !input.allowProtectiveManagementPlans) ||
      (await input.store.hasActiveAutonomousPlan(position.positionAddress))
    ) {
      if (decision.action !== "HOLD" && !managementContext.planAllowed)
        skippedNoMatchingContext++;
      continue;
    }
    if (planAction === "HOLD") continue;
    const expiresAt = new Date(
        Date.parse(input.observedAt) + policy.planTtlMs,
      ).toISOString(),
      replacement = decision.replacementRange;
    const plan = buildTransactionPlan({
      action: planAction,
      cluster: "mainnet-beta",
      ownerAddress: position.ownerAddress,
      poolAddress: position.poolAddress,
      positionAddress: position.positionAddress,
      thesisId: position.thesisId,
      observedAt: input.observedAt,
      expiresAt,
      // Position-management costs are assessed against the current remaining
      // capital basis. CLOSE and CLAIM must never fall back to one lamport.
      capitalLamports: position.initialCapitalLamports,
      ...(replacement && !containmentTerminalClose
        ? {
            lowerBinId: replacement.lowerBinId,
            upperBinId: replacement.upperBinId,
            strategy: position.strategy,
            removeLowerBinId: position.lowerBinId,
            removeUpperBinId: position.upperBinId,
          }
        : {}),
      ...(planAction === "REDUCE"
        ? {
            reductionBps: Math.max(
              1,
              Math.min(9999, Math.round(exitDecision.reduceFraction * 10000)),
            ),
          }
        : {}),
      metadata: {
        managementReasonCodes: decision.reasonCodes,
        requestedManagementAction: decision.action,
        ...(containmentTerminalClose ? { containmentDisposition: "CLOSE_OLD_POSITION_NO_REPLACEMENT", reasonCodes: ["P7_CONTAINMENT_BLOCKED_REPLACEMENT_OPEN"] } : {}),
        managementContextReasonCodes: managementContext.reasonCodes,
        managementContextPoolAddress: current?.poolAddress ?? null,
        positionPoolAddress: position.poolAddress,
        sourcePositionAddress: position.positionAddress,
        orientation: position.orientation,
        entryFunding: { rebuildFromRemovedPosition: true },
        exitGovernor: { reasonFamily: exitDecision.reasonFamily, reasonCodes: exitDecision.reasonCodes, economics: exitDecision.economics, highWater: exitDecision.highWater, peakGivebackFraction: exitDecision.peakGivebackFraction },
      },
    });
    await persistTransactionPlan(input.store, plan);
    planned++;
  }
  return { observed: positions.length, planned, skippedNoMatchingContext };
}
function shadowPayloadForPersistence(shadow:NonNullable<OperationalCycleResult['shadow']>):Record<string,unknown>{
 const {candidateUniverseEvidence,...persistent}=shadow;
 // V3 writes the large replay arrays exactly once to its temporary
 // validation-universe record.  They must not be duplicated permanently in
 // every immutable shadow recommendation.
 return persistent as unknown as Record<string,unknown>;
}
const finiteNumber=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;

async function persistReset3cUniverse(store:Phase1Store,r:OperationalCycleResult,frozen:ReturnType<typeof freezePhase3ForwardDecision>){
 const universe=r.shadow?.candidateUniverseEvidence;if(!universe||!universe.frames.length)return;
 const baseline=universe.frames[0]!,capital=BigInt(universe.capitalLamports),rankingById=new Map(universe.ranking.rankings.map(row=>[row.candidateId,row] as const)),rankById=new Map(universe.ranking.rankings.map((row,index)=>[row.candidateId,index+1] as const)),simulations=new Map(universe.simulations.map(row=>[row.candidateId,row] as const));
 const rows=await Promise.all(universe.candidates.map(async candidate=>{
   const simulation=simulations.get(candidate.id),ranking=rankingById.get(candidate.id);let result:Awaited<ReturnType<typeof evaluateUserSelectedCapitalOpportunity>>|undefined,error:string|undefined;
   try{result=await evaluateUserSelectedCapitalOpportunity({decision:{...frozen,selectedCandidate:candidate,capitalLamports:capital.toString()},candidate,baseline,frames:universe.frames,events:universe.events,userSelectedCapitalLamports:capital,costs:universe.costs});}catch(cause){error=cause instanceof Error?cause.message:String(cause);}
   const weightHash=await sha256Hex(canonicalJson(candidate.perBinWeights)),geometryIdentity=await sha256Hex(canonicalJson({candidateId:candidate.id,strategy:candidate.strategy,orientation:candidate.orientation,family:candidate.family,lowerBinId:candidate.lowerBinId,upperBinId:candidate.upperBinId,centerBinId:candidate.centerBinId,weightHash}));
   return{candidate,simulation,ranking,result,error,geometryIdentity,weightHash};
 }));
 const currentSelectedCandidateId=frozen.phase3Outcome==='ENTRY_READY'?frozen.selectedCandidate?.id:undefined;
 const selection=selectReset3cDecisionRelevantCandidates({...(currentSelectedCandidateId?{currentSelectedCandidateId}:{}),candidates:rows.map(row=>({candidateId:row.candidate.id,mechanicallyConstructible:row.result?.constructibility.mechanicallyConstructible===true,currentPolicyStatus:row.result?.economics.currentPolicyStatus??row.result?.feasibility.status??null,currentRank:rankById.get(row.candidate.id)??null,legacyExpectedNetPnl:finiteNumber(row.simulation?.netValue),canonicalExpectedNetPnl:finiteNumber(row.result?.economics.expectedNetPnlSol)}))});
 const selectionById=new Map(selection.detailedCandidates.map(row=>[row.candidateId,row] as const));
 const censusCandidates=rows.map(row=>({candidateId:row.candidate.id,pool:frozen.poolAddress,strategy:row.candidate.strategy,orientation:row.candidate.orientation,family:row.candidate.family,lowerBinId:row.candidate.lowerBinId,upperBinId:row.candidate.upperBinId,activeBinId:baseline.activeBinId,geometryIdentity:row.geometryIdentity,weightHash:row.weightHash,capitalLamports:capital.toString(),mechanicallyConstructible:row.result?.constructibility.mechanicallyConstructible===true,...(row.result?.constructibility.mechanicalFailureReason?{mechanicalFailureReason:row.result.constructibility.mechanicalFailureReason}:{}),currentPolicyStatus:row.result?.economics.currentPolicyStatus??row.result?.feasibility.status??'UNKNOWN',...(row.result?.economics.resultingOwnershipBps===undefined?{}:{resultingOwnershipBps:row.result.economics.resultingOwnershipBps}),legacyEconomics:row.simulation?{expectedFeePnl:row.simulation.feeValue,expectedInventoryEffect:row.simulation.inventoryChangeValue,expectedCosts:row.simulation.totalCostValue,expectedNetPnl:row.simulation.netValue}:null,canonicalEconomics:row.result?.economics?{expectedFeePnlSol:row.result.economics.expectedFeePnlSol,expectedInventoryEffectSol:row.result.economics.expectedInventoryEffectSol,expectedCostsSol:row.result.economics.expectedCostsSol,expectedNetPnlSol:row.result.economics.expectedNetPnlSol,expectedNetReturnBps:row.result.economics.expectedNetReturnBps}:null,currentRank:rankById.get(row.candidate.id)??null,currentRankingUtility:row.ranking?.utility??null,selectedCandidate:row.candidate.id===currentSelectedCandidateId,detailedValidationSelected:selectionById.has(row.candidate.id),detailedValidationReasons:selectionById.get(row.candidate.id)?.reasonCodes??[],...(selectionById.has(row.candidate.id)?{}:{detailedValidationOmissionReason:'NOT_DECISION_RELEVANT'}),...(row.error?{failureReason:row.error}:{})})).sort((a,b)=>a.candidateId.localeCompare(b.candidateId));
 const manifestCore={version:RESET3C_STORAGE_CONTRACT_V3,decisionId:frozen.decisionId,capitalLamports:capital.toString(),candidates:censusCandidates.map(candidate=>({candidateId:candidate.candidateId,geometryIdentity:candidate.geometryIdentity,mechanicallyConstructible:candidate.mechanicallyConstructible,currentPolicyStatus:candidate.currentPolicyStatus})),expectedCandidateCount:rows.length,capturedCandidateCount:rows.length,universeComplete:true};
 const universeManifestHash=await sha256Hex(canonicalJson(manifestCore));
 const selectionManifest={samplingContractVersion:RESET3C_VALIDATION_SAMPLING_CONTRACT_V1,recommendationId:frozen.recommendationId,decisionId:frozen.decisionId,universeManifestHash,categoryWinners:selection.categoryWinners,detailedCandidates:selection.detailedCandidates};
 const detailedSelectionManifestHash=await sha256Hex(canonicalJson(selectionManifest));
 const census={version:RESET3C_STORAGE_CONTRACT_V3,samplingContractVersion:RESET3C_VALIDATION_SAMPLING_CONTRACT_V1,recommendationId:frozen.recommendationId,decisionId:frozen.decisionId,decisionAt:frozen.decisionTimestamp,pool:frozen.poolAddress,capitalLamports:capital.toString(),expectedCandidateCount:rows.length,capturedCandidateCount:rows.length,universeComplete:true,universeManifestHash,candidates:censusCandidates,qualificationFacts:universe.qualification,globalEconomics:universe.economics};
 const {reference:sharedEvidenceReference,temporarySharedEvidence}=await buildReset3cValidationSharedEvidenceReference({recommendationId:frozen.recommendationId,universe:universe as unknown as Record<string,unknown>,frozenDecision:frozen as unknown as Record<string,unknown>});
 const detailedRows=rows.filter(row=>selectionById.has(row.candidate.id)),outcomeEligibleCandidateCount=detailedRows.filter(row=>row.result?.constructibility.mechanicallyConstructible===true).length;
 const universeContentHash=await sha256Hex(canonicalJson({census,selectionManifest,detailedCandidateIds:detailedRows.map(row=>row.candidate.id).sort(),sharedEvidenceHash:sharedEvidenceReference.sharedEvidenceHash}));
 await store.insertReset3cValidationUniverse({recommendationId:frozen.recommendationId,decisionId:frozen.decisionId,decisionAt:frozen.decisionTimestamp,samplingContractVersion:RESET3C_VALIDATION_SAMPLING_CONTRACT_V1,storageContractVersion:RESET3C_STORAGE_CONTRACT_V3,capitalLamports:capital.toString(),expectedCandidateCount:rows.length,capturedCandidateCount:rows.length,universeComplete:true,universeManifestHash,detailedCandidateCount:detailedRows.length,outcomeEligibleCandidateCount,detailedCandidateIds:detailedRows.map(row=>row.candidate.id).sort(),selectionManifest,detailedSelectionManifestHash,census,sharedEvidenceHash:sharedEvidenceReference.sharedEvidenceHash,temporarySharedEvidence,contentHash:universeContentHash});
 const candidateFacts={version:'candidate-universe-rerank-retention-v1',candidates:universe.candidates,simulations:universe.simulations,rankings:universe.ranking.rankings,rankingPolicyId:universe.ranking.policyId,qualification:universe.qualification,economics:universe.economics,references:{universeManifestHash,sharedEvidenceHash:sharedEvidenceReference.sharedEvidenceHash}};
 const selected=universe.ranking.rankings.find(row=>row.candidateId===universe.ranking.winner),selectedSimulation=selected?simulations.get(selected.candidateId):undefined,scales=universe.simulations.map(row=>row.normalizationScale).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
 const strategyCounts=Object.fromEntries(universe.candidates.reduce((acc,candidate)=>acc.set(candidate.strategy,(acc.get(candidate.strategy)??0)+1),new Map<string,number>()));
 const calibrationVersion=String(universe.simulations.find(row=>row.feeEvidenceCalibration)?.feeEvidenceCalibration?.version??'raw-replay-unversioned');
 const compactSummary={version:'candidate-universe-rerank-summary-v1',candidateCount:rows.length,selectedCandidateId:universe.ranking.winner,selectedStrategy:universe.candidates.find(candidate=>candidate.id===universe.ranking.winner)?.strategy??null,selectedOrientation:universe.candidates.find(candidate=>candidate.id===universe.ranking.winner)?.orientation??null,selectedRawFee:selectedSimulation?.rawReplayFeeValue??selectedSimulation?.feeValue??null,selectedCalibratedFee:selectedSimulation?.feeValue??null,selectedRawNet:selectedSimulation?.rawReplayNetValue??selectedSimulation?.netValue??null,selectedRiskAdjustedEv:universe.qualification.riskAdjustedExpectedNetEV??null,selectedUtility:selected?.utility??null,calibrationVersion,minNormalizationScale:scales.length?Math.min(...scales):null,maxNormalizationScale:scales.length?Math.max(...scales):null,candidateCountByStrategy:strategyCounts,actionableCandidateCount:universe.ranking.rankings.filter(row=>row.actionable).length,positiveCalibratedCandidateCount:universe.simulations.filter(row=>row.evidenceActionable&&row.netValue>0).length,forwardOutcomeHorizonMinutes:[30,60,120]};
 const retentionUntil=new Date(Date.parse(frozen.decisionTimestamp)+candidateUniverseRetentionHours()*60*60_000).toISOString();
 const retentionContentHash=await sha256Hex(canonicalJson({candidateFacts,compactSummary,retentionUntil,calibrationVersion}));
 await store.insertCandidateUniverseRerankRetention({recommendationId:frozen.recommendationId,decisionId:frozen.decisionId,decisionAt:frozen.decisionTimestamp,poolAddress:frozen.poolAddress,calibrationVersion,expectedCandidateCount:rows.length,universeManifestHash,candidateFacts,compactSummary,retentionUntil,contentHash:retentionContentHash});
 for(const row of detailedRows){
   const candidate={...row.candidate,capitalFraction:1},capitalContract=await buildCapitalContract({proposedCapitalLamports:capital,candidateCapitalFraction:1}),positionContract=await buildPositionContract({decision:{...frozen,selectedCandidate:candidate,capitalLamports:capital.toString()},candidate,baseline,capitalContract}),identity=await buildCapitalEvaluationIdentity({decision:frozen,candidate,capitalContract,positionContract,modelVersion:'phase3-forward-outcome-v2',formulaVersion:'capital-constrained-forward-v2',namespace:'COUNTERFACTUAL_CANONICAL'}),result=row.result,selectionRow=selectionById.get(row.candidate.id)!;
   const v1Raw={version:'reset3c-universe-v1',universeManifestHash,expectedCandidateCount:rows.length,capturedCandidateCount:rows.length,universeComplete:true,evidenceCutoffAt:frozen.decisionTimestamp,frozenDecision:{...frozen,selectedCandidate:candidate,capitalLamports:capital.toString()},candidate:{...row.candidate},legacyEconomics:row.simulation??null,canonicalEconomics:result?.economics??null,mechanicalConstructibility:result?.constructibility??null,currentPolicy:result?.feasibility??null,rankingFacts:row.ranking??null,...(!result?{failureReason:row.error}: {})};
   const raw=compactReset3cDecisionRelevantRawContract(v1Raw,sharedEvidenceReference,{samplingContractVersion:RESET3C_VALIDATION_SAMPLING_CONTRACT_V1,detailedSelectionManifestHash,detailedValidationReasons:selectionRow.reasonCodes,outcomeEligible:result?.constructibility.mechanicallyConstructible===true}),contentHash=await sha256Hex(canonicalJson(raw));
   await store.insertVariableCapitalEvaluation({capitalEvaluationId:identity.capitalEvaluationId,recommendationId:frozen.recommendationId,decisionId:frozen.decisionId,candidateId:row.candidate.id,proposedCapitalLamports:capital.toString(),...(result?.economics.allocatedCapitalLamports?{allocatedCapitalLamports:result.economics.allocatedCapitalLamports}:{}),capitalContractHash:capitalContract.capitalContractHash,positionContractHash:positionContract.positionContractHash,capitalFeasibilityStatus:result?.feasibility.status??'UNKNOWN',bindingConstraint:result?.feasibility.bindingConstraint??'UNKNOWN',sourceSha:frozen.sourceSha,buildId:frozen.buildId,policyHash:frozen.policyHash,migrationHead:frozen.migrationHead,evidenceManifestHash:universeManifestHash,provenance:{authority:'RESEARCH_ONLY_NO_POLICY_MUTATION',namespace:'COUNTERFACTUAL_CANONICAL',samplingContractVersion:RESET3C_VALIDATION_SAMPLING_CONTRACT_V1},rawContract:raw,contentHash});
 }
}
async function persistResult(
  store: Phase1Store,
  r: OperationalCycleResult,
  allowEconomicPlans: boolean,
) {
  await store.insertPoolAssessment({
    ...r.poolAssessment,
    poolAddress: r.poolAssessment.pool,
  });
  if (r.shadow) {
    await store.insertShadowRecommendation({
      recommendationId: r.shadow.recommendationId,
      poolAddress: r.poolAddress,
      decisionAt: r.shadow.decisionAt,
      expiresAt: r.shadow.expiresAt,
      state: r.shadow.state,
      noTrade: r.shadow.noTrade,
      marketContextHash: r.shadow.marketContextHash,
      candidateCount: r.shadow.candidateCount,
      ranking: r.shadow.ranking as unknown as Record<string, unknown>,
      economics: r.shadow.economics as unknown as Record<string, unknown>,
      reasonCodes: r.shadow.reasonCodes,
      payload: shadowPayloadForPersistence(r.shadow),
    });
    // Shadow calibration must never influence the recommendation or authority
    // path. A capture failure is observable, but the already durable Phase-3
    // decision remains exactly as it was before this instrumentation existed.
    try {
      const frozen=freezePhase3ForwardDecision({recommendation:r.shadow,artifact:verifiedForwardArtifactProvenance(),...(r.entry?{phase4:{result:r.entry.decision,readinessScore:r.entry.readinessScore,timingConfidence:r.entry.confidence,reasonCodes:[...r.entry.reasonCodes],diagnostics:{phase4EconomicUncertainty:r.entry.phase4EconomicUncertainty,phase4TimingConfidence:r.entry.phase4TimingConfidence,uncertaintyNoLongerBlocking:r.entry.uncertaintyNoLongerBlocking,removedBlockerReason:r.entry.removedBlockerReason,hardBlocks:[...r.entry.hardBlocks],waitReasons:[...r.entry.waitReasons]}}}:{})});
      await store.insertPhase3ForwardDecision(phase3ForwardDecisionStoreValue(frozen));
      await persistReset3cUniverse(store,r,frozen);
    } catch (error) {
      console.error(json({event:'lpforge_phase3_forward_capture_failed',recommendationId:r.shadow.recommendationId,error:error instanceof Error?error.message:String(error),authority:'RESEARCH_ONLY_NO_POLICY_MUTATION'}));
    }
    await store.insertRegimeAssessment({
      poolAddress: r.poolAddress,
      decisionAt: r.shadow.decisionAt,
      primaryRegime: r.shadow.regime.primary,
      probabilities: r.shadow.regime.probabilities,
      confidence: r.shadow.regime.confidence,
      stability: r.shadow.regime.stability,
      transitionRisk: r.shadow.regime.transitionRisk,
      evidence: {
        reasonCodes: r.shadow.regime.reasonCodes,
        rawScores: r.shadow.regime.rawScores,
        features: r.shadow.regime.evidence,
      },
      recommendationId: r.shadow.recommendationId,
    });
    if (r.shadow.thesis)
      await store.insertLpThesis({
        thesisId: r.shadow.thesis.thesisId,
        recommendationId: r.shadow.recommendationId,
        poolAddress: r.poolAddress,
        observedAt: r.shadow.thesis.observedAt,
        expiresAt: r.shadow.thesis.expiresAt,
        selectedCandidateId: r.shadow.thesis.selectedCandidate.id,
        thesis: r.shadow.thesis as unknown as Record<string, unknown>,
      });
  }
  if (r.entry && r.shadow?.thesis) {
    const entryId = `entry-${r.cycleId}`;
    await store.insertEntryEvaluation({
      entryEvaluationId: entryId,
      thesisId: r.shadow.thesis.thesisId,
      poolAddress: r.poolAddress,
      observedAt: r.entry.observedAt,
      expiresAt: r.entry.expiresAt,
      decision: r.entry.decision,
      readinessScore: r.entry.readinessScore,
      confidence: r.entry.confidence,
      reasonCodes: r.entry.reasonCodes,
      payload: r.entry as unknown as Record<string, unknown>,
    });
  }
  if (r.risk) {
    await store.insertRiskDecision({
      riskDecisionId: `risk-${r.cycleId}`,
      observedAt: r.observedAt,
      expiresAt: r.risk.expiresAt,
      scope: r.risk.scope,
      decision: r.risk.decision,
      reasonCodes: r.risk.reasonCodes,
      payload: r.risk as unknown as Record<string, unknown>,
    });
  }
  if (r.allocation) {
    const a = r.allocation.allocations[0];
    if (a)
      await store.insertCapitalAllocation({
        allocationId: `allocation-${r.cycleId}`,
        observedAt: r.observedAt,
        poolAddress: r.poolAddress,
        requested: a.requested,
        allocated: a.allocated,
        payload: r.allocation as unknown as Record<string, unknown>,
      });
  }
  if (r.plan && allowEconomicPlans) await persistTransactionPlan(store, r.plan);
  await store.insertOperationalCycle({
    cycleId: r.cycleId,
    poolAddress: r.poolAddress,
    observedAt: r.observedAt,
    phase3Status: r.phase3Status,
    phase4Status: r.phase4Status,
    phase5Status: r.phase5Status,
    ...(r.shadow ? { recommendationId: r.shadow.recommendationId } : {}),
    ...(r.shadow?.thesis ? { thesisId: r.shadow.thesis.thesisId } : {}),
    ...(r.entry ? { entryDecision: r.entry.decision } : {}),
    ...(r.plan ? { planId: r.plan.planId } : {}),
    payload: {
      reasonCodes: r.reasonCodes,
      evidence: r.evidence,
      liveSigning: false,
      submissionPerformed: false,
      economicPlanDispatchAllowed: allowEconomicPlans,
      ...(r.plan && !allowEconomicPlans
        ? { planSuppressedReason: "P7_ECONOMIC_ACTION_NOT_ALLOWED" }
        : {}),
    },
  });
  await store.recordPostEvidenceEvaluationOutcome({poolAddress:r.poolAddress,observedAt:r.observedAt,phase3Status:r.phase3Status});
}
async function liveOnce() {
  const cfg = loadPhase1Config();
  if (cfg.dataMode !== "LIVE_READ_ONLY")
    throw new Error("LPFORGE_OPERATOR_REQUIRES_LIVE_READ_ONLY");
  if (!cfg.smokePoolAddress)
    throw new Error("LPFORGE_CONFIG_REQUIRED:LPFORGE_SMOKE_POOL_ADDRESS");
  const log = new Logger("operator", cfg.logLevel);
  const store = await createPostgresStore(cfg.databaseUrl);
  const cycleStartedAt = new Date().toISOString();
  try {
    const runtimeId = (process.env.LPFORGE_P7_RUNTIME_ID ?? "lpforge-production").trim();
    const planDispatchEnabled =
      (process.env.LPFORGE_P7_PLAN_DISPATCH_ENABLED ?? "false").toLowerCase() === "true";
    const protectiveActionDispatchEnabled =
      (process.env.LPFORGE_P7_PROTECTIVE_ACTION_DISPATCH_ENABLED ?? "true").toLowerCase() === "true";
    const control = await store.loadLatestPhase7ControlDecision(runtimeId);
    const postEntryAuthorityInput = {
      ...(typeof control?.authority_mode === "string" ? { authorityMode: control.authority_mode } : {}),
      ...(typeof control?.health_status === "string" ? { healthStatus: control.health_status } : {}),
      ...(typeof control?.safety_mode === "string" ? { safetyMode: control.safety_mode } : {}),
      newEconomicActionAllowed: Boolean(control?.new_economic_action_allowed),
      riskIncreasingPlanDispatchEnabled: planDispatchEnabled,
      protectiveActionDispatchEnabled,
    };
    const allowRiskIncreasingPlans = assessPostEntryAuthority(postEntryAuthorityInput, "OPEN").allowed;
    // Containment explicitly permits verified, risk-reducing management while
    // OBSERVE_ONLY continues to deny every new/increased exposure action.
    const allowProtectiveManagementPlans = assessPostEntryAuthority(postEntryAuthorityInput, "CLOSE").allowed;
    let eventDecodeWarnings = 0;
    const adapter = createMeteoraReadAdapter({
      rpcUrl: cfg.solanaRpcHttpUrl,
      cluster: cfg.cluster,
      programId: cfg.programId,
      expectedSdkVersion: cfg.expectedSdkVersion,
      rpcTimeoutMs: cfg.rpcTimeoutMs,
      onEventDecodeWarning: (warning) => {
        eventDecodeWarnings++;
        log.warn("meteora_event_decode_quarantined", { ...warning });
      },
    });
    const compat = await adapter.verifyCompatibility(cfg.smokePoolAddress);
    await store.insertCompatibility(compat);
    if (compat.state !== "VERIFIED")
      throw new Error("LPFORGE_PROTOCOL_COMPATIBILITY_HOLD");
    const deploymentPolicy=loadDeploymentPolicyFile(process.env.LPFORGE_EXECUTION_POLICY_PATH ?? "policies/live-execution-policy.json");
    const evidenceWidth=derivePhase3EvidenceWidthRequirement(deploymentPolicy.positionConstruction?.maxInitialPositionWidthBins ?? 100);
    const [pool, bins] = await Promise.all([
      adapter.getPool(cfg.smokePoolAddress),
      adapter.getBinsAroundActive(cfg.smokePoolAddress, evidenceWidth.requiredEvidenceRadius),
    ]);
    const api = createMeteoraDataApi({
      baseUrl: cfg.meteoraDataApiUrl,
      maxRps: cfg.dataApiMaxRps,
      timeoutMs: cfg.httpTimeoutMs,
    });
    const [apiPool, ohlcv] = await Promise.all([
      api.getPool(cfg.smokePoolAddress),
      api.getOhlcv(cfg.smokePoolAddress, { timeframe: "5m" }),
    ]);
    const apiObservedAt = new Date().toISOString();
    const staticProductionPool=deploymentPolicy.pools.some(entry=>entry.address===cfg.smokePoolAddress);
    if(!staticProductionPool){
      await store.insertPoolSnapshot(pool);
      await store.insertBins(bins);
      await store.insertDataApiPool(apiPool as Record<string, unknown>,apiObservedAt);
    }
    await store.insertOhlcv(
      cfg.smokePoolAddress,
      "5m",
      ohlcv.data as unknown as Array<Record<string, unknown>>,
      apiObservedAt,
      "METEORA_API",
    );
    const rpc = createSolanaRpcClient({
      url: cfg.solanaRpcHttpUrl,
      timeoutMs: cfg.rpcTimeoutMs,
      minIntervalMs: cfg.rpcMinIntervalMs,
      maxRetries: cfg.rpcMaxRetries,
      retryBaseDelayMs: cfg.rpcRetryBaseDelayMs,
      retryMaxDelayMs: cfg.rpcRetryMaxDelayMs,
    });
    const transactions = await scanAddressTransactions({
      rpc,
      address: cfg.smokePoolAddress,
      limit: cfg.eventBackfillLimit,
      programId: cfg.programId,
      onTransactionFailure: ({ signature, message }) =>
        log.warn("meteora_transaction_fetch_quarantined", {
          signature,
          reason: message,
        }),
    });
    let decodedSwapEvents = 0;
    for (const tx of transactions)
      for (const event of await adapter.decodeEvents(
        cfg.smokePoolAddress,
        tx.signature,
        tx.slot,
        tx.blockTime,
        tx.logs,
        tx.cpiInstructionData,
      ))
        if (event.pool === cfg.smokePoolAddress) {
          decodedSwapEvents++;
          await store.insertSwapEvent(event);
        }
    log.info("meteora_ingestion_summary", {
      transactionsScanned: transactions.length,
      decodedSwapEvents,
      eventDecodeWarnings,
    });
    if(staticProductionPool){
      // A static pool owns no dynamic ACTIVE slot, but it uses the same
      // bounded historical backfill lifecycle before projecting Phase-3 facts.
      await refreshCanonicalHistoricalBackfill({api,adapter,rpc,store,poolAddress:cfg.smokePoolAddress,apiPool,observedAt:apiObservedAt,authority:'PRODUCTION_POLICY_MONITORING'});
      await refreshCurrentPhase3Evidence({store,poolAddress:cfg.smokePoolAddress,apiPool,pool,bins,observedAt:apiObservedAt,sourceProvider:'OPERATOR_METEORA_API+RPC',sourcePayload:{productionPolicyPool:true},collectionTarget:'PRODUCTION_POLICY',authority:'PRODUCTION_POLICY_MONITORING'});
    }
    const since = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const history = await store.loadOperationalHistory(
      cfg.smokePoolAddress,
      since,
      2000,
    );
    const decisionAt = new Date().toISOString();
    const maturityRow = await store.loadActiveCandidateHistoryMaturity(
      cfg.smokePoolAddress,
    );
    const recentLiveObservations = await store.loadCandidateMarketObservations(
      cfg.smokePoolAddress,
      // Phase 3 accepts a small recent sample over the bounded 15-minute
      // admission window. Current-data freshness and each continuity gap are
      // independently enforced below.
      new Date(Date.parse(decisionAt) - PHASE3_RECENT_LIVE_OBSERVATION_WINDOW_MS).toISOString(),
      100,
    );
    const freshLiveObservations = recentLiveObservations.filter(
      row => row.sourceType === "LIVE_OBSERVED" && Date.parse(row.observedAt) <= Date.parse(decisionAt),
    );
    const phase3LiveEvidence = summarizePhase3RecentLiveObservations(
      decisionAt,
      freshLiveObservations.map(row => row.observedAt),
    );
    const backfillRow = await store.loadActiveCandidateBackfill(
      cfg.smokePoolAddress,
    );
    const evidenceMaturity = maturityRow
      ? {
          state: String(maturityRow.state),
          historicalState: String((maturityRow.payload as Record<string, unknown> | undefined)?.historicalMaturity ?? ''),
          historicalBackfillQuality: String(backfillRow?.quality ?? ''),
          liveConfirmationState: String((maturityRow.payload as Record<string, unknown> | undefined)?.liveConfirmation ?? ''),
          ...phase3LiveEvidence,
          reasonCodes: (maturityRow.reason_codes ?? []) as string[],
        }
      : undefined;
    const economicRow = await store.loadLatestEconomicEstimate(
      cfg.smokePoolAddress,
      decisionAt,
    );
    const economicEvidence = economicRow && String(economicRow.fidelity) === "EVENT_PATH_ESTIMATE"
      ? (() => {
          // evidence_age_seconds is valid only at the estimate's as_of. Age it
          // forward to this exact decision; invalid provenance fails closed.
          const evidenceAgeSeconds=decisionTimeEconomicEvidenceAgeSeconds({estimateAsOf:String(economicRow.as_of??''),storedEvidenceAgeSeconds:Number(economicRow.evidence_age_seconds),decisionAt});
          return {
          fidelity: String(economicRow.fidelity),
          effectiveSampleCount: Number(economicRow.effective_sample_count),
          feeRatePerCapitalHour: Number(economicRow.fee_rate_per_capital_hour),
          uncertainty: Number(economicRow.uncertainty),
          evidenceAgeSeconds,
          rawObservationCount: Number(economicRow.raw_observation_count),
          independentEpisodeCount: Number(economicRow.independent_episode_count),
          feeObservationCount: Number(economicRow.fee_observation_count),
          eventPathObservationCount: Number(economicRow.event_path_observation_count),
          sourceHashes: (economicRow.source_hashes ?? {}) as Record<string, unknown>,
          };
        })()
      : undefined;
    const priorRegimeAssessments = await store.loadRegimeAssessmentHistory(
      cfg.smokePoolAddress,
      decisionAt,
      120,
    );
    const openPlanCapacity = await loadLiveOpenPlanCapacity({
      store,
      rpcUrl: cfg.solanaRpcHttpUrl,
      ownerAddress: process.env.LPFORGE_OPERATOR_OWNER_ADDRESS,
    });
    const walletCapital = lamportsToSol(openPlanCapacity.walletLamports);
    if (!(walletCapital > 0))
      throw new Error("LPFORGE_OPERATOR_WALLET_BALANCE_UNAVAILABLE");
    const entryPolicy = loadAutonomousEntryPolicy(
      process.env.LPFORGE_AUTONOMOUS_ENTRY_POLICY_PATH ??
        "policies/autonomous-entry-policy.json",
    );
    const productionCapital = loadProductionCapitalEnvelope(pool.address);
    const swapQuoteProvider =
      entryPolicy.status === "ENABLED"
        ? createJupiterSwapQuoteProvider({
            policy: entryPolicy.swapQuote,
            ...(process.env.LPFORGE_JUPITER_API_KEY
              ? { apiKey: process.env.LPFORGE_JUPITER_API_KEY }
              : {}),
          })
        : undefined;
    const result = await evaluateOperationalCycle({
      observedAt: decisionAt,
      pool,
      bins,
      dataApiPool: apiPool,
      history,
      priorRegimeAssessments,
      protocolCompatible: true,
      walletCapital,
      qualificationPolicy: phase3QualificationPolicyFromEnvironment(),
      ...productionCapital,
      planPreparationEnabled: allowRiskIncreasingPlans && openPlanCapacity.approved,
      ...(!openPlanCapacity.approved
        ? { planPreparationBlockReasonCodes: openPlanCapacity.reasonCodes }
        : {}),
      ...(economicEvidence ? { economicEvidence } : {}),
      ...(evidenceMaturity ? { evidenceMaturity } : {}),
      ...(swapQuoteProvider ? { swapQuoteProvider } : {}),
      ...(process.env.LPFORGE_OPERATOR_OWNER_ADDRESS
        ? { ownerAddress: process.env.LPFORGE_OPERATOR_OWNER_ADDRESS }
        : {}),
      ...(process.env.LPFORGE_PREPARE_POSITION_ADDRESS
        ? {
            replacementPositionAddress:
              process.env.LPFORGE_PREPARE_POSITION_ADDRESS,
          }
        : {}),
    });
    await persistResult(store, result, allowRiskIncreasingPlans);
    const management = await observeAndPlanOwnedPositions({
      store,
      adapter,
      api,
      ownerAddress: process.env.LPFORGE_OPERATOR_OWNER_ADDRESS,
      ...(swapQuoteProvider?{swapQuoteProvider}:{}),
      observedAt: decisionAt,
      currentResult: result,
      allowRiskIncreasingPlans,
      allowProtectiveManagementPlans,
    });
    await store.upsertRuntimeHeartbeat({
      runtimeId: "lpforge-live-shadow",
      poolAddress: cfg.smokePoolAddress,
      observedAt: decisionAt,
      status: "PASS",
      cycleId: result.cycleId,
      payload: {
        cycleStartedAt,
        phase3Status: result.phase3Status,
        phase4Status: result.phase4Status,
        phase5Status: result.phase5Status,
        economicPlanDispatchAllowed: allowRiskIncreasingPlans,
        protectiveManagementPlanDispatchAllowed: allowProtectiveManagementPlans,
        postEntryAuthority: {
          riskIncreasing: assessPostEntryAuthority(postEntryAuthorityInput, "OPEN"),
          claim: assessPostEntryAuthority(postEntryAuthorityInput, "CLAIM"),
          close: assessPostEntryAuthority(postEntryAuthorityInput, "CLOSE"),
          emergencyClose: assessPostEntryAuthority(postEntryAuthorityInput, "EMERGENCY_CLOSE"),
          reconciliation: assessPostEntryAuthority(postEntryAuthorityInput, "RECONCILIATION"),
          monitoring: assessPostEntryAuthority(postEntryAuthorityInput, "MONITORING"),
        },
        openPlanCapacity: {
          approved: openPlanCapacity.approved,
          availableWalletLamports: openPlanCapacity.availableWalletLamports?.toString(),
          reasonCodes: openPlanCapacity.reasonCodes,
        },
        management,
      },
    });
    log.info("operational_cycle_complete", {
      cycleId: result.cycleId,
      cycleStartedAt,
      decisionAt,
      phase3: result.phase3Status,
      phase4: result.phase4Status,
      phase5: result.phase5Status,
      management,
      swapQuote: result.swapQuote?.status ?? "NOT_REQUIRED",
      signing: false,
      submission: false,
    });
    if (
      (
        process.env.LPFORGE_OPERATOR_MACHINE_SUMMARY ?? "false"
      ).toLowerCase() === "true"
    )
      console.log(
        JSON.stringify({
          event: "lpforge_operator_machine_summary",
          cycleId: result.cycleId,
          cycleStartedAt,
          decisionAt,
          phase3: result.phase3Status,
          phase4: result.phase4Status,
          phase5: result.phase5Status,
          management,
          swapQuote: result.swapQuote?.status ?? "NOT_REQUIRED",
          transactionsScanned: transactions.length,
          decodedSwapEvents,
          eventDecodeWarnings,
          signing: false,
          submission: false,
        }),
      );
    console.log(json(result));
    return result;
  } catch (error) {
    await store.upsertRuntimeHeartbeat({
      runtimeId: "lpforge-live-shadow",
      poolAddress: cfg.smokePoolAddress,
      observedAt: new Date().toISOString(),
      status: "FAILED",
      payload: {
        cycleStartedAt,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  } finally {
    await store.close();
  }
}
async function fixtureOnce() {
  const observedAt = "2026-08-12T12:00:00Z";
  const minute = (i: number) =>
    new Date(Date.parse(observedAt) - (180 - i) * 60000).toISOString();
  const market = Array.from({ length: 181 }, (_, i) => ({
    observedAt: minute(i),
    price: 100 + Math.sin(i / 12) * 0.3,
    activeBinId: fixturePool.activeBinId + Math.round(Math.sin(i / 10) * 3),
    volume: 100,
    feeValue: 0.01,
    twoWayRatio: 0.8,
    localLiquidity: 200000,
  }));
  const activeBins = market.map((x) => ({
    observedAt: x.observedAt,
    activeBinId: x.activeBinId,
  }));
  const binFrames = [40, 80, 120, 160].map((i) => ({
    observedAt: minute(i),
    activeBinId: activeBins[i]!.activeBinId,
    bins: fixtureBins.map((b) => ({
      binId: b.binId,
      price: b.price,
      amountX: b.amountX,
      amountY: b.amountY,
      ...(b.liquiditySupply ? { liquiditySupply: b.liquiditySupply } : {}),
    })),
  }));
  const pool = { ...fixturePool, stamp: { ...fixturePool.stamp, observedAt } };
  const result = await evaluateOperationalCycle({
    observedAt,
    pool,
    bins: fixtureBins.map((b) => ({ ...b, stamp: { ...b.stamp, observedAt } })),
    dataApiPool: fixtureDataApiPool,
    history: {
      marketObservations: market,
      activeBins,
      binFrames,
      swapEvents: fixtureSwaps.map((e, i) => ({
        ...e,
        stamp: { ...e.stamp, observedAt: minute(100 + i) },
      })),
    },
    protocolCompatible: true,
    walletCapital: 1,
    qualificationPolicy: phase3QualificationPolicyFromEnvironment(),
  });
  console.log(json(result));
  return result;
}
async function liveRun() {
  const interval = Math.max(
    5000,
    Number(process.env.COLLECT_INTERVAL_MS ?? 30000),
  );
  for (;;) {
    const started = Date.now();
    try {
      await liveOnce();
    } catch (e) {
      console.error(e);
    }
    const wait = Math.max(1000, interval - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
}
const cmd = process.argv[2] ?? "fixture-once";
if (cmd === "fixture-once") await fixtureOnce();
else if (cmd === "live-once") {
  await liveOnce();
  // Phase-7 runs this as a child probe. Governed clients may retain idle
  // handles after the cycle is durable, so let the parent advance explicitly.
  process.exit(0);
}
else if (cmd === "live-run") await liveRun();
else throw new Error("Usage: operator fixture-once|live-once|live-run");
