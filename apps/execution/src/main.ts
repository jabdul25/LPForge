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
} from "../../../packages/phase6-live-worker/src/index.js";
import { Connection } from "@solana/web3.js";
import { EXPECTED_DLMM_PROGRAM_ID } from "../../../packages/meteora/src/index.js";
import { loadMainnetCanaryDeploymentPolicyFile } from "../../../packages/canary/src/index.js";
import { validateClaimedPlan } from "../../../packages/phase6-claim-guard/src/index.js";
import { createMeteoraReadAdapter } from "../../../packages/meteora/src/index.js";

const json = (value: unknown) => JSON.stringify(value, null, 2);
const yes = (value: string | undefined) =>
  String(value ?? "").toLowerCase() === "true";
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
  return current;
}
function workerConfig() {
  const maxFeeLamports = BigInt(
      process.env.LPFORGE_P6_MAX_FEE_LAMPORTS ?? "100000",
    ),
    maxFeeFraction = Number(process.env.LPFORGE_P6_MAX_FEE_FRACTION ?? "0.02");
  if (
    maxFeeLamports < 0n ||
    !Number.isFinite(maxFeeFraction) ||
    maxFeeFraction <= 0 ||
    maxFeeFraction > 1
  )
    throw new Error("LPFORGE_P6_EXECUTION_COST_CONFIG_INVALID");
  return {
    rpcUrl: process.env.LPFORGE_P6_PRIVATE_WRITE_RPC_URL ?? "",
    programId: process.env.LPFORGE_P6_PROGRAM_ID ?? EXPECTED_DLMM_PROGRAM_ID,
    maxFeeLamports,
    maxFeeFraction,
    simulationFreshnessMs: Number(
      process.env.LPFORGE_P6_SIMULATION_FRESHNESS_MS ?? 30000,
    ),
    riskPermitTtlMs: Number(process.env.LPFORGE_P6_RISK_PERMIT_TTL_MS ?? 15000),
    confirmPollMs: Number(process.env.LPFORGE_P6_CONFIRM_POLL_MS ?? 1000),
    confirmAttempts: Number(process.env.LPFORGE_P6_CONFIRM_ATTEMPTS ?? 30),
  };
}
async function dispatchOne() {
  const current = assertLaunchable(),
    databaseUrl = process.env.DATABASE_URL ?? "",
    store = await createPostgresStore(databaseUrl);
  try {
    const plan = await store.claimNextAutonomousPlan(new Date().toISOString());
    if (!plan)
      return {
        service: "lpforge-execution",
        status: "AWAITING_AUTONOMOUS_DECISION",
        transactionSubmitted: false,
      };
    const config = workerConfig(),
      staticPolicy = loadMainnetCanaryDeploymentPolicyFile(
        process.env.LPFORGE_EXECUTION_POLICY_PATH?.trim() ||
          "policies/live-execution-policy.json",
      ),
      [owned,productionCandidates] = await Promise.all([
        store.loadOwnedPositions(plan.ownerAddress),
        store.listDiscoveryCandidates([...(staticPolicy.productionAdmission?.eligibleTiers??['A'])]),
      ]);
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
      now: new Date().toISOString(),
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
    const result = await executeAutonomousPlan({
      store,
      plan,
      signer: signerFromEnvironment(),
      config,
    });
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
  const current = assertLaunchable(),
    store = await createPostgresStore(process.env.DATABASE_URL ?? "");
  try {
    const config = workerConfig(),
      currentBlockHeight = await new Connection(
        config.rpcUrl,
        "confirmed",
      ).getBlockHeight("confirmed");
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
    return { partial, plans };
  } finally {
    await store.close();
  }
}
async function start() {
  console.log(
    json({
      ...assertLaunchable(),
      status: "RECOVERY_BEFORE_AUTONOMOUS_DISPATCH",
      recovery: await recoverOnce(),
    }),
  );
  const interval = Math.max(
    1000,
    Math.min(
      60000,
      Number(process.env.LPFORGE_P6_EXECUTION_RUNNER_INTERVAL_MS ?? 5000),
    ),
  );
  for (;;) {
    const recovery = await recoverOnce();
    if (recovery.partial.length || recovery.plans.length)
      console.log(
        json({
          service: "lpforge-execution",
          status: "RECOVERY_PENDING",
          recovery,
          observedAt: new Date().toISOString(),
        }),
      );
    else {
      const result = await dispatchOne();
      console.log(json({ ...result, observedAt: new Date().toISOString() }));
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
const cmd = process.argv[2] ?? "status";
if (cmd === "status") console.log(json(status()));
else if (cmd === "assert-launchable") console.log(json(assertLaunchable()));
else if (cmd === "recover-once") console.log(json(await recoverOnce()));
else if (cmd === "dispatch-once") console.log(json(await dispatchOne()));
else if (cmd === "start") await start();
else {
  console.error(
    "Usage: execution [status|assert-launchable|recover-once|dispatch-once|start]",
  );
  process.exitCode = 2;
}
