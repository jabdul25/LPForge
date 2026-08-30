// LPFORGE_PHASE6_MAINNET_MODULE
import {
  createLocalPrivateKeySigner,
  type MainnetSignerBackend,
} from "../../../packages/phase6-mainnet-signer/src/index.js";
import {
  assertCapitalDeploymentAuthorized,
  evaluatePhase6LivePathAuthorization,
  loadPhase6LiveAuthorizationConfig,
} from "../../../packages/phase6-operational-gates/src/index.js";
import { createPostgresStore } from "../../../packages/db/src/index.js";
import {
  executeAutonomousPlan,
  recoverPartialEntryFunding,
  recoverUnfinishedAutonomousPlans,
  reconcileWalletWidePositions,
} from "../../../packages/phase6-live-worker/src/index.js";
import { PublicKey } from "@solana/web3.js";
import { EXPECTED_DLMM_PROGRAM_ID } from "../../../packages/meteora/src/index.js";
import { loadDeploymentPolicyFile } from "../../../packages/deployment-policy/src/index.js";
import { validateClaimedPlan, type Phase7ExecutionControl } from "../../../packages/phase6-claim-guard/src/index.js";
import { createGovernedConnection, createMeteoraReadAdapter } from "../../../packages/meteora/src/index.js";
import { assertPreinitializedMeteoraBinArrays } from "../../../packages/meteora-execution/src/index.js";
import { Phase7TelegramAlerter,alertsForExecutionResult,loadPhase7TelegramConfig,type Phase7Alert } from "../../../packages/phase7-alerting/src/index.js";

const json = (value: unknown) => JSON.stringify(value, null, 2);
const yes = (value: string | undefined) =>
  String(value ?? "").toLowerCase() === "true";
/**
 * Phase-6 still requires its explicit mainnet-live switch. This separate
 * bounded-production mode removes only the retired single-campaign allowance;
 * P7, portfolio, signer, freshness, and claim-time controls remain live.
 */
