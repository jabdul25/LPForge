// LPFORGE_PHASE6_MAINNET_MODULE
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
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
import { createMeteoraReadAdapter } from "../../meteora/src/index.js";
import type {
  AutonomousPlan,
  AutonomousPlanAction,
  Phase1Store,
} from "../../db/src/index.js";
import {
  determineRecoveryAction,
  type ExecutionJournal,
} from "../../execution-recovery/src/index.js";

export interface LiveWorkerConfig {
  rpcUrl: string;
  programId: string;
  /** Explicit deployment-policy cap; the SDK must never receive undefined slippage. */
  liquiditySlippageBps: number;
  maxFeeLamports: bigint;
  maxFeeFraction: number;
  simulationFreshnessMs: number;
  riskPermitTtlMs: number;
  confirmPollMs: number;
  confirmAttempts: number;
}
export interface LiveWorkerResult {
  status: "IDLE" | "BLOCKED" | "SUBMITTED" | "RECONCILED" | "UNKNOWN";
  planId?: string;
  reasonCodes: string[];
  transactionSubmitted: boolean;
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
    upper = Number(intent.upperBinId);
  if (capital <= 0n || !Number.isInteger(lower) || !Number.isInteger(upper))
    throw new Error("LPFORGE_P6_PLAN_FIELDS_INVALID");
  return { capital, lower, upper };
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
  state: string,
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
      return true;
    if (confirmation.status === "FAILED" || confirmation.status === "EXPIRED")
      throw new Error(`LPFORGE_P6_CONFIRM_${confirmation.status}`);
  }
  return false;
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
  });
  const pool = await adapter.getPool(input.plan.poolAddress);
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
    risk = governExecutionRisk(
      {
        action: "OPEN",
        planId: `${input.plan.planId}:swap`,
        now: new Date().toISOString(),
        thesisExpiresAt: input.plan.expiresAt,
        planExpiresAt: input.plan.expiresAt,
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
        maxActiveBinDriftBins: 100,
        approvalTtlMs: input.config.riskPermitTtlMs,
        allowEmergencyCostOverride: false,
      },
    );
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
  return {
    signature: record.signature,
    tokenMint: pool.tokenXMint,
    pairedTokenAmount: required.toString(),
    fundedAt: new Date().toISOString(),
  };
}
/**
 * Executes an extended PositionV2 open as an ordered durable plan. Every SDK
 * chunk is independently simulated and confirmed before the next one is sent.
 * A post-extension interruption is never retried blindly: the plan remains in
 * reconciliation-required state with its exact completed step/signature.
 */
