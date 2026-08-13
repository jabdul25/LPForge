import { loadPhase1Config } from "../../../packages/config/src/index.js";
import { createMeteoraDataApi } from "../../../packages/data-api/src/index.js";
import {
  createPostgresStore,
  type Phase1Store,
} from "../../../packages/db/src/index.js";
import {
  createMeteoraReadAdapter,
  createSolanaRpcClient,
  scanAddressTransactions,
} from "../../../packages/meteora/src/index.js";
import { Logger } from "../../../packages/observability/src/index.js";
import {
  evaluateOperationalCycle,
  type OperationalCycleResult,
} from "../../../packages/operational-runtime/src/index.js";
import {
  createJupiterSwapQuoteProvider,
  loadAutonomousEntryPolicy,
} from "../../../packages/phase6-swap-quote/src/index.js";
import { buildTransactionPlan } from "../../../packages/transaction-planner/src/index.js";
import type { TransactionPlan } from "../../../packages/execution-contracts/src/index.js";
import {
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

function json(v: unknown) {
  return JSON.stringify(
    v,
    (_, x) => (typeof x === "bigint" ? x.toString() : x),
    2,
  );
}
async function persistTransactionPlan(
  store: Phase1Store,
  plan: TransactionPlan,
) {
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
      },
      intent: {
        capitalLamports: plan.intent.capitalLamports?.toString(),
        lowerBinId: plan.intent.lowerBinId,
        upperBinId: plan.intent.upperBinId,
        strategy: plan.intent.strategy,
      },
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
    thesisId: String(
      ((row.payload as Record<string, unknown>) ?? {}).thesisId ??
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
  let planned = 0;
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
    let economics = { evidenceState: "UNAVAILABLE" as const, observedAt: input.observedAt, reasonCodes: ["EXIT_VALUATION_POOL_DATA_UNAVAILABLE"] };
    if (fact) {
      try {
        const apiPool = await input.api.getPool(position.poolAddress);
        economics = derivePositionEconomics({position: fact, pool: apiPool, initialCapitalLamports: position.initialCapitalLamports, observedAt: input.observedAt}) as typeof economics;
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
    const currentForwardEv=current?.shadow?.economics.expectedNetLpValue;
    const toxicity=current?.poolAssessment.toxicityProbability;
    const liquidityChange=Number(current?.poolAssessment.evidence.recentLiquidityChangePct??0);
    const exitDecision=assessLiveExit({
      policy:exitPolicy,
      economics,
      ...(priorHighWater?{highWater:priorHighWater}:{}),
      thesisStatus,
      ...(typeof currentForwardEv==='number'?{currentForwardEv}:{}),
      ...(current?.risk?{riskDecision:current.risk.decision,riskReasonCodes:current.risk.reasonCodes}:{}),
      ...(typeof toxicity==='number'?{toxicityProbability:toxicity}:{}),
      liquidityCollapse:Number.isFinite(liquidityChange)&&liquidityChange<=-50,
      ...(position.enteredAt&&Number.isFinite(Date.parse(position.enteredAt))?{positionAgeMinutes:Math.max(0,(Date.parse(input.observedAt)-Date.parse(position.enteredAt))/60000)}:{}),
    });
    const decision = decideLivePositionManagement({
      policy,
      owned: position,
      ...(fact ? { position: fact } : {}),
      activeBinId,
      exitDecision,
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
      payload:{peakGivebackFraction:exitDecision.peakGivebackFraction,reasonFamily:exitDecision.reasonFamily,urgency:exitDecision.urgency,forwardEv:currentForwardEv??null,regime:regime??null,toxicity:toxicity??null}
    });
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
      walletTruth: { source: "NOT_REQUIRED_FOR_OBSERVATION" },
      positionTruth: fact ?? { missing: true },
      managementContext: { decision, policy, exitDecision, exitPolicy },
      reconciliationDebt: !fact,
      staleData: false,
      payload: { source: "LPFORGE_PRODUCTION_OWNED_POSITION_MONITOR" },
    });
    if (
      decision.action === "HOLD" ||
      (await input.store.hasActiveAutonomousPlan(position.positionAddress))
    )
      continue;
    const expiresAt = new Date(
        Date.parse(input.observedAt) + policy.planTtlMs,
      ).toISOString(),
      replacement = decision.replacementRange;
    const plan = buildTransactionPlan({
      action: decision.action,
      cluster: "mainnet-beta",
      ownerAddress: position.ownerAddress,
      poolAddress: position.poolAddress,
      positionAddress: position.positionAddress,
      thesisId: position.thesisId,
      observedAt: input.observedAt,
      expiresAt,
      ...(replacement
        ? {
            capitalLamports: position.initialCapitalLamports,
            lowerBinId: replacement.lowerBinId,
            upperBinId: replacement.upperBinId,
            strategy: position.strategy,
            removeLowerBinId: position.lowerBinId,
            removeUpperBinId: position.upperBinId,
          }
        : {}),
      ...(decision.action === "REDUCE" ? { reductionBps: Math.max(1,Math.min(9999,Math.round(exitDecision.reduceFraction*10000))) } : {}),
      metadata: {
        managementReasonCodes: decision.reasonCodes,
        sourcePositionAddress: position.positionAddress,
        orientation: position.orientation,
        entryFunding: { rebuildFromRemovedPosition: true },
        exitGovernor: { reasonFamily: exitDecision.reasonFamily, reasonCodes: exitDecision.reasonCodes, economics: exitDecision.economics, highWater: exitDecision.highWater, peakGivebackFraction: exitDecision.peakGivebackFraction },
      },
    });
    await persistTransactionPlan(input.store, plan);
    planned++;
  }
  return { observed: positions.length, planned };
}
async function persistResult(store: Phase1Store, r: OperationalCycleResult) {
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
      payload: r.shadow as unknown as Record<string, unknown>,
    });
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
  if (r.plan) await persistTransactionPlan(store, r.plan);
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
    },
  });
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
    const [pool, bins] = await Promise.all([
      adapter.getPool(cfg.smokePoolAddress),
      adapter.getBinsAroundActive(cfg.smokePoolAddress, 35),
    ]);
    await store.insertPoolSnapshot(pool);
    await store.insertBins(bins);
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
    await store.insertDataApiPool(
      apiPool as Record<string, unknown>,
      apiObservedAt,
    );
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
    const since = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const history = await store.loadOperationalHistory(
      cfg.smokePoolAddress,
      since,
      2000,
    );
    const decisionAt = new Date().toISOString();
    const economicRow = await store.loadLatestEconomicEstimate(
      cfg.smokePoolAddress,
      decisionAt,
    );
    const economicEvidence = economicRow && String(economicRow.fidelity) === "EVENT_PATH_ESTIMATE"
      ? {
          fidelity: String(economicRow.fidelity),
          effectiveSampleCount: Number(economicRow.effective_sample_count),
          feeRatePerCapitalHour: Number(economicRow.fee_rate_per_capital_hour),
          uncertainty: Number(economicRow.uncertainty),
          evidenceAgeSeconds: Number(economicRow.evidence_age_seconds),
          rawObservationCount: Number(economicRow.raw_observation_count),
          independentEpisodeCount: Number(economicRow.independent_episode_count),
          feeObservationCount: Number(economicRow.fee_observation_count),
          eventPathObservationCount: Number(economicRow.event_path_observation_count),
          sourceHashes: (economicRow.source_hashes ?? {}) as Record<string, unknown>,
        }
      : undefined;
    const priorRegimeAssessments = await store.loadRegimeAssessmentHistory(
      cfg.smokePoolAddress,
      decisionAt,
      120,
    );
    const walletCapital = Number(
      process.env.LPFORGE_SHADOW_WALLET_CAPITAL ?? "1",
    );
    if (!(walletCapital > 0))
      throw new Error("LPFORGE_OPERATOR_INVALID_SHADOW_CAPITAL");
    const entryPolicy = loadAutonomousEntryPolicy(
      process.env.LPFORGE_AUTONOMOUS_ENTRY_POLICY_PATH ??
        "policies/autonomous-entry-policy.json",
    );
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
      ...(economicEvidence ? { economicEvidence } : {}),
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
    await persistResult(store, result);
    const management = await observeAndPlanOwnedPositions({
      store,
      adapter,
      api,
      ownerAddress: process.env.LPFORGE_OPERATOR_OWNER_ADDRESS,
      observedAt: decisionAt,
      currentResult: result,
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
else if (cmd === "live-once") await liveOnce();
else if (cmd === "live-run") await liveRun();
else throw new Error("Usage: operator fixture-once|live-once|live-run");