const boundedUnattendedProduction = () =>
  yes(process.env.LPFORGE_BOUNDED_UNATTENDED_PRODUCTION);
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const stringArray=(value:unknown):string[]=>Array.isArray(value)?value.map(String).filter(Boolean):[];
function phase7ExecutionControlFromRow(controlRow:Record<string,unknown>|undefined):Phase7ExecutionControl|undefined{
  if(!controlRow)return undefined;
  const payload=object(controlRow.payload),rawPoolDrift=Array.isArray(payload.poolDrift)?payload.poolDrift:[],releaseIdentity=object(payload.releaseIdentity),portfolio=object(payload.portfolio);
  return{decisionId:String(controlRow.decision_id),cycleKey:String(controlRow.cycle_key),authorityMode:String(controlRow.authority_mode),healthStatus:String(controlRow.health_status),driftStatus:String(controlRow.drift_status),safetyMode:String(controlRow.safety_mode),newEconomicActionAllowed:Boolean(controlRow.new_economic_action_allowed),observedAt:new Date(String(controlRow.observed_at)).toISOString(),poolDrift:Object.fromEntries(rawPoolDrift.filter(row=>row&&typeof row==='object').map(row=>{const value=row as Record<string,unknown>;return[String(value.poolAddress??''),String(value.rawStatus??value.status??'')]}).filter(([pool])=>Boolean(pool))),activeIncidentIds:stringArray(payload.activeIncidentIds),releaseIntegrityValid:releaseIdentity.valid===true,portfolioValid:portfolio.valid===true,revokedApprovalIds:stringArray(payload.controlledCanaryRevokedApprovalIds)};
}
const executionTelegramAlerter=new Phase7TelegramAlerter(loadPhase7TelegramConfig({...process.env,LPFORGE_TELEGRAM_MIN_SEVERITY:process.env.LPFORGE_EXECUTION_TELEGRAM_MIN_SEVERITY??process.env.LPFORGE_TELEGRAM_MIN_SEVERITY??'INFO'}));
async function safeExecutionTelegramAlert(alert:Phase7Alert){try{const r=await executionTelegramAlerter.send(alert);if(r.sent)console.log(json({event:'lpforge_telegram_alert_sent',runtime:'lpforge-execution',code:alert.code,severity:alert.severity}));}catch(error){console.error(json({event:'lpforge_telegram_alert_failed',runtime:'lpforge-execution',code:alert.code,error:error instanceof Error?error.message:String(error)}));}}
async function alertExecutionResult(result:{status:string;planId?:string|undefined;reasonCodes?:string[]|undefined;transactionSubmitted?:boolean|undefined},observedAt:string){for(const alert of alertsForExecutionResult({...result,observedAt,runtimeId:'lpforge-execution'}))await safeExecutionTelegramAlert(alert);}
/** The capital-owner signer is deliberately private-key-only in production. */
function signerFromEnvironment(): MainnetSignerBackend {
  const common = {
      backendId: process.env.LPFORGE_P6_SIGNER_BACKEND_ID ?? "",
      publicKeyAddress: process.env.LPFORGE_P6_SIGNER_PUBLIC_KEY ?? "",
    },
    mode = (process.env.LPFORGE_P6_SIGNER_MODE ?? "").trim();
  if (mode !== "LOCAL_PRIVATE_KEY")
    throw new Error("LPFORGE_P6_OWNER_SIGNER_MODE_LOCAL_PRIVATE_KEY_REQUIRED");
  return createLocalPrivateKeySigner({
    ...common,
    privateKeyBase58: process.env.LPFORGE_P6_PRIVATE_KEY ?? "",
  });
}
function status() {
  const gate = evaluatePhase6LivePathAuthorization(
    loadPhase6LiveAuthorizationConfig(),
  );
  const runnerEnabled = yes(process.env.LPFORGE_P6_EXECUTION_RUNNER_ENABLED),
    databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());
  let signerReady = false,
    signerError: string | undefined,
    signerMode: string | undefined;
  try {
    const signer = signerFromEnvironment();
    signerReady = signer.secretExportable === false;
    signerMode = signer.custodyMode;
  } catch (error) {
    signerError =
      error instanceof Error ? error.message : "LPFORGE_P6_SIGNER_INVALID";
  }
  return {
    service: "lpforge-execution",
    runnerEnabled,
    gate,
    signerReady,
    ...(signerMode ? { signerMode } : {}),
    ...(signerError ? { signerError } : {}),
    databaseConfigured,
    executionPlanSource: "AUTONOMOUS_POSTGRES",
    planSourceStatus: databaseConfigured
      ? "AWAITING_AUTONOMOUS_DECISION"
      : "DATABASE_URL_REQUIRED_FOR_AUTONOMOUS_DISPATCH",
    planSourceReasonCodes: databaseConfigured
      ? []
      : ["P6_AUTONOMOUS_DATABASE_URL_REQUIRED"],
    directKeyMaterial:
      (process.env.LPFORGE_P6_SIGNER_MODE ?? "") === "LOCAL_PRIVATE_KEY",
    transactionSubmitted: false,
  };
}
function assertLaunchable() {
  const current = status();
  if (!current.runnerEnabled)
    throw new Error("LPFORGE_P6_EXECUTION_RUNNER_DISABLED");
  assertCapitalDeploymentAuthorized(current.gate);
  if (!current.signerReady)
    throw new Error(current.signerError ?? "LPFORGE_P6_SIGNER_NOT_READY");
  if (!current.databaseConfigured)
    throw new Error("LPFORGE_P6_AUTONOMOUS_DATABASE_URL_REQUIRED");
  controlledCanaryCampaignId();
  if(yes(process.env.LPFORGE_LIVE_EXECUTION)&&!(process.env.LPFORGE_PLAN_PROVENANCE_SECRET??'').trim())throw new Error('LPFORGE_P6_PLAN_PROVENANCE_SECRET_REQUIRED');
  return current;
}
/** A real canary campaign gets exactly one durable OPEN allowance. */
function controlledCanaryCampaignId():string|undefined{
  if(boundedUnattendedProduction())return undefined;
  if(!yes(process.env.LPFORGE_MAINNET_CANARY))return undefined;
  const campaignId=(process.env.LPFORGE_MAINNET_CANARY_CAMPAIGN_ID??'').trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(campaignId))throw new Error('LPFORGE_P6_CONTROLLED_CANARY_CAMPAIGN_ID_REQUIRED');
  return campaignId;
}
function recoveryConfig() {
  const rpcUrl = (
    process.env.LPFORGE_P6_PRIVATE_WRITE_RPC_URL ??
    process.env.SOLANA_RPC_HTTP_URL ??
    ""
  ).trim();
  if (!rpcUrl) throw new Error("LPFORGE_P6_RECOVERY_RPC_REQUIRED");
  const ownerAddress = (process.env.LPFORGE_OPERATOR_OWNER_ADDRESS ?? "").trim();
  if (!ownerAddress) throw new Error("LPFORGE_P6_RECOVERY_OWNER_REQUIRED");
  return {
    rpcUrl,
    ownerAddress,
    programId: (process.env.LPFORGE_P6_PROGRAM_ID ?? EXPECTED_DLMM_PROGRAM_ID).trim(),
  };
}
function assertObserveLaunchable() {
  const current = status();
  if (!current.databaseConfigured)
    throw new Error("LPFORGE_P6_AUTONOMOUS_DATABASE_URL_REQUIRED");
  recoveryConfig();
  return current;
}
let nextWalletSweepAtMs = 0;
async function reconcileWalletSweep(input: {
  store: Awaited<ReturnType<typeof createPostgresStore>>;
  rpcUrl: string;
  ownerAddress: string;
  programId: string;
  now: string;
  force?: boolean;
}) {
  const nowMs = Date.parse(input.now);
  const intervalMs = Math.max(
    60_000,
    Math.min(15 * 60_000, Number(process.env.LPFORGE_P6_WALLET_SWEEP_INTERVAL_MS ?? 300_000)),
  );
  if (!input.force && Number.isFinite(nowMs) && nowMs < nextWalletSweepAtMs)
    return { skipped: true, reasonCodes: ["P6_WALLET_SWEEP_INTERVAL_NOT_DUE"] };
  nextWalletSweepAtMs = (Number.isFinite(nowMs) ? nowMs : Date.now()) + intervalMs;
  return reconcileWalletWidePositions({
    store: input.store,
    rpcUrl: input.rpcUrl,
    programId: input.programId,
    ownerAddress: input.ownerAddress,
    now: input.now,
  });
}
function workerConfig() {
  const maxFeeLamports = BigInt(
      process.env.LPFORGE_P6_MAX_FEE_LAMPORTS ?? "100000",
    ),
    maxFeeFraction = Number(process.env.LPFORGE_P6_MAX_FEE_FRACTION ?? "0.02"),
    policy = loadDeploymentPolicyFile(
      process.env.LPFORGE_EXECUTION_POLICY_PATH?.trim() ||
        "policies/live-execution-policy.json",
    ),
    construction = policy.positionConstruction,
    configuredLiquiditySlippageBps = construction?.liquiditySlippageBps,
    liquiditySlippageBps = Number(configuredLiquiditySlippageBps);
  if (
    maxFeeLamports < 0n ||
    !Number.isFinite(maxFeeFraction) ||
    maxFeeFraction <= 0 ||
    maxFeeFraction > 1 ||
    !Number.isInteger(Number(process.env.LPFORGE_P6_MAX_PRESIGN_ACTIVE_BIN_DRIFT_BINS ?? 2)) ||
    Number(process.env.LPFORGE_P6_MAX_PRESIGN_ACTIVE_BIN_DRIFT_BINS ?? 2) < 0 ||
    !Number.isFinite(Number(process.env.LPFORGE_P6_MAX_PRESIGN_REFERENCE_DIVERGENCE_BPS ?? 250)) ||
    Number(process.env.LPFORGE_P6_MAX_PRESIGN_REFERENCE_DIVERGENCE_BPS ?? 250) < 0 ||
    !Number.isInteger(configuredLiquiditySlippageBps) ||
    liquiditySlippageBps < 1 ||
    liquiditySlippageBps > 10_000
  )
    throw new Error("LPFORGE_P6_EXECUTION_COST_CONFIG_INVALID");
  return {
    rpcUrl: process.env.LPFORGE_P6_PRIVATE_WRITE_RPC_URL ?? "",
    programId: process.env.LPFORGE_P6_PROGRAM_ID ?? EXPECTED_DLMM_PROGRAM_ID,
    liquiditySlippageBps,
    maxFeeLamports,
    maxFeeFraction,
    simulationFreshnessMs: Number(
      process.env.LPFORGE_P6_SIMULATION_FRESHNESS_MS ?? 30000,
    ),
    riskPermitTtlMs: Number(process.env.LPFORGE_P6_RISK_PERMIT_TTL_MS ?? 15000),
    maxPresignActiveBinDriftBins: Number(process.env.LPFORGE_P6_MAX_PRESIGN_ACTIVE_BIN_DRIFT_BINS ?? 2),
    maxPresignReferenceDivergenceBps: Number(process.env.LPFORGE_P6_MAX_PRESIGN_REFERENCE_DIVERGENCE_BPS ?? 250),
    confirmPollMs: Number(process.env.LPFORGE_P6_CONFIRM_POLL_MS ?? 1000),
    confirmAttempts: Number(process.env.LPFORGE_P6_CONFIRM_ATTEMPTS ?? 30),
    ...(yes(process.env.LPFORGE_MAINNET_CANARY)&&!boundedUnattendedProduction()
      ? { controlledCanary: policy.controlledCanary }
      : {}),
  };
}
async function dispatchOne() {
  const current = assertLaunchable(),
    databaseUrl = process.env.DATABASE_URL ?? "",
    store = await createPostgresStore(databaseUrl),
    campaignId=controlledCanaryCampaignId();
  try {
    const plan = await store.claimNextAutonomousPlan(new Date().toISOString());
    if (!plan)
      return {
        service: "lpforge-execution",
        status: "AWAITING_AUTONOMOUS_DECISION",
        transactionSubmitted: false,
      };
    const baseConfig = workerConfig(),
      staticPolicy = loadDeploymentPolicyFile(
        process.env.LPFORGE_EXECUTION_POLICY_PATH?.trim() ||
          "policies/live-execution-policy.json",
      ),
      [owned,productionCandidates] = await Promise.all([
        store.loadOwnedPositions(plan.ownerAddress),
        store.listDiscoveryCandidates([...(staticPolicy.productionAdmission?.eligibleTiers??['A'])]),
      ]),
      config = {
        ...baseConfig,
        liquiditySlippageBps:
          staticPolicy.positionConstruction?.liquiditySlippageBps ?? 0,
      };
    const now=new Date().toISOString(), dayStart=new Date(Date.UTC(new Date(now).getUTCFullYear(),new Date(now).getUTCMonth(),new Date(now).getUTCDate())).toISOString(),runtimeId=(process.env.LPFORGE_P7_RUNTIME_ID??'lpforge-production').trim(),provenance=object(object(plan.planPayload).provenance),binding=object(provenance.phase7Control),boundControlDecisionId=String(binding.decisionId??'');
    const [controlRow,actionsToday,portfolioFacts,boundControlRow]=await Promise.all([store.loadLatestPhase7ControlDecision(runtimeId),store.countExecutionActionsSince(plan.ownerAddress,dayStart),store.loadPhase7PortfolioFacts(plan.ownerAddress),boundControlDecisionId?store.loadPhase7ControlDecision(runtimeId,boundControlDecisionId):Promise.resolve(undefined)]);
    const phase7Control=phase7ExecutionControlFromRow(controlRow),boundPhase7Control=phase7ExecutionControlFromRow(boundControlRow);
    const provenanceSecret=(process.env.LPFORGE_PLAN_PROVENANCE_SECRET??'').trim();
    let positionTruth;
    if (plan.positionAddress) {
      try {
        const fact = await createMeteoraReadAdapter({
          rpcUrl: config.rpcUrl,
          cluster: "mainnet-beta",
          programId: config.programId,
        }).getPositionV2(plan.poolAddress, plan.positionAddress);
        positionTruth = { owner: fact.owner, pool: fact.pool };
      } catch {
        positionTruth = undefined;
      }
    }
    const guard = validateClaimedPlan({
      plan,
      policy: staticPolicy,
      ownedPositions: owned,
      productionCandidates,
      ...(phase7Control?{phase7Control}:{}),
      ...(boundPhase7Control?{boundPhase7Control}:{}),
      actionsToday,
      pendingExecutionCount:portfolioFacts.pendingExecutionCount,
      unresolvedReconciliationDebt:portfolioFacts.unresolvedReconciliationDebt,
      controlledCanary:yes(process.env.LPFORGE_MAINNET_CANARY)&&!boundedUnattendedProduction(),
      ...(provenanceSecret?{provenanceSecret}:{}),
      now,
      ...(positionTruth ? { positionTruth } : {}),
    });
    if (!guard.approved) {
      await store.transitionAutonomousPlan({
        planId: plan.planId,
        state: "BLOCKED",
        at: new Date().toISOString(),
        reasonCodes: guard.reasonCodes,
        payload: {
          stage: "CLAIM_GUARD",
          capitalLamports: guard.capitalLamports.toString(),
        },
      });
      return {
        service: "lpforge-execution",
        status: "BLOCKED",
        planId: plan.planId,
        reasonCodes: guard.reasonCodes,
        transactionSubmitted: false,
      };
    }
    if(["OPEN","ADD"].includes(plan.action)){
      const capital=guard.capitalLamports, deployment=staticPolicy.productionCapital;
      if(!deployment){await store.transitionAutonomousPlan({planId:plan.planId,state:"BLOCKED",at:now,reasonCodes:['P6_CAPITAL_POLICY_MISSING'],payload:{stage:'CAPITAL_RESERVATION'}});return{service:'lpforge-execution',status:'BLOCKED',planId:plan.planId,reasonCodes:['P6_CAPITAL_POLICY_MISSING'],transactionSubmitted:false};}
      const walletLamports=BigInt(await createGovernedConnection({rpcUrl:config.rpcUrl,priority:'P0_EXECUTION_CRITICAL'}).getBalance(new PublicKey(plan.ownerAddress),'confirmed'));
      if(plan.action==='OPEN'){
        const construction=staticPolicy.positionConstruction,intent=(plan.planPayload.intent??{}) as Record<string,unknown>,lower=Number(intent.lowerBinId),upper=Number(intent.upperBinId),width=upper-lower+1;
        if(!construction||!Number.isInteger(lower)||!Number.isInteger(upper)||width<3||width>construction.maxInitialPositionWidthBins){await store.transitionAutonomousPlan({planId:plan.planId,state:'BLOCKED',at:now,reasonCodes:['P6_POSITION_CONSTRUCTION_POLICY_BLOCK'],payload:{stage:'POSITION_CONSTRUCTION',widthBins:width}});return{service:'lpforge-execution',status:'BLOCKED',planId:plan.planId,reasonCodes:['P6_POSITION_CONSTRUCTION_POLICY_BLOCK'],transactionSubmitted:false};}
        // This is a balance-availability preflight only. The refundable
        // PositionV2 deposit is intentionally excluded from LP EV/PnL.
        if(walletLamports<capital+deployment.reserveLamports+construction.maxPositionAccountRentLamports){await store.transitionAutonomousPlan({planId:plan.planId,state:'BLOCKED',at:now,reasonCodes:['P6_POSITION_ACCOUNT_RENT_WALLET_INSUFFICIENT'],payload:{stage:'POSITION_CONSTRUCTION',capitalLamports:capital.toString(),refundablePositionRentLamports:construction.maxPositionAccountRentLamports.toString()}});return{service:'lpforge-execution',status:'BLOCKED',planId:plan.planId,reasonCodes:['P6_POSITION_ACCOUNT_RENT_WALLET_INSUFFICIENT'],transactionSubmitted:false};}
        if(construction.requirePreinitializedBinArrays)try{await assertPreinitializedMeteoraBinArrays({rpcUrl:config.rpcUrl,poolAddress:plan.poolAddress,programId:config.programId,lowerBinId:lower,upperBinId:upper});}catch(error){const reason=error instanceof Error?error.message:'P6_BIN_ARRAY_COVERAGE_UNAVAILABLE';await store.transitionAutonomousPlan({planId:plan.planId,state:'BLOCKED',at:now,reasonCodes:[reason],payload:{stage:'BIN_ARRAY_COVERAGE',widthBins:width}});return{service:'lpforge-execution',status:'BLOCKED',planId:plan.planId,reasonCodes:[reason],transactionSubmitted:false};}
      }
      const pool=staticPolicy.pools.find(x=>x.address===plan.poolAddress),poolCap=pool?.maxCapitalLamports??staticPolicy.productionAdmission?.maxCapitalLamports;
      if(!poolCap){await store.transitionAutonomousPlan({planId:plan.planId,state:"BLOCKED",at:now,reasonCodes:['P6_CAPITAL_POOL_POLICY_MISSING'],payload:{stage:'CAPITAL_RESERVATION'}});return{service:'lpforge-execution',status:'BLOCKED',planId:plan.planId,reasonCodes:['P6_CAPITAL_POOL_POLICY_MISSING'],transactionSubmitted:false};}
      const reserved=await store.reserveExecutionCapital({planId:plan.planId,ownerAddress:plan.ownerAddress,poolAddress:plan.poolAddress,capitalLamports:capital,walletLamports,reserveLamports:deployment.reserveLamports,maxPortfolioLamports:deployment.maxPortfolioLamports,maxPoolLamports:poolCap,maxTokenLamports:deployment.maxTokenLamports,maxInitialPositionLamports:deployment.maxInitialPositionLamports,now});
      if(!reserved.approved){await store.transitionAutonomousPlan({planId:plan.planId,state:"BLOCKED",at:now,reasonCodes:reserved.reasonCodes,payload:{stage:'CAPITAL_RESERVATION',capitalReservation:reserved.diagnostics??{}}});return{service:'lpforge-execution',status:'BLOCKED',planId:plan.planId,reasonCodes:reserved.reasonCodes,transactionSubmitted:false};}
    }
    if(campaignId&&plan.action==='OPEN'){
      const allowance=await store.reserveControlledCanaryCampaignOpen({campaignId,planId:plan.planId,poolAddress:plan.poolAddress,capitalLamports:guard.capitalLamports,at:new Date().toISOString()});
      if(!allowance.reserved){
        const reasonCodes=['P6_CONTROLLED_CANARY_CAMPAIGN_OPEN_CONSUMED'];
        await store.transitionAutonomousPlan({planId:plan.planId,state:'BLOCKED',at:new Date().toISOString(),reasonCodes,payload:{stage:'CANARY_CAMPAIGN_OPEN_ALLOWANCE',campaignId,...(allowance.existingPlanId?{existingPlanId:allowance.existingPlanId}:{})}});
        return{service:'lpforge-execution',status:'BLOCKED',planId:plan.planId,reasonCodes,transactionSubmitted:false};
      }
    }
    const result = await executeAutonomousPlan({
      store,
      plan,
      signer: signerFromEnvironment(),
      config,
    });
    if(result.transactionSubmitted)await store.markExecutionCapitalSubmitted(plan.planId,new Date().toISOString());
    else if(result.status==='BLOCKED')await store.releaseExecutionCapital(plan.planId,new Date().toISOString(),result.reasonCodes);
    await store.reconcileExecutionCapitalReservations(new Date().toISOString());
    return {
      service: "lpforge-execution",
      status: result.status,
      planId: result.planId,
      reasonCodes: result.reasonCodes,
      transactionSubmitted: result.transactionSubmitted,
    };
  } finally {
    await store.close();
  }
}
async function recoverOnce() {
  assertLaunchable();
  const store = await createPostgresStore(process.env.DATABASE_URL ?? "");
  try {
    const config = workerConfig(),
      currentBlockHeight = await createGovernedConnection({rpcUrl:config.rpcUrl,priority:'P1_RECOVERY_CRITICAL'}).getBlockHeight("confirmed");
    await store.reconcileExecutionCapitalReservations(new Date().toISOString());
    const partial = await recoverPartialEntryFunding({
      store,
      signer: signerFromEnvironment(),
      config,
    });
    const plans = await recoverUnfinishedAutonomousPlans({
      store,
      currentBlockHeight,
      now: new Date().toISOString(),
      rpcUrl: config.rpcUrl,
      programId: config.programId,
    });
    // CLOSE/EMERGENCY_CLOSE stages that were durably confirmed before a
    // process interruption are protective workflows. Resume only the next
    // uncompleted stage; executeAutonomousPlan preserves the existing journal
    // and never re-sends the completed stage.
    const resumed: Array<{ planId: string; status: string; reasonCodes: string[] }> = [];
    const unresolvedPlans = [];
    for (const recovery of plans) {
      if (recovery.action !== "RESUME_CLOSE_SETTLEMENT") {
        unresolvedPlans.push(recovery);
        continue;
      }
      const plan = await store.loadAutonomousPlan(recovery.planId);
      if (!plan) {
        unresolvedPlans.push({
          ...recovery,
          action: "HOLD_FOR_OPERATOR",
          reasonCodes: ["P6_RECOVERY_CLOSE_PLAN_MISSING"],
        });
        continue;
      }
      const result = await executeAutonomousPlan({
        store,
        plan,
        signer: signerFromEnvironment(),
        config,
      });
      resumed.push({
        planId: recovery.planId,
        status: result.status,
        reasonCodes: result.reasonCodes,
      });
      if (result.status !== "RECONCILED")
        unresolvedPlans.push({
          ...recovery,
          action: "HOLD_FOR_OPERATOR",
          reasonCodes: result.reasonCodes,
        });
    }
    // M0061 detail is retained until every linked plan has reached a terminal
    // state. A close may become SOL_SETTLED in the same recovery pass that
    // completes its final plan, so perform this bounded, non-economic sweep
    // afterwards. The compactor independently rechecks terminal settlement,
    // zero pending work, and summary durability before deleting any HOLD rows.
    const compactionCandidates=await store.loadPendingPositionManagementDecisionAuditCompactions(16),
      compactedPositionAddresses:string[]=[];
    for(const positionAddress of compactionCandidates){
      const result=await store.compactPositionManagementDecisionAudit({positionAddress,at:new Date().toISOString()});
      if(result.compacted)compactedPositionAddresses.push(positionAddress);
    }
    const walletSweep = await reconcileWalletSweep({
      store,
      rpcUrl: config.rpcUrl,
      programId: config.programId,
      ownerAddress: (process.env.LPFORGE_OPERATOR_OWNER_ADDRESS ?? "").trim(),
      now: new Date().toISOString(),
    });
    return { partial, plans: unresolvedPlans, resumed, walletSweep, compaction:{candidates:compactionCandidates,compactedPositionAddresses} };
  } finally {
    await store.close();
  }
}
/**
 * Disabled execution workers still provide durable recovery and authoritative
 * wallet reconciliation. This path contains no signer construction and never
 * dispatches, builds, signs, or submits a transaction.
 */
