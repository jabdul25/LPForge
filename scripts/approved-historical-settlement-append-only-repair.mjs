/**
 * Explicit one-shot operator utility for the three historically approved
 * chain-reconciliation repairs.  It intentionally has no discovery query:
 * the allowlist, signatures, old settlement values and corrected values are
 * all fixed in source.  It is not part of runtime recovery.
 *
 * Dry-run is the default.  Mutation additionally requires both --execute and
 * LPFORGE_APPROVED_HISTORICAL_REPAIR_EXECUTE=YES.
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { PublicKey } from '@solana/web3.js';
import { assessLifecycleSettlement, lifecycleSettlementEvidenceHash } from '../.build/packages/db/src/index.js';
import { reconcileTerminalSettlementChainEffects } from '../.build/packages/phase6-live-worker/src/index.js';

const SOURCE_COMMIT = process.env.LPFORGE_SOURCE_COMMIT ?? '9863742e7c39ab78c6466729b425236c14d1cc0c';
const IMPLEMENTATION = 'approved-historical-settlement-append-only-repair-v1';
const REASON = 'HISTORICAL_CHAIN_RECONCILIATION_CORRECTION';

export const REPAIR_TARGETS = Object.freeze([
  Object.freeze({
    key: 'BhhRQ',
    positionAddress: 'BhhRQ4mwtvPcXzzGEskSqwY6D9NPhjNgpsganNsigpEx',
    closePlanId: 'plan-271860abf6f54a54b3b15d7ed4b5bb02',
    expectedV1Net: 144_797n,
    expectedV2Net: 320_468n,
    effects: Object.freeze([Object.freeze({
      effectType: 'TERMINAL_FEE_CLAIM', flowType: 'FEE_CLAIM', lamports: 175_671n,
      transactionId: 'tx-3-8c3bdb893b77481057c48b459485c337-271860abf6f54a54b3b15d7ed4b5bb02:claim',
      signature: '5jtTtZP9HzBSsd3La29ZirqbcKmjwCztgmPADJb7ktTH7WKsfb54ifbYnd9N7dKXN1reLCfG24HfQif3pyhQpnZg',
      planRole: 'CLOSE', receiptKind: 'OWNER_NATIVE_GROSS',
    })]),
  }),
  Object.freeze({
    key: 'DrbJX',
    positionAddress: 'DrbJXWwg45Gjqqy9LGDN2KTZ338PGQyRLGVusvwSMK7w',
    closePlanId: 'plan-b3530c9edd6aba242824e25a3e0b0c6a',
    expectedV1Net: -446_018n,
    expectedV2Net: -406_220n,
    effects: Object.freeze([Object.freeze({
      effectType: 'TERMINAL_FEE_CLAIM', flowType: 'FEE_CLAIM', lamports: 39_798n,
      transactionId: 'tx-3-37be24a265562a990f9948f86f0045dd-b3530c9edd6aba242824e25a3e0b0c6a:claim',
      signature: '3brMxdZ2zksduEBJmHkW7k4fiK8VrzBUcLxKc9m4Wvii7hEvxC9Zgx6hToboLitASXwqYu4HJ8dGckbUZbfFK6VH',
      planRole: 'CLOSE', receiptKind: 'OWNER_NATIVE_GROSS',
    })]),
  }),
  Object.freeze({
    key: 'F3V7UH',
    positionAddress: 'F3V7UHyrQUSWzukbjNSvs41VEGZPvhxBjCPwMgz9ue1k',
    closePlanId: 'plan-85eaccda255d2a071e26c40c73df4302',
    expectedV1Net: -84_687_407n,
    expectedV2Net: -115_822n,
    effects: Object.freeze([
      Object.freeze({ effectType: 'MANAGEMENT_FEE_CLAIM', flowType: 'FEE_CLAIM', lamports: 28_153n, planId: 'plan-8a98a5e1148996597df456b6cc4cc0a3', transactionId: 'tx-1-2a9ae7bf92d4d486259be37bacb63ad7-8a98a5e1148996597df456b6cc4cc0a3', signature: '5fyP6AhhgjE9Do7PJwxsaDgzi7jpwKbeZYkZbFHyprTQUKyA4MAa7T3Hkc4zPDny428SzPcT6iAbws34xytSwP7w', planRole: 'MANAGEMENT', receiptKind: 'OWNER_NATIVE_GROSS' }),
      Object.freeze({ effectType: 'TERMINAL_FEE_CLAIM', flowType: 'FEE_CLAIM', lamports: 175n, transactionId: 'tx-3-962e22431f8b46838e8383dd64ef9ad5-85eaccda255d2a071e26c40c73df4302:claim', signature: 'tJqfnkAw1jGozrnHqKzZWMikXs1hTbeLaKhtR8bQhVB6gafbUfNhV9FrKU3yqxYRjC4MJY1REaZPtYvDWME5giF', planRole: 'CLOSE', receiptKind: 'OWNER_NATIVE_GROSS' }),
      Object.freeze({ effectType: 'REMOVE_NATIVE_WITHDRAWAL', flowType: 'CLOSE_WITHDRAWAL', lamports: 27_137_177n, transactionId: 'tx-1-94c0ec92acc6550c69ba9aaef187df33-85eaccda255d2a071e26c40c73df4302', signature: '4UwroFFUK6XsxRyd9CC9e5BiD2RHr8Adf4HZvQ2BzD6rjBqnaXgC829u4qhrfCABVofeVJyQy4ayer1jEu2RLHvo', planRole: 'CLOSE', receiptKind: 'OWNER_NATIVE_GROSS' }),
      Object.freeze({ effectType: 'POSITION_RENT_RECOVERY', flowType: 'RENT_RECOVERY', lamports: 57_406_080n, transactionId: 'tx-3-962e22431f8b46838e8383dd64ef9ad5-85eaccda255d2a071e26c40c73df4302', signature: 'TcGiETe6uTDfqzc39K6PcipoXLd5Yx5ziYtLDFhH5p5iLbxTZ3qGSvENaUSxj2SoSTgZ5RjzZFdWGzit76fbuJG', planRole: 'CLOSE', receiptKind: 'POSITION_ACCOUNT_RENT' }),
    ]),
  }),
]);

export function approvedRepairCashflowId(lifecycleId, effect) {
  return `historical-chain-reconciliation:${lifecycleId}:${effect.signature}:${effect.effectType}`;
}

export function assertExplicitAllowlist(targets) {
  if (targets.length !== 3) throw new Error('LPFORGE_HISTORICAL_REPAIR_ALLOWLIST_COUNT_INVALID');
  const keys = targets.map((target) => target.key).join(',');
  if (keys !== 'BhhRQ,DrbJX,F3V7UH') throw new Error('LPFORGE_HISTORICAL_REPAIR_ALLOWLIST_INVALID');
  for (const target of targets) {
    const correction = target.effects.reduce((total, effect) => total + effect.lamports, 0n);
    if (target.expectedV1Net + correction !== target.expectedV2Net) {
      throw new Error(`LPFORGE_HISTORICAL_REPAIR_EXPECTED_NET_INVALID:${target.key}`);
    }
  }
}

function json(value) { return JSON.stringify(value); }
function rawRpcConnection(rpcUrl) {
  let requestId = 0;
  const call = async (method, params) => {
    const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ jsonrpc: '2.0', id: ++requestId, method, params }) });
    if (!response.ok) throw new Error(`LPFORGE_HISTORICAL_REPAIR_RPC_HTTP:${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`LPFORGE_HISTORICAL_REPAIR_RPC:${method}:${body.error.code}`);
    return body.result;
  };
  // Historical parsed instruction payloads from this provider are not accepted
  // by web3.js' strict parser.  The runtime receipt machinery itself supports
  // raw JSON RPC, so retain raw account-index evidence here.
  return {
    getTransaction(signature, options = {}) { return call('getTransaction', [signature, { encoding: 'json', commitment: options.commitment ?? 'finalized', maxSupportedTransactionVersion: options.maxSupportedTransactionVersion ?? 0 }]); },
    getAccountInfoAndContext(address, commitment = 'finalized') { return call('getAccountInfo', [address.toBase58(), { encoding: 'base64', commitment }]); },
  };
}
function accountKeys(receipt) {
  const staticKeys = receipt.transaction?.message?.accountKeys ?? [];
  const loaded = receipt.meta?.loadedAddresses ?? { writable: [], readonly: [] };
  return [...staticKeys, ...(loaded.writable ?? []), ...(loaded.readonly ?? [])].map((key) => typeof key === 'string' ? key : String(key.pubkey ?? key));
}
function bigint(value) { return BigInt(String(value)); }
function normalizeTransactionState(state) {
  if (['CONFIRMED', 'FINALIZED', 'SKIPPED_NO_EFFECT'].includes(state)) return 'CONFIRMED';
  if (['FAILED', 'EXPIRED'].includes(state)) return 'FAILED_FINAL';
  if (state === 'PROVEN_NOT_LANDED') return 'PROVEN_NOT_LANDED';
  if (state === 'UNKNOWN') return 'UNKNOWN';
  if (['SUBMITTED', 'SENT', 'PROCESSED'].includes(state)) return 'SUBMITTED';
  return 'RECOVERY_PENDING';
}

async function verifyChainEffect(connection, ownerAddress, positionAddress, effect) {
  const receipt = await connection.getTransaction(effect.signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  if (!receipt?.meta || receipt.meta.err) throw new Error(`LPFORGE_HISTORICAL_REPAIR_CHAIN_RECEIPT_INVALID:${effect.effectType}`);
  const keys = accountKeys(receipt);
  let observed;
  if (effect.receiptKind === 'OWNER_NATIVE_GROSS') {
    const index = keys.indexOf(ownerAddress);
    if (index < 0) throw new Error(`LPFORGE_HISTORICAL_REPAIR_OWNER_UNPROVEN:${effect.effectType}`);
    observed = bigint(receipt.meta.postBalances[index]) - bigint(receipt.meta.preBalances[index]) + bigint(receipt.meta.fee ?? 0);
  } else if (effect.receiptKind === 'POSITION_ACCOUNT_RENT') {
    const index = keys.indexOf(positionAddress);
    if (index < 0 || bigint(receipt.meta.postBalances[index]) !== 0n) throw new Error(`LPFORGE_HISTORICAL_REPAIR_RENT_UNPROVEN:${effect.effectType}`);
    observed = bigint(receipt.meta.preBalances[index]);
  } else throw new Error(`LPFORGE_HISTORICAL_REPAIR_RECEIPT_KIND_INVALID:${effect.effectType}`);
  if (observed !== effect.lamports) throw new Error(`LPFORGE_HISTORICAL_REPAIR_AMOUNT_DRIFT:${effect.effectType}:${observed}`);
  return { slot: BigInt(receipt.slot), blockTime: receipt.blockTime === null ? undefined : new Date(receipt.blockTime * 1000).toISOString(), feeLamports: bigint(receipt.meta.fee ?? 0) };
}

async function loadInput(db, positionAddress) {
  const lifecycle = (await db.query('SELECT lifecycle_id,position_address,entry_plan_id,owner_address,pool_address,predecessor_lifecycle_id,status FROM execution.position_lifecycles WHERE position_address=$1', [positionAddress])).rows[0];
  if (!lifecycle) throw new Error('LPFORGE_HISTORICAL_REPAIR_LIFECYCLE_MISSING');
  const [cash, lots, transactions, owned, reservations] = await Promise.all([
    db.query('SELECT cashflow_id,plan_id,flow_type,lamports,token_mint,token_amount_raw,payload FROM execution.position_cashflows WHERE lifecycle_id=$1 ORDER BY observed_at,cashflow_id', [lifecycle.lifecycle_id]),
    db.query('SELECT lot_id,position_address,plan_id,owner_address,pool_address,token_mint,token_side,source_event,source_cashflow_id,raw_amount,remaining_raw_amount,decimals,acquired_at,status,payload FROM execution.position_inventory_lots WHERE lifecycle_id=$1 ORDER BY acquired_at,lot_id', [lifecycle.lifecycle_id]),
    // Keep historical no-effect unwinds terminal, exactly as the canonical
    // lifecycle settlement loader does.  A missing signature is not pending
    // when the durable dispatch explicitly recorded zero attributable tokens.
    db.query("SELECT link.plan_id,link.role,s.transaction_id,s.kind,a.signature,CASE WHEN s.kind='JUPITER_UNWIND' AND a.signature IS NULL AND p.payload #>> '{autonomous_dispatch,attributableTokenX}'='0' AND p.payload #>> '{autonomous_dispatch,attributableTokenY}'='0' THEN 'SKIPPED_NO_EFFECT' ELSE COALESCE(CASE WHEN a.state='EXPIRED' THEN 'EXPIRED' ELSE c.status END,a.state,CASE WHEN s.state IN ('CONFIRMED','COMPLETED') THEN 'CONFIRMED' ELSE s.state END) END state FROM execution.lifecycle_plan_links link JOIN execution.transaction_plans p ON p.plan_id=link.plan_id JOIN execution.transaction_steps s ON s.plan_id=link.plan_id LEFT JOIN LATERAL (SELECT attempt_id,signature,state FROM execution.submission_attempts WHERE transaction_id=s.transaction_id ORDER BY attempt DESC LIMIT 1) a ON true LEFT JOIN LATERAL (SELECT status FROM execution.confirmations WHERE attempt_id=a.attempt_id ORDER BY observed_at DESC LIMIT 1) c ON true WHERE link.lifecycle_id=$1 ORDER BY s.sequence", [lifecycle.lifecycle_id]),
    db.query('SELECT count(*)::int n FROM execution.owned_positions WHERE position_address=$1', [positionAddress]),
    db.query("SELECT count(*)::int n FROM execution.capital_reservations r JOIN execution.lifecycle_plan_links link ON link.plan_id=r.plan_id WHERE link.lifecycle_id=$1 AND r.state IN ('RESERVED','SUBMITTED')", [lifecycle.lifecycle_id]),
  ]);
  return {
    lifecycle: { lifecycleId: String(lifecycle.lifecycle_id), positionAddress: String(lifecycle.position_address), ...(lifecycle.entry_plan_id ? { entryPlanId: String(lifecycle.entry_plan_id) } : {}), ownerAddress: String(lifecycle.owner_address), poolAddress: String(lifecycle.pool_address), ...(lifecycle.predecessor_lifecycle_id ? { predecessorLifecycleId: String(lifecycle.predecessor_lifecycle_id) } : {}), status: String(lifecycle.status) },
    cashflows: cash.rows.map((row) => ({ cashflowId: String(row.cashflow_id), flowType: String(row.flow_type), ...(row.plan_id ? { planId: String(row.plan_id) } : {}), ...(row.lamports === null ? {} : { lamports: bigint(row.lamports) }), ...(row.token_mint ? { tokenMint: String(row.token_mint) } : {}), ...(row.token_amount_raw === null ? {} : { tokenAmountRaw: String(row.token_amount_raw) }), ...(row.payload && typeof row.payload === 'object' ? { payload: row.payload } : {}) })),
    inventoryLots: lots.rows.map((row) => ({ lotId: String(row.lot_id), positionAddress: String(row.position_address), planId: String(row.plan_id), ownerAddress: String(row.owner_address), poolAddress: String(row.pool_address), tokenMint: String(row.token_mint), tokenSide: String(row.token_side), sourceEvent: String(row.source_event), ...(row.source_cashflow_id ? { sourceCashflowId: String(row.source_cashflow_id) } : {}), rawAmount: bigint(row.raw_amount), remainingRawAmount: bigint(row.remaining_raw_amount), decimals: Number(row.decimals), acquiredAt: new Date(row.acquired_at).toISOString(), status: String(row.status), payload: row.payload ?? {} })),
    transactions: transactions.rows.map((row) => ({ transactionId: String(row.transaction_id), ...(row.signature ? { signature: String(row.signature) } : {}), ...(row.plan_id ? { planId: String(row.plan_id) } : {}), ...(row.role ? { planRole: String(row.role) } : {}), ...(row.kind ? { kind: String(row.kind) } : {}), ...(String(row.state) === 'SKIPPED_NO_EFFECT' ? { skippedNoEffect: true } : {}), state: normalizeTransactionState(String(row.state)) })),
    positionAbsent: Number(owned.rows[0].n) === 0,
    reconciliationClean: true,
    reservationClean: Number(reservations.rows[0].n) === 0,
  };
}

function proposedCashflow(input, target, effect, proof, observedAt) {
  return {
    cashflowId: approvedRepairCashflowId(input.lifecycle.lifecycleId, effect), positionAddress: target.positionAddress,
    planId: effect.planId ?? target.closePlanId, flowType: effect.flowType, observedAt, lamports: effect.lamports,
    payload: { source: REASON, implementation: IMPLEMENTATION, lifecycleId: input.lifecycle.lifecycleId, positionAddress: target.positionAddress, effectType: effect.effectType, transactionSignature: effect.signature, transactionId: effect.transactionId, chainSlot: proof.slot.toString(), ...(proof.blockTime ? { chainTimestamp: proof.blockTime } : {}), repairSourceCommit: SOURCE_COMMIT },
  };
}

async function validateTargetPreconditions(db, target) {
  const result = await db.query("SELECT l.lifecycle_id,l.status,(SELECT count(*) FROM execution.lifecycle_sol_settlements s WHERE s.lifecycle_id=l.lifecycle_id) versions,(SELECT settlement_version FROM execution.lifecycle_sol_settlements s WHERE s.lifecycle_id=l.lifecycle_id ORDER BY settlement_version DESC LIMIT 1) latest_version,(SELECT realized_sol_pnl_lamports FROM execution.lifecycle_sol_settlements s WHERE s.lifecycle_id=l.lifecycle_id ORDER BY settlement_version DESC LIMIT 1) latest_net FROM execution.position_lifecycles l WHERE l.position_address=$1", [target.positionAddress]);
  const row = result.rows[0];
  if (!row || String(row.status) !== 'SOL_SETTLED' || Number(row.versions) !== 1 || Number(row.latest_version) !== 1 || bigint(row.latest_net) !== target.expectedV1Net) throw new Error(`LPFORGE_HISTORICAL_REPAIR_PRECONDITION_DRIFT:${target.key}`);
  return String(row.lifecycle_id);
}

async function noEquivalentCashflow(db, lifecycleId, effect) {
  const result = await db.query("SELECT cashflow_id FROM execution.position_cashflows WHERE lifecycle_id=$1 AND flow_type=$2 AND lamports=$3 AND (payload->>'transactionSignature'=$4 OR payload->>'signature'=$4)", [lifecycleId, effect.flowType, effect.lamports.toString(), effect.signature]);
  if (result.rows.length) throw new Error(`LPFORGE_HISTORICAL_REPAIR_EFFECT_ALREADY_EXISTS:${effect.effectType}`);
}

async function insertSettlementV2(db, input, assessment, evidenceHash, at, chainSlot, target) {
  const settlementId = `settlement:${input.lifecycle.lifecycleId}:v2`;
  await db.query("INSERT INTO execution.lifecycle_sol_settlements(settlement_id,lifecycle_id,settlement_version,position_address,owner_address,pool_address,entry_plan_id,total_sol_in_lamports,total_sol_out_lamports,rent_locked_lamports,rent_recovered_lamports,net_rent_cost_lamports,realized_sol_pnl_lamports,cashflow_count,inventory_lot_count,child_transaction_count,position_checked_at,position_checked_slot,reconciliation_verified_at,source_commit,policy_hash,migration_head,build_id,evidence_hash,settled_at,payload) VALUES($1,$2,2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$16,$18,NULL,'M0067_terminal_fee_claim_settlement_reconciliation.sql',NULL,$19,$16,$20::jsonb)", [settlementId,input.lifecycle.lifecycleId,input.lifecycle.positionAddress,input.lifecycle.ownerAddress,input.lifecycle.poolAddress,input.lifecycle.entryPlanId ?? null,assessment.totalSolInLamports.toString(),assessment.totalSolOutLamports.toString(),assessment.rentLockedLamports.toString(),assessment.rentRecoveredLamports.toString(),assessment.netRentCostLamports.toString(),assessment.realizedSolPnlLamports.toString(),input.cashflows.length,input.inventoryLots.length,input.transactions.length,at,chainSlot.toString(),SOURCE_COMMIT,evidenceHash,json({ accountingConvention: 'gross-sol-instruction-flows-v1', reasonCodes: assessment.reasonCodes, positionAbsence: { checkedAt: at, slot: chainSlot.toString(), commitment: 'finalized' }, supersedesSettlementId: `settlement:${input.lifecycle.lifecycleId}:v1`, supersedesSettlementVersion: 1, supersessionReason: REASON, repair: { implementation: IMPLEMENTATION, target: target.key, approvedAllowlist: true, sourceCommit: SOURCE_COMMIT } })]);
  return settlementId;
}

async function upsertChainReconciliation(db, input, target, result, at) {
  const status = result.ok ? 'RECONCILED_CHAIN' : 'RECONCILIATION_REQUIRED';
  await db.query("INSERT INTO execution.lifecycle_settlement_chain_reconciliations(lifecycle_id,position_address,close_plan_id,status,chain_sol_in_lamports,chain_sol_out_lamports,chain_net_sol_pnl_lamports,db_sol_in_lamports,db_sol_out_lamports,db_net_sol_pnl_lamports,difference_lamports,reason_codes,payload,observed_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$14) ON CONFLICT(lifecycle_id) DO UPDATE SET close_plan_id=EXCLUDED.close_plan_id,status=EXCLUDED.status,chain_sol_in_lamports=EXCLUDED.chain_sol_in_lamports,chain_sol_out_lamports=EXCLUDED.chain_sol_out_lamports,chain_net_sol_pnl_lamports=EXCLUDED.chain_net_sol_pnl_lamports,db_sol_in_lamports=EXCLUDED.db_sol_in_lamports,db_sol_out_lamports=EXCLUDED.db_sol_out_lamports,db_net_sol_pnl_lamports=EXCLUDED.db_net_sol_pnl_lamports,difference_lamports=EXCLUDED.difference_lamports,reason_codes=EXCLUDED.reason_codes,payload=EXCLUDED.payload,observed_at=EXCLUDED.observed_at,updated_at=EXCLUDED.updated_at", [input.lifecycle.lifecycleId,target.positionAddress,target.closePlanId,status,result.chainSolInLamports.toString(),result.chainSolOutLamports.toString(),(result.chainSolInLamports-result.chainSolOutLamports).toString(),result.dbSolInLamports.toString(),result.dbSolOutLamports.toString(),(result.dbSolInLamports-result.dbSolOutLamports).toString(),(result.chainSolInLamports-result.chainSolOutLamports-result.dbSolInLamports+result.dbSolOutLamports).toString(),json(result.reasonCodes),json({ ...result.payload, source: REASON, implementation: IMPLEMENTATION, target: target.key, verifiedAfterAppend: true }),at]);
  if (!result.ok) throw new Error(`LPFORGE_HISTORICAL_REPAIR_EXTERNAL_RECONCILIATION_FAILED:${target.key}:${result.reasonCodes.join(',')}`);
}

function externalReconciliationInput(input) {
  // The M0067 chain reconciler receives only transactions expected to have a
  // receipt.  A durable, explicitly zero-attributable skipped unwind has no
  // signature and no economic effect to reconcile; it remains in the normal
  // settlement assessment as a terminal no-op.
  return { ...input, transactions: input.transactions.filter((transaction) => !transaction.skippedNoEffect) };
}

async function repairTarget({ db, connection, target, execute }) {
  const lifecycleId = await validateTargetPreconditions(db, target);
  const initial = await loadInput(db, target.positionAddress);
  // Historical SOL_SETTLED rows intentionally retain owned_positions evidence.
  // Database-row presence is therefore not a PositionV2 existence check; the
  // authoritative finalized chain account check immediately below is.
  if (initial.lifecycle.lifecycleId !== lifecycleId || initial.lifecycle.status !== 'SOL_SETTLED' || !initial.reservationClean) throw new Error(`LPFORGE_HISTORICAL_REPAIR_LIFECYCLE_NOT_TERMINAL:${target.key}`);
  const proofs = new Map();
  for (const effect of target.effects) {
    await noEquivalentCashflow(db, lifecycleId, effect);
    proofs.set(effect.effectType, await verifyChainEffect(connection, initial.lifecycle.ownerAddress, target.positionAddress, effect));
  }
  const account = await connection.getAccountInfoAndContext(new PublicKey(target.positionAddress), 'finalized');
  if (account.value !== null) throw new Error(`LPFORGE_HISTORICAL_REPAIR_POSITION_EXISTS:${target.key}`);
  const at = new Date().toISOString();
  const additions = target.effects.map((effect) => proposedCashflow(initial, target, effect, proofs.get(effect.effectType), at));
  const repaired = { ...initial, cashflows: [...initial.cashflows, ...additions], positionAbsent: true, positionCheckedAt: at, positionCheckedSlot: BigInt(account.context.slot), reconciliationClean: true };
  const assessment = assessLifecycleSettlement(repaired);
  if (!assessment.ready || assessment.realizedSolPnlLamports !== target.expectedV2Net) throw new Error(`LPFORGE_HISTORICAL_REPAIR_SETTLEMENT_MISMATCH:${target.key}:${assessment.realizedSolPnlLamports}`);
  const dryExternal = await reconcileTerminalSettlementChainEffects({ connection, plan: { planId: target.closePlanId, ownerAddress: initial.lifecycle.ownerAddress }, positionAddress: target.positionAddress, settlementInput: externalReconciliationInput(repaired) });
  if (!dryExternal.ok) throw new Error(`LPFORGE_HISTORICAL_REPAIR_EXTERNAL_PREFLIGHT_FAILED:${target.key}:${dryExternal.reasonCodes.join(',')}`);
  if (!execute) return { target: target.key, executed: false, expectedNet: target.expectedV2Net.toString(), effects: additions.map((flow) => ({ cashflowId: flow.cashflowId, amount: flow.lamports.toString() })), external: 'PASS' };
  const evidenceHash = await lifecycleSettlementEvidenceHash(repaired, assessment);
  await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await validateTargetPreconditions(db, target);
    for (const effect of target.effects) await noEquivalentCashflow(db, lifecycleId, effect);
    for (const flow of additions) {
      const inserted = await db.query("INSERT INTO execution.position_cashflows(cashflow_id,lifecycle_id,position_address,plan_id,flow_type,observed_at,lamports,token_mint,token_amount_raw,payload) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,NULL,$8::jsonb) ON CONFLICT(cashflow_id) DO NOTHING RETURNING cashflow_id", [flow.cashflowId,lifecycleId,flow.positionAddress,flow.planId,flow.flowType,flow.observedAt,flow.lamports.toString(),json(flow.payload)]);
      if (inserted.rows.length !== 1) throw new Error(`LPFORGE_HISTORICAL_REPAIR_INSERT_CONFLICT:${target.key}:${flow.cashflowId}`);
    }
    const settlementId = await insertSettlementV2(db, repaired, assessment, evidenceHash, at, BigInt(account.context.slot), target);
    await db.query('COMMIT');
    const committed = await loadInput(db, target.positionAddress);
    const post = await reconcileTerminalSettlementChainEffects({ connection, plan: { planId: target.closePlanId, ownerAddress: committed.lifecycle.ownerAddress }, positionAddress: target.positionAddress, settlementInput: externalReconciliationInput(committed) });
    await upsertChainReconciliation(db, committed, target, post, new Date().toISOString());
    return { target: target.key, executed: true, settlementId, expectedNet: target.expectedV2Net.toString(), external: 'PASS', effects: additions.map((flow) => ({ cashflowId: flow.cashflowId, amount: flow.lamports.toString() })) };
  } catch (error) { try { await db.query('ROLLBACK'); } catch {} throw error; }
}

export async function runApprovedHistoricalSettlementRepair({ databaseUrl, rpcUrl, execute = false }) {
  assertExplicitAllowlist(REPAIR_TARGETS);
  if (execute && process.env.LPFORGE_APPROVED_HISTORICAL_REPAIR_EXECUTE !== 'YES') throw new Error('LPFORGE_HISTORICAL_REPAIR_EXECUTION_ACK_REQUIRED');
  if (!databaseUrl || !rpcUrl) throw new Error('LPFORGE_HISTORICAL_REPAIR_DATABASE_AND_RPC_REQUIRED');
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const connection = rawRpcConnection(rpcUrl);
    const results = [];
    for (const target of REPAIR_TARGETS) results.push(await repairTarget({ db, connection, target, execute }));
    return results;
  } finally { await db.end(); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const execute = process.argv.includes('--execute');
  const results = await runApprovedHistoricalSettlementRepair({ databaseUrl: process.env.DATABASE_URL, rpcUrl: process.env.SOLANA_RPC_HTTP_URL, execute });
  console.log(json({ implementation: IMPLEMENTATION, execute, results }));
}