async function executeChunkableAutonomousOpen(input:{store:Phase1Store;plan:AutonomousOpenPlan;signer:MainnetSignerBackend;config:LiveWorkerConfig;connection:Connection;pool:MeteoraOpenAddPoolLike;prepared:PreparedAutonomousOpen;capital:bigint;lower:number;upper:number}):Promise<LiveWorkerResult>{
  let submittedAny=false,lastSignature='',completedSteps:Array<{transactionId:string;signature:string;estimatedFeeLamports:bigint}>=[];
  try{
    for(const step of input.prepared.steps){
      const simulatedAt=new Date().toISOString(),simulation=await simulateExecutionTransaction({authority:authority('MAINNET_BUILD_SIMULATE',simulatedAt,input.config.riskPermitTtlMs),transactionId:step.transactionId,transaction:step.transaction,transport:createWeb3SimulationTransport(input.connection),simulatedAt,freshnessMs:input.config.simulationFreshnessMs});
      await input.store.insertExecutionSimulation({transactionId:step.transactionId,simulatedAt:simulation.simulatedAt,freshUntil:simulation.simulationFreshUntil,ok:simulation.ok,...(simulation.unitsConsumed!==undefined?{unitsConsumed:simulation.unitsConsumed}:{}),logs:simulation.logs,...(simulation.error?{error:simulation.error}:{}),payload:{planId:input.plan.planId,positionAddress:input.prepared.positionSigner.publicKeyAddress,operation:step.kind,chunked:true}});
      const fee=estimateExecutionFee({signatureCount:step.requiredSignerAddresses.length,computeUnitLimit:simulation.recommendedComputeUnitLimit??0,computeUnitPriceMicroLamports:0n}),cost=assessExecutionCost(fee,input.capital,{maxAbsoluteFeeLamports:input.config.maxFeeLamports,maxFeeFractionOfCapital:input.config.maxFeeFraction}),risk=governExecutionRisk({action:'OPEN',planId:input.plan.planId,now:new Date().toISOString(),thesisExpiresAt:input.plan.expiresAt,planExpiresAt:input.plan.expiresAt,simulationOk:simulation.ok,simulationFreshUntil:simulation.simulationFreshUntil,walletTruthConsistent:true,protocolCompatible:true,rpcHealthy:true,referenceDivergenceBps:0,activeBinId:input.lower,intendedCenterBinId:input.lower,costApproved:cost.approved,reconciliationRequired:false,globalKillSwitch:false,liquidityCollapse:false},{maxReferenceDivergenceBps:100,maxActiveBinDriftBins:100000,approvalTtlMs:input.config.riskPermitTtlMs,allowEmergencyCostOverride:false});
      if(risk.decision!=='APPROVE'||!risk.permitId||!risk.expiresAt)throw new Error(`LPFORGE_P6_CHUNK_SIMULATE_RISK:${risk.reasonCodes.join(',')}`);
      await input.store.insertExecutionRiskPermit({permitId:`${risk.permitId}:${step.transactionId}`,planId:input.plan.planId,decision:risk.decision,issuedAt:risk.issuedAt,expiresAt:risk.expiresAt,reasonCodes:risk.reasonCodes,payload:{autonomous:true,transactionId:step.transactionId,chunked:true,feeLamports:fee.totalFeeLamports.toString()}});
      const latest=await input.connection.getLatestBlockhash('confirmed');step.transaction.recentBlockhash=latest.blockhash;step.transaction.lastValidBlockHeight=latest.lastValidBlockHeight;step.transaction.feePayer=new PublicKey(input.plan.ownerAddress);const submittedAt=new Date().toISOString(),openTicket=ticket(input.plan as unknown as AutonomousPlan,input.capital,submittedAt,input.config.riskPermitTtlMs),openAuthority={phase:'P6' as const,cluster:'mainnet-beta' as const,level:'MAINNET_CANARY_OPEN' as const,liveExecution:true,canaryOnly:true,issuedAt:submittedAt,expiresAt:openTicket.expiresAt,ticketId:openTicket.ticketId,reasonCodes:['P6_AUTONOMOUS_CHUNK_FINAL_REVALIDATION',step.kind]};
      const submitted=await executeMainnetCanaryOpen({authority:openAuthority,ticket:openTicket,transactionId:step.transactionId,idempotencyKey:`${input.plan.idempotencyKey}:${step.transactionId}`,requiredSignerAddresses:step.requiredSignerAddresses,backend:input.signer,auxiliaryBackends:auxiliaryPositionSignersForOpenStep(step,input.prepared.positionSigner),envelope:step.envelope,phase5RiskDecision:risk,lease:latest,ledger:ledger(input.store),transport:createWeb3SubmissionTransport(input.connection),submittedAt});submittedAny=true;lastSignature=submitted.signature;await recordJournal(input.store,input.plan as unknown as AutonomousPlan,'SUBMITTED',{action:'OPEN',transactionId:step.transactionId,positionAddress:input.prepared.positionSigner.publicKeyAddress,chunked:true,step:step.metadata},submitted.signature);
      let confirmed=false;for(let attempt=0;attempt<input.config.confirmAttempts;attempt++){await new Promise(resolve=>setTimeout(resolve,input.config.confirmPollMs));const confirmation=await observeConfirmation({attemptId:`${step.transactionId}:attempt:1`,record:{transactionId:step.transactionId,signature:submitted.signature,submittedAt,blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight,attempt:1},transport:createWeb3SubmissionTransport(input.connection),ledger:ledger(input.store),observedAt:new Date().toISOString()});if(confirmation.status==='CONFIRMED'||confirmation.status==='FINALIZED'){confirmed=true;break;}if(confirmation.status==='FAILED'||confirmation.status==='EXPIRED')throw new Error(`LPFORGE_P6_CHUNK_CONFIRM_${confirmation.status}`);}if(!confirmed)throw new Error('LPFORGE_P6_CHUNK_CONFIRMATION_PENDING');completedSteps.push({transactionId:step.transactionId,signature:submitted.signature,estimatedFeeLamports:fee.totalFeeLamports});
    }
    const position=await input.pool.getPosition?.(new PublicKey(input.prepared.positionSigner.publicKeyAddress));if(!position)throw new Error('LPFORGE_P6_POSITION_RECONCILIATION_MISSING');const intent=input.plan.planPayload.intent as Record<string,unknown>,funding=input.plan.intentPayload.entryFunding as Record<string,unknown>;await input.store.insertExecutionReconciliation({reconciliationId:`${input.plan.planId}:open`,planId:input.plan.planId,observedAt:new Date().toISOString(),status:'MATCH',expected:{owner:input.plan.ownerAddress,pool:input.plan.poolAddress,lowerBinId:input.lower,upperBinId:input.upper},actual:{positionAddress:input.prepared.positionSigner.publicKeyAddress},discrepancies:[],payload:{signature:lastSignature,autonomous:true,chunked:true}});await input.store.upsertOwnedPosition({lpforgePositionId:`position-${input.prepared.positionSigner.publicKeyAddress}`,poolAddress:input.plan.poolAddress,positionAddress:input.prepared.positionSigner.publicKeyAddress,ownerAddress:input.plan.ownerAddress,strategy:String(intent.strategy??'SPOT'),orientation:String(funding.orientation??'ONE_SIDED_Y'),lowerBinId:input.lower,upperBinId:input.upper,activeBinAtEntry:Number(intent.activeBinId??input.lower),initialCapitalLamports:input.capital,entryPlanId:input.plan.planId,entrySignature:lastSignature,enteredAt:new Date().toISOString(),lifecycleState:'OPEN',lastPlanId:input.plan.planId,reconciliationStatus:'MATCH',payload:{thesisId:input.plan.thesisId,entryFunding:funding,chunked:true}});const positionAccount=await input.connection.getAccountInfo(new PublicKey(input.prepared.positionSigner.publicKeyAddress),'confirmed');await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:open-contribution`,positionAddress:input.prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'OPEN_CONTRIBUTION',observedAt:new Date().toISOString(),lamports:input.capital,payload:{signature:lastSignature,source:'RECONCILED_CHUNKABLE_OPEN'}});if(positionAccount?.lamports)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:rent-lock`,positionAddress:input.prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'RENT_LOCK',observedAt:new Date().toISOString(),lamports:BigInt(positionAccount.lamports),payload:{signature:lastSignature,recoverable:true,source:'POSITION_ACCOUNT_INFO'}});for(const child of completedSteps){const actualFee=await confirmedTransactionFeeLamports(input.connection,child.signature);await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:tx-cost:${child.transactionId}`,positionAddress:input.prepared.positionSigner.publicKeyAddress,planId:input.plan.planId,flowType:'TX_COST',observedAt:new Date().toISOString(),lamports:actualFee??child.estimatedFeeLamports,payload:{signature:child.signature,transactionId:child.transactionId,source:actualFee===undefined?'EXECUTION_FEE_ESTIMATE':'CHAIN_RECEIPT_META',...(actualFee===undefined?{estimatedLamports:child.estimatedFeeLamports.toString()}:{})}});}await input.store.completeAutonomousPlan({planId:input.plan.planId,state:'RECONCILED',at:new Date().toISOString(),payload:{signature:lastSignature,positionAddress:input.prepared.positionSigner.publicKeyAddress,chunked:true}});return{status:'RECONCILED',planId:input.plan.planId,reasonCodes:[],transactionSubmitted:true};
  }catch(error){const reason=error instanceof Error?error.message:'LPFORGE_P6_CHUNKABLE_OPEN_UNKNOWN';if(submittedAny){await input.store.transitionAutonomousPlan({planId:input.plan.planId,state:'RECONCILIATION_REQUIRED',at:new Date().toISOString(),reasonCodes:['P6_CHUNKABLE_OPEN_RECONCILIATION_REQUIRED',reason],payload:{stage:'CHUNKABLE_OPEN',error:reason,positionAddress:input.prepared.positionSigner.publicKeyAddress,lastSignature}});return{status:'UNKNOWN',planId:input.plan.planId,reasonCodes:['P6_CHUNKABLE_OPEN_RECONCILIATION_REQUIRED',reason],transactionSubmitted:true};}await input.store.completeAutonomousPlan({planId:input.plan.planId,state:'BLOCKED',at:new Date().toISOString(),payload:{stage:'CHUNKABLE_OPEN',error:reason}});return{status:'BLOCKED',planId:input.plan.planId,reasonCodes:[reason],transactionSubmitted:false};}
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
  // A signature that has left the wallet means the position may exist on-chain
  // even if post-submit bookkeeping fails; recovery must adopt, never resend.
  let submittedAny = false,
    lastSignature = "",
    openPositionAddress = "";
  try {
    if (input.signer.publicKeyAddress !== input.plan.ownerAddress)
      throw new Error("LPFORGE_P6_OWNER_SIGNER_PLAN_MISMATCH");
    const connection = new Connection(input.config.rpcUrl, "confirmed");
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
        walletTruth: { refreshRequired: true },
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
        capital: fields.capital,
        lower: fields.lower,
        upper: fields.upper,
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
    const risk = governExecutionRisk(
      {
        action: "OPEN",
        planId: input.plan.planId,
        now: new Date().toISOString(),
        thesisExpiresAt: input.plan.expiresAt,
        planExpiresAt: input.plan.expiresAt,
        simulationOk: simulation.ok,
        simulationFreshUntil: simulation.simulationFreshUntil,
        walletTruthConsistent: true,
        protocolCompatible: true,
        rpcHealthy: true,
        referenceDivergenceBps: 0,
        activeBinId: fields.lower,
        intendedCenterBinId: fields.lower,
        costApproved: cost.approved,
        reconciliationRequired: false,
        globalKillSwitch: false,
        liquidityCollapse: false,
      },
      {
        maxReferenceDivergenceBps: 100,
        maxActiveBinDriftBins: 100000,
        approvalTtlMs: input.config.riskPermitTtlMs,
        allowEmergencyCostOverride: false,
      },
    );
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
        if (input.plan.swapTransactionId)
          await input.store.upsertPartialEntryRecovery({
            planId: input.plan.planId,
            poolAddress: input.plan.poolAddress,
            ownerAddress: input.plan.ownerAddress,
            tokenMint: String(funding.tokenMint ?? ""),
            fundingTransactionId: input.plan.swapTransactionId,
            fundingSignature: "confirmed",
            fundedAt: new Date().toISOString(),
            pairedTokenAmount: String(funding.totalPairedTokenRaw ?? "0"),
            intendedCapitalLamports: fields.capital,
            intendedRange: {
              lowerBinId: fields.lower,
              upperBinId: fields.upper,
              strategy: intent.strategy,
            },
            state: "RESOLVED",
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
        };
      }
      if (
        confirmation.status === "FAILED" ||
        confirmation.status === "EXPIRED"
      ) {
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
  stage: "PARTIAL_ENTRY_UNWIND" | "CLOSE_TOKEN_X_UNWIND";
  reasonPrefix: "P6_PARTIAL_UNWIND" | "P6_CLOSE_UNWIND";
  fundingTransactionId?: string;
  afterSubmit?: (submitted: { signature: string }) => Promise<void>;
}): Promise<{ ok: boolean; submitted: boolean; reasonCodes: string[] }> {
  const connection = new Connection(input.config.rpcUrl, "confirmed"),
    adapter = createMeteoraReadAdapter({
      rpcUrl: input.config.rpcUrl,
      cluster: "mainnet-beta",
      programId: input.config.programId,
    }),
    pool = await adapter.getPool(input.plan.poolAddress),
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
  if(input.plan.positionAddress){
    const actualFee=await confirmedTransactionFeeLamports(connection,record.signature);
    await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:tx-cost:${input.transactionId}`,positionAddress:input.plan.positionAddress,planId:input.plan.planId,flowType:'TX_COST',observedAt:new Date().toISOString(),lamports:actualFee??fee.totalFeeLamports,payload:{signature:record.signature,transactionId:input.transactionId,source:actualFee===undefined?'EXECUTION_FEE_ESTIMATE':'CHAIN_RECEIPT_META',...(actualFee===undefined?{estimatedLamports:fee.totalFeeLamports.toString()}:{})}});
  }
  return {
    ok: true,
    submitted: true,
    reasonCodes: [`${input.reasonPrefix}_RECONCILED`],
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
    // A funded OPEN can finish reconciliation after an earlier failure wrote a
    // recovery row.  Reconciled chain truth wins: retaining UNWIND_REQUIRED in
    // that case would incorrectly strand the worker (or later unwind a live
    // LP position).  This is deliberately limited to a reconciled OPEN plan.
    const plan = await input.store.loadAutonomousPlan(planId);
    if (plan?.action === "OPEN" && plan.state === "RECONCILED") {
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
        state: "RESOLVED",
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
          await new Connection(input.config.rpcUrl, "confirmed").getSignatureStatuses(
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
        state: "RESOLVED",
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
        state: unwind.ok ? "RESOLVED" : unwind.submitted ? "UNWIND_SUBMITTED" : "UNWIND_REQUIRED",
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
    const connection = new Connection(input.config.rpcUrl, "confirmed"),
      adapter = createMeteoraReadAdapter({
        rpcUrl: input.config.rpcUrl,
        cluster: "mainnet-beta",
        programId: input.config.programId,
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
        state: "RESOLVED",
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
  try{
    const receipt=await connection.getTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});
    const fee=receipt?.meta?.fee;
    return typeof fee==='number'&&Number.isSafeInteger(fee)&&fee>=0?BigInt(fee):undefined;
  }catch{return undefined;}
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
    connection = new Connection(input.config.rpcUrl, "confirmed"),
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
    const fee = estimateExecutionFee({
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
          planExpiresAt: input.plan.expiresAt,
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
    if (
      !(await awaitConfirmation({
        connection,
        store: input.store,
        transactionId,
        idempotencyKey: input.plan.idempotencyKey,
        signature: submitted.signature,
        lease,
        pollMs: input.config.confirmPollMs,
        attempts: input.config.confirmAttempts,
      }))
    )
      return {
        status: "SUBMITTED",
        planId: input.plan.planId,
        reasonCodes: ["P6_CONFIRMATION_PENDING"],
        transactionSubmitted: true,
      };
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
  const remove = input.plan.steps.find((step) => step.kind === "METEORA_CLOSE");
  const open = input.plan.steps.find((step) => step.kind === "METEORA_OPEN");
  if (!remove || !open)
    throw new Error("LPFORGE_P6_MANAGEMENT_SEQUENCE_MISSING");
  const adapter = createMeteoraReadAdapter({
    rpcUrl: input.config.rpcUrl,
    cluster: "mainnet-beta",
    programId: input.config.programId,
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
  const removalConnection = new Connection(input.config.rpcUrl, "confirmed");
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
  const connection = new Connection(input.config.rpcUrl, "confirmed");
  const poolFact = await adapter.getPool(input.plan.poolAddress);
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
    payload: { stage: "REFRESH_WALLET_TRUTH", walletTruth },
  });
  await input.store.transitionAutonomousPlan({
    planId: input.plan.planId,
    state: "RECONCILING",
    at: new Date().toISOString(),
    payload: {
      stage: "BUILD_REPLACEMENT",
      walletTruth,
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
        totalPairedTokenRaw: old.totalXAmount,
        solForLpLamports: old.totalYAmount,
        orientation: String(
          input.plan.intentPayload.orientation ?? "REDEPLOYED",
        ),
        rebuildFromRemovedPosition: true,
      },
    },
    planPayload: { ...input.plan.planPayload, intent },
    transactionId: open.transactionId,
    transactionMetadata: open.metadata,
  };
  return executeAutonomousOpen({
    store: input.store,
    plan: replacement,
    signer: input.signer,
    config: input.config,
  });
}

type CloseSettlementStage =
  | "CLOSE_INVENTORY_SNAPSHOTTED"
  | "CLOSE_LIQUIDITY_REMOVED"
  | "CLOSE_CLAIMS_SETTLED"
  | "CLOSE_INVENTORY_MEASURED"
  | "CLOSE_INVENTORY_UNWOUND";

type CloseSettlementPendingStage =
  | "CLOSE_REMOVE_SUBMITTED"
  | "CLOSE_CLAIM_SUBMITTED"
  | "CLOSE_UNWIND_SUBMITTED"
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
    ["CLOSE_REMOVE_SUBMITTED", "CLOSE_CLAIM_SUBMITTED", "CLOSE_UNWIND_SUBMITTED", "CLOSE_POSITION_SUBMITTED"].includes(stage)
    ? { stage: stage as CloseSettlementPendingStage, signature }
    : undefined;
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

  const connection = new Connection(input.config.rpcUrl, "confirmed"),
    poolFact = await createMeteoraReadAdapter({
      rpcUrl: input.config.rpcUrl,
      cluster: "mainnet-beta",
      programId: input.config.programId,
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
    await persist(
      "CLOSE_INVENTORY_SNAPSHOTTED",
      { tokenXBefore: tokenXBefore.toString(),tokenYBefore: tokenYBefore.toString() },
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
    // Do not book token-X as a realized withdrawal here: when it is unwound
    // below, the economically realized amount is Jupiter's actual token-Y
    // output. Recording both would overstate close PnL.
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
    let swapProceedsY=0n;
    if (attributableTokenX > 0n) {
      const tokenYBeforeUnwind=await readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:poolFact.tokenYMint});
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
      const tokenYPostUnwind=await readWalletTokenBalance({connection,ownerAddress:input.plan.ownerAddress,mint:poolFact.tokenYMint});
      swapProceedsY=tokenYPostUnwind>tokenYBeforeUnwind?tokenYPostUnwind-tokenYBeforeUnwind:0n;
      if(swapProceedsY<=0n)return incomplete(['P6_CLOSE_UNWIND_OUTPUT_MISSING'],"CLOSE_UNWIND_OUTPUT_UNKNOWN");
      await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:close-swap-proceeds-y`,positionAddress:input.positionAddress,planId:input.plan.planId,flowType:'SWAP_PROCEEDS',observedAt:new Date().toISOString(),tokenMint:poolFact.tokenYMint,tokenAmountRaw:swapProceedsY.toString(),payload:{source:'JUPITER_WALLET_DELTA',inputMint:poolFact.tokenXMint,inputAmountRaw:attributableTokenX.toString(),tokenYBeforeUnwind:tokenYBeforeUnwind.toString(),tokenYAfterUnwind:tokenYPostUnwind.toString()}});
    }
    await persist("CLOSE_INVENTORY_UNWOUND", {
      tokenXBefore: tokenXBefore.toString(),
      tokenYBefore: tokenYBefore.toString(),
      attributableTokenX: attributableTokenX.toString(),
      attributableTokenY:attributableTokenY?.toString()??"0",
      unwindTransactionId: unwindStep.transactionId,
      swapProceedsY:swapProceedsY.toString(),
    });
    stage = "CLOSE_INVENTORY_UNWOUND";
  }

  if (stage !== "CLOSE_INVENTORY_UNWOUND")
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
  });
  return closed.status === "RECONCILED" ? closed : incomplete(closed.reasonCodes, "CLOSE_POSITION_PENDING");
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
  const step = input.plan.steps[0];
  if (!step) throw new Error("LPFORGE_P6_MUTATION_STEP_REQUIRED");
  if (input.plan.action === "CLAIM") {
    const claimConnection=new Connection(input.config.rpcUrl,"confirmed"),claimPoolFact=await createMeteoraReadAdapter({rpcUrl:input.config.rpcUrl,cluster:"mainnet-beta",programId:input.config.programId}).getPool(input.plan.poolAddress),claimBeforeX=await readWalletTokenBalance({connection:claimConnection,ownerAddress:input.plan.ownerAddress,mint:claimPoolFact.tokenXMint}),claimBeforeY=await readWalletTokenBalance({connection:claimConnection,ownerAddress:input.plan.ownerAddress,mint:claimPoolFact.tokenYMint});
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
      afterConfirmed: async()=>{
      const afterX=await readWalletTokenBalance({connection:claimConnection,ownerAddress:input.plan.ownerAddress,mint:claimPoolFact.tokenXMint}),afterY=await readWalletTokenBalance({connection:claimConnection,ownerAddress:input.plan.ownerAddress,mint:claimPoolFact.tokenYMint}),observedAt=new Date().toISOString();
      if(afterX>claimBeforeX)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:claim-x`,positionAddress,planId:input.plan.planId,flowType:'FEE_CLAIM',observedAt,tokenMint:claimPoolFact.tokenXMint,tokenAmountRaw:(afterX-claimBeforeX).toString(),payload:{source:'WALLET_DELTA'}});
      if(afterY>claimBeforeY)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:claim-y`,positionAddress,planId:input.plan.planId,flowType:'FEE_CLAIM',observedAt,tokenMint:claimPoolFact.tokenYMint,tokenAmountRaw:(afterY-claimBeforeY).toString(),payload:{source:'WALLET_DELTA'}});
      },
    });
  }
  if (input.plan.action === "REDUCE") {
    const reductionConnection=new Connection(input.config.rpcUrl,"confirmed"),reductionPoolFact=await createMeteoraReadAdapter({rpcUrl:input.config.rpcUrl,cluster:"mainnet-beta",programId:input.config.programId}).getPool(input.plan.poolAddress),reductionBeforeX=await readWalletTokenBalance({connection:reductionConnection,ownerAddress:input.plan.ownerAddress,mint:reductionPoolFact.tokenXMint}),reductionBeforeY=await readWalletTokenBalance({connection:reductionConnection,ownerAddress:input.plan.ownerAddress,mint:reductionPoolFact.tokenYMint}),range = await chainMutationRange({
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
      afterConfirmed: async()=>{
        const afterX=await readWalletTokenBalance({connection:reductionConnection,ownerAddress:input.plan.ownerAddress,mint:reductionPoolFact.tokenXMint}),afterY=await readWalletTokenBalance({connection:reductionConnection,ownerAddress:input.plan.ownerAddress,mint:reductionPoolFact.tokenYMint}),observedAt=new Date().toISOString();
        if(afterX>reductionBeforeX)await input.store.insertPositionCashflow({cashflowId:`${input.plan.planId}:reduce-x`,positionAddress,planId:input.plan.planId,flowType:'REDUCE_WITHDRAWAL',observedAt,tokenMint:reductionPoolFact.tokenXMint,tokenAmountRaw:(afterX-reductionBeforeX).toString(),payload:{source:'WALLET_DELTA'}});
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
  /** Test seam; production uses the RPC connection below. */
  signatureStatusProvider?: (
    signature: string,
  ) => Promise<{ err: unknown; confirmationStatus?: string | null } | null>;
}): Promise<LiveRecoveryResult[]> {
  const plans = await input.store.loadUnresolvedAutonomousPlans(),
    results: LiveRecoveryResult[] = [];
  const connection = input.rpcUrl
    ? new Connection(input.rpcUrl, "confirmed")
    : undefined;
  const adapter =
    input.rpcUrl && input.programId
      ? createMeteoraReadAdapter({
          rpcUrl: input.rpcUrl,
          cluster: "mainnet-beta",
          programId: input.programId,
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
        journal.lastValidBlockHeight !== undefined &&
        input.currentBlockHeight > journal.lastValidBlockHeight
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
    // A child submission is persisted before confirmation.  Its parent stage
    // is deliberately not advanced until chain truth confirms it.  This is
    // what makes a crash between REMOVE/CLAIM/UNWIND stages restartable
    // without resending any already-issued child transaction.
    if (closePending) {
      const settled = confirmationStatus === "CONFIRMED" || confirmationStatus === "FINALIZED";
      if (!settled) {
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
      const completedStage: Record<CloseSettlementPendingStage, CloseSettlementStage | undefined> = {
        CLOSE_REMOVE_SUBMITTED: "CLOSE_LIQUIDITY_REMOVED",
        CLOSE_CLAIM_SUBMITTED: "CLOSE_CLAIMS_SETTLED",
        CLOSE_UNWIND_SUBMITTED: "CLOSE_INVENTORY_UNWOUND",
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
        await input.store.markOwnedPositionLifecycle({ positionAddress: recoveryPositionAddress, lifecycleState: "CLOSED", reconciliationStatus: "MATCH", lastPlanId: plan.planId, at: input.now, payload: { stage: "CLOSE_CHAIN_VERIFIED", signature: closePending.signature } });
        await input.store.completeAutonomousPlan({ planId: plan.planId, state: "COMPLETED", at: input.now, payload: { action: plan.action, signature: closePending.signature, recovery: "CLOSE_POSITION_CONFIRMED" } });
        results.push({ planId: plan.planId, action: "MARK_RECONCILED", reasonCodes: ["P6_CLOSE_POSITION_RECOVERED"] });
      } else {
        await input.store.transitionAutonomousPlan({ planId: plan.planId, state: "RECONCILIATION_REQUIRED", at: input.now, reasonCodes: ["P6_CLOSE_POSITION_ABSENCE_UNPROVEN"], payload: { pendingStage: closePending.stage, pendingSignature: closePending.signature } });
        results.push({ planId: plan.planId, action: "HOLD_FOR_OPERATOR", reasonCodes: ["P6_CLOSE_POSITION_ABSENCE_UNPROVEN"] });
      }
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
      const funding = (plan.intentPayload.entryFunding ?? {}) as Record<
        string,
        unknown
      >;
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
  return results;
}
/**
 * Adopts on-chain positions the owner wallet holds that are absent from the
 * owned-positions registry. Read-only: never signs or submits anything.
 * Adopted rows are created RECONCILIATION_REQUIRED with zero known capital so
 * the standard management loop and production evidence surface them instead of
 * silently ignoring them; the exit governor treats zero-capital rows as
 * UNAVAILABLE and holds.
 */
export async function reconcileOrphanedPositions(input: {
  store: Phase1Store;
  rpcUrl: string;
  programId: string;
  ownerAddress?: string;
  poolAddresses: string[];
  now?: string;
  /** Test seam for on-chain reads. Defaults to the DLMM SDK + Meteora read adapter. */
  positionsProvider?: (
    poolAddress: string,
  ) => Promise<
    Array<{
      positionAddress: string;
      owner: string;
      pool: string;
      lowerBinId: number;
      upperBinId: number;
    }>
  >;
}): Promise<{ adopted: number; reasonCodes: string[] }> {
  const at = input.now ?? new Date().toISOString();
  if (!input.ownerAddress?.trim() || input.poolAddresses.length === 0)
    return { adopted: 0, reasonCodes: [] };
  const ownerAddress = input.ownerAddress.trim();
  const owned = await input.store.loadOwnedPositions(ownerAddress);
  const known = new Set(owned.map((row) => String(row.position_address)));
  const reasonCodes = new Set<string>();
  let adopted = 0;
  let allWalletPositions:
    | Promise<
        Map<
          string,
          { lbPairPositionsData: Array<{ publicKey: { toBase58(): string } }> }
        >
      >
    | undefined;
  const defaultProvider = async (poolAddress: string) => {
    const runtime = await loadMeteoraExecutionRuntime();
    if (typeof runtime.DLMM.getAllLbPairPositionsByUser !== "function")
      throw new Error("LPFORGE_ORPHAN_SWEEP_RUNTIME_UNAVAILABLE");
    const adapter = createMeteoraReadAdapter({
      rpcUrl: input.rpcUrl,
      cluster: "mainnet-beta",
      programId: input.programId,
    });
    allWalletPositions ??= runtime.DLMM.getAllLbPairPositionsByUser(
      new runtime.Connection(input.rpcUrl, "confirmed"),
      new runtime.PublicKey(ownerAddress),
      {
        cluster: "mainnet-beta",
        programId: new runtime.PublicKey(input.programId),
      },
      // Recovery is deliberately low-pressure: a wallet scan is a fallback
      // adoption path, never an execution-critical RPC fan-out.
      { chunkSize: 20, isParallelExecution: false },
    );
    const result = await allWalletPositions;
    const positions = result.get(poolAddress)?.lbPairPositionsData ?? [];
    const facts: Array<{
      positionAddress: string;
      owner: string;
      pool: string;
      lowerBinId: number;
      upperBinId: number;
    }> = [];
    for (const position of positions) {
      try {
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
        });
      } catch {
        // Unreadable position: leave it unknown rather than guess identity.
      }
    }
    return facts;
  };
  const readPoolPositions = input.positionsProvider ?? defaultProvider;
  for (const poolAddress of input.poolAddresses) {
    try {
      for (const fact of await readPoolPositions(poolAddress)) {
        if (known.has(fact.positionAddress)) continue;
        if (fact.owner !== ownerAddress || fact.pool !== poolAddress)
          continue;
        await input.store.upsertOwnedPosition({
          lpforgePositionId: `position-${fact.positionAddress}`,
          poolAddress,
          positionAddress: fact.positionAddress,
          ownerAddress,
          strategy: "SPOT",
          orientation: "UNKNOWN",
          lowerBinId: fact.lowerBinId,
          upperBinId: fact.upperBinId,
          activeBinAtEntry: fact.lowerBinId,
          initialCapitalLamports: 0n,
          enteredAt: at,
          lifecycleState: "RECONCILIATION_REQUIRED",
          reconciliationStatus: "MISMATCH",
          payload: {
            orphanDetected: true,
            reasonCodes: ["P6_ORPHAN_POSITION_DETECTED"],
            lowerBinId: fact.lowerBinId,
            upperBinId: fact.upperBinId,
          },
        });
        known.add(fact.positionAddress);
        adopted++;
        reasonCodes.add("P6_ORPHAN_POSITION_DETECTED");
      }
    } catch (error) {
      // A single pool sweep failure must not disrupt the recovery cycle.
      reasonCodes.add(
        error instanceof Error &&
          error.message === "LPFORGE_ORPHAN_SWEEP_RUNTIME_UNAVAILABLE"
          ? "P6_ORPHAN_SWEEP_RUNTIME_UNAVAILABLE"
          : "P6_ORPHAN_SWEEP_POOL_READ_FAILED",
      );
    }
  }
  return { adopted, reasonCodes: [...reasonCodes] };
}
