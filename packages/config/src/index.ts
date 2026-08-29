export type Phase1DataMode = 'LIVE_READ_ONLY' | 'FIXTURE';
export type Cluster = 'mainnet-beta' | 'devnet';
export interface Phase1Config {
  databaseUrl: string;
  solanaRpcHttpUrl: string;
  solanaRpcWsUrl?: string;
  meteoraDataApiUrl: string;
  cluster: Cluster;
  programId: string;
  expectedSdkVersion: string;
  dataMode: Phase1DataMode;
  liveSigning: false;
  dataApiMaxRps: number;
  httpTimeoutMs: number;
  rpcTimeoutMs: number;
  rpcMinIntervalMs: number;
  rpcMaxRetries: number;
  rpcRetryBaseDelayMs: number;
  rpcRetryMaxDelayMs: number;
  collectIntervalMs: number;
  eventBackfillLimit: number;
  smokePoolAddress?: string;
  smokePositionAddress?: string;
  port: number;
  logLevel: 'debug'|'info'|'warn'|'error';
}

const FORBIDDEN_SECRET_KEYS = ['PRIVATE_KEY','SEED_PHRASE','WALLET_SECRET','WALLET_PRIVATE_KEY','SIGNER_KEYPAIR'];

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`LPFORGE_CONFIG_REQUIRED:${name}`);
  return value;
}
function intValue(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  const value = raw == null || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`LPFORGE_CONFIG_INTEGER:${name}`);
  return value;
}
function urlValue(value: string, name: string): string {
  try { return new URL(value).toString().replace(/\/$/, ''); } catch { throw new Error(`LPFORGE_CONFIG_URL:${name}`); }
}

export function loadPhase1Config(env: NodeJS.ProcessEnv = process.env): Phase1Config {
  if ((env.LIVE_SIGNING ?? 'false').toLowerCase() !== 'false') throw new Error('LPFORGE_PHASE1_LIVE_SIGNING_PROHIBITED');
  for (const key of FORBIDDEN_SECRET_KEYS) if (env[key]?.trim()) throw new Error(`LPFORGE_PHASE1_SIGNER_MATERIAL_PROHIBITED:${key}`);
  const cluster = (env.LPFORGE_CLUSTER ?? 'mainnet-beta') as Cluster;
  if (!['mainnet-beta','devnet'].includes(cluster)) throw new Error('LPFORGE_CONFIG_CLUSTER');
  const dataMode = (env.LPFORGE_DATA_MODE ?? 'FIXTURE') as Phase1DataMode;
  if (!['LIVE_READ_ONLY','FIXTURE'].includes(dataMode)) throw new Error('LPFORGE_PHASE1_DATA_MODE');
  const logLevel = (env.LOG_LEVEL ?? 'info') as Phase1Config['logLevel'];
  if (!['debug','info','warn','error'].includes(logLevel)) throw new Error('LPFORGE_CONFIG_LOG_LEVEL');
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    solanaRpcHttpUrl: urlValue(required(env, 'SOLANA_RPC_HTTP_URL'), 'SOLANA_RPC_HTTP_URL'),
    ...(env.SOLANA_RPC_WS_URL?.trim() ? {solanaRpcWsUrl: urlValue(env.SOLANA_RPC_WS_URL, 'SOLANA_RPC_WS_URL')} : {}),
    meteoraDataApiUrl: urlValue(env.METEORA_DATA_API_URL ?? 'https://dlmm.datapi.meteora.ag', 'METEORA_DATA_API_URL'),
    cluster,
    programId: env.LPFORGE_PROGRAM_ID ?? 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
    expectedSdkVersion: env.METEORA_SDK_VERSION_EXPECTED ?? '1.9.10',
    dataMode,
    liveSigning: false,
    dataApiMaxRps: intValue(env, 'DATA_API_MAX_RPS', 25, 1, 30),
    httpTimeoutMs: intValue(env, 'HTTP_TIMEOUT_MS', 10000, 100, 120000),
    rpcTimeoutMs: intValue(env, 'RPC_TIMEOUT_MS', 12000, 100, 120000),
    rpcMinIntervalMs: intValue(env, 'RPC_MIN_INTERVAL_MS', 125, 0, 5000),
    rpcMaxRetries: intValue(env, 'RPC_MAX_RETRIES', 5, 0, 10),
    rpcRetryBaseDelayMs: intValue(env, 'RPC_RETRY_BASE_DELAY_MS', 250, 1, 60000),
    rpcRetryMaxDelayMs: intValue(env, 'RPC_RETRY_MAX_DELAY_MS', 4000, 1, 120000),
    collectIntervalMs: intValue(env, 'COLLECT_INTERVAL_MS', 30000, 1000, 3600000),
    eventBackfillLimit: intValue(env, 'EVENT_BACKFILL_LIMIT', 100, 1, 1000),
    ...(env.LPFORGE_SMOKE_POOL_ADDRESS?.trim() ? {smokePoolAddress: env.LPFORGE_SMOKE_POOL_ADDRESS.trim()} : {}),
    ...(env.LPFORGE_SMOKE_POSITION_ADDRESS?.trim() ? {smokePositionAddress: env.LPFORGE_SMOKE_POSITION_ADDRESS.trim()} : {}),
    port: intValue(env, 'PORT', 8080, 1, 65535),
    logLevel
  };
}

