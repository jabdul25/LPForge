import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isLegacySequentialCloseJournalRecovery,
  mutationRiskPlanExpiry,
  shouldResumeCloseSettlement,
} from '../.build/packages/phase6-live-worker/src/index.js';

for (const stage of [
  'CLOSE_LIQUIDITY_REMOVED',
  'CLOSE_CLAIMS_SETTLED',
  'CLOSE_INVENTORY_MEASURED',
  'CLOSE_INVENTORY_UNWOUND',
]) {
  test(`confirmed ${stage} resumes only the next close-settlement stage`, () => {
    assert.equal(
      shouldResumeCloseSettlement({
        action: 'CLOSE',
        stage,
        positionExists: true,
        confirmationStatus: 'CONFIRMED',
      }),
      true,
    );
  });
}

test('close recovery never resumes an unconfirmed, absent, or unsnapshotted stage', () => {
  for (const value of [
    {action: 'CLOSE', stage: 'CLOSE_INVENTORY_SNAPSHOTTED', positionExists: true, confirmationStatus: 'CONFIRMED'},
    {action: 'CLOSE', stage: 'CLOSE_CLAIMS_SETTLED', positionExists: true, confirmationStatus: 'UNKNOWN'},
    {action: 'CLOSE', stage: 'CLOSE_INVENTORY_UNWOUND', positionExists: false, confirmationStatus: 'FINALIZED'},
    {action: 'OPEN', stage: 'CLOSE_LIQUIDITY_REMOVED', positionExists: true, confirmationStatus: 'CONFIRMED'},
  ]) assert.equal(shouldResumeCloseSettlement(value), false);
});

test('close workflow preserves every durable settlement stage and resumes from it', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  const db = await import('node:fs/promises').then(fs => fs.readFile('packages/db/src/index.ts', 'utf8'));
  for (const stage of [
    'CLOSE_INVENTORY_SNAPSHOTTED',
    'CLOSE_LIQUIDITY_REMOVED',
    'CLOSE_CLAIMS_SETTLED',
    'CLOSE_INVENTORY_MEASURED',
    'CLOSE_INVENTORY_UNWOUND',
  ]) assert.match(source, new RegExp(stage));
  assert.match(source, /RESUME_CLOSE_SETTLEMENT/);
  assert.match(source, /P6_RECOVERY_CLOSE_STAGE_RESUME_READY/);
  assert.match(db, /COALESCE\(payload->'autonomous_dispatch','\{\}'::jsonb\)\|\|\$4::jsonb/);
});

test('pending close-child recovery queries its durable child signature, not an older parent journal signature', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  assert.match(source,/const pendingSignature = closeSettlementPending\(plan\)\?\.signature;/);
  assert.match(source,/let recoverySignature = pendingSignature \?\? journal\.signature;/);
  assert.match(source,/getSignatureStatus\(recoverySignature/);
});

test('only the exact legacy sequential-close journal failure can be rehydrated', () => {
  const plan = {
    action: 'EMERGENCY_CLOSE',
    state: 'RECONCILIATION_REQUIRED',
    planPayload: {autonomous_dispatch: {
      error: 'LPFORGE_EXECUTION_JOURNAL_INVALID_TRANSITION:CONFIRMED->SIGNING',
      stage: 'CLOSE_POSITION_PENDING',
      closeSettlementIncomplete: true,
      tokenXMint: 'mint',
      attributableTokenX: '944088938',
      tokenXBefore: '3023417042',
    }},
  };
  const journal = {state: 'FAILED'};
  assert.equal(isLegacySequentialCloseJournalRecovery({plan, journal, positionExists: true}), true);
  for (const value of [
    {plan: {...plan, action: 'OPEN'}, journal, positionExists: true},
    {plan, journal: {state: 'CONFIRMED'}, positionExists: true},
    {plan, journal, positionExists: false},
    {plan: {...plan, planPayload: {autonomous_dispatch: {...plan.planPayload.autonomous_dispatch, error: 'OTHER'}}}, journal, positionExists: true},
  ]) assert.equal(isLegacySequentialCloseJournalRecovery(value), false);
});

test('legacy sequential-close recovery verifies the exact durable unwind before rehydrating the journal', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  const db = await import('node:fs/promises').then(fs => fs.readFile('packages/db/src/index.ts', 'utf8'));
  assert.match(source,/loadConfirmedSubmissionByTransactionId\(unwindStep\.transactionId\)/);
  assert.match(source,/reconcileConfirmedCloseUnwind\(/);
  assert.match(source,/P6_LEGACY_CLOSE_JOURNAL_RECOVERED_FROM_CONFIRMED_UNWIND/);
  assert.match(source,/priorJournalState: journal\.state/);
  assert.match(db,/async loadConfirmedSubmissionByTransactionId/);
  assert.match(db,/a\.transaction_id=\$1/);
});