async function reconcileOnlyOnce() {
  assertObserveLaunchable();
  const store = await createPostgresStore(process.env.DATABASE_URL ?? "");
  try {
    const config = recoveryConfig(), now = new Date().toISOString();
    const currentBlockHeight = await createGovernedConnection({rpcUrl:config.rpcUrl,priority:'P1_RECOVERY_CRITICAL'}).getBlockHeight("confirmed");
    const plans = await recoverUnfinishedAutonomousPlans({
      store,
      currentBlockHeight,
      now,
      rpcUrl: config.rpcUrl,
      programId: config.programId,
    });
    const walletSweep = await reconcileWalletSweep({ store, ...config, now });
    return { service: "lpforge-execution", status: "RECONCILE_ONLY", transactionSubmitted: false, plans, walletSweep };
  } finally {
    await store.close();
  }
}
async function start() {
  if (!yes(process.env.LPFORGE_P6_EXECUTION_RUNNER_ENABLED)) {
    const interval = Math.max(30_000, Math.min(300_000, Number(process.env.LPFORGE_P6_RECONCILIATION_INTERVAL_MS ?? 60_000)));
    const startupAt = new Date().toISOString();
    console.log(json({...assertObserveLaunchable(),status:"RECONCILE_ONLY_START",transactionSubmitted:false,recovery:await reconcileOnlyOnce()}));
    if (executionTelegramAlerter.config.notifyStartup)
      await safeExecutionTelegramAlert({severity:'INFO',code:'P6_EXECUTION_RECONCILE_ONLY_START',title:'LPForge execution recovery worker started',message:'The execution worker is in reconcile-only mode. It cannot sign or submit transactions.',runtimeId:'lpforge-execution',observedAt:startupAt});
    for (;;) {
      const observedAt = new Date().toISOString();
      try { console.log(json({...await reconcileOnlyOnce(),observedAt})); }
      catch (error) { console.error(error); await safeExecutionTelegramAlert({severity:'CRITICAL',code:'P6_EXECUTION_RECONCILE_ONLY_EXCEPTION',title:'Execution recovery cycle exception',message:'The reconcile-only worker caught an exception. No transaction was sent.',runtimeId:'lpforge-execution',observedAt,reasonCodes:['P6_EXECUTION_RECONCILE_ONLY_EXCEPTION']}); }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
  const interval = Math.max(
    1000,
    Math.min(
      60000,
      Number(process.env.LPFORGE_P6_EXECUTION_RUNNER_INTERVAL_MS ?? 5000),
    ),
  );
  const startupAt=new Date().toISOString();
  try{console.log(json({...assertLaunchable(),status:"RECOVERY_BEFORE_AUTONOMOUS_DISPATCH",recovery:await recoverOnce()}));if(executionTelegramAlerter.config.notifyStartup)await safeExecutionTelegramAlert({severity:'INFO',code:'P6_EXECUTION_DAEMON_START',title:'LPForge execution daemon started',message:'The execution worker is online and awaiting autonomous plans. Signing remains subject to its independent claim guard and live policy.',runtimeId:'lpforge-execution',observedAt:startupAt});}catch(error){await safeExecutionTelegramAlert({severity:'CRITICAL',code:'P6_EXECUTION_DAEMON_START_FAILURE',title:'LPForge execution daemon failed to start',message:'The execution worker could not complete its launch checks. No transaction was sent.',runtimeId:'lpforge-execution',observedAt:startupAt,reasonCodes:['P6_EXECUTION_START_FAILURE']});throw error;}
  for (;;) {
    const observedAt=new Date().toISOString();
    try{const recovery = await recoverOnce();if (recovery.partial.length || recovery.plans.length || (!('skipped' in recovery.walletSweep) && recovery.walletSweep.adopted>0)){const result={service:'lpforge-execution',status:'RECOVERY_PENDING',recovery,observedAt};console.log(json(result));await safeExecutionTelegramAlert({severity:'WARNING',code:'P6_EXECUTION_RECOVERY_PENDING',title:'Execution recovery is active',message:'LPForge is reconciling unfinished execution state before accepting a new plan.',runtimeId:'lpforge-execution',observedAt,reasonCodes:[...recovery.partial.flatMap(x=>x.reasonCodes),...recovery.plans.flatMap(x=>x.reasonCodes),...recovery.walletSweep.reasonCodes].slice(0,12)});}else{const result=await dispatchOne();console.log(json({...result,observedAt}));await alertExecutionResult(result,observedAt);}}catch(error){console.error(error);await safeExecutionTelegramAlert({severity:'CRITICAL',code:'P6_EXECUTION_CYCLE_EXCEPTION',title:'Execution cycle exception',message:'The execution worker caught an exception and will retry. No blind resend is permitted.',runtimeId:'lpforge-execution',observedAt,reasonCodes:['P6_EXECUTION_CYCLE_EXCEPTION']});}
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
const cmd = process.argv[2] ?? "status";
if (cmd === "status") console.log(json(status()));
else if (cmd === "assert-launchable") console.log(json(assertLaunchable()));
else if (cmd === "assert-observe-launchable") console.log(json(assertObserveLaunchable()));
else if (cmd === "recover-once") console.log(json(await recoverOnce()));
else if (cmd === "reconcile-once") console.log(json(await reconcileOnlyOnce()));
else if (cmd === "dispatch-once") console.log(json(await dispatchOne()));
else if (cmd === "start") await start();
else {
  console.error(
    "Usage: execution [status|assert-launchable|assert-observe-launchable|recover-once|reconcile-once|dispatch-once|start]",
  );
  process.exitCode = 2;
}