export function phase1Capabilities() {
  return {
    phase: 'P1' as const,
    readOnly: true,
    liveSigning: false as const,
    allowed: ['pool_read','active_bin_read','bin_window_read','position_read','data_api_read','event_index','feature_compute','valuation','replay'],
    prohibited: ['transaction_build','transaction_sign','transaction_send','entry_decision','rangeforge_decision','rebalance','claim','swap']
  };
}

export function phase2Capabilities() {
  return {
    phase: 'P2' as const,
    readOnly: true,
    liveSigning: false as const,
    allowed: [...phase1Capabilities().allowed,'synthetic_lp_simulation','range_outcome_replay','fee_path_attribution','pool_intelligence','toxicity_assessment','chronological_experiments','counterfactuals'],
    prohibited: ['transaction_build','transaction_sign','transaction_send','entry_decision','rangeforge_winner_selection','rebalance','claim','swap','live_policy_promotion']
  };
}

export function phase3Capabilities() {
  return {
    phase: 'P3' as const,
    readOnly: true,
    recommendationOnly: true,
    liveSigning: false as const,
    allowed: [...phase2Capabilities().allowed,'market_context','structure_features','regime_probabilities','opportunity_economics','range_survival_forecast','range_candidate_generation','range_candidate_ranking','thesis_generation','shadow_recommendations'],
    prohibited: ['transaction_build','transaction_sign','transaction_send','wallet_secret','automatic_entry','automatic_rebalance','automatic_exit','claim','swap','live_policy_promotion']
  };
}


export function phase4Capabilities() {
  return {
    phase: 'P4' as const,
    readOnly: true,
    paperOnly: true,
    recommendationOnly: true,
    liveSigning: false as const,
    allowed: [...phase3Capabilities().allowed,'entry_timing','entry_delay_evaluation','capital_allocation','risk_governor','paper_positions','thesis_monitoring','forward_ev_management','paper_portfolio','shadow_management'],
    prohibited: ['transaction_build','transaction_sign','transaction_send','wallet_secret','live_entry','live_rebalance','live_exit','claim','swap','live_policy_promotion']
  };
}

export function phase5Capabilities() {
  return {
    phase: 'P5' as const,
    controlledExecution: true,
    defaultAuthority: 'BUILD_ONLY' as const,
    liveExecution: false,
    mainnetCanaryDefault: false,
    walletSecretInStrategy: false,
    allowed: [...phase4Capabilities().allowed,'wallet_truth','transaction_plan','transaction_build','simulation','execution_risk','isolated_signer','devnet_submission','reconciliation','crash_recovery','mainnet_canary_guard'],
    prohibitedByDefault: ['mainnet_submit','unguarded_signing','secret_in_strategy','blind_retry','unreconciled_followup','autonomous_scale']
  };
}

export function phase7Capabilities() {
  return {
    phase: 'P7' as const,
    defaultMode: 'OBSERVE_ONLY' as const,
    productionAuthorityIssued: false,
    scalingMode: 'DISABLED' as const,
    automaticPolicyPromotion: false as const,
    directSigner: false as const,
    directTransactionSend: false as const,
    allowed: [...phase5Capabilities().allowed,'production_health','incident_control','audited_operator_controls','portfolio_governance','policy_registry','rollback','promotion_evaluation','bounded_scaling','continuous_evaluation','learning_proposals','backup_restore_readiness','daemon_recovery'],
    prohibitedByDefault: ['production_authority','direct_mainnet_submit','automatic_policy_promotion','unbounded_scaling','reconciliation_bypass','secret_in_control_plane']
  };
}
