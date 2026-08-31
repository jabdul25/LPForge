/**
 * One-shot, explicitly allowlisted historical repair for 8G992 only.
 *
 * This is operator tooling, not runtime recovery.  It corrects two proven
 * historical representations: a missing close native withdrawal and a
 * five-lamport overstatement of the original OPEN_CONTRIBUTION.  The latter
 * is an append-only negative adjustment to the original cashflow, preserving
 * both configured capital as metadata and every prior settlement version.
 */
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { PublicKey } from '@solana/web3.js';
import { assessLifecycleSettlement, lifecycleSettlementEvidenceHash } from '../.build/packages/db/src/index.js';
import { reconcileTerminalSettlementChainEffects } from '../.build/packages/phase6-live-worker/src/index.js';

const SOURCE_COMMIT = process.env.LPFORGE_SOURCE_COMMIT ?? '42a0e08b726acbd0ff3a1c2fced0e84a16337b75';
const IMPLEMENTATION = '8g992-accounting-basis-append-only-repair-v1';
const REASON = 'HISTORICAL_CHAIN_RECONCILIATION_CORRECTION';
export const TARGET = Object.freeze({
  key: '8G992',
  positionAddress: '8G992HY1y4YBGxcHkL9DNXVKLAp7xk1AnD5ae9DwbjsQ',
  ownerAddress: 'BfLVvHc2hsEPSRcC3MXQ2H3ixwyruRxCdp9zZSUoSfSd',
  entryPlanId: 'plan-33ce0d0037c463a8ef737f16abf221ad',
  closePlanId: 'plan-a53c8b873702912fcde0aab92faf03d6',
  expectedLatestVersion: 2,
  expectedLatestNet: -29_712_167n,
  expectedV3Net: -32_525n,
  configuredCapitalLamports: 30_000_000n,
  actualFundedCapitalLamports: 29_999_995n,
  openingSignature: '4ynFFrJfVJWRuNaZ1JUcdzsaNui37yMTyb5ZF9WTZevH2WKsjiZMXTEsX9DrqpExqhiw9vjKNwJfoHVPLsoEwX8x',
  removeSignature: '3UWxD23v1Cuf1y6i52P3hX9bz7zXDkfcf7VmXffqXspoastpUbxUX8oFS8sNBj5gH8S45yoYWvNaXKJnkN8qQvXM',
  removeTransactionId: 'tx-1-93dbf25c9ed5f607799c39269ab7c07c-a53c8b873702912fcde0aab92faf03d6',
  removeNativeLamports: 29_679_637n,
  basisAdjustmentLamports: -5n,
});

