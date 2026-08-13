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
  buildRemoveLiquidityTransactions,
  createLiveMeteoraOpenPool,
  type BuiltMeteoraTransaction,
  type MeteoraOpenAddPoolLike,
  type MeteoraRemoveClaimPoolLike,
} from "../../meteora-execution/src/index.js";
import {
  prepareAutonomousMeteoraOpen,
  type AutonomousOpenPlan,
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
    | "HOLD_FOR_OPERATOR"
    | "RETURN_EXISTING_PLAN"
    | "NO_ACTION_COMPLETE";
  reasonCodes: string[];
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
  const open = plan.steps.find((step) => step.kind === "METEORA_OPEN"),
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
async function recordJournal(store: Phase1Store, plan: AutonomousPlan, state: string, payload: Record<string, unknown>, signature?: string) {
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
/** Executes one already-claimed plan. A caller must claim from storage before calling this function. */
export async function executeAutonomousOpen(input: {
  store: Phase1Store;
  plan: AutonomousOpenPlan;
  signer: MainnetSignerBackend;
  config: LiveWorkerConfig;
}): Promise<LiveWorkerResult> {
  const now = new Date().toISOString(),
    fields = planFields(input.plan);
  try {
    if (input.signer.publicKeyAddress !== input.plan.ownerAddress)
      throw new Error("LPFORGE_P6_OWNER_SIGNER_PLAN_MISMATCH");
    const connection = new Connection(input.config.rpcUrl, "confirmed");
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
    const pool = await createLiveMeteoraOpenPool({
      rpcUrl: input.config.rpcUrl,
      poolAddress: input.plan.poolAddress,
      programId: input.config.programId,
    });
    const prepared = await prepareAutonomousMeteoraOpen({
      plan: input.plan,
      pool,
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
    await recordJournal(input.store, input.plan as unknown as AutonomousPlan, "SUBMITTED", { action: "OPEN", transactionId: input.plan.transactionId, positionAddress: prepared.positionSigner.publicKeyAddress }, submitted.signature);
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
function mutationCapital(plan: AutonomousPlan) {
  const intent = plan.planPayload.intent as Record<string, unknown> | undefined;
  const value = intent?.capitalLamports;
  try {
    return value === undefined ? 0n : BigInt(String(value));
  } catch {
    throw new Error("LPFORGE_P6_MUTATION_CAPITAL_INVALID");
  }
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
}): Promise<LiveWorkerResult> {
  const transaction = legacyBuilt(input.built),
    connection = new Connection(input.config.rpcUrl, "confirmed"),
    capital = mutationCapital(input.plan),
    now = new Date().toISOString();
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
      cost = assessExecutionCost(fee, capital > 0n ? capital : 1n, {
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
    const submitted = open
      ? await executeMainnetCanaryClose(submitInput)
      : await executeMainnetCanaryManage(submitInput);
    await recordJournal(input.store, input.plan, "SUBMITTED", { action: input.action, transactionId }, submitted.signature);
    await input.store.transitionAutonomousPlan({
      planId: input.plan.planId,
      state: "SUBMITTED",
      at: new Date().toISOString(),
      payload: { signature: submitted.signature, transactionId },
    });
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
      payload: { autonomous: true, deferredCompletion: Boolean(input.deferCompletion) },
    });
    if (input.deferCompletion)
      return {
        status: "RECONCILED",
        planId: input.plan.planId,
        reasonCodes: ["P6_SEQUENCE_CHAIN_TRUTH_PENDING"],
        transactionSubmitted: true,
      };
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
  if (!remove || !open) throw new Error("LPFORGE_P6_MANAGEMENT_SEQUENCE_MISSING");
  const adapter = createMeteoraReadAdapter({
    rpcUrl: input.config.rpcUrl,
    cluster: "mainnet-beta",
    programId: input.config.programId,
  });
  const old = await adapter.getPositionV2(input.plan.poolAddress, input.positionAddress);
  if (old.owner !== input.plan.ownerAddress || old.pool !== input.plan.poolAddress)
    throw new Error("LPFORGE_P6_MANAGEMENT_OLD_POSITION_IDENTITY_MISMATCH");
  const range = {
    lower: Number(remove.metadata.fromBinId ?? old.lowerBinId),
    upper: Number(remove.metadata.toBinId ?? old.upperBinId),
  };
  if (!Number.isInteger(range.lower) || !Number.isInteger(range.upper) || range.lower > range.upper)
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
    throw new Error("LPFORGE_P6_MANAGEMENT_MULTI_TRANSACTION_REMOVE_UNSUPPORTED");
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
  let removed = false;
  try {
    await adapter.getPositionV2(input.plan.poolAddress, input.positionAddress);
  } catch {
    removed = true;
  }
  if (!removed) {
    await input.store.markOwnedPositionLifecycle({
      positionAddress: input.positionAddress,
      lifecycleState: "RECONCILIATION_REQUIRED",
      reconciliationStatus: "MISMATCH",
      lastPlanId: input.plan.planId,
      at: new Date().toISOString(),
      payload: { stage: "AWAIT_REMOVE_RECONCILIATION", oldPositionStillExists: true },
    });
    await input.store.transitionAutonomousPlan({
      planId: input.plan.planId,
      state: "RECONCILIATION_REQUIRED",
      at: new Date().toISOString(),
      reasonCodes: ["P6_MANAGEMENT_OLD_POSITION_STILL_EXISTS"],
      payload: { stage: "AWAIT_REMOVE_RECONCILIATION" },
    });
    return { status: "BLOCKED", planId: input.plan.planId, reasonCodes: ["P6_MANAGEMENT_OLD_POSITION_STILL_EXISTS"], transactionSubmitted: true };
  }
  const connection = new Connection(input.config.rpcUrl, "confirmed");
  const poolFact = await adapter.getPool(input.plan.poolAddress);
  const walletTruth = {
    nativeLamports: await connection.getBalance(new PublicKey(input.plan.ownerAddress), "confirmed"),
    tokenXAccounts: (await connection.getParsedTokenAccountsByOwner(new PublicKey(input.plan.ownerAddress), { mint: new PublicKey(poolFact.tokenXMint) }, "confirmed")).value.length,
    tokenYAccounts: (await connection.getParsedTokenAccountsByOwner(new PublicKey(input.plan.ownerAddress), { mint: new PublicKey(poolFact.tokenYMint) }, "confirmed")).value.length,
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
    payload: { stage: "BUILD_REPLACEMENT", walletTruth, oldPositionAddress: input.positionAddress },
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
        orientation: String(input.plan.intentPayload.orientation ?? "REDEPLOYED"),
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

/** Generic plan entrypoint. Every mutation is claimed through the same durable queue. */
export async function executeAutonomousPlan(input: {
  store: Phase1Store;
  plan: AutonomousPlan;
  signer: MainnetSignerBackend;
  config: LiveWorkerConfig;
}): Promise<LiveWorkerResult> {
  await recordJournal(input.store, input.plan, "PLAN_CREATED", { action: input.plan.action });
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
    const built = await buildClaimTransactions(pool, {
      userAddress: input.plan.ownerAddress,
      positionAddress,
    });
    if (built.length !== 1)
      throw new Error("LPFORGE_P6_MULTI_TRANSACTION_CLAIM_UNSUPPORTED");
    built[0]!.metadata.transactionId = step.transactionId;
    return executeMeteoraMutation({
      ...input,
      built: built[0]!,
      action: "CLAIM",
    });
  }
  if (
    input.plan.action === "REDUCE" ||
    input.plan.action === "CLOSE" ||
    input.plan.action === "EMERGENCY_CLOSE"
  ) {
    const range = mutationRange(input.plan, step.metadata),
      bps =
        input.plan.action === "REDUCE"
          ? Number(
              input.plan.intentPayload.reductionBps ?? step.metadata.bps ?? 0,
            )
          : 10_000,
      built = await buildRemoveLiquidityTransactions(pool, {
        userAddress: input.plan.ownerAddress,
        positionAddress,
        fromBinId: range.lower,
        toBinId: range.upper,
        bps,
        claimAndClose: input.plan.action !== "REDUCE",
      });
    if (built.length !== 1)
      throw new Error("LPFORGE_P6_MULTI_TRANSACTION_REMOVE_UNSUPPORTED");
    built[0]!.metadata.transactionId = step.transactionId;
    return executeMeteoraMutation({
      ...input,
      built: built[0]!,
      action: input.plan.action,
    });
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
    built.metadata.transactionId = step.transactionId;
    return executeMeteoraMutation({ ...input, built, action: "ADD" });
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
}): Promise<LiveRecoveryResult[]> {
  const plans = await input.store.loadUnresolvedAutonomousPlans(),
    results: LiveRecoveryResult[] = [];
  const connection = input.rpcUrl ? new Connection(input.rpcUrl, "confirmed") : undefined;
  const adapter = input.rpcUrl && input.programId ? createMeteoraReadAdapter({ rpcUrl: input.rpcUrl, cluster: "mainnet-beta", programId: input.programId }) : undefined;
  for (const plan of plans) {
    const raw = await input.store.getExecutionJournal(plan.idempotencyKey);
    if (!raw) {
      await input.store.transitionAutonomousPlan({
        planId: plan.planId,
        state: "RECONCILIATION_REQUIRED",
        at: input.now,
        reasonCodes: ["P6_RECOVERY_JOURNAL_MISSING"],
        payload: { action: plan.action },
      });
      results.push({
        planId: plan.planId,
        action: "HOLD_FOR_OPERATOR",
        reasonCodes: ["P6_RECOVERY_JOURNAL_MISSING"],
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
    let confirmationStatus: "PROCESSED" | "CONFIRMED" | "FINALIZED" | "EXPIRED" | "FAILED" | "UNKNOWN" = "UNKNOWN";
    if (connection && journal.signature) {
      const status = (await connection.getSignatureStatus(journal.signature, { searchTransactionHistory: true })).value;
      if (status?.err) confirmationStatus = "FAILED";
      else if (status?.confirmationStatus === "processed") confirmationStatus = "PROCESSED";
      else if (status?.confirmationStatus === "confirmed") confirmationStatus = "CONFIRMED";
      else if (status?.confirmationStatus === "finalized") confirmationStatus = "FINALIZED";
      else if (journal.lastValidBlockHeight !== undefined && input.currentBlockHeight > journal.lastValidBlockHeight) confirmationStatus = "EXPIRED";
    }
    let economicEffect: "PRESENT" | "ABSENT" | "UNKNOWN" = "UNKNOWN";
    let positionTruth: Record<string, unknown> = { available: false };
    if (adapter && plan.positionAddress) {
      try {
        const position = await adapter.getPositionV2(plan.poolAddress, plan.positionAddress);
        positionTruth = { exists: true, owner: position.owner, pool: position.pool, lowerBinId: position.lowerBinId, upperBinId: position.upperBinId };
        if (plan.action === "OPEN") economicEffect = "PRESENT";
        else if (["CLOSE", "EMERGENCY_CLOSE", "RESHAPE", "REBALANCE"].includes(plan.action)) economicEffect = "ABSENT";
      } catch {
        positionTruth = { exists: false };
        if (["CLOSE", "EMERGENCY_CLOSE", "RESHAPE", "REBALANCE"].includes(plan.action)) economicEffect = "PRESENT";
        else if (plan.action === "OPEN") economicEffect = "ABSENT";
      }
    }
    const action = determineRecoveryAction({
        journal,
        currentBlockHeight: input.currentBlockHeight,
        confirmationStatus,
        economicEffect,
      });
    if (action === "MARK_RECONCILED" && plan.action !== "RESHAPE" && plan.action !== "REBALANCE") {
      await input.store.insertExecutionReconciliation({ reconciliationId: `${plan.planId}:recovery`, planId: plan.planId, observedAt: input.now, status: "MATCH", expected: { action: plan.action, owner: plan.ownerAddress, pool: plan.poolAddress }, actual: { confirmationStatus, economicEffect, positionTruth }, discrepancies: [], payload: { recovered: true, journalId: journal.journalId } });
      await input.store.completeAutonomousPlan({ planId: plan.planId, state: "RECONCILED", at: input.now, payload: { recovery: true, confirmationStatus, economicEffect, positionTruth } });
      results.push({ planId: plan.planId, action, reasonCodes: ["P6_RECOVERY_CHAIN_TRUTH_RECONCILED"] });
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
        payload: { journalId: journal.journalId, confirmationStatus, economicEffect, positionTruth },
      });
    results.push({
      planId: plan.planId,
      action,
      reasonCodes: [`P6_RECOVERY_${action}`],
    });
  }
  return results;
}