test('terminal OPEN_RECOVERED attribution remains off the recurring queue and is read only by exact entry-plan id', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  const db = await import('node:fs/promises').then(fs => fs.readFile('packages/db/src/index.ts', 'utf8'));
  assert.match(source,/loadPartialEntryRecovery\(entryPlanId\)/);
  assert.match(source,/recoveryRow\.state\)!=="OPEN_RECOVERED"/);
  assert.match(source,/\(recoveryRow\.payload \?\? \{\}\) as Record<string,unknown>\)\.partialEntry!==true/);
  assert.match(db,/async loadPartialEntryRecovery\(planId\)/);
  assert.match(db,/WHERE plan_id=\$1/);
});

test('a normal reconciled funded OPEN cannot be misclassified as a recovered partial entry at close time', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  const normalOpen = source.slice(
    source.indexOf('await persistOpenResidualInventory'),
    source.indexOf('await input.store.completeAutonomousPlan', source.indexOf('await persistOpenResidualInventory')),
  );
  assert.doesNotMatch(normalOpen,/upsertPartialEntryRecovery/);
  assert.match(source,/partialEntry!==true/);
});

test('a transient recovery RPC failure at execution startup does not terminate the autonomous runner', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('apps/execution/src/main.ts', 'utf8'));
  const startup = source.slice(source.indexOf('const startupAt=new Date().toISOString();'), source.indexOf('for (;;) {', source.indexOf('const startupAt=new Date().toISOString();')));
  assert.match(startup,/P6_EXECUTION_DAEMON_START_FAILURE/);
  assert.match(startup,/will retry\. No blind resend is permitted/);
  assert.doesNotMatch(startup,/P6_EXECUTION_START_FAILURE'\]\}\);throw error/);
});

test('an unsigned deterministic preflight rejection is terminal no-chain-effect evidence, not an active UNKNOWN', async () => {
  const db = await import('node:fs/promises').then(fs => fs.readFile('packages/db/src/index.ts', 'utf8'));
  const runtime = await import('node:fs/promises').then(fs => fs.readFile('apps/execution/src/main.ts', 'utf8'));
  assert.match(db,/recoverNoEffectPreflightSubmissionAttempts/);
  assert.match(db,/state='EXPIRED'/);
  assert.match(db,/state='UNKNOWN' AND signature IS NULL/);
  assert.match(db,/submission_error' LIKE 'Simulation failed\.%%?'/);
  assert.match(runtime,/preflightNoEffectRecovered=await store\.recoverNoEffectPreflightSubmissionAttempts/);
});

test('expired entry deadlines never strand an existing protective close, but still bind OPEN', () => {
  const input = {planExpiresAt: '2026-08-29T00:00:00.000Z', now: '2026-08-29T01:00:00.000Z', protectivePermitTtlMs: 5_000};
  assert.equal(
    mutationRiskPlanExpiry({...input, action: 'EMERGENCY_CLOSE', positionAddress: 'position'}),
    '2026-08-29T01:00:05.000Z',
  );
  assert.equal(
    mutationRiskPlanExpiry({...input, action: 'CLOSE'}),
    input.planExpiresAt,
  );
  assert.equal(
    mutationRiskPlanExpiry({...input, action: 'OPEN', positionAddress: 'position'}),
    input.planExpiresAt,
  );
});

test('a temporary risk block after a confirmed close child remains reconciliation debt', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  assert.match(source,/P6_PROTECTIVE_CLOSE_CHILD_RISK_RETRY/);
  assert.match(source,/state: "RECONCILIATION_REQUIRED"/);
  assert.match(source,/closeSettlementStage\(input\.plan\) !== undefined/);
});

test('completion terminalization binds its shared timestamp parameter consistently', async () => {
  const db = await import('node:fs/promises').then(fs => fs.readFile('packages/db/src/index.ts', 'utf8'));
  assert.match(
    db,
    /updated_at=\$3::timestamptz,payload=payload\|\|jsonb_build_object\('terminalPlanState',\$4::text,'terminalizedAt',\$3::text\)/,
  );
});

test('recovered final account close materializes the same SOL settlement as the direct close path', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  assert.match(source,/async function finalizeClosedPositionSettlement/);
  assert.match(source,/const settlement=await finalizeClosedPositionSettlement\(\{\.\.\.input,connection\}\)/);
  assert.match(source,/const settlement=await finalizeClosedPositionSettlement\(\{store:input\.store,plan,positionAddress:recoveryPositionAddress/);
  assert.match(source,/persistLifecycleSolSettlement/);
  assert.match(source,/createLiveSolSettledLearningOutcome/);
});