export function assertTarget(target = TARGET) {
  if (target.key !== '8G992' || target.positionAddress !== TARGET.positionAddress) throw new Error('LPFORGE_8G992_REPAIR_ALLOWLIST_INVALID');
  if (target.configuredCapitalLamports - target.actualFundedCapitalLamports !== 5n) throw new Error('LPFORGE_8G992_REPAIR_BASIS_DELTA_INVALID');
  // OPEN_CONTRIBUTION is a settlement outflow: a negative correction reduces
  // the recorded cost basis and therefore increases net PnL by five lamports.
  if (target.expectedLatestNet + target.removeNativeLamports - target.basisAdjustmentLamports !== target.expectedV3Net) throw new Error('LPFORGE_8G992_REPAIR_EXPECTED_NET_INVALID');
}
function json(value) { return JSON.stringify(value); }
function bigint(value) { return BigInt(String(value)); }
function rawRpcConnection(rpcUrl) {
  let requestId = 0;
  const call = async (method, params) => {
    const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ jsonrpc: '2.0', id: ++requestId, method, params }) });
    if (!response.ok) throw new Error(`LPFORGE_8G992_REPAIR_RPC_HTTP:${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`LPFORGE_8G992_REPAIR_RPC:${method}:${body.error.code}`);
    return body.result;
  };
  return {
    getTransaction(signature, options = {}) { return call('getTransaction', [signature, { encoding: options.encoding ?? 'json', commitment: options.commitment ?? 'finalized', maxSupportedTransactionVersion: 0 }]); },
    getAccountInfoAndContext(address, commitment = 'finalized') { return call('getAccountInfo', [address.toBase58(), { encoding: 'base64', commitment }]); },
  };
}
function accountKeys(receipt) {
  const staticKeys = receipt.transaction?.message?.accountKeys ?? [];
  const loaded = receipt.meta?.loadedAddresses ?? { writable: [], readonly: [] };
  return [...staticKeys, ...(loaded.writable ?? []), ...(loaded.readonly ?? [])].map((key) => typeof key === 'string' ? key : String(key.pubkey ?? key));
}
function parsedInstructions(receipt) {
  return [
    ...(receipt.transaction?.message?.instructions ?? []),
    ...(receipt.meta?.innerInstructions ?? []).flatMap((entry) => entry.instructions ?? []),
  ].filter((instruction) => instruction?.parsed?.info);
}
async function finalizedReceipt(connection, signature) {
  const receipt = await connection.getTransaction(signature, { encoding: 'jsonParsed', commitment: 'finalized' });
  if (!receipt?.meta || receipt.meta.err) throw new Error(`LPFORGE_8G992_REPAIR_CHAIN_RECEIPT_INVALID:${signature}`);
  return receipt;
}
export async function verifyEntryBasis(connection, target = TARGET) {
  const receipt = await finalizedReceipt(connection, target.openingSignature);
  const instructions = parsedInstructions(receipt);
  const configuredTransfer = instructions.some((instruction) => instruction.parsed.type === 'transfer' && instruction.parsed.info.source === target.ownerAddress && bigint(instruction.parsed.info.lamports) === target.configuredCapitalLamports);
  const deployedTransfers = instructions.filter((instruction) => instruction.parsed.type === 'transferChecked' && instruction.parsed.info.authority === target.ownerAddress && instruction.parsed.info.mint === 'So11111111111111111111111111111111111111112').map((instruction) => bigint(instruction.parsed.info.tokenAmount.amount));
  if (!configuredTransfer || !deployedTransfers.includes(target.actualFundedCapitalLamports)) throw new Error('LPFORGE_8G992_REPAIR_ENTRY_BASIS_UNPROVEN');
  return { slot: BigInt(receipt.slot), blockTime: receipt.blockTime === null ? undefined : new Date(receipt.blockTime * 1000).toISOString(), configuredCapitalLamports: target.configuredCapitalLamports, actualFundedCapitalLamports: target.actualFundedCapitalLamports };
}
export async function verifyRemoveNative(connection, target = TARGET) {
  const receipt = await finalizedReceipt(connection, target.removeSignature);
  const keys = accountKeys(receipt), ownerIndex = keys.indexOf(target.ownerAddress);
  if (ownerIndex < 0) throw new Error('LPFORGE_8G992_REPAIR_REMOVE_OWNER_UNPROVEN');
  const gross = bigint(receipt.meta.postBalances[ownerIndex]) - bigint(receipt.meta.preBalances[ownerIndex]) + bigint(receipt.meta.fee ?? 0);
  if (gross !== target.removeNativeLamports) throw new Error(`LPFORGE_8G992_REPAIR_REMOVE_AMOUNT_DRIFT:${gross}`);
  return { slot: BigInt(receipt.slot), blockTime: receipt.blockTime === null ? undefined : new Date(receipt.blockTime * 1000).toISOString(), gross };
}
function normalizeTransactionState(state) {
  if (['CONFIRMED', 'FINALIZED', 'SKIPPED_NO_EFFECT'].includes(state)) return 'CONFIRMED';
  if (['FAILED', 'EXPIRED'].includes(state)) return 'FAILED_FINAL';
  if (state === 'PROVEN_NOT_LANDED') return 'PROVEN_NOT_LANDED';
  if (state === 'UNKNOWN') return 'UNKNOWN';
  if (['SUBMITTED', 'SENT', 'PROCESSED'].includes(state)) return 'SUBMITTED';
  return 'RECOVERY_PENDING';
}
async function loadInput(db) {
  const lifecycle = (await db.query('SELECT lifecycle_id,position_address,entry_plan_id,owner_address,pool_address,predecessor_lifecycle_id,status FROM execution.position_lifecycles WHERE position_address=$1', [TARGET.positionAddress])).rows[0];
  if (!lifecycle) throw new Error('LPFORGE_8G992_REPAIR_LIFECYCLE_MISSING');
  const [cash, lots, transactions, reservations] = await Promise.all([
    db.query('SELECT cashflow_id,plan_id,flow_type,lamports,token_mint,token_amount_raw,payload FROM execution.position_cashflows WHERE lifecycle_id=$1 ORDER BY observed_at,cashflow_id', [lifecycle.lifecycle_id]),
    db.query('SELECT lot_id,position_address,plan_id,owner_address,pool_address,token_mint,token_side,source_event,source_cashflow_id,raw_amount,remaining_raw_amount,decimals,acquired_at,status,payload FROM execution.position_inventory_lots WHERE lifecycle_id=$1 ORDER BY acquired_at,lot_id', [lifecycle.lifecycle_id]),
    db.query("SELECT link.plan_id,link.role,s.transaction_id,s.kind,a.signature,CASE WHEN s.kind='JUPITER_UNWIND' AND a.signature IS NULL AND p.payload #>> '{autonomous_dispatch,attributableTokenX}'='0' AND p.payload #>> '{autonomous_dispatch,attributableTokenY}'='0' THEN 'SKIPPED_NO_EFFECT' ELSE COALESCE(CASE WHEN a.state='EXPIRED' THEN 'EXPIRED' ELSE c.status END,a.state,CASE WHEN s.state IN ('CONFIRMED','COMPLETED') THEN 'CONFIRMED' ELSE s.state END) END state FROM execution.lifecycle_plan_links link JOIN execution.transaction_plans p ON p.plan_id=link.plan_id JOIN execution.transaction_steps s ON s.plan_id=link.plan_id LEFT JOIN LATERAL (SELECT attempt_id,signature,state FROM execution.submission_attempts WHERE transaction_id=s.transaction_id ORDER BY attempt DESC LIMIT 1) a ON true LEFT JOIN LATERAL (SELECT status FROM execution.confirmations WHERE attempt_id=a.attempt_id ORDER BY observed_at DESC LIMIT 1) c ON true WHERE link.lifecycle_id=$1 ORDER BY s.sequence", [lifecycle.lifecycle_id]),
    db.query("SELECT count(*)::int n FROM execution.capital_reservations r JOIN execution.lifecycle_plan_links link ON link.plan_id=r.plan_id WHERE link.lifecycle_id=$1 AND r.state IN ('RESERVED','SUBMITTED')", [lifecycle.lifecycle_id]),
  ]);
  return {
    lifecycle: { lifecycleId: String(lifecycle.lifecycle_id), positionAddress: String(lifecycle.position_address), entryPlanId: String(lifecycle.entry_plan_id), ownerAddress: String(lifecycle.owner_address), poolAddress: String(lifecycle.pool_address), status: String(lifecycle.status) },
    cashflows: cash.rows.map((row) => ({ cashflowId: String(row.cashflow_id), flowType: String(row.flow_type), planId: String(row.plan_id), ...(row.lamports === null ? {} : { lamports: bigint(row.lamports) }), ...(row.token_mint ? { tokenMint: String(row.token_mint) } : {}), ...(row.token_amount_raw === null ? {} : { tokenAmountRaw: String(row.token_amount_raw) }), payload: row.payload ?? {} })),
    inventoryLots: lots.rows.map((row) => ({ lotId: String(row.lot_id), positionAddress: String(row.position_address), planId: String(row.plan_id), ownerAddress: String(row.owner_address), poolAddress: String(row.pool_address), tokenMint: String(row.token_mint), tokenSide: String(row.token_side), sourceEvent: String(row.source_event), ...(row.source_cashflow_id ? { sourceCashflowId: String(row.source_cashflow_id) } : {}), rawAmount: bigint(row.raw_amount), remainingRawAmount: bigint(row.remaining_raw_amount), decimals: Number(row.decimals), acquiredAt: new Date(row.acquired_at).toISOString(), status: String(row.status), payload: row.payload ?? {} })),
    transactions: transactions.rows.map((row) => ({ transactionId: String(row.transaction_id), ...(row.signature ? { signature: String(row.signature) } : {}), planId: String(row.plan_id), planRole: String(row.role), kind: String(row.kind), ...(String(row.state) === 'SKIPPED_NO_EFFECT' ? { skippedNoEffect: true } : {}), state: normalizeTransactionState(String(row.state)) })),
    positionAbsent: true, reconciliationClean: true, reservationClean: Number(reservations.rows[0].n) === 0,
  };
}
async function validatePreconditions(db) {
  const result = await db.query("SELECT l.lifecycle_id,l.status,(SELECT count(*) FROM execution.lifecycle_sol_settlements s WHERE s.lifecycle_id=l.lifecycle_id) versions,(SELECT settlement_version FROM execution.lifecycle_sol_settlements s WHERE s.lifecycle_id=l.lifecycle_id ORDER BY settlement_version DESC LIMIT 1) latest_version,(SELECT realized_sol_pnl_lamports FROM execution.lifecycle_sol_settlements s WHERE s.lifecycle_id=l.lifecycle_id ORDER BY settlement_version DESC LIMIT 1) latest_net FROM execution.position_lifecycles l WHERE l.position_address=$1", [TARGET.positionAddress]);
  const row = result.rows[0];
  if (!row || String(row.status) !== 'SOL_SETTLED' || Number(row.versions) !== TARGET.expectedLatestVersion || Number(row.latest_version) !== TARGET.expectedLatestVersion || bigint(row.latest_net) !== TARGET.expectedLatestNet) throw new Error('LPFORGE_8G992_REPAIR_PRECONDITION_DRIFT');
  return String(row.lifecycle_id);
}
function id(lifecycleId, signature, effectType) { return `historical-chain-reconciliation:${lifecycleId}:${signature}:${effectType}`; }
function effects(input, entryProof, removeProof, at) {
  const basis = { cashflowId: id(input.lifecycle.lifecycleId, TARGET.openingSignature, 'ENTRY_BASIS_ROUNDING_CORRECTION'), positionAddress: TARGET.positionAddress, planId: TARGET.entryPlanId, flowType: 'OPEN_CONTRIBUTION', observedAt: at, lamports: TARGET.basisAdjustmentLamports, payload: { source: REASON, implementation: IMPLEMENTATION, effectType: 'ENTRY_BASIS_ROUNDING_CORRECTION', transactionSignature: TARGET.openingSignature, chainSlot: entryProof.slot.toString(), chainTimestamp: entryProof.blockTime, configuredCapitalLamports: TARGET.configuredCapitalLamports.toString(), actualFundedCapitalLamports: TARGET.actualFundedCapitalLamports.toString(), repairSourceCommit: SOURCE_COMMIT } };
  const removal = { cashflowId: id(input.lifecycle.lifecycleId, TARGET.removeSignature, 'REMOVE_NATIVE_WITHDRAWAL'), positionAddress: TARGET.positionAddress, planId: TARGET.closePlanId, flowType: 'CLOSE_WITHDRAWAL', observedAt: at, lamports: TARGET.removeNativeLamports, payload: { source: REASON, implementation: IMPLEMENTATION, effectType: 'REMOVE_NATIVE_WITHDRAWAL', transactionSignature: TARGET.removeSignature, transactionId: TARGET.removeTransactionId, chainSlot: removeProof.slot.toString(), chainTimestamp: removeProof.blockTime, ownerAddress: TARGET.ownerAddress, repairSourceCommit: SOURCE_COMMIT } };
  return [basis, removal];
}
async function assertNoExistingEffects(db, lifecycleId, proposed) {
  for (const flow of proposed) {
    const existing = await db.query("SELECT cashflow_id FROM execution.position_cashflows WHERE lifecycle_id=$1 AND (cashflow_id=$2 OR (flow_type=$3 AND lamports=$4 AND payload->>'transactionSignature'=$5 AND payload->>'effectType'=$6))", [lifecycleId, flow.cashflowId, flow.flowType, flow.lamports.toString(), flow.payload.transactionSignature, flow.payload.effectType]);
    if (existing.rows.length) throw new Error(`LPFORGE_8G992_REPAIR_EFFECT_ALREADY_EXISTS:${flow.payload.effectType}`);
  }
}
function externalInput(input) { return { ...input, transactions: input.transactions.filter((transaction) => !transaction.skippedNoEffect) }; }
async function upsertReconciliation(db, input, result, at) {
  const chainNet = result.chainSolInLamports - result.chainSolOutLamports, dbNet = result.dbSolInLamports - result.dbSolOutLamports;
  await db.query("INSERT INTO execution.lifecycle_settlement_chain_reconciliations(lifecycle_id,position_address,close_plan_id,status,chain_sol_in_lamports,chain_sol_out_lamports,chain_net_sol_pnl_lamports,db_sol_in_lamports,db_sol_out_lamports,db_net_sol_pnl_lamports,difference_lamports,reason_codes,payload,observed_at,updated_at) VALUES($1,$2,$3,'RECONCILED_CHAIN',$4,$5,$6,$7,$8,$9,'0',$10::jsonb,$11::jsonb,$12,$12) ON CONFLICT(lifecycle_id) DO UPDATE SET close_plan_id=EXCLUDED.close_plan_id,status=EXCLUDED.status,chain_sol_in_lamports=EXCLUDED.chain_sol_in_lamports,chain_sol_out_lamports=EXCLUDED.chain_sol_out_lamports,chain_net_sol_pnl_lamports=EXCLUDED.chain_net_sol_pnl_lamports,db_sol_in_lamports=EXCLUDED.db_sol_in_lamports,db_sol_out_lamports=EXCLUDED.db_sol_out_lamports,db_net_sol_pnl_lamports=EXCLUDED.db_net_sol_pnl_lamports,difference_lamports=EXCLUDED.difference_lamports,reason_codes=EXCLUDED.reason_codes,payload=EXCLUDED.payload,observed_at=EXCLUDED.observed_at,updated_at=EXCLUDED.updated_at", [input.lifecycle.lifecycleId,TARGET.positionAddress,TARGET.closePlanId,result.chainSolInLamports.toString(),result.chainSolOutLamports.toString(),chainNet.toString(),result.dbSolInLamports.toString(),result.dbSolOutLamports.toString(),dbNet.toString(),json(result.reasonCodes),json({ ...result.payload, source: REASON, implementation: IMPLEMENTATION, fullLifecycleEntryBasis: { configuredCapitalLamports: TARGET.configuredCapitalLamports.toString(), actualFundedCapitalLamports: TARGET.actualFundedCapitalLamports.toString() } }),at]);
}
async function insertSettlementV3(db, input, assessment, evidenceHash, at, slot) {
  return db.query("INSERT INTO execution.lifecycle_sol_settlements(settlement_id,lifecycle_id,settlement_version,position_address,owner_address,pool_address,entry_plan_id,total_sol_in_lamports,total_sol_out_lamports,rent_locked_lamports,rent_recovered_lamports,net_rent_cost_lamports,realized_sol_pnl_lamports,cashflow_count,inventory_lot_count,child_transaction_count,position_checked_at,position_checked_slot,reconciliation_verified_at,source_commit,policy_hash,migration_head,build_id,evidence_hash,settled_at,payload) VALUES($1,$2,3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$16,$18,NULL,'M0067_terminal_fee_claim_settlement_reconciliation.sql',NULL,$19,$16,$20::jsonb)", [`settlement:${input.lifecycle.lifecycleId}:v3`,input.lifecycle.lifecycleId,input.lifecycle.positionAddress,input.lifecycle.ownerAddress,input.lifecycle.poolAddress,input.lifecycle.entryPlanId,assessment.totalSolInLamports.toString(),assessment.totalSolOutLamports.toString(),assessment.rentLockedLamports.toString(),assessment.rentRecoveredLamports.toString(),assessment.netRentCostLamports.toString(),assessment.realizedSolPnlLamports.toString(),input.cashflows.length,input.inventoryLots.length,input.transactions.length,at,slot.toString(),SOURCE_COMMIT,evidenceHash,json({ accountingConvention: 'gross-sol-instruction-flows-v1', reasonCodes: assessment.reasonCodes, supersedesSettlementId: `settlement:${input.lifecycle.lifecycleId}:v2`, supersedesSettlementVersion: 2, supersessionReason: REASON, repair: { implementation: IMPLEMENTATION, target: TARGET.key, approvedAllowlist: true, entryBasis: { configuredCapitalLamports: TARGET.configuredCapitalLamports.toString(), actualFundedCapitalLamports: TARGET.actualFundedCapitalLamports.toString() } } })]);
}
export async function run8G992Repair({ databaseUrl, rpcUrl, execute = false }) {
  assertTarget();
  if (execute && process.env.LPFORGE_APPROVED_8G992_REPAIR_EXECUTE !== 'YES') throw new Error('LPFORGE_8G992_REPAIR_EXECUTION_ACK_REQUIRED');
  if (!databaseUrl || !rpcUrl) throw new Error('LPFORGE_8G992_REPAIR_DATABASE_AND_RPC_REQUIRED');
  const db = new Client({ connectionString: databaseUrl }); await db.connect();
  try {
    const connection = rawRpcConnection(rpcUrl), lifecycleId = await validatePreconditions(db), input = await loadInput(db);
    if (input.lifecycle.lifecycleId !== lifecycleId || input.lifecycle.ownerAddress !== TARGET.ownerAddress || input.lifecycle.entryPlanId !== TARGET.entryPlanId || !input.reservationClean) throw new Error('LPFORGE_8G992_REPAIR_LIFECYCLE_DRIFT');
    const [entryProof, removeProof, account] = await Promise.all([verifyEntryBasis(connection), verifyRemoveNative(connection), connection.getAccountInfoAndContext(new PublicKey(TARGET.positionAddress), 'finalized')]);
    if (account.value !== null) throw new Error('LPFORGE_8G992_REPAIR_POSITION_EXISTS');
    const at = new Date().toISOString(), additions = effects(input, entryProof, removeProof, at);
    await assertNoExistingEffects(db, lifecycleId, additions);
    const repaired = { ...input, cashflows: [...input.cashflows, ...additions], positionAbsent: true, positionCheckedAt: at, positionCheckedSlot: BigInt(account.context.slot), reconciliationClean: true };
    const assessment = assessLifecycleSettlement(repaired);
    if (!assessment.ready || assessment.realizedSolPnlLamports !== TARGET.expectedV3Net) throw new Error(`LPFORGE_8G992_REPAIR_SETTLEMENT_MISMATCH:${assessment.realizedSolPnlLamports}`);
    const external = await reconcileTerminalSettlementChainEffects({ connection, plan: { planId: TARGET.closePlanId, ownerAddress: TARGET.ownerAddress }, positionAddress: TARGET.positionAddress, settlementInput: externalInput(repaired) });
    if (!external.ok) throw new Error(`LPFORGE_8G992_REPAIR_EXTERNAL_PREFLIGHT_FAILED:${external.reasonCodes.join(',')}`);
    if (!execute) return { executed: false, lifecycleId, expectedNet: assessment.realizedSolPnlLamports.toString(), external: 'PASS', additions: additions.map((flow) => ({ cashflowId: flow.cashflowId, flowType: flow.flowType, lamports: flow.lamports.toString() })) };
    const evidenceHash = await lifecycleSettlementEvidenceHash(repaired, assessment);
    await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
      await validatePreconditions(db); await assertNoExistingEffects(db, lifecycleId, additions);
      for (const flow of additions) {
        const inserted = await db.query('INSERT INTO execution.position_cashflows(cashflow_id,lifecycle_id,position_address,plan_id,flow_type,observed_at,lamports,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(cashflow_id) DO NOTHING RETURNING cashflow_id', [flow.cashflowId,lifecycleId,flow.positionAddress,flow.planId,flow.flowType,flow.observedAt,flow.lamports.toString(),json(flow.payload)]);
        if (inserted.rows.length !== 1) throw new Error(`LPFORGE_8G992_REPAIR_INSERT_CONFLICT:${flow.cashflowId}`);
      }
      await insertSettlementV3(db, repaired, assessment, evidenceHash, at, BigInt(account.context.slot));
      await upsertReconciliation(db, repaired, external, at);
      await db.query('COMMIT');
    } catch (error) { try { await db.query('ROLLBACK'); } catch {} throw error; }
    return { executed: true, lifecycleId, settlementId: `settlement:${lifecycleId}:v3`, expectedNet: assessment.realizedSolPnlLamports.toString(), external: 'PASS', additions: additions.map((flow) => ({ cashflowId: flow.cashflowId, flowType: flow.flowType, lamports: flow.lamports.toString() })) };
  } finally { await db.end(); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const execute = process.argv.includes('--execute');
  console.log(json(await run8G992Repair({ databaseUrl: process.env.DATABASE_URL, rpcUrl: process.env.SOLANA_RPC_HTTP_URL, execute })));
}
